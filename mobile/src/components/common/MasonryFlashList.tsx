/**
 * MasonryFlashList — True View Recycling Masonry Grid with Apple & Google Photos Canvas Zoom
 *
 * Architecture:
 * - Dynamic column density (1 col: editorial feed, 2 cols: masonry, 3 cols: compact grid)
 * - Canvas Zoom Transition (Apple Photos & Google Photos pattern):
 *   - Real-Time GPU Pinch Zoom: During two-finger pinch, the entire grid scales continuously
 *     around the exact focal point between the user's fingertips (focalX, focalY).
 *   - Zero Criss-Crossing: The photos scale together as a unified visual canvas. No individual
 *     photos fly across or collide with each other.
 *   - Seamless Optical Hand-off:
 *     - At release, the old view scales smoothly to the matching ratio of the new column width
 *       while softly cross-fading into the new grid.
 *     - The anchor photo directly under the fingertips stays pinned at the exact same screen position.
 *   - Zero White Flash:
 *     - The base grid never unmounts or disappears. The freeze overlay seamlessly covers the transition.
 * - Lightweight View Recycling:
 *   - Maintains ~60–80 recycled native views in memory for lists of 10,000+ photos.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import Animated, {
  useAnimatedReaction,
  runOnJS,
  runOnUI,
  scrollTo,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { getPhotoCardAspect } from '../../utils/photoDimensionCache';
import { analyticsService } from '../../services/analyticsService';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Layout constants:
const HORIZONTAL_MARGIN = 9;
const CARD_GAP = 6;
const OVERSCAN = 800;

export const getPoolSizeForCols = (cols: number): number => {
  switch (cols) {
    case 1: return 32;
    case 2: return 38;
    case 3: return 44;
    case 4: return 50;
    case 5: default: return 54;
  }
};

// ─── Internal Types ───────────────────────────────────────────────────────────

export interface ColumnItem<T> {
  item: T;
  originalIndex: number;
  topY: number;
  height: number;
  colIndex: number;
}

export interface ColumnData<T> {
  items: ColumnItem<T>[];
  height: number;
}

export interface MasonryLayout<T> {
  numColumns: number;
  columns: ColumnData<T>[];
  maxHeight: number;
  colWidth: number;
  itemMap: Map<string | number, ColumnItem<T>>;
}

interface SlotState {
  colItemIdx: number;
  top: number;
  height: number;
  itemId?: string;
}

function getItemId<T>(item: ColumnItem<T> | undefined): string | undefined {
  if (!item || item.item == null) return undefined;
  const raw: any = item.item;
  if (raw.id !== undefined && raw.id !== null) return String(raw.id);
  if (raw.uri) return String(raw.uri);
  if (raw.r2Url) return String(raw.r2Url);
  return String(item.originalIndex);
}

export interface FreezeCardData<T> {
  id: string | number;
  item: T;
  originalIndex: number;
  colIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface MasonryFlashListProps<T = any> {
  data: T[];
  numColumns?: number;
  onNumColumnsChange?: (columns: number) => void;
  enablePinchToZoom?: boolean;
  minColumns?: number;
  maxColumns?: number;
  renderItem: (info: {
    item: T;
    index: number;
    isColumn0: boolean;
    columnIndex?: number;
    numColumns?: number;
  }) => React.ReactElement;
  keyExtractor?: (item: T, index: number) => string;
  renderHeroCover?: () => React.ReactElement | null;
  renderStickyHeader?: () => React.ReactElement | null;
  ListFooterComponent?: React.ReactNode | (() => React.ReactElement | null);
  onScroll?: any;
  scrollEventThrottle?: number;
  scrollSharedValue?: SharedValue<number>;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  mainScrollRef?: any;
  contentContainerStyle?: any;
  refreshControl?: any;
  isPinchingShared?: SharedValue<boolean>;
}

// ─── Dynamic Layout Computation ───────────────────────────────────────────────

export function buildMasonryLayout<T>(
  data: T[],
  numColumns: number = 2,
  screenWidth: number = SCREEN_WIDTH,
): MasonryLayout<T> {
  const safeCols = Math.max(1, Math.min(5, numColumns || 2));
  const totalGaps = CARD_GAP * Math.max(0, safeCols - 1);
  const colWidth = Math.max(30, Math.floor((screenWidth - (HORIZONTAL_MARGIN * 2) - totalGaps) / safeCols));

  const columns: ColumnData<T>[] = Array.from({ length: safeCols }, () => ({
    items: [],
    height: 0,
  }));
  const itemMap = new Map<string | number, ColumnItem<T>>();

  if (!data || !Array.isArray(data) || data.length === 0) {
    return { numColumns: safeCols, columns, maxHeight: 0, colWidth, itemMap };
  }

  data.forEach((item: any, idx: number) => {
    if (!item) return;

    let shortestCol = 0;
    for (let c = 1; c < safeCols; c++) {
      if (columns[c].height < columns[shortestCol].height) {
        shortestCol = c;
      }
    }

    const aspect = getPhotoCardAspect(item, idx, shortestCol, safeCols);
    const maxCardH = safeCols === 1 ? Math.round(SCREEN_HEIGHT * 0.72) : (safeCols >= 4 ? 300 : 600);
    const minCardH = safeCols === 1 ? 160 : (safeCols >= 4 ? 40 : (safeCols === 3 ? 60 : 80));
    const cardHeight = Math.max(minCardH, Math.min(maxCardH, Math.round(colWidth / (aspect || 0.75))));

    const topY = columns[shortestCol].height;
    const colItem: ColumnItem<T> = {
      item,
      originalIndex: idx,
      topY,
      height: cardHeight,
      colIndex: shortestCol,
    };

    columns[shortestCol].items.push(colItem);
    columns[shortestCol].height += cardHeight + CARD_GAP;

    const id = getItemId(colItem);
    if (id !== undefined) {
      itemMap.set(id, colItem);
    }
  });

  const maxHeight = Math.max(0, ...columns.map((c) => c.height));
  return { numColumns: safeCols, columns, maxHeight, colWidth, itemMap };
}

// ─── Slot Assignment ──────────────────────────────────────────────────────────

function assignSlots<T>(
  items: ColumnItem<T>[],
  scrollY: number,
  prevSlots: SlotState[],
  poolSize: number,
  headerHeight: number = 0,
): SlotState[] {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return prevSlots;
  }

  const safeScrollY = Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0;
  const safeHeader = Number.isFinite(headerHeight) ? Math.max(0, headerHeight) : 0;
  const gridScrollY = Math.max(0, safeScrollY - safeHeader);
  const minY = Math.max(0, gridScrollY - OVERSCAN);
  const maxY = gridScrollY + SCREEN_HEIGHT + OVERSCAN;
  const viewportCenter = gridScrollY + SCREEN_HEIGHT / 2;

  // 1. Gather all items in visible window, tracking which are directly on-screen:
  const visibleIndices: number[] = [];
  const onScreenIndices = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    const { topY, height } = items[i];
    if (topY + height >= minY && topY <= maxY) {
      visibleIndices.push(i);
      if (topY + height >= gridScrollY && topY <= gridScrollY + SCREEN_HEIGHT) {
        onScreenIndices.add(i);
      }
    }
  }

  const visibleSet = new Set<number>(visibleIndices);

  // 2. Clone previous slots, ensuring length equals poolSize:
  const next: SlotState[] = prevSlots.slice(0, poolSize);
  while (next.length < poolSize) {
    next.push({ colItemIdx: -1, top: -30000, height: 0, itemId: undefined });
  }

  const occupied = new Set<number>();
  const freeSlotIndices: number[] = [];

  for (let s = 0; s < next.length; s++) {
    const slot = next[s];
    const { colItemIdx, itemId } = slot;
    if (
      colItemIdx >= 0 &&
      colItemIdx < items.length &&
      visibleSet.has(colItemIdx) &&
      String(getItemId(items[colItemIdx])) === String(itemId)
    ) {
      occupied.add(colItemIdx);
      const currentItem = items[colItemIdx];
      if (slot.top !== currentItem.topY || slot.height !== currentItem.height) {
        next[s] = {
          colItemIdx,
          top: currentItem.topY,
          height: currentItem.height,
          itemId: String(itemId),
        };
      }
    } else {
      freeSlotIndices.push(s);
    }
  }

  // 3. Find unassigned visible items:
  const unassigned: number[] = [];
  for (const idx of visibleIndices) {
    if (!occupied.has(idx)) {
      unassigned.push(idx);
    }
  }

  // Sort unassigned: items directly on screen come first, then sort by proximity to viewport center
  unassigned.sort((a, b) => {
    const aOnScreen = onScreenIndices.has(a);
    const bOnScreen = onScreenIndices.has(b);
    if (aOnScreen && !bOnScreen) return -1;
    if (!aOnScreen && bOnScreen) return 1;

    const itemA = items[a];
    const itemB = items[b];
    const centerA = itemA.topY + itemA.height / 2;
    const centerB = itemB.topY + itemB.height / 2;
    return Math.abs(centerA - viewportCenter) - Math.abs(centerB - viewportCenter);
  });

  // 4. Assign free slots to unassigned items:
  let fi = 0;
  for (const itemIdx of unassigned) {
    if (fi >= freeSlotIndices.length) break;
    const slotIdx = freeSlotIndices[fi++];
    const newItem = items[itemIdx];
    const newTop = newItem.topY;
    const newH   = newItem.height;
    const newId  = String(getItemId(newItem) ?? itemIdx);
    const prev   = next[slotIdx];

    if (prev.colItemIdx !== itemIdx || prev.top !== newTop || prev.height !== newH || String(prev.itemId) !== newId) {
      next[slotIdx] = { colItemIdx: itemIdx, top: newTop, height: newH, itemId: newId };
    }
  }

  // Park any leftover free slots off-screen:
  while (fi < freeSlotIndices.length) {
    const slotIdx = freeSlotIndices[fi++];
    if (next[slotIdx].colItemIdx !== -1) {
      next[slotIdx] = { colItemIdx: -1, top: -30000, height: 0, itemId: undefined };
    }
  }

  // Return unchanged reference if no slot modified:
  if (prevSlots.length === next.length) {
    let hasDiff = false;
    for (let s = 0; s < next.length; s++) {
      if (next[s] !== prevSlots[s]) {
        hasDiff = true;
        break;
      }
    }
    if (!hasDiff) return prevSlots;
  }

  return next;
}

function computeAllColumnSlots<T>(
  layout: MasonryLayout<T>,
  scrollY: number,
  poolSize: number,
  headerHeight: number,
  prevAllSlots?: SlotState[][],
): SlotState[][] {
  if (!layout || !layout.columns) return [];
  return layout.columns.map((col, cIdx) => {
    const prevColSlots = (prevAllSlots && prevAllSlots[cIdx]) || [];
    const base: SlotState[] = prevColSlots.length === poolSize
      ? prevColSlots
      : Array.from({ length: poolSize }, (_, i): SlotState => (
          prevColSlots[i] || { colItemIdx: -1, top: -30000, height: 0, itemId: undefined }
        ));
    return assignSlots(col.items, scrollY, base, poolSize, headerHeight);
  });
}

// ─── Apple Photos Focal-Point Touch Anchor ────────────────────────────────────

function findFocalAnchorItem<T>(
  layout: MasonryLayout<T>,
  currentScrollY: number,
  headerHeight: number,
  focalX: number,
  screenFocalY: number,
): ColumnItem<T> | null {
  if (!layout || !layout.columns || layout.columns.length === 0) return null;

  const contentX = focalX - HORIZONTAL_MARGIN;
  const contentY = currentScrollY + screenFocalY - headerHeight;

  if (contentY < 0) {
    return null; // Finger touch is above photos in the header area
  }

  // 1. Check column closest to contentX:
  const colW = layout.colWidth;
  const gap = CARD_GAP;
  const cIdx = Math.max(0, Math.min(layout.columns.length - 1, Math.floor(contentX / (colW + gap))));

  const col = layout.columns[cIdx];
  if (col && col.items && col.items.length > 0) {
    for (let i = 0; i < col.items.length; i++) {
      const it = col.items[i];
      if (contentY >= it.topY && contentY <= it.topY + it.height + gap) {
        return it;
      }
    }
  }

  // 2. Fallback: find item in any column with center closest to (focalX, contentY):
  let bestItem: ColumnItem<T> | null = null;
  let bestDist = Infinity;

  for (let c = 0; c < layout.columns.length; c++) {
    const column = layout.columns[c];
    if (!column || !column.items) continue;
    const colCenterX = HORIZONTAL_MARGIN + c * (colW + gap) + colW / 2;

    for (let i = 0; i < column.items.length; i++) {
      const it = column.items[i];
      const itCenterY = it.topY + it.height / 2;
      const dx = colCenterX - focalX;
      const dy = itCenterY - contentY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestItem = it;
      }
    }
  }

  return bestItem;
}

function computeFocalAnchoredScrollY<T>(
  currentScrollY: number,
  headerHeight: number,
  screenHeight: number,
  focalX: number,
  screenFocalY: number,
  currentLayout: MasonryLayout<T>,
  targetLayout: MasonryLayout<T>,
): number {
  const safeScrollY = Number.isFinite(currentScrollY) ? Math.max(0, currentScrollY) : 0;
  const safeHeader = Number.isFinite(headerHeight) ? Math.max(0, headerHeight) : 0;
  const safeScreenH = Number.isFinite(screenHeight) ? screenHeight : SCREEN_HEIGHT;
  const safeFocalX = Number.isFinite(focalX) ? focalX : SCREEN_WIDTH / 2;
  const safeFocalY = Number.isFinite(screenFocalY) ? screenFocalY : SCREEN_HEIGHT / 2;

  if (!currentLayout || !targetLayout) return safeScrollY;

  const contentY = safeScrollY + safeFocalY - safeHeader;
  if (contentY < 0) {
    return safeScrollY;
  }

  const anchorItem = findFocalAnchorItem(currentLayout, safeScrollY, safeHeader, safeFocalX, safeFocalY);
  if (!anchorItem) {
    return safeScrollY;
  }

  // Anchor item's center Y in current layout:
  const anchorItemCenterY = anchorItem.topY + anchorItem.height / 2;
  // Its exact screen Y coordinate:
  const anchorItemScreenY = safeHeader + anchorItemCenterY - safeScrollY;

  // Find same item in target layout:
  const itemId = getItemId(anchorItem);
  let targetItem: ColumnItem<T> | undefined;

  if (itemId !== undefined) {
    targetItem = targetLayout.itemMap.get(itemId);
  }
  if (!targetItem) {
    for (let c = 0; c < targetLayout.columns.length; c++) {
      const col = targetLayout.columns[c];
      if (!col || !col.items) continue;
      const found = col.items.find((it) => it.originalIndex === anchorItem.originalIndex);
      if (found) {
        targetItem = found;
        break;
      }
    }
  }

  if (!targetItem) {
    return safeScrollY;
  }

  // Align targetItem so its center lands at the EXACT SAME anchorItemScreenY:
  const targetItemCenterY = targetItem.topY + targetItem.height / 2;
  const desiredScrollY = safeHeader + targetItemCenterY - anchorItemScreenY;
  const maxScroll = Math.max(0, targetLayout.maxHeight + safeHeader - safeScreenH);

  const finalScrollY = Math.max(0, Math.min(maxScroll, Math.round(desiredScrollY)));
  return Number.isFinite(finalScrollY) ? finalScrollY : safeScrollY;
}

// ─── Apple Photos Canvas Zoom Freeze Snapshot Builder ─────────────────────────

function buildFreezeCards<T>(
  layout: MasonryLayout<T>,
  scrollY: number,
  headerHeight: number,
): FreezeCardData<T>[] {
  const cards: FreezeCardData<T>[] = [];
  const screenMinY = -50;
  const screenMaxY = SCREEN_HEIGHT + 50;

  for (let c = 0; c < layout.columns.length; c++) {
    const col = layout.columns[c];
    if (!col || !col.items) continue;
    const colLeft = HORIZONTAL_MARGIN + c * (layout.colWidth + CARD_GAP);

    for (let i = 0; i < col.items.length; i++) {
      const it = col.items[i];
      const screenY = headerHeight + it.topY - scrollY;
      if (screenY + it.height >= screenMinY && screenY <= screenMaxY) {
        cards.push({
          id: getItemId(it) ?? `${c}-${i}`,
          item: it.item,
          originalIndex: it.originalIndex,
          colIndex: c,
          x: colLeft,
          y: screenY,
          w: layout.colWidth,
          h: it.height,
        });
      }
    }
  }

  return cards;
}

// ─── Canvas Zoom Freeze Overlay Component ─────────────────────────────────────

interface FreezeOverlayProps {
  cards: FreezeCardData<any>[];
  scale: SharedValue<number>;
  opacity: SharedValue<number>;
  focalX: SharedValue<number>;
  focalY: SharedValue<number>;
  numColumns: number;
  renderItem: (info: {
    item: any;
    index: number;
    isColumn0: boolean;
    columnIndex?: number;
    numColumns?: number;
  }) => React.ReactElement;
  renderStickyHeader?: () => React.ReactElement | null;
  isScrolledPastHero: boolean;
}

const FreezeOverlay = React.memo(function FreezeOverlay({
  cards,
  scale,
  opacity,
  focalX,
  focalY,
  numColumns,
  renderItem: renderFn,
  renderStickyHeader,
  isScrolledPastHero,
}: FreezeOverlayProps) {
  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    const s = scale.value;
    const fx = focalX.value;
    const fy = focalY.value;
    const tx = (1 - s) * (fx - SCREEN_WIDTH / 2);
    const ty = (1 - s) * (fy - SCREEN_HEIGHT / 2);

    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { scale: s },
      ],
      opacity: opacity.value,
    };
  });

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        { overflow: 'hidden' },
        animatedStyle,
      ]}
      pointerEvents="none"
    >
      {cards.map((card) => (
        <View
          key={`freeze-${card.id}`}
          style={{
            position: 'absolute',
            left: card.x,
            top: card.y,
            width: card.w,
            height: card.h,
            overflow: 'hidden',
          }}
        >
          {renderFn({
            item: card.item,
            index: card.originalIndex,
            isColumn0: card.colIndex === 0,
            columnIndex: card.colIndex,
            numColumns,
          })}
        </View>
      ))}

      {renderStickyHeader && isScrolledPastHero ? (
        <View style={styles.stickyHeaderOverlay} pointerEvents="none">
          {renderStickyHeader()}
        </View>
      ) : null}
    </Animated.View>
  );
});

// ─── SlotView ─────────────────────────────────────────────────────────────────

interface SlotViewProps {
  slot: SlotState;
  item: any;
  originalIndex: number;
  isColumn0: boolean;
  columnIndex: number;
  numColumns: number;
  renderItem: (info: {
    item: any;
    index: number;
    isColumn0: boolean;
    columnIndex?: number;
    numColumns?: number;
  }) => React.ReactElement;
}

const SlotView = React.memo(
  function SlotView({
    slot,
    item,
    originalIndex,
    isColumn0,
    columnIndex,
    numColumns,
    renderItem: renderFn,
  }: SlotViewProps) {
    return (
      <View style={[styles.slot, { top: slot.top, height: slot.height }]}>
        {item
          ? renderFn({
              item,
              index: originalIndex,
              isColumn0,
              columnIndex,
              numColumns,
            })
          : null}
      </View>
    );
  },
  (prev, next) =>
    prev.slot === next.slot &&
    prev.item === next.item &&
    prev.originalIndex === next.originalIndex &&
    prev.isColumn0 === next.isColumn0 &&
    prev.columnIndex === next.columnIndex &&
    prev.numColumns === next.numColumns &&
    prev.renderItem === next.renderItem,
);

// ─── Main Component ───────────────────────────────────────────────────────────

export function MasonryFlashList<T = any>({
  data,
  numColumns: numColumnsProp = 2,
  onNumColumnsChange,
  enablePinchToZoom = true,
  minColumns = 1,
  maxColumns = 5,
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
  refreshControl,
  isPinchingShared,
}: MasonryFlashListProps<T>) {
  // ─── Canvas Zoom Shared Values ─────────────────────────────────────────────
  const canvasScale = useSharedValue(1);
  const overlayScale = useSharedValue(1);
  const overlayOpacity = useSharedValue(1);
  const focalXShared = useSharedValue(SCREEN_WIDTH / 2);
  const focalYShared = useSharedValue(SCREEN_HEIGHT / 2);
  const isPinching = useSharedValue(false);
  const currentColsShared = useSharedValue(numColumnsProp || 2);

  // ─── Component State ───────────────────────────────────────────────────────
  const [currentCols, setCurrentCols] = useState<number>(() => {
    return Math.max(minColumns, Math.min(maxColumns, numColumnsProp || 2));
  });

  const [isPinchingState, setIsPinchingState] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [freezeCards, setFreezeCards] = useState<FreezeCardData<T>[] | null>(null);
  const [freezeCols, setFreezeCols] = useState(currentCols);

  useEffect(() => {
    currentColsShared.value = currentCols;
  }, [currentCols, currentColsShared]);

  useEffect(() => {
    if (typeof numColumnsProp === 'number' && numColumnsProp !== currentCols && !isTransitioning) {
      const clamped = Math.max(minColumns, Math.min(maxColumns, numColumnsProp));
      setCurrentCols(clamped);
    }
  }, [numColumnsProp, minColumns, maxColumns, currentCols, isTransitioning]);

  const poolSize = useMemo(() => {
    return getPoolSizeForCols(currentCols);
  }, [currentCols]);

  const [measuredHeroHeight, setMeasuredHeroHeight] = useState<number>(() => {
    return renderHeroCover ? Math.round(SCREEN_HEIGHT * 0.70) : 0;
  });
  const [measuredStickyHeight, setMeasuredStickyHeight] = useState<number>(() => {
    return renderStickyHeader ? 107 : 0;
  });
  const heroHeightRef = useRef(measuredHeroHeight);
  const stickyHeightRef = useRef(measuredStickyHeight);

  const headerHeight = useMemo(() => {
    return (renderHeroCover ? measuredHeroHeight : 0) + (renderStickyHeader ? measuredStickyHeight : 0);
  }, [renderHeroCover, renderStickyHeader, measuredHeroHeight, measuredStickyHeight]);
  const headerHeightRef = useRef(headerHeight);
  headerHeightRef.current = headerHeight;
  const headerHeightShared = useSharedValue(headerHeight);
  useEffect(() => {
    headerHeightShared.value = headerHeight;
  }, [headerHeight, headerHeightShared]);

  const layout = useMemo(
    () => buildMasonryLayout(data, currentCols, SCREEN_WIDTH),
    [data, currentCols],
  );

  const layoutRef = useRef(layout);
  const dataRef = useRef(data);
  const scrollYRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const lastImpressionCheckRef = useRef(0);
  const endReachedFiredRef = useRef(false);
  const isTransitioningRef = useRef(false);

  const [columnSlots, setColumnSlots] = useState<SlotState[][]>(() => {
    return computeAllColumnSlots(layout, 0, poolSize, headerHeight);
  });
  const columnSlotsRef = useRef(columnSlots);

  useEffect(() => {
    layoutRef.current = layout;
    dataRef.current = data;
    if (isTransitioningRef.current) return;
    const y = scrollYRef.current;
    const newSlots = computeAllColumnSlots(layout, y, poolSize, headerHeight, columnSlotsRef.current);
    setColumnSlots(newSlots);
    columnSlotsRef.current = newSlots;
  }, [layout, poolSize, headerHeight, data]);

  useEffect(() => {
    endReachedFiredRef.current = false;
  }, [data]);

  // ─── Slot Updates from Scroll Worklet ──────────────────────────────────────
  const updateSlotsFromY = useCallback((y: number) => {
    if (isPinchingState || isTransitioning) return;

    const now = Date.now();
    if (now - lastUpdateRef.current < 16) return;
    lastUpdateRef.current = now;
    scrollYRef.current = y;

    const currentLayout = layoutRef.current;
    if (!currentLayout || !currentLayout.columns) return;

    setColumnSlots((prev) => {
      let anyChanged = false;
      const next = currentLayout.columns.map((col, cIdx) => {
        const prevSlots = (prev && prev[cIdx]) || [];
        const updated = assignSlots(col.items, y, prevSlots, poolSize, headerHeight);
        if (updated !== prevSlots) anyChanged = true;
        return updated;
      });
      if (anyChanged) columnSlotsRef.current = next;
      return anyChanged ? next : prev;
    });

    // Batch track visible impressions
    if (now - lastImpressionCheckRef.current > 600) {
      lastImpressionCheckRef.current = now;
      const gridY = Math.max(0, y - headerHeight);
      const viewTop = gridY;
      const viewBottom = gridY + SCREEN_HEIGHT;

      for (let c = 0; c < currentLayout.columns.length; c++) {
        const items = currentLayout.columns[c].items;
        if (!items) continue;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.topY + it.height >= viewTop && it.topY <= viewBottom) {
            const rawItem: any = it.item;
            if (rawItem && !rawItem.isSkeleton) {
              const mediaId = rawItem.id || rawItem.uri || rawItem.r2Url;
              const isVideo = Boolean(rawItem.isVideo || rawItem.type === 'VIDEO' || rawItem.tab === 'Cinema' || rawItem.videoUrl);
              const mediaType = isVideo ? 'VIDEO' : 'PHOTO';
              const url = rawItem.r2Url || rawItem.fullUri || rawItem.uri || rawItem.photoUrl;
              analyticsService.trackImpression(mediaId, mediaType, 'GRID', url);
            }
          }
        }
      }
    }

    // Trigger onEndReached
    const totalHeight = currentLayout.maxHeight;
    if (onEndReached && !endReachedFiredRef.current && totalHeight > 0) {
      const thresholdY = totalHeight - SCREEN_HEIGHT * (1 + onEndReachedThreshold);
      if (y >= thresholdY) {
        endReachedFiredRef.current = true;
        onEndReached();
      }
    }
  }, [headerHeight, onEndReached, onEndReachedThreshold, poolSize, isPinchingState, isTransitioning]);

  useAnimatedReaction(
    () => scrollSharedValue?.value ?? 0,
    (y) => {
      'worklet';
      if (!isPinching.value && !isTransitioning) {
        runOnJS(updateSlotsFromY)(y);
      }
    },
    [updateSlotsFromY, isTransitioning],
  );

  // ─── Native Scroll Dispatcher ──────────────────────────────────────────────
  const performScrollTo = useCallback((targetY: number) => {
    if (!Number.isFinite(targetY)) return;
    const safeY = Math.max(0, Math.round(targetY));
    scrollYRef.current = safeY;
    if (scrollSharedValue) {
      scrollSharedValue.value = safeY;
    }
    try {
      if (mainScrollRef?.current) {
        if (typeof (mainScrollRef.current as any).scrollTo === 'function') {
          (mainScrollRef.current as any).scrollTo({ y: safeY, animated: false });
        } else if (typeof (mainScrollRef.current as any).scrollToOffset === 'function') {
          (mainScrollRef.current as any).scrollToOffset({ offset: safeY, animated: false });
        } else {
          runOnUI((y: number) => {
            'worklet';
            scrollTo(mainScrollRef, 0, y, false);
          })(safeY);
        }
      } else {
        runOnUI((y: number) => {
          'worklet';
          scrollTo(mainScrollRef, 0, y, false);
        })(safeY);
      }
    } catch (_e) {
      try {
        runOnUI((y: number) => {
          'worklet';
          scrollTo(mainScrollRef, 0, y, false);
        })(safeY);
      } catch (_e2) {}
    }
  }, [mainScrollRef, scrollSharedValue]);

  // ─── Apple Photos Canvas Zoom Commit Transition ───────────────────────────
  const finalizeTransition = useCallback(() => {
    setFreezeCards(null);
    setIsTransitioning(false);
    isTransitioningRef.current = false;
    setIsPinchingState(false);
    canvasScale.value = 1.0;
    overlayScale.value = 1.0;
    overlayOpacity.value = 1.0;

    // Force-recompute active slots at the settled scroll position to guarantee cards are painted:
    const curLayout = layoutRef.current;
    if (curLayout && curLayout.columns && curLayout.columns.length > 0) {
      const y = scrollYRef.current;
      const pool = getPoolSizeForCols(curLayout.numColumns);
      const h = headerHeightRef.current;
      const slots = computeAllColumnSlots(curLayout, y, pool, h, columnSlotsRef.current);
      setColumnSlots(slots);
      columnSlotsRef.current = slots;
    }
  }, [canvasScale, overlayScale, overlayOpacity]);

  const startCommitTransition = useCallback((
    targetCols: number,
    focalX: number,
    focalY: number,
    targetRatio: number,
  ) => {
    const currentScrollY = scrollSharedValue ? scrollSharedValue.value : scrollYRef.current;
    const currentHeaderHeight = headerHeightRef.current;
    const currentLayout = layoutRef.current;
    const targetLayout = buildMasonryLayout(dataRef.current, targetCols, SCREEN_WIDTH);
    const targetPool = getPoolSizeForCols(targetCols);

    // Compute scroll offset for targetLayout to keep focal photo anchored
    const targetScrollY = computeFocalAnchoredScrollY(
      currentScrollY,
      currentHeaderHeight,
      SCREEN_HEIGHT,
      focalX,
      focalY,
      currentLayout,
      targetLayout,
    );

    const targetSlots = computeAllColumnSlots(
      targetLayout,
      targetScrollY,
      targetPool,
      currentHeaderHeight,
    );

    // 1. Freeze current visible cards on screen
    const cards = buildFreezeCards(currentLayout, currentScrollY, currentHeaderHeight);
    setFreezeCards(cards);
    setFreezeCols(currentCols);
    setIsTransitioning(true);
    isTransitioningRef.current = true;

    // 2. Immediately switch underlying base grid to new columns and scroll offset:
    performScrollTo(targetScrollY);
    setCurrentCols(targetCols);
    currentColsShared.value = targetCols;
    setColumnSlots(targetSlots);
    columnSlotsRef.current = targetSlots;
    layoutRef.current = targetLayout;
    onNumColumnsChange?.(targetCols);

    // 3. Reset viewport scale back to 1.0 (FreezeOverlay carries the scaled view on top)
    overlayScale.value = canvasScale.value;
    overlayOpacity.value = 1.0;
    canvasScale.value = 1.0;

    // 4. Smoothly animate freeze overlay to target ratio while cross-fading out:
    overlayScale.value = withTiming(targetRatio, {
      duration: 220,
      easing: Easing.bezier(0.25, 1, 0.5, 1),
    });
    overlayOpacity.value = withTiming(0, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    }, () => {
      runOnJS(finalizeTransition)();
    });

    // Safety fallback: ensure transition ALWAYS finalizes even if Reanimated callback drops:
    setTimeout(() => {
      finalizeTransition();
    }, 280);
  }, [
    performScrollTo,
    onNumColumnsChange,
    currentCols,
    scrollSharedValue,
    finalizeTransition,
    canvasScale,
    overlayScale,
    overlayOpacity,
    currentColsShared,
  ]);

  // ─── Real-Time GPU Canvas Zoom Pinch Gesture ────────────────────────────────
  const pinchGesture = useMemo(() => {
    return Gesture.Pinch()
      .cancelsTouchesInView(true)
      .enabled(enablePinchToZoom && !isTransitioning)
      .onStart((e) => {
        'worklet';
        isPinching.value = true;
        if (isPinchingShared) isPinchingShared.value = true;
        focalXShared.value = e.focalX;
        focalYShared.value = e.focalY;
        canvasScale.value = 1.0;
        runOnJS(setIsPinchingState)(true);
      })
      .onUpdate((e) => {
        'worklet';
        focalXShared.value = e.focalX;
        focalYShared.value = e.focalY;

        const cols = currentColsShared.value;
        let s = e.scale;
        // Rubber-band resistance if pinching beyond boundaries:
        if (cols >= maxColumns && s < 1.0) {
          s = 1.0 - (1.0 - s) * 0.35;
        } else if (cols <= minColumns && s > 1.0) {
          s = 1.0 + (s - 1.0) * 0.35;
        }

        canvasScale.value = Math.max(0.55, Math.min(1.85, s));
      })
      .onEnd((_e) => {
        'worklet';
        isPinching.value = false;
        if (isPinchingShared) isPinchingShared.value = false;

        const curScale = canvasScale.value;
        const cols = currentColsShared.value;
        const fx = focalXShared.value;
        const fy = focalYShared.value;

        // Scale < 0.88 -> Zoom Out (increase columns, e.g. 2 -> 3)
        // Scale > 1.15 -> Zoom In (decrease columns, e.g. 3 -> 2)
        if (curScale < 0.88 && cols < maxColumns) {
          const targetCols = cols + 1;
          const targetRatio = cols / targetCols;
          runOnJS(startCommitTransition)(targetCols, fx, fy, targetRatio);
        } else if (curScale > 1.15 && cols > minColumns) {
          const targetCols = cols - 1;
          const targetRatio = cols / targetCols;
          runOnJS(startCommitTransition)(targetCols, fx, fy, targetRatio);
        } else {
          // Cancelled pinch: spring back smoothly to 1.0
          canvasScale.value = withSpring(1.0, { damping: 22, stiffness: 260 }, () => {
            runOnJS(setIsPinchingState)(false);
          });
        }
      })
      .onFinalize(() => {
        'worklet';
        isPinching.value = false;
        if (isPinchingShared) isPinchingShared.value = false;
        runOnJS(setIsPinchingState)(false);
      });
  }, [
    enablePinchToZoom,
    isTransitioning,
    isPinchingShared,
    isPinching,
    focalXShared,
    focalYShared,
    canvasScale,
    currentColsShared,
    maxColumns,
    minColumns,
    startCommitTransition,
  ]);

  const viewportAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    const s = canvasScale.value;
    if (!isPinching.value && s === 1) {
      return {
        transform: [{ scale: 1 }],
      };
    }

    const fx = focalXShared.value;
    const fy = focalYShared.value;
    const tx = (1 - s) * (fx - SCREEN_WIDTH / 2);
    const ty = (1 - s) * (fy - SCREEN_HEIGHT / 2);

    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { scale: s },
      ],
    };
  });

  const renderedFooter = useMemo(() => {
    if (!ListFooterComponent) return null;
    if (typeof ListFooterComponent === 'function') {
      return (ListFooterComponent as () => React.ReactElement | null)();
    }
    return ListFooterComponent as React.ReactNode;
  }, [ListFooterComponent]);

  const isScrolledPastHero = !renderHeroCover || scrollYRef.current >= heroHeightRef.current;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <GestureDetector gesture={pinchGesture}>
        <Animated.View style={[styles.viewport, viewportAnimatedStyle]}>
          <Animated.ScrollView
            ref={mainScrollRef}
            onScroll={onScroll}
            scrollEventThrottle={scrollEventThrottle}
            showsVerticalScrollIndicator={false}
            scrollEnabled={!isPinchingState && !isTransitioning}
            stickyHeaderIndices={renderStickyHeader ? [1] : undefined}
            style={styles.scrollView}
            contentContainerStyle={styles.contentContainer}
            refreshControl={refreshControl}
          >
            {/* Child 0: Hero cover */}
            {renderHeroCover ? (
              <View
                onLayout={(e) => {
                  const h = Math.round(e.nativeEvent.layout.height);
                  if (h > 0 && Math.abs(h - heroHeightRef.current) > 2) {
                    heroHeightRef.current = h;
                    setMeasuredHeroHeight(h);
                  }
                }}
              >
                {renderHeroCover()}
              </View>
            ) : null}

            {/* Child 1: Sticky tab header */}
            {renderStickyHeader ? (
              <View
                onLayout={(e) => {
                  const h = Math.round(e.nativeEvent.layout.height);
                  if (h > 0 && Math.abs(h - stickyHeightRef.current) > 2) {
                    stickyHeightRef.current = h;
                    setMeasuredStickyHeight(h);
                  }
                }}
              >
                {renderStickyHeader()}
              </View>
            ) : null}

            {/* Child 2: Base Recycled Masonry Grid */}
            <View style={styles.gridRow}>
              {layout.columns.map((col, colIdx) => {
                const isLastCol = colIdx === layout.columns.length - 1;
                const slots = columnSlots[colIdx] || [];

                return (
                  <View
                    key={`col-${colIdx}`}
                    style={[
                      styles.column,
                      {
                        width: layout.colWidth,
                        height: col.height,
                        marginRight: isLastCol ? 0 : CARD_GAP,
                        overflow: 'hidden',
                      },
                    ]}
                  >
                    {slots.map((slot, sIdx) => {
                      const colItem =
                        slot.colItemIdx >= 0 && col.items && slot.colItemIdx < col.items.length
                          ? col.items[slot.colItemIdx]
                          : null;
                      return (
                        <SlotView
                          key={`slot-${colIdx}-${sIdx}`}
                          slot={slot}
                          item={colItem?.item}
                          originalIndex={colItem?.originalIndex ?? 0}
                          isColumn0={colIdx === 0}
                          columnIndex={colIdx}
                          numColumns={currentCols}
                          renderItem={renderItem}
                        />
                      );
                    })}
                  </View>
                );
              })}
            </View>

            {renderedFooter}
          </Animated.ScrollView>
        </Animated.View>
      </GestureDetector>

      {/* ─── Apple Photos Canvas Zoom Freeze Overlay ─────────────────────── */}
      {freezeCards && (
        <FreezeOverlay
          cards={freezeCards}
          scale={overlayScale}
          opacity={overlayOpacity}
          focalX={focalXShared}
          focalY={focalYShared}
          numColumns={freezeCols}
          renderItem={renderItem}
          renderStickyHeader={renderStickyHeader}
          isScrolledPastHero={isScrolledPastHero}
        />
      )}

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  contentContainer: {
    backgroundColor: '#ffffff',
    paddingBottom: 40,
  },
  gridRow: {
    flexDirection: 'row',
    marginLeft: HORIZONTAL_MARGIN,
    marginRight: HORIZONTAL_MARGIN,
    backgroundColor: '#ffffff',
  },
  column: {
    backgroundColor: '#ffffff',
  },
  slot: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  stickyHeaderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
  },
});
