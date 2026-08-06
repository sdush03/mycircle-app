/**
 * MasonryFlashList — True View Recycling Masonry Grid
 *
 * Architecture:
 * - POOL_PER_COL fixed native View "slots" per column (e.g. 30 = 60 total Views for 10,000 photos)
 * - Slots have STABLE KEYS ("c0-0"…"c0-29", "c1-0"…"c1-29") → native View is NEVER destroyed
 * - Slot assignment is STABLE: we only reassign a slot when its current item scrolls off-screen
 *   This prevents the "teleport + content swap" glitch of naive recycling
 * - Columns are absolute-positioned at exact pixel offsets → no flex distortion of COL_WIDTH
 * - onEndReached fires via contentSize reported by the native scroll event
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, View, Dimensions, Animated as RNAnimated } from 'react-native';
import Animated, { useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { getPhotoAspect } from '../../utils/photoDimensionCache';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Layout constants — must match what the user approved:
//   9px  ← screen edge → card
//   6px  ← gap between columns →
//   9px  ← card → screen edge
// Total horizontal consumed: 9 + COL_WIDTH + 6 + COL_WIDTH + 9 = 24 + 2*COL_WIDTH = SCREEN_WIDTH
const COL_WIDTH = Math.floor((SCREEN_WIDTH - 24) / 2);
const CARD_GAP = 6;                            // vertical gap between cards

// Pool: max simultaneous native Views per column.
// Pool: max simultaneous native Views per column.
// 60 slots × 2 columns = 120 total Views regardless of list size (vs 10,000+)
const POOL_PER_COL = 60;

// How many px beyond the viewport to keep rendered (pre-fetch buffer).
const OVERSCAN = 1500;

// ─── Internal Types ───────────────────────────────────────────────────────────

interface ColumnItem<T> {
  item: T;
  originalIndex: number;
  topY: number;    // absolute Y within the column (0-based from column top)
  height: number;  // card height in px  (gap is NOT included — it's in the topY spacing)
}

interface SlotState {
  colItemIdx: number; // index into the column's ColumnItem array;  -1 = parked off-screen
  top: number;        // absolute Y to position this slot at (= its item's topY)
  height: number;     // the card height this slot should render
  itemId?: string | number; // unique ID of item assigned to this slot
}

function getItemId<T>(item: ColumnItem<T> | undefined): string | number | undefined {
  if (!item || item.item == null) return undefined;
  const raw: any = item.item;
  if (raw.id !== undefined && raw.id !== null) return raw.id;
  if (raw.uri) return raw.uri;
  if (raw.r2Url) return raw.r2Url;
  return item.originalIndex;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface MasonryFlashListProps<T = any> {
  data: T[];
  numColumns?: number;
  renderItem: (info: { item: T; index: number; isColumn0: boolean }) => React.ReactElement;
  keyExtractor?: (item: T, index: number) => string;
  renderHeroCover?: () => React.ReactElement | null;
  renderStickyHeader?: () => React.ReactElement | null;
  ListFooterComponent?: React.ReactNode | (() => React.ReactElement | null);
  /** The parent's Reanimated scroll handler — passed directly to Animated.ScrollView */
  onScroll?: any;
  scrollEventThrottle?: number;
  /** Parent's scrollY SharedValue — MasonryFlashList reacts to this for slot recycling */
  scrollSharedValue?: SharedValue<number>;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  mainScrollRef?: any;
  contentContainerStyle?: any;
}

// ─── Layout computation ───────────────────────────────────────────────────────

function buildColumns<T>(data: T[]): {
  column0: ColumnItem<T>[];
  column1: ColumnItem<T>[];
  col0Height: number;
  col1Height: number;
} {
  const col0: ColumnItem<T>[] = [];
  const col1: ColumnItem<T>[] = [];
  let y0 = 0;
  let y1 = 0;

  data.forEach((item: any, idx: number) => {
    // Determine card height from real EXIF dimensions or aspectRatio field.
    // Height is purely a function of the photo's own data — never its array position.
    const cachedAspect = getPhotoAspect(item?.id) || getPhotoAspect(item?.uri) || getPhotoAspect(item?.r2Url);
    const w = Number(item?.width) || Number(item?.img_width) || Number(item?.imageWidth) || Number(item?.meta?.width) || Number(item?.metadata?.width) || Number(item?.exif?.PixelXDimension) || Number(item?.exif?.ImageWidth) || 0;
    const h = Number(item?.height) || Number(item?.img_height) || Number(item?.imageHeight) || Number(item?.meta?.height) || Number(item?.metadata?.height) || Number(item?.exif?.PixelYDimension) || Number(item?.exif?.ImageHeight) || 0;
    const realAspect =
      cachedAspect ||
      (w > 0 && h > 0
        ? w / h
        : (Number(item?.aspectRatio) > 0 ? Number(item.aspectRatio) : (Number(item?.aspect_ratio) > 0 ? Number(item.aspect_ratio) : null)));


    let cardHeight: number;
    if (realAspect && realAspect > 0) {
      // Use the actual aspect ratio (works for both landscape and portrait)
      cardHeight = Math.round(COL_WIDTH / realAspect);
    } else {
      // No dimensions available — use a fixed portrait default (4:5).
      // A STABLE constant ensures the same photo always gets the same height
      // regardless of its position in the array (unlike idx % 3).
      cardHeight = Math.round(COL_WIDTH / (4 / 5));
    }
    // Clamp to prevent extreme cases (e.g. 360° panoramas)
    cardHeight = Math.max(80, Math.min(600, cardHeight));

    // Waterfall: always place next card in the shorter column
    if (y0 <= y1) {
      col0.push({ item, originalIndex: idx, topY: y0, height: cardHeight });
      y0 += cardHeight + CARD_GAP;
    } else {
      col1.push({ item, originalIndex: idx, topY: y1, height: cardHeight });
      y1 += cardHeight + CARD_GAP;
    }
  });

  return { column0: col0, column1: col1, col0Height: y0, col1Height: y1 };
}

// ─── Slot assignment ────────────────────────────────────────────────────────────────
// KEY PROPERTIES:
// 1. We never reassign a slot whose current item is still visible AND HAS THE SAME ITEM ID.
// 2. When data changes (e.g. skeletons -> real photos), slot item IDs mismatch and are cleanly recycled.
// 3. We preserve slot OBJECT REFERENCES when values haven’t changed so React.memo bails out.

function assignSlots<T>(
  items: ColumnItem<T>[],
  scrollY: number,
  prevSlots: SlotState[],
  poolSize: number,
  headerHeight: number = 0,
): SlotState[] {
  // Translate ScrollView scroll position to Grid Y coordinates
  const gridScrollY = Math.max(0, scrollY - headerHeight);
  const minY = gridScrollY - OVERSCAN;
  const maxY = gridScrollY + SCREEN_HEIGHT + OVERSCAN;

  // 1. Find all visible item indices inside the overscan range
  const visibleSet = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const { topY, height } = items[i];
    if (topY + height >= minY && topY <= maxY) {
      visibleSet.add(i);
    }
  }

  // 2. Walk current slots:
  //    - Slots showing a still-visible item WITH THE SAME ITEM ID → KEEP as-is
  //    - Slots showing off-screen items OR replaced data → RECYCLE
  const next = prevSlots.slice();
  const occupied = new Set<number>();
  const free: number[] = [];

  for (let s = 0; s < next.length; s++) {
    const { colItemIdx, itemId } = next[s];
    if (
      colItemIdx >= 0 &&
      visibleSet.has(colItemIdx) &&
      getItemId(items[colItemIdx]) === itemId
    ) {
      occupied.add(colItemIdx);
      // Sync top and height if item position or layout height updated
      const currentItem = items[colItemIdx];
      if (next[s].top !== currentItem.topY || next[s].height !== currentItem.height) {
        next[s] = {
          colItemIdx,
          top: currentItem.topY,
          height: currentItem.height,
          itemId,
        };
      }
    } else {
      free.push(s);
    }
  }

  // 3. Collect unassigned items and SORT BY VIEWPORT CENTER PROXIMITY
  //    This guarantees on-screen items get slots FIRST before off-screen overscan items!
  const unassigned: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (visibleSet.has(i) && !occupied.has(i)) {
      unassigned.push(i);
    }
  }

  const viewportCenter = gridScrollY + SCREEN_HEIGHT / 2;
  unassigned.sort((a, b) => {
    const itemA = items[a];
    const itemB = items[b];
    const centerA = itemA.topY + itemA.height / 2;
    const centerB = itemB.topY + itemB.height / 2;
    return Math.abs(centerA - viewportCenter) - Math.abs(centerB - viewportCenter);
  });

  // 4. Assign free slots to unassigned items (on-screen center items get assigned FIRST)
  let fi = 0;
  for (const itemIdx of unassigned) {
    if (fi >= free.length) break;
    const slotIdx = free[fi++];
    const newItem = items[itemIdx];
    const newTop = newItem.topY;
    const newH   = newItem.height;
    const newId  = getItemId(newItem);
    const prev   = next[slotIdx];

    if (prev.colItemIdx !== itemIdx || prev.top !== newTop || prev.height !== newH || prev.itemId !== newId) {
      next[slotIdx] = { colItemIdx: itemIdx, top: newTop, height: newH, itemId: newId };
    }
  }

  // 5. Park remaining free slots off-screen
  while (fi < free.length) {
    const slotIdx = free[fi++];
    if (next[slotIdx].colItemIdx !== -1) {
      next[slotIdx] = { colItemIdx: -1, top: -30000, height: 0, itemId: undefined };
    }
  }

  // 6. Bail out if every slot reference is identical
  for (let s = 0; s < next.length; s++) {
    if (next[s] !== prevSlots[s]) return next;
  }
  return prevSlots;
}


// ─── Initial slot state (no scroll yet — show items near top) ─────────────────
// IMPORTANT: use Array.from (not Array.fill) so every slot gets its OWN object
// reference. Shared references break the reference-equality check in assignSlots.

function initialSlots<T>(items: ColumnItem<T>[], poolSize: number, headerHeight: number = 0): SlotState[] {
  const base: SlotState[] = Array.from({ length: poolSize }, (): SlotState => ({
    colItemIdx: -1,
    top: -30000,
    height: 0,
    itemId: undefined,
  }));
  return assignSlots(items, 0, base, poolSize, headerHeight);
}

// ─── SlotView — hides the 1-frame flash when a slot is recycled to a new item ──

interface SlotViewProps {
  slot: SlotState;
  item: any;
  originalIndex: number;
  isColumn0: boolean;
  renderItem: (info: { item: any; index: number; isColumn0: boolean }) => React.ReactElement;
}

const SlotView = React.memo(
  function SlotView({ slot, item, originalIndex, isColumn0, renderItem: renderFn }: SlotViewProps) {
    return (
      <View style={[styles.slot, { top: slot.top, height: slot.height }]}>
        {item ? renderFn({ item, index: originalIndex, isColumn0 }) : null}
      </View>
    );
  },
  (prev, next) =>
    prev.slot          === next.slot &&
    prev.item          === next.item &&
    prev.originalIndex === next.originalIndex &&
    prev.isColumn0     === next.isColumn0 &&
    prev.renderItem    === next.renderItem,
);

// ─── Component ────────────────────────────────────────────────────────────────

export function MasonryFlashList<T = any>({
  data,
  renderItem,
  keyExtractor,
  renderHeroCover,
  renderStickyHeader,
  ListFooterComponent,
  onScroll,
  scrollEventThrottle = 16,
  scrollSharedValue,
  onEndReached,
  onEndReachedThreshold = 0.8,
  mainScrollRef,
}: MasonryFlashListProps<T>) {

  // ─── Pre-compute all card positions (runs once per data change) ────────────
  const { column0, column1, col0Height, col1Height } = useMemo(
    () => buildColumns(data),
    [data],
  );

  // Always-fresh refs so the scroll worklet never has a stale closure
  const col0Ref    = useRef(column0);
  const col1Ref    = useRef(column1);
  // Plain ref for current scrollY — updated by updateSlotsFromY on the JS thread.
  // This avoids reading scrollSharedValue.value from the JS/React context
  // (which triggers Reanimated warnings and is unreliable outside worklets).
  const scrollYRef = useRef(0);

  // ─── Slot updates via SharedValue (no scroll handler interception) ─────────────
  // The parent's onScroll handler is passed directly to Animated.ScrollView below.
  // We watch scrollSharedValue (set by the parent) to know when to recycle slots.
  const lastUpdateRef      = useRef(0);
  const endReachedFiredRef = useRef(false);

  // Header height above grid (Hero cover ~70% screen height + Sticky tab bar ~50px)
  const headerHeight = useMemo(() => {
    return renderHeroCover ? Math.round(SCREEN_HEIGHT * 0.70) + 50 : 0;
  }, [renderHeroCover]);

  // ─── Recycling pool state ─────────────────────────────────────────────────
  const [slots0, setSlots0] = useState<SlotState[]>(() => initialSlots(column0, POOL_PER_COL, headerHeight));
  const [slots1, setSlots1] = useState<SlotState[]>(() => initialSlots(column1, POOL_PER_COL, headerHeight));

  // Sync refs and recompute slots whenever data/columns change.
  useEffect(() => {
    col0Ref.current = column0;
    col1Ref.current = column1;
    const y = scrollYRef.current;
    setSlots0(prev => assignSlots(column0, y, prev, POOL_PER_COL, headerHeight));
    setSlots1(prev => assignSlots(column1, y, prev, POOL_PER_COL, headerHeight));
  }, [column0, column1, headerHeight]);

  useEffect(() => {
    endReachedFiredRef.current = false;
  }, [data]);

  const updateSlotsFromY = useCallback((y: number) => {
    const now = Date.now();
    if (now - lastUpdateRef.current < 16) return; // 60fps cap
    lastUpdateRef.current = now;
    scrollYRef.current = y; // keep ref in sync for useEffect above
    setSlots0(prev => assignSlots(col0Ref.current, y, prev, POOL_PER_COL, headerHeight));
    setSlots1(prev => assignSlots(col1Ref.current, y, prev, POOL_PER_COL, headerHeight));

    // Trigger onEndReached when user scrolls within threshold of bottom
    const totalHeight = Math.max(col0Height, col1Height);
    if (onEndReached && !endReachedFiredRef.current && totalHeight > 0) {
      const thresholdY = totalHeight - SCREEN_HEIGHT * (1 + onEndReachedThreshold);
      if (y >= thresholdY) {
        endReachedFiredRef.current = true;
        onEndReached();
      }
    }
  }, [col0Height, col1Height, onEndReached, onEndReachedThreshold]);

  // React to scrollY shared value from parent — fires on UI thread, updates slots via runOnJS
  useAnimatedReaction(
    () => scrollSharedValue?.value ?? 0,
    (y) => {
      'worklet';
      runOnJS(updateSlotsFromY)(y);
    },
    [updateSlotsFromY],
  );

  // ─── Footer ───────────────────────────────────────────────────────────────
  const renderedFooter = useMemo(() => {
    if (!ListFooterComponent) return null;
    if (typeof ListFooterComponent === 'function') {
      return (ListFooterComponent as () => React.ReactElement | null)();
    }
    return ListFooterComponent as React.ReactNode;
  }, [ListFooterComponent]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Animated.ScrollView
      ref={mainScrollRef}
      onScroll={onScroll}
      scrollEventThrottle={scrollEventThrottle}
      showsVerticalScrollIndicator={false}
      stickyHeaderIndices={renderStickyHeader ? [1] : undefined}
      style={styles.scrollView}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Child 0: Hero cover — scrolls away naturally */}
      {renderHeroCover ? renderHeroCover() : null}

      {/* Child 1: Sticky tab header — pins to top of screen */}
      {renderStickyHeader ? renderStickyHeader() : null}

      {/* Child 2: Masonry grid
           Columns are in a normal flex row with EXPLICIT heights so the
           ScrollView correctly measures total content height for scrolling.
           Slots inside are absolutely positioned within each column. */}
      <View style={styles.gridRow}>

        {/* ── Left Column — POOL_PER_COL stable native Views ── */}
        <View style={[styles.colLeft, { height: col0Height }]}>
          {slots0.map((slot, sIdx) => {
            const colItem = slot.colItemIdx >= 0 ? column0[slot.colItemIdx] : null;
            return (
              <SlotView
                key={`c0-${sIdx}`}
                slot={slot}
                item={colItem?.item}
                originalIndex={colItem?.originalIndex ?? 0}
                isColumn0={true}
                renderItem={renderItem}
              />
            );
          })}
        </View>

        {/* ── Right Column — POOL_PER_COL stable native Views ── */}
        <View style={[styles.colRight, { height: col1Height }]}>
          {slots1.map((slot, sIdx) => {
            const colItem = slot.colItemIdx >= 0 ? column1[slot.colItemIdx] : null;
            return (
              <SlotView
                key={`c1-${sIdx}`}
                slot={slot}
                item={colItem?.item}
                originalIndex={colItem?.originalIndex ?? 0}
                isColumn0={false}
                renderItem={renderItem}
              />
            );
          })}
        </View>

      </View>

      {renderedFooter}
    </Animated.ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  contentContainer: {
    backgroundColor: '#ffffff',
    paddingBottom: 40,
  },
  // Two-column flex row — columns have explicit heights so ScrollView measures content correctly
  gridRow: {
    flexDirection: 'row',
    // 9px outer edge on each side, 6px gap between columns
    // marginLeft:9, colWidth, marginRight:6(gap), colWidth, marginRight:9
    // = 9 + COL_WIDTH + 6 + COL_WIDTH + 9 = 24 + 2*COL_WIDTH = SCREEN_WIDTH ✓
    marginLeft: 9,
    marginRight: 9,
    backgroundColor: '#ffffff',
  },
  // Left column: explicit width, height set inline as col0Height
  colLeft: {
    width: COL_WIDTH,
    marginRight: 6,           // the 6px gap between columns
    backgroundColor: '#ffffff',
    // position: 'relative' (default) — serves as positioning context for slots
  },
  // Right column: explicit width, height set inline as col1Height
  colRight: {
    width: COL_WIDTH,
    backgroundColor: '#ffffff',
    // position: 'relative' (default) — serves as positioning context for slots
  },
  // Each recycled slot: absolutely positioned within its column
  slot: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
});
