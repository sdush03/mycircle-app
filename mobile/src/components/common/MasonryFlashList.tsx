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
import { StyleSheet, View, Text, Dimensions, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedReaction,
  runOnJS,
  runOnUI,
  scrollTo,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  useAnimatedRef,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { getPhotoCardAspect } from '../../utils/photoDimensionCache';
import { analyticsService } from '../../services/analyticsService';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Layout constants:
export const DEFAULT_HORIZONTAL_MARGIN = 6;
export const DEFAULT_CARD_GAP = 5;
export const HORIZONTAL_MARGIN = 6;
export const CARD_GAP = 5;
// Right-sized overscan: On Android, 700dp covers ~0.9 screens above and below,
// preventing excess bitmap memory and decoding pressure while eliminating blank slots.
const OVERSCAN = Platform.OS === 'android' ? 700 : 1000;

export const getCardGapForCols = (cols: number): number => {
  switch (cols) {
    case 1: return 5;
    case 2: return 5;
    case 3: return 4;
    case 4: return 3;
    case 5: default: return 2;
  }
};

export const getHorizontalMarginForCols = (_cols?: number): number => {
  return 6;
};

export const getPoolSizeForCols = (cols: number): number => {
  // On Android, keeping 100-230 views in memory causes severe ART GC thrashing,
  // Yoga layout recalculation lag, and frame drops.
  // We right-size the pool to cover ~3.5-4 viewports (plenty for high-speed scrolling).
  if (Platform.OS === 'android') {
    switch (cols) {
      case 1: return 18;
      case 2: return 22; // 2 cols * 22 = 44 total views (vs 100 before!)
      case 3: return 20; // 3 cols * 20 = 60 total views (vs 144 before!)
      case 4: return 18; // 4 cols * 18 = 72 total views (vs 184 before!)
      case 5: default: return 16;
    }
  }
  switch (cols) {
    case 1: return 30;
    case 2: return 36;
    case 3: return 34;
    case 4: return 32;
    case 5: default: return 28;
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
  colGap: number;
  horizontalMargin: number;
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
  uri: string;
  isVideo: boolean;
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
  tx: number;
  ty: number;
  scaleDelta: number;
  opacityDelta: number;
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
  ListEmptyComponent?: React.ReactNode | (() => React.ReactElement | null);
  onScroll?: any;
  scrollEventThrottle?: number;
  scrollSharedValue?: SharedValue<number>;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  mainScrollRef?: any;
  contentContainerStyle?: any;
  minContentHeight?: number;
  refreshControl?: any;
  isPinchingShared?: SharedValue<boolean>;
  onMomentumScrollEnd?: (event: any) => void;
  onScrollEndDrag?: (event: any) => void;
}

// ─── Dynamic Layout Computation ───────────────────────────────────────────────

export function buildMasonryLayout<T>(
  data: T[],
  numColumns: number = 2,
  screenWidth: number = SCREEN_WIDTH,
): MasonryLayout<T> {
  const safeCols = Math.max(1, Math.min(5, numColumns || 2));
  const colGap = getCardGapForCols(safeCols);
  const horizontalMargin = getHorizontalMarginForCols(safeCols);
  const totalGaps = colGap * Math.max(0, safeCols - 1);
  const availableWidth = screenWidth - (horizontalMargin * 2) - totalGaps;
  const colWidth = Math.max(30, availableWidth / safeCols);
  const totalGridWidth = safeCols * colWidth + totalGaps;
  const actualMargin = Math.max(0, (screenWidth - totalGridWidth) / 2);

  const columns: ColumnData<T>[] = Array.from({ length: safeCols }, () => ({
    items: [],
    height: 0,
  }));
  const itemMap = new Map<string | number, ColumnItem<T>>();

  if (!data || !Array.isArray(data) || data.length === 0) {
    return { numColumns: safeCols, columns, maxHeight: 0, colWidth, colGap, horizontalMargin: actualMargin, itemMap };
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
    columns[shortestCol].height += cardHeight + colGap;

    const id = getItemId(colItem);
    if (id !== undefined) {
      itemMap.set(id, colItem);
    }
  });

  const maxHeight = Math.max(0, ...columns.map((c) => c.height));
  return { numColumns: safeCols, columns, maxHeight, colWidth, colGap, horizontalMargin: actualMargin, itemMap };
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

  // 1. Identify all candidate items in overscan range, separating on-screen vs overscan
  const candidates: number[] = [];
  const onScreenSet = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    const { topY, height } = items[i];
    if (topY > maxY) break; // Items are ordered vertically, stop scanning once past maxY
    if (topY + height >= minY) {
      candidates.push(i);
      if (topY + height >= gridScrollY && topY <= gridScrollY + SCREEN_HEIGHT) {
        onScreenSet.add(i);
      }
    }
  }

  // 2. Prioritize candidates only when there are more candidates than poolSize:
  if (candidates.length > poolSize) {
    candidates.sort((a, b) => {
      const aOnScreen = onScreenSet.has(a);
      const bOnScreen = onScreenSet.has(b);
      if (aOnScreen && !bOnScreen) return -1;
      if (!aOnScreen && bOnScreen) return 1;

      const itemA = items[a];
      const itemB = items[b];
      const centerA = itemA.topY + itemA.height / 2;
      const centerB = itemB.topY + itemB.height / 2;
      return Math.abs(centerA - viewportCenter) - Math.abs(centerB - viewportCenter);
    });
  }

  // Top `poolSize` candidates are the ones that MUST be assigned slots.
  // Because onScreen items are sorted first, all on-screen items are GUARANTEED to be in targetIndices!
  const targetIndices = candidates.slice(0, poolSize);
  const targetSet = new Set<number>(targetIndices);

  // 3. Prepare next slot array with exact poolSize:
  const next: SlotState[] = prevSlots.slice(0, poolSize);
  while (next.length < poolSize) {
    next.push({ colItemIdx: -1, top: -30000, height: 0, itemId: undefined });
  }

  const assignedItems = new Set<number>();
  const occupiedSlots = new Set<number>();

  // Pass 1: Retain slots that already hold an item that is in targetSet
  for (let s = 0; s < next.length; s++) {
    const slot = next[s];
    const { colItemIdx, itemId } = slot;
    if (
      colItemIdx >= 0 &&
      colItemIdx < items.length &&
      targetSet.has(colItemIdx) &&
      String(getItemId(items[colItemIdx])) === String(itemId)
    ) {
      assignedItems.add(colItemIdx);
      occupiedSlots.add(s);
      const currentItem = items[colItemIdx];
      if (slot.top !== currentItem.topY || slot.height !== currentItem.height) {
        next[s] = {
          colItemIdx,
          top: currentItem.topY,
          height: currentItem.height,
          itemId: String(itemId),
        };
      }
    }
  }

  // Pass 2: Collect free slots (slots not retained in Pass 1)
  const freeSlotIndices: number[] = [];
  for (let s = 0; s < next.length; s++) {
    if (!occupiedSlots.has(s)) {
      freeSlotIndices.push(s);
    }
  }

  // Pass 3: Assign unassigned target items to free slots in priority order
  let freeIdx = 0;
  for (const itemIdx of targetIndices) {
    if (!assignedItems.has(itemIdx)) {
      if (freeIdx < freeSlotIndices.length) {
        const slotIdx = freeSlotIndices[freeIdx++];
        const newItem = items[itemIdx];
        const newTop = newItem.topY;
        const newH   = newItem.height;
        const newId  = String(getItemId(newItem) ?? itemIdx);
        next[slotIdx] = { colItemIdx: itemIdx, top: newTop, height: newH, itemId: newId };
      }
    }
  }

  // Pass 4: Park any remaining free slots off-screen
  while (freeIdx < freeSlotIndices.length) {
    const slotIdx = freeSlotIndices[freeIdx++];
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

  const effectiveFocalX = (typeof focalX === 'number' && focalX > 0) ? focalX : SCREEN_WIDTH / 2;
  const effectiveFocalY = (typeof screenFocalY === 'number' && screenFocalY > 0) ? screenFocalY : SCREEN_HEIGHT / 2;

  const colW = layout.colWidth;
  const gap = layout.colGap ?? getCardGapForCols(layout.numColumns);
  const margin = layout.horizontalMargin ?? getHorizontalMarginForCols(layout.numColumns);

  const contentX = effectiveFocalX - margin;
  const contentY = currentScrollY + effectiveFocalY - headerHeight;

  // 1. Check column closest to contentX:
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

  // 2. Fallback: find item in any column with center closest to (effectiveFocalX, contentY):
  let bestItem: ColumnItem<T> | null = null;
  let bestDist = Infinity;

  for (let c = 0; c < layout.columns.length; c++) {
    const column = layout.columns[c];
    if (!column || !column.items) continue;
    const colCenterX = margin + c * (colW + gap) + colW / 2;

    for (let i = 0; i < column.items.length; i++) {
      const it = column.items[i];
      const itCenterY = it.topY + it.height / 2;
      const dx = colCenterX - effectiveFocalX;
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
  const fromScrollable = Math.max(1, currentLayout.maxHeight + headerHeight - screenHeight);
  const toScrollable = Math.max(1, targetLayout.maxHeight + headerHeight - screenHeight);
  const proportionalFallback = Math.round(Math.max(0, Math.min(1, currentScrollY / fromScrollable)) * toScrollable);

  if (currentScrollY <= 20) {
    return 0;
  }

  const anchorItem = findFocalAnchorItem(currentLayout, currentScrollY, headerHeight, focalX, screenFocalY);
  if (!anchorItem) {
    return proportionalFallback;
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
    return proportionalFallback;
  }

  // Align targetItem so its center lands at the EXACT SAME anchorItemScreenY:
  const targetItemCenterY = targetItem.topY + targetItem.height / 2;
  const desiredScrollY = headerHeight + targetItemCenterY - anchorItemScreenY;
  const maxScroll = Math.max(0, targetLayout.maxHeight + headerHeight - screenHeight);

  return Math.max(0, Math.min(maxScroll, Math.round(desiredScrollY)));
}

// ─── Media URI & Video Extraction Helpers for Flight Tiles ─────────────────────

export function getMediaDisplayUri(item: any): string {
  if (!item) return '';
  if (typeof item === 'string') return item;
  const isVideoFile = (u: string | null | undefined) => {
    if (!u || typeof u !== 'string') return false;
    const clean = u.split('?')[0].toLowerCase();
    return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.webm');
  };
  const primaryUri = item.uri || '';
  const fallbackUri = item.fullUri || '';
  const activeUri = primaryUri || fallbackUri;
  const rawThumb = item.thumbnailUrl || item.thumbUri;
  const validThumb = rawThumb && !isVideoFile(rawThumb) ? rawThumb : null;
  let candidateUri = validThumb || (!isVideoFile(activeUri) ? activeUri : null) || item.r2Url || item.photoUrl;
  if (candidateUri && typeof candidateUri === 'string' && candidateUri.startsWith('/')) {
    candidateUri = `https://mycircle.mistyvisuals.com${candidateUri}`;
  }
  return typeof candidateUri === 'string' ? candidateUri : '';
}

function checkIsVideo(item: any): boolean {
  if (!item) return false;
  return Boolean(
    item.isVideo ||
    (typeof item.tabName === 'string' && item.tabName.trim().toUpperCase() === 'CINEMA') ||
    (typeof item.videoUrl === 'string' && item.videoUrl.length > 0) ||
    (typeof item.uri === 'string' && (item.uri.endsWith('.mp4') || item.uri.endsWith('.mov'))) ||
    (typeof item.fullUri === 'string' && (item.fullUri.endsWith('.mp4') || item.fullUri.endsWith('.mov')))
  );
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
  const screenMinY = -140;
  const screenMaxY = SCREEN_HEIGHT + 140;

  const fromGap = fromLayout.colGap ?? getCardGapForCols(fromLayout.numColumns);
  const fromMargin = fromLayout.horizontalMargin ?? getHorizontalMarginForCols(fromLayout.numColumns);
  const toGap = toLayout.colGap ?? getCardGapForCols(toLayout.numColumns);
  const toMargin = toLayout.horizontalMargin ?? getHorizontalMarginForCols(toLayout.numColumns);

  // 1. Process items visible in fromLayout:
  fromLayout.columns.forEach((col, cIdx) => {
    col.items.forEach((item) => {
      const startX = fromMargin + cIdx * (fromLayout.colWidth + fromGap);
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
        const targetEndX = toMargin + targetItem.colIndex * (toLayout.colWidth + toGap);
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
          // Naturally slide off the screen edge towards target position (clamped just beyond edge).
          const clampedEndY = targetEndY > screenMaxY
            ? SCREEN_HEIGHT + 60
            : (targetEndY < screenMinY ? -targetEndH - 60 : targetEndY);
          endX = targetEndX;
          endY = clampedEndY;
          endW = targetEndW;
          endH = targetEndH;
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

      const uri = getMediaDisplayUri(item.item);
      const isVideo = checkIsVideo(item.item);
      const tx = (endX - startX) + (endW - startW) / 2;
      const ty = (endY - startY) + (endH - startH) / 2;
      const scaleDelta = startW > 0 ? (endW / startW) - 1 : 0;
      const opacityDelta = endOpacity - startOpacity;

      cardsMap.set(id, {
        id,
        item: item.item,
        uri,
        isVideo,
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
        tx,
        ty,
        scaleDelta,
        opacityDelta,
      });
    });
  });

  // 2. Process items visible in toLayout that were NOT visible in fromLayout:
  toLayout.columns.forEach((col, cIdx) => {
    col.items.forEach((item) => {
      const targetEndX = toMargin + cIdx * (toLayout.colWidth + toGap);
      const targetEndY = headerHeight + item.topY - toScrollY;
      const targetEndW = toLayout.colWidth;
      const targetEndH = item.height;

      const isVisibleInTo =
        targetEndY + targetEndH >= screenMinY && targetEndY <= screenMaxY;

      if (!isVisibleInTo) return;

      const id = getItemId(item);
      if (id === undefined || cardsMap.has(id)) return;

      // Scenario C: Newly appearing on screen in toLayout ->
      // Smoothly fade in right in its target slot with a gentle scale up
      const startW = targetEndW * 0.92;
      const startH = targetEndH * 0.92;
      const startX = targetEndX + (targetEndW - startW) / 2;
      const startY = targetEndY + 12;

      const uri = getMediaDisplayUri(item.item);
      const isVideo = checkIsVideo(item.item);
      const tx = (targetEndX - startX) + (targetEndW - startW) / 2;
      const ty = (targetEndY - startY) + (targetEndH - startH) / 2;
      const scaleDelta = startW > 0 ? (targetEndW / startW) - 1 : 0;
      const opacityDelta = 1 - 0;

      cardsMap.set(id, {
        id,
        item: item.item,
        uri,
        isVideo,
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
        tx,
        ty,
        scaleDelta,
        opacityDelta,
      });
    });
  });

  return Array.from(cardsMap.values());
}

// ─── High-Performance Hardware-Accelerated Animating Flight Tile ─────────────

interface AnimatingCardProps {
  card: TransitionCardData<any>;
  progress: SharedValue<number>;
}

const AnimatingCard = React.memo(function AnimatingCard({
  card,
  progress,
}: AnimatingCardProps) {
  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    const p = progress.value;
    const translateX = p * card.tx;
    const translateY = p * card.ty;
    const scale = 1 + p * card.scaleDelta;
    const opacity = card.startOpacity + p * card.opacityDelta;

    return {
      position: 'absolute',
      left: card.startX,
      top: card.startY,
      width: card.startW,
      height: card.startH,
      transform: [
        { translateX },
        { translateY },
        { scale },
      ],
      opacity,
      overflow: 'hidden',
      backgroundColor: '#ffffff',
    };
  });

  return (
    <Animated.View style={animatedStyle}>
      {card.uri ? (
        <Image
          source={{ uri: card.uri }}
          style={[StyleSheet.absoluteFillObject, { backgroundColor: '#ffffff' }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : null}
      {card.isVideo ? (
        <View style={styles.playIconOverlay} pointerEvents="none">
          <View style={styles.playIconCircleMini}>
            <Ionicons name="play" size={13} color="#ffffff" style={{ marginLeft: 1 }} />
          </View>
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
  ListEmptyComponent,
  onScroll,
  scrollEventThrottle = 16,
  scrollSharedValue,
  onEndReached,
  onEndReachedThreshold = 0.8,
  mainScrollRef,
  minContentHeight,
  contentContainerStyle,
  refreshControl,
  isPinchingShared,
  onMomentumScrollEnd,
  onScrollEndDrag,
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
  const hasTransitionCardsShared = useSharedValue(false);
  const isTransitioningShared = useSharedValue(false);
  const isScrollRestoringShared = useSharedValue(false);
  const isFlightAnimatingShared = useSharedValue(false);
  const isGestureAcceptedShared = useSharedValue(false);
  // Smooth handoff shared values — drives the overlay→grid handoff without background bleed-through
  const overlayOpacity = useSharedValue(0);
  const isBaseGridRevealedShared = useSharedValue(false);
  const fromScrollYShared = useSharedValue(0);
  const targetScrollYShared = useSharedValue(0);
  const gestureStartTimeShared = useSharedValue(0);

  const internalScrollRef = useAnimatedRef<Animated.ScrollView>();
  const effectiveScrollRef = (mainScrollRef || internalScrollRef) as any;

  const pendingTargetScrollYRef = useRef(0);
  const pendingTargetSlotsRef = useRef<SlotState[][] | null>(null);
  const pendingTargetLayoutRef = useRef<MasonryLayout<T> | null>(null);
  const pendingAutoCommitRef = useRef<number | null>(null);
  const pendingScrollRestorationRef = useRef<number | null>(null);
  const transitionWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitTransitionRef = useRef<(cols: number) => void>(() => {});
  const transitionCardsRef = useRef<TransitionCardData<T>[] | null>(null);
  // Layout cache: avoids re-running O(N) buildMasonryLayout for column counts we've already computed
  const layoutCacheRef = useRef<Map<number, MasonryLayout<T>>>(new Map());

  // ─── Stable callback refs for the pinch gesture (prevents gesture handler recreation) ───
  const startInteractiveTransitionRef = useRef<(cols: number, fX: number, fY: number) => void>(() => {});
  const cancelTransitionRef = useRef<() => void>(() => {});
  const finalizeGestureIfStuckRef = useRef<() => void>(() => {});

  const commitTransitionOnJS = useCallback((cols: number) => {
    commitTransitionRef.current?.(cols);
  }, []);

  // Stable wrappers for gesture callbacks — identity never changes, so gesture is never recreated:
  const startTransitionOnJS = useCallback((cols: number, fX: number, fY: number) => {
    startInteractiveTransitionRef.current?.(cols, fX, fY);
  }, []);

  const cancelTransitionOnJS = useCallback(() => {
    cancelTransitionRef.current?.();
  }, []);

  const finalizeGestureOnJS = useCallback(() => {
    finalizeGestureIfStuckRef.current?.();
  }, []);

  const setPendingAutoCommit = useCallback((cols: number) => {
    if (transitionCardsRef.current && transitionCardsRef.current.length > 0) {
      pendingAutoCommitRef.current = null;
      isFlightAnimatingShared.value = true;
      hasTransitionCardsShared.value = true;
      overlayOpacity.value = 1;
      isBaseGridRevealedShared.value = false;
      const startP = transitionProgress.value;
      const duration = Math.round(Math.max(240, (1 - startP) * 300));
      transitionProgress.value = withTiming(1, {
        duration,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      }, (finished) => {
        'worklet';
        runOnJS(commitTransitionOnJS)(cols);
      });
    } else {
      pendingAutoCommitRef.current = cols;
    }
  }, [commitTransitionOnJS, transitionProgress, isFlightAnimatingShared, hasTransitionCardsShared, overlayOpacity, isBaseGridRevealedShared]);

  const clearPendingAutoCommit = useCallback(() => {
    pendingAutoCommitRef.current = null;
  }, []);

  // ─── Component State ───────────────────────────────────────────────────────
  const [currentCols, setCurrentCols] = useState<number>(() => {
    return Math.max(minColumns, Math.min(maxColumns, numColumnsProp || 2));
  });

  const [containerMinHeight, setContainerMinHeight] = useState<number>(0);
  const [isPinchingState, setIsPinchingState] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionCards, setTransitionCards] = useState<TransitionCardData<T>[] | null>(null);

  const finalizeGestureIfStuck = useCallback(() => {
    setIsPinchingState(false);
    if (!isTransitioningRef.current) {
      isTransitioningShared.value = false;
      isScrollRestoringShared.value = false;
      isFlightAnimatingShared.value = false;
    }
  }, [isTransitioningShared, isScrollRestoringShared, isFlightAnimatingShared]);
  finalizeGestureIfStuckRef.current = finalizeGestureIfStuck;

  useEffect(() => {
    transitionCardsRef.current = transitionCards;
    if (transitionCards && transitionCards.length > 0) {
      hasTransitionCardsShared.value = true;
      isBaseGridRevealedShared.value = false;
      overlayOpacity.value = 1; // Overlay covers grid instantly

      if (pendingAutoCommitRef.current !== null) {
        const toCols = pendingAutoCommitRef.current;
        pendingAutoCommitRef.current = null;
        isFlightAnimatingShared.value = true;
        const startP = transitionProgress.value;
        const duration = Math.round(Math.max(240, (1 - startP) * 300));
        transitionProgress.value = withTiming(1, {
          duration,
          easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        }, (finished) => {
          'worklet';
          runOnJS(commitTransitionOnJS)(toCols);
        });
      }
    } else {
      hasTransitionCardsShared.value = false;
      isBaseGridRevealedShared.value = false;
      pendingAutoCommitRef.current = null;
      transitionProgress.value = 0;
      overlayOpacity.value = 0;
    }
  }, [transitionCards, hasTransitionCardsShared, transitionProgress, commitTransitionOnJS, overlayOpacity, isFlightAnimatingShared, isBaseGridRevealedShared]);

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
    // Invalidate layout cache — data changed, cached layouts are stale
    layoutCacheRef.current.clear();
  }, [data]);

  const trailingUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRenderedYRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (trailingUpdateTimerRef.current) {
        clearTimeout(trailingUpdateTimerRef.current);
        trailingUpdateTimerRef.current = null;
      }
    };
  }, []);

  // ─── Slot Updates from Scroll Worklet ──────────────────────────────────────
  const updateSlotsFromY = useCallback((y: number, force: boolean = false) => {
    // Use the ref guard — it's always synchronously correct unlike React state (isPinchingState, isTransitioning)
    if (isTransitioningRef.current) return;

    scrollYRef.current = y;
    const now = Date.now();
    const timeDelta = now - lastUpdateRef.current;
    const distDelta = Math.abs(y - lastRenderedYRef.current);

    // Dynamic threshold:
    // On Android, don't re-render React on every 16ms if the scroll has only moved a few pixels!
    // A card is ~200-250px tall, so moving 40px doesn't change visible cards in the pool.
    // Throttling by time delta AND distance delta frees up the JS thread for 60/120fps scrolling!
    const minTimeDelta = Platform.OS === 'android' ? 32 : 16;
    const minDistDelta = Platform.OS === 'android' ? 45 : 30;

    if (!force && (timeDelta < minTimeDelta || distDelta < minDistDelta)) {
      if (trailingUpdateTimerRef.current) {
        clearTimeout(trailingUpdateTimerRef.current);
      }
      trailingUpdateTimerRef.current = setTimeout(() => {
        updateSlotsFromY(scrollYRef.current, true);
      }, minTimeDelta + 16);
      return;
    }
    if (trailingUpdateTimerRef.current) {
      clearTimeout(trailingUpdateTimerRef.current);
      trailingUpdateTimerRef.current = null;
    }
    lastUpdateRef.current = now;
    lastRenderedYRef.current = y;

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
          if (it.topY > viewBottom) break; // Items are ordered vertically, stop once past bottom
          if (it.topY + it.height >= viewTop) {
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
  }, [headerHeight, onEndReached, onEndReachedThreshold, poolSize]);

  useAnimatedReaction(
    () => scrollSharedValue?.value ?? 0,
    (y) => {
      'worklet';
      if (!isPinching.value && !isTransitioningShared.value && !isScrollRestoringShared.value) {
        runOnJS(updateSlotsFromY)(y);
      }
    },
    [updateSlotsFromY],
  );


  // ─── Real-Time Scroll Synchronization During Pinch Transition ─────────────
  useAnimatedReaction(
    () => {
      'worklet';
      if (
        hasTransitionCardsShared.value &&
        (isTransitioningShared.value || isFlightAnimatingShared.value)
      ) {
        const fromY = fromScrollYShared.value;
        const toY = targetScrollYShared.value;
        const p = transitionProgress.value;
        return fromY + p * (toY - fromY);
      }
      return null;
    },
    (interpolatedY, prevY) => {
      'worklet';
      if (interpolatedY !== null && interpolatedY !== prevY && effectiveScrollRef) {
        scrollTo(effectiveScrollRef, 0, interpolatedY, false);
        if (scrollSharedValue) {
          scrollSharedValue.value = interpolatedY;
        }
      }
    },
    [effectiveScrollRef, scrollSharedValue],
  );

  // ─── Native Scroll Dispatcher ──────────────────────────────────────────────
  const performScrollTo = useCallback((targetY: number) => {
    scrollYRef.current = targetY;
    if (scrollSharedValue) {
      scrollSharedValue.value = targetY;
    }
    try {
      if (effectiveScrollRef?.current && typeof (effectiveScrollRef.current as any).scrollTo === 'function') {
        (effectiveScrollRef.current as any).scrollTo({ y: targetY, animated: false });
      }
    } catch (_e) {}
    try {
      runOnUI((y: number) => {
        'worklet';
        scrollTo(effectiveScrollRef, 0, y, false);
      })(targetY);
    } catch (_e2) {}
  }, [effectiveScrollRef, scrollSharedValue]);

  // ─── Apple Photos Interactive Flight Transition ───────────────────────────
  // Internal cleanup — called AFTER the dissolve animation finishes
  const cleanupAfterTransition = useCallback(() => {
    setTransitionCards(null);
    transitionCardsRef.current = null;
    hasTransitionCardsShared.value = false;
    isBaseGridRevealedShared.value = false;
    isFlightAnimatingShared.value = false;
    isTransitioningShared.value = false;
    isTransitioningRef.current = false;
    setIsTransitioning(false);
    setIsPinchingState(false);
    if (isPinchingShared) isPinchingShared.value = false;
    isPinching.value = false;
    transitionProgress.value = 0;
    overlayOpacity.value = 0;
  }, [hasTransitionCardsShared, transitionProgress, isFlightAnimatingShared, overlayOpacity, isBaseGridRevealedShared, isTransitioningShared, isPinching, isPinchingShared]);

  const finalizeCommit = useCallback(() => {
    if (transitionWatchdogTimerRef.current) {
      clearTimeout(transitionWatchdogTimerRef.current);
      transitionWatchdogTimerRef.current = null;
    }
    pendingAutoCommitRef.current = null;
    isFlightAnimatingShared.value = false;
    isTransitioningShared.value = false;
    isTransitioningRef.current = false;
    setIsTransitioning(false);
    setIsPinchingState(false);
    if (isPinchingShared) isPinchingShared.value = false;
    isPinching.value = false;
    pinchDirection.value = 0;

    // 1. Reveal base grid at 100% solid opacity UNDERNEATH the overlay.
    // The overlay is currently at 100% opacity on top of it, so this handoff is visually seamless.
    isBaseGridRevealedShared.value = true;

    // 2. Smooth dissolve: fade overlay out from 1 → 0 over 140ms.
    // Since base grid underneath is ALREADY 100% solid, NO cream/white background can bleed through!
    overlayOpacity.value = withTiming(0, {
      duration: 140,
      easing: Easing.out(Easing.quad),
    }, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(cleanupAfterTransition)();
      }
    });
  }, [isTransitioningShared, isFlightAnimatingShared, isPinching, isPinchingShared, pinchDirection, overlayOpacity, cleanupAfterTransition, isBaseGridRevealedShared]);

  const commitTransition = useCallback((targetCols: number) => {
    if (transitionWatchdogTimerRef.current) {
      clearTimeout(transitionWatchdogTimerRef.current);
      transitionWatchdogTimerRef.current = null;
    }
    const targetScrollY = pendingTargetScrollYRef.current;
    const targetSlots = pendingTargetSlotsRef.current;
    const targetLayout = pendingTargetLayoutRef.current;

    // 1. Immediately switch base grid state to target columns and slots:
    if (targetLayout && targetSlots) {
      isScrollRestoringShared.value = true;
      pendingScrollRestorationRef.current = targetScrollY;
      currentColsShared.value = targetCols;
      setCurrentCols(targetCols);
      setColumnSlots(targetSlots);
      columnSlotsRef.current = targetSlots;
      layoutRef.current = targetLayout;
      setContainerMinHeight(targetLayout.maxHeight + headerHeightRef.current);

      // Scroll to target position — first call is immediate, second lands after React commits
      performScrollTo(targetScrollY);
      requestAnimationFrame(() => {
        performScrollTo(targetScrollY);
        isScrollRestoringShared.value = false;
      });
    }

    onNumColumnsChange?.(targetCols);

    // 2. Seamless hand-off: wait 3 paint frames so native views have fully laid out and
    // expo-image has resolved memory cache bitmaps before revealing base grid & dissolving overlay:
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          finalizeCommit();
        });
      });
    });
  }, [performScrollTo, onNumColumnsChange, finalizeCommit, currentColsShared, isScrollRestoringShared]);
  commitTransitionRef.current = commitTransition;

  const cancelTransition = useCallback(() => {
    if (transitionWatchdogTimerRef.current) {
      clearTimeout(transitionWatchdogTimerRef.current);
      transitionWatchdogTimerRef.current = null;
    }
    pendingAutoCommitRef.current = null;
    isScrollRestoringShared.value = false;
    isFlightAnimatingShared.value = false;
    isTransitioningShared.value = false;
    isTransitioningRef.current = false;
    setIsTransitioning(false);
    setIsPinchingState(false);
    if (isPinchingShared) isPinchingShared.value = false;
    isPinching.value = false;
    pinchDirection.value = 0;
    // Reset expanded container height (was inflated for the transition target):
    setContainerMinHeight(0);
    // Restore scroll position to fromScrollY:
    performScrollTo(fromScrollYShared.value);

    // Reveal base grid (which has original layout) at solid opacity 1:
    isBaseGridRevealedShared.value = true;

    // Dissolve overlay out, then clean up cards:
    overlayOpacity.value = withTiming(0, {
      duration: 140,
      easing: Easing.out(Easing.quad),
    }, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(cleanupAfterTransition)();
      }
    });
  }, [isScrollRestoringShared, isFlightAnimatingShared, isTransitioningShared, isPinching, isPinchingShared, pinchDirection, overlayOpacity, cleanupAfterTransition, performScrollTo, fromScrollYShared, isBaseGridRevealedShared]);
  cancelTransitionRef.current = cancelTransition;

  const startInteractiveTransition = useCallback((
    targetCols: number,
    focalX: number,
    focalY: number,
  ) => {
    // Guard: reject if invalid cols, same cols, or already mid-transition on JS thread
    if (targetCols < minColumns || targetCols > maxColumns || targetCols === currentCols) {
      return;
    }
    if (isTransitioningRef.current) {
      return;
    }

    // Safety watchdog: only fires AFTER the gesture has ended and something got stuck.
    // Must NOT fire during an active pinch-and-hold — that would destroy and rebuild
    // the transition every cycle, causing the cards to vibrate/refresh endlessly.
    if (transitionWatchdogTimerRef.current) {
      clearTimeout(transitionWatchdogTimerRef.current);
    }
    transitionWatchdogTimerRef.current = setTimeout(() => {
      // Only force-finalize if the pinch gesture is done but transition is still stuck
      if (isTransitioningRef.current && !isPinching.value) {
        finalizeCommit();
      }
    }, 1500); // 6000ms for slow-mo testing

    // Use fromScrollYShared (recorded on UI thread at pinch start) or scrollYRef fallback
    const currentScrollY = Math.max(0, fromScrollYShared.value || scrollYRef.current);
    const currentHeaderHeight = headerHeightRef.current;
    const currentLayout = layoutRef.current;

    // Use cached layout if available — avoids O(N) buildMasonryLayout on repeated pinches
    let targetLayout = layoutCacheRef.current.get(targetCols);
    if (!targetLayout) {
      targetLayout = buildMasonryLayout(dataRef.current, targetCols, SCREEN_WIDTH);
      layoutCacheRef.current.set(targetCols, targetLayout);
    }
    // Also cache current layout for future reverse pinch (e.g. 3→2→3)
    if (!layoutCacheRef.current.has(currentCols)) {
      layoutCacheRef.current.set(currentCols, currentLayout);
    }

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

    fromScrollYShared.value = currentScrollY;
    targetScrollYShared.value = targetScrollY;

    // Immediately expand minHeight so iOS UIScrollView does not clamp targetScrollY:
    setContainerMinHeight(Math.max(currentLayout.maxHeight, targetLayout.maxHeight) + currentHeaderHeight);

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
    transitionCardsRef.current = cards;
    overlayOpacity.value = 1;
    setIsTransitioning(true);
    isTransitioningRef.current = true;
  }, [currentCols, minColumns, maxColumns, finalizeCommit, fromScrollYShared, targetScrollYShared, overlayOpacity]);
  startInteractiveTransitionRef.current = startInteractiveTransition;

  // ─── Pinch Gesture with Real-Time Interactive Column Flight ─────────────────
  // CRITICAL: This useMemo only depends on STABLE values (shared values from useSharedValue
  // which never change identity, enablePinchToZoom, mainScrollRef, minColumns, maxColumns).
  // All JS callbacks are routed through stable ref wrappers (startTransitionOnJS, cancelTransitionOnJS,
  // finalizeGestureOnJS, commitTransitionOnJS) whose identities never change.
  // This prevents GestureDetector from destroying and reinstalling the gesture handler
  // every time a column change triggers callback recreation.
  const pinchGesture = useMemo(() => {
    let g = Gesture.Pinch()
      .enabled(enablePinchToZoom)
      .cancelsTouchesInView(true);

    if (effectiveScrollRef) {
      g = (g as any).simultaneousWithExternalGesture(effectiveScrollRef);
    }

    return g
      .onStart((e) => {
        'worklet';
        if (isFlightAnimatingShared.value || isTransitioningShared.value) {
          isGestureAcceptedShared.value = false;
          return;
        }

        gestureStartTimeShared.value = Date.now();
        isGestureAcceptedShared.value = true;
        isPinching.value = true;
        if (isPinchingShared) isPinchingShared.value = true;
        focalXShared.value = e.focalX;
        focalYShared.value = e.focalY;
        pinchDirection.value = 0;
        transitionProgress.value = 0;
        hasTransitionCardsShared.value = false;
        isBaseGridRevealedShared.value = false;
        overlayOpacity.value = 0;
        const startY = scrollSharedValue ? Math.max(0, scrollSharedValue.value) : 0;
        fromScrollYShared.value = startY;
        targetScrollYShared.value = startY;
        runOnJS(setIsPinchingState)(true);
      })
      .onUpdate((e) => {
        'worklet';
        if (!isGestureAcceptedShared.value || isFlightAnimatingShared.value) {
          return;
        }

        focalXShared.value = e.focalX;
        focalYShared.value = e.focalY;

        // Detect pinch direction as fingers move:
        if (pinchDirection.value === 0) {
          if (e.scale < 0.985 && currentColsShared.value < maxColumns) {
            pinchDirection.value = 1; // Pinch in -> Add column (e.g. 2 -> 3)
            targetColsShared.value = currentColsShared.value + 1;
            isTransitioningShared.value = true;
            runOnJS(startTransitionOnJS)(currentColsShared.value + 1, e.focalX, e.focalY);
          } else if (e.scale > 1.015 && currentColsShared.value > minColumns) {
            pinchDirection.value = -1; // Pinch out -> Remove column (e.g. 3 -> 2, 2 -> 1)
            targetColsShared.value = currentColsShared.value - 1;
            isTransitioningShared.value = true;
            runOnJS(startTransitionOnJS)(currentColsShared.value - 1, e.focalX, e.focalY);
          }
        }

        // Live interactive gesture flight progress while user holds and moves fingers:
        // Capped at 0.60 so releasing fingers always triggers a full, smooth 240ms+ flight into final slots!
        if (pinchDirection.value !== 0) {
          let targetP = 0;
          if (pinchDirection.value === 1) {
            // Pinch-in: scale goes from 0.985 down to ~0.65 (cap interactive progress at 0.60)
            const rawP = Math.max(0, (0.985 - e.scale) / 0.35);
            targetP = Math.min(0.60, rawP);
          } else if (pinchDirection.value === -1) {
            // Pinch-out: scale goes from 1.015 up to ~1.45 (cap interactive progress at 0.60)
            const rawP = Math.max(0, (e.scale - 1.015) / 0.45);
            targetP = Math.min(0.60, rawP);
          }

          if (hasTransitionCardsShared.value) {
            transitionProgress.value = targetP;
          }
        }
      })
      .onEnd((e) => {
        'worklet';
        if (!isGestureAcceptedShared.value) {
          return;
        }
        isGestureAcceptedShared.value = false;

        if (isFlightAnimatingShared.value) {
          return;
        }

        isPinching.value = false;
        if (isPinchingShared) isPinchingShared.value = false;

        if (pinchDirection.value !== 0) {
          const currentP = transitionProgress.value;
          const targetCols = targetColsShared.value;
          const isPinchIn = pinchDirection.value === 1;
          const scaleDelta = isPinchIn ? (1 - e.scale) : (e.scale - 1);
          const hasVelocity = isPinchIn ? (e.velocity < -0.15) : (e.velocity > 0.15);

          // Intentional pinch if user moved >= 0.05 progress, scale delta >= 0.015, or flicked with velocity:
          const isIntentional = currentP >= 0.05 || scaleDelta >= 0.015 || hasVelocity;

          if (isIntentional) {
            if (hasTransitionCardsShared.value) {
              const remaining = 1 - currentP;
              // Minimum 240ms so the user ALWAYS sees the complete, smooth flight animation into the final slots!
              const flightDuration = Math.round(Math.max(240, remaining * 300));

              isFlightAnimatingShared.value = true;
              transitionProgress.value = withTiming(1, {
                duration: flightDuration,
                easing: Easing.bezier(0.25, 0.1, 0.25, 1),
              }, (finished) => {
                'worklet';
                runOnJS(commitTransitionOnJS)(targetCols);
              });
            } else {
              runOnJS(setPendingAutoCommit)(targetCols);
            }
          } else {
            runOnJS(clearPendingAutoCommit)();
            if (currentP > 0.01) {
              const cancelDuration = Math.max(150, Math.round(currentP * 250));
              transitionProgress.value = withTiming(0, {
                duration: cancelDuration,
                easing: Easing.bezier(0.25, 0.1, 0.25, 1),
              }, (finished) => {
                'worklet';
                runOnJS(cancelTransitionOnJS)();
              });
            } else {
              runOnJS(cancelTransitionOnJS)();
            }
          }
        } else {
          runOnJS(setIsPinchingState)(false);
          isTransitioningShared.value = false;
        }
      })
      .onFinalize(() => {
        'worklet';
        isGestureAcceptedShared.value = false;
        isPinching.value = false;
        if (isPinchingShared) isPinchingShared.value = false;
        runOnJS(finalizeGestureOnJS)();
      });
  }, [
    enablePinchToZoom,
    effectiveScrollRef,
    isPinchingShared,
    scrollSharedValue,
    // All of these are useSharedValue — their identity is STABLE across renders:
    isPinching,
    isTransitioningShared,
    hasTransitionCardsShared,
    isFlightAnimatingShared,
    isGestureAcceptedShared,
    gestureStartTimeShared,
    focalXShared,
    focalYShared,
    pinchDirection,
    targetColsShared,
    transitionProgress,
    currentColsShared,
    fromScrollYShared,
    targetScrollYShared,
    overlayOpacity,
    maxColumns,
    minColumns,
    // All of these are stable useCallback with [] deps — identity NEVER changes:
    startTransitionOnJS,
    commitTransitionOnJS,
    cancelTransitionOnJS,
    setPendingAutoCommit,
    clearPendingAutoCommit,
    finalizeGestureOnJS,
  ]);

  // ─── Overlay / Grid Visibility Animated Styles ──────────────────────────────
  // Uses overlayOpacity (animated 1→0 cross-fade) instead of binary flip:
  const overlayAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: overlayOpacity.value,
    };
  });

  const gridVisibilityStyle = useAnimatedStyle(() => {
    'worklet';
    if (hasTransitionCardsShared.value) {
      // While transition cards are flying in the overlay, hide base grid (0% opacity).
      // At commit handoff, reveal base grid at solid 100% opacity BEFORE overlay dissolves,
      // guaranteeing the light/cream background NEVER bleeds through (zero white flash).
      const opacity = isBaseGridRevealedShared.value ? 1 : 0;
      return {
        opacity,
        transform: [{ scale: 1 }],
      };
    }
    return { opacity: 1, transform: [{ scale: 1 }] };
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
            ref={effectiveScrollRef}
            onScroll={onScroll}
            scrollEventThrottle={scrollEventThrottle}
            showsVerticalScrollIndicator={false}
            scrollEnabled={!isPinchingState && !isTransitioning}
            stickyHeaderIndices={renderStickyHeader ? [1] : undefined}
            removeClippedSubviews={Platform.OS === 'android'}
            style={styles.scrollView}
            contentContainerStyle={[
              styles.contentContainer,
              { minHeight: Math.max(layout.maxHeight + headerHeight, containerMinHeight, minContentHeight || 0) },
              contentContainerStyle,
            ]}
            onContentSizeChange={(_w, _h) => {
              // Fallback: if RAF-based restoration already cleared pendingScrollRestorationRef,
              // this no-ops. If somehow the RAF fired before native content grew (unlikely), this catches it.
              if (pendingScrollRestorationRef.current !== null) {
                const targetY = pendingScrollRestorationRef.current;
                pendingScrollRestorationRef.current = null;
                performScrollTo(targetY);
              }
            }}
            refreshControl={refreshControl}
            onMomentumScrollEnd={(e) => {
              updateSlotsFromY(e.nativeEvent.contentOffset.y, true);
              onMomentumScrollEnd?.(e);
            }}
            onScrollEndDrag={(e) => {
              updateSlotsFromY(e.nativeEvent.contentOffset.y, true);
              onScrollEndDrag?.(e);
            }}
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

            {/* Child 2: Base Recycled Masonry Grid or Empty State */}
            {data.length === 0 ? (
              ListEmptyComponent ? (
                <View style={styles.emptyContainer}>
                  {typeof ListEmptyComponent === 'function' ? (ListEmptyComponent as any)() : ListEmptyComponent}
                </View>
              ) : null
            ) : (
              <Animated.View
                style={[
                  styles.gridRow,
                  {
                    alignSelf: 'center',
                    width: layout.columns.length * layout.colWidth + Math.max(0, layout.columns.length - 1) * (layout.colGap ?? getCardGapForCols(currentCols)),
                  },
                  gridVisibilityStyle,
                ]}
              >
                {layout.columns.map((col, colIdx) => {
                  const isLastCol = colIdx === layout.columns.length - 1;
                  const slots = columnSlots[colIdx] || [];
                  const gap = layout.colGap ?? getCardGapForCols(currentCols);

                  return (
                    <View
                      key={`col-${colIdx}`}
                      style={[
                        styles.column,
                        {
                          width: layout.colWidth,
                          height: col.height,
                          marginRight: isLastCol ? 0 : gap,
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
            )}

            {data.length > 0 ? renderedFooter : null}
          </Animated.ScrollView>
        </View>
      </GestureDetector>

      {/* ─── Apple Photos Flight Transition Overlay ─────────────────────── */}
      {transitionCards && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: 'transparent' },
            overlayAnimatedStyle,
          ]}
          pointerEvents="none"
        >
          {transitionCards.map((card) => (
            <AnimatingCard
              key={`trans-${card.id}`}
              card={card}
              progress={transitionProgress}
            />
          ))}
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
    backgroundColor: '#ffffff',
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
  playIconOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIconCircleMini: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    width: '100%',
    paddingVertical: 50,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
});
