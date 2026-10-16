import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Dimensions,
  Modal,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useScrollTabBarCollapse } from '../hooks/useScrollTabBarCollapse';
import { useAuthStore } from '../store/authStore';
import {
  tabEvents,
  TAB_OPEN_PROFILE_SETTINGS,
  EVENT_SAVES_UPDATED,
  EVENT_JOINED_CELEBRATION,
  TAB_SCROLL_TO_TOP_PROFILE,
} from '../lib/tabEvents';
import { EditorialLightbox, LightboxBounds } from '../components/home/lightbox/EditorialLightbox';
import { MasonryCard } from '../components/home/lightbox/components/MasonryCard';
import CameraViewScreen from '../components/mycircle/CameraView';
import SettingsModal from '../components/profile/SettingsModal';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { runOnJS, useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import api, { guestApi } from '../services/api';
import { getThumbnailUrl, getFullPhotoUrl } from '../utils/imageUrl';
import { getPhotoAspect } from '../utils/photoDimensionCache';
import {
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_JOST_REGULAR,
} from '../constants/fonts';
import { preventScreenCaptureAsync, allowScreenCaptureAsync } from '../utils/screenCapture';

const { width } = Dimensions.get('window');

type ProfileSubTab = 'my_photos' | 'my_favourites';

interface EventMatchedGroup {
  eventSlug: string;
  eventTitle: string;
  eventDate?: string;
  coverImage?: string;
  photos: any[];
  allowDownloads: boolean;
  allowBulkDownloads: boolean;
}

// Map raw photo object to standard photo format
function mapPhotoItem(p: any) {
  const fullUri = getFullPhotoUrl(p);
  const thumbUri = getThumbnailUrl(p, 400);
  const w =
    Number(p.width) ||
    Number(p.img_width) ||
    Number(p.imageWidth) ||
    Number(p.meta?.width) ||
    Number(p.metadata?.width) ||
    0;
  const h =
    Number(p.height) ||
    Number(p.img_height) ||
    Number(p.imageHeight) ||
    Number(p.meta?.height) ||
    Number(p.metadata?.height) ||
    0;
  const cachedAspect = getPhotoAspect(p.id) || getPhotoAspect(thumbUri) || getPhotoAspect(fullUri);
  const aspectRatio = cachedAspect || (w > 0 && h > 0 ? w / h : Number(p.aspectRatio) || Number(p.aspect_ratio) || null);

  const rawId = p.id || p.photoUrl || p.url || p.uri || p.r2Url || p.r2_url || thumbUri || fullUri;

  return {
    ...p,
    id: rawId,
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
    likeCount:
      typeof p.likeCount === 'number'
        ? p.likeCount
        : typeof p.likesCount === 'number'
        ? p.likesCount
        : p._count?.likes || 0,
  };
}

// Balance photos into 2 columns for Masonry layout
const balancePhotosIntoColumns = (photosList: any[]) => {
  const cols: [any[], any[]] = [[], []];
  const colHeights = [0, 0];

  photosList.forEach((photo: any, index: number) => {
    const realAspect =
      photo.width && photo.height && Number(photo.height) > 0
        ? Number(photo.width) / Number(photo.height)
        : photo.aspectRatio || null;

    const isLandscape = realAspect ? realAspect > 1.05 : photo.isHorizontal;

    let cardAspect = 0.75;
    if (isLandscape) {
      cardAspect = realAspect && realAspect > 1.0 ? realAspect : 1.5;
    } else {
      const cycle = index % 3;
      cardAspect = cycle === 0 ? 2 / 3 : cycle === 1 ? 3 / 4 : 4 / 5;
    }

    const rawId = photo.id || photo.photoUrl || photo.url || photo.uri || photo.r2Url || `photo-${index}`;
    const cardKey = `card-${rawId}`;

    const photoWithAspect = {
      ...photo,
      aspectRatio: cardAspect,
      cardAspect,
      globalIndex: index,
      cardKey,
    };

    const heightContribution = 1 / cardAspect;
    const shortestIdx = colHeights[0] <= colHeights[1] ? 0 : 1;
    cols[shortestIdx].push(photoWithAspect);
    colHeights[shortestIdx] += heightContribution;
  });

  return { column0: cols[0], column1: cols[1] };
};

export interface ProfileScreenProps {
  isActive?: boolean;
  onScreenProtectionChange?: (shouldPrevent: boolean) => void;
}

export default function ProfileScreen({
  isActive = true,
  onScreenProtectionChange,
}: ProfileScreenProps = {}) {
  const handleScroll = useScrollTabBarCollapse();
  const { profile } = useAuthStore();

  const [activeSubTab, setActiveSubTab] = useState<ProfileSubTab>('my_photos');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSelfieModal, setShowSelfieModal] = useState(false);

  const activeSubTabShared = useSharedValue<ProfileSubTab>(activeSubTab);
  const tabTranslateX = useSharedValue(0);
  const startDragX = useSharedValue(0);

  useEffect(() => {
    activeSubTabShared.value = activeSubTab;
    const targetX = activeSubTab === 'my_photos' ? 0 : -width;
    tabTranslateX.value = withTiming(targetX, { duration: 240, easing: Easing.out(Easing.quad) });
  }, [activeSubTab, activeSubTabShared, tabTranslateX]);

  const subTabPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(activeSubTab === 'my_photos' ? [-10, 9999] : [-9999, 10])
        .failOffsetY([-12, 12])
        .onStart(() => {
          'worklet';
          startDragX.value = tabTranslateX.value;
        })
        .onUpdate((e) => {
          'worklet';
          const nextX = startDragX.value + e.translationX;
          tabTranslateX.value = Math.min(0, Math.max(-width, nextX));
        })
        .onEnd((e) => {
          'worklet';
          const threshold = width * 0.25;
          if (activeSubTabShared.value === 'my_photos') {
            if (e.translationX < -threshold || e.velocityX < -300) {
              runOnJS(setActiveSubTab)('my_favourites');
            } else {
              tabTranslateX.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) });
            }
          } else {
            if (e.translationX > threshold || e.velocityX > 300) {
              runOnJS(setActiveSubTab)('my_photos');
            } else {
              tabTranslateX.value = withTiming(-width, { duration: 200, easing: Easing.out(Easing.quad) });
            }
          }
        }),
    [activeSubTab, activeSubTabShared, startDragX, tabTranslateX]
  );

  const subTabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tabTranslateX.value }],
  }));

  const cachedProfile = useAuthStore.getState().getProfileCache?.();

  const [eventGroups, setEventGroups] = useState<EventMatchedGroup[]>(() => {
    return cachedProfile?.eventGroups && Array.isArray(cachedProfile.eventGroups) ? cachedProfile.eventGroups : [];
  });
  const [totalMatchedCount, setTotalMatchedCount] = useState<number>(() => {
    return typeof cachedProfile?.totalMatchedCount === 'number' ? cachedProfile.totalMatchedCount : 0;
  });
  const [loadingPhotos, setLoadingPhotos] = useState<boolean>(() => {
    return !(cachedProfile?.eventGroups && Array.isArray(cachedProfile.eventGroups) && cachedProfile.eventGroups.length > 0);
  });

  const [favouriteEventGroups, setFavouriteEventGroups] = useState<EventMatchedGroup[]>(() => {
    return cachedProfile?.favouriteEventGroups && Array.isArray(cachedProfile.favouriteEventGroups) ? cachedProfile.favouriteEventGroups : [];
  });
  const [totalFavouriteCount, setTotalFavouriteCount] = useState<number>(() => {
    return typeof cachedProfile?.totalFavouriteCount === 'number' ? cachedProfile.totalFavouriteCount : 0;
  });
  const [loadingSaves, setLoadingSaves] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const eventGroupsRef = useRef<EventMatchedGroup[]>(eventGroups);
  eventGroupsRef.current = eventGroups;
  const favouriteEventGroupsRef = useRef<EventMatchedGroup[]>(favouriteEventGroups);
  favouriteEventGroupsRef.current = favouriteEventGroups;
  const isSelfLikeRef = useRef<boolean>(false);

  const [selectedMyPhotoIdx, setSelectedMyPhotoIdx] = useState<number | null>(null);
  const [selectedMyPhotoBounds, setSelectedMyPhotoBounds] = useState<LightboxBounds | null>(null);
  const [selectedMyPhotoList, setSelectedMyPhotoList] = useState<any[]>([]);
  const [selectedMyPhotoTitle, setSelectedMyPhotoTitle] = useState<string>('MY CELEBRATION PHOTOS');

  const [selectedSavedIdx, setSelectedSavedIdx] = useState<number | null>(null);
  const [selectedSavedBounds, setSelectedSavedBounds] = useState<LightboxBounds | null>(null);
  const [selectedSavedList, setSelectedSavedList] = useState<any[]>([]);
  const [selectedSavedTitle, setSelectedSavedTitle] = useState<string>('CELEBRATION FAVOURITES');
  const [selectedSavedAllowDownloads, setSelectedSavedAllowDownloads] = useState<boolean>(false);
  const [selectedMyPhotoAllowDownloads, setSelectedMyPhotoAllowDownloads] = useState<boolean>(false);

  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number; title: string } | null>(null);

  const handleDownloadPhotos = useCallback(async (photosToDownload: any[], title: string = 'Celebration Photos', isAllowed: boolean = false) => {
    if (!photosToDownload || photosToDownload.length === 0 || isBatchDownloading) return;

    if (!isAllowed) {
      Alert.alert('Downloads Disabled', 'The host of this celebration has disabled photo downloads for this event.');
      return;
    }

    try {
      let hasPermission = false;
      try {
        const perm = await MediaLibrary.requestPermissionsAsync(true);
        hasPermission =
          perm.status === 'granted' ||
          perm.granted === true ||
          (perm as any).accessPrivileges === 'limited' ||
          (perm as any).accessPrivileges === 'all';
      } catch (pErr) {
        console.error('[PROFILE DOWNLOAD ❌] Permission error:', pErr);
      }

      if (!hasPermission && Platform.OS === 'ios') {
        Alert.alert('Permission Required', 'Please allow access to save photos to your photo library.');
        return;
      }

      setIsBatchDownloading(true);
      setDownloadProgress({ current: 0, total: photosToDownload.length, title });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      const cacheDir = (((FileSystem as any).cacheDirectory || (FileSystem as any).documentDirectory || '') as string).replace(/\/+$/, '');

      let savedCount = 0;
      for (let i = 0; i < photosToDownload.length; i++) {
        const photo = photosToDownload[i];
        setDownloadProgress({ current: i + 1, total: photosToDownload.length, title });

        const rawTargetUri = photo.fullUri || photo.photoUrl || photo.r2Url || photo.uri || photo.url || '';
        if (!rawTargetUri) continue;

        const safeFilename = `gallery_${photo.id || i}_${Date.now()}_${i}.jpg`;
        const localPath = `${cacheDir}/${safeFilename}`;

        try {
          const downloadRes = await FileSystem.downloadAsync(rawTargetUri, localPath);

          if (downloadRes && downloadRes.uri) {
            let assetSaved = false;

            if (typeof (MediaLibrary as any).saveToLibraryAsync === 'function') {
              try {
                await (MediaLibrary as any).saveToLibraryAsync(downloadRes.uri);
                assetSaved = true;
              } catch (_) {}
            }

            if (!assetSaved && typeof MediaLibrary.createAssetAsync === 'function') {
              try {
                const asset = await MediaLibrary.createAssetAsync(downloadRes.uri);
                if (asset) assetSaved = true;
              } catch (_) {}
            }

            if (assetSaved) {
              savedCount++;
            }

            FileSystem.deleteAsync(downloadRes.uri, { idempotent: true }).catch(() => {});
          }
        } catch (err: any) {
          console.error(`[PROFILE DOWNLOAD ❌] Error downloading photo #${i + 1}:`, err);
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      if (savedCount > 0) {
        Alert.alert(
          'Download Complete ✨',
          `Successfully saved ${savedCount} of ${photosToDownload.length} photos to your Photos library!`
        );
      } else {
        Alert.alert('Download Failed', 'Could not save photos to your gallery. Please check storage permissions.');
      }
    } catch (err: any) {
      console.error('[PROFILE DOWNLOAD ERROR]:', err);
      Alert.alert('Download Error', 'Could not complete downloading photos. Please try again.');
    } finally {
      setIsBatchDownloading(false);
      setDownloadProgress(null);
    }
  }, [isBatchDownloading]);

  // Discover and merge all joined events
  const getCombinedEventsList = useCallback(async (): Promise<any[]> => {
    let events: any[] = [];
    try {
      const res = await api.get('/api/gallery/family/events');
      const list = res.data?.events || (Array.isArray(res.data) ? res.data : []);
      if (Array.isArray(list) && list.length > 0) {
        events = list;
      }
    } catch (_e) {
      try {
        const res = await api.get('/api/events');
        const list = res.data?.events || (Array.isArray(res.data) ? res.data : []);
        if (Array.isArray(list) && list.length > 0) {
          events = list;
        }
      } catch (_e2) {}
    }

    const storedEvents = useAuthStore.getState().userEvents || [];
    const map = new Map<string, any>();
    events.forEach((ev) => {
      const key = String(ev.slug || ev.id || '');
      if (key) map.set(key, ev);
    });
    storedEvents.forEach((ev) => {
      const key = String(ev.slug || ev.id || '');
      if (key) {
        map.set(key, { ...ev, ...(map.get(key) || {}) });
      }
    });

    return Array.from(map.values());
  }, []);

  // SSO Token Exchange Helper to get event guest headers for public event endpoints.
  // Prefers eventToken already returned by /api/gallery/family/events to avoid an
  // extra POST auth-from-family round-trip per event (was the #1 source of N+1 calls).
  const getEventHeaders = useCallback(async (ev: any, familyToken: string | null): Promise<Record<string, string>> => {
    // 1. Direct eventToken from family events response — no extra network call needed
    if (ev?.eventToken) {
      return { Authorization: `Bearer ${ev.eventToken}` };
    }

    if (!ev?.slug) {
      return familyToken ? { Authorization: `Bearer ${familyToken}` } : {};
    }

    // 2. Cached headers from a previous SSO exchange
    const cachedHeaders = useAuthStore.getState().galleryCache[ev.slug]?.headers;
    if (cachedHeaders && cachedHeaders.Authorization) {
      return cachedHeaders;
    }

    // 3. Fallback: SSO exchange (only for events not from family endpoint)
    try {
      const ssoRes = await api.post(
        `/api/gallery/public/events/${ev.slug}/auth-from-family`,
        { code: ev.passcode || undefined },
        { headers: familyToken ? { Authorization: `Bearer ${familyToken}` } : {} }
      );
      if (ssoRes.data?.token) {
        const headers = { Authorization: `Bearer ${ssoRes.data.token}` };
        useAuthStore.getState().setGalleryCache(ev.slug, { headers });
        return headers;
      }
    } catch (_e) {}
    return familyToken ? { Authorization: `Bearer ${familyToken}` } : {};
  }, []);

  // Helper to resolve event-level download permissions
  const getEventDownloadSettings = useCallback(
    async (ev: any): Promise<{ allowDownloads: boolean; allowBulkDownloads: boolean }> => {
      // 1. Direct property on event object (e.g. from backend /api/gallery/family/events)
      if (ev?.allowDownloads !== undefined || ev?.allow_downloads !== undefined) {
        const allowDownloads = ev.allowDownloads !== false && ev.allow_downloads !== false;
        const allowBulkDownloads = Boolean(ev.allowBulkDownloads ?? ev.allow_bulk_downloads) && allowDownloads;
        return { allowDownloads, allowBulkDownloads };
      }
      // 2. Check cached event details in authStore
      const cachedDetails = ev?.slug ? useAuthStore.getState().galleryCache[ev.slug]?.details : null;
      if (cachedDetails && (cachedDetails.allowDownloads !== undefined || cachedDetails.allow_downloads !== undefined)) {
        const allowDownloads = cachedDetails.allowDownloads !== false && cachedDetails.allow_downloads !== false;
        const allowBulkDownloads = Boolean(cachedDetails.allowBulkDownloads ?? cachedDetails.allow_bulk_downloads) && allowDownloads;
        return { allowDownloads, allowBulkDownloads };
      }
      // 3. Fallback: Quick public fetch for event metadata
      if (ev?.slug) {
        try {
          const res = await api.get(`/api/gallery/public/events/${ev.slug}`);
          if (res.data) {
            useAuthStore.getState().setGalleryCache(ev.slug, { details: res.data });
            const allowDownloads = res.data.allowDownloads !== false && res.data.allow_downloads !== false;
            const allowBulkDownloads = Boolean(res.data.allowBulkDownloads ?? res.data.allow_bulk_downloads) && allowDownloads;
            return { allowDownloads, allowBulkDownloads };
          }
        } catch (_e) {}
      }
      return { allowDownloads: false, allowBulkDownloads: false };
    },
    []
  );

  const fetchMyCelebrationPhotos = useCallback(async () => {
    setLoadingPhotos(true);
    try {
      const familyToken = useAuthStore.getState().token;
      const eventsList = await getCombinedEventsList();

      let grandTotal = 0;
      const groups: EventMatchedGroup[] = [];

      if (Array.isArray(eventsList) && eventsList.length > 0) {
        // Parallelize all per-event fetches instead of sequential for-loop.
        // Each event's matched-photos request runs concurrently.
        const eventResults = await Promise.allSettled(
          eventsList.map(async (ev) => {
            let evPhotos: any[] = [];
            try {
              const eventHeaders = await getEventHeaders(ev, familyToken);
              const matchedRes = await guestApi.get(
                `/api/gallery/public/events/${ev.slug}/matched-photos`,
                { headers: eventHeaders }
              );
              const raw =
                matchedRes.data?.photos ||
                matchedRes.data?.matchedPhotos ||
                (Array.isArray(matchedRes.data) ? matchedRes.data : []);
              if (Array.isArray(raw) && raw.length > 0) {
                evPhotos = raw;
              }
            } catch (_e) {}

            // Use download settings directly from family events response (no extra fetch)
            const downloadSettings = await getEventDownloadSettings(ev);

            const currentFavIds = new Set<string>();
            favouriteEventGroupsRef.current.forEach((g) => {
              g.photos.forEach((p) => {
                if (p.id) currentFavIds.add(String(p.id));
                if (p.fullUri) currentFavIds.add(p.fullUri);
                if (p.uri) currentFavIds.add(p.uri);
              });
            });

            const mappedPhotos = evPhotos
              .map((p) => {
                const mapped = mapPhotoItem(p);
                const isFav =
                  currentFavIds.has(String(mapped.id)) ||
                  (mapped.fullUri && currentFavIds.has(mapped.fullUri)) ||
                  (mapped.uri && currentFavIds.has(mapped.uri));
                return {
                  ...mapped,
                  eventSlug: ev.slug,
                  isLiked: mapped.isLiked || isFav,
                  allowDownloads: downloadSettings.allowDownloads,
                  eventAllowDownloads: downloadSettings.allowDownloads,
                };
              })
              .filter((p) => !!p.uri || !!p.fullUri);

            if (mappedPhotos.length > 0) {
              const rawCover =
                ev.coverPhotoUrl ||
                ev.cover_photo_url ||
                ev.coverPhotoMobileUrl ||
                ev.cover_photo_mobile_url ||
                ev.coverUrl ||
                ev.cover_url ||
                ev.coverImage ||
                ev.imageUrl ||
                null;
              return {
                eventSlug: ev.slug || `event-${ev.id}`,
                eventTitle: ev.title || ev.name || 'Celebration',
                eventDate: ev.date || ev.eventDate,
                coverImage: rawCover ? getThumbnailUrl(rawCover, 400) : undefined,
                photos: mappedPhotos,
                allowDownloads: downloadSettings.allowDownloads,
                allowBulkDownloads: downloadSettings.allowBulkDownloads,
              } as EventMatchedGroup;
            }
            return null;
          })
        );

        for (const result of eventResults) {
          if (result.status === 'fulfilled' && result.value) {
            grandTotal += result.value.photos.length;
            groups.push(result.value);
          }
        }
      }

      setEventGroups(groups);
      setTotalMatchedCount(grandTotal);
      useAuthStore.getState().setProfileCache({
        eventGroups: groups,
        totalMatchedCount: grandTotal,
      });
    } catch (_err) {
      setEventGroups([]);
      setTotalMatchedCount(0);
    } finally {
      setLoadingPhotos(false);
    }
  }, [getCombinedEventsList, getEventHeaders, getEventDownloadSettings]);

  const fetchSavedPhotos = useCallback(async () => {
    setLoadingSaves(true);
    try {
      const familyToken = useAuthStore.getState().token;
      const eventsList = await getCombinedEventsList();

      let grandTotal = 0;
      const groups: EventMatchedGroup[] = [];

      if (Array.isArray(eventsList) && eventsList.length > 0) {
        const eventResults = await Promise.allSettled(
          eventsList.map(async (ev) => {
            let evFavs: any[] = [];
            try {
              const eventHeaders = await getEventHeaders(ev, familyToken);
              const favRes = await guestApi.get(
                `/api/gallery/public/events/${ev.slug}/favorites`,
                { headers: eventHeaders }
              );
              const raw =
                favRes.data?.photos ||
                favRes.data?.favorites ||
                (Array.isArray(favRes.data) ? favRes.data : []);
              if (Array.isArray(raw) && raw.length > 0) {
                evFavs = raw.map((p) => ({ ...p, isLiked: true }));
              }
            } catch (_e) {}

            const downloadSettings = await getEventDownloadSettings(ev);
            const mappedPhotos = evFavs
              .map((p) => {
                const mapped = mapPhotoItem(p);
                return {
                  ...mapped,
                  eventSlug: ev.slug,
                  allowDownloads: downloadSettings.allowDownloads,
                  eventAllowDownloads: downloadSettings.allowDownloads,
                };
              })
              .filter((p) => !!p.uri || !!p.fullUri);

            if (mappedPhotos.length > 0) {
              const rawCover =
                ev.coverPhotoUrl ||
                ev.cover_photo_url ||
                ev.coverPhotoMobileUrl ||
                ev.cover_photo_mobile_url ||
                ev.coverUrl ||
                ev.cover_url ||
                ev.coverImage ||
                ev.imageUrl ||
                null;
              return {
                eventSlug: ev.slug || `event-${ev.id}`,
                eventTitle: ev.title || ev.name || 'Celebration',
                eventDate: ev.date || ev.eventDate,
                coverImage: rawCover ? getThumbnailUrl(rawCover, 400) : undefined,
                photos: mappedPhotos,
                allowDownloads: downloadSettings.allowDownloads,
                allowBulkDownloads: downloadSettings.allowBulkDownloads,
              } as EventMatchedGroup;
            }
            return null;
          })
        );

        for (const result of eventResults) {
          if (result.status === 'fulfilled' && result.value) {
            grandTotal += result.value.photos.length;
            groups.push(result.value);
          }
        }
      }

      setFavouriteEventGroups(groups);
      setTotalFavouriteCount(grandTotal);
      useAuthStore.getState().setProfileCache({
        favouriteEventGroups: groups,
        totalFavouriteCount: grandTotal,
      });

      // Cross-reference with eventGroups so photos in MY PHOTOS show liked state
      const likedIds = new Set<string>();
      groups.forEach((g) => {
        g.photos.forEach((p) => {
          if (p.id) likedIds.add(String(p.id));
          if (p.fullUri) likedIds.add(p.fullUri);
          if (p.uri) likedIds.add(p.uri);
        });
      });

      setEventGroups((prevGroups) =>
        prevGroups.map((g) => ({
          ...g,
          photos: g.photos.map((p) => {
            const isFav =
              likedIds.has(String(p.id)) ||
              (p.fullUri && likedIds.has(p.fullUri)) ||
              (p.uri && likedIds.has(p.uri));
            if (p.isLiked !== isFav) {
              return { ...p, isLiked: isFav };
            }
            return p;
          }),
        }))
      );
    } catch (_err) {
      setFavouriteEventGroups([]);
      setTotalFavouriteCount(0);
    } finally {
      setLoadingSaves(false);
    }
  }, [getCombinedEventsList, getEventHeaders, getEventDownloadSettings]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([fetchMyCelebrationPhotos(), fetchSavedPhotos()]);
    } catch (_) {
    } finally {
      setRefreshing(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  // Dirty flag: set when a like/save fires EVENT_SAVES_UPDATED while Profile is in the background.
  // We do NOT fetch immediately — this was the #1 cause of 18-22 server requests per like tap.
  // Dirty flag: set when a like/save fires EVENT_SAVES_UPDATED while Profile is in the background.
  // We do NOT fetch immediately — this was the #1 cause of 18-22 server requests per like tap.
  // The fetch is deferred until the user actually opens the Profile tab.
  const hasStaleSavesRef = useRef(false);
  // FIX #10: Track whether Profile has loaded its initial data upon user opening this tab
  const hasInitialLoadedRef = useRef(false);

  useEffect(() => {
    // FIX #10: Do NOT fetch on mount here. On cold boot, Profile mounts in the background.
    // Fetching here caused unnecessary API calls before the user ever opened Profile.
    // Initial fetch is deferred to useFocusEffect below when the user actually navigates here.

    const unsubSaves = tabEvents.on(EVENT_SAVES_UPDATED, () => {
      if (isSelfLikeRef.current) {
        isSelfLikeRef.current = false;
        return;
      }
      hasStaleSavesRef.current = true;
    });
    const unsubJoined = tabEvents.on(EVENT_JOINED_CELEBRATION, () => {
      fetchMyCelebrationPhotos();
      fetchSavedPhotos();
    });
    const unsubScroll = tabEvents.on(TAB_SCROLL_TO_TOP_PROFILE, () => {
      mainScrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    const unsubSettings = tabEvents.on(TAB_OPEN_PROFILE_SETTINGS, () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setShowSettingsModal(true);
    });

    return () => {
      unsubSaves();
      unsubJoined();
      unsubScroll();
      unsubSettings();
    };
  }, [fetchMyCelebrationPhotos, fetchSavedPhotos]);

  // Screen protection: if any displayed celebration group blocks downloads, protect the screen
  const hasBlockedPhotosInProfile = useMemo(() => {
    const activeGroups = activeSubTab === 'my_favourites' ? favouriteEventGroups : eventGroups;
    return activeGroups.some((g) => g.allowDownloads === false);
  }, [activeSubTab, favouriteEventGroups, eventGroups]);

  // Active screen protection sync: triggers whenever Profile tab is active or viewing a protected photo
  useEffect(() => {
    const isViewingBlockedPhoto =
      (selectedMyPhotoIdx !== null && !selectedMyPhotoAllowDownloads) ||
      (selectedSavedIdx !== null && !selectedSavedAllowDownloads);

    const shouldProtect = Boolean((isActive && hasBlockedPhotosInProfile) || isViewingBlockedPhoto);

    onScreenProtectionChange?.(shouldProtect);
    if (shouldProtect) {
      preventScreenCaptureAsync('profile_blocked_photos');
    } else {
      allowScreenCaptureAsync('profile_blocked_photos');
    }
  }, [
    isActive,
    hasBlockedPhotosInProfile,
    selectedMyPhotoIdx,
    selectedSavedIdx,
    selectedMyPhotoAllowDownloads,
    selectedSavedAllowDownloads,
    onScreenProtectionChange,
  ]);

  // Release screen protection on unmount
  useEffect(() => {
    return () => {
      onScreenProtectionChange?.(false);
      allowScreenCaptureAsync('profile_blocked_photos');
    };
  }, [onScreenProtectionChange]);

  // Initial load or refresh whenever user navigates to Profile tab
  useEffect(() => {
    if (isActive) {
      if (!hasInitialLoadedRef.current || eventGroups.length === 0) {
        hasInitialLoadedRef.current = true;
        fetchMyCelebrationPhotos();
        fetchSavedPhotos();
      } else if (hasStaleSavesRef.current) {
        hasStaleSavesRef.current = false;
        fetchSavedPhotos();
        fetchMyCelebrationPhotos();
      }
    }
  }, [isActive, eventGroups.length, fetchMyCelebrationPhotos, fetchSavedPhotos]);

  const getRoleLabel = () => {
    if (profile?.displayRole === 'BRIDE') return '👑 BRIDE';
    if (profile?.displayRole === 'GROOM') return '💍 GROOM';
    return '✨ CIRCLE MEMBER';
  };

  const handleToggleLike = useCallback(
    async (item: any) => {
      if (!item) return;
      const photoId = item.id;
      if (!photoId) return;

      const photoUrl = item.fullUri || item.photoUrl || item.uri || item.r2Url;
      const targetEventSlug =
        item.eventSlug ||
        item.event_slug ||
        useAuthStore.getState().eventSlug ||
        '';

      // Find fresh item from current state
      let freshItem: any = null;
      for (const g of eventGroupsRef.current) {
        const found = g.photos.find(
          (p) => p.id === photoId || (photoUrl && (p.fullUri === photoUrl || p.uri === photoUrl))
        );
        if (found) {
          freshItem = found;
          break;
        }
      }
      if (!freshItem) {
        for (const g of favouriteEventGroupsRef.current) {
          const found = g.photos.find(
            (p) => p.id === photoId || (photoUrl && (p.fullUri === photoUrl || p.uri === photoUrl))
          );
          if (found) {
            freshItem = found;
            break;
          }
        }
      }
      if (!freshItem) {
        freshItem = item;
      }

      const currentlyLiked = typeof freshItem?.isLiked === 'boolean' ? freshItem.isLiked : !!item.isLiked;
      const nextLiked = !currentlyLiked;

      // Update in-memory item immediately
      item.isLiked = nextLiked;
      if (typeof item.likeCount === 'number') {
        item.likeCount = Math.max(0, item.likeCount + (nextLiked ? 1 : -1));
      }

      // 1. Optimistically update MY PHOTOS (eventGroups)
      setEventGroups((prevGroups) =>
        prevGroups.map((group) => {
          if (targetEventSlug && group.eventSlug !== targetEventSlug) {
            return group;
          }
          const hasPhoto = group.photos.some(
            (p) => p.id === photoId || (photoUrl && (p.fullUri === photoUrl || p.uri === photoUrl))
          );
          if (!hasPhoto) return group;

          return {
            ...group,
            photos: group.photos.map((p) => {
              if (p.id === photoId || (photoUrl && (p.fullUri === photoUrl || p.uri === photoUrl))) {
                const currentCount = typeof p.likeCount === 'number' ? p.likeCount : 0;
                return {
                  ...p,
                  isLiked: nextLiked,
                  likeCount: Math.max(0, currentCount + (nextLiked ? 1 : -1)),
                };
              }
              return p;
            }),
          };
        })
      );

      // 2. Optimistically update MY CELEBRATION PHOTOS Lightbox list
      setSelectedMyPhotoList((prevList) =>
        prevList.map((p) => {
          if (p.id === photoId || (photoUrl && (p.fullUri === photoUrl || p.uri === photoUrl))) {
            const currentCount = typeof p.likeCount === 'number' ? p.likeCount : 0;
            return {
              ...p,
              isLiked: nextLiked,
              likeCount: Math.max(0, currentCount + (nextLiked ? 1 : -1)),
            };
          }
          return p;
        })
      );

      // 3. Optimistically update MY FAVOURITES (favouriteEventGroups) & count
      if (nextLiked) {
        setFavouriteEventGroups((prevGroups) => {
          const matchedGroup = eventGroupsRef.current.find((g) => g.eventSlug === targetEventSlug);
          const photoToAdd = {
            ...freshItem,
            ...item,
            id: photoId,
            eventSlug: targetEventSlug,
            isLiked: true,
            likeCount: Math.max(1, (freshItem?.likeCount || item.likeCount || 0) + 1),
          };

          const groupIndex = prevGroups.findIndex((g) => g.eventSlug === targetEventSlug);
          if (groupIndex !== -1) {
            const existingGroup = prevGroups[groupIndex];
            const alreadyExists = existingGroup.photos.some(
              (p) => p.id === photoId || (photoUrl && (p.fullUri === photoUrl || p.uri === photoUrl))
            );
            if (alreadyExists) {
              return prevGroups.map((g, idx) =>
                idx === groupIndex
                  ? {
                      ...g,
                      photos: g.photos.map((p) =>
                        p.id === photoId || (photoUrl && (p.fullUri === photoUrl || p.uri === photoUrl))
                          ? { ...p, isLiked: true }
                          : p
                      ),
                    }
                  : g
              );
            }
            return prevGroups.map((g, idx) =>
              idx === groupIndex ? { ...g, photos: [photoToAdd, ...existingGroup.photos] } : g
            );
          } else {
            const newGroup: EventMatchedGroup = {
              eventSlug: targetEventSlug || 'celebration',
              eventTitle: matchedGroup?.eventTitle || 'Celebration',
              eventDate: matchedGroup?.eventDate,
              coverImage: matchedGroup?.coverImage,
              photos: [photoToAdd],
              allowDownloads: matchedGroup?.allowDownloads ?? false,
              allowBulkDownloads: matchedGroup?.allowBulkDownloads ?? false,
            };
            return [newGroup, ...prevGroups];
          }
        });
        setTotalFavouriteCount((prev) => prev + 1);
      } else {
        setFavouriteEventGroups((prevGroups) =>
          prevGroups
            .map((g) => {
              if (targetEventSlug && g.eventSlug !== targetEventSlug) return g;
              return {
                ...g,
                photos: g.photos.filter(
                  (p) => p.id !== photoId && (!photoUrl || (p.fullUri !== photoUrl && p.uri !== photoUrl))
                ),
              };
            })
            .filter((g) => g.photos.length > 0)
        );
        setTotalFavouriteCount((prev) => Math.max(0, prev - 1));
      }

      // 4. Optimistically update MY FAVOURITES Lightbox list
      setSelectedSavedList((prevList) =>
        prevList.map((p) => {
          if (p.id === photoId || (photoUrl && (p.fullUri === photoUrl || p.uri === photoUrl))) {
            return {
              ...p,
              isLiked: nextLiked,
            };
          }
          return p;
        })
      );

      // 5. Send API request to event gallery like endpoint
      try {
        const familyToken = useAuthStore.getState().token;
        const storedEvents = useAuthStore.getState().userEvents || [];
        const evObj =
          storedEvents.find((e: any) => e.slug === targetEventSlug || e.id === targetEventSlug) ||
          eventGroupsRef.current.find((g) => g.eventSlug === targetEventSlug) ||
          favouriteEventGroupsRef.current.find((g) => g.eventSlug === targetEventSlug) ||
          { slug: targetEventSlug };

        const headers = await getEventHeaders(evObj, familyToken);
        const res = await guestApi.post(
          `/api/gallery/public/events/${targetEventSlug}/photos/${photoId}/like`,
          {},
          { headers }
        );

        if (res.data && typeof res.data.liked === 'boolean') {
          const serverLiked = res.data.liked;
          const serverCount = typeof res.data.likeCount === 'number' ? res.data.likeCount : undefined;

          // Reconcile if server state differs from optimistic
          if (serverLiked !== nextLiked) {
            setEventGroups((prevGroups) =>
              prevGroups.map((g) => ({
                ...g,
                photos: g.photos.map((p) => {
                  if (p.id === photoId || (photoUrl && (p.fullUri === photoUrl || p.uri === photoUrl))) {
                    return {
                      ...p,
                      isLiked: serverLiked,
                      ...(typeof serverCount === 'number' ? { likeCount: serverCount } : {}),
                    };
                  }
                  return p;
                }),
              }))
            );
          }
        }
        isSelfLikeRef.current = true;
        tabEvents.emit(EVENT_SAVES_UPDATED);
      } catch (err) {
        console.warn('[PROFILE LIKE ❌] Failed to toggle photo like:', err);
        // Revert on error
        setEventGroups((prevGroups) =>
          prevGroups.map((g) => ({
            ...g,
            photos: g.photos.map((p) => {
              if (p.id === photoId || (photoUrl && (p.fullUri === photoUrl || p.uri === photoUrl))) {
                return {
                  ...p,
                  isLiked: currentlyLiked,
                  likeCount: typeof freshItem?.likeCount === 'number' ? freshItem.likeCount : p.likeCount,
                };
              }
              return p;
            }),
          }))
        );
        fetchSavedPhotos();
      }
    },
    [getEventHeaders, fetchSavedPhotos]
  );

  const mainScrollRef = useRef<ScrollView>(null);
  const cardRefs = useRef<{ [key: string]: View | null }>({});

  const registerCardRef = useCallback((cardId: string, ref: View | null) => {
    if (cardId) cardRefs.current[cardId] = ref;
  }, []);

  const getBoundsForIndex = useCallback(
    (idx: number, callback: (bounds: LightboxBounds) => void) => {
      const list = selectedSavedList;
      if (idx < 0 || idx >= list.length) return;
      const p = list[idx];
      if (!p) return;
      const cardId = String(p.id || p.uri || `saved-${idx}`);
      const targetCard = cardRefs.current[cardId];

      if (targetCard) {
        targetCard.measureInWindow((x, y, cardWidth, cardHeight) => {
          if (cardWidth > 0 && cardHeight > 0) {
            const isOffScreen = y < -cardHeight / 2 || y > Dimensions.get('screen').height - 40;
            if (isOffScreen) {
              targetCard.measureLayout(
                mainScrollRef.current as any,
                (left, top, w, h) => {
                  const targetScrollY = Math.max(0, top - Dimensions.get('screen').height / 2 + h / 2);
                  mainScrollRef.current?.scrollTo({ y: targetScrollY, animated: false });
                  requestAnimationFrame(() => {
                    targetCard.measureInWindow((nx, ny, nw, nh) => {
                      if (nw > 0 && nh > 0) {
                        callback({ x, y, width: nw, height: nh });
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
    },
    [selectedSavedList]
  );

  const getMyPhotoBoundsForIndex = useCallback(
    (idx: number, callback: (bounds: LightboxBounds) => void) => {
      if (idx < 0 || idx >= selectedMyPhotoList.length) return;
      const p = selectedMyPhotoList[idx];
      if (!p) return;
      const cardId = String(p.id || p.uri || `myphoto-${idx}`);
      const targetCard = cardRefs.current[cardId];

      if (targetCard) {
        targetCard.measureInWindow((x, y, cardWidth, cardHeight) => {
          if (cardWidth > 0 && cardHeight > 0) {
            const isOffScreen = y < -cardHeight / 2 || y > Dimensions.get('screen').height - 40;
            if (isOffScreen) {
              targetCard.measureLayout(
                mainScrollRef.current as any,
                (left, top, w, h) => {
                  const targetScrollY = Math.max(0, top - Dimensions.get('screen').height / 2 + h / 2);
                  mainScrollRef.current?.scrollTo({ y: targetScrollY, animated: false });
                  requestAnimationFrame(() => {
                    targetCard.measureInWindow((nx, ny, nw, nh) => {
                      if (nw > 0 && nh > 0) {
                        callback({ x, y, width: nw, height: nh });
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
    },
    [selectedMyPhotoList]
  );

  const handleSelectPhoto = (
    img: any,
    bounds: LightboxBounds | null,
    isSavedTab: boolean,
    photosList: any[],
    title: string,
    allowDownloads: boolean = false
  ) => {
    const targetIdx = photosList.findIndex((item) => {
      if (!item || !img) return false;
      if (item === img) return true;
      if (item.id !== undefined && img.id !== undefined && item.id === img.id) return true;
      const uriItem = typeof item === 'string' ? item : item.fullUri || item.uri;
      const uriImg = typeof img === 'string' ? img : img.fullUri || img.uri;
      return Boolean(uriItem && uriImg && uriItem === uriImg);
    });
    const finalIdx = targetIdx !== -1 ? targetIdx : img.globalIndex ?? 0;

    if (isSavedTab) {
      setSelectedSavedList(photosList);
      setSelectedSavedTitle(title || 'CELEBRATION FAVOURITES');
      setSelectedSavedBounds(bounds);
      setSelectedSavedIdx(finalIdx);
      setSelectedSavedAllowDownloads(allowDownloads);
    } else {
      setSelectedMyPhotoList(photosList);
      setSelectedMyPhotoTitle(title || 'MY CELEBRATION PHOTOS');
      setSelectedMyPhotoBounds(bounds);
      setSelectedMyPhotoIdx(finalIdx);
      setSelectedMyPhotoAllowDownloads(allowDownloads);
    }
  };

  const renderPhotoListMasonry = (
    photosList: any[],
    isSavedTab: boolean = false,
    title: string = '',
    allowDownloads: boolean = false
  ) => {
    const { column0, column1 } = balancePhotosIntoColumns(photosList);

    return (
      <View style={styles.masonryGridContainer}>
        <View style={styles.masonryColumn}>
          {column0.map((img, idx) => (
            <View key={img.id || `col0-${idx}`} style={{ width: '100%', aspectRatio: img.cardAspect || 0.75 }}>
              <MasonryCard
                img={img}
                index={idx}
                isColumn0={true}
                onSelect={(bounds) => handleSelectPhoto(img, bounds, isSavedTab, photosList, title, allowDownloads)}
                onRegisterRef={registerCardRef}
                onToggleLike={handleToggleLike}
              />
            </View>
          ))}
        </View>
        <View style={styles.masonryColumn}>
          {column1.map((img, idx) => (
            <View key={img.id || `col1-${idx}`} style={{ width: '100%', aspectRatio: img.cardAspect || 0.75 }}>
              <MasonryCard
                img={img}
                index={idx}
                isColumn0={false}
                onSelect={(bounds) => handleSelectPhoto(img, bounds, isSavedTab, photosList, title, allowDownloads)}
                onRegisterRef={registerCardRef}
                onToggleLike={handleToggleLike}
              />
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        ref={mainScrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#ffffff" />}
      >
        {/* ── User Avatar & Info Card ── */}
        <View style={styles.profileHeaderCard}>
          <Pressable
            style={styles.avatarTouchable}
            onLongPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              setShowSelfieModal(true);
            }}
            delayLongPress={800}
          >
            {profile?.selfieUrl ? (
              <Image source={{ uri: profile.selfieUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>
                  {profile?.name ? profile.name.charAt(0).toUpperCase() : 'U'}
                </Text>
              </View>
            )}
          </Pressable>

          <View style={styles.userMetaInfo}>
            <Text style={styles.userNameText}>{profile?.name || 'Circle Member'}</Text>
            {profile?.email && <Text style={styles.userEmailText}>{profile.email}</Text>}
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{getRoleLabel()}</Text>
            </View>
          </View>
        </View>

        {/* ── Sub-Tab Selector & Content (MY PHOTOS vs MY FAVOURITES) ── */}
        <GestureDetector gesture={subTabPanGesture}>
          <View style={{ width, overflow: 'hidden' }}>
            <View style={styles.subTabRow}>
              <Pressable
                style={[styles.subTabBtn, activeSubTab === 'my_photos' && styles.subTabBtnActive]}
                onPress={() => setActiveSubTab('my_photos')}
              >
                <Ionicons
                  name={activeSubTab === 'my_photos' ? 'images' : 'images-outline'}
                  size={16}
                  color={activeSubTab === 'my_photos' ? '#111111' : '#888888'}
                />
                <Text style={[styles.subTabText, activeSubTab === 'my_photos' && styles.subTabTextActive]}>
                  MY PHOTOS ({totalMatchedCount})
                </Text>
              </Pressable>

              <Pressable
                style={[styles.subTabBtn, activeSubTab === 'my_favourites' && styles.subTabBtnActive]}
                onPress={() => setActiveSubTab('my_favourites')}
              >
                <Ionicons
                  name={activeSubTab === 'my_favourites' ? 'heart' : 'heart-outline'}
                  size={16}
                  color={activeSubTab === 'my_favourites' ? '#ef4444' : '#888888'}
                />
                <Text style={[styles.subTabText, activeSubTab === 'my_favourites' && styles.subTabTextActive]}>
                  MY FAVOURITES ({totalFavouriteCount})
                </Text>
              </Pressable>
            </View>

            {/* ── Side-by-Side 60FPS Animated Sliding Track ── */}
            <Animated.View style={[{ flexDirection: 'row', width: width * 2, alignItems: 'flex-start' }, subTabAnimatedStyle]}>
              {/* PAGE 1: MY CELEBRATION PHOTOS */}
              <View style={{ width }}>
                {loadingPhotos ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator size="small" color="#111111" />
                  </View>
                ) : eventGroups.length === 0 || totalMatchedCount === 0 ? (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyIconCircle}>
                      <Ionicons name="camera-outline" size={30} color="#888888" />
                    </View>
                    <Text style={styles.emptyTitle}>NO MATCHED PHOTOS YET</Text>
                    <Text style={styles.emptySub}>
                      Photos matched to your selfie across your celebration events will automatically appear here.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.eventsSection}>
                    {eventGroups.map((group) => {
                      if (!group.photos || group.photos.length === 0) return null;
                      return (
                        <View key={group.eventSlug} style={styles.eventGroupContainer}>
                          {/* Event Title Header */}
                          <View style={styles.eventHeaderRow}>
                            <View style={styles.eventHeaderInfo}>
                              <Text style={styles.eventGroupCategory}>CELEBRATION MATCHES</Text>
                              <Text style={styles.eventGroupTitle}>{group.eventTitle.toUpperCase()}</Text>
                              {group.eventDate && (
                                <Text style={styles.eventGroupDate}>
                                  {new Date(group.eventDate).toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })}
                                </Text>
                              )}
                            </View>
                            <View style={styles.eventActionsRow}>
                              {group.allowDownloads && group.allowBulkDownloads && (
                                <Pressable
                                  style={styles.eventDownloadBtn}
                                  onPress={() => handleDownloadPhotos(group.photos, group.eventTitle, group.allowDownloads && group.allowBulkDownloads)}
                                  disabled={isBatchDownloading}
                                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                >
                                  <Ionicons name="download-outline" size={16} color="#111111" />
                                </Pressable>
                              )}
                              <View style={styles.eventCountPill}>
                                <Text style={styles.eventCountText}>{group.photos.length} MATCHES</Text>
                              </View>
                            </View>
                          </View>

                          {/* 2-Column Balanced Masonry Grid for this Event */}
                          {renderPhotoListMasonry(
                            group.photos,
                            false,
                            group.eventTitle ? group.eventTitle.toUpperCase() : 'MY CELEBRATION PHOTOS',
                            group.allowDownloads
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* PAGE 2: MY FAVOURITES */}
              <View style={{ width }}>
                {loadingSaves ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator size="small" color="#111111" />
                  </View>
                ) : favouriteEventGroups.length === 0 || totalFavouriteCount === 0 ? (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyIconCircle}>
                      <Ionicons name="heart-outline" size={30} color="#888888" />
                    </View>
                    <Text style={styles.emptyTitle}>NO FAVOURITE PHOTOS YET</Text>
                    <Text style={styles.emptySub}>
                      Heart or save photos while exploring event stories to curate your personal favourites collection.
                    </Text>
                    <Pressable style={styles.exploreBtn} onPress={() => router.replace('/')}>
                      <Text style={styles.exploreBtnText}>EXPLORE CELEBRATIONS</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.eventsSection}>
                    {favouriteEventGroups.map((group) => {
                      if (!group.photos || group.photos.length === 0) return null;
                      return (
                        <View key={`fav-${group.eventSlug}`} style={styles.eventGroupContainer}>
                          {/* Event Title Header */}
                          <View style={styles.eventHeaderRow}>
                            <View style={styles.eventHeaderInfo}>
                              <Text style={styles.eventGroupCategory}>CELEBRATION FAVOURITES</Text>
                              <Text style={styles.eventGroupTitle}>{group.eventTitle.toUpperCase()}</Text>
                              {group.eventDate && (
                                <Text style={styles.eventGroupDate}>
                                  {new Date(group.eventDate).toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })}
                                </Text>
                              )}
                            </View>
                            <View style={styles.eventActionsRow}>
                              {group.allowDownloads && group.allowBulkDownloads && (
                                <Pressable
                                  style={styles.eventDownloadBtn}
                                  onPress={() => handleDownloadPhotos(group.photos, group.eventTitle, group.allowDownloads && group.allowBulkDownloads)}
                                  disabled={isBatchDownloading}
                                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                >
                                  <Ionicons name="download-outline" size={16} color="#111111" />
                                </Pressable>
                              )}
                              <View style={styles.eventCountPill}>
                                <Text style={styles.eventCountText}>{group.photos.length} FAVOURITES</Text>
                              </View>
                            </View>
                          </View>

                          {/* 2-Column Masonry Grid for this Event's Favourites */}
                          {renderPhotoListMasonry(
                            group.photos,
                            true,
                            group.eventTitle ? group.eventTitle.toUpperCase() : 'MY FAVOURITES',
                            group.allowDownloads
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </Animated.View>
          </View>
        </GestureDetector>
      </ScrollView>

      {/* ── Full-Screen Settings, Preferences & Account Management Modal ── */}
      <SettingsModal
        visible={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        onRetakeSelfie={() => setShowSelfieModal(true)}
        totalMatchedPhotos={totalMatchedCount}
      />

      {/* ── UPDATE SELFIE CAMERA MODAL ── */}
      {showSelfieModal && (
        <Modal
          visible={showSelfieModal}
          animationType="fade"
          transparent={true}
          statusBarTranslucent={true}
          onRequestClose={() => setShowSelfieModal(false)}
        >
          <CameraViewScreen
            onSuccess={() => {
              setShowSelfieModal(false);
              fetchMyCelebrationPhotos();
              fetchSavedPhotos();
            }}
            onCancel={() => setShowSelfieModal(false)}
          />
        </Modal>
      )}

      {/* ── SAVED FAVOURITES Shared Universal Editorial Lightbox Modal ── */}
      {selectedSavedIdx !== null && (
        <EditorialLightbox
          visible={selectedSavedIdx !== null}
          images={selectedSavedList}
          initialIndex={selectedSavedIdx}
          initialBounds={selectedSavedBounds}
          onGetBoundsForIndex={getBoundsForIndex}
          onClose={() => {
            setSelectedSavedIdx(null);
            setSelectedSavedBounds(null);
          }}
          onToggleLike={handleToggleLike}
          likeTargetName="My Favourites"
          enableDownload={selectedSavedAllowDownloads && (selectedSavedList[selectedSavedIdx ?? 0]?.allowDownloads !== false)}
          title={selectedSavedTitle || 'CELEBRATION FAVOURITES'}
          subtitle="MY FAVOURITES"
        />
      )}

      {/* ── MY CELEBRATION PHOTOS Shared Universal Editorial Lightbox Modal ── */}
      {selectedMyPhotoIdx !== null && (
        <EditorialLightbox
          visible={selectedMyPhotoIdx !== null}
          images={selectedMyPhotoList}
          initialIndex={selectedMyPhotoIdx}
          initialBounds={selectedMyPhotoBounds}
          onGetBoundsForIndex={getMyPhotoBoundsForIndex}
          onClose={() => {
            setSelectedMyPhotoIdx(null);
            setSelectedMyPhotoBounds(null);
          }}
          onToggleLike={handleToggleLike}
          likeTargetName="My Favourites"
          enableDownload={selectedMyPhotoAllowDownloads && (selectedMyPhotoList[selectedMyPhotoIdx ?? 0]?.allowDownloads !== false)}
          title={selectedMyPhotoTitle}
          subtitle="MY PHOTOS"
        />
      )}

      {/* ── Batch Download Floating Toast Progress Indicator ── */}
      {isBatchDownloading && downloadProgress && (
        <View style={styles.downloadProgressBar}>
          <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 10 }} />
          <Text style={styles.downloadProgressText}>
            Saving {downloadProgress.title} ({downloadProgress.current}/{downloadProgress.total})...
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    paddingBottom: 110,
  },
  profileHeaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },
  avatarTouchable: {
    position: 'relative',
  },
  avatarCameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#111111',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: '#111111',
    transform: [{ scaleX: -1 }],
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 24,
    fontFamily: FONT_FUTURA_BOLD,
  },
  userMetaInfo: {
    flex: 1,
    gap: 4,
  },
  userNameText: {
    fontSize: 18,
    fontFamily: FONT_FUTURA_BOLD,
    color: '#111111',
  },
  userEmailText: {
    fontSize: 12,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
  },
  roleBadgeText: {
    fontSize: 9,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1,
    color: '#111111',
  },
  subTabRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f3f4f6',
    marginTop: 12,
    marginBottom: 16,
  },
  subTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  subTabBtnActive: {
    borderBottomColor: '#111111',
  },
  subTabText: {
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 0.8,
    color: '#888888',
  },
  subTabTextActive: {
    color: '#111111',
  },
  eventsSection: {
    gap: 24,
  },
  eventGroupContainer: {
    marginBottom: 16,
  },
  eventHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  eventHeaderInfo: {
    flex: 1,
    gap: 2,
  },
  eventGroupCategory: {
    fontSize: 8,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.5,
    color: '#888888',
  },
  eventGroupTitle: {
    fontSize: 14,
    fontFamily: FONT_FUTURA_BOLD,
    letterSpacing: 1,
    color: '#111111',
  },
  eventGroupDate: {
    fontSize: 10,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
  },
  eventCountPill: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  eventCountText: {
    fontSize: 8,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 0.8,
    color: '#111111',
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyState: {
    paddingHorizontal: 30,
    paddingVertical: 50,
    alignItems: 'center',
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f8f8f8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#eeeeee',
  },
  emptyTitle: {
    fontSize: 13,
    fontFamily: FONT_FUTURA_BOLD,
    letterSpacing: 1.5,
    color: '#111111',
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 12,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  exploreBtn: {
    backgroundColor: '#111111',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  exploreBtnText: {
    color: '#ffffff',
    fontSize: 9,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1,
  },
  // Featured Story style 2-Column Masonry Grid
  masonryGridContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
  masonryColumn: {
    flex: 1,
    flexDirection: 'column',
    gap: 8,
  },
  eventActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventDownloadBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadProgressBar: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(17, 17, 17, 0.95)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 9999,
  },
  downloadProgressText: {
    color: '#ffffff',
    fontSize: 12,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 0.5,
  },
});
