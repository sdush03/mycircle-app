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
} from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MasonryFlashList, getMediaDisplayUri } from '../common/MasonryFlashList';
import { getPhotoAspect } from '../../utils/photoDimensionCache';
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
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
  TouchableOpacity as GHTouchableOpacity,
  Pressable as GHPressable,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedRef,
  useDerivedValue,
  scrollTo,
  runOnUI,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
  useAnimatedScrollHandler,
  interpolate,
  interpolateColor,
} from 'react-native-reanimated';
import { usePathname } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useScrollTabBarCollapse } from '../../hooks/useScrollTabBarCollapse';
import api, { guestApi } from '../../services/api';
import { MasonryCard } from '../home/lightbox/components/MasonryCard';
import { EditorialLightbox, LightboxBounds } from '../home/lightbox/EditorialLightbox';
import { CinemaVideoModal } from '../common/CinemaVideoModal';
import { CinemaLibraryView, formatCinemaCategoryTitleCase, formatCinemaDisplayTitle, classifyCinemaCategory } from '../cinema/CinemaLibraryView';
import { hasActualVideoFile, isVideoComingSoon, isCinemaVideoItem, isHighlightsEligibleCinemaVideo, isVerticalVideo } from '../cinema/CinemaVideoCard';
import { videoPreloadManager } from '../../services/videoPreloadManager';
import { videoDownloadManager } from '../../services/videoDownloadManager';
import {
  FONT_MONTSERRAT_REGULAR,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';

const { width, height: screenHeight } = Dimensions.get('window');

interface Photo {
  id: number;
  r2Url: string;
  width?: number;
  height?: number;
  aspectRatio?: number | null;
  isLiked?: boolean;
  likeCount?: number;
  isVideo?: boolean;
  isComingSoon?: boolean;
  subtitle?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  [key: string]: any;
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

  let rawThumb = p.thumbnailUrl || p.thumbUri || p.preview_url || p.coverUrl || p.cover_url || p.posterUrl || p.poster_url || p.coverPhotoUrl || p.cover_photo_url;
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
    thumbnailUrl: validThumb || thumbUri || fullUri,
    width: w || undefined,
    height: h || undefined,
    aspectRatio,
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
    raw: p,
  };
}

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
    return cachedInitial?.details || null;
  });
  const [eventGuest, setEventGuest] = useState<any>(null);

  const [guestAccessLevel, setGuestAccessLevel] = useState<boolean | null>(() => {
    if (cachedInitial && typeof cachedInitial.hasFullAccess === 'boolean') {
      return cachedInitial.hasFullAccess;
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
  const [isTabLoading, setIsTabLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (!eventSlug) return 'HIGHLIGHTS';
    if (cachedInitial) {
      if (cachedInitial.hasFullAccess === false) {
        return 'HIGHLIGHTS';
      }
      const hlCount = cachedInitial.details?.tabCounts?.['HIGHLIGHTS'] ?? 0;
      if (hlCount > 0) return 'HIGHLIGHTS';
    }
    return 'HIGHLIGHTS';
  });

  const [isLoading, setIsLoading] = useState<boolean>(() => {
    const hasPhotos = Boolean(cachedInitial?.photos && cachedInitial.photos.length > 0);
    const hasTabs = Boolean(cachedInitial?.tabCache && Object.keys(cachedInitial.tabCache).length > 0);
    return !(hasPhotos || hasTabs);
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
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isMoreDrawerOpen, setIsMoreDrawerOpen] = useState(false);
  const [isScrolledPastHero, setIsScrolledPastHero] = useState(false);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [batchDownloadProgress, setBatchDownloadProgress] = useState<{ current: number; total: number } | null>(null);
  const [lockedPhotoIds, setLockedPhotoIds] = useState<Set<number>>(new Set());

  // Lightbox & Video State
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [activeVideoItem, setActiveVideoItem] = useState<any | null>(null);
  const lastNonCinemaTabRef = useRef<string>('ALL');
  const [selectedBounds, setSelectedBounds] = useState<LightboxBounds | null>(null);

  const PAGE_SIZE = 60;
  const mainScrollRef = useAnimatedRef<Animated.ScrollView>();
  const currentYRef = useRef<number>(0);
  const isTabSwitchingRef = useRef<boolean>(false);
  const cardRefs = useRef<{ [key: string]: View | null }>({});
  const eventHeadersRef = useRef<Record<string, string>>({});
  const allPhotosOffsetRef = useRef<number>(cachedInitial?.photos?.length || 0);
  const tabOffsetsRef = useRef<Record<string, number>>({});
  const tabHasMoreRef = useRef<Record<string, boolean>>({});

  // Column Density & Pinch-to-Zoom State (1 = editorial, 2 = masonry, 3 = compact grid)
  const [galleryColumns, setGalleryColumns] = useState<number>(2);
  const galleryColumnsRef = useRef<number>(2);
  galleryColumnsRef.current = galleryColumns;
  const scheduleBatchPrefetchRef = useRef<((mappedList: Photo[], cols?: number) => void) | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('mycircle_gallery_columns').then((val) => {
      if (val) {
        const parsed = parseInt(val, 10);
        if (parsed >= 1 && parsed <= 5) {
          setGalleryColumns(parsed);
          galleryColumnsRef.current = parsed;
        }
      }
    }).catch(() => {});
  }, []);

  const handleGalleryColumnsChange = useCallback((newCols: number) => {
    setGalleryColumns(newCols);
    galleryColumnsRef.current = newCols;
    AsyncStorage.setItem('mycircle_gallery_columns', String(newCols)).catch(() => {});
    if (activeListRef.current && activeListRef.current.length > 0) {
      scheduleBatchPrefetchRef.current?.(activeListRef.current, newCols);
    }
  }, []);

  const cleanTitle = (eventTitle || eventDetails?.title || eventSlug || 'WEDDING CELEBRATION')
    .toString()
    .replace(/'s\s+Wedding/gi, '')
    .replace('&', '·')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  const isFetchingMoreRef = useRef<boolean>(false);
  const lastScrollYRef = useRef<number>(0);
  const btnStateRef = useRef<'hidden' | 'dim' | 'bright'>('hidden');

  const screenSwipeX = useSharedValue(width);
  const isClosingRef = useRef(false);
  const touchStartedOnLeftEdge = useSharedValue(false);
  const isLightboxOpen = useSharedValue(false);
  const backToTopOpacity = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const scrollTargetY = useSharedValue(0);
  const isSmoothScrollingToTop = useSharedValue(false);
  const [isPast60Photos, setIsPast60Photos] = useState(false);

  const exactTouchPoint = Math.round(screenHeight * 0.70) - Math.round(insets.top + 45);
  const heroCoverHeight = Math.round(screenHeight * 0.70);

  const floatingHeaderAnimatedStyle = useAnimatedStyle(() => {
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

  const drawerBackdropStyle = useAnimatedStyle(() => ({
    opacity: 0,
  }));

  const drawerContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - drawerProgress.value) * screenHeight + Math.max(0, drawerPanY.value) }],
  }));

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

  const animatedBackTextStyle = useAnimatedStyle(() => ({
    color: scrollY.value >= exactTouchPoint ? (isCinema ? '#ffffff' : '#3a3632') : '#ffffff',
  }));

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

  useEffect(() => {
    if (!isCinema && activeTab) {
      lastNonCinemaTabRef.current = activeTab;
    }
  }, [isCinema, activeTab]);

  useEffect(() => {
    isCinemaShared.value = isCinema;
    if (!isCinema) {
      cinemaSwipeX.value = 0;
    }
    cinemaProgress.value = withTiming(isCinema ? 1 : 0, {
      duration: 250,
      easing: Easing.out(Easing.quad),
    });
  }, [isCinema, cinemaProgress, isCinemaShared, cinemaSwipeX]);

  const cinemaAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cinemaSwipeX.value }],
  }));

  const photosDimAnimatedStyle = useAnimatedStyle(() => {
    if (!isCinemaShared.value) return { opacity: 0 };
    const progress = cinemaSwipeX.value / width;
    return {
      opacity: interpolate(progress, [0, 1], [0.15, 0], 'clamp'),
    };
  });



  const animatedHeroImageStyle = useAnimatedStyle(() => {
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
  const hasSetLandingTabRef = useRef<boolean>(false);

  const handleViewportScroll = useCallback((offsetY: number, layoutHeight: number, contentHeight: number) => {
    currentYRef.current = offsetY;
    if (activeTab && activeTab.trim().toUpperCase() !== 'CINEMA') {
      tabOffsetsRef.current[activeTab.trim().toUpperCase()] = offsetY;
    }

    const currentCols = galleryColumnsRef.current || 2;
    const heroHeight = Math.round(screenHeight * 0.70);
    const relativeY = Math.max(0, offsetY - heroHeight);
    const rowH = currentCols === 1 ? 380 : (currentCols === 2 ? 220 : (currentCols === 3 ? 145 : (currentCols === 4 ? 105 : 80)));
    const currentRow = Math.floor(relativeY / rowH);
    const visibleStartIndex = Math.max(0, currentRow * currentCols);

    // Viewport-Proximity Pre-fetch: pre-fetch upcoming thumbnail cards ahead of the user's screen
    // Dynamically scale prefetch count based on column count (e.g. 30 for 1-2 cols, 45 for 3 cols, 60 for 4 cols, 75 for 5 cols)
    const prefetchWindow = Math.max(30, currentCols * 15);
    const upcomingPhotos = activeListRef.current.slice(visibleStartIndex, visibleStartIndex + prefetchWindow);
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

    const nearBottomThreshold = currentCols >= 4 ? 12000 : 8000;
    const isNearBottom = layoutHeight + offsetY >= contentHeight - nearBottomThreshold;
    if (isNearBottom && hasMorePhotos && !isFetchingMoreRef.current && loadMorePhotosRef.current) {
      loadMorePhotosRef.current();
    }
  }, [hasMorePhotos]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      scrollY.value = event.contentOffset.y;
      runOnJS(handleViewportScroll)(
        event.contentOffset.y,
        event.layoutMeasurement.height,
        event.contentSize.height
      );
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

  const backToTopAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backToTopOpacity.value,
    transform: [
      { translateY: (1 - backToTopOpacity.value) * 12 },
      { scale: 0.92 + backToTopOpacity.value * 0.08 },
    ],
  }));

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

  // Viewport-Proximity & Page Batch Pre-Fetch Engine: Prefetches upcoming thumbnail photos into native image cache
  const scheduleBatchPrefetch = useCallback((mappedList: Photo[], cols?: number) => {
    if (!mappedList || mappedList.length === 0) return;

    const activeCols = cols ?? galleryColumnsRef.current ?? 2;
    // Scale prefetch batch dynamically: 60 for 1-2 cols, 90 for 3 cols, 120 for 4 cols, 150 for 5 cols
    const targetCount = Math.max(60, activeCols * 30);
    const targetItems = mappedList.slice(0, targetCount);

    const chunkSize = 20;
    for (let i = 0; i < targetItems.length; i += chunkSize) {
      const chunk = targetItems.slice(i, i + chunkSize);
      const delay = Math.floor(i / chunkSize) * 60;
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



  const screenSwipeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: screenSwipeX.value }],
  }));

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
          const c = eventRes.data.coverPhotoMobileUrl || eventRes.data.coverPhotoUrl || eventRes.data.coverUrl || eventRes.data.bannerUrl;
          if (c) Image.prefetch(c);
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

      if (allRes?.status === 401 && matchedRes?.status === 401) {
        useAuthStore.getState().clearGalleryCache(eventSlug);
        await useAuthStore.getState().logout();
        onLogout?.();
        return;
      }

      const matchedList = matchedRes.data?.photos || matchedRes.data?.matchedPhotos || (Array.isArray(matchedRes.data) ? matchedRes.data : []);
      const mappedMatched = Array.isArray(matchedList) ? matchedList.map(mapPhotoItem) : [];
      setPhotos(mappedMatched);

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
              videoDownloadManager.queue(vUrl, priority);
            } else {
              setTimeout(() => {
                videoPreloadManager.preload(vUrl, v.thumbnailUrl, meta);
                videoDownloadManager.queue(vUrl, priority);
              }, queueIdx * 1500);
            }
          }
        });
      }

      const allList = allRes.data?.photos || (Array.isArray(allRes.data) ? allRes.data : []);
      const mappedPhotos = Array.isArray(allList) ? allList.map(mapPhotoItem) : [];
      const total = typeof allRes.data?.total === 'number' ? allRes.data.total : mappedPhotos.length;
      setTotalAllPhotosCount(total);
      setAllPhotos((prev) => {
        if (prev.length > 0 && prev.length === mappedPhotos.length && prev[0]?.id === mappedPhotos[0]?.id && prev[prev.length - 1]?.id === mappedPhotos[mappedPhotos.length - 1]?.id) {
          return prev;
        }
        return mappedPhotos;
      });
      allPhotosOffsetRef.current = mappedPhotos.length;
      setAllPhotosOffset(mappedPhotos.length);
      setHasMorePhotos(mappedPhotos.length < total);

      // Save to cache
      useAuthStore.getState().setGalleryCache(eventSlug, {
        details: fetchedEventDetails || undefined,
        photos: mappedPhotos,
        headers: eventHeadersRef.current,
        total: total,
        hasFullAccess: guestAccessLevel ?? true,
        matched: mappedMatched,
        favorites: mappedFavs,
        tabCache: {
          ...(mappedFavs.length > 0 ? { 'MY FAVOURITES': mappedFavs } : {}),
          ...(mappedCinema.length > 0 ? { 'CINEMA': mappedCinema } : {}),
        },
      });

      scheduleBatchPrefetch(mappedPhotos);
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

        console.warn(`[MYCIRCLE BUNDLE ⚠️] Status: ${status}, Code: ${errCode}`, errData);

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
      }

      // 1. Process Event Details
      if (bundleData.event) {
        setEventDetailsData(bundleData.event);
        const c = bundleData.event.coverPhotoMobileUrl || bundleData.event.coverPhotoUrl || bundleData.event.coverUrl || bundleData.event.bannerUrl;
        if (c) Image.prefetch(c);
      }

      // 2. Process Guest Access Level (Partial vs Full)
      const newFullAccess = bundleData.guest ? Boolean(bundleData.guest.hasFullAccess) : false;
      const oldFullAccess = guestAccessLevel;
      setGuestAccessLevel(newFullAccess);

      if (bundleData.guest) {
        setEventGuest(bundleData.guest);
      }

      // Security Fundamental 3: Guest was demoted from Full to Partial!
      // Drop ALL tab, switch immediately to HIGHLIGHTS
      if (oldFullAccess === true && newFullAccess === false) {
        console.log(`[MYCIRCLE ACCESS 🔒] Access downgraded from Full to Partial. Switching to HIGHLIGHTS.`);
        setActiveTab('HIGHLIGHTS');
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
              videoDownloadManager.queue(vUrl, priority);
            } else {
              setTimeout(() => {
                videoPreloadManager.preload(vUrl, v.thumbnailUrl, meta);
                videoDownloadManager.queue(vUrl, priority);
              }, queueIdx * 1500);
            }
          }
        });
      }

      const total = typeof bundleData.total === 'number' ? bundleData.total : mappedPhotos.length;
      setTotalAllPhotosCount(total);
      setAllPhotos((prev) => {
        if (prev.length > 0 && prev.length === mappedPhotos.length && prev[0]?.id === mappedPhotos[0]?.id && prev[prev.length - 1]?.id === mappedPhotos[mappedPhotos.length - 1]?.id) {
          return prev; // Reference stability! ZERO re-render flicker!
        }
        return mappedPhotos;
      });
      allPhotosOffsetRef.current = mappedPhotos.length;
      setAllPhotosOffset(mappedPhotos.length);
      setHasMorePhotos(Boolean(bundleData.hasMore));

      // Persist to disk/memory cache for future 0ms instant opens
      useAuthStore.getState().setGalleryCache(eventSlug, {
        details: bundleData.event || undefined,
        photos: mappedPhotos,
        headers: eventHeadersRef.current,
        total: total,
        hasFullAccess: newFullAccess,
        matched: mappedMatched,
        favorites: mappedFavs,
        tabCache: {
          ...(mappedFavs.length > 0 ? { 'MY FAVOURITES': mappedFavs } : {}),
          ...(mappedCinema.length > 0 ? { 'CINEMA': mappedCinema } : {}),
        },
      });

      // Smooth chunked background prefetch of initial batch into native image cache
      scheduleBatchPrefetch(mappedPhotos);
    } catch (err) {
      console.warn('[MYCIRCLE REVALIDATE ⚠️] fetchPhotos error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshGallery = async () => {
    setIsRefreshingGallery(true);
    try {
      await fetchPhotos();
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
    if (normTab === 'MY PHOTOS' || normTab === 'MY FAVOURITES') return;

    try {
      isFetchingMoreRef.current = true;
      setIsLoadingMore(true);

      const isCeremonyTab = normTab !== 'ALL' && normTab !== 'MY PHOTOS' && normTab !== 'MY FAVOURITES';
      const currentOffset = isCeremonyTab
        ? (tabOffsetsRef.current[normTab] ?? (tabCache[normTab]?.length || 0))
        : allPhotosOffsetRef.current;

      const tabQuery = isCeremonyTab ? `&tab=${encodeURIComponent(activeTab)}` : '';
      const eventHeaders = eventHeadersRef.current;
      const dynamicPageSize = (galleryColumnsRef.current || 2) >= 4 ? 120 : ((galleryColumnsRef.current || 2) === 3 ? 90 : PAGE_SIZE);
      const loadMoreStartTime = Date.now();
      console.log(`[MYCIRCLE DEBUG 📥] Pre-fetching next page for '${normTab}' -> offset=${currentOffset}, limit=${dynamicPageSize}...`);

      const allRes = await guestApi.get(
        `/api/gallery/public/events/${eventSlug}/photos?limit=${dynamicPageSize}&offset=${currentOffset}${tabQuery}`,
        { headers: eventHeaders }
      );
      const allList = allRes.data.photos || (Array.isArray(allRes.data) ? allRes.data : []);

      const mapped = Array.isArray(allList) ? allList.map(mapPhotoItem) : [];
      const loadMoreDuration = Date.now() - loadMoreStartTime;
      console.log(`[MYCIRCLE DEBUG ✅] Page Fetch Done in ${loadMoreDuration}ms | Received ${mapped.length} new photos for '${normTab}' | New Offset: ${currentOffset + mapped.length}`);

      if (mapped.length > 0) {
        scheduleBatchPrefetch(mapped);

        if (isCeremonyTab) {
          const newOffset = currentOffset + mapped.length;
          tabOffsetsRef.current[normTab] = newOffset;
          setTabCache((prev) => {
            const existing = prev[normTab] || [];
            const combined = [...existing, ...mapped];
            const dedupped = combined.filter((item, index, self) =>
              index === self.findIndex((t) => (t.id && item.id ? t.id === item.id : t.r2Url === item.r2Url))
            );
            return { ...prev, [normTab]: dedupped };
          });
        } else {
          allPhotosOffsetRef.current += mapped.length;
          setAllPhotosOffset(allPhotosOffsetRef.current);
          setAllPhotos((prev) => {
            const next = [...prev, ...mapped];
            const dedupped = next.filter((item, index, self) =>
              index === self.findIndex((t) => (t.id && item.id ? t.id === item.id : t.r2Url === item.r2Url))
            );
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
      console.warn('[MYCIRCLE DEBUG ⚠️] loadMorePhotos error:', e);
    } finally {
      isFetchingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  };
  loadMorePhotosRef.current = loadMorePhotos;

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
    if (eventDetails?.tabCounts?.['HIGHLIGHTS']) {
      return eventDetails.tabCounts['HIGHLIGHTS'];
    }
    return allPhotos.filter((p: any) => p.tabName && p.tabName.trim().toUpperCase() === 'HIGHLIGHTS').length;
  }, [allPhotos, eventDetails?.tabCounts]);

  // Per-tab server loader (matching web 1:1)
  const fetchTabPhotos = useCallback(async (tabName: string) => {
    const norm = tabName.trim().toUpperCase();
    if (norm === 'ALL' || norm === 'MY PHOTOS' || norm === 'MY FAVOURITES') return;
    if (tabCache[norm]) return; // Already cached

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

      // Smooth chunked background prefetch of tab thumbnails into native cache
      scheduleBatchPrefetch(mapped);

      setTabCache((prev) => ({ ...prev, [norm]: mapped }));
    } catch (err) {
      console.warn(`Failed to fetch photos for tab ${tabName}:`, err);
    } finally {
      setIsTabLoading(false);
    }
  }, [eventSlug, tabCache]);

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

    // 2. MY PHOTOS Tab (Always visible)
    list.push('MY PHOTOS');

    // 3. MY FAVOURITES Tab (Only visible if favorites count > 0)
    if (favoritesCount > 0) {
      list.push('MY FAVOURITES');
    }

    // 4. Dynamic Ceremony/Event Tabs from eventDetails.tabs (from DB)
    const ceremonyTabsSet = new Set<string>();
    // Guarantee HIGHLIGHTS is always present
    ceremonyTabsSet.add('HIGHLIGHTS');

    if (Array.isArray(eventDetails?.tabs)) {
      eventDetails.tabs.forEach((t: string) => {
        if (t && typeof t === 'string' && t.trim().length > 0) {
          ceremonyTabsSet.add(t.trim().toUpperCase());
        }
      });
    }

    // Also include any unique tabNames found in loaded photos
    allPhotos.forEach((p: any) => {
      if (p.tabName && typeof p.tabName === 'string' && p.tabName.trim().length > 0) {
        ceremonyTabsSet.add(p.tabName.trim().toUpperCase());
      }
    });

    const allowedTabs: string[] = [];
    ceremonyTabsSet.forEach((tab) => {
      if (tab !== 'ALL' && tab !== 'MY PHOTOS' && tab !== 'MY FAVOURITES' && !tab.includes('LOCKED')) {
        if (hasFullAccess || tab === 'HIGHLIGHTS' || tab === 'CINEMA') {
          allowedTabs.push(tab);
        }
      }
    });

    // Ensure HIGHLIGHTS is first, CINEMA is second, followed by all other ceremony tabs
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

    // 5. LOCKED Tab (Only visible to Bride & Groom)
    if (isBrideOrGroom) {
      list.push('LOCKED 🔐');
    }

    return list;
  }, [hasFullAccess, favoritesCount, eventDetails?.tabs, allPhotos, isBrideOrGroom]);

  const scrollToY = useCallback((targetY: number) => {
    try {
      if (mainScrollRef.current) {
        if ('scrollTo' in mainScrollRef.current && typeof (mainScrollRef.current as any).scrollTo === 'function') {
          (mainScrollRef.current as any).scrollTo({ y: targetY, animated: false });
        } else {
          runOnUI((y: number) => {
            'worklet';
            scrollTo(mainScrollRef, 0, y, false);
          })(targetY);
        }
      }
    } catch (_e) {
      runOnUI((y: number) => {
        'worklet';
        scrollTo(mainScrollRef, 0, y, false);
      })(targetY);
    }
  }, [mainScrollRef]);

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
    const currentNorm = activeTab.toUpperCase();
    const newNorm = newTab.toUpperCase();
    if (newNorm === currentNorm) return;

    // 1. Lock onScroll during tab transition so native height clamping doesn't erase saved scroll Y
    isTabSwitchingRef.current = true;

    // 2. Save exact scroll position of the photo tab we are leaving
    if (currentNorm !== 'CINEMA') {
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

    screenSwipeX.value = withTiming(width, { duration: 220, easing: Easing.out(Easing.quad) }, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(onChangeEvent)();
      }
    });
  }, [isMoreDrawerOpen, closeDrawerWithAnimation, activeVideoItem, activeImageIndex, isCinema, cinemaSwipeX, finalizeCinemaExit, isClosingRef, screenSwipeX, onChangeEvent]);

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
    .activeOffsetX(30)
    .failOffsetY([-25, 25])
    .onBegin((e) => {
      'worklet';
      touchStartedOnLeftEdge.value = e.x <= 45 && !isLightboxOpen.value;
    })
    .onUpdate((e) => {
      'worklet';
      if (!touchStartedOnLeftEdge.value) return;
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
  // - If highlights are present -> land on HIGHLIGHTS (for both Full Access & Partial Access)
  // - If highlights are not present:
  //     - Full Access -> ALL
  //     - Partial Access -> MY PHOTOS
  useEffect(() => {
    if (!isLoading && !hasSetLandingTabRef.current) {
      hasSetLandingTabRef.current = true;
      const hasHighlights =
        highlightsCount > 0 ||
        (tabCache['HIGHLIGHTS'] && tabCache['HIGHLIGHTS'].length > 0) ||
        allPhotos.some((p: any) => p.tabName && p.tabName.trim().toUpperCase() === 'HIGHLIGHTS');

      if (hasHighlights) {
        setActiveTab('HIGHLIGHTS');
      } else if (hasFullAccess) {
        setActiveTab('ALL');
      } else {
        const targetTab = availableTabs.includes('MY PHOTOS') ? 'MY PHOTOS' : (availableTabs[0] || 'HIGHLIGHTS');
        setActiveTab(targetTab);
      }
    }
  }, [isLoading, hasFullAccess, highlightsCount, availableTabs, tabCache, allPhotos]);

  // Sanitize activeTab: Ensure partial access users never stay on 'ALL' if it's not in availableTabs
  useEffect(() => {
    if (!isLoading && availableTabs.length > 0 && !availableTabs.map(t => t.toUpperCase()).includes(activeTab.toUpperCase())) {
      const fallbackTab = availableTabs.includes('HIGHLIGHTS') ? 'HIGHLIGHTS' : availableTabs[0];
      setActiveTab(fallbackTab);
    }
  }, [isLoading, availableTabs, activeTab]);

  // Screen Capture Protection:
  //   - Calls onScreenProtectionChange so _layout.tsx applies it to the main UIWindow (iOS)
  //   - Also calls preventScreenCaptureAsync directly here (Android FLAG_SECURE, same Activity)
  useEffect(() => {
    if (isLoading || !eventDetails) return;

    const allowPhotoDownloads = eventDetails?.allowDownloads ?? true;
    const allowBulkDownloads = eventDetails?.allowBulkDownloads ?? false;
    const shouldPrevent = !allowPhotoDownloads || !allowBulkDownloads;

    console.log(`[MYCIRCLE SECURITY 🛡️] PhotoDownloads: ${allowPhotoDownloads} | BulkDownloads: ${allowBulkDownloads} | PreventCapture: ${shouldPrevent}`);

    // Notify root layout (covers iOS main UIWindow)
    onScreenProtectionChange?.(shouldPrevent);

    // Also call directly (covers Android FLAG_SECURE on Activity window)
    if (shouldPrevent) {
      preventScreenCaptureAsync('gallery_protection');
    } else {
      allowScreenCaptureAsync('gallery_protection');
    }

    // Screen capture protection active — silent black screen on capture
  }, [isLoading, eventDetails, eventDetails?.allowDownloads, eventDetails?.allowBulkDownloads, onScreenProtectionChange]);

  // On unmount: release protection everywhere
  useEffect(() => {
    return () => {
      onScreenProtectionChange?.(false);
      allowScreenCaptureAsync('gallery_protection');
    };
  }, []);

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
      // 1. All photos + published videos
      // 2. Any published cinema videos from activeCinemaVideos
      // 3. ZERO coming soon video posters anywhere outside of Cinema!
      // 4. Strict deduplication by ID so nothing is ever shown double
      const combined: Photo[] = [];
      const seenIds = new Set<number | string>();

      allPhotos.forEach((p: any) => {
        if (isVideoComingSoon(p)) return;
        const idKey = p.id ?? p.r2Url;
        if (idKey !== undefined && idKey !== null && !seenIds.has(idKey)) {
          seenIds.add(idKey);
          combined.push(p);
        }
      });

      (activeCinemaVideos || []).forEach((v: any) => {
        if (isVideoComingSoon(v) || !hasActualVideoFile(v)) return;
        const idKey = v.id ?? v.r2Url;
        if (idKey !== undefined && idKey !== null && !seenIds.has(idKey)) {
          seenIds.add(idKey);
          combined.push(v);
        }
      });

      sourceList = combined;
    } else if (currentUpper === 'HIGHLIGHTS') {
      // In HIGHLIGHTS:
      // 1. Base highlight photos
      // 2. Published videos of Director's Cut, Reels, and Performances (not Full Film)
      // 3. ZERO coming soon video posters outside of Cinema!
      // 4. Strict deduplication by ID
      const baseHighlights = (tabCache['HIGHLIGHTS'] && tabCache['HIGHLIGHTS'].length > 0)
        ? tabCache['HIGHLIGHTS']
        : allPhotos.filter((p: any) => p.tabName && p.tabName.trim().toUpperCase() === 'HIGHLIGHTS');

      const eligiblePublishedVideos = (activeCinemaVideos || []).filter(isHighlightsEligibleCinemaVideo);

      const combined: Photo[] = [];
      const seenIds = new Set<number | string>();

      // Feature eligible published cinema videos (Director's Cut, Reels, Performances)
      eligiblePublishedVideos.forEach((v: any) => {
        const idKey = v.id ?? v.r2Url;
        if (idKey !== undefined && idKey !== null && !seenIds.has(idKey)) {
          seenIds.add(idKey);
          combined.push(v);
        }
      });

      // Add highlight photos (strictly excluding coming soon posters or videos)
      baseHighlights.forEach((p: any) => {
        if (isVideoComingSoon(p)) return;
        const idKey = p.id ?? p.r2Url;
        if (idKey !== undefined && idKey !== null && !seenIds.has(idKey)) {
          seenIds.add(idKey);
          combined.push(p);
        }
      });

      sourceList = combined;
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
          // Queue silent background download for cinema videos with category priority
          if (isCinema) {
            const priority = getCinemaDownloadPriority(vid, idx);
            videoDownloadManager.queue(vUrl, priority);
          }
        }
      });
    }
  }, [activeCinemaVideos, isCinema]);

  const downloadCurrentTabPhotos = useCallback(async () => {
    const listToDownload = activeListRef.current || [];
    if (!listToDownload || listToDownload.length === 0 || isBatchDownloading) return;

    try {
      console.log(`[BATCH DOWNLOAD 🚀] Starting batch download of ${listToDownload.length} photos...`);

      let hasPermission = false;
      try {
        const perm = await MediaLibrary.requestPermissionsAsync();
        hasPermission = perm.status === 'granted' || perm.granted === true;
      } catch (pErr) {
        console.error('[BATCH DOWNLOAD ❌] Permission error:', pErr);
      }

      if (!hasPermission) {
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
  }, [isBatchDownloading]);

  // Immediate full render limit: prevents staggered height jumps that trigger native scroll resets
  const renderLimit = Infinity;

  const isEndOfTabReached = useMemo(() => {
    if (renderLimit !== (Infinity as any) || isLoading || isTabLoading || !activeList || activeList.length === 0) {
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
      return activeList.length >= expectedCount;
    }

    // Fallback if tabCounts is not present: check tabHasMore state
    return tabHasMoreRef.current[norm] === false;
  }, [renderLimit, isLoading, isTabLoading, isLoadingMore, activeList, activeTab, hasMorePhotos, eventDetails?.tabCounts]);

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
    if (isVideoMedia(photoItem)) {
      setActiveVideoItem(photoItem);
      return;
    }
    setSelectedBounds(bounds);
    const idx = activeList.findIndex((p) => p.id === photoItem.id);
    setActiveImageIndex(idx !== -1 ? idx : (photoItem.globalIndex ?? 0));
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


  const displayData = useMemo(() => {
    if (activeList.length === 0 && (isLoading || isTabLoading)) {
      return Array.from({ length: 12 }, (_, i) => ({
        id: `sk-${i}`,
        isSkeleton: true,
        r2Url: '',
        uri: '',
        fullUri: '',
        photoUrl: '',
        width: 720,
        height: 960,
        aspectRatio: 0.75,
      }));
    }
    return activeList;
  }, [activeList, isLoading, isTabLoading]);

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
  const dateText = eventDetails?.date
    ? new Date(eventDetails.date).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
    : '';

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
    let activeTabCount: number | null = null;
    if (currentPhotoTab.toUpperCase().includes('LOCKED')) {
      activeTabCount = activeList.length;
    } else if (currentPhotoTab === 'MY PHOTOS') {
      activeTabCount = photos.length;
    } else if (currentPhotoTab === 'MY FAVOURITES') {
      activeTabCount = favoritesCount;
    } else if (currentPhotoTab === 'ALL') {
      const comingSoonCount = allPhotos.filter((p: any) => isVideoComingSoon(p)).length;
      activeTabCount = Math.max(0, (eventDetails?.tabCounts?.['ALL'] ?? (totalAllPhotosCount !== null ? totalAllPhotosCount : allPhotos.length)) - comingSoonCount);
    } else {
      const normKey = currentPhotoTab.trim().toUpperCase();
      activeTabCount = eventDetails?.tabCounts?.[normKey] ?? allPhotos.filter((p: any) => p.tabName && p.tabName.trim().toUpperCase() === normKey).length;
    }

    const allowBulkDownloads = eventDetails?.allowBulkDownloads ?? false;
    const isDownloadableTab = allowBulkDownloads && (
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
    activeList.length,
    photos.length,
    favoritesCount,
    eventDetails,
    totalAllPhotosCount,
    allPhotos,
    isBrideOrGroom,
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

  return (
    <Modal
      visible={!!eventSlug}
      animationType="none"
      transparent={true}
      presentationStyle="overFullScreen"
      onRequestClose={handleBackAction}
      statusBarTranslucent={true}
    >
      <GestureHandlerRootView style={styles.container}>
        <GestureDetector gesture={edgeSwipeGesture}>
          <Animated.View style={[{ flex: 1, backgroundColor: '#ffffff' }, screenSwipeAnimatedStyle]}>
            <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

            {/* ── Base Layer: Photos Gallery View (Remains mounted underneath Cinema) ── */}
            <View style={StyleSheet.absoluteFillObject} pointerEvents={isCinema ? 'none' : 'auto'}>
              <MasonryFlashList
                mainScrollRef={mainScrollRef}
                data={displayData as any}
                numColumns={galleryColumns}
                onNumColumnsChange={handleGalleryColumnsChange}
                enablePinchToZoom={!isCinema && activeImageIndex === null && activeVideoItem === null && !isMoreDrawerOpen}
                minColumns={1}
                maxColumns={5}
                onScroll={scrollHandler}
                scrollSharedValue={scrollY}
                onEndReached={loadMorePhotos}
                onEndReachedThreshold={0.6}
                renderHeroCover={renderHeroCover}
                renderStickyHeader={renderStickyHeader}
                ListFooterComponent={renderFooter()}
                refreshControl={
                  <RefreshControl
                    refreshing={isRefreshingGallery}
                    onRefresh={handleRefreshGallery}
                    tintColor="#ffffff"
                  />
                }
                renderItem={({ item, index, isColumn0, columnIndex, numColumns }) => (
                  item.isSkeleton ? (
                    <View style={[styles.masonryCard, styles.skeletonCard, { width: '100%', height: '100%' }]} />
                  ) : (
                    <MasonryCard
                      key={item.id ? String(item.id) : (item.r2Url || `photo-${index}`)}
                      img={item}
                      index={index}
                      isColumn0={isColumn0}
                      columnIndex={columnIndex}
                      numColumns={numColumns}
                      isHighPriority={index < Math.max(24, (numColumns || 2) * 12)}
                      onSelect={(bounds) => openLightbox(item, bounds)}
                      onRegisterRef={(id, ref) => {
                        const refId = item.id ? String(item.id) : (item.r2Url || `photo-${index}`);
                        if (id) cardRefs.current[id] = ref;
                        if (refId) cardRefs.current[refId] = ref;
                      }}
                      onToggleLike={handleToggleLike}
                    />
                  )
                )}
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
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  { backgroundColor: '#000000', zIndex: 5 },
                  photosDimAnimatedStyle,
                ]}
              />
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
                />
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
                const isLockedTab = tabName.toUpperCase().includes('LOCKED');
                let tabCount: number | null = null;

                if (isLockedTab) {
                  // LOCKED tab: count = number of locked photo IDs we know about
                  tabCount = lockedPhotoIds.size;
                } else if (tabName === 'MY PHOTOS') {
                  tabCount = Math.max(0, photos.length - photos.filter((p: any) => lockedPhotoIds.has(Number(p.id))).length);
                } else if (tabName === 'MY FAVOURITES') {
                  tabCount = Math.max(0, favoritesCount - [...allPhotos, ...photos].filter((p: any) => p.isLiked && lockedPhotoIds.has(Number(p.id))).length);
                } else if (tabName === 'ALL') {
                  const rawAll = eventDetails?.tabCounts?.['ALL'] ?? (totalAllPhotosCount !== null ? totalAllPhotosCount : allPhotos.length);
                  tabCount = Math.max(0, rawAll - lockedPhotoIds.size);
                } else {
                  const normKey = tabName.trim().toUpperCase();
                  const rawCount = eventDetails?.tabCounts?.[normKey] ?? allPhotos.filter((p: any) => p.tabName && p.tabName.trim().toUpperCase() === normKey).length;
                  const lockedInTab = allPhotos.filter((p: any) => p.tabName && p.tabName.trim().toUpperCase() === normKey && lockedPhotoIds.has(Number(p.id))).length;
                  tabCount = Math.max(0, rawCount - lockedInTab);
                }

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
          let activeTabTotalCount: number | undefined = undefined;
          if (activeTab.toUpperCase().includes('LOCKED')) {
            activeTabTotalCount = activeList.length;
          } else if (activeTab === 'MY PHOTOS') {
            activeTabTotalCount = photos.length;
          } else if (activeTab === 'MY FAVOURITES') {
            activeTabTotalCount = favoritesCount;
          } else if (activeTab === 'ALL') {
            activeTabTotalCount = eventDetails?.tabCounts?.['ALL'] ?? (totalAllPhotosCount !== null ? totalAllPhotosCount : allPhotos.length);
          } else {
            const normKey = activeTab.trim().toUpperCase();
            activeTabTotalCount = eventDetails?.tabCounts?.[normKey] ?? allPhotos.filter((p: any) => p.tabName && p.tabName.trim().toUpperCase() === normKey).length;
          }
          if (!activeTabTotalCount || activeTabTotalCount <= 0) {
            activeTabTotalCount = activeList.length;
          }

          return (
            <EditorialLightbox
              visible={activeImageIndex !== null}
              images={activeList}
              initialIndex={activeImageIndex}
              initialBounds={selectedBounds}
              onGetBoundsForIndex={getBoundsForIndex}
              onToggleLike={handleToggleLike}
              likeTargetName="My Favourites"
              enableDownload={eventDetails?.allowDownloads ?? true}
              totalCount={activeTabTotalCount}
              enableDelete={isBrideOrGroom}
              onDeletePhoto={handleDeletePhoto}
              enableLock={isBrideOrGroom}
              onToggleLockPhoto={handleToggleLockPhoto}
              onClose={() => {
                setActiveImageIndex(null);
                setSelectedBounds(null);
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
          onClose={() => setActiveVideoItem(null)}
          eventTitle={cleanTitle}
          allowDownloads={eventDetails?.allowDownloads ?? true}
        />
    </GestureHandlerRootView>
  </Modal>
  );
});

const styles = StyleSheet.create({
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
    backgroundColor: '#ffffff',
    opacity: 1,
  },
  emptyContainer: {
    paddingVertical: 60,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 14,
    lineHeight: 24,
    color: '#8c867e',
    textAlign: 'center',
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
});

export default GalleryView;
