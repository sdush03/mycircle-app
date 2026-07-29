import React, { useEffect, useState, useRef, useCallback } from 'react';
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
  Image as RNImage,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedRef, useDerivedValue, scrollTo, withTiming, withSpring, runOnJS, Easing } from 'react-native-reanimated';
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
  isLiked?: boolean;
  likeCount?: number;
  [key: string]: any;
}

interface GalleryViewProps {
  onLogout: () => void;
  onChangeEvent: () => void;
}

export default function GalleryView({ onLogout, onChangeEvent }: GalleryViewProps) {
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [allPhotos, setAllPhotos] = useState<Photo[]>([]);
  const [totalAllPhotosCount, setTotalAllPhotosCount] = useState<number | null>(null);
  const [eventDetails, setEventDetailsData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [renderLimit, setRenderLimit] = useState<number>(40);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [allPhotosOffset, setAllPhotosOffset] = useState(0);
  const [hasMorePhotos, setHasMorePhotos] = useState(true);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Lightbox State
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [selectedBounds, setSelectedBounds] = useState<LightboxBounds | null>(null);

  const PAGE_SIZE = 60;
  const mainScrollRef = useAnimatedRef<Animated.ScrollView>();
  const currentYRef = useRef<number>(0);
  const cardRefs = useRef<{ [key: string]: View | null }>({});
  const eventHeadersRef = useRef<Record<string, string>>({});
  const allPhotosOffsetRef = useRef<number>(0);
  const tabOffsetsRef = useRef<Record<string, number>>({});
  const isFetchingMoreRef = useRef<boolean>(false);
  const lastScrollYRef = useRef<number>(0);
  const btnStateRef = useRef<'hidden' | 'dim' | 'bright'>('hidden');

  const screenSwipeX = useSharedValue(0);
  const touchStartedOnLeftEdge = useSharedValue(false);
  const isLightboxOpen = useSharedValue(false);
  const backToTopOpacity = useSharedValue(0);
  const scrollTargetY = useSharedValue(0);
  const isSmoothScrollingToTop = useSharedValue(false);
  const [isPast60Photos, setIsPast60Photos] = useState(false);

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

  // Opening entrance animation: slide in from right on mount
  useEffect(() => {
    screenSwipeX.value = width;
    screenSwipeX.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) });
  }, []);

  const handleBackAction = useCallback(() => {
    if (activeImageIndex !== null) {
      setActiveImageIndex(null);
      return;
    }
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

  // Left-Edge Pan Swipe Back Gesture (matching FeaturedStoryView)
  const edgeSwipeGesture = Gesture.Pan()
    .activeOffsetX(12)
    .failOffsetY([-25, 25])
    .onBegin((e) => {
      'worklet';
      touchStartedOnLeftEdge.value = e.x <= 40 && !isLightboxOpen.value;
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
      if (!touchStartedOnLeftEdge.value) return;
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
    });

  const screenSwipeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: screenSwipeX.value }],
  }));

  const eventSlug = useAuthStore((state) => state.eventSlug);
  const passcode = useAuthStore((state) => state.passcode);
  const profile = useAuthStore((state) => state.profile);
  const eventCoverUrl = useAuthStore((state) => state.eventCoverUrl);
  const eventTitle = useAuthStore((state) => state.eventTitle);
  const handleScroll = useScrollTabBarCollapse();

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
          if (ssoRes.data?.guest && typeof ssoRes.data.guest.hasFullAccess === 'boolean') {
            setGuestAccessLevel(ssoRes.data.guest.hasFullAccess);
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

      const mapPhotoItem = (p: any): Photo => {
        const thumbUri = p.thumbnailUrl || p.thumbnail_url || p.r2Url || p.r2_url || p.file_url_mobile || p.file_url || p.url || '';
        const fullUri = p.r2Url || p.r2_url || p.file_url || p.url || thumbUri;
        return {
          id: p.id,
          r2Url: thumbUri,
          uri: thumbUri,
          fullUri: fullUri,
          photoUrl: fullUri,
          width: p.width,
          height: p.height,
          tabName: p.tabName || p.tab_name || null,
          isLiked: typeof p.isLiked === 'boolean' ? p.isLiked : !!(p.likes && p.likes.length > 0),
          likeCount: typeof p.likeCount === 'number' ? p.likeCount : (typeof p.likesCount === 'number' ? p.likesCount : (p._count?.likes || 0)),
        };
      };

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

        // Silent background prefetch of initial batch into native image cache
        mapped.forEach((p) => {
          if (p.r2Url) Image.prefetch(p.r2Url);
        });

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
    const isCeremonyTab = normTab !== 'ALL' && normTab !== 'MY PHOTOS' && normTab !== 'MY FAVOURITES';

    if (!isCeremonyTab && !hasMorePhotos) return;

    try {
      isFetchingMoreRef.current = true;
      setIsLoadingMore(true);

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
      const mapPhotoItem = (p: any): Photo => {
        const thumbUri = p.thumbnailUrl || p.thumbnail_url || p.r2Url || p.r2_url || p.file_url_mobile || p.file_url || p.url || '';
        const fullUri = p.r2Url || p.r2_url || p.file_url || p.url || thumbUri;
        return {
          id: p.id,
          r2Url: thumbUri,
          uri: thumbUri,
          fullUri: fullUri,
          photoUrl: fullUri,
          width: p.width,
          height: p.height,
          tabName: p.tabName || p.tab_name || null,
          isLiked: typeof p.isLiked === 'boolean' ? p.isLiked : !!(p.likes && p.likes.length > 0),
          likeCount: typeof p.likeCount === 'number' ? p.likeCount : (typeof p.likesCount === 'number' ? p.likesCount : (p._count?.likes || 0)),
        };
      };
      const mapped = Array.isArray(allList) ? allList.map(mapPhotoItem) : [];
      const loadMoreDuration = Date.now() - loadMoreStartTime;
      console.log(`[MYCIRCLE DEBUG ✅] Page Fetch Done in ${loadMoreDuration}ms | Received ${mapped.length} new photos for '${normTab}' | New Offset: ${currentOffset + mapped.length}`);

      if (mapped.length > 0) {
        mapped.forEach((p) => {
          if (p.r2Url) Image.prefetch(p.r2Url);
        });

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
            if (!reachedTotal && dedupped.length < 180) {
              setTimeout(() => {
                loadMorePhotos();
              }, 200);
            }
            return dedupped;
          });
        }
      } else {
        if (!isCeremonyTab) {
          setHasMorePhotos(false);
        }
      }
    } catch (e: any) {
      console.warn('[MYCIRCLE DEBUG ⚠️] loadMorePhotos error:', e);
    } finally {
      isFetchingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  };

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
        return {
          id: p.id,
          r2Url: thumbUri,
          uri: thumbUri,
          fullUri: fullUri,
          photoUrl: fullUri,
          width: p.width,
          height: p.height,
          tabName: p.tabName || p.tab_name || null,
          isLiked: typeof p.isLiked === 'boolean' ? p.isLiked : !!(p.likes && p.likes.length > 0),
          likeCount: typeof p.likeCount === 'number' ? p.likeCount : (typeof p.likesCount === 'number' ? p.likesCount : (p._count?.likes || 0)),
        };
      };
      const mapped = Array.isArray(rawList) ? rawList.map(mapPhotoItem) : [];

      // Silent background prefetch of top 30 tab thumbnails into native cache
      mapped.slice(0, 30).forEach((p) => {
        if (p.r2Url) Image.prefetch(p.r2Url);
      });

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

  // Exact Landing Tab Rules:
  // - Full Access: Lands on ALL
  // - Partial Access: If highlights.count > 0 -> HIGHLIGHTS, else -> MY PHOTOS
  useEffect(() => {
    if (!isLoading) {
      if (hasFullAccess) {
        setActiveTab('ALL');
      } else {
        if (highlightsCount > 0) {
          setActiveTab('HIGHLIGHTS');
        } else {
          setActiveTab('MY PHOTOS');
        }
      }
    }
  }, [isLoading, hasFullAccess, highlightsCount]);

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

  // Progressive 3-Step Hydration: Prevents initial phone CPU hang on gallery open
  useEffect(() => {
    setRenderLimit(12); // Frame 1: Render top 12 cards only (1 screen) -> 0ms instant UI modal open!
    const t1 = setTimeout(() => setRenderLimit(30), 100);
    const t2 = setTimeout(() => setRenderLimit(Infinity as any), 250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Shortest Column Height Balancing — EXACTLY matching FeaturedStoryView
  const { column0, column1 } = React.useMemo(() => {
    const cols: [any[], any[]] = [[], []];
    const colHeights = [0, 0];

    const visibleList = activeList.slice(0, renderLimit);

    for (let index = 0; index < visibleList.length; index++) {
      const photo: any = visibleList[index];
      const realAspect = photo.width && photo.height && Number(photo.height) > 0
        ? Number(photo.width) / Number(photo.height)
        : (photo.aspectRatio || null);

      const isLandscape = realAspect ? realAspect > 1.05 : photo.isHorizontal;

      let cardAspect = 0.75;
      if (isLandscape) {
        cardAspect = realAspect && realAspect > 1.0 ? realAspect : 1.5;
      } else {
        const cycle = index % 3;
        cardAspect = cycle === 0 ? 2 / 3 : cycle === 1 ? 3 / 4 : 4 / 5;
      }

      photo.cardAspect = cardAspect;
      photo.globalIndex = index;

      const cardHeight = 1 / cardAspect;
      const targetCol = colHeights[0] <= colHeights[1] ? 0 : 1;
      cols[targetCol].push(photo);
      colHeights[targetCol] += cardHeight;
    }

    return { column0: cols[0], column1: cols[1] };
  }, [activeList, renderLimit]);

  // Interleaved Rows for 100% Simultaneous Left & Right Column Loading
  const interleavedRows = React.useMemo(() => {
    const maxLen = Math.max(column0.length, column1.length);
    const rows = [];
    for (let i = 0; i < maxLen; i++) {
      rows.push({
        left: column0[i] || null,
        right: column1[i] || null,
      });
    }
    return rows;
  }, [column0, column1]);

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

  // Header Cover Metadata
  const coverUrl =
    eventCoverUrl ||
    eventDetails?.coverPhotoMobileUrl ||
    eventDetails?.coverPhotoUrl ||
    (activeList[0]?.r2Url) ||
    null;

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

  const pathname = usePathname();
  const isMyCircleActive = pathname ? pathname.includes('mycircle') : true;

  if (!isMyCircleActive) {
    return null;
  }

  return (
    <Modal
      visible={isMyCircleActive}
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
            <Text style={styles.editorialBackText}>← BACK</Text>
          </Pressable>

          <Animated.ScrollView
            ref={mainScrollRef}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={true}
            scrollEventThrottle={32}
            removeClippedSubviews={true}
            onScroll={(e) => {
              if (isSmoothScrollingToTop.value) return; // 120 FPS Lock: Bypass JS re-renders during active smooth scroll to top animation
              handleScroll(e);
              const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
              const currentY = contentOffset.y;
              currentYRef.current = currentY;
              const deltaY = currentY - lastScrollYRef.current;
              lastScrollYRef.current = currentY;

              // Appears after scrolling past 60 photos (~4200px scroll depth)
              const past60 = currentY > 4200;
              if (past60) {
                if (deltaY < -20) {
                  if (btnStateRef.current !== 'bright') {
                    btnStateRef.current = 'bright';
                    if (!isPast60Photos) setIsPast60Photos(true);
                    backToTopOpacity.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) });
                  }
                } else if (deltaY > 20) {
                  if (btnStateRef.current !== 'dim') {
                    btnStateRef.current = 'dim';
                    if (!isPast60Photos) setIsPast60Photos(true);
                    backToTopOpacity.value = withTiming(0.28, { duration: 300, easing: Easing.out(Easing.quad) });
                  }
                } else if (btnStateRef.current === 'hidden') {
                  btnStateRef.current = 'dim';
                  if (!isPast60Photos) setIsPast60Photos(true);
                  backToTopOpacity.value = withTiming(0.28, { duration: 300, easing: Easing.out(Easing.quad) });
                }
              } else {
                if (btnStateRef.current !== 'hidden') {
                  btnStateRef.current = 'hidden';
                  if (isPast60Photos) setIsPast60Photos(false);
                  backToTopOpacity.value = withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) });
                }
              }

              const isNearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 4500;
              if (isNearBottom && hasMorePhotos) {
                loadMorePhotos();
              }
            }}
          >
            {/* ── 1. Hero Cover Banner (Exact Featured Story Style) ── */}
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

            {/* ── 2. Category Tabs (Dynamic website parity) ── */}
            <View style={styles.galleryContainer}>
              <View style={styles.tabsWrapper}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tabsScrollContent}
                  nestedScrollEnabled={true}
                  decelerationRate="fast"
                  overScrollMode="always"
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
                        key={`tab-${tabName}-${tabIdx}`}
                        onPress={() => setActiveTab(tabName)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        style={[styles.tabButton, isActive && styles.tabButtonActive]}
                      >
                        <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                          {tabName} {tabCount !== null ? `(${tabCount})` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* ── 3. 2-Column Balanced Masonry Grid (SIMULTANEOUS PAIR LOADING + ZERO GAPS) ── */}
              {isLoading || isTabLoading ? (
                <View style={styles.masonryGridContainer}>
                  <View style={styles.masonryColumn}>
                    {[0.75, 0.67, 0.8].map((aspect, i) => (
                      <View key={`sk0-${i}`} style={[styles.masonryCard, styles.skeletonCard, { aspectRatio: aspect }]} />
                    ))}
                  </View>
                  <View style={styles.masonryColumn}>
                    {[0.67, 0.8, 0.75].map((aspect, i) => (
                      <View key={`sk1-${i}`} style={[styles.masonryCard, styles.skeletonCard, { aspectRatio: aspect }]} />
                    ))}
                  </View>
                </View>
              ) : activeList.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    {activeTab.toUpperCase() === 'MY PHOTOS'
                      ? "We couldn't find any photos matched with your face yet. Switch to ceremony tabs to view the gallery!"
                      : activeTab.toUpperCase() === 'MY FAVOURITES'
                      ? "You haven't liked any photos yet. Tap the heart icon on any photo to save it here!"
                      : `No photos found in ${activeTab}.`}
                  </Text>
                </View>
              ) : (
                <View style={styles.masonryGridContainer}>
                  <View style={styles.masonryColumn}>
                    {interleavedRows.map((row, rIdx) => {
                      if (!row.left) return null;
                      const img = row.left;
                      const cardId = img.id ? `c0-${img.id}-${rIdx}` : (img.r2Url ? `c0-${img.r2Url}-${rIdx}` : `c0-${rIdx}`);
                      const refId = img.id ? String(img.id) : (img.r2Url || `photo-${rIdx}`);
                      return (
                        <MasonryCard
                          key={cardId}
                          img={img}
                          index={img.globalIndex ?? rIdx * 2}
                          isColumn0={true}
                          onSelect={(bounds) => openLightbox(img, bounds)}
                          onRegisterRef={(id, ref) => {
                            if (id) cardRefs.current[id] = ref;
                            if (refId) cardRefs.current[refId] = ref;
                          }}
                          onToggleLike={handleToggleLike}
                        />
                      );
                    })}
                  </View>
                  <View style={styles.masonryColumn}>
                    {interleavedRows.map((row, rIdx) => {
                      if (!row.right) return null;
                      const img = row.right;
                      const cardId = img.id ? `c1-${img.id}-${rIdx}` : (img.r2Url ? `c1-${img.r2Url}-${rIdx}` : `c1-${rIdx}`);
                      const refId = img.id ? String(img.id) : (img.r2Url || `photo-${rIdx}`);
                      return (
                        <MasonryCard
                          key={cardId}
                          img={img}
                          index={img.globalIndex ?? rIdx * 2 + 1}
                          isColumn0={false}
                          onSelect={(bounds) => openLightbox(img, bounds)}
                          onRegisterRef={(id, ref) => {
                            if (id) cardRefs.current[id] = ref;
                            if (refId) cardRefs.current[refId] = ref;
                          }}
                          onToggleLike={handleToggleLike}
                        />
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Loading indicator when fetching next page */}
              {activeTab.toUpperCase() === 'ALL' && isLoadingMore ? (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color="#8c867e" />
                </View>
              ) : null}
            </View>
          </Animated.ScrollView>

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
}

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
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
    backgroundColor: '#fbfaf8',
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
    paddingHorizontal: 8,
    paddingTop: 20,
  },
  tabsWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
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
    flexDirection: 'row',
    gap: 6,
    width: '100%',
  },
  masonryColumn: {
    flex: 1,
    flexDirection: 'column',
    gap: 6,
  },
  masonryCard: {
    width: '100%',
    backgroundColor: '#f5f5f5',
    overflow: 'hidden',
  },
  skeletonCard: {
    backgroundColor: '#eae6e1',
    opacity: 0.7,
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
});
