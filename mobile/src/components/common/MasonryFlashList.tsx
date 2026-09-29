/**
 * MasonryFlashList — True View Recycling Masonry Grid with Apple Photos FLIP Transition
 *
 * Architecture:
 * - Dynamic column density (1 col: editorial feed, 2 cols: masonry, 3 cols: compact grid)
 * - Apple Photos FLIP Layout Flight Transition:
 *   - Pinch Focal Anchor: When you pinch with two fingers, the photo directly between your
 *     fingers is tracked (focalX, focalY). That photo stays pinned directly under your fingers.
 *   - Multi-Element Flight Animation: During column changes, every visible photo smoothly
 *     floats, slides, and resizes from its starting grid slot to its new column slot.
 *   - Column Addition (2 -> 3): Photos glide over into Column 3, and new photos smoothly fade in.
 *   - Column Removal (3 -> 2): Photos glide back into 2 columns, and Column 3 smoothly collapses.
 * - Frame-0 Pre-calculated Hand-off:
 *   - When the 320ms animation finishes, the recycled grid seamlessly unhides at the exact
 *     matching scroll offset and slots with zero jump and zero white flash.
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
  const contentY = currentScrollY + screenFocalY - headerHeight;
  if (contentY < 0) {
    return currentScrollY;
  }

  const anchorItem = findFocalAnchorItem(currentLayout, currentScrollY, headerHeight, focalX, screenFocalY);
  if (!anchorItem) {
    return currentScrollY;
  }

  // Anchor item's center Y in current layout:
  const anchorItemCenterY = anchorItem.topY + anchorItem.height / 2;
  // Its exact screen Y coordinate:
  const anchorItemScreenY = headerHeight + anchorItemCenterY - currentScrollY;

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
    return currentScrollY;
  }

  // Align targetItem so its center lands at the EXACT SAME anchorItemScreenY:
  const targetItemCenterY = targetItem.topY + targetItem.height / 2;
  const desiredScrollY = headerHeight + targetItemCenterY - anchorItemScreenY;
  const maxScroll = Math.max(0, targetLayout.maxHeight + headerHeight - screenHeight);

  return Math.max(0, Math.min(maxScroll, Math.round(desiredScrollY)));
}

// ─── Apple Photos Multi-Element Flight Cards Builder ──────────────────────────

function buildTransitionCards<T>(
  fromLayout: MasonryLayout<T>,
  fromScrollY: number,
  toLayout: MasonryLayout<T>,
  toScrollY: number,
  headerHeight: number,
): TransitionCardData<T>[] {
  const cardsMap = new Map<string | number, TransitionCardData<T>>();

  // Screen visible bounds with edge padding to smoothly catch entering/leaving cards
  const screenMinY = -180;
  const screenMaxY = SCREEN_HEIGHT + 180;

  const isAddingColumn = toLayout.numColumns > fromLayout.numColumns;
  const isRemovingColumn = toLayout.numColumns < fromLayout.numColumns;

  // 1. Process items visible in fromLayout:
  fromLayout.columns.forEach((col, cIdx) => {
    col.items.forEach((item) => {
      const startX = HORIZONTAL_MARGIN + cIdx * (fromLayout.colWidth + CARD_GAP);
      const startY = headerHeight + item.topY - fromScrollY;
      const startW = fromLayout.colWidth;
      const startH = item.height;

      // Only track items currently visible on the screen in fromLayout:
      const isVisibleInFrom =
        startY + startH >= screenMinY && startY <= screenMaxY;

      if (!isVisibleInFrom) {
        return;
      }

      const id = getItemId(item);
      if (id === undefined) return;

      // Find where this item lands in toLayout:
      const targetItem = toLayout.itemMap.get(id);
      let endX = startX;
      let endY = startY;
      let endW = startW;
      let endH = startH;
      let startOpacity = 1;
      let endOpacity = 1;
      let targetCol = cIdx;

      if (targetItem) {
        targetCol = targetItem.colIndex;
        const targetEndX = HORIZONTAL_MARGIN + targetItem.colIndex * (toLayout.colWidth + CARD_GAP);
        const targetEndY = headerHeight + targetItem.topY - toScrollY;
        const targetEndW = toLayout.colWidth;
        const targetEndH = targetItem.height;

        const isVisibleInTo =
          targetEndY + targetEndH >= screenMinY && targetEndY <= screenMaxY;

        if (isVisibleInTo) {
          // Scenario A: Visible on screen in both layouts -> Physical FLIP flight into new column!
          endX = targetEndX;
          endY = targetEndY;
          endW = targetEndW;
          endH = targetEndH;
          endOpacity = 1;
        } else {
          // Scenario B: Visible before, but exits the viewport in the new column density ->
          const isExitingToRight = isRemovingColumn && cIdx >= toLayout.numColumns;

          if (isExitingToRight) {
            // Slide smoothly out past the right edge of the screen:
            endX = SCREEN_WIDTH + 14;
            endY = startY;
            endW = startW;
            endH = startH;
          } else {
            // Gently glide down and fade:
            endX = startX;
            endY = startY + 16;
            endW = startW * 0.94;
            endH = startH * 0.94;
          }
          endOpacity = 0;
        }
      } else {
        // Fallback: fade out in place
        endX = startX;
        endY = startY;
        endW = startW;
        endH = startH;
        endOpacity = 0;
      }

      cardsMap.set(id, {
        id,
        item: item.item,
        originalIndex: item.originalIndex,
        targetCol,
        startX,
        startY,
        startW,
        startH,
        startOpacity,
        endX,
        endY,
        endW,
        endH,
        endOpacity,
      });
    });
  });

  // 2. Process items visible in toLayout that were NOT visible in fromLayout:
  toLayout.columns.forEach((col, cIdx) => {
    col.items.forEach((item) => {
      const targetEndX = HORIZONTAL_MARGIN + cIdx * (toLayout.colWidth + CARD_GAP);
      const targetEndY = headerHeight + item.topY - toScrollY;
      const targetEndW = toLayout.colWidth;
      const targetEndH = item.height;

      const isVisibleInTo =
        targetEndY + targetEndH >= screenMinY && targetEndY <= screenMaxY;

      if (!isVisibleInTo) return;

      const id = getItemId(item);
      if (id === undefined || cardsMap.has(id)) return;

      // Scenario C: Newly appearing on screen in toLayout ->
      const isEnteringFromRight = isAddingColumn && cIdx >= fromLayout.numColumns;

      let startX: number;
      let startY: number;
      let startW: number;
      let startH: number;

      if (isEnteringFromRight) {
        // Slide in from beyond the right edge of the screen:
        startX = SCREEN_WIDTH + 14;
        startY = targetEndY;
        startW = targetEndW;
        startH = targetEndH;
      } else {
        // Entering from bottom/top: gentle scale up and directional vertical glide:
        const isFromTop = targetEndY < screenMinY / 2;
        startW = targetEndW * 0.94;
        startH = targetEndH * 0.94;
        startX = targetEndX + (targetEndW - startW) / 2;
        startY = isFromTop ? targetEndY - 20 : targetEndY + 20;
      }

      cardsMap.set(id, {
        id,
        item: item.item,
        originalIndex: item.originalIndex,
        targetCol: cIdx,
        startX,
        startY,
        startW,
        startH,
        startOpacity: 0,
        endX: targetEndX,
        endY: targetEndY,
        endW: targetEndW,
        endH: targetEndH,
        endOpacity: 1,
      });
    });
  });

  return Array.from(cardsMap.values());
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
    const p = progress.value;
    const curW = interpolate(p, [0, 1], [card.startW, card.endW]);
    const curH = interpolate(p, [0, 1], [card.startH, card.endH]);
    const curX = interpolate(p, [0, 1], [card.startX, card.endX]);
    const curY = interpolate(p, [0, 1], [card.startY, card.endY]);

    const scaleX = card.startW > 0 ? curW / card.startW : 1;
    const scaleY = card.startH > 0 ? curH / card.startH : 1;
    const translateX = (curX - card.startX) + (curW - card.startW) / 2;
    const translateY = (curY - card.startY) + (curH - card.startH) / 2;
    const opacity = interpolate(p, [0, 1], [card.startOpacity, card.endOpacity]);

    return {
      position: 'absolute',
      left: card.startX,
      top: card.startY,
      width: card.startW,
      height: card.startH,
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
  // ─── Shared Values ─────────────────────────────────────────────────────────
  const pinchScale = useSharedValue(1);
  const focalXShared = useSharedValue(SCREEN_WIDTH / 2);
  const focalYShared = useSharedValue(SCREEN_HEIGHT / 2);
  const pinchDirection = useSharedValue(0);
  const targetColsShared = useSharedValue(numColumnsProp || 2);
  const transitionProgress = useSharedValue(0);
  const isPinching = useSharedValue(false);
  const currentColsShared = useSharedValue(numColumnsProp || 2);
  const gridOpacity = useSharedValue(1);
  const hasTransitionCardsShared = useSharedValue(false);

  const pendingTargetScrollYRef = useRef(0);
  const pendingTargetSlotsRef = useRef<SlotState[][] | null>(null);
  const pendingTargetLayoutRef = useRef<MasonryLayout<T> | null>(null);

  // ─── Component State ───────────────────────────────────────────────────────
  const [currentCols, setCurrentCols] = useState<number>(() => {
    return Math.max(minColumns, Math.min(maxColumns, numColumnsProp || 2));
  });

  const [isPinchingState, setIsPinchingState] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionCards, setTransitionCards] = useState<TransitionCardData<T>[] | null>(null);
  const [transitionToCols, setTransitionToCols] = useState(numColumnsProp || 2);

  useEffect(() => {
    if (transitionCards && transitionCards.length > 0) {
      requestAnimationFrame(() => {
        hasTransitionCardsShared.value = true;
      });
    }
  }, [transitionCards, hasTransitionCardsShared]);

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
    scrollYRef.current = targetY;
    if (scrollSharedValue) {
      scrollSharedValue.value = targetY;
    }
    try {
      if (mainScrollRef?.current) {
        if (typeof (mainScrollRef.current as any).scrollTo === 'function') {
          (mainScrollRef.current as any).scrollTo({ y: targetY, animated: false });
        } else {
          runOnUI((y: number) => {
            'worklet';
            scrollTo(mainScrollRef, 0, y, false);
          })(targetY);
        }
      } else {
        runOnUI((y: number) => {
          'worklet';
          scrollTo(mainScrollRef, 0, y, false);
        })(targetY);
      }
    } catch (_e) {
      try {
        runOnUI((y: number) => {
          'worklet';
          scrollTo(mainScrollRef, 0, y, false);
        })(targetY);
      } catch (_e2) {}
    }
  }, [mainScrollRef, scrollSharedValue]);

  // ─── Apple Photos Interactive Flight Transition ───────────────────────────
  const commitTransition = useCallback((targetCols: number) => {
    const targetScrollY = pendingTargetScrollYRef.current;
    const targetSlots = pendingTargetSlotsRef.current;
    const targetLayout = pendingTargetLayoutRef.current;

    if (targetLayout && targetSlots) {
      performScrollTo(targetScrollY);
      setCurrentCols(targetCols);
      setColumnSlots(targetSlots);
      columnSlotsRef.current = targetSlots;
      layoutRef.current = targetLayout;
    }

    onNumColumnsChange?.(targetCols);
    // Keep the transition overlay cards visible for 110ms while React + native
    // mount and paint the new base grid views in native.
    // The base grid remains completely invisible (opacity 0) underneath during this time,
    // so nothing shifts or shows through in the background!
    setTimeout(() => {
      gridOpacity.value = 1;
      hasTransitionCardsShared.value = false;
      setTransitionCards(null);
      setIsTransitioning(false);
      isTransitioningRef.current = false;
      setIsPinchingState(false);
      transitionProgress.value = 0;
      pinchDirection.value = 0;
    }, 110);
  }, [performScrollTo, onNumColumnsChange, transitionProgress, pinchDirection, gridOpacity, hasTransitionCardsShared]);

  const cancelTransition = useCallback(() => {
    gridOpacity.value = 1;
    hasTransitionCardsShared.value = false;
    setTransitionCards(null);
    setIsTransitioning(false);
    isTransitioningRef.current = false;
    setIsPinchingState(false);
    transitionProgress.value = 0;
    pinchDirection.value = 0;
  }, [gridOpacity, transitionProgress, pinchDirection, hasTransitionCardsShared]);

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

    // PINCH ANCHOR: Compute targetScrollY based on the exact photo under (focalX, focalY)
    const targetScrollY = computeFocalAnchoredScrollY(
      currentScrollY,
      currentHeaderHeight,
      SCREEN_HEIGHT,
      focalX,
      focalY,
      currentLayout,
      targetLayout,
    );

    // Build the interactive flight transition cards (progress 0 = currentLayout, progress 1 = targetLayout):
    const cards = buildTransitionCards(
      currentLayout,
      currentScrollY,
      targetLayout,
      targetScrollY,
      currentHeaderHeight,
    );

    const targetSlots = computeAllColumnSlots(targetLayout, targetScrollY, targetPool, currentHeaderHeight);

    pendingTargetScrollYRef.current = targetScrollY;
    pendingTargetSlotsRef.current = targetSlots;
    pendingTargetLayoutRef.current = targetLayout;

    setTransitionCards(cards);
    setTransitionToCols(targetCols);
    setIsTransitioning(true);
    isTransitioningRef.current = true;
  }, [currentCols, minColumns, maxColumns, scrollSharedValue]);

  // ─── Pinch Gesture with Real-Time Interactive Column Flight ─────────────────
  const pinchGesture = useMemo(() => {
    return Gesture.Pinch()
      .enabled(enablePinchToZoom && !isTransitioning)
      .onStart((e) => {
        'worklet';
        isPinching.value = true;
        if (isPinchingShared) isPinchingShared.value = true;
        focalXShared.value = e.focalX;
        focalYShared.value = e.focalY;
        pinchDirection.value = 0;
        transitionProgress.value = 0;
        gridOpacity.value = 1;
        hasTransitionCardsShared.value = false;
        runOnJS(setIsPinchingState)(true);
      })
      .onUpdate((e) => {
        'worklet';
        focalXShared.value = e.focalX;
        focalYShared.value = e.focalY;

        // Detect pinch direction as fingers move:
        if (pinchDirection.value === 0) {
          if (e.scale < 0.97 && currentColsShared.value < maxColumns) {
            pinchDirection.value = 1; // Pinch in -> Add column (e.g. 2 -> 3)
            targetColsShared.value = currentColsShared.value + 1;
            runOnJS(startInteractiveTransition)(currentColsShared.value + 1, e.focalX, e.focalY);
          } else if (e.scale > 1.03 && currentColsShared.value > minColumns) {
            pinchDirection.value = -1; // Pinch out -> Remove column (e.g. 3 -> 2, 2 -> 1)
            targetColsShared.value = currentColsShared.value - 1;
            runOnJS(startInteractiveTransition)(currentColsShared.value - 1, e.focalX, e.focalY);
          }
        }

        // Live interactive gesture flight progress directly tracking user's fingers:
        if (pinchDirection.value === 1) {
          const p = Math.max(0, Math.min(1, (0.97 - e.scale) / 0.20));
          transitionProgress.value = p;
          gridOpacity.value = interpolate(p, [0.08, 0.28], [1, 0], Extrapolation.CLAMP);
        } else if (pinchDirection.value === -1) {
          const p = Math.max(0, Math.min(1, (e.scale - 1.03) / 0.20));
          transitionProgress.value = p;
          gridOpacity.value = interpolate(p, [0.08, 0.28], [1, 0], Extrapolation.CLAMP);
        }
      })
      .onEnd((e) => {
        'worklet';
        isPinching.value = false;
        if (isPinchingShared) isPinchingShared.value = false;

        if (pinchDirection.value !== 0) {
          const currentP = transitionProgress.value;
          const targetCols = targetColsShared.value;

          if (currentP >= 0.38) {
            // Animate remaining progress to 1 and commit new columns:
            transitionProgress.value = withTiming(1, {
              duration: 220,
              easing: Easing.bezier(0.25, 1, 0.5, 1),
            }, () => {
              runOnJS(commitTransition)(targetCols);
            });
          } else {
            // Cancel transition: animate cards back to 0:
            gridOpacity.value = withTiming(1, { duration: 180 });
            if (currentP > 0.01) {
              transitionProgress.value = withTiming(0, {
                duration: 180,
                easing: Easing.bezier(0.25, 1, 0.5, 1),
              }, () => {
                runOnJS(cancelTransition)();
              });
            } else {
              runOnJS(cancelTransition)();
            }
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
    focalXShared,
    focalYShared,
    pinchDirection,
    targetColsShared,
    transitionProgress,
    currentColsShared,
    maxColumns,
    minColumns,
    startInteractiveTransition,
    commitTransition,
    cancelTransition,
  ]);

  const activePinchAnimatedStyle = useAnimatedStyle(() => {
    return { transform: [{ scale: 1 }] };
  });

  const gridVisibilityStyle = useAnimatedStyle(() => {
    if (!hasTransitionCardsShared.value) {
      return { opacity: 1 };
    }
    return {
      opacity: gridOpacity.value,
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
        <Animated.View style={[styles.viewport, activePinchAnimatedStyle]}>
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
        </Animated.View>
      </GestureDetector>

      {/* ─── Apple Photos Flight Transition Overlay ─────────────────────── */}
      {transitionCards && (
        <View
          style={[StyleSheet.absoluteFillObject, { overflow: 'hidden' }]}
          pointerEvents="none"
          onLayout={() => {
            hasTransitionCardsShared.value = true;
          }}
        >
          {transitionCards.map((card) => (
            <AnimatingCard
              key={`trans-${card.id}`}
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
        </View>
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
