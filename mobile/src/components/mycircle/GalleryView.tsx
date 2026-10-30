import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Alert,
  StatusBar,
  BackHandler,
  Modal,
  InteractionManager,
  TouchableOpacity,
  Platform,
  Image as RNImage,
  AppState,
} from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MasonryFlashList, getMediaDisplayUri } from '../common/MasonryFlashList';
import { getPhotoAspect, getPhotoCardAspect } from '../../utils/photoDimensionCache';
import { getThumbnailUrl, getFullPhotoUrl } from '../../utils/imageUrl';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { preventScreenCaptureAsync, allowScreenCaptureAsync } from '../../utils/screenCapture';
import { tabEvents, EVENT_SAVES_UPDATED } from '../../lib/tabEvents';
import {
  getStoredFilmstrip,
  persistFilmstripKeyframes,
  getKeyframe150pxUrl,
} from '../../services/filmstripStorage';
import {
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
  TouchableOpacity as GHTouchableOpacity,
  Pressable as GHPressable,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  useAnimatedRef,
  useDerivedValue,
  scrollTo,
  runOnUI,
  withTiming,
  withSpring,
  withDelay,
  runOnJS,
  Easing,
  useAnimatedScrollHandler,
  interpolate,
  interpolateColor,
  type SharedValue,
} from 'react-native-reanimated';
import { usePathname } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useScrollTabBarCollapse } from '../../hooks/useScrollTabBarCollapse';
import api, { guestApi } from '../../services/api';
import { MasonryCard, clearRevealedPhotosCache } from '../home/lightbox/components/MasonryCard';
import { EditorialLightbox, LightboxBounds } from '../home/lightbox/EditorialLightbox';
import { CinemaVideoModal } from '../common/CinemaVideoModal';
import { CinemaLibraryView, formatCinemaCategoryTitleCase, formatCinemaDisplayTitle, classifyCinemaCategory } from '../cinema/CinemaLibraryView';
import { hasActualVideoFile, isVideoComingSoon, isCinemaVideoItem, isHighlightsEligibleCinemaVideo, isVerticalVideo, getValidImageThumbnail } from '../cinema/CinemaVideoCard';
import { videoPreloadManager } from '../../services/videoPreloadManager';
import { videoDownloadManager } from '../../services/videoDownloadManager';
import CameraViewScreen from './CameraView';
import {
  FONT_MONTSERRAT_REGULAR,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';

const { width, height: screenHeight } = Dimensions.get('window');

export function getEstimatedRowHeight(cols: number, screenWidth?: number): number {
  'worklet';
  const sw = (typeof screenWidth === 'number' && screenWidth > 0) ? screenWidth : 390;
  const safeCols = Math.max(1, Math.min(5, cols || 2));
  const colGap = safeCols === 1 ? 5 : safeCols === 2 ? 5 : safeCols === 3 ? 4 : safeCols === 4 ? 3 : 2;
  const horizontalMargin = 6;
  const totalGaps = colGap * Math.max(0, safeCols - 1);
  const availableWidth = sw - (horizontalMargin * 2) - totalGaps;
  const colWidth = Math.max(30, availableWidth / safeCols);
  const cardHeight = Math.round(colWidth / 0.75);
  return cardHeight + colGap;
}

function getPhotoScrollOffset(
  photoIndex: number,
  totalPhotos: number,
  photoOffsets: number[],
  contentHeight: number,
  viewportHeight: number,
  heroHeight: number,
): number {
  'worklet';
  const safeTotal = typeof totalPhotos === 'number' && totalPhotos > 0 ? totalPhotos : 1;
  const safeContent = typeof contentHeight === 'number' && contentHeight > 0 ? contentHeight : 0;
  const safeViewport = typeof viewportHeight === 'number' && viewportHeight > 0 ? viewportHeight : 800;
  const safeHero = typeof heroHeight === 'number' && heroHeight > 0 ? heroHeight : 560;

  // Approximate ~260px per row as reliable fallback if contentHeight is unmeasured
  const estimatedTotalH = safeHero + 107 + Math.ceil(safeTotal / 2) * 260 + 140;
  const effectiveContentHeight = Math.max(safeContent, estimatedTotalH);
  const maxScroll = Math.max(0, effectiveContentHeight - safeViewport);
  const safeIndex = Math.max(0, Math.min(safeTotal - 1, photoIndex || 0));

  if (safeIndex >= safeTotal - 1) {
    return maxScroll;
  }
  if (safeIndex <= 0) {
    return 0;
  }

  if (photoOffsets && photoOffsets.length > 0) {
    const lowerIndex = Math.floor(safeIndex);
    const upperIndex = Math.ceil(safeIndex);
    const lowerTop = photoOffsets[lowerIndex];
    const upperTop = photoOffsets[upperIndex];
    if (lowerTop !== undefined && upperTop !== undefined) {
      const fraction = safeIndex - lowerIndex;
      const photoTop = lowerTop + (upperTop - lowerTop) * fraction;
      return Math.min(maxScroll, Math.max(0, photoTop - safeViewport * 0.25));
    }
    if (lowerTop !== undefined && Math.abs(lowerIndex - safeIndex) < 2) {
      return Math.min(maxScroll, Math.max(0, lowerTop - safeViewport * 0.25));
    }
    if (upperTop !== undefined && Math.abs(upperIndex - safeIndex) < 2) {
      return Math.min(maxScroll, Math.max(0, upperTop - safeViewport * 0.25));
    }
  }

  const progress = safeIndex / Math.max(1, safeTotal - 1);
  return Math.min(maxScroll, Math.max(0, safeHero + progress * Math.max(0, maxScroll - safeHero)));
}

function getPhotoIndexAtScrollOffset(
  scrollOffset: number,
  totalPhotos: number,
  photoEntries: number[],
  contentHeight: number,
  viewportHeight: number,
  heroHeight: number,
): number {
  'worklet';
  const safeTotal = typeof totalPhotos === 'number' && totalPhotos > 0 ? totalPhotos : 1;
  const maxPhotoIndex = Math.max(0, safeTotal - 1);
  const safeContent = typeof contentHeight === 'number' && contentHeight > 0 ? contentHeight : 0;
  const safeViewport = typeof viewportHeight === 'number' && viewportHeight > 0 ? viewportHeight : 800;
  const safeHero = typeof heroHeight === 'number' && heroHeight > 0 ? heroHeight : 560;

  const estimatedTotalH = safeHero + 107 + Math.ceil(safeTotal / 2) * 260 + 140;
  const effectiveContentHeight = Math.max(safeContent, estimatedTotalH);
  const maxScroll = Math.max(0, effectiveContentHeight - safeViewport);
  const gridSpan = Math.max(1, maxScroll - safeHero);

  const safeOffset = typeof scrollOffset === 'number' && !isNaN(scrollOffset) ? scrollOffset : 0;

  if (safeOffset <= safeHero) {
    return 0;
  }
  if (safeOffset >= maxScroll - 50) {
    return maxPhotoIndex;
  }

  const targetY = safeOffset + safeViewport * 0.25;
  if (photoEntries && photoEntries.length >= 2) {
    const entryCount = Math.floor(photoEntries.length / 2);
    let lower = 0;
    let upper = entryCount - 1;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (photoEntries[middle * 2] < targetY) lower = middle + 1;
      else upper = middle;
    }
    const previous = Math.max(0, lower - 1);
    const currentTop = photoEntries[lower * 2];
    const previousTop = photoEntries[previous * 2];
    const chosen = Math.abs(currentTop - targetY) < Math.abs(previousTop - targetY) ? lower : previous;
    const chosenTop = photoEntries[chosen * 2];
    // ONLY snap to a rendered card if it is actually within 1.5 viewport heights of targetY.
    // If further away, targetY is in an unloaded gap, so fall through to proportional estimation!
    if (typeof chosenTop === 'number' && Math.abs(chosenTop - targetY) <= safeViewport * 1.5) {
      const foundIdx = photoEntries[chosen * 2 + 1];
      if (typeof foundIdx === 'number' && !isNaN(foundIdx)) {
        return Math.min(maxPhotoIndex, foundIdx);
      }
    }
  }

  const progress = Math.max(0, Math.min(1, (safeOffset - safeHero) / gridSpan));
  return progress * maxPhotoIndex;
}

interface Photo {
  id: number;
  r2Url: string;
  width?: number;
  height?: number;
  aspectRatio?: number | null;
  cardAspect?: number;
  isLiked?: boolean;
  likeCount?: number;
  isVideo?: boolean;
  isComingSoon?: boolean;
  subtitle?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  [key: string]: any;
}

export interface FilmstripKeyframe {
  index: number;
  id: number;
  r2Url: string;
  thumbnailUrl: string;
  tabName?: string;
  localPath?: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  cinemaCategory?: string;
}

export interface FilmstripData {
  total: number;
  step: number;
  tab: string;
  keyframes: FilmstripKeyframe[];
}

export function isVideoMedia(p: any): boolean {
  if (!p) return false;
  if (p.tabName && p.tabName.trim().toUpperCase() === 'CINEMA') return true;
  if (p.isVideo) return true;
  if (p.isComingSoon || p.comingSoon || p.exif?.isComingSoon || p.exif?.comingSoon || p.meta?.isComingSoon) return true;
  const url = (p.r2Url || p.file_url || p.fullUri || p.photoUrl || p.uri || p.filename || '').toLowerCase();
  return url.endsWith('.mp4') || url.endsWith('.mov') || url.endsWith('.m4v') || url.includes('/videos/');
}

export function getCinemaDownloadPriority(v: any, index: number = 0): number {
  if (!v) return 20;
  const cat = classifyCinemaCategory(v as any);
  if (cat.includes('DIRECTOR') || v.isFeatured || index === 0) return 100;
  if (cat.includes('CANDID') || cat.includes('REEL') || isVerticalVideo(v as any)) return 80;
  return 20;
}

function mapPhotoItem(p: any): Photo {
  const isVideo = isVideoMedia(p);
  const isPhotoFile = !hasActualVideoFile(p);
  const isComingSoon = isVideoComingSoon(p);
  const isBaked = Boolean(
    p.hasBakedCover ||
    p.isCoverBaked ||
    p.meta?.hasBakedCover ||
    p.raw?.hasBakedCover ||
    p.exif?.hasBakedCover ||
    p.exif?.isCoverBaked ||
    p.raw?.exif?.hasBakedCover ||
    p.raw?.exif?.isCoverBaked
  );

  const fullUri = (isVideo && !isPhotoFile)
    ? (p.r2Url || p.file_url || p.fullUri || p.photoUrl || p.uri || '')
    : getFullPhotoUrl(p);

  const cinemaCover = (isVideo || isCinemaVideoItem(p)) ? getValidImageThumbnail(p) : undefined;
  let rawThumb = cinemaCover || p.thumbnailUrl || p.thumbUri || p.preview_url || p.coverUrl || p.cover_url || p.posterUrl || p.poster_url || p.coverPhotoUrl || p.cover_photo_url || p.exif?.posterUrl || p.exif?.coverUrl;
  if (typeof rawThumb === 'string' && rawThumb.startsWith('/')) {
    rawThumb = `https://mycircle.mistyvisuals.com${rawThumb}`;
  }
  const isVideoUrl = (u: string) => {
    const l = u.toLowerCase();
    return l.split('?')[0].endsWith('.mp4') || l.split('?')[0].endsWith('.mov') || l.split('?')[0].endsWith('.m4v') || l.includes('.mp4') || l.includes('.mov') || l.includes('.m4v');
  };
  const isImageThumb = typeof rawThumb === 'string' && rawThumb.startsWith('http') && !isVideoUrl(rawThumb);
  const validThumb = isImageThumb ? rawThumb : undefined;
  const thumbUri = validThumb || (isVideo && !isPhotoFile ? undefined : getThumbnailUrl(p, 400));
  const isActualVideo = isVideo && !isPhotoFile;
  const isReel = isVideo && isVerticalVideo(p);
  const defaultW = isVideo ? (isReel ? 9 : 16) : 0;
  const defaultH = isVideo ? (isReel ? 16 : 9) : 0;
  const defaultAspect = isVideo ? (isReel ? 9 / 16 : 16 / 9) : null;
  const w = Number(p.width) || Number(p.videoWidth) || Number(p.exif?.videoWidth) || Number(p.img_width) || Number(p.imageWidth) || Number(p.meta?.width) || Number(p.metadata?.width) || Number(p.exif?.PixelXDimension) || Number(p.exif?.ImageWidth) || defaultW;
  const h = Number(p.height) || Number(p.videoHeight) || Number(p.exif?.videoHeight) || Number(p.img_height) || Number(p.imageHeight) || Number(p.meta?.height) || Number(p.metadata?.height) || Number(p.exif?.PixelYDimension) || Number(p.exif?.ImageHeight) || defaultH;
  // For actual videos, use actual video dimensions (w/h) so 16:9 widescreen films are never misclassified by their 4:3/2:3 portrait poster thumbnail
  const cachedAspect = isActualVideo ? null : (getPhotoAspect(p.id) || getPhotoAspect(thumbUri) || getPhotoAspect(fullUri));
  const aspectRatio = isActualVideo
    ? (w > 0 && h > 0 ? w / h : (defaultAspect || 16 / 9))
    : (cachedAspect || (w > 0 && h > 0 ? w / h : (Number(p.aspectRatio) || Number(p.aspect_ratio) || null)));
  return {
    id: p.id,
    r2Url: isVideo ? (isPhotoFile ? fullUri : (p.r2Url || p.file_url || fullUri)) : thumbUri,
    uri: thumbUri || fullUri,
    fullUri: fullUri,
    photoUrl: fullUri,
    videoUrl: isVideo && !isPhotoFile ? fullUri : undefined,
    isVideo,
    isVertical: isReel,
    isReel,
    isComingSoon,
    hasBakedCover: isBaked,
    isCoverBaked: isBaked,
    subtitle: p.subtitle || p.exif?.subtitle || (isComingSoon ? 'COMING SOON • TEASER POSTER' : undefined),
    thumbnailUrl: validThumb || thumbUri || (isVideo ? undefined : fullUri),
    posterUrl: validThumb || thumbUri || undefined,
    coverUrl: validThumb || thumbUri || undefined,
    width: w || undefined,
    height: h || undefined,
    aspectRatio,
    cardAspect: isVideo ? 3 / 4 : undefined,
    blurhash: p.blurhash || p.blur_hash || p.blurHash || null,
    tabName: p.tabName || p.tab_name || null,
    isLiked: typeof p.isLiked === 'boolean' ? p.isLiked : !!(p.likes && p.likes.length > 0),
    likeCount: typeof p.likeCount === 'number' ? p.likeCount : (typeof p.likesCount === 'number' ? p.likesCount : (p._count?.likes || 0)),
    title: p.title || p.exif?.title || p.name || p.caption || p.filename || undefined,
    description: p.description || p.exif?.description || undefined,
    cinemaCategory: p.cinemaCategory || p.exif?.cinemaCategory || (isReel ? 'CANDID DIARIES' : undefined),
    sortOrder: p.sortOrder !== undefined ? p.sortOrder : (p.exif?.sortOrder !== undefined ? p.exif.sortOrder : undefined),
    duration: p.duration || p.meta?.duration || p.metadata?.duration || undefined,
    isFeatured: Boolean(p.isFeatured || p.featured || p.meta?.isFeatured || p.exif?.isFeatured),
    category: p.category || p.videoCategory || p.meta?.category || undefined,
    createdAt:
      p.createdAt ||
      p.created_at ||
      p.uploadedAt ||
      p.uploaded_at ||
      p.uploadDate ||
      p.upload_date ||
      p.addedAt ||
      p.date ||
      p.dateCreated ||
      p.timestamp ||
      p.meta?.createdAt ||
      p.meta?.created_at ||
      p.metadata?.createdAt ||
      p.metadata?.created_at ||
      p.exif?.DateTimeOriginal ||
      p.exif?.CreateDate ||
      undefined,
    created_at: p.created_at || p.createdAt || undefined,
    videoReplacedAt: p.videoReplacedAt || p.exif?.videoReplacedAt || p.meta?.videoReplacedAt || undefined,
    version: p.version || p.exif?.version || p.meta?.version || undefined,
    exif: p.exif || undefined,
    allowDownloads: p.allowDownloads !== undefined ? (p.allowDownloads !== false && p.allow_downloads !== false) : (p.allow_downloads !== undefined ? p.allow_downloads !== false : undefined),
    allow_downloads: p.allow_downloads !== undefined ? (p.allowDownloads !== false && p.allow_downloads !== false) : (p.allowDownloads !== undefined ? p.allowDownloads !== false : undefined),
    eventAllowDownloads: p.eventAllowDownloads !== undefined ? p.eventAllowDownloads : (p.allowDownloads !== undefined ? (p.allowDownloads !== false && p.allow_downloads !== false) : (p.allow_downloads !== undefined ? p.allow_downloads !== false : undefined)),
    eventSlug: p.eventSlug || p.event_slug || undefined,
    raw: p,
  };
}

/**
 * Injects curated cinema videos into photo grids (ALL and HIGHLIGHTS):
 * 1. Director's Cut: inserted at a stable random index within top 20 items (ONLY if not coming soon)
 * 2. Candid Diaries: inserted at a stable random index within top 30 items (ONLY if not coming soon)
 * 3. Performance & Full Film: NEVER injected outside of Cinema (strictly only in Cinema)
 */
function injectCuratedCinemaVideos(
  basePhotos: Photo[],
  cinemaVideos: any[],
  seedKey: string
): Photo[] {
  // 1. Filter pure photos (exclude any items that are already cinema videos, coming soon, or video files)
  const isCinemaOrVideo = (p: any) => {
    if (String(p.tabName || '').trim().toUpperCase() === 'CINEMA') return true;
    if (hasActualVideoFile(p)) return true;
    return false;
  };
  const photosOnly = (basePhotos || []).filter((p) => !isCinemaOrVideo(p) && !isVideoComingSoon(p));

  if (!cinemaVideos || cinemaVideos.length === 0) {
    return photosOnly;
  }

  // 2. Identify eligible Director's Cut and Candid Diaries (STRICTLY when NOT coming soon)
  const directorsCutVideos: any[] = [];
  const candidDiariesVideos: any[] = [];

  cinemaVideos.forEach((v: any) => {
    // Both Director's Cut and Candid Diaries MUST NOT be Coming Soon and MUST have actual video file
    if (isVideoComingSoon(v) || !hasActualVideoFile(v)) return;

    const cat = classifyCinemaCategory(v).toUpperCase();

    // PERFORMANCE and FULL FILM: MUST ONLY BE IN CINEMA! Strictly excluded from ALL and HIGHLIGHTS.
    if (
      cat.includes('STAGE') ||
      cat.includes('SPOTLIGHT') ||
      cat.includes('PERFORMANCE') ||
      cat.includes('DANCE') ||
      cat.includes('EXTENDED') ||
      cat.includes('CUTS') ||
      cat.includes('FULL FILM') ||
      cat.includes('CEREMONY') ||
      cat.includes('CHAPTER')
    ) {
      return;
    }

    if (cat.includes('DIRECTOR')) {
      directorsCutVideos.push(v);
    } else if (cat.includes('CANDID') || cat.includes('DIAR') || cat.includes('REEL') || isVerticalVideo(v)) {
      candidDiariesVideos.push(v);
    }
  });

  const result = [...photosOnly];

  // Helper for deterministic stable pseudo-random index based on video ID and seedKey
  const getStableIndex = (id: any, maxRange: number, salt: number) => {
    const str = `${seedKey}_${id}_${salt}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % Math.max(1, maxRange);
  };

  const usedIndices = new Set<number>();

  // 3. Director's Cut -> random position within top 20 photos
  directorsCutVideos.forEach((v, idx) => {
    const maxBound = Math.min(20, Math.max(1, result.length));
    let targetIdx = getStableIndex(v.id || v.r2Url, maxBound, idx + 77);
    while (usedIndices.has(targetIdx) && targetIdx < Math.min(20, result.length)) {
      targetIdx++;
    }
    usedIndices.add(targetIdx);
    result.splice(targetIdx, 0, {
      ...v,
      cardAspect: 3 / 4,
    });
  });

  // 4. Candid Diaries -> random position within top 30 photos
  candidDiariesVideos.forEach((v, idx) => {
    const maxBound = Math.min(30, Math.max(1, result.length));
    let targetIdx = getStableIndex(v.id || v.r2Url, maxBound, idx + 199);
    while (usedIndices.has(targetIdx) && targetIdx < Math.min(30, result.length)) {
      targetIdx++;
    }
    usedIndices.add(targetIdx);
    result.splice(targetIdx, 0, {
      ...v,
      cardAspect: 3 / 4,
    });
  });

  return result;
}

const loupeCardStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 4,
    top: 0,
    zIndex: 50,
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  stripColumn: {
    width: 62,
    height: 62,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  squareCard: {
    width: 62,
    height: 62,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#18181b',
    borderWidth: 0,
    borderColor: 'transparent',
    position: 'absolute',
    right: 0,
    top: 0,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 10,
  },
});

interface ReelSlotProps {
  targetIdx: number;
  uri: string;
  photoIndex: number;
  continuousPos: SharedValue<number>;
  activeDirection: SharedValue<number>;
  peekTopAnim: SharedValue<number>;
  peekBottomAnim: SharedValue<number>;
  scrollY: SharedValue<number>;
  photoScrollOffsetsShared: SharedValue<number[]>;
  screenHeight: number;
  numColumns: number;
}

const ReelSlot: React.FC<ReelSlotProps> = React.memo(({
  targetIdx,
  uri,
  photoIndex,
  continuousPos,
  activeDirection,
  peekTopAnim,
  peekBottomAnim,
  scrollY,
  photoScrollOffsetsShared,
  screenHeight,
  numColumns,
}) => {
  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    const rawPos = continuousPos.value;
    const safePos = typeof rawPos === 'number' && !isNaN(rawPos) ? rawPos : 0;
    const rawU = targetIdx - safePos;
    const u = isNaN(rawU) ? 0 : rawU;
    const dist = Math.abs(u);

    // If outside visible range (|u| >= 2.5), collapse and hide
    if (dist >= 2.5) {
      return {
        opacity: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        transform: [
          { translateY: u > 0 ? 122 : -122 },
          { scale: 0.01 },
          { translateX: 0 },
        ],
      };
    }

    // Monotonic vertical conveyor position:
    // u = 0 -> center (0)
    // u = 1 -> bottom flank (+56)
    // u = 2 -> bottom peek (+98)
    // u = -1 -> top flank (-56)
    // u = -2 -> top peek (-98)
    const translateY = interpolate(
      u,
      [-2.5, -2, -1, 0, 1, 2, 2.5],
      [-122, -98, -56, 0, 56, 98, 122],
      'clamp'
    );

    // macOS Dock Magnification Wavy Curve:
    // Center: 1.0 peak (62pt)
    // Flank: 0.72 (45pt)
    // Peek: 0.45 (28pt)
    // Edge: 0.01 (tapers seamlessly to zero)
    const finalScale = interpolate(
      dist,
      [0, 0.5, 1.0, 1.5, 2.0, 2.5],
      [1.0, 0.88, 0.72, 0.58, 0.45, 0.01],
      'clamp'
    );

    // Right-edge anchor: keeps all squares flush to the right edge next to the gold bead
    const shiftX = (1 - finalScale) * 31;

    // Base opacity: 1.0 at center, 0.82 at flank, 0.55 at peek, 0 at 2.5
    let op = interpolate(dist, [0, 1.0, 1.8, 2.5], [1.0, 0.82, 0.55, 0], 'clamp');

    // 4th Peek Square directional gating:
    // When below center (u > 1.25), only visible if scrolling DOWN (activeDirection === 1)
    if (u > 1.25) {
      const dirFactor = activeDirection.value === 1 ? peekBottomAnim.value : 0;
      op = op * interpolate(dirFactor, [0, 1], [0, 1], 'clamp');
    }
    // When above center (u < -1.25), only visible if scrolling UP (activeDirection === -1)
    else if (u < -1.25) {
      const dirFactor = activeDirection.value === -1 ? peekTopAnim.value : 0;
      op = op * interpolate(dirFactor, [0, 1], [0, 1], 'clamp');
    }

    const offsets = photoScrollOffsetsShared.value;
    const photoTop = (photoIndex >= 0 && photoIndex < offsets.length)
      ? offsets[photoIndex]
      : Number.NaN;
    const cardH = getEstimatedRowHeight(numColumns, width);
    const viewTop = scrollY.value;
    const viewBottom = viewTop + screenHeight;
    const isOnScreen = typeof photoTop === 'number' && !isNaN(photoTop)
      && photoTop < viewBottom
      && (photoTop + cardH) > viewTop;

    return {
      opacity: op,
      zIndex: Math.round(10 - dist * 3),
      borderColor: isOnScreen ? '#d4af37' : 'transparent',
      borderWidth: isOnScreen ? 1.5 : 0,
      transform: [
        { translateY },
        { scale: Math.max(0.01, finalScale) },
        { translateX: shiftX },
      ],
    };
  });

  return (
    <Animated.View style={[loupeCardStyles.squareCard, animatedStyle]}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        cachePolicy="memory-disk"
        priority="high"
        recyclingKey={uri}
        transition={0}
      />
    </Animated.View>
  );
});

interface SpatialFilmLoupeCardProps {
  thumbnails: string[];
  keyframeIndices?: number[];
  scrollY: SharedValue<number>;
  totalPhotosShared: SharedValue<number>;
  contentHeightShared?: SharedValue<number>;
  photoScrollOffsetsShared: SharedValue<number[]>;
  photoScrollEntriesShared: SharedValue<number[]>;
  loupeOpacity: SharedValue<number>;
  isDraggingLoupeShared: SharedValue<boolean>;
  scrollDirectionShared?: SharedValue<number>;
  mainScrollRef: any;
  insetsTop: number;
  insetsBottom: number;
  screenHeight: number;
  onPressCard?: (index: number) => void;
  onDragEnd?: (finalScrollY: number, targetPhotoIndex?: number) => void;
  numColumns?: number;
}

const SpatialFilmLoupeCard: React.FC<SpatialFilmLoupeCardProps> = React.memo(({
  thumbnails,
  keyframeIndices,
  scrollY,
  totalPhotosShared,
  contentHeightShared,
  photoScrollOffsetsShared,
  photoScrollEntriesShared,
  loupeOpacity,
  isDraggingLoupeShared,
  scrollDirectionShared,
  mainScrollRef,
  insetsTop,
  insetsBottom,
  screenHeight,
  onPressCard,
  onDragEnd,
  numColumns = 2,
}) => {
  const isDragging = useSharedValue(false);
  const isLoupeLocked = useSharedValue(false); // locks loupe position after drag so it never snaps during fade-out
  const dragStartY = useSharedValue(0);
  const dragStartProgress = useSharedValue(0);
  const currentCardYShared = useSharedValue(insetsTop + 75);
  const currentActiveKeyframeShared = useSharedValue(0);
  const continuousPosShared = useSharedValue(0);
  const [canInteract, setCanInteract] = useState(false);

  // Direction & Peek animation shared values for 4th square (1 = down, -1 = up)
  const internalScrollDir = useSharedValue(1);
  const activeDirection = scrollDirectionShared || internalScrollDir;
  const enterDirection = useSharedValue(1);
  const lastDragYShared = useSharedValue(0);
  const peekTopAnim = useSharedValue(0);
  const peekBottomAnim = useSharedValue(1); // Default to 1 so 4th square appears in scroll direction

  const triggerGrabHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  const handleCardPressWithCoord = useCallback((tapY: number) => {
    const current = Math.round(continuousPosShared.value);
    const maxIdx = Math.max(0, thumbnails.length - 1);
    let targetIdx = current;
    if (tapY < -45 && current >= 2) {
      targetIdx = current - 2;
    } else if (tapY < 18 && current >= 1) {
      targetIdx = current - 1;
    } else if (tapY > 118 && current <= maxIdx - 2) {
      targetIdx = current + 2;
    } else if (tapY > 68 && current <= maxIdx - 1) {
      targetIdx = current + 1;
    } else {
      targetIdx = current;
    }
    const safeTarget = Math.max(0, Math.min(maxIdx, targetIdx));
    onPressCard?.(safeTarget);
  }, [onPressCard, thumbnails.length]);

  const calcContinuousKfPos = useCallback((photoIdx: number, totalPhotos: number): number => {
    'worklet';
    if (!thumbnails || thumbnails.length === 0) return 0;
    if (keyframeIndices && keyframeIndices.length > 1) {
      const lastKfIdx = keyframeIndices.length - 1;
      if (typeof keyframeIndices[0] === 'number' && photoIdx <= keyframeIndices[0]) return 0;
      if (typeof keyframeIndices[lastKfIdx] === 'number' && photoIdx >= keyframeIndices[lastKfIdx]) return lastKfIdx;
      for (let i = 0; i < lastKfIdx; i++) {
        const kfStart = keyframeIndices[i];
        const kfEnd = keyframeIndices[i + 1];
        if (typeof kfStart === 'number' && typeof kfEnd === 'number' && photoIdx >= kfStart && photoIdx <= kfEnd) {
          const segSpan = Math.max(1, kfEnd - kfStart);
          const result = i + (photoIdx - kfStart) / segSpan;
          return isNaN(result) ? 0 : result;
        }
      }
      return 0;
    }
    const safeTotal = Math.max(1, (typeof totalPhotos === 'number' && !isNaN(totalPhotos) ? totalPhotos : 1) - 1);
    const normProgress = Math.max(0, Math.min(1, photoIdx / safeTotal));
    const result = normProgress * Math.max(0, thumbnails.length - 1);
    return isNaN(result) ? 0 : result;
  }, [thumbnails, keyframeIndices]);

  // Reactive animation for 4th peek square on scroll direction change (normal scroll + drag)
  useAnimatedReaction(
    () => activeDirection.value,
    (dir) => {
      'worklet';
      if (dir === 1) {
        peekBottomAnim.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
        peekTopAnim.value = withTiming(0, { duration: 150 });
      } else if (dir === -1) {
        peekTopAnim.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
        peekBottomAnim.value = withTiming(0, { duration: 150 });
      }
    },
    [activeDirection]
  );

  // Wake up 4th peek square and latch entrance direction when loupe becomes awake / visible
  useAnimatedReaction(
    () => loupeOpacity.value > 0.5,
    (isAwake, prevIsAwake) => {
      'worklet';
      if (isAwake !== prevIsAwake) {
        runOnJS(setCanInteract)(Boolean(isAwake));
      }
      if (!isAwake) {
        // Loupe has faded away completely — unlock so next normal scroll syncs cleanly
        isLoupeLocked.value = false;
      }
      if (isAwake && !prevIsAwake) {
        const dir = activeDirection.value >= 0 ? 1 : -1;
        enterDirection.value = dir;
        if (dir === 1) {
          peekBottomAnim.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
          peekTopAnim.value = withTiming(0, { duration: 150 });
        } else {
          peekTopAnim.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
          peekBottomAnim.value = withTiming(0, { duration: 150 });
        }
      }
    },
    [activeDirection]
  );

  // Unlock loupe lock when user manually scrolls the photo gallery directly with finger
  useAnimatedReaction(
    () => scrollY.value,
    (curScrollY, prevScrollY) => {
      'worklet';
      if (!isDragging.value && isLoupeLocked.value && prevScrollY !== null) {
        if (Math.abs(curScrollY - prevScrollY) > 25) {
          isLoupeLocked.value = false;
        }
      }
    },
    [scrollY]
  );

  // Sync the loupe to the gallery's actual masonry card positions.
  useAnimatedReaction(
    () => {
      'worklet';
      // Do NOT overwrite continuousPosShared while the user is dragging the loupe or while loupe is locked
      if (isDragging.value || isLoupeLocked.value) return -1;
      if (!thumbnails || thumbnails.length === 0) return 0;
      const totalPhotos = Math.max(1, totalPhotosShared.value || 1);
      const heroHeight = Math.round(screenHeight * 0.70);
      const curY = scrollY.value;
      const continuousPhotoIdx = curY <= heroHeight
        ? 0
        : getPhotoIndexAtScrollOffset(
          curY,
          totalPhotos,
          photoScrollEntriesShared.value,
          contentHeightShared?.value || 0,
          screenHeight,
          heroHeight,
        );

      const continuousKfPos = calcContinuousKfPos(continuousPhotoIdx, totalPhotos);
      // Only write to shared values when not dragging and not locked
      if (!isDragging.value && !isLoupeLocked.value) {
        continuousPosShared.value = continuousKfPos;
      }

      return (isDragging.value || isLoupeLocked.value) ? -1 : Math.min(thumbnails.length - 1, Math.max(0, Math.round(continuousKfPos)));
    },
    (nextIdx, prevIdx) => {
      'worklet';
      if (!isDragging.value && nextIdx >= 0 && prevIdx !== null && nextIdx !== prevIdx) {
        currentActiveKeyframeShared.value = nextIdx;
      }
    },
    [thumbnails, keyframeIndices, calcContinuousKfPos, screenHeight, totalPhotosShared, scrollY, contentHeightShared, photoScrollEntriesShared, isLoupeLocked]
  );

  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .activeOffsetY([-15, 15])
    .onBegin((e) => {
      'worklet';
      if (loupeOpacity.value < 0.5) return;
      // Set isDragging and lock loupe position so scroll reaction never overwrites it
      isDragging.value = true;
      isDraggingLoupeShared.value = true;
      isLoupeLocked.value = true;
      loupeOpacity.value = withTiming(1, { duration: 80 });
      // Capture dragStartProgress here in onBegin (not onStart) to avoid race condition
      // where animatedContainerStyle is still updating currentCardYShared concurrently.
      const minY = insetsTop + 75;
      const maxY = screenHeight - insetsBottom - 145;
      const trackLength = Math.max(1, maxY - minY);
      dragStartProgress.value = Math.max(0, Math.min(1, (currentCardYShared.value - minY) / trackLength));
      dragStartY.value = e.absoluteY;
    })
    .onStart((e) => {
      'worklet';
      isDragging.value = true;
      isDraggingLoupeShared.value = true;
      isLoupeLocked.value = true;
      loupeOpacity.value = withTiming(1, { duration: 80 });

      if (activeDirection.value === 1) {
        peekBottomAnim.value = withTiming(1, { duration: 150 });
      } else {
        peekTopAnim.value = withTiming(1, { duration: 150 });
      }

      lastDragYShared.value = e.absoluteY;

      runOnJS(triggerGrabHaptic)();
    })
    .onUpdate((e) => {
      'worklet';
      if (!isDragging.value) return;

      const minY = insetsTop + 75;
      const maxY = screenHeight - insetsBottom - 145;
      const trackLength = Math.max(1, maxY - minY);

      const deltaY = e.absoluteY - dragStartY.value;
      const deltaProgress = deltaY / trackLength;
      const newProgress = Math.max(0, Math.min(1, dragStartProgress.value + deltaProgress));

      currentCardYShared.value = minY + newProgress * trackLength;

      // Track drag direction for the 4th peek square
      const dragDelta = e.absoluteY - lastDragYShared.value;
      lastDragYShared.value = e.absoluteY;
      if (dragDelta > 1) {
        activeDirection.value = 1;
      } else if (dragDelta < -1) {
        activeDirection.value = -1;
      }

      const totalPhotos = Math.max(1, totalPhotosShared.value || 1);
      const heroHeight = Math.round(screenHeight * 0.70);
      const continuousPhotoIdx = newProgress * Math.max(1, totalPhotos - 1);
      const targetScrollY = getPhotoScrollOffset(
        continuousPhotoIdx,
        totalPhotos,
        photoScrollOffsetsShared.value,
        contentHeightShared?.value || 0,
        screenHeight,
        heroHeight,
      );

      scrollTo(mainScrollRef, 0, targetScrollY, false);
      scrollY.value = targetScrollY;

      // Continuous keyframe position
      const kfPos = calcContinuousKfPos(continuousPhotoIdx, totalPhotos);
      continuousPosShared.value = kfPos;

      const nextIdx = Math.min(thumbnails.length - 1, Math.max(0, Math.round(kfPos)));
      if (nextIdx !== currentActiveKeyframeShared.value) {
        currentActiveKeyframeShared.value = nextIdx;
      }
    })
    .onEnd(() => {
      'worklet';
      isDragging.value = false;
      isDraggingLoupeShared.value = false;
      // Keep loupe strictly locked at release position so it never snaps during confirmation/fade-out
      isLoupeLocked.value = true;
      peekTopAnim.value = withDelay(350, withTiming(0, { duration: 220, easing: Easing.inOut(Easing.quad) }));
      peekBottomAnim.value = withDelay(350, withTiming(0, { duration: 220, easing: Easing.inOut(Easing.quad) }));

      const totalPhotos = Math.max(1, totalPhotosShared.value || 1);
      const heroHeight = Math.round(screenHeight * 0.70);

      const minY = insetsTop + 75;
      const maxY = screenHeight - insetsBottom - 145;
      const trackLength = Math.max(1, maxY - minY);
      const finalProgress = Math.max(0, Math.min(1, (currentCardYShared.value - minY) / trackLength));

      const continuousPhotoIdx = finalProgress * Math.max(1, totalPhotos - 1);
      const targetPhotoIndex = Math.max(0, Math.min(totalPhotos - 1, Math.round(continuousPhotoIdx)));
      const kfPos = calcContinuousKfPos(continuousPhotoIdx, totalPhotos);
      continuousPosShared.value = kfPos;
      currentActiveKeyframeShared.value = Math.min(thumbnails.length - 1, Math.max(0, Math.round(kfPos)));

      const finalScrollY = getPhotoScrollOffset(
        continuousPhotoIdx,
        totalPhotos,
        photoScrollOffsetsShared.value,
        contentHeightShared?.value || 0,
        screenHeight,
        heroHeight,
      );

      if (onDragEnd) {
        runOnJS(onDragEnd)(finalScrollY, targetPhotoIndex);
      }
    })
    .onFinalize(() => {
      'worklet';
      isDragging.value = false;
      isDraggingLoupeShared.value = false;
      isLoupeLocked.value = true;
      peekTopAnim.value = withDelay(350, withTiming(0, { duration: 220, easing: Easing.inOut(Easing.quad) }));
      peekBottomAnim.value = withDelay(350, withTiming(0, { duration: 220, easing: Easing.inOut(Easing.quad) }));
    });

  const tapGesture = Gesture.Tap()
    .maxDuration(350)
    .maxDistance(10)
    .onBegin(() => {
      'worklet';
      if (loupeOpacity.value < 0.5) return;
      loupeOpacity.value = withTiming(1, { duration: 80 });
    })
    .onEnd((e, success) => {
      'worklet';
      if (success) {
        runOnJS(handleCardPressWithCoord)(e.y);
      }
    });

  const composedGesture = Gesture.Exclusive(panGesture, tapGesture);

  const animatedContainerStyle = useAnimatedStyle(() => {
    'worklet';
    const minY = insetsTop + 75;
    const maxY = screenHeight - insetsBottom - 145;
    const trackLength = Math.max(1, maxY - minY);

    let targetY = currentCardYShared.value;
    if (!isDragging.value && !isLoupeLocked.value) {
      const totalPhotos = Math.max(1, totalPhotosShared.value || 1);
      const heroHeight = Math.round(screenHeight * 0.70);
      const curY = scrollY.value;

      const continuousPhotoIdx = curY <= heroHeight
        ? 0
        : getPhotoIndexAtScrollOffset(
          curY,
          totalPhotos,
          photoScrollEntriesShared.value,
          contentHeightShared?.value || 0,
          screenHeight,
          heroHeight,
        );
      const safeTotal = Math.max(1, totalPhotos - 1);
      const rawProgress = continuousPhotoIdx / safeTotal;
      const progress = isNaN(rawProgress) ? 0 : Math.max(0, Math.min(1, rawProgress));
      const safeMinY = minY;
      const safeMaxY = Math.max(safeMinY, maxY);
      targetY = interpolate(progress, [0, 1], [safeMinY, safeMaxY], 'clamp');
      if (isNaN(targetY)) targetY = safeMinY;
      currentCardYShared.value = targetY;
    }

    return {
      opacity: loupeOpacity.value,
      transform: [{ translateY: isNaN(targetY) ? minY : targetY }],
    };
  });

  // Entire strip column blossoms out from the right edge with a directional swoop along the scroll vector
  const stripAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    const enterScale = interpolate(loupeOpacity.value, [0, 1], [0.35, 1], 'clamp');
    const shiftX = (1 - enterScale) * 31; // Center card half-width (62 / 2)

    // Directional swoop along the scroll vector:
    // Down (dir = 1): swoops down from -32pt into resting position
    // Up (dir = -1): swoops up from +32pt into resting position
    const startOffsetY = enterDirection.value === 1 ? -32 : 32;
    const enterTranslateY = interpolate(loupeOpacity.value, [0, 1], [startOffsetY, 0], 'clamp');

    return {
      opacity: loupeOpacity.value,
      transform: [
        { translateY: enterTranslateY },
        { scale: enterScale },
        { translateX: shiftX },
      ],
    };
  });

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        collapsable={false}
        pointerEvents={canInteract ? 'auto' : 'none'}
        style={[loupeCardStyles.container, animatedContainerStyle]}
      >
        <Animated.View
          pointerEvents="none"
          style={[loupeCardStyles.stripColumn, stripAnimatedStyle]}
        >
          {thumbnails.map((uri, idx) => (
            <ReelSlot
              key={`reel-${idx}`}
              targetIdx={idx}
              uri={uri}
              photoIndex={typeof keyframeIndices?.[idx] === 'number' ? keyframeIndices[idx] : -1}
              continuousPos={continuousPosShared}
              activeDirection={activeDirection}
              peekTopAnim={peekTopAnim}
              peekBottomAnim={peekBottomAnim}
              scrollY={scrollY}
              photoScrollOffsetsShared={photoScrollOffsetsShared}
              screenHeight={screenHeight}
              numColumns={numColumns}
            />
          ))}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

interface GalleryViewProps {
  onLogout: () => void;
  onChangeEvent: () => void;
  onScreenProtectionChange?: (shouldPrevent: boolean) => void;
}

const GalleryView = React.memo(function GalleryView({ onLogout, onChangeEvent, onScreenProtectionChange }: GalleryViewProps) {
  const insets = useSafeAreaInsets();

  const eventSlug = useAuthStore((state) => state.eventSlug);
  const passcode = useAuthStore((state) => state.passcode);
  const profile = useAuthStore((state) => state.profile);
  const userEvents = useAuthStore((state) => state.userEvents);
  const eventCoverUrl = useAuthStore((state) => state.eventCoverUrl);
  const eventTitle = useAuthStore((state) => state.eventTitle);
  const initialDeepLinkTab = useAuthStore((state) => state.initialTab);
  const clearInitialTab = useAuthStore((state) => state.clearInitialTab);
  const handleScroll = useScrollTabBarCollapse();

  // Instant Frame 1 Cache: Read from sandboxed memory/AsyncStorage store synchronously
  const cachedInitial = React.useMemo(() => {
    if (!eventSlug) return null;
    return useAuthStore.getState().getGalleryCache(eventSlug);
  }, [eventSlug]);

  const [photos, setPhotos] = useState<Photo[]>(() => {
    if (cachedInitial?.matched && Array.isArray(cachedInitial.matched)) {
      return cachedInitial.matched.map(mapPhotoItem);
    }
    return [];
  });
  const [allPhotos, setAllPhotos] = useState<Photo[]>(() => {
    if (cachedInitial?.photos && Array.isArray(cachedInitial.photos)) {
      return cachedInitial.photos.map(mapPhotoItem);
    }
    return [];
  });
  const [totalAllPhotosCount, setTotalAllPhotosCount] = useState<number | null>(() => {
    return typeof cachedInitial?.total === 'number' ? cachedInitial.total : null;
  });
  const [eventDetails, setEventDetailsData] = useState<any>(() => {
    if (cachedInitial?.details) return cachedInitial.details;
    const foundInEvents = Array.isArray(userEvents) ? userEvents.find((e: any) => e?.slug === eventSlug) : null;
    return foundInEvents || null;
  });
  const [eventGuest, setEventGuest] = useState<any>(null);

  const [guestAccessLevel, setGuestAccessLevel] = useState<boolean | null>(() => {
    if (cachedInitial && typeof cachedInitial.hasFullAccess === 'boolean') {
      return cachedInitial.hasFullAccess;
    }
    const foundInEvents = Array.isArray(userEvents) ? userEvents.find((e: any) => e?.slug === eventSlug) : null;
    if (foundInEvents && typeof foundInEvents.hasFullAccess === 'boolean') {
      return foundInEvents.hasFullAccess;
    }
    return null;
  });
  const hasFullAccess = guestAccessLevel ?? (profile?.hasFullAccess ?? false);

  const [tabCache, setTabCache] = useState<Record<string, Photo[]>>(() => {
    const tabCacheData = cachedInitial?.tabCache;
    if (tabCacheData) {
      const normalized: Record<string, Photo[]> = {};
      Object.keys(tabCacheData).forEach((k) => {
        normalized[k] = (tabCacheData[k] || []).map(mapPhotoItem);
      });
      return normalized;
    }
    return {};
  });

  // Pre-warm disk cache for both horizontal and vertical covers of this event
  useEffect(() => {
    if (cachedInitial?.details) {
      const d = cachedInitial.details;
      const covers = [
        d.coverPhotoMobileUrl,
        d.cover_photo_mobile_url,
        d.coverPhotoUrl,
        d.cover_photo_url,
        d.coverPhotoSquareUrl,
        d.coverUrl,
        d.bannerUrl,
      ].filter(Boolean);
      covers.forEach((c) => Image.prefetch(c));
    }
  }, [cachedInitial]);

  const [isTabLoading, setIsTabLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (initialDeepLinkTab) {
      return initialDeepLinkTab.toUpperCase();
    }
    if (!eventSlug) return 'HIGHLIGHTS';
    
    // Check initial cached / event details data
    const foundEv = Array.isArray(userEvents) ? userEvents.find((e: any) => e?.slug === eventSlug) : null;
    const initialHlCount = typeof cachedInitial?.details?.tabCounts?.['HIGHLIGHTS'] === 'number'
      ? cachedInitial.details.tabCounts['HIGHLIGHTS']
      : (typeof cachedInitial?.details?.tab_counts?.['HIGHLIGHTS'] === 'number'
          ? cachedInitial.details.tab_counts['HIGHLIGHTS']
          : (typeof cachedInitial?.details?.highlightsPhotoCount === 'number'
              ? cachedInitial.details.highlightsPhotoCount
              : (typeof foundEv?.highlightsPhotoCount === 'number'
                  ? foundEv.highlightsPhotoCount
                  : (typeof foundEv?.tabCounts?.['HIGHLIGHTS'] === 'number'
                      ? foundEv.tabCounts['HIGHLIGHTS']
                      : (typeof foundEv?.tab_counts?.['HIGHLIGHTS'] === 'number'
                          ? foundEv.tab_counts['HIGHLIGHTS']
                          : 0)))));

    if (initialHlCount > 0) return 'HIGHLIGHTS';
    if (cachedInitial?.hasFullAccess === false || foundEv?.hasFullAccess === false) return 'MY PHOTOS';
    if (cachedInitial?.hasFullAccess === true || foundEv?.hasFullAccess === true) return 'ALL';
    return 'HIGHLIGHTS';
  });

  useEffect(() => {
    if (initialDeepLinkTab) {
      setActiveTab(initialDeepLinkTab.toUpperCase());
      clearInitialTab();
    }
  }, [initialDeepLinkTab, clearInitialTab]);

  const [isLoading, setIsLoading] = useState<boolean>(() => {
    // If cachedInitial is present, frame 1 has data ready — silent background SWR revalidation will refresh it
    if (cachedInitial) return false;
    return true;
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshingGallery, setIsRefreshingGallery] = useState(false);
  const [allPhotosOffset, setAllPhotosOffset] = useState<number>(() => {
    return cachedInitial?.photos?.length || 0;
  });
  const [hasMorePhotos, setHasMorePhotos] = useState<boolean>(() => {
    if (cachedInitial?.total !== undefined && cachedInitial?.photos) {
      return cachedInitial.photos.length < cachedInitial.total;
    }
    return true;
  });
  const [hasMoreMatchedPhotos, setHasMoreMatchedPhotos] = useState<boolean>(true);
  const [totalMatchedPhotosCount, setTotalMatchedPhotosCount] = useState<number | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isMoreDrawerOpen, setIsMoreDrawerOpen] = useState(false);
  const [isScrolledPastHero, setIsScrolledPastHero] = useState(false);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [batchDownloadProgress, setBatchDownloadProgress] = useState<{ current: number; total: number } | null>(null);
  const [lockedPhotoIds, setLockedPhotoIds] = useState<Set<number>>(new Set());
  const [showSelfieModal, setShowSelfieModal] = useState(false);

  // Lightbox & Video State
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [activeVideoItem, setActiveVideoItem] = useState<any | null>(null);
  const lastNonCinemaTabRef = useRef<string>('ALL');
  const [selectedBounds, setSelectedBounds] = useState<LightboxBounds | null>(null);

  const PAGE_SIZE = 60;
  const mainScrollRef = useAnimatedRef<Animated.ScrollView>();

  const scrollToY = useCallback((targetY: number, animated = false) => {
    try {
      if (mainScrollRef.current) {
        if ('scrollTo' in mainScrollRef.current && typeof (mainScrollRef.current as any).scrollTo === 'function') {
          (mainScrollRef.current as any).scrollTo({ y: targetY, animated });
        } else {
          runOnUI((y: number, anim: boolean) => {
            'worklet';
            scrollTo(mainScrollRef, 0, y, anim);
          })(targetY, animated);
        }
      }
    } catch (_e) {
      runOnUI((y: number, anim: boolean) => {
        'worklet';
        scrollTo(mainScrollRef, 0, y, anim);
      })(targetY, animated);
    }
  }, [mainScrollRef]);

  const currentYRef = useRef<number>(0);
  const isTabSwitchingRef = useRef<boolean>(false);
  const cardRefs = useRef<{ [key: string]: View | null }>({});
  const eventHeadersRef = useRef<Record<string, string>>(
    cachedInitial?.headers?.Authorization
      ? cachedInitial.headers
      : (useAuthStore.getState().token ? { Authorization: `Bearer ${useAuthStore.getState().token}` } : {})
  );

  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (eventHeadersRef.current?.Authorization) {
      return eventHeadersRef.current;
    }
    if (cachedInitial?.headers?.Authorization) {
      eventHeadersRef.current = cachedInitial.headers;
      return cachedInitial.headers;
    }
    const token = useAuthStore.getState().token;
    if (token) {
      const h = { Authorization: `Bearer ${token}` };
      eventHeadersRef.current = h;
      return h;
    }
    return eventHeadersRef.current || {};
  }, [cachedInitial]);
  const allPhotosOffsetRef = useRef<number>(cachedInitial?.photos?.length || 0);
  const allPhotosRef = useRef<Photo[]>(allPhotos);
  useEffect(() => {
    allPhotosRef.current = allPhotos;
  }, [allPhotos]);
  const photosRef = useRef<Photo[]>(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  const hasMoreMatchedPhotosRef = useRef<boolean>(true);
  useEffect(() => {
    hasMoreMatchedPhotosRef.current = hasMoreMatchedPhotos;
  }, [hasMoreMatchedPhotos]);
  const tabCacheRef = useRef<Record<string, Photo[]>>(tabCache);
  useEffect(() => {
    tabCacheRef.current = tabCache;
  }, [tabCache]);
  const isFastCatchingUpRef = useRef<boolean>(false);
  const fastCatchupPhotosRef = useRef<((targetY: number, targetTab: string, explicitTargetIdx?: number) => Promise<void>) | null>(null);
  const pendingJumpTargetYRef = useRef<number | null>(null);
  const pendingJumpTargetIndexRef = useRef<number | null>(null);
  const pendingJumpTargetScopeRef = useRef<string | null>(null);
  const tabSparsePhotosRef = useRef<Record<string, Map<number, Photo>>>({});
  const [sparseVersion, setSparseVersion] = useState(0);

  // Initialize sparse cache with initial disk cache on mount
  useEffect(() => {
    if (cachedInitial?.photos && Array.isArray(cachedInitial.photos)) {
      if (!tabSparsePhotosRef.current['ALL']) {
        tabSparsePhotosRef.current['ALL'] = new Map();
      }
      cachedInitial.photos.forEach((p: any, idx: number) => {
        tabSparsePhotosRef.current['ALL'].set(idx, p);
      });
    }
  }, [cachedInitial]);

  const tabOffsetsRef = useRef<Record<string, number>>({});
  const tabItemCountsRef = useRef<Record<string, number>>({});
  const isResumingScrollRef = useRef<boolean>(false);
  const saveDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabHasMoreRef = useRef<Record<string, boolean>>({});
  const lastPrefetchTimeRef = useRef<number>(0);
  const priorityCatchupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCatchupTriggerTimeRef = useRef<number>(0);

  // Column Density & Pinch-to-Zoom State (1 = editorial, 2 = masonry, 3 = compact grid)
  const [galleryColumns, setGalleryColumns] = useState<number>(2);
  const galleryColumnsRef = useRef<number>(2);
  galleryColumnsRef.current = galleryColumns;
  const columnsShared = useSharedValue(2);
  const galleryContentHeightShared = useSharedValue(0);
  const scheduleBatchPrefetchRef = useRef<((mappedList: Photo[], cols?: number) => void) | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('mycircle_gallery_columns').then((val) => {
      if (val) {
        const parsed = parseInt(val, 10);
        if (parsed >= 1 && parsed <= 5) {
          setGalleryColumns(parsed);
          galleryColumnsRef.current = parsed;
          columnsShared.value = parsed;
        }
      }
    }).catch(() => {});
  }, [columnsShared]);

  const handleGalleryColumnsChange = useCallback((newCols: number) => {
    setGalleryColumns(newCols);
    galleryColumnsRef.current = newCols;
    columnsShared.value = newCols;
    AsyncStorage.setItem('mycircle_gallery_columns', String(newCols)).catch(() => {});
    if (activeListRef.current && activeListRef.current.length > 0) {
      scheduleBatchPrefetchRef.current?.(activeListRef.current, newCols);
    }
  }, [columnsShared]);

  const cleanTitle = useMemo(() => {
    const raw = String(eventTitle || eventDetails?.title || eventSlug || 'WEDDING CELEBRATION');
    return raw
      .replace(/'s\s+Wedding/gi, '')
      .replace('&', '·')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }, [eventTitle, eventDetails?.title, eventSlug]);

  const isFetchingMoreRef = useRef<boolean>(false);
  const lastScrollYRef = useRef<number>(0);
  const btnStateRef = useRef<'hidden' | 'dim' | 'bright'>('hidden');

  const screenSwipeX = useSharedValue(width);
  const isClosingRef = useRef(false);
  const touchStartedOnLeftEdge = useSharedValue(false);
  const isLightboxOpen = useSharedValue(false);
  const backToTopOpacity = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const photoScrollOffsetsShared = useSharedValue<number[]>([]);
  const photoScrollEntriesShared = useSharedValue<number[]>([]);
  const lastScrollDispatchTimeShared = useSharedValue(0);
  const scrollTargetY = useSharedValue(0);
  const isSmoothScrollingToTop = useSharedValue(false);
  const isPinching = useSharedValue(false);
  const [isPast60Photos, setIsPast60Photos] = useState(false);

  // ─── Spatial Film Loupe Shared Values & State ──────────────────────────────
  const loupeOpacity = useSharedValue(0);
  const isFadingLoupe = useSharedValue(false);
  const isLoupeAwake = useSharedValue(false);
  const isDraggingLoupe = useSharedValue(false);
  const fastScrollStartTimeShared = useSharedValue(0);
  const fastScrollDistanceShared = useSharedValue(0);
  const lastScrollYShared = useSharedValue(0);
  const contentHeightShared = useSharedValue(screenHeight * 2);
  const layoutHeightShared = useSharedValue(screenHeight);
  const totalPhotosShared = useSharedValue(0);
  const totalTabPhotosRef = useRef<number>(0);
  const loupeScrollDirection = useSharedValue<number>(1);
  const loupeThumbnailsRef = useRef<string[]>([]);
  const filmstripCacheRef = useRef<Record<string, FilmstripData>>({});
  const filmstripRequestIdsRef = useRef<Record<string, number>>({});
  const [activeFilmstripEntry, setActiveFilmstripEntry] = useState<{
    eventSlug: string;
    tab: string;
    data: FilmstripData;
  } | null>(null);
  const eventSlugRef = useRef(eventSlug);
  const activeTabRef = useRef(activeTab);
  eventSlugRef.current = eventSlug;
  activeTabRef.current = activeTab;
  const activeFilmstrip = activeFilmstripEntry?.eventSlug === eventSlug &&
    activeFilmstripEntry.tab === (activeTab || 'ALL').trim().toUpperCase()
    ? activeFilmstripEntry.data
    : null;
  const fetchFilmstripRef = useRef<((tabName: string, forceRefresh?: boolean) => Promise<void>) | null>(null);

  const publishFilmstrip = useCallback((data: FilmstripData | null, slug: string, tab: string) => {
    if (
      eventSlugRef.current !== slug ||
      (activeTabRef.current || 'ALL').trim().toUpperCase() !== tab
    ) {
      return;
    }
    setActiveFilmstripEntry(data ? { eventSlug: slug, tab, data } : null);
  }, []);

  // ─── Resume Where You Left Off ───────────────────────────────────────────────
  const [showResumePill, setShowResumePill] = useState(false);
  const resumePillOpacity = useSharedValue(0);
  const resumePillTranslateY = useSharedValue(20);
  const resumeTargetYRef = useRef<number | null>(null);
  const resumeTargetTabRef = useRef<string | null>(null);
  const resumePillDismissedRef = useRef<boolean>(false);
  const resumeHasCheckedOnScrollRef = useRef<boolean>(false);
  const lastSavedScrollYRef = useRef<number>(0);

  const exactTouchPoint = Math.round(screenHeight * 0.70) - Math.round(insets.top + 45);
  const heroCoverHeight = Math.round(screenHeight * 0.70);

  const floatingHeaderAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    const isLocked = scrollY.value >= heroCoverHeight;
    return {
      opacity: isLocked ? 1 : 0,
      transform: [{ translateY: isLocked ? 0 : -300 }],
    };
  });

  const drawerProgress = useSharedValue(0);

  const openDrawerWithAnimation = useCallback(() => {
    setIsMoreDrawerOpen(true);
    drawerProgress.value = 0;
    drawerProgress.value = withTiming(1, { duration: 320, easing: Easing.bezier(0.25, 1, 0.5, 1) });
  }, [drawerProgress]);

  const closeDrawerWithAnimation = useCallback(() => {
    drawerProgress.value = withTiming(0, { duration: 250, easing: Easing.out(Easing.quad) }, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(setIsMoreDrawerOpen)(false);
      }
    });
  }, [drawerProgress]);

  const drawerPanY = useSharedValue(0);

  const drawerBackdropStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: 0,
    };
  });

  const drawerContentStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ translateY: (1 - drawerProgress.value) * screenHeight + Math.max(0, drawerPanY.value) }],
    };
  });

  const drawerHandlePanGesture = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      drawerPanY.value = e.translationY;
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationY > 80 || e.velocityY > 500) {
        drawerPanY.value = withTiming(screenHeight, { duration: 250, easing: Easing.out(Easing.quad) }, (finished) => {
          'worklet';
          if (finished) {
            runOnJS(setIsMoreDrawerOpen)(false);
            drawerPanY.value = 0;
            drawerProgress.value = 0;
          }
        });
      } else {
        drawerPanY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) });
      }
    });

  // ─── Gallery → Cinema Theatrical Transition & iOS Swipe-Back Engine ───
  const isCinema = activeTab.trim().toUpperCase() === 'CINEMA';
  const cinemaProgress = useSharedValue(isCinema ? 1 : 0);
  const isCinemaShared = useSharedValue(isCinema);
  const cinemaSwipeX = useSharedValue(0);
  const cinemaScrollRef = useAnimatedRef<Animated.ScrollView>();
  const cinemaScrollY = useSharedValue(0);
  const cinemaScrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      cinemaScrollY.value = e.contentOffset.y;
    },
  });

  const animatedBackTextStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      color: (scrollY?.value ?? 0) >= exactTouchPoint ? (isCinemaShared?.value ? '#ffffff' : '#3a3632') : '#ffffff',
    };
  });

  // ─── Dynamic Taskbar / Status Bar Color Engine ───────────────────────────
  // - White icon/text ('light-content') when hero cover is on top (<- BACK is white)
  // - Black icon/text ('dark-content') when tab bar is on top (<- BACK turns black)
  // - Strictly white icon/text ('light-content') in Cinema
  const [statusBarStyle, setStatusBarStyle] = useState<'light-content' | 'dark-content'>('light-content');

  const updateStatusBarStyle = useCallback((style: 'light-content' | 'dark-content') => {
    setStatusBarStyle(style);
    StatusBar.setBarStyle(style, true);
    if (Platform.OS === 'android') {
      StatusBar.setTranslucent(true);
      StatusBar.setBackgroundColor('transparent', true);
    }
  }, []);

  useAnimatedReaction(
    () => {
      'worklet';
      if (isCinemaShared?.value) {
        return 'light-content';
      }
      return (scrollY?.value ?? 0) >= exactTouchPoint ? 'dark-content' : 'light-content';
    },
    (style, previous) => {
      if (style !== previous) {
        runOnJS(updateStatusBarStyle)(style);
      }
    },
    [exactTouchPoint, updateStatusBarStyle]
  );

  useEffect(() => {
    // Initial mount: ensure status bar is transparent & light-content immediately
    if (Platform.OS === 'android') {
      StatusBar.setTranslucent(true);
      StatusBar.setBackgroundColor('transparent', true);
    }
    const initialStyle = isCinema ? 'light-content' : (currentYRef.current >= exactTouchPoint ? 'dark-content' : 'light-content');
    setStatusBarStyle(initialStyle);
    StatusBar.setBarStyle(initialStyle, true);

    return () => {
      if (Platform.OS === 'android') {
        StatusBar.setTranslucent(false);
        StatusBar.setBackgroundColor('#ffffff', true);
      }
      StatusBar.setBarStyle('dark-content', true);
    };
  }, []);

  useEffect(() => {
    if (!isCinema && activeTab) {
      lastNonCinemaTabRef.current = activeTab;
    }
  }, [isCinema, activeTab]);

  useEffect(() => {
    isCinemaShared.value = isCinema;
    const targetStyle = isCinema ? 'light-content' : (currentYRef.current >= exactTouchPoint ? 'dark-content' : 'light-content');
    updateStatusBarStyle(targetStyle);

    if (!isCinema) {
      cinemaSwipeX.value = 0;
    }
    cinemaProgress.value = withTiming(isCinema ? 1 : 0, {
      duration: 250,
      easing: Easing.out(Easing.quad),
    });
  }, [isCinema, cinemaProgress, isCinemaShared, cinemaSwipeX, exactTouchPoint, updateStatusBarStyle]);

  const cinemaAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ translateX: cinemaSwipeX.value }],
    };
  });

  const photosDimAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    if (!isCinemaShared.value) return { opacity: 0 };
    const progress = cinemaSwipeX.value / width;
    return {
      opacity: interpolate(progress, [0, 1], [0.15, 0], 'clamp'),
    };
  });

  const animatedHeroImageStyle = useAnimatedStyle(() => {
    'worklet';
    const y = scrollY.value;
    if (y < 0) {
      // Overscroll pull-down: scale up smoothly and anchor to top
      const scale = interpolate(y, [-heroCoverHeight, 0], [2, 1], 'clamp');
      const translateY = y / 2;
      return {
        transform: [{ translateY }, { scale }],
      };
    }
    // Normal scroll: translate down at 38% speed for luxurious parallax depth
    const translateY = y * 0.38;
    return {
      transform: [{ translateY }, { scale: 1 }],
    };
  });

  const animatedTitleContainerStyle = useAnimatedStyle(() => {
    'worklet';
    const y = scrollY.value;
    if (y < 0) {
      return {
        opacity: 1,
        transform: [{ translateY: 0 }],
      };
    }
    // Subtle parallax drift + gentle fade-out before cover leaves view
    const translateY = interpolate(y, [0, heroCoverHeight * 0.6], [0, -35], 'clamp');
    const opacity = interpolate(y, [0, heroCoverHeight * 0.45], [1, 0], 'clamp');
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const animatedCoverLogoStyle = useAnimatedStyle(() => {
    'worklet';
    const y = scrollY.value;
    if (y < 0) {
      return { opacity: 1, transform: [{ translateY: 0 }] };
    }
    const opacity = interpolate(y, [0, heroCoverHeight * 0.35], [1, 0], 'clamp');
    const translateY = interpolate(y, [0, heroCoverHeight * 0.35], [0, -15], 'clamp');
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const loadMorePhotosRef = useRef<(() => void) | null>(null);
  const prefetchedUrlsRef = useRef<Set<string>>(new Set());
  const activeListRef = useRef<Photo[]>([]);
  const prevTabRef = useRef<string | null>(null);
  const userHasSwitchedTabRef = useRef<boolean>(false);

  // ─── Resume Scroll: Save & Trigger Engine ──────────────────────────────────
  const dismissResumePill = useCallback(() => {
    resumePillDismissedRef.current = true;
    resumePillOpacity.value = withTiming(0, { duration: 200 }, (finished) => {
      if (finished) runOnJS(setShowResumePill)(false);
    });
    resumePillTranslateY.value = withTiming(20, { duration: 200 });
  }, [resumePillOpacity, resumePillTranslateY]);

  const saveResumeScrollPosition = useCallback((offsetY: number, specificTab?: string) => {
    if (!eventSlug || offsetY < 150) return;
    const rounded = Math.round(offsetY);
    AsyncStorage.setItem(`@mycircle_resume_offset_${eventSlug}`, String(rounded)).catch(() => {});
    const targetTab = specificTab || activeTab;
    if (targetTab && targetTab.trim().toUpperCase() !== 'CINEMA') {
      AsyncStorage.setItem(`@mycircle_resume_tab_${eventSlug}`, targetTab).catch(() => {});
    }
  }, [eventSlug, activeTab]);

  const handleViewportScroll = useCallback((offsetY: number, layoutHeight: number, contentHeight: number) => {
    currentYRef.current = offsetY;
    if (!isTabSwitchingRef.current && !isResumingScrollRef.current) {
      if (activeTab && activeTab.trim().toUpperCase() !== 'CINEMA') {
        tabOffsetsRef.current[activeTab.trim().toUpperCase()] = offsetY;
      }
    }

    // ─── Debounced Scroll Position Persistence (For seamless user testing) ───
    if (offsetY > 150 && Math.abs(offsetY - lastSavedScrollYRef.current) > 150 && !isResumingScrollRef.current && !isTabSwitchingRef.current) {
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
      }
      const scrollTab = activeTab;
      saveDebounceTimerRef.current = setTimeout(() => {
        if (isTabSwitchingRef.current || isResumingScrollRef.current) return;
        lastSavedScrollYRef.current = offsetY;
        saveResumeScrollPosition(offsetY, scrollTab);
      }, 750);
    }

    const currentCols = galleryColumnsRef.current || 2;
    const heroHeight = Math.round(screenHeight * 0.70);
    const visibleStartIndex = Math.floor(getPhotoIndexAtScrollOffset(
      offsetY,
      totalTabPhotosRef.current,
      photoScrollEntriesShared.value,
      contentHeight,
      layoutHeight,
      heroHeight,
    ));

    // Viewport-Proximity Pre-fetch: throttled to at most once per 450ms with a right-sized batch
    // to prevent saturating the network/disk queue on Android during active flings
    const now = Date.now();
    if (now - lastPrefetchTimeRef.current >= 500) {
      lastPrefetchTimeRef.current = now;
      const prefetchWindow = Math.min(24, currentCols * 10);
      const upcomingPhotos = activeListRef.current
        .filter((photo) => !isVideoMedia(photo) && !isCinemaVideoItem(photo))
        .slice(visibleStartIndex, visibleStartIndex + prefetchWindow);
      const urlsToPrefetch: string[] = [];
      upcomingPhotos.forEach((photo) => {
        const uri = getMediaDisplayUri(photo);
        if (uri && !prefetchedUrlsRef.current.has(uri)) {
          prefetchedUrlsRef.current.add(uri);
          urlsToPrefetch.push(uri);
        }
      });
      if (urlsToPrefetch.length > 0) {
        Image.prefetch(urlsToPrefetch, 'memory-disk');
      }
    }

    // ─── Current Page Priority Stream: Detect if visible screen has missing photos ───
    const normTab = (activeTab || 'ALL').trim().toUpperCase();
    const isCeremonyTab = normTab !== 'ALL' && normTab !== 'MY PHOTOS' && normTab !== 'MY FAVOURITES';
    const sparseMap = tabSparsePhotosRef.current[normTab];
    const currentLoadedList = isCeremonyTab
      ? (tabCache[normTab] || [])
      : (normTab === 'MY PHOTOS' ? photosRef.current : allPhotosRef.current);

    // Check if any photo on the currently visible page is missing:
    const onScreenCount = Math.max(12, currentCols * 5);
    let hasMissingOnScreen = false;
    for (let c = visibleStartIndex; c < visibleStartIndex + onScreenCount; c++) {
      if (totalTabPhotosRef.current > 0 && c >= totalTabPhotosRef.current) break;
      const loaded = (sparseMap && sparseMap.has(c)) || (currentLoadedList[c] && !currentLoadedList[c].isSkeleton);
      if (!loaded) {
        hasMissingOnScreen = true;
        break;
      }
    }

    if (hasMissingOnScreen) {
      const timeSinceCatchup = now - lastCatchupTriggerTimeRef.current;
      if (timeSinceCatchup > 250 && !isFastCatchingUpRef.current && fastCatchupPhotosRef.current) {
        lastCatchupTriggerTimeRef.current = now;
        fastCatchupPhotosRef.current(offsetY, activeTab, visibleStartIndex);
      } else {
        if (priorityCatchupTimerRef.current) {
          clearTimeout(priorityCatchupTimerRef.current);
        }
        priorityCatchupTimerRef.current = setTimeout(() => {
          if (!isFastCatchingUpRef.current && fastCatchupPhotosRef.current) {
            lastCatchupTriggerTimeRef.current = Date.now();
            fastCatchupPhotosRef.current(offsetY, activeTab, visibleStartIndex);
          }
        }, 75);
      }
    }

    // ─── Proactive Sequential Paging Trigger ───
    // Only trigger when the user is approaching the end of already-loaded photos.
    // Avoids aggressive double-trigger (isNearBottom) which caused endless refresh at end of strip.
    const contiguousCount = currentLoadedList.length;
    const canLoadMore = isCeremonyTab
      ? (tabHasMoreRef.current[normTab] !== false)
      : (normTab === 'MY PHOTOS' ? hasMoreMatchedPhotosRef.current : hasMorePhotos);
    const triggerThreshold = Math.max(30, currentCols * 14);
    const isApproachingEndOfLoaded =
      visibleStartIndex <= contiguousCount + 10 &&
      visibleStartIndex + triggerThreshold >= contiguousCount;
    if (isApproachingEndOfLoaded && canLoadMore && !isFetchingMoreRef.current && !isFastCatchingUpRef.current && loadMorePhotosRef.current) {
      loadMorePhotosRef.current();
    }

    // ─── Resume Viewing: Trigger as soon as user starts scrolling down ─────────
    if (normTab !== 'CINEMA') {
      const targetY = resumeTargetYRef.current;

      // When user returns near the top (offsetY <= 20), re-arm the trigger so they can see the pill again
      if (offsetY <= 20) {
        if (resumeHasCheckedOnScrollRef.current) {
          resumeHasCheckedOnScrollRef.current = false;
          resumePillDismissedRef.current = false;
        }
      }

      // Check if we should trigger the Resume Pill
      if (
        offsetY >= 25 &&
        !resumePillDismissedRef.current &&
        !resumeHasCheckedOnScrollRef.current
      ) {
        if (targetY !== null && targetY > 180) {
          if (offsetY < targetY - 150) {
            resumeHasCheckedOnScrollRef.current = true;
            setShowResumePill(true);
          } else {
            resumeHasCheckedOnScrollRef.current = true;
          }
        }
      }

      // Auto-dismiss pill ONLY if user manually scrolls all the way down to the target
      if (showResumePill && targetY !== null && offsetY >= targetY - 100) {
        dismissResumePill();
      }
    }
  }, [hasMorePhotos, activeTab, showResumePill, dismissResumePill, eventSlug, saveResumeScrollPosition]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      const currentY = event.contentOffset.y;
      scrollY.value = currentY;
      layoutHeightShared.value = event.layoutMeasurement.height;
      contentHeightShared.value = event.contentSize.height;

      // ─── Spatial Film Loupe Velocity & Intent Gating ──────────────────────
      if (isDraggingLoupe.value) {
        lastScrollYShared.value = currentY;
        fastScrollStartTimeShared.value = 0;
        fastScrollDistanceShared.value = 0;
        return;
      }
      const rawDeltaY = currentY - lastScrollYShared.value;
      const deltaY = Math.abs(rawDeltaY);
      lastScrollYShared.value = currentY;

      if (rawDeltaY > 1) {
        loupeScrollDirection.value = 1;
      } else if (rawDeltaY < -1) {
        loupeScrollDirection.value = -1;
      }

      // Do not trigger loupe when viewing the hero cover image at the very top
      if (currentY < heroCoverHeight * 0.4) {
        fastScrollStartTimeShared.value = 0;
        fastScrollDistanceShared.value = 0;
        if (isLoupeAwake.value && !isFadingLoupe.value) {
          isFadingLoupe.value = true;
          loupeOpacity.value = withTiming(0, { duration: 250 }, (finished) => {
            if (finished) {
              isLoupeAwake.value = false;
              isFadingLoupe.value = false;
            }
          });
        }
      } else {
        const now = Date.now();

        // Fast scrolling threshold: deltaY > 22px per frame (requires intentional high-speed scroll)
        if (deltaY > 22) {
          if (fastScrollStartTimeShared.value === 0) {
            fastScrollStartTimeShared.value = now;
            fastScrollDistanceShared.value = deltaY;
          } else {
            fastScrollDistanceShared.value += deltaY;
          }

          const elapsedFastTime = now - fastScrollStartTimeShared.value;
          const accumulatedDistance = fastScrollDistanceShared.value;

          // Intent condition: user is scrolling intentionally to skip
          // Requires at least 900ms of sustained fast scrolling and >1000px traveled, or an intense fast flick (>1800px)
          const isIntentionalLongScroll =
            (elapsedFastTime >= 900 && accumulatedDistance >= 1000) || accumulatedDistance >= 1800;

          if (isIntentionalLongScroll && !isLoupeAwake.value) {
            isLoupeAwake.value = true;
            isFadingLoupe.value = false;
            loupeOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
          } else if (isLoupeAwake.value && isFadingLoupe.value) {
            // Cancel pending fade-out if user resumes fast scrolling
            isFadingLoupe.value = false;
            loupeOpacity.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.cubic) });
          }
        } else if (deltaY <= 5) {
          // Scroll slowed down or stopped
          fastScrollStartTimeShared.value = 0;
          fastScrollDistanceShared.value = 0;

          if (isLoupeAwake.value && !isFadingLoupe.value) {
            // Schedule fade-out ONCE when scroll settles: hold for 800ms, then smoothly fade away to zero
            isFadingLoupe.value = true;
            loupeOpacity.value = withDelay(
              800,
              withTiming(0, { duration: 300, easing: Easing.inOut(Easing.quad) }, (finished) => {
                if (finished) {
                  isLoupeAwake.value = false;
                  isFadingLoupe.value = false;
                }
              })
            );
          }
        }
      }

      const nowTs = Date.now();
      if (nowTs - lastScrollDispatchTimeShared.value >= 90) {
        lastScrollDispatchTimeShared.value = nowTs;
        runOnJS(handleViewportScroll)(
          event.contentOffset.y,
          event.layoutMeasurement.height,
          event.contentSize.height
        );
      }
    },
  });

  useDerivedValue(() => {
    if (isSmoothScrollingToTop.value) {
      scrollTo(mainScrollRef, 0, scrollTargetY.value, false);
    }
  });

  const scrollToTopSmoothly = useCallback(() => {
    const startY = currentYRef.current;
    if (startY <= 0) return;

    // Scale duration with distance (850ms - 1400ms) so gentle start/end are clearly visible
    const dynamicDuration = Math.min(1400, Math.max(850, Math.round(startY * 0.18)));

    scrollTargetY.value = startY;
    isSmoothScrollingToTop.value = true;
    btnStateRef.current = 'hidden';
    backToTopOpacity.value = withTiming(0, { duration: 200 });

    scrollTargetY.value = withTiming(
      0,
      {
        duration: dynamicDuration,
        easing: Easing.bezier(0.45, 0.05, 0.2, 0.98),
      },
      (finished) => {
        if (finished) {
          isSmoothScrollingToTop.value = false;
          runOnJS(setIsPast60Photos)(false);
        }
      }
    );
  }, [scrollTargetY, isSmoothScrollingToTop, backToTopOpacity]);

  const backToTopAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: backToTopOpacity.value,
      transform: [
        { translateY: (1 - backToTopOpacity.value) * 12 },
        { scale: 0.92 + backToTopOpacity.value * 0.08 },
      ],
    };
  });

  const resumePillAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: resumePillOpacity.value,
      transform: [{ translateY: resumePillTranslateY.value }],
    };
  });

  useEffect(() => {
    isLightboxOpen.value = activeImageIndex !== null || activeVideoItem !== null || isMoreDrawerOpen;
  }, [activeImageIndex, activeVideoItem, isMoreDrawerOpen, isLightboxOpen]);

  useEffect(() => {
    if (eventSlug) {
      isClosingRef.current = false;
      screenSwipeX.value = width;
      screenSwipeX.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) });
    }
  }, [eventSlug]);

  // Animate the Resume pill in when it becomes visible
  useEffect(() => {
    if (showResumePill) {
      resumePillOpacity.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) });
      resumePillTranslateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      // Auto-dismiss after 10 seconds if user doesn't interact
      const timer = setTimeout(() => {
        dismissResumePill();
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [showResumePill, resumePillOpacity, resumePillTranslateY, dismissResumePill]);

  // Pre-load saved resume position from AsyncStorage when eventSlug opens
  useEffect(() => {
    if (!eventSlug) return;
    resumePillDismissedRef.current = false;
    resumeHasCheckedOnScrollRef.current = false;
    lastSavedScrollYRef.current = 0;
    setShowResumePill(false);
    resumePillOpacity.value = 0;
    resumePillTranslateY.value = 20;

    const candidateKeys = [
      `@mycircle_resume_offset_${eventSlug}`,
      `@mycircle_resume_scroll_${eventSlug}_ALL`,
      `@mycircle_resume_scroll_${eventSlug}_HIGHLIGHTS`,
      `@mycircle_resume_scroll_${eventSlug}_MY PHOTOS`,
      `@mycircle_resume_${eventSlug}`,
    ];

    (async () => {
      for (const key of candidateKeys) {
        try {
          const val = await AsyncStorage.getItem(key);
          if (val) {
            const parsed = parseFloat(val);
            if (!isNaN(parsed) && parsed > 150) {
              resumeTargetYRef.current = parsed;
              return;
            }
          }
        } catch (_) {}
      }
    })();

    AsyncStorage.getItem(`@mycircle_resume_tab_${eventSlug}`).then((tab) => {
      if (tab) {
        resumeTargetTabRef.current = tab;
      }
    }).catch(() => {});
  }, [eventSlug, resumePillOpacity, resumePillTranslateY]);

  // Save scroll position & loaded photos cache ONLY when app goes to background, user closes app, or leaves gallery
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState.match(/inactive|background/)) {
        if (currentYRef.current > 150) {
          saveResumeScrollPosition(currentYRef.current);
        }
        if (eventSlug && allPhotosRef.current && allPhotosRef.current.length > 60) {
          useAuthStore.getState().setGalleryCache(eventSlug, {
            photos: allPhotosRef.current,
            tabCache: tabCacheRef.current,
          });
        }
      }
    });
    return () => {
      subscription.remove();
      if (currentYRef.current > 150) {
        saveResumeScrollPosition(currentYRef.current);
      }
      if (eventSlug && allPhotosRef.current && allPhotosRef.current.length > 60) {
        useAuthStore.getState().setGalleryCache(eventSlug, {
          photos: allPhotosRef.current,
          tabCache: tabCacheRef.current,
        });
      }
    };
  }, [saveResumeScrollPosition, eventSlug]);

  // Viewport-Proximity & Page Batch Pre-Fetch Engine: Prefetches upcoming thumbnail photos into native image cache
  const scheduleBatchPrefetch = useCallback((mappedList: Photo[], cols?: number) => {
    if (!mappedList || mappedList.length === 0) return;

    const activeCols = cols ?? galleryColumnsRef.current ?? 2;
    const heroHeight = Math.round(screenHeight * 0.70);
    const relativeY = Math.max(0, currentYRef.current - heroHeight);
    const rowH = getEstimatedRowHeight(activeCols, width);
    const currentRow = Math.floor(relativeY / rowH);
    const visibleStartIndex = Math.max(0, (currentRow - 2) * activeCols);
    // Scale prefetch batch dynamically: 80 for 1-2 cols, 120 for 3 cols, 160 for 4 cols, 200 for 5 cols
    const targetCount = Math.max(80, activeCols * 40);
    const targetItems = mappedList.length <= targetCount
      ? mappedList
      : mappedList.slice(visibleStartIndex, visibleStartIndex + targetCount);

    const chunkSize = 25;
    for (let i = 0; i < targetItems.length; i += chunkSize) {
      const chunk = targetItems.slice(i, i + chunkSize);
      const delay = 120 + Math.floor(i / chunkSize) * 50;
      setTimeout(() => {
        const uris: string[] = [];
        chunk.forEach((p) => {
          const targetUri = getMediaDisplayUri(p);
          if (targetUri && !prefetchedUrlsRef.current.has(targetUri)) {
            prefetchedUrlsRef.current.add(targetUri);
            uris.push(targetUri);
          }
        });
        if (uris.length > 0) {
          Image.prefetch(uris, 'memory-disk');
        }
      }, delay);
    }
  }, []);

  useEffect(() => {
    scheduleBatchPrefetchRef.current = scheduleBatchPrefetch;
  }, [scheduleBatchPrefetch]);



  const screenSwipeAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ translateX: screenSwipeX.value }],
    };
  });

  const fetchPhotosFallback = async () => {
    try {
      if (!eventSlug) return;
      const familyToken = useAuthStore.getState().token;
      const currentPasscode = useAuthStore.getState().passcode;

      // 1. Fetch event metadata
      let fetchedEventDetails: any = null;
      try {
        const eventRes = await api.get(`/api/gallery/public/events/${eventSlug}`);
        if (eventRes.data) {
          fetchedEventDetails = eventRes.data;
          setEventDetailsData(eventRes.data);
          const covers = [
            eventRes.data.coverPhotoMobileUrl,
            eventRes.data.cover_photo_mobile_url,
            eventRes.data.coverPhotoUrl,
            eventRes.data.cover_photo_url,
            eventRes.data.coverPhotoSquareUrl,
            eventRes.data.coverUrl,
            eventRes.data.bannerUrl,
          ].filter(Boolean);
          covers.forEach((c) => Image.prefetch(c));
        }
      } catch (e: any) {
        if (e?.response?.status === 404) {
          useAuthStore.getState().clearGalleryCache(eventSlug);
          onChangeEvent();
          return;
        }
        console.warn('Failed to fetch event details in fallback:', e);
      }

      // 2. SSO Token exchange for guest token
      try {
        const ssoRes = await api.post(
          `/api/gallery/public/events/${eventSlug}/auth-from-family`,
          { code: currentPasscode || undefined },
          { headers: familyToken ? { Authorization: `Bearer ${familyToken}` } : {} }
        );
        if (ssoRes.data?.token) {
          eventHeadersRef.current = { Authorization: `Bearer ${ssoRes.data.token}` };
          fetchFilmstripRef.current?.(activeTab, true);
          if (ssoRes.data?.guest) {
            const g = ssoRes.data.guest;
            setEventGuest(g);
            if (typeof g.hasFullAccess === 'boolean') {
              setGuestAccessLevel(g.hasFullAccess);
            }
          }
          // Fetch guest profile
          guestApi.get(`/api/gallery/public/events/${eventSlug}/profile`, {
            headers: eventHeadersRef.current
          }).then((profRes) => {
            if (profRes.data?.profile) {
              setEventGuest((prev: any) => ({ ...prev, ...profRes.data.profile }));
            }
          }).catch(() => {});
        } else if (familyToken) {
          eventHeadersRef.current = { Authorization: `Bearer ${familyToken}` };
        }
      } catch (e: any) {
        if (e?.response?.status === 403) {
          useAuthStore.getState().clearGalleryCache(eventSlug);
          Alert.alert(
            'Access Revoked',
            e?.response?.data?.error || 'You no longer have access to this celebration.',
            [{ text: 'OK', onPress: () => onChangeEvent() }]
          );
          onChangeEvent();
          return;
        }
        if (e?.response?.status === 401) {
          useAuthStore.getState().clearGalleryCache(eventSlug);
          await useAuthStore.getState().logout();
          onLogout?.();
          return;
        }
        if (familyToken) {
          eventHeadersRef.current = { Authorization: `Bearer ${familyToken}` };
        }
      }

      const eventHeaders = eventHeadersRef.current.Authorization
        ? eventHeadersRef.current
        : (familyToken ? { Authorization: `Bearer ${familyToken}` } : {});

      // 3. Parallel photo fetch
      const tStartInitial = Date.now();
      const initialFetchLimit = (galleryColumnsRef.current || 2) >= 4 ? 120 : ((galleryColumnsRef.current || 2) === 3 ? 90 : PAGE_SIZE);
      const [matchedRes, allRes, favRes, cinemaRes] = await Promise.all([
        guestApi.get(`/api/gallery/public/events/${eventSlug}/matched-photos`, { headers: eventHeaders }).catch((e) => {
          return { data: [], status: e?.response?.status };
        }),
        guestApi.get(`/api/gallery/public/events/${eventSlug}/photos?limit=${initialFetchLimit}&offset=0`, { headers: eventHeaders }).catch((e) => {
          return { data: [], status: e?.response?.status };
        }),
        guestApi.get(`/api/gallery/public/events/${eventSlug}/favorites`, { headers: eventHeaders }).catch((e) => {
          return { data: [], status: e?.response?.status };
        }),
        guestApi.get(`/api/gallery/public/events/${eventSlug}/photos?tab=Cinema&limit=60&offset=0`, { headers: eventHeaders }).catch((e) => {
          return { data: [], status: e?.response?.status };
        }),
      ]);
      const initialFetchDuration = Date.now() - tStartInitial;
      console.log(`[PERF ⏱️ GalleryView] Initial 4-way parallel fetch completed in ${initialFetchDuration}ms | matched: ${matchedRes.data?.photos?.length || 0} | all: ${allRes.data?.photos?.length || 0} | fav: ${favRes.data?.photos?.length || 0} | cinema: ${cinemaRes.data?.photos?.length || 0}`);

      if (allRes?.status === 401 && matchedRes?.status === 401) {
        useAuthStore.getState().clearGalleryCache(eventSlug);
        await useAuthStore.getState().logout();
        onLogout?.();
        return;
      }

      const matchedList = matchedRes.data?.photos || matchedRes.data?.matchedPhotos || (Array.isArray(matchedRes.data) ? matchedRes.data : []);
      const mappedMatched = Array.isArray(matchedList) ? matchedList.map(mapPhotoItem) : [];
      setPhotos(mappedMatched);
      if (typeof matchedRes.data?.total === 'number') {
        setTotalMatchedPhotosCount(matchedRes.data.total);
        setHasMoreMatchedPhotos(mappedMatched.length < matchedRes.data.total);
      }

      const favList = favRes.data?.photos || (Array.isArray(favRes.data) ? favRes.data : []);
      const mappedFavs = Array.isArray(favList) ? favList.map(mapPhotoItem) : [];

      const cinemaList = cinemaRes.data?.photos || (Array.isArray(cinemaRes.data) ? cinemaRes.data : []);
      const mappedCinema = Array.isArray(cinemaList) ? cinemaList.map(mapPhotoItem) : [];

      const newTabCache: Record<string, Photo[]> = {};
      if (mappedFavs.length > 0) newTabCache['MY FAVOURITES'] = mappedFavs;
      if (mappedCinema.length > 0) newTabCache['CINEMA'] = mappedCinema;

      setTabCache((prev) => ({
        ...prev,
        ...newTabCache,
      }));

      // Cinema video preloading (top 3 highest priority)
      if (mappedCinema.length > 0) {
        const cleanCouple = cleanTitle?.replace(/\s*['’]s\s*(wedding|marriage|celebration).*$/i, '').trim() || cleanTitle || '';
        const prioritizedCinema = [...mappedCinema]
          .map((v, idx) => ({ video: v, priority: getCinemaDownloadPriority(v, idx) }))
          .sort((a, b) => b.priority - a.priority);

        prioritizedCinema.slice(0, 3).forEach(({ video: v, priority }, queueIdx) => {
          const vUrl = v.videoUrl || v.fullUri || v.r2Url;
          if (vUrl) {
            const headline = formatCinemaDisplayTitle(cleanTitle, v);
            const cat = formatCinemaCategoryTitleCase(v.cinemaCategory || v.category);
            const meta = { title: headline, artist: cat, artwork: v.thumbnailUrl };

            if (queueIdx === 0) {
              videoPreloadManager.preload(vUrl, v.thumbnailUrl, meta);
            } else {
              setTimeout(() => {
                videoPreloadManager.preload(vUrl, v.thumbnailUrl, meta);
              }, queueIdx * 1500);
            }
          }
        });
      }

      const allList = allRes.data?.photos || (Array.isArray(allRes.data) ? allRes.data : []);
      const mappedPhotos = Array.isArray(allList) ? allList.map(mapPhotoItem) : [];
      const total = typeof allRes.data?.total === 'number' ? allRes.data.total : mappedPhotos.length;

      console.log(`\n================== [GALLERY OPEN DEBUG (FALLBACK) 🏛️] ==================`);
      console.log(`📸 EVENT SLUG: ${eventSlug}`);
      console.log(`📊 TOTAL PHOTOS ON SERVER: ${total}`);
      console.log(`📥 INITIAL BATCH PHOTOS RECEIVED: ${mappedPhotos.length}`);
      console.log(`👤 MATCHED PHOTOS: ${mappedMatched.length}`);
      console.log(`❤️ FAVORITES: ${mappedFavs.length}`);
      console.log(`🎬 CINEMA VIDEOS: ${mappedCinema.length}`);
      console.log(`========================================================================\n`);

      setTotalAllPhotosCount(total);
      setAllPhotos((prev) => {
        if (prev.length > mappedPhotos.length) {
          const merged = [...mappedPhotos, ...prev.slice(mappedPhotos.length)];
          const seenMerge = new Set<number | string>();
          const dedupped = merged.filter((item) => {
            const key = (item.id != null ? item.id : item.r2Url) ?? '';
            if (seenMerge.has(key)) return false;
            seenMerge.add(key);
            return true;
          });
          allPhotosOffsetRef.current = dedupped.length;
          setAllPhotosOffset(dedupped.length);
          return dedupped;
        }
        if (prev.length > 0 && prev.length === mappedPhotos.length && prev[0]?.id === mappedPhotos[0]?.id && prev[prev.length - 1]?.id === mappedPhotos[mappedPhotos.length - 1]?.id) {
          return prev;
        }
        allPhotosOffsetRef.current = mappedPhotos.length;
        setAllPhotosOffset(mappedPhotos.length);
        return mappedPhotos;
      });
      setHasMorePhotos(allPhotosOffsetRef.current < total);

      // Save to cache
      useAuthStore.getState().setGalleryCache(eventSlug, {
        details: fetchedEventDetails || undefined,
        photos: allPhotosRef.current && allPhotosRef.current.length > mappedPhotos.length ? allPhotosRef.current : mappedPhotos,
        headers: eventHeadersRef.current,
        total: total,
        hasFullAccess: guestAccessLevel ?? true,
        matched: mappedMatched,
        favorites: mappedFavs,
        tabCache: {
          ...tabCacheRef.current,
          ...(mappedFavs.length > 0 ? { 'MY FAVOURITES': mappedFavs } : {}),
          ...(mappedCinema.length > 0 ? { 'CINEMA': mappedCinema } : {}),
        },
      });

      if (!tabSparsePhotosRef.current['ALL']) {
        tabSparsePhotosRef.current['ALL'] = new Map();
      }
      mappedPhotos.forEach((p, idx) => {
        tabSparsePhotosRef.current['ALL'].set(idx, p);
      });
      setSparseVersion((v) => v + 1);

      scheduleBatchPrefetch(mappedPhotos);

      // Issue 4 fix: priority-fetch photos around saved resume position
      const savedResumeY = resumeTargetYRef.current;
      if (savedResumeY && savedResumeY > 200) {
        setTimeout(() => {
          fastCatchupPhotosRef.current?.(savedResumeY, activeTab);
        }, 300);
      }
    } catch (e: any) {
      console.warn('[MYCIRCLE FALLBACK ⚠️] Photo fetch error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPhotos = async () => {
    try {
      if (!eventSlug) return;

      const familyToken = useAuthStore.getState().token;
      const currentPasscode = useAuthStore.getState().passcode;
      const authHeader = eventHeadersRef.current.Authorization || (familyToken ? `Bearer ${familyToken}` : undefined);

      if (!authHeader) {
        setIsLoading(false);
        return;
      }

      console.log(`[MYCIRCLE REVALIDATE 🚀] Calling /bundle for event '${eventSlug}'...`);

      let bundleRes: any;
      try {
        bundleRes = await guestApi.post(
          `/api/gallery/public/events/${eventSlug}/bundle`,
          { code: currentPasscode || undefined },
          { headers: { Authorization: authHeader } }
        );
      } catch (err: any) {
        const status = err?.response?.status;
        const errData = err?.response?.data;
        const errCode = errData?.code;

        if (status === 404) {
          console.log(`[MYCIRCLE BUNDLE] /bundle not present on backend (404), falling back to standard endpoints.`);
        } else {
          console.warn(`[MYCIRCLE BUNDLE ⚠️] Status: ${status}, Code: ${errCode}`, errData);
        }

        // Security Fundamental 1: Guest was blocked or removed by admin
        if (status === 403) {
          useAuthStore.getState().clearGalleryCache(eventSlug);
          Alert.alert(
            'Access Revoked',
            errData?.error || 'You no longer have access to this celebration.',
            [{ text: 'OK', onPress: () => onChangeEvent() }]
          );
          onChangeEvent();
          return;
        }

        // Security Fundamental 2: Token expired or invalid
        if (status === 401) {
          useAuthStore.getState().clearGalleryCache(eventSlug);
          Alert.alert(
            'Session Expired',
            'Your session has expired. Please sign in again.',
            [{
              text: 'OK',
              onPress: async () => {
                await useAuthStore.getState().logout();
                onLogout?.();
              },
            }]
          );
          return;
        }

        // Route not found (404) or server error on /bundle:
        // Do NOT eject user! Fall back seamlessly to standard SSO and parallel photo fetch
        console.log('[MYCIRCLE BUNDLE] /bundle endpoint not available on server (404/error). Seamlessly falling back to standard endpoints...');
        await fetchPhotosFallback();
        return;
      }

      const bundleData = bundleRes?.data;
      if (!bundleData || !bundleData.success) {
        await fetchPhotosFallback();
        return;
      }

      // Silent token rotation from server
      if (bundleData.token) {
        eventHeadersRef.current = { Authorization: `Bearer ${bundleData.token}` };
        fetchFilmstripRef.current?.(activeTab, true);
      }

      // 1. Process Event Details
      if (bundleData.event) {
        setEventDetailsData(bundleData.event);
        const covers = [
          bundleData.event.coverPhotoMobileUrl,
          bundleData.event.cover_photo_mobile_url,
          bundleData.event.coverPhotoUrl,
          bundleData.event.cover_photo_url,
          bundleData.event.coverPhotoSquareUrl,
          bundleData.event.coverUrl,
          bundleData.event.bannerUrl,
        ].filter(Boolean);
        covers.forEach((c) => Image.prefetch(c));
      }

      // 2. Process Guest Access Level (Partial vs Full)
      const newFullAccess = bundleData.guest ? Boolean(bundleData.guest.hasFullAccess) : false;
      const oldFullAccess = guestAccessLevel;
      setGuestAccessLevel(newFullAccess);

      if (bundleData.guest) {
        setEventGuest(bundleData.guest);
      }

      // Security Fundamental 3: Guest was demoted from Full to Partial!
      // Drop ALL tab, switch immediately to HIGHLIGHTS (if highlights > 0) else MY PHOTOS
      if (oldFullAccess === true && newFullAccess === false) {
        console.log(`[MYCIRCLE ACCESS 🔒] Access downgraded from Full to Partial. Switching tab.`);
        const hlCount = bundleData.event?.tabCounts?.['HIGHLIGHTS'] ?? 0;
        setActiveTab(hlCount > 0 ? 'HIGHLIGHTS' : 'MY PHOTOS');
      }

      // 3. Process Photos
      const mappedPhotos = Array.isArray(bundleData.photos) ? bundleData.photos.map(mapPhotoItem) : [];
      const mappedMatched = Array.isArray(bundleData.matched) ? bundleData.matched.map(mapPhotoItem) : [];
      const mappedFavs = Array.isArray(bundleData.favorites) ? bundleData.favorites.map(mapPhotoItem) : [];
      const mappedCinema = Array.isArray(bundleData.cinema) ? bundleData.cinema.map(mapPhotoItem) : [];

      setPhotos(mappedMatched);

      const newTabCache: Record<string, Photo[]> = {};
      if (mappedFavs.length > 0) newTabCache['MY FAVOURITES'] = mappedFavs;
      if (mappedCinema.length > 0) newTabCache['CINEMA'] = mappedCinema;

      setTabCache((prev) => ({
        ...prev,
        ...newTabCache,
      }));

      // Cinema video preloading (top 3 highest priority)
      if (mappedCinema.length > 0) {
        const cleanCouple = cleanTitle?.replace(/\s*['’]s\s*(wedding|marriage|celebration).*$/i, '').trim() || cleanTitle || '';
        const prioritizedCinema = [...mappedCinema]
          .map((v, idx) => ({ video: v, priority: getCinemaDownloadPriority(v, idx) }))
          .sort((a, b) => b.priority - a.priority);

        prioritizedCinema.slice(0, 3).forEach(({ video: v, priority }, queueIdx) => {
          const vUrl = v.videoUrl || v.fullUri || v.r2Url;
          if (vUrl) {
            const headline = formatCinemaDisplayTitle(cleanTitle, v);
            const cat = formatCinemaCategoryTitleCase(v.cinemaCategory || v.category);
            const meta = { title: headline, artist: cat, artwork: v.thumbnailUrl };

            if (queueIdx === 0) {
              videoPreloadManager.preload(vUrl, v.thumbnailUrl, meta);
            } else {
              setTimeout(() => {
                videoPreloadManager.preload(vUrl, v.thumbnailUrl, meta);
              }, queueIdx * 1500);
            }
          }
        });
      }

      const total = typeof bundleData.total === 'number' ? bundleData.total : mappedPhotos.length;

      console.log(`\n================== [GALLERY OPEN DEBUG (BUNDLE) 🏛️] ==================`);
      console.log(`📸 EVENT SLUG: ${eventSlug}`);
      console.log(`📊 TOTAL PHOTOS ON SERVER: ${total}`);
      console.log(`📥 INITIAL BATCH PHOTOS RECEIVED: ${mappedPhotos.length}`);
      console.log(`👤 MATCHED PHOTOS: ${mappedMatched.length}`);
      console.log(`❤️ FAVORITES: ${mappedFavs.length}`);
      console.log(`🎬 CINEMA VIDEOS: ${mappedCinema.length}`);
      console.log(`📑 TAB COUNTS:`, bundleData?.event?.tabCounts || 'none');
      console.log(`======================================================================\n`);

      setTotalAllPhotosCount(total);
      setAllPhotos((prev) => {
        if (prev.length > mappedPhotos.length) {
          const merged = [...mappedPhotos, ...prev.slice(mappedPhotos.length)];
          const seenMerge2 = new Set<number | string>();
          const dedupped = merged.filter((item) => {
            const key = (item.id != null ? item.id : item.r2Url) ?? '';
            if (seenMerge2.has(key)) return false;
            seenMerge2.add(key);
            return true;
          });
          allPhotosOffsetRef.current = dedupped.length;
          setAllPhotosOffset(dedupped.length);
          return dedupped;
        }
        if (prev.length > 0 && prev.length === mappedPhotos.length && prev[0]?.id === mappedPhotos[0]?.id && prev[prev.length - 1]?.id === mappedPhotos[mappedPhotos.length - 1]?.id) {
          return prev; // Reference stability! ZERO re-render flicker!
        }
        allPhotosOffsetRef.current = mappedPhotos.length;
        setAllPhotosOffset(mappedPhotos.length);
        return mappedPhotos;
      });
      setHasMorePhotos(allPhotosOffsetRef.current < total);

      // Persist to disk/memory cache for future 0ms instant opens
      useAuthStore.getState().setGalleryCache(eventSlug, {
        details: bundleData.event || undefined,
        photos: allPhotosRef.current && allPhotosRef.current.length > mappedPhotos.length ? allPhotosRef.current : mappedPhotos,
        headers: eventHeadersRef.current,
        total: total,
        hasFullAccess: newFullAccess,
        matched: mappedMatched,
        favorites: mappedFavs,
        tabCache: {
          ...tabCacheRef.current,
          ...(mappedFavs.length > 0 ? { 'MY FAVOURITES': mappedFavs } : {}),
          ...(mappedCinema.length > 0 ? { 'CINEMA': mappedCinema } : {}),
        },
      });

      if (!tabSparsePhotosRef.current['ALL']) {
        tabSparsePhotosRef.current['ALL'] = new Map();
      }
      mappedPhotos.forEach((p: any, idx: number) => {
        tabSparsePhotosRef.current['ALL'].set(idx, p);
      });
      setSparseVersion((v) => v + 1);

      // Smooth chunked background prefetch of initial batch into native image cache
      scheduleBatchPrefetch(mappedPhotos);

      // Issue 4 fix: if user has a saved resume position, priority-fetch photos around that
      // position so network is focused on where they actually are, not always from the top.
      const savedResumeY = resumeTargetYRef.current;
      if (savedResumeY && savedResumeY > 200) {
        setTimeout(() => {
          fastCatchupPhotosRef.current?.(savedResumeY, activeTab);
        }, 300);
      }

      // Revalidate filmstrip milestones with latest event photo count
      fetchFilmstripRef.current?.(activeTab, true);
    } catch (err) {
      console.warn('[MYCIRCLE REVALIDATE ⚠️] fetchPhotos error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshGallery = async () => {
    setIsRefreshingGallery(true);
    try {
      clearRevealedPhotosCache();
      filmstripCacheRef.current = {};
      await Promise.all([
        fetchPhotos(),
        fetchFilmstripRef.current ? fetchFilmstripRef.current(activeTab, true) : Promise.resolve(),
      ]);
    } catch (_) {
    } finally {
      setIsRefreshingGallery(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  const loadMorePhotos = async () => {
    if (isFetchingMoreRef.current || isLoadingMore || isLoading || !eventSlug) return;

    const normTab = activeTab.toUpperCase();
    if (normTab === 'ALL' && !hasMorePhotos) return;
    if (normTab === 'MY FAVOURITES') return;

    if (normTab === 'MY PHOTOS') {
      if (!hasMoreMatchedPhotosRef.current) return;
      const currentOffset = photosRef.current.length;
      if (totalMatchedPhotosCount !== null && currentOffset >= totalMatchedPhotosCount) {
        setHasMoreMatchedPhotos(false);
        return;
      }
      const eventHeaders = getAuthHeaders();
      const dynamicPageSize = (galleryColumnsRef.current || 2) >= 4 ? 120 : ((galleryColumnsRef.current || 2) === 3 ? 90 : PAGE_SIZE);
      try {
        isFetchingMoreRef.current = true;
        setIsLoadingMore(true);
        console.log(`[MYCIRCLE DEBUG 📥] Pre-fetching next page for 'MY PHOTOS' -> offset=${currentOffset}, limit=${dynamicPageSize}...`);
        const matchedRes = await guestApi.get(
          `/api/gallery/public/events/${eventSlug}/matched-photos?limit=${dynamicPageSize}&offset=${currentOffset}`,
          { headers: eventHeaders }
        );
        const matchedList = matchedRes.data?.photos || (Array.isArray(matchedRes.data) ? matchedRes.data : []);
        const mapped = Array.isArray(matchedList) ? matchedList.map(mapPhotoItem) : [];
        if (mapped.length > 0) {
          if (!tabSparsePhotosRef.current['MY PHOTOS']) {
            tabSparsePhotosRef.current['MY PHOTOS'] = new Map();
          }
          mapped.forEach((p, idx) => {
            tabSparsePhotosRef.current['MY PHOTOS'].set(currentOffset + idx, p);
          });
          scheduleBatchPrefetch(mapped);
          setPhotos((prev) => {
            const next = [...prev, ...mapped];
            const seen = new Set<number | string>();
            return next.filter((item) => {
              const key = (item.id != null ? item.id : item.r2Url) ?? '';
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          });
          if (typeof matchedRes.data?.total === 'number') {
            setTotalMatchedPhotosCount(matchedRes.data.total);
            if (currentOffset + mapped.length >= matchedRes.data.total) {
              setHasMoreMatchedPhotos(false);
            }
          } else if (mapped.length < dynamicPageSize) {
            setHasMoreMatchedPhotos(false);
          }
        } else {
          setHasMoreMatchedPhotos(false);
        }
      } catch (err) {
        console.warn('[MY PHOTOS loadMorePhotos error]:', err);
      } finally {
        isFetchingMoreRef.current = false;
        setIsLoadingMore(false);
      }
      return;
    }

    const isCeremonyTab = normTab !== 'ALL' && normTab !== 'MY PHOTOS' && normTab !== 'MY FAVOURITES';
    // Stop fetching if this ceremony tab has no more photos
    if (isCeremonyTab && tabHasMoreRef.current[normTab] === false) return;
    const currentOffset = isCeremonyTab
      ? (tabItemCountsRef.current[normTab] ?? (tabCache[normTab]?.length || 0))
      : allPhotosOffsetRef.current;

    const tabQuery = isCeremonyTab ? `&tab=${encodeURIComponent(activeTab)}` : '';
    const eventHeaders = getAuthHeaders();
    const dynamicPageSize = (galleryColumnsRef.current || 2) >= 4 ? 120 : ((galleryColumnsRef.current || 2) === 3 ? 90 : PAGE_SIZE);
    let retried401 = false;
    try {
      isFetchingMoreRef.current = true;
      setIsLoadingMore(true);

      const loadMoreStartTime = Date.now();
      console.log(`[MYCIRCLE DEBUG 📥] Pre-fetching next page for '${normTab}' -> offset=${currentOffset}, limit=${dynamicPageSize}...`);

      const allRes = await guestApi.get(
        `/api/gallery/public/events/${eventSlug}/photos?limit=${dynamicPageSize}&offset=${currentOffset}${tabQuery}`,
        { headers: eventHeaders }
      );
      const allList = allRes.data.photos || (Array.isArray(allRes.data) ? allRes.data : []);

      const mapped = Array.isArray(allList) ? allList.map(mapPhotoItem) : [];
      const loadMoreDuration = Date.now() - loadMoreStartTime;
      console.log(`[PERF ⏱️ GalleryView] Page Fetch Done in ${loadMoreDuration}ms | Received ${mapped.length} new photos for '${normTab}' | New Offset: ${currentOffset + mapped.length}`);

      if (mapped.length > 0) {
        if (!tabSparsePhotosRef.current[normTab]) {
          tabSparsePhotosRef.current[normTab] = new Map();
        }
        mapped.forEach((p, idx) => {
          tabSparsePhotosRef.current[normTab].set(currentOffset + idx, p);
        });
        setSparseVersion((v) => v + 1);

        scheduleBatchPrefetch(mapped);

        if (isCeremonyTab) {
          const newOffset = currentOffset + mapped.length;
          tabItemCountsRef.current[normTab] = newOffset;
          setTabCache((prev) => {
            const existing = prev[normTab] || [];
            const combined = [...existing, ...mapped];
            const seenTab = new Set<number | string>();
            const dedupped = combined.filter((item) => {
              const key = (item.id != null ? item.id : item.r2Url) ?? '';
              if (seenTab.has(key)) return false;
              seenTab.add(key);
              return true;
            });
            return { ...prev, [normTab]: dedupped };
          });
        } else {
          allPhotosOffsetRef.current += mapped.length;
          setAllPhotosOffset(allPhotosOffsetRef.current);
          setAllPhotos((prev) => {
            const next = [...prev, ...mapped];
            const seenAll = new Set<number | string>();
            const dedupped = next.filter((item) => {
              const key = (item.id != null ? item.id : item.r2Url) ?? '';
              if (seenAll.has(key)) return false;
              seenAll.add(key);
              return true;
            });
            const reachedTotal = totalAllPhotosCount !== null && dedupped.length >= totalAllPhotosCount;
            if (reachedTotal) {
              setHasMorePhotos(false);
            }
            return dedupped;
          });
        }
      } else {
        if (!isCeremonyTab) {
          setHasMorePhotos(false);
        } else {
          tabHasMoreRef.current[normTab] = false;
        }
      }
    } catch (e: any) {
      // Auto-retry once on 401 with fresh headers (token may have been rotated by a concurrent /bundle call)
      if (e?.response?.status === 401 && !retried401) {
        retried401 = true;
        const freshHeaders = eventHeadersRef.current;
        if (freshHeaders?.Authorization && freshHeaders.Authorization !== eventHeaders?.Authorization) {
          console.log('[MYCIRCLE DEBUG 🔄] 401 received, retrying with refreshed token...');
          try {
            const retryRes = await guestApi.get(
              `/api/gallery/public/events/${eventSlug}/photos?limit=${dynamicPageSize}&offset=${currentOffset}${tabQuery}`,
              { headers: freshHeaders }
            );
            const retryList = retryRes.data.photos || (Array.isArray(retryRes.data) ? retryRes.data : []);
            const retryMapped = Array.isArray(retryList) ? retryList.map(mapPhotoItem) : [];
            if (retryMapped.length > 0) {
              scheduleBatchPrefetch(retryMapped);
              if (isCeremonyTab) {
                tabItemCountsRef.current[normTab] = currentOffset + retryMapped.length;
                setTabCache((prev) => ({ ...prev, [normTab]: [...(prev[normTab] || []), ...retryMapped] }));
              } else {
                allPhotosOffsetRef.current += retryMapped.length;
                setAllPhotosOffset(allPhotosOffsetRef.current);
                setAllPhotos((prev) => [...prev, ...retryMapped]);
              }
            } else {
              if (isCeremonyTab) { tabHasMoreRef.current[normTab] = false; } else { setHasMorePhotos(false); }
            }
          } catch (_retryErr) {
            // Retry also failed — give up silently
          }
        }
      } else {
        console.warn('[MYCIRCLE DEBUG ⚠️] loadMorePhotos error:', e);
      }
    } finally {
      isFetchingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  };
  loadMorePhotosRef.current = loadMorePhotos;

  const fastCatchupPhotos = useCallback(async (targetY: number, targetTab: string, explicitTargetIdx?: number) => {
    if (!eventSlug || isFastCatchingUpRef.current) return;
    const normTab = targetTab.trim().toUpperCase();
    if (normTab === 'MY PHOTOS' || normTab === 'MY FAVOURITES' || normTab === 'CINEMA') return;

    const isCeremonyTab = normTab !== 'ALL';
    const currentCols = galleryColumnsRef.current || 2;
    const heroHeight = Math.round(screenHeight * 0.70);
    const relativeY = Math.max(0, targetY - heroHeight);
    const rowH = getEstimatedRowHeight(currentCols, width);
    const targetRow = Math.floor(relativeY / rowH);
    const targetPhotoIndex = typeof explicitTargetIdx === 'number'
      ? explicitTargetIdx
      : Math.max(0, targetRow * currentCols);

    const maxKnown = !isCeremonyTab
      ? (totalAllPhotosCount !== null ? totalAllPhotosCount : 10000)
      : (eventDetails?.tabCounts?.[normTab] ?? 5000);

    const eventHeaders = getAuthHeaders();
    const tabQuery = isCeremonyTab ? `&tab=${encodeURIComponent(targetTab)}` : '';

    // ── STEP 1: URGENT ON-SCREEN WINDOW FETCH ─────────────────────────────
    // Fetch the 50 photos directly in and around the viewport first!
    const windowStart = Math.max(0, targetPhotoIndex - 10);
    const windowLimit = Math.min(60, Math.max(1, maxKnown - windowStart));

    // Check if we already have this window in sparse cache
    const currentSparse = tabSparsePhotosRef.current[normTab];
    let hasWindow = true;
    for (let checkIdx = windowStart; checkIdx < windowStart + Math.min(20, windowLimit); checkIdx++) {
      if (!currentSparse?.has(checkIdx) && !activeListRef.current[checkIdx]) {
        hasWindow = false;
        break;
      }
    }

    if (!hasWindow && windowLimit > 0) {
      try {
        isFastCatchingUpRef.current = true;

        console.log(`[ON-SCREEN PRIORITY 🎯] Fetching priority window for '${normTab}': offset=${windowStart}, limit=${windowLimit} (Target Photo #${targetPhotoIndex + 1})`);
        const onScreenRes = await guestApi.get(
          `/api/gallery/public/events/${eventSlug}/photos?limit=${windowLimit}&offset=${windowStart}${tabQuery}`,
          { headers: eventHeaders }
        );
        const onScreenList = onScreenRes.data.photos || (Array.isArray(onScreenRes.data) ? onScreenRes.data : []);
        const mappedOnScreen = Array.isArray(onScreenList) ? onScreenList.map(mapPhotoItem) : [];

        if (mappedOnScreen.length > 0) {
          if (!tabSparsePhotosRef.current[normTab]) {
            tabSparsePhotosRef.current[normTab] = new Map();
          }
          const sMap = tabSparsePhotosRef.current[normTab];
          mappedOnScreen.forEach((p, idx) => {
            sMap.set(windowStart + idx, p);
          });

          // Trigger immediate UI refresh so on-screen photos upgrade to full quality
          setSparseVersion((v) => v + 1);

          // If we had a pending jump and scroll was clamped before content expansion, re-align
          if (
            pendingJumpTargetIndexRef.current !== null &&
            pendingJumpTargetScopeRef.current === `${eventSlug}::${normTab}`
          ) {
            setTimeout(() => {
              const targetIndex = pendingJumpTargetIndexRef.current;
              if (
                targetIndex === null ||
                eventSlugRef.current !== eventSlug ||
                (activeTabRef.current || 'ALL').trim().toUpperCase() !== normTab
              ) {
                return;
              }
              const reScrollY = getPhotoScrollOffset(
                targetIndex,
                totalTabPhotosRef.current,
                photoScrollOffsetsShared.value,
                galleryContentHeightShared.value,
                screenHeight,
                Math.round(screenHeight * 0.70),
              );
              scrollToY(reScrollY, true);
              currentYRef.current = reScrollY;
              lastSavedScrollYRef.current = reScrollY;
              saveResumeScrollPosition(reScrollY);
              pendingJumpTargetYRef.current = null;
              pendingJumpTargetIndexRef.current = null;
              pendingJumpTargetScopeRef.current = null;
            }, 30);
          }

          // Prefetch immediate on-screen image files into native cache
          scheduleBatchPrefetch(mappedOnScreen);

          // If this chunk connects with the start, merge into contiguous allPhotos/tabCache
          const currentCount = isCeremonyTab ? (tabCache[normTab]?.length || 0) : allPhotosRef.current.length;
          if (windowStart <= currentCount) {
            if (isCeremonyTab) {
              setTabCache((prev) => {
                const existing = prev[normTab] || [];
                const merged = [...existing];
                mappedOnScreen.forEach((p, i) => { merged[windowStart + i] = p; });
                return { ...prev, [normTab]: merged };
              });
            } else {
              setAllPhotos((prev) => {
                const merged = [...prev];
                mappedOnScreen.forEach((p, i) => { merged[windowStart + i] = p; });
                allPhotosOffsetRef.current = Math.max(allPhotosOffsetRef.current, windowStart + mappedOnScreen.length);
                return merged;
              });
            }
          }
        }
      } catch (err: any) {
        if (err?.response?.status === 401) {
          // Token expired or rotated — refresh guest token via SSO or global family token
          try {
            const familyToken = useAuthStore.getState().token;
            if (familyToken && eventSlug) {
              const ssoRes = await api.post(
                `/api/gallery/public/events/${eventSlug}/auth-from-family`,
                { code: passcode || undefined },
                { headers: { Authorization: `Bearer ${familyToken}` } }
              );
              if (ssoRes.data?.token) {
                const freshHeaders = { Authorization: `Bearer ${ssoRes.data.token}` };
                eventHeadersRef.current = freshHeaders;
                const retryRes = await guestApi.get(
                  `/api/gallery/public/events/${eventSlug}/photos?limit=${windowLimit}&offset=${windowStart}${tabQuery}`,
                  { headers: freshHeaders }
                );
                const retryList = retryRes.data.photos || (Array.isArray(retryRes.data) ? retryRes.data : []);
                const mappedRetry = Array.isArray(retryList) ? retryList.map(mapPhotoItem) : [];
                if (mappedRetry.length > 0) {
                  if (!tabSparsePhotosRef.current[normTab]) {
                    tabSparsePhotosRef.current[normTab] = new Map();
                  }
                  const sMap = tabSparsePhotosRef.current[normTab];
                  mappedRetry.forEach((p, idx) => {
                    sMap.set(windowStart + idx, p);
                  });
                  setSparseVersion((v) => v + 1);
                  scheduleBatchPrefetch(mappedRetry);
                  return;
                }
              }
            }
          } catch (_ssoErr) {}
        }
        console.warn('[ON-SCREEN PRIORITY ⚠️] Error fetching priority window:', err);
      } finally {
        isFastCatchingUpRef.current = false;
      }
    }
  }, [eventSlug, totalAllPhotosCount, eventDetails, tabCache, scheduleBatchPrefetch, scrollToY, photoScrollOffsetsShared, galleryContentHeightShared, screenHeight, saveResumeScrollPosition, getAuthHeaders, passcode]);
  fastCatchupPhotosRef.current = fastCatchupPhotos;

  useEffect(() => {
    fetchPhotos();
  }, [eventSlug]);


  const isBrideOrGroom = React.useMemo(() => {
    // 1. Check global user profile (global role, if set)
    const pRole = (profile?.displayRole || (profile as any)?.role || (profile as any)?.userRole || '').toString().toUpperCase();
    if (['BRIDE', 'GROOM', 'COUPLE'].includes(pRole)) {
      return true;
    }

    // 2. Check per-event role from userEvents list (most reliable — returned by /api/gallery/family/events)
    if (eventSlug && Array.isArray(userEvents) && userEvents.length > 0) {
      const thisEvent = userEvents.find((e: any) => {
        const slug = e.slug || e.eventSlug || e.event?.slug || '';
        return slug === eventSlug;
      });
      if (thisEvent) {
        const evRole = (
          thisEvent.guestInfo?.displayRole ||
          thisEvent.displayRole ||
          thisEvent.role ||
          thisEvent.guestRole ||
          thisEvent.userRole ||
          thisEvent.guest?.displayRole ||
          thisEvent.guest?.role ||
          ''
        ).toString().toUpperCase();
        if (['BRIDE', 'GROOM', 'COUPLE'].includes(evRole)) {
          return true;
        }
      }
    }

    // 3. Check event-specific guest object from SSO response
    if (eventGuest) {
      const gRole = (eventGuest.displayRole || eventGuest.role || eventGuest.relationship || eventGuest.type || '').toString().toUpperCase();
      if (['BRIDE', 'GROOM', 'COUPLE'].includes(gRole)) {
        return true;
      }
      if (eventGuest.isBride || eventGuest.isGroom || eventGuest.isCouple) {
        return true;
      }
    }

    // 4. Check eventDetails (participants array, userRole, bride/groom metadata)
    if (eventDetails) {
      const eRole = (eventDetails.userRole || eventDetails.guestRole || eventDetails.role || '').toString().toUpperCase();
      if (['BRIDE', 'GROOM', 'COUPLE'].includes(eRole)) {
        return true;
      }
      if (eventDetails.isBride || eventDetails.isGroom) {
        return true;
      }
      // Check participants list if present
      if (Array.isArray(eventDetails.participants)) {
        const userEmail = (profile?.email || eventGuest?.email || '').toLowerCase();
        const userName = (profile?.name || eventGuest?.name || '').toLowerCase();
        const userPhone = (profile?.phoneNumber || eventGuest?.phoneNumber || '').toString();

        const match = eventDetails.participants.find((part: any) => {
          const partRole = (part.role || part.displayRole || part.type || '').toString().toUpperCase();
          if (!['BRIDE', 'GROOM', 'COUPLE'].includes(partRole)) return false;

          if (userEmail && part.email && part.email.toLowerCase() === userEmail) return true;
          if (userName && part.name && part.name.toLowerCase() === userName) return true;
          if (userPhone && part.phoneNumber && part.phoneNumber.toString() === userPhone) return true;
          return false;
        });
        if (match) {
          return true;
        }
      }
    }

    return false;
  }, [profile, userEvents, eventSlug, eventGuest, eventDetails]);


  // Load locked photo IDs: Populate from API-returned photos (isPrivate flag) when photos load,
  // and use AsyncStorage as a local cache for optimistic UI before the first API round-trip.
  useEffect(() => {
    const storageKey = `@mycircle_locked_photos_${eventSlug || 'default'}`;
    AsyncStorage.getItem(storageKey).then((saved) => {
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setLockedPhotoIds(new Set(parsed.map((id: any) => Number(id))));
          }
        } catch (_e) {}
      }
    }).catch(() => {});
  }, [eventSlug]);

  // Sync isPrivate flags returned by the API into lockedPhotoIds state
  useEffect(() => {
    const privateFromApi = [...allPhotos, ...Object.values(tabCache).flat()]
      .filter((p: any) => p.isPrivate === true)
      .map((p: any) => Number(p.id));

    if (privateFromApi.length === 0) return;

    setLockedPhotoIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      privateFromApi.forEach((id) => {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      });
      if (!changed) return prev;
      const storageKey = `@mycircle_locked_photos_${eventSlug || 'default'}`;
      AsyncStorage.setItem(storageKey, JSON.stringify(Array.from(next))).catch(() => {});
      return next;
    });
  }, [allPhotos, eventSlug]);

  // Toggle Lock/Unlock handler for Bride & Groom - calls real backend API
  const handleToggleLockPhoto = useCallback(async (photo: any) => {
    if (!photo || typeof photo.id === 'undefined') return;
    const photoId = Number(photo.id);
    const isCurrentlyLocked = lockedPhotoIds.has(photoId) || !!(photo.isLocked || photo.isPrivate);
    const newPrivateState = !isCurrentlyLocked;

    // Optimistic update immediately for instant UI feedback
    setLockedPhotoIds((prev) => {
      const next = new Set(prev);
      if (newPrivateState) {
        next.add(photoId);
      } else {
        next.delete(photoId);
      }
      const storageKey = `@mycircle_locked_photos_${eventSlug || 'default'}`;
      AsyncStorage.setItem(storageKey, JSON.stringify(Array.from(next))).catch(() => {});
      return next;
    });

    photo.isLocked = newPrivateState;
    photo.isPrivate = newPrivateState;
    setTabCache({});

    // Sync to backend
    try {
      await guestApi.patch(
        `/api/gallery/public/events/${eventSlug}/photos/${photoId}/privacy`,
        { isPrivate: newPrivateState },
        { headers: eventHeadersRef.current }
      );
    } catch (err: any) {
      // Rollback optimistic update on API failure
      setLockedPhotoIds((prev) => {
        const next = new Set(prev);
        if (newPrivateState) {
          next.delete(photoId);
        } else {
          next.add(photoId);
        }
        const storageKey = `@mycircle_locked_photos_${eventSlug || 'default'}`;
        AsyncStorage.setItem(storageKey, JSON.stringify(Array.from(next))).catch(() => {});
        return next;
      });
      photo.isLocked = isCurrentlyLocked;
      photo.isPrivate = isCurrentlyLocked;
      setTabCache({});
      console.warn('[LOCK PHOTO ⚠️] API sync failed, rolled back:', err?.message);
    }
  }, [eventSlug, lockedPhotoIds]);

  // tabCache and isTabLoading are declared above the sync effects that reference them

  const favoritesCount = React.useMemo(() => {
    if (tabCache['MY FAVOURITES']) {
      return tabCache['MY FAVOURITES'].length;
    }
    return allPhotos.filter((p: any) => p.isLiked).length;
  }, [allPhotos, tabCache]);

  const highlightsCount = React.useMemo(() => {
    const rawCount = typeof eventDetails?.tabCounts?.['HIGHLIGHTS'] === 'number'
      ? eventDetails.tabCounts['HIGHLIGHTS']
      : (typeof eventDetails?.tabCounts?.['highlights'] === 'number'
          ? eventDetails.tabCounts['highlights']
          : (typeof eventDetails?.tab_counts?.['HIGHLIGHTS'] === 'number'
              ? eventDetails.tab_counts['HIGHLIGHTS']
              : (typeof eventDetails?.tab_counts?.['highlights'] === 'number'
                  ? eventDetails.tab_counts['highlights']
                  : (typeof eventDetails?.highlightsPhotoCount === 'number'
                      ? eventDetails.highlightsPhotoCount
                      : (typeof eventDetails?.highlights_photo_count === 'number'
                          ? eventDetails.highlights_photo_count
                          : (typeof eventDetails?.highlightsCount === 'number'
                              ? eventDetails.highlightsCount
                              : (typeof eventDetails?.highlights_count === 'number'
                                  ? eventDetails.highlights_count
                                  : 0)))))));
    const inTabCache = tabCache['HIGHLIGHTS']?.length || 0;
    const inAllPhotos = allPhotos.filter((p: any) => p.isHighlight || (p.tabName && p.tabName.trim().toUpperCase() === 'HIGHLIGHTS')).length;
    return Math.max(rawCount, inTabCache, inAllPhotos);
  }, [allPhotos, tabCache, eventDetails]);

  // Per-tab server loader (matching web 1:1)
  const fetchTabPhotos = useCallback(async (tabName: string) => {
    const norm = tabName.trim().toUpperCase();
    if (norm === 'ALL' || norm === 'MY PHOTOS' || norm === 'MY FAVOURITES') return;
    if (tabCache[norm]) return; // Already cached

    // Check if eventDetails already reports 0 photos for this tab
    const knownTabCount = eventDetails?.tabCounts?.[norm];
    if (typeof knownTabCount === 'number' && knownTabCount === 0) {
      setTabCache((prev) => ({ ...prev, [norm]: [] }));
      return;
    }

    const hasAnyInAll = allPhotos.some((p: any) => p.tabName && p.tabName.trim().toUpperCase() === norm);
    try {
      if (!hasAnyInAll) {
        setIsTabLoading(true);
      }
      const familyToken = useAuthStore.getState().token;
      const eventHeaders = eventHeadersRef.current.Authorization
        ? eventHeadersRef.current
        : (familyToken ? { Authorization: `Bearer ${familyToken}` } : {});
      const res = await guestApi.get(
        `/api/gallery/public/events/${eventSlug}/photos?limit=60&tab=${encodeURIComponent(tabName)}`,
        { headers: eventHeaders }
      );
      const rawList = res.data.photos || (Array.isArray(res.data) ? res.data : []);
      const mapped = Array.isArray(rawList) ? rawList.map(mapPhotoItem) : [];

      if (!tabSparsePhotosRef.current[norm]) {
        tabSparsePhotosRef.current[norm] = new Map();
      }
      mapped.forEach((p, idx) => {
        tabSparsePhotosRef.current[norm].set(idx, p);
      });
      setSparseVersion((v) => v + 1);

      // Smooth chunked background prefetch of tab thumbnails into native cache
      scheduleBatchPrefetch(mapped);

      setTabCache((prev) => ({ ...prev, [norm]: mapped }));
    } catch (err) {
      console.warn(`Failed to fetch photos for tab ${tabName}:`, err);
    } finally {
      setIsTabLoading(false);
    }
  }, [eventSlug, tabCache, allPhotos, eventDetails?.tabCounts]);

  useEffect(() => {
    if (activeTab && activeTab !== 'ALL' && activeTab !== 'MY PHOTOS' && activeTab !== 'MY FAVOURITES') {
      fetchTabPhotos(activeTab);
    }
  }, [activeTab, fetchTabPhotos]);

  // Dynamic Available Tabs (Matching website ordering and access rules 1:1)
  const availableTabs = React.useMemo(() => {
    const list: string[] = [];

    // 1. ALL Tab (Only visible to Full Access guests)
    if (hasFullAccess) {
      list.push('ALL');
    }

    // 2. MY PHOTOS Tab (Always visible whether 0 or > 0)
    list.push('MY PHOTOS');

    // 3. MY FAVOURITES Tab (Only visible if favorites count > 0)
    if (favoritesCount > 0) {
      list.push('MY FAVOURITES');
    }

    // 4. Dynamic Ceremony/Event Tabs from eventDetails.tabs (from DB)
    const ceremonyTabsSet = new Set<string>();

    // Only include HIGHLIGHTS if highlightsCount > 0
    if (highlightsCount > 0) {
      ceremonyTabsSet.add('HIGHLIGHTS');
    }

    // Only include folders from eventDetails.tabs if count > 0
    if (Array.isArray(eventDetails?.tabs)) {
      eventDetails.tabs.forEach((t: string) => {
        if (t && typeof t === 'string' && t.trim().length > 0) {
          const upper = t.trim().toUpperCase();
          if (upper === 'HIGHLIGHTS') {
            if (highlightsCount > 0) {
              ceremonyTabsSet.add('HIGHLIGHTS');
            }
          } else {
            const count = eventDetails?.tabCounts?.[upper] ?? eventDetails?.tabCounts?.[t.trim()] ?? 0;
            if (count > 0) {
              ceremonyTabsSet.add(upper);
            }
          }
        }
      });
    }

    // Also include any unique tabNames found in loaded photos
    allPhotos.forEach((p: any) => {
      if (p.tabName && typeof p.tabName === 'string' && p.tabName.trim().length > 0) {
        const upper = p.tabName.trim().toUpperCase();
        if (upper === 'HIGHLIGHTS') {
          if (highlightsCount > 0) {
            ceremonyTabsSet.add('HIGHLIGHTS');
          }
        } else {
          ceremonyTabsSet.add(upper);
        }
      }
    });

    if (tabCache['CINEMA'] && tabCache['CINEMA'].length > 0) {
      ceremonyTabsSet.add('CINEMA');
    }

    const allowedTabs: string[] = [];
    ceremonyTabsSet.forEach((tab) => {
      if (tab !== 'ALL' && tab !== 'MY PHOTOS' && tab !== 'MY FAVOURITES' && !tab.includes('LOCKED')) {
        if (hasFullAccess || tab === 'HIGHLIGHTS' || tab === 'CINEMA') {
          allowedTabs.push(tab);
        }
      }
    });

    // Ensure HIGHLIGHTS is first (if present), CINEMA is second, followed by all other ceremony tabs
    const orderedCeremony: string[] = [];
    if (allowedTabs.includes('HIGHLIGHTS')) orderedCeremony.push('HIGHLIGHTS');
    if (allowedTabs.includes('CINEMA')) orderedCeremony.push('CINEMA');
    allowedTabs.forEach((tab) => {
      if (tab !== 'HIGHLIGHTS' && tab !== 'CINEMA') {
        orderedCeremony.push(tab);
      }
    });

    orderedCeremony.forEach((tab) => {
      if (!list.includes(tab)) {
        list.push(tab);
      }
    });

    // 5. LOCKED Tab (Only visible to Bride & Groom if locked count > 0)
    if (isBrideOrGroom && lockedPhotoIds.size > 0) {
      list.push('LOCKED 🔐');
    }

    return list;
  }, [hasFullAccess, favoritesCount, highlightsCount, eventDetails?.tabs, eventDetails?.tabCounts, allPhotos, tabCache, isBrideOrGroom, lockedPhotoIds]);

  const activeCategorySharedIndex = useSharedValue(0);
  const categoryTranslateX = useSharedValue(0);

  const currentCategoryIndex = useMemo(() => {
    const idx = availableTabs.findIndex((t) => t.toUpperCase() === activeTab.toUpperCase());
    return idx >= 0 ? idx : 0;
  }, [availableTabs, activeTab]);

  useEffect(() => {
    activeCategorySharedIndex.value = currentCategoryIndex;
    categoryTranslateX.value = 0;
  }, [currentCategoryIndex]);

  const changeTabWithScrollMemory = useCallback((newTab: string, isFromSwipe = false) => {
    userHasSwitchedTabRef.current = true;
    const currentNorm = activeTab.toUpperCase();
    const newNorm = newTab.toUpperCase();
    if (newNorm === currentNorm) return;

    // 1. Lock onScroll during tab transition so native height clamping doesn't erase saved scroll Y
    isTabSwitchingRef.current = true;
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }

    // 2. Save exact scroll position of the photo tab we are leaving
    if (currentNorm !== 'CINEMA' && !isResumingScrollRef.current) {
      tabOffsetsRef.current[currentNorm] = currentYRef.current;
    }

    // 3. Switch tab
    setActiveTab(newTab);
    fetchTabPhotos(newTab);

    // 4. Shared index update
    const newIdx = availableTabs.findIndex((t) => t.toUpperCase() === newNorm);
    if (newIdx >= 0) {
      if (isFromSwipe) {
        // Atomic instant sync post-swipe: gesture already completed movement
        activeCategorySharedIndex.value = newIdx;
        categoryTranslateX.value = 0;
      } else {
        // Smooth timing animation for pill taps
        categoryTranslateX.value = 0;
        activeCategorySharedIndex.value = withTiming(newIdx, { duration: 200, easing: Easing.out(Easing.quad) });
      }
    }
  }, [activeTab, availableTabs, fetchTabPhotos]);

  const handleResumeViewing = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    dismissResumePill();
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }
    const targetY = resumeTargetYRef.current;
    const rawTargetTab = resumeTargetTabRef.current || activeTab;
    const targetTabUpper = rawTargetTab.trim().toUpperCase();

    if (targetY === null || targetY <= 0) return;

    isResumingScrollRef.current = true;
    isTabSwitchingRef.current = true;
    tabOffsetsRef.current[targetTabUpper] = targetY;
    currentYRef.current = targetY;
    lastSavedScrollYRef.current = targetY;

    // Trigger fast parallel catchup for missing photos
    fastCatchupPhotos(targetY, targetTabUpper);

    const performJump = () => {
      scrollToY(targetY, true);
      // Double check after animation to lock into target position and release lock
      setTimeout(() => {
        scrollToY(targetY, false);
        isResumingScrollRef.current = false;
        isTabSwitchingRef.current = false;
        lastSavedScrollYRef.current = targetY;
        saveResumeScrollPosition(targetY);
      }, 500);
    };

    if (targetTabUpper !== activeTab.trim().toUpperCase() && availableTabs.map((t) => t.toUpperCase()).includes(targetTabUpper)) {
      const matchedTab = availableTabs.find((t) => t.toUpperCase() === targetTabUpper) || rawTargetTab;
      changeTabWithScrollMemory(matchedTab);
      // Give tab switch time to commit, then execute smooth jump
      setTimeout(performJump, 120);
    } else {
      performJump();
    }
  }, [activeTab, availableTabs, changeTabWithScrollMemory, scrollToY, dismissResumePill, fastCatchupPhotos, saveResumeScrollPosition]);

  // Per-tab scroll restoration effect: triggers ONLY when activeTab changes between photo tabs
  useEffect(() => {
    if (isLoading || isTabLoading) return;

    if (prevTabRef.current !== activeTab) {
      const prevTab = prevTabRef.current;
      prevTabRef.current = activeTab;

      // On initial load / mount, establish activeTab ref without executing a scroll reset
      if (prevTab === null) {
        return;
      }

      // When entering or exiting CINEMA, do not touch scroll: Photos gallery is preserved underneath!
      if ((prevTab && prevTab.trim().toUpperCase() === 'CINEMA') || activeTab.trim().toUpperCase() === 'CINEMA') {
        isTabSwitchingRef.current = false;
        return;
      }

      // If this tab change was triggered by Resume Viewing, handleResumeViewing manages the jump!
      if (isResumingScrollRef.current) {
        return;
      }

      const norm = activeTab.toUpperCase();
      const targetY = tabOffsetsRef.current[norm] ?? 0;
      currentYRef.current = targetY;

      scrollToY(targetY);
      requestAnimationFrame(() => {
        scrollToY(targetY);
        setTimeout(() => {
          scrollToY(targetY);
          isTabSwitchingRef.current = false;
        }, 40);
      });
    }
  }, [activeTab, isLoading, isTabLoading, scrollToY]);

  const handleNextCategoryTab = useCallback(() => {
    const currentIdx = activeCategorySharedIndex.value;
    if (currentIdx >= 0 && currentIdx < availableTabs.length - 1) {
      const nextTab = availableTabs[currentIdx + 1];
      changeTabWithScrollMemory(nextTab, true);
    }
  }, [availableTabs, changeTabWithScrollMemory]);

  const handlePrevCategoryTab = useCallback(() => {
    const currentIdx = activeCategorySharedIndex.value;
    if (currentIdx > 0) {
      const prevTab = availableTabs[currentIdx - 1];
      changeTabWithScrollMemory(prevTab, true);
    }
  }, [availableTabs, changeTabWithScrollMemory]);

  const finalizeCinemaExit = useCallback(() => {
    const targetTab = (lastNonCinemaTabRef.current && availableTabs.includes(lastNonCinemaTabRef.current))
      ? lastNonCinemaTabRef.current
      : (availableTabs.includes('ALL') ? 'ALL' : (availableTabs.find((t) => t.trim().toUpperCase() !== 'CINEMA') || 'ALL'));

    const targetNorm = targetTab.toUpperCase();
    const newIdx = availableTabs.findIndex((t) => t.toUpperCase() === targetNorm);
    if (newIdx >= 0) {
      activeCategorySharedIndex.value = newIdx;
      categoryTranslateX.value = 0;
    }

    prevTabRef.current = targetTab;
    isTabSwitchingRef.current = false;
    setActiveTab(targetTab);
  }, [availableTabs, activeCategorySharedIndex, categoryTranslateX]);

  const handleBackAction = useCallback(() => {
    if (showSelfieModal) {
      setShowSelfieModal(false);
      return;
    }
    if (isMoreDrawerOpen) {
      closeDrawerWithAnimation();
      return;
    }
    if (activeVideoItem !== null) {
      setActiveVideoItem(null);
      return;
    }
    if (activeImageIndex !== null) {
      setActiveImageIndex(null);
      return;
    }
    if (isCinema) {
      cinemaSwipeX.value = withTiming(width, { duration: 220, easing: Easing.out(Easing.quad) }, (finished) => {
        'worklet';
        if (finished) {
          runOnJS(finalizeCinemaExit)();
        }
      });
      return;
    }
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    if (currentYRef.current > 150) {
      saveResumeScrollPosition(currentYRef.current);
    }
    if (eventSlug && allPhotosRef.current && allPhotosRef.current.length > 60) {
      useAuthStore.getState().setGalleryCache(eventSlug, {
        photos: allPhotosRef.current,
        tabCache: tabCacheRef.current,
      });
    }

    screenSwipeX.value = withTiming(width, { duration: 220, easing: Easing.out(Easing.quad) }, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(onChangeEvent)();
      }
    });
  }, [showSelfieModal, isMoreDrawerOpen, closeDrawerWithAnimation, activeVideoItem, activeImageIndex, isCinema, cinemaSwipeX, finalizeCinemaExit, isClosingRef, screenSwipeX, onChangeEvent, saveResumeScrollPosition, eventSlug]);

  // Native Android Back Button Listener
  useEffect(() => {
    const onBack = () => {
      handleBackAction();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => subscription.remove();
  }, [handleBackAction]);

  // Left-Edge Pan Swipe Back Gesture
  const edgeSwipeGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .activeOffsetX(30)
    .failOffsetY([-25, 25])
    .onBegin((e) => {
      'worklet';
      if (isLightboxOpen.value || isPinching.value) {
        touchStartedOnLeftEdge.value = false;
        return;
      }
      touchStartedOnLeftEdge.value = e.x <= 45;
    })
    .onUpdate((e) => {
      'worklet';
      if (!touchStartedOnLeftEdge.value || isPinching.value) return;
      if (e.translationX > 0) {
        if (isCinemaShared.value) {
          cinemaSwipeX.value = e.translationX;
          screenSwipeX.value = 0;
        } else {
          screenSwipeX.value = e.translationX;
        }
      }
    })
    .onEnd((e) => {
      'worklet';
      if (isLightboxOpen.value) return;

      if (touchStartedOnLeftEdge.value) {
        if (e.translationX > width * 0.20 || e.velocityX > 250) {
          if (isCinemaShared.value) {
            cinemaSwipeX.value = withTiming(width, { duration: 220, easing: Easing.out(Easing.quad) }, (finished) => {
              if (finished) {
                runOnJS(finalizeCinemaExit)();
              }
            });
          } else {
            screenSwipeX.value = withTiming(width, { duration: 220, easing: Easing.out(Easing.quad) }, (finished) => {
              if (finished) {
                runOnJS(onChangeEvent)();
              }
            });
          }
        } else {
          if (isCinemaShared.value) {
            cinemaSwipeX.value = withSpring(0, { damping: 25, stiffness: 200 });
          } else {
            screenSwipeX.value = withSpring(0, { damping: 25, stiffness: 200 });
          }
        }
        touchStartedOnLeftEdge.value = false;
      }
    });



  // Exact Landing Tab Rules:
  // Priority 1: Direct Deep Link (handled on initial load via initialDeepLinkTab)
  // Priority 2: HIGHLIGHTS if highlightsCount > 0 (for both Full & Partial Access)
  // Priority 3: ALL if hasFullAccess (and highlightsCount === 0)
  // Priority 4: MY PHOTOS if Partial Access (and highlightsCount === 0)
  useEffect(() => {
    if (userHasSwitchedTabRef.current) return;
    if (initialDeepLinkTab) return;

    // Do NOT make landing tab fallback decisions on empty/dummy data while the celebration is still loading
    if (isLoading && !eventDetails) return;

    if (highlightsCount > 0) {
      if (activeTab !== 'HIGHLIGHTS') {
        setActiveTab('HIGHLIGHTS');
      }
    } else if (hasFullAccess) {
      if (activeTab !== 'ALL') {
        setActiveTab('ALL');
      }
    } else {
      if (activeTab !== 'MY PHOTOS') {
        setActiveTab('MY PHOTOS');
      }
    }
  }, [isLoading, eventDetails, highlightsCount, hasFullAccess, initialDeepLinkTab, activeTab]);

  // Sanitize activeTab: Ensure users never stay on an unavailable tab (e.g. ALL for partial access, or HIGHLIGHTS if highlightsCount is 0)
  useEffect(() => {
    if (!isLoading && availableTabs.length > 0 && !availableTabs.map((t) => t.toUpperCase()).includes(activeTab.toUpperCase())) {
      const fallbackTab = (highlightsCount > 0 && availableTabs.includes('HIGHLIGHTS'))
        ? 'HIGHLIGHTS'
        : (hasFullAccess && availableTabs.includes('ALL')
            ? 'ALL'
            : (availableTabs.includes('MY PHOTOS') ? 'MY PHOTOS' : availableTabs[0]));
      setActiveTab(fallbackTab);
    }
  }, [isLoading, availableTabs, activeTab, highlightsCount, hasFullAccess]);

  // ── Download Permissions & Screen Capture Protection ────────────────────────
  const isGalleryDownloadAllowed = useMemo(() => {
    if (!eventDetails) return false;
    return eventDetails.allowDownloads !== false && eventDetails.allow_downloads !== false;
  }, [eventDetails]);

  const isGalleryBulkAllowed = useMemo(() => {
    if (!isGalleryDownloadAllowed || !eventDetails) return false;
    return Boolean(eventDetails.allowBulkDownloads ?? eventDetails.allow_bulk_downloads);
  }, [isGalleryDownloadAllowed, eventDetails]);

  // Screen Capture Protection:
  //   - If downloads are blocked on this gallery, screen capture and recording are completely prohibited
  //   - Applies immediately (even while loading) if cached/current eventDetails has blocked downloads
  //   - Calls onScreenProtectionChange so _layout.tsx applies it to the main UIWindow (iOS)
  //   - Also calls preventScreenCaptureAsync directly here (Android FLAG_SECURE, same Activity)
  useEffect(() => {
    const shouldPrevent = !isGalleryDownloadAllowed;

    console.log(`[MYCIRCLE SECURITY 🛡️] isGalleryDownloadAllowed: ${isGalleryDownloadAllowed} | BulkDownloads: ${isGalleryBulkAllowed} | PreventCapture: ${shouldPrevent}`);

    // Notify root layout (covers iOS main UIWindow)
    onScreenProtectionChange?.(shouldPrevent);

    // Also call directly (covers Android FLAG_SECURE on Activity window)
    if (shouldPrevent) {
      preventScreenCaptureAsync('gallery_protection');
    } else {
      allowScreenCaptureAsync('gallery_protection');
    }
  }, [isGalleryDownloadAllowed, isGalleryBulkAllowed, onScreenProtectionChange]);

  // On unmount: release protection everywhere
  useEffect(() => {
    return () => {
      onScreenProtectionChange?.(false);
      allowScreenCaptureAsync('gallery_protection');
    };
  }, [onScreenProtectionChange]);

  // Current active photo tab: resolves to last non-cinema tab (e.g. ALL) when in Cinema
  const currentPhotoTab = useMemo(() => {
    if (!isCinema) return activeTab;
    return (lastNonCinemaTabRef.current && lastNonCinemaTabRef.current.trim().toUpperCase() !== 'CINEMA')
      ? lastNonCinemaTabRef.current
      : (availableTabs.includes('ALL') ? 'ALL' : (availableTabs.find((t) => t.trim().toUpperCase() !== 'CINEMA') || 'ALL'));
  }, [isCinema, activeTab, availableTabs]);

  const activeCinemaVideos = useMemo(() => {
    const cached = tabCache['CINEMA'];
    const list = (cached && cached.length > 0)
      ? cached
      : allPhotos.filter((p: any) => isCinemaVideoItem(p) || isVideoMedia(p));
    return list.filter((p: any) => isCinemaVideoItem(p) || hasActualVideoFile(p) || isVideoMedia(p));
  }, [tabCache, allPhotos]);

  const activeList = React.useMemo(() => {
    const currentUpper = currentPhotoTab.toUpperCase();
    const isLockedTab = currentUpper.includes('LOCKED');

    const isPhotoLocked = (p: any) => {
      const pId = Number(p?.id);
      return lockedPhotoIds.has(pId) || !!(p?.isLocked || p?.isPrivate);
    };

    if (isLockedTab) {
      const combined: Photo[] = [];
      const seenIds = new Set<number>();
      [...allPhotos, ...photos, ...Object.values(tabCache).flat()].forEach((p) => {
        if (isPhotoLocked(p) && !seenIds.has(p.id)) {
          seenIds.add(p.id);
          combined.push({
            ...p,
            isLocked: true,
            isPrivate: true,
          });
        }
      });
      return combined;
    }

    let sourceList: Photo[] = [];
    if (currentUpper === 'MY PHOTOS') {
      sourceList = photos;
    } else if (currentUpper === 'MY FAVOURITES') {
      if (tabCache['MY FAVOURITES']) {
        sourceList = tabCache['MY FAVOURITES'];
      } else {
        const combined: Photo[] = [];
        const seenIds = new Set<number>();
        [...allPhotos, ...photos, ...Object.values(tabCache).flat()].forEach((p) => {
          if (p.isLiked && !seenIds.has(p.id)) {
            seenIds.add(p.id);
            combined.push(p);
          }
        });
        sourceList = combined;
      }
    } else if (currentUpper === 'ALL') {
      // In ALL (Full Access only):
      // Injects Director's Cut (random top 20, if not coming soon) and Candid Diaries (random top 30, if not coming soon).
      // Performance and Full Film are NEVER included here (strictly only in Cinema).
      sourceList = injectCuratedCinemaVideos(allPhotos, activeCinemaVideos, `${eventSlug || ''}_ALL`);
    } else if (currentUpper === 'HIGHLIGHTS') {
      // In HIGHLIGHTS:
      // Base highlight photos with Director's Cut (top 20) and Candid Diaries (top 30) if not coming soon.
      // Performance and Full Film are NEVER included here (strictly only in Cinema).
      const baseHighlights = (tabCache['HIGHLIGHTS'] && tabCache['HIGHLIGHTS'].length > 0)
        ? tabCache['HIGHLIGHTS']
        : allPhotos.filter((p: any) => p.isHighlight || (p.tabName && p.tabName.trim().toUpperCase() === 'HIGHLIGHTS'));

      sourceList = injectCuratedCinemaVideos(baseHighlights, activeCinemaVideos, `${eventSlug || ''}_HIGHLIGHTS`);
    } else if (tabCache[currentUpper] && tabCache[currentUpper].length > 0) {
      sourceList = tabCache[currentUpper].filter((p: any) => !isVideoComingSoon(p));
    } else {
      sourceList = allPhotos.filter((p: any) => {
        if (!p.tabName) return false;
        return p.tabName.trim().toUpperCase() === currentUpper && !isVideoComingSoon(p);
      });
    }

    return sourceList.filter((p) => !isPhotoLocked(p) && !isVideoComingSoon(p));
  }, [currentPhotoTab, photos, allPhotos, tabCache, lockedPhotoIds, activeCinemaVideos]);

  activeListRef.current = activeList;
  const activePhotoList = useMemo(
    () => activeList.filter((photo) => !isVideoMedia(photo) && !isCinemaVideoItem(photo)),
    [activeList],
  );
  const activeCuratedVideos = useMemo(
    () => activeList.filter((photo) => isVideoMedia(photo) || isCinemaVideoItem(photo)),
    [activeList],
  );

  // Canonical Expected Photo Count for any tab (known synchronously from memory/cache)
  const getTabPhotoCount = useCallback((tabName: string): number | null => {
    const norm = tabName.trim().toUpperCase();
    if (norm.includes('LOCKED')) {
      return lockedPhotoIds.size;
    }
    if (norm === 'MY PHOTOS') {
      if (typeof totalMatchedPhotosCount === 'number') {
        const lockedInPhotos = photos.filter((p: any) => p && lockedPhotoIds.has(Number(p.id))).length;
        return Math.max(0, totalMatchedPhotosCount - lockedInPhotos);
      }
      const lockedInPhotos = photos.filter((p: any) => p && lockedPhotoIds.has(Number(p.id))).length;
      return Math.max(0, photos.length - lockedInPhotos);
    }
    if (norm === 'MY FAVOURITES') {
      const lockedInFavs = [...allPhotos, ...photos].filter((p: any) => p && p.isLiked && lockedPhotoIds.has(Number(p.id))).length;
      return Math.max(0, favoritesCount - lockedInFavs);
    }
    if (norm === 'ALL') {
      const comingSoonCount = allPhotos.filter((p: any) => p && isVideoComingSoon(p)).length;
      const rawAll = eventDetails?.tabCounts?.['ALL'] ?? (totalAllPhotosCount !== null ? totalAllPhotosCount : allPhotos.length);
      return Math.max(0, rawAll - comingSoonCount - lockedPhotoIds.size);
    }
    const rawCount = eventDetails?.tabCounts?.[norm] ?? allPhotos.filter((p: any) => p && p.tabName && p.tabName.trim().toUpperCase() === norm).length;
    const lockedInTab = allPhotos.filter((p: any) => p && p.tabName && p.tabName.trim().toUpperCase() === norm && lockedPhotoIds.has(Number(p.id))).length;
    return Math.max(0, rawCount - lockedInTab);
  }, [lockedPhotoIds, photos, favoritesCount, allPhotos, eventDetails?.tabCounts, totalAllPhotosCount, totalMatchedPhotosCount]);

  const currentTabExpectedCount = useMemo(() => {
    return getTabPhotoCount(currentPhotoTab);
  }, [getTabPhotoCount, currentPhotoTab]);

  // Predictive Instagram-style Video Pre-Buffering:
  // Pre-warms native player instances for the upcoming videos in the background
  useEffect(() => {
    const videoItems = activeCinemaVideos;
    if (videoItems.length > 0) {
      videoItems.slice(0, 3).forEach((vid, idx) => {
        const vUrl = vid.videoUrl || vid.fullUri || vid.r2Url || (typeof vid.uri === 'string' && vid.uri.startsWith('http') ? vid.uri : null);
        const tUrl = vid.thumbnailUrl || vid.thumbUri || null;
        if (vUrl) {
          videoPreloadManager.preload(vUrl, tUrl);
        }
      });
    }
  }, [activeCinemaVideos, isCinema]);

  const downloadCurrentTabPhotos = useCallback(async () => {
    if (!isGalleryDownloadAllowed || !isGalleryBulkAllowed) {
      Alert.alert('Downloads Disabled', 'Photo downloads are disabled for this celebration.');
      return;
    }

    const listToDownload = activeListRef.current || [];
    if (!listToDownload || listToDownload.length === 0 || isBatchDownloading) return;

    try {
      console.log(`[BATCH DOWNLOAD 🚀] Starting batch download of ${listToDownload.length} photos...`);

      let hasPermission = false;
      try {
        const perm = await MediaLibrary.requestPermissionsAsync(true);
        hasPermission = perm.status === 'granted' || perm.granted === true || (perm as any).accessPrivileges === 'limited' || (perm as any).accessPrivileges === 'all';
      } catch (pErr) {
        console.error('[BATCH DOWNLOAD ❌] Permission error:', pErr);
      }

      if (!hasPermission && Platform.OS === 'ios') {
        Alert.alert('Permission Required', 'Please allow access to save photos to your photo gallery.');
        return;
      }

      setIsBatchDownloading(true);
      setBatchDownloadProgress({ current: 0, total: listToDownload.length });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      const cacheDir = (((FileSystem as any).cacheDirectory || (FileSystem as any).documentDirectory || '') as string).replace(/\/+$/, '');

      let savedCount = 0;
      for (let i = 0; i < listToDownload.length; i++) {
        const photo = listToDownload[i];
        setBatchDownloadProgress({ current: i + 1, total: listToDownload.length });

        const rawTargetUri = photo.fullUri || photo.photoUrl || photo.r2Url || photo.uri || photo.url || '';
        if (!rawTargetUri) continue;

        const safeFilename = `myphoto_${photo.id || i}_${Date.now()}_${i}.jpg`;
        const localPath = `${cacheDir}/${safeFilename}`;

        try {
          const downloadRes = await FileSystem.downloadAsync(rawTargetUri, localPath);

          if (downloadRes && downloadRes.uri) {
            let assetSaved = false;

            if (typeof MediaLibrary.createAssetAsync === 'function') {
              try {
                const asset = await MediaLibrary.createAssetAsync(downloadRes.uri);
                if (asset) assetSaved = true;
              } catch (_) {}
            }

            if (!assetSaved && typeof (MediaLibrary as any).saveToLibraryAsync === 'function') {
              try {
                await (MediaLibrary as any).saveToLibraryAsync(downloadRes.uri);
                assetSaved = true;
              } catch (_) {}
            }

            if (assetSaved) {
              savedCount++;
            }

            FileSystem.deleteAsync(downloadRes.uri, { idempotent: true }).catch(() => {});
          }
        } catch (err: any) {
          console.error(`[BATCH DOWNLOAD ❌] Exception downloading photo #${i + 1}:`, err);
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      if (savedCount > 0) {
        Alert.alert('Download Complete ✨', `Successfully saved ${savedCount} of ${listToDownload.length} photos to your phone gallery!`);
      } else {
        Alert.alert('Download Failed', `Could not save photos to your gallery. Please check storage permissions.`);
      }
    } catch (err: any) {
      console.error('[BATCH DOWNLOAD ERROR]:', err);
      Alert.alert('Download Error', 'Could not complete downloading photos. Please try again.');
    } finally {
      setIsBatchDownloading(false);
      setBatchDownloadProgress(null);
    }
  }, [isBatchDownloading, isGalleryDownloadAllowed, isGalleryBulkAllowed]);

  // Immediate full render limit: prevents staggered height jumps that trigger native scroll resets
  const renderLimit = Infinity;

  const isEndOfTabReached = useMemo(() => {
    if (renderLimit !== (Infinity as any) || isLoading || isTabLoading || activePhotoList.length === 0) {
      return false;
    }
    if (isLoadingMore) {
      return false;
    }

    const norm = activeTab.toUpperCase();

    if (norm === 'ALL') {
      return !hasMorePhotos;
    }

    if (norm === 'MY PHOTOS' || norm === 'MY FAVOURITES') {
      return true;
    }

    // For ceremony / category tabs (e.g. COCKTAIL, HALDI, MEHNDI, HIGHLIGHTS)
    const expectedCount = eventDetails?.tabCounts?.[norm];
    if (typeof expectedCount === 'number' && expectedCount > 0) {
      return activePhotoList.length >= expectedCount;
    }

    // Fallback if tabCounts is not present: check tabHasMore state
    return tabHasMoreRef.current[norm] === false;
  }, [renderLimit, isLoading, isTabLoading, isLoadingMore, activePhotoList, activeTab, hasMorePhotos, eventDetails?.tabCounts]);

  const masonryColWidth = Math.floor((width - 16 - 6) / 2);

  // Pre-fetch top images into native cache for 100% simultaneous 0ms paint
  useEffect(() => {
    if (!activeList || activeList.length === 0) return;
    const currentCols = galleryColumnsRef.current || 2;
    const count = Math.max(30, currentCols * 12);
    const topItems = activeList.slice(0, count);
    const uris: string[] = [];
    topItems.forEach((photo: any) => {
      const uri = getMediaDisplayUri(photo);
      if (uri && !prefetchedUrlsRef.current.has(uri)) {
        prefetchedUrlsRef.current.add(uri);
        uris.push(uri);
      }
    });
    if (uris.length > 0) {
      Image.prefetch(uris, 'memory-disk');
    }
  }, [activeTab, activeList, galleryColumns]);

  // Bounds measurement for smooth Lightbox opening & background page auto-scrolling
  const getBoundsForIndex = useCallback((idx: number, callback: (bounds: LightboxBounds) => void) => {
    if (idx < 0 || idx >= activeList.length) return;
    const item = activeList[idx];
    if (!item) return;
    const cardId = item.id ? String(item.id) : (item.r2Url || `photo-${idx}`);
    const targetCard = cardRefs.current[cardId];

    if (targetCard) {
      targetCard.measureInWindow((x, y, cardWidth, cardHeight) => {
        if (cardWidth > 0 && cardHeight > 0) {
          if (y < 80 || y + cardHeight > Dimensions.get('screen').height - 60) {
            targetCard.measureLayout(
              mainScrollRef.current as any,
              (left, top, w, h) => {
                const targetScrollY = Math.max(0, top - Dimensions.get('screen').height / 2 + h / 2);
                mainScrollRef.current?.scrollTo({ y: targetScrollY, animated: false });
                requestAnimationFrame(() => {
                  targetCard.measureInWindow((nx, ny, nw, nh) => {
                    if (nw > 0 && nh > 0) {
                      callback({ x: nx, y: ny, width: nw, height: nh });
                    }
                  });
                });
              },
              () => {}
            );
          } else {
            callback({ x, y, width: cardWidth, height: cardHeight });
          }
        }
      });
    }
  }, [activeList]);

  const openLightbox = (photoItem: any, bounds: LightboxBounds | null) => {
    if (!photoItem || photoItem.isSkeleton) return;
    if (isVideoMedia(photoItem)) {
      setActiveVideoItem(photoItem);
      return;
    }
    setSelectedBounds(bounds);
    const idx = displayData.findIndex((p: any) => p.id === photoItem.id);
    setActiveImageIndex(idx !== -1 ? idx : (photoItem.index ?? photoItem.globalIndex ?? 0));
  };

  const handleToggleLike = async (item: any) => {
    if (!item || !eventSlug) return;
    const photoId = item.id;

    // Read the FRESH liked state from current allPhotos/photos state to avoid
    // stale closures from lightbox or grid passing an outdated snapshot.
    const freshItem = allPhotos.find((p) => p.id === photoId) || photos.find((p) => p.id === photoId) || item;
    const currentlyLiked = !!freshItem.isLiked;
    const nextLiked = !currentlyLiked;

    try {
      if (nextLiked) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {}

    // Helper: update isLiked (and optionally likeCount) for photoId across ALL state arrays consistently
    const applyLikeState = (liked: boolean, newLikeCount?: number) => {
      const mapper = (p: any) => {
        if (p.id !== photoId) return p;
        const updated: any = { ...p, isLiked: liked };
        if (typeof newLikeCount === 'number') updated.likeCount = newLikeCount;
        return updated;
      };
      setAllPhotos((prev) => prev.map(mapper));
      setPhotos((prev) => prev.map(mapper));
      setTabCache((prev) => {
        const updatedCache: typeof prev = {};
        for (const key of Object.keys(prev)) {
          updatedCache[key] = prev[key].map(mapper);
        }
        // Update 'MY FAVOURITES' tab list specifically
        const currentFavs = updatedCache['MY FAVOURITES'] || [];
        if (liked) {
          if (!currentFavs.some((p) => p.id === photoId)) {
            const newItem = { ...freshItem, isLiked: true };
            if (typeof newLikeCount === 'number') (newItem as any).likeCount = newLikeCount;
            updatedCache['MY FAVOURITES'] = [newItem, ...currentFavs];
          }
        } else {
          updatedCache['MY FAVOURITES'] = currentFavs.filter((p) => p.id !== photoId);
        }
        return updatedCache;
      });
    };

    // Optimistic update (adjust likeCount instantly: +1 on like, -1 on unlike)
    const currentCount = typeof freshItem.likeCount === 'number' ? freshItem.likeCount : 0;
    applyLikeState(nextLiked, Math.max(0, currentCount + (nextLiked ? 1 : -1)));

    try {
      const headers = eventHeadersRef.current;
      const res = await api.post(
        `/api/gallery/public/events/${eventSlug}/photos/${photoId}/like`,
        {},
        { headers }
      );
      if (res.data && typeof res.data.liked === 'boolean') {
        // Reconcile with server truth (updates all 3 state arrays including likeCount)
        applyLikeState(res.data.liked, typeof res.data.likeCount === 'number' ? res.data.likeCount : undefined);
        tabEvents.emit(EVENT_SAVES_UPDATED);
      }
    } catch (err) {
      console.warn('Failed to toggle photo like:', err);
      // Revert to original state on failure (updates all 3 state arrays)
      applyLikeState(currentlyLiked, currentCount);
    }
  };


  // Total photos in the active tab (used to scale container height to match the entire 4,000+ photo timeline)
  const totalTabPhotos = useMemo(() => {
    const normTab = (activeTab || '').trim().toUpperCase();
    if (normTab === 'CINEMA') return 0;
    if (normTab === 'MY PHOTOS') {
      return totalMatchedPhotosCount ?? activeList.length;
    }
    if (normTab === 'MY FAVOURITES') {
      return activeList.length;
    }
    if (activeFilmstrip?.total && activeFilmstrip.total > 0 && (activeFilmstrip.tab || '').trim().toUpperCase() === normTab) {
      return activeFilmstrip.total;
    }
    if (normTab === 'ALL') {
      return totalAllPhotosCount ?? allPhotos.length;
    }
    if (eventDetails?.tabCounts?.[normTab] && typeof eventDetails.tabCounts[normTab] === 'number') {
      return eventDetails.tabCounts[normTab];
    }
    return tabCache[normTab]?.length || activeList.length;
  }, [activeTab, activeFilmstrip, totalAllPhotosCount, allPhotos.length, eventDetails?.tabCounts, tabCache, activeList.length, totalMatchedPhotosCount]);

  useEffect(() => {
    totalPhotosShared.value = totalTabPhotos;
    totalTabPhotosRef.current = totalTabPhotos;
  }, [totalTabPhotos, totalPhotosShared]);

  // Milestone-Anchored Synthesized Grid: Never shows a blank screen on skips.
  // Instantly renders pre-warmed 150px milestone cards & sleek skeleton placeholders across the entire timeline.
  const displayData = useMemo(() => {
    // If the expected photo count is known to be 0, NEVER generate skeleton cards
    if (currentTabExpectedCount === 0) {
      return activeList;
    }

    const normTab = (activeTab || 'ALL').trim().toUpperCase();
    const totalCount = totalTabPhotos;

    // Fast path 0: When activeList is empty (initial mount or tab switch), show 12 skeletons while loading
    if (activePhotoList.length === 0) {
      if (totalCount <= 0 && !isLoading && !isTabLoading) {
        return activePhotoList;
      }
      const count = Math.min(12, totalCount > 0 ? totalCount : 12);
      const skeletons = Array.from({ length: count }, (_, i) => ({
        id: -(i + 1),
        index: i,
        loupePhotoIndex: i,
        isSkeleton: true,
        r2Url: '',
        uri: '',
        fullUri: '',
        photoUrl: '',
        width: 720,
        height: 960,
        aspectRatio: 0.75,
      }));
      return injectCuratedCinemaVideos(skeletons, activeCuratedVideos, `${eventSlug || ''}_${normTab}`);
    }

    // If total count is unknown or <= 0, fallback to standard activeList
    if (totalCount <= 0) {
      return injectCuratedCinemaVideos(
        activePhotoList.map((photo, index) => ({ ...photo, loupePhotoIndex: index })),
        activeCuratedVideos,
        `${eventSlug || ''}_${normTab}`,
      );
    }

    const sparseMap = tabSparsePhotosRef.current[normTab];
    const keyframes = (activeFilmstrip?.keyframes || []).filter((kf) =>
      (kf.tabName || '').trim().toUpperCase() !== 'CINEMA' &&
      !kf.cinemaCategory &&
      !isVideoMedia(kf) &&
      !isCinemaVideoItem(kf) &&
      !isVideoComingSoon(kf),
    );

    // Fast path 1: if activeList already contains all photos continuously, return directly
    if (activePhotoList.length >= totalCount && (!sparseMap || sparseMap.size <= activePhotoList.length)) {
      return injectCuratedCinemaVideos(
        activePhotoList.map((photo, index) => ({ ...photo, loupePhotoIndex: index })),
        activeCuratedVideos,
        `${eventSlug || ''}_${normTab}`,
      );
    }

    // Check if there are non-contiguous sparse entries (e.g. from milestone jumps/scrubbing)
    let hasFarSparse = false;
    if (sparseMap && sparseMap.size > 0) {
      for (const k of sparseMap.keys()) {
        if (k > activePhotoList.length + 20) {
          hasFarSparse = true;
          break;
        }
      }
    }

    // Fast path 2: Continuous sequential viewing (no non-contiguous jumps).
    // Only append a small trailing skeleton batch — avoids allocating 4000-item array on every render.
    if (!hasFarSparse && activePhotoList.length < totalCount) {
      const isCeremony = normTab !== 'ALL' && normTab !== 'MY PHOTOS' && normTab !== 'MY FAVOURITES';
      const canMore = isCeremony
        ? (tabHasMoreRef.current[normTab] !== false)
        : (normTab === 'MY PHOTOS' ? hasMoreMatchedPhotos : hasMorePhotos);
      if (canMore) {
        const trailingCount = Math.min(12, totalCount - activePhotoList.length);
        const trailingSkeletons: any[] = new Array(trailingCount);
        for (let sIdx = 0; sIdx < trailingCount; sIdx++) {
          const idx = activePhotoList.length + sIdx;
          trailingSkeletons[sIdx] = {
            id: -(idx + 1),
            index: idx,
            loupePhotoIndex: idx,
            isSkeleton: true,
            r2Url: '',
            uri: '',
            fullUri: '',
            photoUrl: '',
            width: 720,
            height: 960,
            aspectRatio: 0.75,
          };
        }
        const photoRows = [
          ...activePhotoList.map((photo, index) => ({ ...photo, loupePhotoIndex: index })),
          ...trailingSkeletons,
        ];
        return injectCuratedCinemaVideos(
          photoRows,
          activeCuratedVideos,
          `${eventSlug || ''}_${normTab}`,
        );
      }
      return injectCuratedCinemaVideos(
        activePhotoList.map((photo, index) => ({ ...photo, loupePhotoIndex: index })),
        activeCuratedVideos,
        `${eventSlug || ''}_${normTab}`,
      );
    }

    // Safety guard: For tabs without keyframes (like MY PHOTOS), never allocate thousands of blank cards
    if (keyframes.length === 0) {
      return injectCuratedCinemaVideos(
        activePhotoList.map((photo, index) => ({ ...photo, loupePhotoIndex: index })),
        activeCuratedVideos,
        `${eventSlug || ''}_${normTab}`,
      );
    }

    // Build keyframe lookup map by index
    const kfMap = new Map<number, FilmstripKeyframe>();
    keyframes.forEach((kf) => {
      if (typeof kf.index === 'number') {
        kfMap.set(kf.index, kf);
      }
    });

    // Synthesize the full timeline up to totalCount so masonry layout spans all photos across the entire height
    const targetCount = totalCount;
    const synthesized: any[] = new Array(targetCount);

    for (let i = 0; i < targetCount; i++) {
      // Indices here are photo-only server indices; curated videos are added after synthesis.
      const loaded = (sparseMap && sparseMap.get(i)) || activePhotoList[i];
      if (loaded && !loaded.isSkeleton) {
        synthesized[i] = { ...loaded, loupePhotoIndex: i };
        continue;
      }

      // 2. Milestone keyframe photo (with 150px local cache or URL)
      const kf = kfMap.get(i);
      if (kf) {
        const localOrRemote = kf.localPath || kf.thumbnailUrl || kf.r2Url;
        synthesized[i] = {
          id: kf.id,
          index: i,
          loupePhotoIndex: i,
          r2Url: kf.r2Url || '',
          thumbnailUrl: localOrRemote,
          uri: localOrRemote,
          fullUri: kf.r2Url || localOrRemote,
          photoUrl: localOrRemote,
          width: kf.width || 720,
          height: kf.height || 960,
          aspectRatio: (kf.width && kf.height) ? kf.width / kf.height : 0.75,
          isMilestone: true,
        };
        continue;
      }

      // 3. Clean skeleton pulse card
      synthesized[i] = {
        id: -(i + 1),
        index: i,
        loupePhotoIndex: i,
        isSkeleton: true,
        r2Url: '',
        uri: '',
        fullUri: '',
        photoUrl: '',
        width: 720,
        height: 960,
        aspectRatio: 0.75,
      };
    }

    return injectCuratedCinemaVideos(
      synthesized,
      activeCuratedVideos,
      `${eventSlug || ''}_${normTab}`,
    );
  }, [
    activePhotoList,
    activeCuratedVideos,
    eventSlug,
    isLoading,
    isTabLoading,
    currentTabExpectedCount,
    totalTabPhotos,
    activeTab,
    activeFilmstrip,
    hasMorePhotos,
    hasMoreMatchedPhotos,
    sparseVersion,
  ]);

  // Scaled container height so scrollview can physically scroll across all photos without clamping
  const estimatedTotalContentHeight = useMemo(() => {
    if (totalTabPhotos <= 0) return 0;
    if (activePhotoList.length >= totalTabPhotos || isEndOfTabReached) return 0;

    const currentCols = galleryColumnsRef.current || galleryColumns || 2;
    const heroHeight = Math.round(screenHeight * 0.70);
    const stickyHeight = 107;
    const colGap = currentCols === 1 ? 5 : (currentCols === 2 ? 5 : 4);
    const availableWidth = width - 12 - colGap * Math.max(0, currentCols - 1);
    const colWidth = Math.max(30, availableWidth / currentCols);
    const maxCardH = currentCols === 1 ? Math.round(screenHeight * 0.72) : (currentCols >= 4 ? 300 : 600);
    const minCardH = currentCols === 1 ? 160 : (currentCols >= 4 ? 40 : (currentCols === 3 ? 60 : 80));
    const sampleHeights = activePhotoList.slice(0, 120).map((photo, index) => {
      const aspect = getPhotoCardAspect(photo, index, 0, currentCols);
      return Math.max(minCardH, Math.min(maxCardH, Math.round(colWidth / (aspect || 0.75))));
    });
    activeCuratedVideos.forEach(() => {
      sampleHeights.push(Math.max(minCardH, Math.min(maxCardH, Math.round(colWidth / 0.75))));
    });
    const averageCardHeight = sampleHeights.length > 0
      ? sampleHeights.reduce((sum, cardHeight) => sum + cardHeight, 0) / sampleHeights.length
      : Math.round(colWidth / 0.75);
    const totalGridItems = totalTabPhotos + activeCuratedVideos.length;
    const totalRows = Math.ceil(totalGridItems / currentCols);
    return heroHeight + stickyHeight + totalRows * (averageCardHeight + colGap) + 160;
  }, [totalTabPhotos, galleryColumns, screenHeight, activePhotoList, activeCuratedVideos, isEndOfTabReached, width]);

  // ─── Spatial Film Loupe: Sample photos fallback (when offline or personal tabs) ───
  const loupeSampleInfo = useMemo(() => {
    const normTab = (activeTab || 'ALL').trim().toUpperCase();
    const isAllTab = normTab === 'ALL';
    const source = isAllTab ? ((allPhotos && allPhotos.length > 0) ? allPhotos : activeList) : activeList;
    if (!source || source.length === 0) {
      return { thumbnails: [], sampledItems: [], step: 1, sourceCount: 0 };
    }

    // Strictly filter out any video media, cinema items, and teaser covers
    const cleanSource = source
      .filter((p: any) => {
        if (!p) return false;
        if (isVideoMedia(p)) return false;
        if (isCinemaVideoItem(p)) return false;
        if (isVideoComingSoon(p)) return false;
        if (p.tabName && p.tabName.trim().toUpperCase() === 'CINEMA') return false;
        if (p.cinemaCategory || p.exif?.cinemaCategory) return false;
        if (p.exif?.isComingSoon || p.exif?.comingSoon) return false;
        const isVideoExt = ['.mp4', '.mov', '.m4v', '.webm'].some((ext) => (p.filename || p.r2Url || '').toLowerCase().includes(ext));
        if (isVideoExt) return false;
        return true;
      })
      .map((photo: any, index: number) => ({ photo, index }));

    if (cleanSource.length === 0) {
      return { thumbnails: [], sampledItems: [], step: 1, sourceCount: 0 };
    }

    const total = cleanSource.length;

    // Dynamically target ~100-120 keyframes for large galleries (190+ photos), 20-65 for smaller ones
    const targetKeyframes = total >= 190
      ? Math.min(120, Math.max(100, Math.floor(total / 2)))
      : Math.min(65, Math.max(20, Math.floor(total / 3)));
    const step = Math.max(1, Math.floor(total / targetKeyframes));

    const sampledItems: { index: number; id: number; url: string }[] = [];

    cleanSource.forEach(({ photo: p, index }, idx) => {
      if (idx % step === 0) {
        const rawUrl = p.r2Url || p.thumbnailUrl || p.uri || '';
        const thumbUrl = getKeyframe150pxUrl(rawUrl);
        if (thumbUrl && typeof thumbUrl === 'string') {
          sampledItems.push({ index, id: p.id, url: thumbUrl });
        }
      }
    });

    // Always append the last photo as a guaranteed final keyframe
    if (cleanSource.length > 1) {
      const lastItem = cleanSource[cleanSource.length - 1];
      const lastSampled = sampledItems[sampledItems.length - 1];
      if (!lastSampled || lastSampled.index !== lastItem.index) {
        const lastP = lastItem.photo;
        const rawUrl = lastP.r2Url || lastP.thumbnailUrl || lastP.uri || '';
        const thumbUrl = getKeyframe150pxUrl(rawUrl);
        if (thumbUrl && typeof thumbUrl === 'string') {
          sampledItems.push({ index: lastItem.index, id: lastP.id, url: thumbUrl });
        }
      }
    }

    return {
      thumbnails: sampledItems.map((s) => s.url),
      sampledItems,
      step,
      sourceCount: cleanSource.length,
    };
  }, [allPhotos, activeList, activeTab]);

  // Fetch full timeline indexed filmstrip keyframes from server (covers all 4,000+ photos across active tab)
  const fetchFilmstrip = useCallback(async (tabName: string, forceRefresh: boolean = false) => {
    if (!eventSlug) return;
    const normTab = (tabName || 'ALL').trim().toUpperCase();
    if (normTab === 'CINEMA') return;
    const cacheKey = `${eventSlug}::${normTab}`;
    const requestId = (filmstripRequestIdsRef.current[cacheKey] || 0) + 1;
    filmstripRequestIdsRef.current[cacheKey] = requestId;
    const isLatestRequest = () => filmstripRequestIdsRef.current[cacheKey] === requestId;

    // 1. Instant return if already in RAM cache (unless forceRefresh is requested)
    if (!forceRefresh && filmstripCacheRef.current[cacheKey]) {
      publishFilmstrip(filmstripCacheRef.current[cacheKey], eventSlug, normTab);
      return;
    }

    // 2. Instant return from permanent document storage (0ms offline load)
    try {
      const stored = await getStoredFilmstrip(eventSlug, normTab);
      if (stored && isLatestRequest()) {
        filmstripCacheRef.current[cacheKey] = stored;
        publishFilmstrip(stored, eventSlug, normTab);
        const storedUrls = stored.keyframes.map((kf) => kf.thumbnailUrl).filter(Boolean);
        if (storedUrls.length > 0) {
          Image.prefetch(storedUrls, 'memory-disk');
        }
      }
    } catch (_) {}

    // Skip server call for personal virtual tabs
    if (normTab === 'MY PHOTOS' || normTab === 'MY FAVOURITES') {
      publishFilmstrip(null, eventSlug, normTab);
      return;
    }

    try {
      const familyToken = useAuthStore.getState().token;
      const authHeader = eventHeadersRef.current.Authorization || (familyToken ? `Bearer ${familyToken}` : undefined);
      const headers = authHeader ? { Authorization: authHeader } : {};

      const res = await guestApi.get(
        `/api/gallery/public/events/${eventSlug}/filmstrip?tab=${encodeURIComponent(normTab)}&target=120`,
        { headers }
      );

      if (isLatestRequest() && res.data && Array.isArray(res.data.keyframes) && res.data.keyframes.length > 0) {
        const data: FilmstripData = res.data;

        // Ensure the last keyframe always points to the final photo index of the tab
        const lastKf = data.keyframes[data.keyframes.length - 1];
        const expectedLastIndex = data.total - 1;
        if (lastKf && typeof lastKf.index === 'number' && lastKf.index < expectedLastIndex) {
          // Re-stamp the last keyframe's index to the true last photo so the loupe scrubs all the way to the end
          data.keyframes = [
            ...data.keyframes.slice(0, -1),
            { ...lastKf, index: expectedLastIndex },
          ];
        }

        // Immediately warm all 150px remote keyframe URLs into native memory cache
        const remoteUrls = data.keyframes.map((kf) => getKeyframe150pxUrl(kf.thumbnailUrl || kf.r2Url)).filter(Boolean);
        if (remoteUrls.length > 0) {
          Image.prefetch(remoteUrls, 'memory-disk');
        }

        // Check if data actually changed compared to current cache
        const currentData = filmstripCacheRef.current[cacheKey];
        const isIdentical =
          !forceRefresh &&
          currentData &&
          currentData.total === data.total &&
          currentData.keyframes.length === data.keyframes.length &&
          currentData.keyframes[0]?.id === data.keyframes[0]?.id &&
          currentData.keyframes[data.keyframes.length - 1]?.id === data.keyframes[data.keyframes.length - 1]?.id;

        if (!isIdentical) {
          // Immediate display while saving permanently in background
          filmstripCacheRef.current[cacheKey] = data;
          publishFilmstrip(data, eventSlug, normTab);

          console.log(`\n================== [FILM LOUPE TIMELINE 🎞️] ==================`);
          console.log(`📸 EVENT: "${cleanTitle}" (${eventSlug}) | TAB: "${normTab}"`);
          console.log(`📊 TOTAL PHOTOS ON SERVER: ${data.total}`);
          console.log(`🎯 SAMPLING STEP: Every ${data.step}th photo`);
          console.log(`📥 KEYFRAMES LOADED: ${data.keyframes.length} milestone thumbnails`);
          console.log(`💾 DOWNLOADING TO PERMANENT STORAGE AT 150PX RETINA RESOLUTION...`);
          console.log(`==============================================================\n`);

          // Persist all 150px keyframes permanently to FileSystem.documentDirectory
          persistFilmstripKeyframes(eventSlug, normTab, data).then((persistedData) => {
            if (!isLatestRequest()) return;
            filmstripCacheRef.current[cacheKey] = persistedData;
            publishFilmstrip(persistedData, eventSlug, normTab);
          }).catch((err) => {
            console.warn('[FILMSTRIP] Error persisting keyframes:', err);
          });
        } else {
          publishFilmstrip(currentData, eventSlug, normTab);
        }
      }
    } catch (err) {
      console.log(`[FILM LOUPE ⚠️] Could not fetch server filmstrip for tab "${normTab}", falling back to local sampling:`, err);
    }
  }, [eventSlug, cleanTitle, publishFilmstrip]);

  useEffect(() => {
    fetchFilmstripRef.current = fetchFilmstrip;
  }, [fetchFilmstrip]);

  // Fetch filmstrip whenever activeTab or eventSlug changes
  useEffect(() => {
    fetchFilmstrip(activeTab);
  }, [activeTab, fetchFilmstrip]);

  // Derived loupe thumbnails: prioritize full server timeline keyframes for the active tab over local batch
  const visibleFilmstripKeyframes = useMemo(() => {
    const normTab = (activeTab || 'ALL').trim().toUpperCase();
    if (
      !activeFilmstrip?.keyframes ||
      (activeFilmstrip.tab || '').trim().toUpperCase() !== normTab
    ) {
      return [];
    }
    return activeFilmstrip.keyframes.filter((kf) =>
      Boolean(kf && (kf.thumbnailUrl || kf.r2Url || (kf as any).localPath)) &&
      (kf.tabName || '').trim().toUpperCase() !== 'CINEMA' &&
      !kf.cinemaCategory &&
      !isVideoMedia(kf) &&
      !isCinemaVideoItem(kf) &&
      !isVideoComingSoon(kf),
    );
  }, [activeFilmstrip, activeTab]);

  const loupeThumbnails = useMemo(() => {
    if (visibleFilmstripKeyframes.length > 0) {
      return visibleFilmstripKeyframes.map((kf) => {
        // If already stored in permanent storage, use local file path directly!
        if (kf.thumbnailUrl?.startsWith('file:') || (kf as any).localPath?.startsWith('file:')) {
          return (kf as any).localPath || kf.thumbnailUrl;
        }
        return getKeyframe150pxUrl(kf.thumbnailUrl || kf.r2Url);
      });
    }
    return loupeSampleInfo.thumbnails;
  }, [visibleFilmstripKeyframes, loupeSampleInfo]);

  // Derived keyframe photo indices corresponding 1:1 with loupeThumbnails
  const loupeKeyframeIndices = useMemo(() => {
    if (visibleFilmstripKeyframes.length > 0) {
      return visibleFilmstripKeyframes.map((kf) => kf.index);
    }
    if (loupeSampleInfo.sampledItems && loupeSampleInfo.sampledItems.length > 0) {
      return loupeSampleInfo.sampledItems.map((item) => item.index);
    }
    return [];
  }, [visibleFilmstripKeyframes, loupeSampleInfo]);

  // Pre-load all loupe thumbnails into native memory & disk cache
  useEffect(() => {
    loupeThumbnailsRef.current = loupeThumbnails;
    if (loupeThumbnails.length > 0) {
      Image.prefetch(loupeThumbnails, 'memory-disk');
    }
  }, [loupeThumbnails]);

  // Tapping the Film Loupe card: smoothly jumps to that exact milestone in the gallery
  const handleJumpToKeyframe = useCallback(
    (keyframeIdx: number) => {
      const totalKf = loupeKeyframeIndices.length;
      const safeKfIdx = Math.max(0, Math.min(Math.max(0, totalKf - 1), keyframeIdx));
      const targetPhotoIndex = loupeKeyframeIndices[safeKfIdx] ?? 0;

      const totalPhotos = Math.max(1, totalTabPhotos || 1);
      const safeTargetIndex = Math.max(0, Math.min(totalPhotos - 1, targetPhotoIndex));

      const heroHeight = Math.round(screenHeight * 0.70);
      const targetY = getPhotoScrollOffset(
        safeTargetIndex,
        totalPhotos,
        photoScrollOffsetsShared.value,
        galleryContentHeightShared.value,
        screenHeight,
        heroHeight,
      );

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      console.log(`[FILM LOUPE 🚀 JUMP] User tapped keyframe #${safeKfIdx + 1} -> Jumping to photo index #${safeTargetIndex} (Target Y: ${targetY}px) in tab "${activeTab}"`);

      // Awaken loupe briefly for visual confirmation, then schedule fade-out
      loupeOpacity.value = withTiming(1, { duration: 100 });
      loupeOpacity.value = withDelay(1500, withTiming(0, { duration: 350 }, (finished) => {
        if (finished) {
          isLoupeAwake.value = false;
          isFadingLoupe.value = false;
        }
      }));

      // Record pending jump target to re-verify if layout expands asynchronously
      pendingJumpTargetYRef.current = targetY;
      pendingJumpTargetIndexRef.current = safeTargetIndex;
      pendingJumpTargetScopeRef.current = `${eventSlug}::${activeTab.trim().toUpperCase()}`;

      // Priority stream missing photos around target milestone into memory
      fastCatchupPhotos(targetY, activeTab, safeTargetIndex);

      // Perform smooth scroll to target milestone
      scrollToY(targetY, true);
      currentYRef.current = targetY;
      lastSavedScrollYRef.current = targetY;
      saveResumeScrollPosition(targetY);

      // Recompute after priority-fetch and layout updates settle.
      setTimeout(() => {
        if (pendingJumpTargetYRef.current === targetY) {
          const finalTargetY = getPhotoScrollOffset(
            safeTargetIndex,
            totalPhotos,
            photoScrollOffsetsShared.value,
            galleryContentHeightShared.value,
            screenHeight,
            heroHeight,
          );
          scrollToY(finalTargetY, false);
          currentYRef.current = finalTargetY;
          lastSavedScrollYRef.current = finalTargetY;
          saveResumeScrollPosition(finalTargetY);
          pendingJumpTargetYRef.current = null;
          pendingJumpTargetIndexRef.current = null;
          pendingJumpTargetScopeRef.current = null;
        }
      }, 350);
    },
    [loupeKeyframeIndices, activeTab, eventSlug, fastCatchupPhotos, scrollToY, screenHeight, saveResumeScrollPosition, loupeOpacity, isLoupeAwake, isFadingLoupe, totalTabPhotos, photoScrollOffsetsShared, galleryContentHeightShared]
  );

  // Dragging the Film Loupe card: user released after scrubbing
  const handleLoupeDragEnd = useCallback(
    (finalScrollY: number, targetPhotoIndex?: number) => {
      const heroHeight = Math.round(screenHeight * 0.70);
      const totalPhotos = Math.max(1, totalTabPhotos || 1);
      const currentCols = galleryColumnsRef.current || 2;
      const estimatedRowH = getEstimatedRowHeight(currentCols, width);
      const estimatedTotalH = heroHeight + 107 + Math.ceil(totalPhotos / currentCols) * estimatedRowH + 140;
      const effectiveContentH = Math.max(galleryContentHeightShared.value, estimatedTotalH);
      const maxScroll = Math.max(0, effectiveContentH - screenHeight);
      const settledScrollY = Math.min(maxScroll, Math.max(0, finalScrollY));
      const resolvedTargetIndex = typeof targetPhotoIndex === 'number'
        ? targetPhotoIndex
        : Math.max(0, Math.min(totalPhotos - 1, Math.round(getPhotoIndexAtScrollOffset(
          settledScrollY,
          totalPhotos,
          photoScrollEntriesShared.value,
          galleryContentHeightShared.value,
          screenHeight,
          heroHeight,
        ))));
      currentYRef.current = settledScrollY;
      lastSavedScrollYRef.current = settledScrollY;
      saveResumeScrollPosition(settledScrollY);
      // Track pending jump target so fastCatchupPhotos can re-align to the exact measured card position
      pendingJumpTargetYRef.current = settledScrollY;
      pendingJumpTargetIndexRef.current = resolvedTargetIndex;
      pendingJumpTargetScopeRef.current = `${eventSlug}::${activeTab.trim().toUpperCase()}`;

      // Priority stream missing photos around destination
      fastCatchupPhotos(settledScrollY, activeTab, resolvedTargetIndex);

      // Keep the exact worklet-computed release offset; do not snap to a rounded photo index.
      scrollToY(settledScrollY, false);

      // Awaken loupe briefly for confirmation, then schedule fade-out
      loupeOpacity.value = withDelay(
        1200,
        withTiming(0, { duration: 350 }, (finished) => {
          if (finished) {
            isLoupeAwake.value = false;
            isFadingLoupe.value = false;
          }
        })
      );
    },
    [fastCatchupPhotos, activeTab, totalTabPhotos, saveResumeScrollPosition, loupeOpacity, isLoupeAwake, isFadingLoupe, screenHeight, scrollToY, photoScrollEntriesShared, galleryContentHeightShared]
  );

  // Header Cover Metadata: Priority 1: Vertical Cover -> Priority 2: Horizontal Cover -> Priority 3: First Gallery Photo
  const firstPhotoUrl = activeList[0]?.r2Url || activeList[0]?.url || allPhotos[0]?.r2Url || allPhotos[0]?.url || null;

  const coverUrl =
    eventDetails?.coverPhotoMobileUrl ||
    eventDetails?.cover_photo_mobile_url ||
    eventDetails?.cover_photo_mobile ||
    eventCoverUrl ||
    eventDetails?.coverPhotoUrl ||
    eventDetails?.cover_photo_url ||
    eventDetails?.coverPhoto ||
    firstPhotoUrl;

  const locationText = (eventDetails?.location || eventDetails?.city || '').toUpperCase();
  const dateText = useMemo(() => {
    if (!eventDetails?.date) return '';
    try {
      const d = new Date(eventDetails.date);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    } catch {
      return '';
    }
  }, [eventDetails?.date]);

  const renderHeroCover = useCallback(() => {
    return (
      <View style={styles.heroContainer}>
        {/* Parallax Hero Image Wrapper */}
        <Animated.View style={[styles.heroImageWrapper, animatedHeroImageStyle]}>
          {coverUrl ? (
            <Image
              source={{ uri: coverUrl }}
              style={styles.heroImage}
              contentFit="cover"
              contentPosition="center"
              priority="high"
              cachePolicy="memory-disk"
              transition={200}
            />
          ) : (
            <View style={[styles.heroImage, { backgroundColor: '#1c1a18', justifyContent: 'center', alignItems: 'center' }]}>
              <ActivityIndicator size="small" color="#ffffff" />
            </View>
          )}
        </Animated.View>

        {/* White Brand Logo on Cover with Parallax Fade */}
        <Animated.View style={[styles.coverHeaderLogoContainer, { top: insets.top + 6 }, animatedCoverLogoStyle]} pointerEvents="none">
          <Image
            source={require('../../../assets/images/logo-header-white.png')}
            style={styles.coverHeaderLogo}
            contentFit="contain"
          />
        </Animated.View>

        {/* Vignette Gradient Overlay */}
        <LinearGradient
          colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.1)', 'rgba(0,0,0,0.75)']}
          locations={[0, 0.45, 1]}
          style={styles.heroOverlay}
        />

        {/* Cover Title Container with Parallax Drift & Fade */}
        <Animated.View style={[styles.titleContainer, animatedTitleContainerStyle]}>
          {locationText ? <Text style={styles.storyLocation}>{locationText}</Text> : null}
          <Text style={styles.storyTitle}>{cleanTitle}</Text>
          {dateText ? <Text style={styles.storyDate}>{dateText}</Text> : null}
        </Animated.View>
      </View>
    );
  }, [coverUrl, cleanTitle, locationText, dateText, insets, animatedHeroImageStyle, animatedCoverLogoStyle, animatedTitleContainerStyle]);

  const renderTabHeaderInner = useCallback(() => {
    const activeTabCount = currentTabExpectedCount;

    const isDownloadableTab = isGalleryBulkAllowed && (
      isBrideOrGroom || (
        currentPhotoTab.trim().toUpperCase().includes('MY PHOTO') ||
        currentPhotoTab.trim().toUpperCase().includes('MY FAVOURITES') ||
        currentPhotoTab.trim().toUpperCase().includes('MY FAVORITE')
      )
    );

    return (
      <View style={styles.stickyHeaderContainerInner}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            openDrawerWithAnimation();
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.compactTabHeaderBarCentered}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <Text
              style={styles.compactTabActiveTitleCentered}
              numberOfLines={1}
            >
              {currentPhotoTab} {activeTabCount !== null ? `(${activeTabCount})` : ''}
            </Text>
            <Text style={styles.downArrowIcon}>▾</Text>
          </View>
        </TouchableOpacity>

        {/* Right Corner Download Button (Strictly when allowBulkDownloads is true; ALL tabs for BRIDE or GROOM; MY PHOTOS & MY FAVOURITES for all other guests) */}
        {isDownloadableTab ? (
          <TouchableOpacity
            activeOpacity={0.75}
            disabled={isBatchDownloading}
            onPress={downloadCurrentTabPhotos}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.headerRightDownloadButton}
          >
            {isBatchDownloading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <ActivityIndicator size="small" color="#3a3632" style={{ transform: [{ scale: 0.75 }] }} />
                <Text style={styles.headerRightDownloadText}>
                  {batchDownloadProgress ? `${batchDownloadProgress.current}/${batchDownloadProgress.total}` : ''}
                </Text>
              </View>
            ) : (
              <Feather name="download" size={16} color="#3a3632" />
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }, [
    currentPhotoTab,
    currentTabExpectedCount,
    eventDetails,
    isBrideOrGroom,
    isGalleryBulkAllowed,
    isBatchDownloading,
    batchDownloadProgress,
    downloadCurrentTabPhotos,
    openDrawerWithAnimation,
  ]);

  const renderStickyHeader = useCallback(() => {
    return (
      <View
        style={[
          styles.stickyHeaderContainer,
          {
            paddingTop: Math.max(insets.top + 4, 28),
            backgroundColor: '#ffffff',
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: '#e5e5ea',
          },
        ]}
      >
        {renderTabHeaderInner()}
      </View>
    );
  }, [renderTabHeaderInner, insets.top]);

  const renderFooter = useCallback(() => {
    if (!isEndOfTabReached) return <View style={{ height: 40 }} />;
    return (
      <View style={styles.endOfTabFooterContainer}>
        <View style={styles.endOfTabDividerLine} />
        <View style={styles.endOfTabBadgeContainer}>
          <Text style={styles.endOfTabBadgeSymbol}>✦</Text>
          <Text style={styles.endOfTabBadgeText}>
            END OF {activeTab}
          </Text>
          <Text style={styles.endOfTabBadgeSymbol}>✦</Text>
        </View>
        <View style={styles.endOfTabDividerLine} />
      </View>
    );
  }, [isEndOfTabReached, activeTab]);

  const renderEmptyState = useCallback(() => {
    // If the tab expects photos (> 0 or unknown) and is currently loading, wait for items to load
    if ((isLoading || isTabLoading) && (currentTabExpectedCount === null || currentTabExpectedCount > 0)) {
      return null;
    }

    if (activeTab === 'MY PHOTOS') {
      return (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="camera-outline" size={28} color="#8c867e" />
          </View>
          <Text style={styles.emptyTitle}>NO PHOTOS MATCHED YET</Text>
          <Text style={styles.emptyText}>
            We haven't matched any photos to your selfie in this celebration yet. Photos will appear automatically as the photographer uploads them.
          </Text>
          <TouchableOpacity
            style={styles.emptyActionButton}
            activeOpacity={0.8}
            onPress={() => {
              setShowSelfieModal(true);
            }}
          >
            <Feather name="camera" size={14} color="#1c1a18" style={{ marginRight: 6 }} />
            <Text style={styles.emptyActionText}>RETAKE SELFIE</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeTab === 'MY FAVOURITES') {
      return (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="heart-outline" size={28} color="#8c867e" />
          </View>
          <Text style={styles.emptyTitle}>NO FAVOURITES YET</Text>
          <Text style={styles.emptyText}>
            Double-tap or tap the bookmark on any photo to save it to your personal collection.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconCircle}>
          <Ionicons name="images-outline" size={28} color="#8c867e" />
        </View>
        <Text style={styles.emptyTitle}>NO PHOTOS IN {activeTab}</Text>
        <Text style={styles.emptyText}>
          There are currently no photos in this collection.
        </Text>
      </View>
    );
  }, [isLoading, isTabLoading, currentTabExpectedCount, activeTab]);

  const handleDeletePhoto = useCallback(async (photoItem: any) => {
    if (!photoItem || !photoItem.id) return;
    try {
      const photoId = photoItem.id;
      const headers = eventHeadersRef.current || (useAuthStore.getState().token ? { Authorization: `Bearer ${useAuthStore.getState().token}` } : {});
      await guestApi.delete(`/api/gallery/public/events/${eventSlug}/photos/${photoId}`, {
        headers
      });

      setAllPhotos((prev) => prev.filter((p: any) => p.id !== photoId));
      setTabCache((prev) => {
        const nextCache: Record<string, Photo[]> = {};
        for (const [key, list] of Object.entries(prev)) {
          nextCache[key] = list.filter((p: any) => p.id !== photoId);
        }
        return nextCache;
      });
    } catch (err: any) {
      console.error('[MYCIRCLE DELETE ERROR ❌]', err);
      throw new Error(err?.response?.data?.error || err?.message || 'Failed to delete photo.');
    }
  }, [eventSlug]);

  const renderMasonryCardItem = useCallback(({ item, index, isColumn0, columnIndex, numColumns, isHighPriority }: any) => {
    if (item.isSkeleton) {
      return <View style={[styles.masonryCard, styles.skeletonCard, { width: '100%', height: '100%' }]} />;
    }
    return (
      <MasonryCard
        key={item.id ? String(item.id) : (item.r2Url || `photo-${index}`)}
        img={item}
        index={index}
        isColumn0={isColumn0}
        columnIndex={columnIndex}
        numColumns={numColumns}
        isHighPriority={typeof isHighPriority === 'boolean' ? isHighPriority : (index < 20)}
        onSelect={(bounds) => openLightbox(item, bounds)}
        onRegisterRef={(id, ref) => {
          const refId = item.id ? String(item.id) : (item.r2Url || `photo-${index}`);
          if (id) cardRefs.current[id] = ref;
          if (refId) cardRefs.current[refId] = ref;
        }}
        onToggleLike={handleToggleLike}
      />
    );
  }, [openLightbox, handleToggleLike]);

  if (!eventSlug) return null;

  return (
    <View style={styles.galleryRootContainer}>
      <GestureHandlerRootView style={styles.container}>
        <GestureDetector gesture={edgeSwipeGesture}>
          <Animated.View style={[{ flex: 1, backgroundColor: '#ffffff' }, screenSwipeAnimatedStyle]}>
            <StatusBar barStyle={statusBarStyle} translucent backgroundColor="transparent" />

            {/* ── Base Layer: Photos Gallery View (Remains mounted underneath Cinema) ── */}
            <View style={StyleSheet.absoluteFillObject} pointerEvents={isCinema ? 'none' : 'auto'}>
              <MasonryFlashList
                mainScrollRef={mainScrollRef}
                data={displayData as any}
                numColumns={galleryColumns}
                onNumColumnsChange={handleGalleryColumnsChange}
                minContentHeight={
                  (!isEndOfTabReached && activePhotoList.length < totalTabPhotos)
                    ? estimatedTotalContentHeight
                    : (resumeTargetYRef.current ? resumeTargetYRef.current + screenHeight + 200 : 0)
                }
                contentHeightShared={galleryContentHeightShared}
                photoScrollOffsetsShared={photoScrollOffsetsShared}
                photoScrollEntriesShared={photoScrollEntriesShared}
                enablePinchToZoom={!isCinema && activeImageIndex === null && activeVideoItem === null && !isMoreDrawerOpen}
                isPinchingShared={isPinching}
                minColumns={1}
                maxColumns={5}
                onScroll={scrollHandler}
                scrollSharedValue={scrollY}
                renderHeroCover={renderHeroCover}
                renderStickyHeader={renderStickyHeader}
                ListFooterComponent={renderFooter()}
                ListEmptyComponent={renderEmptyState}
                refreshControl={
                  <RefreshControl
                    refreshing={isRefreshingGallery}
                    onRefresh={handleRefreshGallery}
                    tintColor="#ffffff"
                  />
                }
                renderItem={renderMasonryCardItem}
                onMomentumScrollEnd={(e) => {
                  handleViewportScroll(e.nativeEvent.contentOffset.y, e.nativeEvent.layoutMeasurement.height, e.nativeEvent.contentSize.height);
                }}
                onScrollEndDrag={(e) => {
                  handleViewportScroll(e.nativeEvent.contentOffset.y, e.nativeEvent.layoutMeasurement.height, e.nativeEvent.contentSize.height);
                }}
              />

              {/* Floating Sticky Tab Header (Takes over smoothly when scrolled past hero cover, outside ScrollView to ensure 100% touch responsiveness) */}
              <Animated.View
                style={[
                  styles.floatingHeaderContainer,
                  {
                    paddingTop: Math.max(insets.top + 4, 28),
                  },
                  floatingHeaderAnimatedStyle,
                ]}
              >
                {renderTabHeaderInner()}
              </Animated.View>

              {/* Borderless Editorial Back Button */}
              {!isCinema && (
                <Pressable
                  style={[styles.editorialBackButton, { top: Math.max(insets.top + 10, 42) }]}
                  onPress={handleBackAction}
                  hitSlop={16}
                >
                  <Animated.Text style={[styles.editorialBackText, animatedBackTextStyle]}>← BACK</Animated.Text>
                </Pressable>
              )}

              {/* iOS Underlay Dimming Overlay (Fades from 0.15 to 0 as Cinema slides away) */}
              {isCinema && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFillObject,
                    { backgroundColor: '#000000', zIndex: 5 },
                    photosDimAnimatedStyle,
                  ]}
                />
              )}

              {/* ── Spatial Film Loupe (Velocity-Gated Pure-Photo Scrubber with Click & Drag) ── */}
              {!isCinema && loupeThumbnails.length > 0 && (
                <SpatialFilmLoupeCard
                  thumbnails={loupeThumbnails}
                  keyframeIndices={loupeKeyframeIndices}
                  scrollY={scrollY}
                  totalPhotosShared={totalPhotosShared}
                  contentHeightShared={galleryContentHeightShared}
                  photoScrollOffsetsShared={photoScrollOffsetsShared}
                  photoScrollEntriesShared={photoScrollEntriesShared}
                  loupeOpacity={loupeOpacity}
                  isDraggingLoupeShared={isDraggingLoupe}
                  scrollDirectionShared={loupeScrollDirection}
                  mainScrollRef={mainScrollRef}
                  insetsTop={insets.top}
                  insetsBottom={insets.bottom}
                  screenHeight={screenHeight}
                  onPressCard={handleJumpToKeyframe}
                  onDragEnd={handleLoupeDragEnd}
                  numColumns={galleryColumns}
                />
              )}
            </View>

            {/* ── Top Layer: Cinema Library View (Mounted when isCinema is true; slides to reveal Photos on Apple back swipe) ── */}
            {isCinema && (
              <Animated.View
                style={[
                  styles.cinemaOverlayContainer,
                  cinemaAnimatedStyle,
                ]}
              >
                <CinemaLibraryView
                  videos={activeCinemaVideos as any}
                  coverUrl={coverUrl}
                  eventTitle={cleanTitle}
                  onSelectVideo={(video, resumeTimeSec) => {
                    openLightbox({ ...video, resumeTimeSec }, null);
                  }}
                  onBackToGallery={handleBackAction}
                  onScroll={cinemaScrollHandler}
                  scrollY={cinemaScrollY}
                  mainScrollRef={cinemaScrollRef}
                  refreshControl={
                    <RefreshControl
                      refreshing={isRefreshingGallery}
                      onRefresh={handleRefreshGallery}
                      tintColor="#E5C483"
                    />
                  }
                  isLoading={isTabLoading}
                  allowDownloads={isGalleryDownloadAllowed}
                  hasFullAccess={hasFullAccess}
                />
              </Animated.View>
            )}

            {/* ── Floating "Resume where you left off" Pill ── */}
            {showResumePill && (
              <Animated.View
                style={[
                  styles.resumePillContainer,
                  { bottom: Math.max(insets.bottom + 22, 32) },
                  resumePillAnimatedStyle,
                  isCinema && { opacity: 0 },
                ]}
                pointerEvents={showResumePill && !isCinema ? 'auto' : 'none'}
              >
                <View style={styles.resumePillWrapper}>
                  <TouchableOpacity
                    style={styles.resumePillButton}
                    activeOpacity={0.8}
                    onPress={handleResumeViewing}
                  >
                    <Text style={styles.resumePillIcon}>↓</Text>
                    <Text style={styles.resumePillText}>RESUME VIEWING</Text>
                  </TouchableOpacity>
                  <View style={styles.resumePillDivider} />
                  <TouchableOpacity
                    style={styles.resumePillDismiss}
                    onPress={dismissResumePill}
                    hitSlop={{ top: 12, bottom: 12, left: 10, right: 12 }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.resumePillDismissText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            )}

            {/* ── Floating Editorial Back to Top Button with Slow Smooth Fade-In ── */}
            <Animated.View
              style={[
                styles.backToTopContainer,
                { bottom: Math.max(insets.bottom + 20, 30) },
                backToTopAnimatedStyle,
                isCinema && { opacity: 0 },
              ]}
              pointerEvents={isPast60Photos && !isCinema ? 'auto' : 'none'}
            >
            <TouchableOpacity
              style={styles.backToTopButton}
              onPress={scrollToTopSmoothly}
              activeOpacity={0.8}
            >
              <Text style={styles.editorialBackText}>↑ BACK TO TOP</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      {/* ── "+ MORE / ALL ALBUMS" BOTTOM DRAWER OVERLAY (Outside GestureDetector) ── */}
      {isMoreDrawerOpen ? (
        <View style={styles.drawerOverlay}>
          <Pressable style={{ flex: 1 }} onPress={closeDrawerWithAnimation}>
            <Animated.View style={[styles.drawerBackdrop, drawerBackdropStyle]} />
          </Pressable>
          <Animated.View style={[styles.drawerContent, drawerContentStyle, { paddingBottom: Math.max(insets.bottom + 16, 24) }]}>
            {/* Handle Bar — swipe down to close */}
            <GestureDetector gesture={drawerHandlePanGesture}>
              <Animated.View>
                <View style={styles.drawerHandleBar} />

                {/* Header */}
                <View style={styles.drawerHeader}>
                  <Text style={styles.drawerTitle}>ALL EVENTS</Text>
                  <TouchableOpacity
                    onPress={closeDrawerWithAnimation}
                    hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                    style={styles.drawerCloseButton}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={20} color="#8c867e" />
                  </TouchableOpacity>
                </View>
              </Animated.View>
            </GestureDetector>

            <ScrollView
              scrollEnabled={true}
              bounces={true}
              alwaysBounceVertical={true}
              overScrollMode="always"
              showsVerticalScrollIndicator={false}
              style={styles.drawerScrollView}
            >
              {availableTabs.map((tabName, tabIdx) => {
                const isActive = activeTab.toUpperCase() === tabName.toUpperCase();
                const tabCount = getTabPhotoCount(tabName);

                return (
                  <TouchableOpacity
                    key={`drawer-tab-${tabName}-${tabIdx}`}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                      changeTabWithScrollMemory(tabName);
                      closeDrawerWithAnimation();
                    }}
                    activeOpacity={0.7}
                    style={[styles.drawerItem, isActive && styles.drawerItemActive]}
                  >
                    <View style={styles.drawerItemLeft}>
                      <Text style={[styles.drawerItemText, isActive && styles.drawerItemTextActive]}>
                        {tabName}
                      </Text>
                      {tabCount !== null ? (
                        <Text style={[styles.drawerItemCount, isActive && styles.drawerItemCountActive]}>
                          ({tabCount})
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      ) : null}

        {/* ── 4. Universal Editorial Lightbox Component ── */}
        {activeImageIndex !== null && (() => {
          let activeTabTotalCount = getTabPhotoCount(activeTab) ?? activeList.length;
          if (!activeTabTotalCount || activeTabTotalCount <= 0) {
            activeTabTotalCount = activeList.length;
          }

          return (
            <EditorialLightbox
              visible={activeImageIndex !== null}
              images={displayData}
              initialIndex={activeImageIndex}
              initialBounds={selectedBounds}
              onGetBoundsForIndex={getBoundsForIndex}
              onToggleLike={handleToggleLike}
              likeTargetName="My Favourites"
              enableDownload={isGalleryDownloadAllowed}
              totalCount={activeTabTotalCount}
              enableDelete={isBrideOrGroom}
              onDeletePhoto={handleDeletePhoto}
              enableLock={isBrideOrGroom}
              onToggleLockPhoto={handleToggleLockPhoto}
              onClose={() => {
                setActiveImageIndex(null);
                setSelectedBounds(null);
                updateStatusBarStyle(statusBarStyle);
              }}
              onPlayVideo={(item) => {
                // Close lightbox first so CinemaVideoModal isn't rendered behind it
                setActiveImageIndex(null);
                setSelectedBounds(null);
                setTimeout(() => setActiveVideoItem(item), 100);
              }}
              title={cleanTitle}
              subtitle={activeTab.toUpperCase()}
            />
          );
        })()}

        {/* ── 5. Cinema Video Modal Player ── */}
        <CinemaVideoModal
          visible={activeVideoItem !== null}
          video={activeVideoItem}
          onClose={() => {
            setActiveVideoItem(null);
            updateStatusBarStyle(statusBarStyle);
          }}
          eventTitle={cleanTitle}
          allowDownloads={isGalleryDownloadAllowed}
        />

        {/* ── 6. Retake Selfie Camera Modal ── */}
        {showSelfieModal && (
          <Modal
            visible={showSelfieModal}
            animationType="fade"
            transparent={true}
            statusBarTranslucent={true}
            onRequestClose={() => {
              setShowSelfieModal(false);
              updateStatusBarStyle(statusBarStyle);
            }}
          >
            <CameraViewScreen
              onSuccess={() => {
                setShowSelfieModal(false);
                handleRefreshGallery();
              }}
              onCancel={() => {
                setShowSelfieModal(false);
                updateStatusBarStyle(statusBarStyle);
              }}
            />
          </Modal>
        )}
    </GestureHandlerRootView>
  </View>
  );
});

const styles = StyleSheet.create({
  galleryRootContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  cinemaOverlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    backgroundColor: '#000000',
    shadowColor: '#000000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
  },
  editorialBackButton: {
    position: 'absolute',
    left: 24,
    zIndex: 100,
    elevation: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  editorialBackText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    color: '#ffffff',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  heroContainer: {
    width: '100%',
    height: Math.round(screenHeight * 0.70),
    position: 'relative',
    backgroundColor: '#1c1a18',
    overflow: 'hidden',
  },
  heroImageWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -Math.round(screenHeight * 0.70 * 0.1),
    height: Math.round(screenHeight * 0.70 * 1.25),
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  coverHeaderLogoContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 95,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverHeaderLogo: {
    width: 135,
    height: 38,
  },
  titleContainer: {
    position: 'absolute',
    bottom: 30,
    left: 24,
    right: 24,
  },
  storyLocation: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 10,
    letterSpacing: 3,
    color: '#ffffff',
    marginBottom: 8,
    opacity: 0.9,
  },
  storyTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 32,
    color: '#ffffff',
    marginBottom: 8,
    lineHeight: 38,
  },
  storyDate: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    letterSpacing: 1,
    color: '#ffffff',
    opacity: 0.8,
  },
  editorialContainer: {
    paddingHorizontal: 28,
    paddingVertical: 32,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  subtitleText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    letterSpacing: 2.5,
    color: '#8c867e',
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '600',
  },
  descriptionText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 14,
    lineHeight: 24,
    color: '#4a4540',
    textAlign: 'center',
  },
  galleryContainer: {
    paddingTop: 20,
  },
  tabsWrapper: {
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f3f3',
    marginBottom: 16,
  },
  tabsScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 20,
  },
  tabButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabButtonActive: {
    borderBottomColor: '#1c1a18',
  },
  tabText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    letterSpacing: 2,
    color: '#8c867e',
  },
  tabTextActive: {
    color: '#1c1a18',
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontWeight: '600',
  },
  masonryGridContainer: {
    position: 'relative',
    width: '100%',
    paddingHorizontal: 0,
  },
  masonryColumn: {
    flex: 1,
    flexDirection: 'column',
    gap: 6,
  },
  masonryCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  skeletonCard: {
    backgroundColor: '#f5f5f5',
    opacity: 1,
  },
  emptyContainer: {
    paddingVertical: 56,
    paddingHorizontal: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#f8f8f8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#ececec',
  },
  emptyTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: '600',
    color: '#1c1a18',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 14,
    lineHeight: 22,
    color: '#8c867e',
    textAlign: 'center',
    maxWidth: 320,
    marginBottom: 20,
  },
  emptyActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#1c1a18',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  emptyActionText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '600',
    color: '#1c1a18',
  },
  backToTopContainer: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 99,
  },
  backToTopButton: {
    backgroundColor: 'rgba(28, 26, 24, 0.55)',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 99,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorialBackTextDark: {
    color: '#1c1a18',
    textShadowColor: 'transparent',
  },
  stickyHeaderContainer: {
    backgroundColor: '#ffffff',
    zIndex: 10,
  },
  floatingHeaderContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    zIndex: 90,
    elevation: 8,
  },
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  drawerContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingHorizontal: 20,
    maxHeight: screenHeight * 0.85,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },
  drawerHandleBar: {
    width: 38,
    height: 4,
    backgroundColor: '#d6d1ca',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 10,
  },
  drawerHeader: {
    position: 'relative',
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f3f3',
    marginBottom: 8,
  },
  drawerTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    letterSpacing: 2,
    color: '#1c1a18',
    fontWeight: '600',
    textAlign: 'center',
  },
  drawerCloseButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: 4,
    zIndex: 10,
  },
  drawerCloseText: {
    fontSize: 16,
    color: '#8c867e',
    fontWeight: '300',
  },
  drawerScrollView: {
    marginVertical: 4,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f3f3',
  },
  drawerItemActive: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  drawerItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  drawerItemText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    letterSpacing: 2,
    color: '#8c867e',
  },
  drawerItemTextActive: {
    color: '#000000',
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontWeight: '600',
  },
  drawerItemCount: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    letterSpacing: 1,
    color: '#b0a9a0',
  },
  drawerItemCountActive: {
    color: '#000000',
    fontWeight: '600',
  },
  drawerItemCheck: {
    fontSize: 13,
    color: '#000000',
    fontWeight: 'bold',
  },
  compactTabHeaderBarCentered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    width: '100%',
  },
  compactTabActiveTitleCentered: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    letterSpacing: 2,
    color: '#000000',
    fontWeight: '600',
    textAlign: 'center',
  },
  downArrowIcon: {
    fontSize: 15,
    lineHeight: 16,
    color: '#000000',
  },
  stickyHeaderContainerInner: {
    position: 'relative',
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightDownloadButton: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerRightDownloadIcon: {
    fontSize: 14,
  },
  headerRightDownloadText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 10,
    color: '#3a3632',
    fontWeight: '600',
  },
  endOfTabFooterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    width: '100%',
    gap: 12,
  },
  endOfTabDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#f3f3f3',
  },
  endOfTabBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  endOfTabBadgeSymbol: {
    fontSize: 9,
    color: '#8c867e',
  },
  endOfTabBadgeText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 10,
    letterSpacing: 2,
    color: '#8c867e',
    fontWeight: '500',
  },
  cinemaMetaWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cinemaCoverLeadIn: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 9,
    letterSpacing: 2.5,
    color: '#E5C483', // Warm champagne
    marginBottom: 3,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  cinemaStoryTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 1.5,
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 3,
  },
  cinemaCoverDate: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 9,
    letterSpacing: 1.5,
    color: 'rgba(255, 255, 255, 0.65)',
    textAlign: 'center',
  },
  compactTabActiveTitleCenteredCinema: {
    color: '#FFFFFF',
  },
  downArrowIconCinema: {
    color: '#C5A880',
  },
  // ─── Resume Where You Left Off Pill ─────────────────────────────────────────
  resumePillContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 25,
  },
  resumePillWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(28, 26, 24, 0.92)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.38,
    shadowRadius: 10,
    elevation: 10,
    paddingVertical: 2,
    paddingLeft: 4,
    paddingRight: 6,
  },
  resumePillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 10,
    gap: 6,
  },
  resumePillIcon: {
    fontSize: 12,
    color: '#E5C483',
    fontWeight: 'bold',
  },
  resumePillText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    color: '#ffffff',
  },
  resumePillDivider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 2,
  },
  resumePillDismiss: {
    paddingVertical: 7,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumePillDismissText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: 'bold',
    lineHeight: 14,
  },
});

export default GalleryView;
