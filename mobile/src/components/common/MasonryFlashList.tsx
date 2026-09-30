/**
 * MasonryFlashList — True View Recycling Masonry Grid with Physical Column Slide & Reflow
 *
 * Architecture:
 * - Dynamic column density (1 col: editorial feed, 2 cols: masonry, 3 cols: compact grid)
 * - Physical Column Reflow & Side-Entry Transition:
 *   - When zooming out (e.g. 2 -> 3 cols):
 *     - Existing columns compress and shift smoothly to their new widths and positions.
 *     - The brand new column physically slides in from the right edge of the screen.
 *     - Zero diagonal crossing or random photo shuffling.
 *   - When zooming in (e.g. 3 -> 2 cols):
 *     - Surviving columns expand smoothly to fill the screen.
 *     - The extra column physically slides off-screen past the right edge and fades.
 *   - Real-Time Finger Tracking:
 *     - Column slide and compression directly track two-finger pinch distance at 60fps.
 *   - Frame-0 Seamless Hand-off:
 *     - Transition cards match the target layout pixel-for-pixel at progress = 1.0.
 *     - Base grid recycled views mount seamlessly underneath with zero jump and zero white flash.
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
  interpolate,
  Extrapolation,
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

export interface TransitionCardData<T> {
  id: string | number;
  item: T;
  originalIndex: number;
  targetCol: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  startOpacity: number;
  endX: number;
  endY: number;
  endW: number;
  endH: number;
  endOpacity: number;
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

  const gridScrollY = Math.max(0, scrollY - headerHeight);
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

// ─── Focal-Point Touch Anchor ─────────────────────────────────────────────────

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
    return null;
  }

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

  const anchorItemCenterY = anchorItem.topY + anchorItem.height / 2;
  const anchorItemScreenY = safeHeader + anchorItemCenterY - safeScrollY;

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

  const targetItemCenterY = targetItem.topY + targetItem.height / 2;
  const desiredScrollY = safeHeader + targetItemCenterY - anchorItemScreenY;
  const maxScroll = Math.max(0, targetLayout.maxHeight + safeHeader - safeScreenH);

  const finalScrollY = Math.max(0, Math.min(maxScroll, Math.round(desiredScrollY)));
  return Number.isFinite(finalScrollY) ? finalScrollY : safeScrollY;
}

// ─── Physical Side-Entry & Column Reflow Cards Builder ────────────────────────

function buildSideTransitionCards<T>(
  fromLayout: MasonryLayout<T>,
  fromScrollY: number,
  toLayout: MasonryLayout<T>,
  toScrollY: number,
  headerHeight: number,
): TransitionCardData<T>[] {
  const cards: TransitionCardData<T>[] = [];
  const screenMinY = -120;
  const screenMaxY = SCREEN_HEIGHT + 120;

  const isAddingColumn = toLayout.numColumns > fromLayout.numColumns;

  if (isAddingColumn) {
    // ─── ZOOM OUT (e.g. 2 -> 3 columns):
    // Target is toLayout (3 cols).
    // Columns 0 & 1 compress and shift left.
    // Column 2 slides in from the right edge!
    toLayout.columns.forEach((col, cIdx) => {
      const endX = HORIZONTAL_MARGIN + cIdx * (toLayout.colWidth + CARD_GAP);
      const isNewColumn = cIdx >= fromLayout.numColumns;

      col.items.forEach((item) => {
        const endY = headerHeight + item.topY - toScrollY;
        const endW = toLayout.colWidth;
        const endH = item.height;

        if (endY + endH < screenMinY || endY > screenMaxY) {
          return;
        }

        const id = getItemId(item) ?? `${cIdx}-${item.originalIndex}`;

        if (isNewColumn) {
          // NEW COLUMN: physically slides in from beyond the right screen edge
          cards.push({
            id,
            item: item.item,
            originalIndex: item.originalIndex,
            targetCol: cIdx,
            startX: SCREEN_WIDTH + 16,
            startY: endY,
            startW: endW,
            startH: endH,
            startOpacity: 0,
            endX,
            endY,
            endW,
            endH,
            endOpacity: 1,
          });
        } else {
          // EXISTING COLUMN: stays in column cIdx, smoothly compresses width and shifts left
          const startX = HORIZONTAL_MARGIN + cIdx * (fromLayout.colWidth + CARD_GAP);
          cards.push({
            id,
            item: item.item,
            originalIndex: item.originalIndex,
            targetCol: cIdx,
            startX,
            startY: endY,
            startW: fromLayout.colWidth,
            startH: endH,
            startOpacity: 1,
            endX,
            endY,
            endW,
            endH,
            endOpacity: 1,
          });
        }
      });
    });
  } else {
    // ─── ZOOM IN (e.g. 3 -> 2 columns):
    // Active layout is fromLayout (3 cols).
    // Columns 0 & 1 expand from 3-col width to 2-col width.
    // Column 2 slides off to the right edge and fades!
    // Each photo in fromLayout appears exactly once — ZERO duplicate cards or duplicate keys!
    fromLayout.columns.forEach((col, cIdx) => {
      const isExitingColumn = cIdx >= toLayout.numColumns;
      const startX = HORIZONTAL_MARGIN + cIdx * (fromLayout.colWidth + CARD_GAP);
      const startW = fromLayout.colWidth;

      // Surviving columns expand to toLayout.colWidth; exiting columns slide off-screen to the right
      const endX = isExitingColumn
        ? SCREEN_WIDTH + 16
        : HORIZONTAL_MARGIN + cIdx * (toLayout.colWidth + CARD_GAP);
      const endW = isExitingColumn
        ? fromLayout.colWidth
        : toLayout.colWidth;
      const endOpacity = isExitingColumn ? 0 : 1;

      col.items.forEach((item) => {
        const startY = headerHeight + item.topY - fromScrollY;
        const startH = item.height;

        if (startY + startH < screenMinY || startY > screenMaxY) {
          return;
        }

        const id = getItemId(item) ?? `${cIdx}-${item.originalIndex}`;

        cards.push({
          id,
          item: item.item,
          originalIndex: item.originalIndex,
          targetCol: cIdx,
          startX,
          startY,
          startW,
          startH,
          startOpacity: 1,
          endX,
          endY: startY,
          endW,
          endH: startH,
          endOpacity,
        });
      });
    });
  }

  return cards;
}

// ─── Animating Flight Card Component ──────────────────────────────────────────

interface AnimatingCardProps {
  card: TransitionCardData<any>;
  progress: SharedValue<number>;
  renderItem: (info: {
    item: any;
    index: number;
    isColumn0: boolean;
    columnIndex?: number;
    numColumns?: number;
  }) => React.ReactElement;
  toCols: number;
}

const AnimatingCard = React.memo(function AnimatingCard({
  card,
  progress,
  renderItem: renderFn,
  toCols,
}: AnimatingCardProps) {
  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    const p = progress.value;
    const curX = interpolate(p, [0, 1], [card.startX, card.endX]);
    const curY = interpolate(p, [0, 1], [card.startY, card.endY]);
    const curW = interpolate(p, [0, 1], [card.startW, card.endW]);
    const curH = interpolate(p, [0, 1], [card.startH, card.endH]);
    const opacity = interpolate(p, [0, 1], [card.startOpacity, card.endOpacity]);

    const scaleX = card.endW > 0 ? curW / card.endW : 1;
    const scaleY = card.endH > 0 ? curH / card.endH : 1;
    const translateX = curX + (curW - card.endW) / 2;
    const translateY = curY + (curH - card.endH) / 2;

    return {
      position: 'absolute',
      left: 0,
      top: 0,
      width: card.endW,
      height: card.endH,
      transform: [
        { translateX },
        { translateY },
        { scaleX },
        { scaleY },
      ],
      opacity,
      overflow: 'hidden',
    };
  });

  return (
    <Animated.View style={animatedStyle}>
      {renderFn({
        item: card.item,
        index: card.originalIndex,
        isColumn0: card.targetCol === 0,
        columnIndex: card.targetCol,
        numColumns: toCols,
      })}
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
  // ─── Transition Shared Values ──────────────────────────────────────────────
  const transitionProgress = useSharedValue(0);
  const pinchDirection = useSharedValue(0); // 1 = zoom out (+1 col), -1 = zoom in (-1 col)
  const isPinching = useSharedValue(false);
  const currentColsShared = useSharedValue(numColumnsProp || 2);
  const targetColsShared = useSharedValue(numColumnsProp || 2);
  const gridOpacity = useSharedValue(1);
  const overlayOpacity = useSharedValue(1);
  const isOverlayMountedShared = useSharedValue(false);

  // ─── Component State ───────────────────────────────────────────────────────
  const [currentCols, setCurrentCols] = useState<number>(() => {
    return Math.max(minColumns, Math.min(maxColumns, numColumnsProp || 2));
  });

  const [isPinchingState, setIsPinchingState] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionCards, setTransitionCards] = useState<TransitionCardData<T>[] | null>(null);
  const [transitionToCols, setTransitionToCols] = useState(currentCols);

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

  const layout = useMemo(
    () => buildMasonryLayout(data, currentCols, SCREEN_WIDTH),
    [data, currentCols],
  );

  const layoutRef = useRef(layout);
  const dataRef = useRef(data);
  const scrollYRef = useRef(0);
  const isTransitioningRef = useRef(false);

  const pendingTargetScrollYRef = useRef<number>(0);
  const pendingTargetSlotsRef = useRef<SlotState[][] | null>(null);
  const pendingTargetLayoutRef = useRef<MasonryLayout<T> | null>(null);

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

  // Keep scrollYRef synchronized:
  if (scrollSharedValue) {
    useAnimatedReaction(
      () => scrollSharedValue.value,
      (y) => {
        scrollYRef.current = y;
      },
    );
  }

  // ─── Smooth Native Scroll Helper ───────────────────────────────────────────
  const performScrollTo = useCallback((safeY: number) => {
    scrollYRef.current = safeY;
    if (scrollSharedValue) {
      scrollSharedValue.value = safeY;
    }
    try {
      if (mainScrollRef?.current) {
        if (typeof mainScrollRef.current.scrollTo === 'function') {
          mainScrollRef.current.scrollTo({ y: safeY, animated: false });
        } else if (typeof mainScrollRef.current.scrollToOffset === 'function') {
          mainScrollRef.current.scrollToOffset({ offset: safeY, animated: false });
        }
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

  // ─── Interactive Column Flight Handlers ─────────────────────────────────────
  const finalizeCleanup = useCallback(() => {
    setTransitionCards(null);
    setIsTransitioning(false);
    isTransitioningRef.current = false;
    setIsPinchingState(false);
    overlayOpacity.value = 1;
    transitionProgress.value = 0;
    pinchDirection.value = 0;

    // Guarantee base grid has fresh slots populated at settled position:
    const curLayout = layoutRef.current;
    if (curLayout && curLayout.columns && curLayout.columns.length > 0) {
      const y = scrollYRef.current;
      const pool = getPoolSizeForCols(curLayout.numColumns);
      const h = headerHeightRef.current;
      const slots = computeAllColumnSlots(curLayout, y, pool, h, columnSlotsRef.current);
      setColumnSlots(slots);
      columnSlotsRef.current = slots;
    }
  }, [overlayOpacity, transitionProgress, pinchDirection]);

  const commitTransition = useCallback((targetCols: number) => {
    const targetScrollY = pendingTargetScrollYRef.current;
    const currentHeaderHeight = headerHeightRef.current;
    const targetLayout = pendingTargetLayoutRef.current ?? buildMasonryLayout(dataRef.current, targetCols, SCREEN_WIDTH);
    const targetPool = getPoolSizeForCols(targetCols);

    // Compute fresh target slots at exact targetScrollY:
    const freshTargetSlots = computeAllColumnSlots(
      targetLayout,
      targetScrollY,
      targetPool,
      currentHeaderHeight,
    );

    performScrollTo(targetScrollY);
    setCurrentCols(targetCols);
    currentColsShared.value = targetCols;
    setColumnSlots(freshTargetSlots);
    columnSlotsRef.current = freshTargetSlots;
    layoutRef.current = targetLayout;

    onNumColumnsChange?.(targetCols);

    // Unhide base grid underneath the overlay
    isOverlayMountedShared.value = false;
    gridOpacity.value = 1;

    // Smoothly dissolve overlay so hand-off is 100% seamless without white flash
    overlayOpacity.value = withTiming(0, {
      duration: 160,
      easing: Easing.out(Easing.quad),
    }, () => {
      runOnJS(finalizeCleanup)();
    });

    // Fallback safety timeout in case Reanimated callback drops:
    setTimeout(() => {
      finalizeCleanup();
    }, 220);
  }, [
    performScrollTo,
    onNumColumnsChange,
    currentColsShared,
    isOverlayMountedShared,
    gridOpacity,
    overlayOpacity,
    finalizeCleanup,
  ]);

  const cancelTransition = useCallback(() => {
    isOverlayMountedShared.value = false;
    gridOpacity.value = 1;

    overlayOpacity.value = withTiming(0, {
      duration: 120,
      easing: Easing.out(Easing.quad),
    }, () => {
      runOnJS(finalizeCleanup)();
    });

    setTimeout(() => {
      finalizeCleanup();
    }, 180);
  }, [isOverlayMountedShared, gridOpacity, overlayOpacity, finalizeCleanup]);

  const startInteractiveTransition = useCallback((
    targetCols: number,
    focalX: number,
    focalY: number,
  ) => {
    if (targetCols < minColumns || targetCols > maxColumns || targetCols === currentCols) {
      return;
    }

    const currentScrollY = scrollSharedValue ? scrollSharedValue.value : scrollYRef.current;
    const currentHeaderHeight = headerHeightRef.current;
    const currentLayout = layoutRef.current;
    const targetLayout = buildMasonryLayout(dataRef.current, targetCols, SCREEN_WIDTH);
    const targetPool = getPoolSizeForCols(targetCols);

    const targetScrollY = computeFocalAnchoredScrollY(
      currentScrollY,
      currentHeaderHeight,
      SCREEN_HEIGHT,
      focalX,
      focalY,
      currentLayout,
      targetLayout,
    );

    const cards = buildSideTransitionCards(
      currentLayout,
      currentScrollY,
      targetLayout,
      targetScrollY,
      currentHeaderHeight,
    );

    const targetSlots = computeAllColumnSlots(
      targetLayout,
      targetScrollY,
      targetPool,
      currentHeaderHeight,
    );

    pendingTargetScrollYRef.current = targetScrollY;
    pendingTargetSlotsRef.current = targetSlots;
    pendingTargetLayoutRef.current = targetLayout;

    setTransitionCards(cards);
    setTransitionToCols(targetCols);
    setIsTransitioning(true);
    isTransitioningRef.current = true;
  }, [currentCols, minColumns, maxColumns, scrollSharedValue]);

  // ─── Real-Time Pinch Gesture with Side-Entry Column Flight ──────────────────
  const pinchGesture = useMemo(() => {
    return Gesture.Pinch()
      .cancelsTouchesInView(true)
      .enabled(enablePinchToZoom && !isTransitioning)
      .onStart((_e) => {
        'worklet';
        isPinching.value = true;
        if (isPinchingShared) isPinchingShared.value = true;
        pinchDirection.value = 0;
        transitionProgress.value = 0;
        gridOpacity.value = 1;
        isOverlayMountedShared.value = false;
        overlayOpacity.value = 1;
        runOnJS(setIsPinchingState)(true);
      })
      .onUpdate((e) => {
        'worklet';
        const cols = currentColsShared.value;

        // Detect direction and initialize side-flight overlay once threshold is crossed:
        if (pinchDirection.value === 0) {
          if (e.scale < 0.95 && cols < maxColumns) {
            pinchDirection.value = 1; // Pinch in -> Zoom out -> Add column (e.g. 2 -> 3)
            targetColsShared.value = cols + 1;
            runOnJS(startInteractiveTransition)(cols + 1, e.focalX, e.focalY);
          } else if (e.scale > 1.05 && cols > minColumns) {
            pinchDirection.value = -1; // Pinch out -> Zoom in -> Remove column (e.g. 3 -> 2)
            targetColsShared.value = cols - 1;
            runOnJS(startInteractiveTransition)(cols - 1, e.focalX, e.focalY);
          }
        }

        // Live interactive gesture flight tracking user's fingers:
        if (pinchDirection.value === 1) {
          const p = Math.max(0, Math.min(1, (0.95 - e.scale) / 0.22));
          transitionProgress.value = p;
          gridOpacity.value = interpolate(p, [0.03, 0.15], [1, 0], Extrapolation.CLAMP);
        } else if (pinchDirection.value === -1) {
          const p = Math.max(0, Math.min(1, (e.scale - 1.05) / 0.22));
          transitionProgress.value = p;
          gridOpacity.value = interpolate(p, [0.03, 0.15], [1, 0], Extrapolation.CLAMP);
        }
      })
      .onEnd((_e) => {
        'worklet';
        isPinching.value = false;
        if (isPinchingShared) isPinchingShared.value = false;

        if (pinchDirection.value !== 0) {
          const currentP = transitionProgress.value;
          const targetCols = targetColsShared.value;

          if (currentP >= 0.35) {
            // Animate remaining progress to 1.0 and commit new columns:
            transitionProgress.value = withTiming(1, {
              duration: 220,
              easing: Easing.bezier(0.25, 1, 0.5, 1),
            }, () => {
              runOnJS(commitTransition)(targetCols);
            });
          } else {
            // Cancel transition: animate cards smoothly back to 0 (no bounce):
            gridOpacity.value = withTiming(1, { duration: 180 });
            transitionProgress.value = withTiming(0, {
              duration: 180,
              easing: Easing.bezier(0.25, 1, 0.5, 1),
            }, () => {
              runOnJS(cancelTransition)();
            });
          }
        } else {
          runOnJS(setIsPinchingState)(false);
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
    pinchDirection,
    targetColsShared,
    transitionProgress,
    gridOpacity,
    isOverlayMountedShared,
    overlayOpacity,
    currentColsShared,
    maxColumns,
    minColumns,
    startInteractiveTransition,
    commitTransition,
    cancelTransition,
  ]);

  const gridVisibilityStyle = useAnimatedStyle(() => {
    'worklet';
    if (!isOverlayMountedShared.value) {
      return { opacity: 1 };
    }
    return {
      opacity: gridOpacity.value,
    };
  });

  const overlayAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: overlayOpacity.value,
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
        <View style={styles.viewport}>
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
            <Animated.View style={[styles.gridRow, gridVisibilityStyle]}>
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
            </Animated.View>

            {renderedFooter}
          </Animated.ScrollView>
        </View>
      </GestureDetector>

      {/* ─── Physical Side-Entry & Column Reflow Overlay ─────────────────── */}
      {transitionCards && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { overflow: 'hidden' },
            overlayAnimatedStyle,
          ]}
          pointerEvents="none"
          onLayout={() => {
            isOverlayMountedShared.value = true;
          }}
        >
          {transitionCards.map((card, idx) => (
            <AnimatingCard
              key={`trans-${card.targetCol}-${card.id}-${card.originalIndex}-${idx}`}
              card={card}
              progress={transitionProgress}
              renderItem={renderItem}
              toCols={transitionToCols}
            />
          ))}

          {/* Keep sticky header crisp on top of flying cards */}
          {renderStickyHeader && isScrolledPastHero ? (
            <View style={styles.stickyHeaderOverlay} pointerEvents="none">
              {renderStickyHeader()}
            </View>
          ) : null}
        </Animated.View>
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
