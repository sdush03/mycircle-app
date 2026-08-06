import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
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
import { MasonryFlashList } from '../common/MasonryFlashList';
import { getPhotoAspect } from '../../utils/photoDimensionCache';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
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
} from 'react-native-reanimated';
import { usePathname } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useScrollTabBarCollapse } from '../../hooks/useScrollTabBarCollapse';
import api, { guestApi } from '../../services/api';
import { MasonryCard } from '../home/lightbox/components/MasonryCard';
import { EditorialLightbox, LightboxBounds } from '../home/lightbox/EditorialLightbox';
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
  [key: string]: any;
}

function mapPhotoItem(p: any): Photo {
  const thumbUri = p.thumbnailUrl || p.thumbnail_url || p.r2Url || p.r2_url || p.file_url_mobile || p.file_url || p.url || '';
  const fullUri = p.r2Url || p.r2_url || p.file_url || p.url || thumbUri;
  const w = Number(p.width) || Number(p.img_width) || Number(p.imageWidth) || Number(p.meta?.width) || Number(p.metadata?.width) || Number(p.exif?.PixelXDimension) || Number(p.exif?.ImageWidth) || 0;
  const h = Number(p.height) || Number(p.img_height) || Number(p.imageHeight) || Number(p.meta?.height) || Number(p.metadata?.height) || Number(p.exif?.PixelYDimension) || Number(p.exif?.ImageHeight) || 0;
  const cachedAspect = getPhotoAspect(p.id) || getPhotoAspect(thumbUri) || getPhotoAspect(fullUri);
  const aspectRatio = cachedAspect || (w > 0 && h > 0 ? w / h : (Number(p.aspectRatio) || Number(p.aspect_ratio) || null));
  return {
    id: p.id,
    r2Url: thumbUri,
    uri: thumbUri,
    fullUri: fullUri,
    photoUrl: fullUri,
    width: w || undefined,
    height: h || undefined,
    aspectRatio,
    blurhash: p.blurhash || p.blur_hash || p.blurHash || null,
    tabName: p.tabName || p.tab_name || null,
    isLiked: typeof p.isLiked === 'boolean' ? p.isLiked : !!(p.likes && p.likes.length > 0),
    likeCount: typeof p.likeCount === 'number' ? p.likeCount : (typeof p.likesCount === 'number' ? p.likesCount : (p._count?.likes || 0)),
  };
}

interface GalleryViewProps {
  onLogout: () => void;
  onChangeEvent: () => void;
}

const GalleryView = React.memo(function GalleryView({ onLogout, onChangeEvent }: GalleryViewProps) {
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [allPhotos, setAllPhotos] = useState<Photo[]>([]);
  const [totalAllPhotosCount, setTotalAllPhotosCount] = useState<number | null>(null);
  const [eventDetails, setEventDetailsData] = useState<any>(null);
  const [eventGuest, setEventGuest] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (!eventSlug) return 'ALL';
    const cached = useAuthStore.getState().getGalleryCache(eventSlug);
    if (cached && cached.hasFullAccess === false) {
      return 'HIGHLIGHTS';
    }
    return 'ALL';
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [allPhotosOffset, setAllPhotosOffset] = useState(0);
  const [hasMorePhotos, setHasMorePhotos] = useState(true);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isMoreDrawerOpen, setIsMoreDrawerOpen] = useState(false);
  const [isScrolledPastHero, setIsScrolledPastHero] = useState(false);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [batchDownloadProgress, setBatchDownloadProgress] = useState<{ current: number; total: number } | null>(null);



  // Lightbox State
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [selectedBounds, setSelectedBounds] = useState<LightboxBounds | null>(null);

  const PAGE_SIZE = 60;
  const mainScrollRef = useAnimatedRef<Animated.ScrollView>();
  const currentYRef = useRef<number>(0);
  const isTabSwitchingRef = useRef<boolean>(false);
  const cardRefs = useRef<{ [key: string]: View | null }>({});
  const eventHeadersRef = useRef<Record<string, string>>({});
  const allPhotosOffsetRef = useRef<number>(0);
  const tabOffsetsRef = useRef<Record<string, number>>({});
  const tabHasMoreRef = useRef<Record<string, boolean>>({});
  const eventSlug = useAuthStore((state) => state.eventSlug);
  const passcode = useAuthStore((state) => state.passcode);
  const profile = useAuthStore((state) => state.profile);
  const userEvents = useAuthStore((state) => state.userEvents);
  const eventCoverUrl = useAuthStore((state) => state.eventCoverUrl);
  const eventTitle = useAuthStore((state) => state.eventTitle);
  const handleScroll = useScrollTabBarCollapse();

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
    color: scrollY.value >= exactTouchPoint ? '#3a3632' : '#ffffff',
  }));

  const loadMorePhotosRef = useRef<(() => void) | null>(null);
  const prefetchedUrlsRef = useRef<Set<string>>(new Set());
  const activeListRef = useRef<Photo[]>([]);
  const prevTabRef = useRef<string | null>(null);
  const hasSetLandingTabRef = useRef<boolean>(false);

  const handleViewportScroll = useCallback((offsetY: number, layoutHeight: number, contentHeight: number) => {
    currentYRef.current = offsetY;

    const heroHeight = Math.round(screenHeight * 0.70);
    const relativeY = Math.max(0, offsetY - heroHeight);
    const newEnd = Math.max(0, Math.floor(relativeY / 220) * 2 - 4) + 20;

    // Viewport-Proximity Pre-fetch: pre-fetch the next 12 cards right below the user's screen
    const upcomingPhotos = activeListRef.current.slice(newEnd, newEnd + 12);
    upcomingPhotos.forEach((photo) => {
      const uri = photo.r2Url || photo.uri || photo.fullUri;
      if (uri && !prefetchedUrlsRef.current.has(uri)) {
        prefetchedUrlsRef.current.add(uri);
        Image.prefetch(uri);
      }
    });

    const isNearBottom = layoutHeight + offsetY >= contentHeight - 8000;
    if (isNearBottom && hasMorePhotos && !isFetchingMoreRef.current && loadMorePhotosRef.current) {
      loadMorePhotosRef.current();
    }
  }, [hasMorePhotos]);

  const isScrollingRef = useRef<boolean>(false);

  const handleScrollState = useCallback((isScrolling: boolean) => {
    isScrollingRef.current = isScrolling;
  }, []);

  const scrollHandler = useAnimatedScrollHandler({
    onBeginDrag: () => {
      'worklet';
      runOnJS(handleScrollState)(true);
    },
    onScroll: (event) => {
      'worklet';
      scrollY.value = event.contentOffset.y;
      runOnJS(handleViewportScroll)(
        event.contentOffset.y,
        event.layoutMeasurement.height,
        event.contentSize.height
      );
    },
    onEndDrag: () => {
      'worklet';
      runOnJS(handleScrollState)(false);
    },
    onMomentumEnd: () => {
      'worklet';
      runOnJS(handleScrollState)(false);
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
    isLightboxOpen.value = activeImageIndex !== null;
  }, [activeImageIndex]);

  useEffect(() => {
    if (eventSlug) {
      isClosingRef.current = false;
      screenSwipeX.value = width;
      screenSwipeX.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) });
    }
  }, [eventSlug]);

  const handleBackAction = useCallback(() => {
    if (activeImageIndex !== null) {
      setActiveImageIndex(null);
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
  }, [activeImageIndex, onChangeEvent, screenSwipeX]);

  // Native Android Back Button Listener
  useEffect(() => {
    const onBack = () => {
      handleBackAction();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => subscription.remove();
  }, [handleBackAction]);

  // Viewport-Proximity & Page Batch Pre-Fetch Engine: Prefetches upcoming 20 thumbnail photos into native image cache
  const scheduleBatchPrefetch = useCallback((mappedList: Photo[]) => {
    if (!mappedList || mappedList.length === 0) return;

    // Prefetch next 20 thumbnail photos (~3 screens ahead) without choking network connection sockets
    const chunk = mappedList.slice(0, 20);
    chunk.forEach((p) => {
      const targetUri = p.uri || p.r2Url || p.fullUri;
      if (targetUri && !prefetchedUrlsRef.current.has(targetUri)) {
        prefetchedUrlsRef.current.add(targetUri);
        Image.prefetch(targetUri);
      }
    });
  }, []);



  const screenSwipeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: screenSwipeX.value }],
  }));

  const fetchPhotos = async () => {
    try {
      if (!eventSlug) return;

      // 0. Check Stale-While-Revalidate (SWR) cache for 0ms instant gallery launch
      const cached = useAuthStore.getState().getGalleryCache(eventSlug);
      if (cached && cached.photos && cached.photos.length > 0) {
        setAllPhotos(cached.photos);
        allPhotosOffsetRef.current = cached.photos.length;
        setAllPhotosOffset(cached.photos.length);
        if (cached.details) setEventDetailsData(cached.details);
        if (cached.total !== undefined) setTotalAllPhotosCount(cached.total);
        if (cached.matched) setPhotos(cached.matched);
        if (cached.headers) eventHeadersRef.current = cached.headers;
        if (typeof cached.hasFullAccess === 'boolean') setGuestAccessLevel(cached.hasFullAccess);
        if (cached.tabCache) setTabCache(cached.tabCache);
        setIsLoading(false); // 0ms INSTANT OPEN ON FRAME 1!
      } else {
        setIsLoading(true);
        setAllPhotos([]);
        setAllPhotosOffset(0);
        setHasMorePhotos(true);
        setTotalAllPhotosCount(null);
      }

      // Fetch event metadata for cover screen
      try {
        const eventRes = await api.get(`/api/gallery/public/events/${eventSlug}`);
        if (eventRes.data) {
          setEventDetailsData(eventRes.data);
          const c = eventRes.data.coverUrl || eventRes.data.cover_url || eventRes.data.bannerUrl;
          if (c) Image.prefetch(c);
        }
      } catch (e: any) {
        if (e?.response?.status === 404) {
          onChangeEvent();
          return;
        }
        console.warn('Failed to fetch event details:', e);
      }

      const familyToken = useAuthStore.getState().token;
      const currentPasscode = useAuthStore.getState().passcode;

      // 1. SSO Token Exchange: Obtain event guest token for this celebration
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
        } else if (familyToken) {
          eventHeadersRef.current = { Authorization: `Bearer ${familyToken}` };
        }
      } catch (e: any) {
        if (e?.response?.status === 404) {
          onChangeEvent();
          return;
        }
        const errDetail = e?.response?.data?.error || (typeof e?.response?.data === 'string' ? e?.response?.data : JSON.stringify(e?.response?.data)) || e?.message;
        console.warn('SSO token exchange failed:', errDetail);
        if (familyToken) {
          eventHeadersRef.current = { Authorization: `Bearer ${familyToken}` };
        }
      }

      const eventHeaders = eventHeadersRef.current;



      allPhotosOffsetRef.current = 0;

      // 2. Fetch matched photos, favorites & first page of all photos IN PARALLEL using Promise.all
      try {
        const fetchStartTime = Date.now();
        console.log(`[MYCIRCLE DEBUG 🚀] Starting parallel photo fetch for event '${eventSlug}'...`);
        const [matchedRes, allRes, favRes] = await Promise.all([
          guestApi.get(`/api/gallery/public/events/${eventSlug}/matched-photos`, { headers: eventHeaders }).catch((e) => {
            console.warn('[MYCIRCLE DEBUG ⚠️] Matched photos fetch error:', e?.response?.status);
            return { data: [] };
          }),
          guestApi.get(`/api/gallery/public/events/${eventSlug}/photos?limit=${PAGE_SIZE}&offset=0`, { headers: eventHeaders }).catch((e) => {
            console.warn('[MYCIRCLE DEBUG ⚠️] All photos fetch error:', e?.response?.status);
            return { data: [] };
          }),
          guestApi.get(`/api/gallery/public/events/${eventSlug}/favorites`, { headers: eventHeaders }).catch((e) => {
            console.warn('[MYCIRCLE DEBUG ⚠️] Favorites fetch error:', e?.response?.status);
            return { data: [] };
          }),
        ]);

        const fetchDuration = Date.now() - fetchStartTime;
        const matchedList = matchedRes.data.photos || matchedRes.data.matchedPhotos || (Array.isArray(matchedRes.data) ? matchedRes.data : []);
        setPhotos(Array.isArray(matchedList) ? matchedList.map(mapPhotoItem) : []);

        const favList = favRes.data.photos || (Array.isArray(favRes.data) ? favRes.data : []);
        if (Array.isArray(favList) && favList.length > 0) {
          const favMapped = favList.map(mapPhotoItem);
          setTabCache((prev) => ({ ...prev, 'MY FAVOURITES': favMapped }));
        }

        const allList = allRes.data.photos || (Array.isArray(allRes.data) ? allRes.data : []);
        const mapped = Array.isArray(allList) ? allList.map(mapPhotoItem) : [];
        const total = typeof allRes.data.total === 'number' ? allRes.data.total : mapped.length;
        setTotalAllPhotosCount(total);
        setAllPhotos((prev) => {
          if (prev.length > 0 && prev.length === mapped.length && prev[0]?.id === mapped[0]?.id && prev[prev.length - 1]?.id === mapped[mapped.length - 1]?.id) {
            return prev; // Keep exact reference! ZERO re-render flicker!
          }
          return mapped;
        });
        allPhotosOffsetRef.current = mapped.length;
        setAllPhotosOffset(mapped.length);
        const hasMore = mapped.length < total;
        setHasMorePhotos(hasMore);

        useAuthStore.getState().setGalleryCache(eventSlug, {
          details: eventDetails || undefined,
          photos: mapped,
          headers: eventHeaders,
          total: total,
          hasFullAccess: guestAccessLevel ?? true,
          matched: Array.isArray(matchedList) ? matchedList.map(mapPhotoItem) : [],
        });

        console.log(`[MYCIRCLE DEBUG ✅] Initial Fetch Done in ${fetchDuration}ms | Loaded: ${mapped.length} / ${total} photos | HasMore: ${hasMore}`);

        // Smooth chunked background prefetch of initial batch into native image cache
        scheduleBatchPrefetch(mapped);

        if (hasMore) {
          setTimeout(() => {
            loadMorePhotos();
          }, 100);
        }
      } catch (e: any) {
        console.warn('[MYCIRCLE DEBUG ⚠️] Parallel photo fetch error:', e);
      }
    } catch (err) {
      console.warn('[MYCIRCLE DEBUG ⚠️] Failed to fetch gallery photos', err);
    } finally {
      setIsLoading(false);
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
      const loadMoreStartTime = Date.now();
      console.log(`[MYCIRCLE DEBUG 📥] Pre-fetching next page for '${normTab}' -> offset=${currentOffset}, limit=${PAGE_SIZE}...`);

      const allRes = await guestApi.get(
        `/api/gallery/public/events/${eventSlug}/photos?limit=${PAGE_SIZE}&offset=${currentOffset}${tabQuery}`,
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

  const [guestAccessLevel, setGuestAccessLevel] = useState<boolean | null>(() => {
    if (!eventSlug) return null;
    const cached = useAuthStore.getState().getGalleryCache(eventSlug);
    if (cached && typeof cached.hasFullAccess === 'boolean') {
      return cached.hasFullAccess;
    }
    return null;
  });
  const hasFullAccess = guestAccessLevel ?? (profile?.hasFullAccess ?? false);

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
  const [tabCache, setTabCache] = useState<Record<string, Photo[]>>({});
  const [isTabLoading, setIsTabLoading] = useState(false);

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
      const eventHeaders = eventHeadersRef.current;
      const res = await guestApi.get(
        `/api/gallery/public/events/${eventSlug}/photos?limit=60&tab=${encodeURIComponent(tabName)}`,
        { headers: eventHeaders }
      );
      const rawList = res.data.photos || (Array.isArray(res.data) ? res.data : []);
      const mapPhotoItem = (p: any): Photo => {
        const thumbUri = p.thumbnailUrl || p.thumbnail_url || p.r2Url || p.r2_url || p.file_url_mobile || p.file_url || p.url || '';
        const fullUri = p.r2Url || p.r2_url || p.file_url || p.url || thumbUri;
        const w = Number(p.width) || Number(p.img_width) || Number(p.imageWidth) || Number(p.meta?.width) || Number(p.metadata?.width) || Number(p.exif?.PixelXDimension) || Number(p.exif?.ImageWidth) || 0;
        const h = Number(p.height) || Number(p.img_height) || Number(p.imageHeight) || Number(p.meta?.height) || Number(p.metadata?.height) || Number(p.exif?.PixelYDimension) || Number(p.exif?.ImageHeight) || 0;
        const aspectRatio = w > 0 && h > 0 ? w / h : (Number(p.aspectRatio) || Number(p.aspect_ratio) || null);
        return {
          id: p.id,
          r2Url: thumbUri,
          uri: thumbUri,
          fullUri: fullUri,
          photoUrl: fullUri,
          width: w || undefined,
          height: h || undefined,
          aspectRatio,
          tabName: p.tabName || p.tab_name || null,
          isLiked: typeof p.isLiked === 'boolean' ? p.isLiked : !!(p.likes && p.likes.length > 0),
          likeCount: typeof p.likeCount === 'number' ? p.likeCount : (typeof p.likesCount === 'number' ? p.likesCount : (p._count?.likes || 0)),
        };
      };
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

    ceremonyTabsSet.forEach((tab) => {
      if (tab !== 'ALL' && tab !== 'MY PHOTOS' && tab !== 'MY FAVOURITES') {
        if (hasFullAccess || tab === 'HIGHLIGHTS') {
          if (!list.includes(tab)) {
            list.push(tab);
          }
        }
      }
    });

    return list;
  }, [hasFullAccess, favoritesCount, eventDetails?.tabs, allPhotos]);

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

    // 2. Save exact scroll position of the tab we are leaving
    tabOffsetsRef.current[currentNorm] = currentYRef.current;

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

  // Per-tab scroll restoration effect: triggers ONLY when activeTab changes
  useEffect(() => {
    if (isLoading || isTabLoading) return;

    if (prevTabRef.current !== activeTab) {
      prevTabRef.current = activeTab;

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
      Haptics.selectionAsync().catch(() => {});
    }
  }, [availableTabs, changeTabWithScrollMemory]);

  const handlePrevCategoryTab = useCallback(() => {
    const currentIdx = activeCategorySharedIndex.value;
    if (currentIdx > 0) {
      const prevTab = availableTabs[currentIdx - 1];
      changeTabWithScrollMemory(prevTab, true);
      Haptics.selectionAsync().catch(() => {});
    }
  }, [availableTabs, changeTabWithScrollMemory]);

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
        screenSwipeX.value = e.translationX;
      }
    })
    .onEnd((e) => {
      'worklet';
      if (isLightboxOpen.value) return;

      if (touchStartedOnLeftEdge.value) {
        if (e.translationX > width * 0.20 || e.velocityX > 250) {
          screenSwipeX.value = withTiming(width, { duration: 220, easing: Easing.out(Easing.quad) }, (finished) => {
            if (finished) {
              runOnJS(onChangeEvent)();
            }
          });
        } else {
          screenSwipeX.value = withSpring(0, { damping: 25, stiffness: 200 });
        }
        touchStartedOnLeftEdge.value = false;
      }
    });



  // Exact Landing Tab Rules:
  // - Full Access: Lands on ALL
  // - Partial Access: If highlights.count > 0 -> HIGHLIGHTS, else -> MY PHOTOS
  useEffect(() => {
    if (!hasSetLandingTabRef.current) {
      if (hasFullAccess === false) {
        hasSetLandingTabRef.current = true;
        const targetTab = highlightsCount > 0 ? 'HIGHLIGHTS' : 'MY PHOTOS';
        setActiveTab(targetTab);
      } else if (hasFullAccess === true) {
        hasSetLandingTabRef.current = true;
        setActiveTab('ALL');
      }
    }
  }, [hasFullAccess, highlightsCount]);

  // Sanitize activeTab: Ensure partial access users never stay on 'ALL' if it's not in availableTabs
  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.map(t => t.toUpperCase()).includes(activeTab.toUpperCase())) {
      const fallbackTab = availableTabs.includes('HIGHLIGHTS') ? 'HIGHLIGHTS' : availableTabs[0];
      setActiveTab(fallbackTab);
    }
  }, [availableTabs, activeTab]);

  const activeList = React.useMemo(() => {
    const currentUpper = activeTab.toUpperCase();
    if (currentUpper === 'MY PHOTOS') {
      return photos;
    }
    if (currentUpper === 'MY FAVOURITES') {
      if (tabCache['MY FAVOURITES']) {
        return tabCache['MY FAVOURITES'];
      }
      const combined: Photo[] = [];
      const seenIds = new Set<number>();
      [...allPhotos, ...photos, ...Object.values(tabCache).flat()].forEach((p) => {
        if (p.isLiked && !seenIds.has(p.id)) {
          seenIds.add(p.id);
          combined.push(p);
        }
      });
      return combined;
    }
    if (currentUpper === 'ALL') {
      return allPhotos;
    }
    if (tabCache[currentUpper] && tabCache[currentUpper].length > 0) {
      return tabCache[currentUpper];
    }
    return allPhotos.filter((p: any) => {
      if (!p.tabName) return false;
      return p.tabName.trim().toUpperCase() === currentUpper;
    });
  }, [activeTab, photos, allPhotos, tabCache]);

  activeListRef.current = activeList;

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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

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

  // Pre-fetch top 12 images (both left & right columns) into native cache for 100% simultaneous 0ms paint
  useEffect(() => {
    if (!activeList || activeList.length === 0) return;
    const topItems = activeList.slice(0, 12);
    topItems.forEach((photo: any) => {
      const uri = photo.r2Url || photo.uri || photo.fullUri;
      if (uri) Image.prefetch(uri);
    });
  }, [activeTab, activeList]);

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
    setSelectedBounds(bounds);
    const idx = activeList.findIndex((p) => p.id === photoItem.id);
    setActiveImageIndex(idx !== -1 ? idx : (photoItem.globalIndex ?? 0));
  };

  const handleToggleLike = async (item: any) => {
    if (!item || !eventSlug) return;
    const photoId = item.id;
    const currentlyLiked = !!item.isLiked;
    const nextLiked = !currentlyLiked;

    try {
      if (nextLiked) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {}

    // Optimistically update allPhotos, photos, and tabCache state in GalleryView
    setAllPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, isLiked: nextLiked } : p))
    );
    setPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, isLiked: nextLiked } : p))
    );
    setTabCache((prev) => {
      const updatedCache: typeof prev = {};
      for (const key of Object.keys(prev)) {
        updatedCache[key] = prev[key].map((p) =>
          p.id === photoId ? { ...p, isLiked: nextLiked } : p
        );
      }
      // Update 'MY FAVOURITES' tab list specifically
      const currentFavs = updatedCache['MY FAVOURITES'] || [];
      if (nextLiked) {
        if (!currentFavs.some((p) => p.id === photoId)) {
          const newItem = { ...item, isLiked: true };
          updatedCache['MY FAVOURITES'] = [newItem, ...currentFavs];
        }
      } else {
        updatedCache['MY FAVOURITES'] = currentFavs.filter((p) => p.id !== photoId);
      }
      return updatedCache;
    });

    try {
      const headers = eventHeadersRef.current;
      const res = await api.post(
        `/api/gallery/public/events/${eventSlug}/photos/${photoId}/like`,
        {},
        { headers }
      );
      if (res.data && typeof res.data.liked === 'boolean') {
        const serverLiked = res.data.liked;
        setAllPhotos((prev) =>
          prev.map((p) => (p.id === photoId ? { ...p, isLiked: serverLiked } : p))
        );
        setPhotos((prev) =>
          prev.map((p) => (p.id === photoId ? { ...p, isLiked: serverLiked } : p))
        );
      }
    } catch (err) {
      console.warn('Failed to toggle photo like:', err);
      setAllPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, isLiked: currentlyLiked } : p))
      );
      setPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, isLiked: currentlyLiked } : p))
      );
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

  const { column0, column1 } = useMemo(() => {
    const col0: { item: any; originalIndex: number }[] = [];
    const col1: { item: any; originalIndex: number }[] = [];
    displayData.forEach((item: any, idx: number) => {
      if (idx % 2 === 0) col0.push({ item, originalIndex: idx });
      else col1.push({ item, originalIndex: idx });
    });
    return { column0: col0, column1: col1 };
  }, [displayData]);

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

  const cleanTitle = (eventTitle || eventDetails?.title || eventSlug || 'WEDDING CELEBRATION')
    .replace(/'s\s+Wedding/gi, '')
    .replace('&', '·')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  const locationText = (eventDetails?.location || eventDetails?.city || '').toUpperCase();
  const dateText = eventDetails?.date
    ? new Date(eventDetails.date).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
    : '';

  const renderHeroCover = useCallback(() => {
    return (
      <View style={styles.heroContainer}>
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={styles.heroImage}
            contentFit="cover"
            priority="high"
            cachePolicy="memory-disk"
            transition={200}
          />
        ) : (
          <View style={[styles.heroImage, { backgroundColor: '#1c1a18', justifyContent: 'center', alignItems: 'center' }]}>
            <ActivityIndicator size="small" color="#ffffff" />
          </View>
        )}

        {/* White Brand Logo on Cover */}
        <View style={[styles.coverHeaderLogoContainer, { top: insets.top + 6 }]} pointerEvents="none">
          <RNImage
            source={require('../../../assets/images/logo-white.png')}
            style={styles.coverHeaderLogo}
            resizeMode="contain"
          />
        </View>

        {/* Vignette Gradient Overlay */}
        <LinearGradient
          colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.1)', 'rgba(0,0,0,0.75)']}
          locations={[0, 0.45, 1]}
          style={styles.heroOverlay}
        />

        {/* Cover Title Container */}
        <View style={[styles.titleContainer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          {locationText ? <Text style={styles.storyLocation}>{locationText}</Text> : null}
          <Text style={styles.storyTitle}>{cleanTitle}</Text>
          {dateText ? <Text style={styles.storyDate}>{dateText}</Text> : null}
        </View>
      </View>
    );
  }, [coverUrl, cleanTitle, locationText, dateText, insets]);

  const renderStickyHeader = useCallback(() => {
    let activeTabCount: number | null = null;
    if (activeTab === 'MY PHOTOS') {
      activeTabCount = photos.length;
    } else if (activeTab === 'MY FAVOURITES') {
      activeTabCount = favoritesCount;
    } else if (activeTab === 'ALL') {
      activeTabCount = eventDetails?.tabCounts?.['ALL'] ?? (totalAllPhotosCount !== null ? totalAllPhotosCount : allPhotos.length);
    } else {
      const normKey = activeTab.trim().toUpperCase();
      activeTabCount = eventDetails?.tabCounts?.[normKey] ?? allPhotos.filter((p: any) => p.tabName && p.tabName.trim().toUpperCase() === normKey).length;
    }

    return (
      <View style={[styles.stickyHeaderContainer, { paddingTop: Math.max(insets.top + 4, 28), backgroundColor: '#ffffff' }]}>
        <View style={styles.stickyHeaderContainerInner}>
          <TouchableOpacity
            activeOpacity={0.7}
            delayPressIn={60}
            onPress={() => {
              if (isScrollingRef.current) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              openDrawerWithAnimation();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.compactTabHeaderBarCentered}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Text style={styles.compactTabActiveTitleCentered} numberOfLines={1}>
                {activeTab} {activeTabCount !== null ? `(${activeTabCount})` : ''}
              </Text>
              <Text style={styles.downArrowIcon}>▾</Text>
            </View>
          </TouchableOpacity>

          {/* Right Corner Download Button (ALL tabs strictly for BRIDE or GROOM; MY PHOTOS & MY FAVOURITES for all other guests) */}
          {(() => {
            const isDownloadableTab = isBrideOrGroom || (
              activeTab.trim().toUpperCase().includes('MY PHOTO') ||
              activeTab.trim().toUpperCase().includes('MY FAVOURITES') ||
              activeTab.trim().toUpperCase().includes('MY FAVORITE')
            );
            if (!isDownloadableTab) return null;
            return (
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
            );
          })()}
        </View>
      </View>
    );
  }, [activeTab, photos.length, favoritesCount, eventDetails, totalAllPhotosCount, allPhotos, isBatchDownloading, batchDownloadProgress, downloadCurrentTabPhotos, openDrawerWithAnimation, insets, isBrideOrGroom]);

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

          {/* Borderless Editorial Back Button (Exact Featured Story Style) */}
          <Pressable
            style={[styles.editorialBackButton, { top: Math.max(insets.top + 10, 42) }]}
            onPress={handleBackAction}
            hitSlop={16}
          >
            <Animated.Text style={[styles.editorialBackText, animatedBackTextStyle]}>← BACK</Animated.Text>
          </Pressable>

          <MasonryFlashList
            mainScrollRef={mainScrollRef}
            data={displayData as any}
            numColumns={2}
            onScroll={scrollHandler}
            scrollSharedValue={scrollY}
            onEndReached={loadMorePhotos}
            onEndReachedThreshold={0.6}
            renderHeroCover={renderHeroCover}
            renderStickyHeader={renderStickyHeader}
            ListFooterComponent={renderFooter()}
            renderItem={({ item, index, isColumn0 }) => (
              item.isSkeleton ? (
                <View style={[styles.masonryCard, styles.skeletonCard, { width: '100%', height: '100%' }]} />
              ) : (
                <MasonryCard
                  img={item}
                  index={index}
                  isColumn0={isColumn0}
                  isHighPriority={index < 12}
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

          {/* ── Floating Editorial Back to Top Button with Slow Smooth Fade-In ── */}
          <Animated.View
            style={[
              styles.backToTopContainer,
              { bottom: Math.max(insets.bottom + 20, 30) },
              backToTopAnimatedStyle,
            ]}
            pointerEvents={isPast60Photos ? 'auto' : 'none'}
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
                let tabCount: number | null = null;
                if (tabName === 'MY PHOTOS') {
                  tabCount = photos.length;
                } else if (tabName === 'MY FAVOURITES') {
                  tabCount = favoritesCount;
                } else if (tabName === 'ALL') {
                  tabCount = eventDetails?.tabCounts?.['ALL'] ?? (totalAllPhotosCount !== null ? totalAllPhotosCount : allPhotos.length);
                } else {
                  const normKey = tabName.trim().toUpperCase();
                  tabCount = eventDetails?.tabCounts?.[normKey] ?? allPhotos.filter((p: any) => p.tabName && p.tabName.trim().toUpperCase() === normKey).length;
                }

                return (
                  <TouchableOpacity
                    key={`drawer-tab-${tabName}-${tabIdx}`}
                    delayPressIn={60}
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
      {activeImageIndex !== null && (
        <EditorialLightbox
          visible={activeImageIndex !== null}
          images={activeList}
          initialIndex={activeImageIndex}
          initialBounds={selectedBounds}
          onGetBoundsForIndex={getBoundsForIndex}
          onToggleLike={handleToggleLike}
          likeTargetName="My Favourites"
          enableDownload={true}
          onClose={() => {
            setActiveImageIndex(null);
            setSelectedBounds(null);
          }}
          title={cleanTitle}
          subtitle={activeTab.toUpperCase()}
        />
      )}
    </GestureHandlerRootView>
  </Modal>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  editorialBackButton: {
    position: 'absolute',
    left: 24,
    zIndex: 100,
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
});

export default GalleryView;
