import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  RefreshControl,
  Image as RNImage,
  Pressable,
  Dimensions,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useScrollTabBarCollapse } from '../hooks/useScrollTabBarCollapse';
import { useAuthStore } from '../store/authStore';
import { savesService, SavedPhotoItem } from '../services/savesService';
import { tabEvents, TAB_OPEN_PROFILE_SETTINGS, EVENT_SAVES_UPDATED, EVENT_JOINED_CELEBRATION } from '../lib/tabEvents';
import { EditorialLightbox, LightboxBounds } from '../components/home/lightbox/EditorialLightbox';
import CameraViewScreen from '../components/mycircle/CameraView';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { runOnJS, useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import api from '../services/api';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
} from '../constants/fonts';

const { width } = Dimensions.get('window');

type ProfileSubTab = 'my_photos' | 'my_favourites';

interface EventMatchedGroup {
  eventSlug: string;
  eventTitle: string;
  eventDate?: string;
  coverImage?: string;
  photos: any[];
}

// Helper to extract thumbnail URI for grid cards (fast loading)
const getPhotoUri = (p: any): string => {
  if (!p) return '';
  if (typeof p === 'string') return p;
  return (
    p.thumbnailUrl ||
    p.thumbnail_url ||
    p.file_url_mobile ||
    p.r2Url ||
    p.r2_url ||
    p.file_url ||
    p.url ||
    p.imageUrl ||
    p.photoUrl ||
    p.src ||
    ''
  );
};

// Helper to extract full-resolution 4K URI for Lightbox preview
const getPhotoFullUri = (p: any): string => {
  if (!p) return '';
  if (typeof p === 'string') return p;
  return (
    p.r2Url ||
    p.r2_url ||
    p.file_url ||
    p.url ||
    p.photoUrl ||
    p.imageUrl ||
    p.thumbnailUrl ||
    p.thumbnail_url ||
    p.file_url_mobile ||
    ''
  );
};

// Column Balancing Algorithm — EXACTLY matching FeaturedStoryView
const balancePhotosIntoColumns = (photosList: any[], aspectMap: { [url: string]: number } = {}) => {
  const cols: [any[], any[]] = [[], []];
  const colHeights = [0, 0];

  photosList.forEach((photo: any, index: number) => {
    const photoUri = getPhotoUri(photo);
    const realAspect =
      photo.width && photo.height && Number(photo.height) > 0
        ? Number(photo.width) / Number(photo.height)
        : photo.aspectRatio || aspectMap[photoUri] || null;

    const isLandscape = realAspect ? realAspect > 1.05 : photo.isHorizontal;

    let cardAspect = 0.75;
    if (isLandscape) {
      cardAspect = realAspect && realAspect > 1.0 ? realAspect : 1.5;
    } else {
      const cycle = index % 3;
      cardAspect = cycle === 0 ? 2 / 3 : cycle === 1 ? 3 / 4 : 4 / 5;
    }

    const rawId = photo.id || photo.photoUrl || photo.url || photo.uri || photo.r2Url || photo.r2_url || photoUri;
    const cardKey = rawId ? `card-${rawId}` : `card-photo-${index}`;

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

function getProfileCardKey(p: any, fallbackIdx: number, groupTitle: string = ''): string {
  if (!p) return `card-${groupTitle}-${fallbackIdx}`;
  if (p.id !== undefined && p.id !== null) return `card-${p.id}`;
  const uri = getPhotoUri(p) || getPhotoFullUri(p);
  if (uri) return `card-${uri}`;
  const idx = p.globalIndex !== undefined ? p.globalIndex : fallbackIdx;
  return `card-${groupTitle}-${idx}`;
}

export default function ProfileScreen() {
  const handleScroll = useScrollTabBarCollapse();
  const { profile, logout } = useAuthStore();

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

  const [eventGroups, setEventGroups] = useState<EventMatchedGroup[]>([]);
  const [totalMatchedCount, setTotalMatchedCount] = useState<number>(0);
  const [loadingPhotos, setLoadingPhotos] = useState<boolean>(true);

  const [savedPhotos, setSavedPhotos] = useState<SavedPhotoItem[]>([]);
  const [favouriteEventGroups, setFavouriteEventGroups] = useState<EventMatchedGroup[]>([]);
  const [totalFavouriteCount, setTotalFavouriteCount] = useState<number>(0);
  const [loadingSaves, setLoadingSaves] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedMyPhotoIdx, setSelectedMyPhotoIdx] = useState<number | null>(null);
  const [selectedMyPhotoBounds, setSelectedMyPhotoBounds] = useState<LightboxBounds | null>(null);
  const [selectedMyPhotoList, setSelectedMyPhotoList] = useState<any[]>([]);
  const [selectedMyPhotoTitle, setSelectedMyPhotoTitle] = useState<string>('MY CELEBRATION PHOTOS');

  const [selectedSavedIdx, setSelectedSavedIdx] = useState<number | null>(null);
  const [selectedSavedBounds, setSelectedSavedBounds] = useState<LightboxBounds | null>(null);
  const [selectedSavedList, setSelectedSavedList] = useState<any[]>([]);
  const [selectedSavedTitle, setSelectedSavedTitle] = useState<string>('CELEBRATION FAVOURITES');

  const fetchMyCelebrationPhotos = useCallback(async () => {
    setLoadingPhotos(true);
    try {
      const eventsRes = await api.get('/api/gallery/family/events');
      const eventsList = eventsRes.data?.events || [];

      let allMatched: any[] = [];
      try {
        const myPhotosRes = await api.get(`/api/my-photos?t=${Date.now()}`);
        if (myPhotosRes.data?.photos && Array.isArray(myPhotosRes.data.photos)) {
          allMatched = myPhotosRes.data.photos;
        }
      } catch (_e) {}

      let grandTotal = 0;
      const groups: EventMatchedGroup[] = [];

      if (Array.isArray(eventsList) && eventsList.length > 0) {
        for (const ev of eventsList) {
          let evPhotos: any[] = [];
          try {
            const matchedRes = await api.get(`/api/gallery/public/events/${ev.slug}/matched-photos?t=${Date.now()}`);
            const raw =
              matchedRes.data?.photos ||
              matchedRes.data?.matchedPhotos ||
              (Array.isArray(matchedRes.data) ? matchedRes.data : []);
            if (Array.isArray(raw) && raw.length > 0) {
              evPhotos = raw;
            }
          } catch (_e) {}

          if (evPhotos.length === 0 && allMatched.length > 0) {
            evPhotos = allMatched.filter(
              (p) => String(p.eventId || p.event_id) === String(ev.id) || p.eventSlug === ev.slug
            );
          }

          const validPhotos = evPhotos.filter((p) => !!getPhotoUri(p));
          if (validPhotos.length > 0) {
            grandTotal += validPhotos.length;

            groups.push({
              eventSlug: ev.slug || `event-${ev.id}`,
              eventTitle: ev.title || ev.name || 'Celebration',
              eventDate: ev.date || ev.eventDate,
              coverImage: ev.coverImage || ev.imageUrl,
              photos: validPhotos,
            });
          }
        }
      }

      if (groups.length === 0 && allMatched.length > 0) {
        const validPhotos = allMatched.filter((p) => !!getPhotoUri(p));
        grandTotal = validPhotos.length;
        groups.push({
          eventSlug: 'all-photos',
          eventTitle: 'My Celebration Photos',
          photos: validPhotos,
        });
      }

      setEventGroups(groups);
      setTotalMatchedCount(grandTotal);
    } catch (_err) {
      setEventGroups([]);
      setTotalMatchedCount(0);
    } finally {
      setLoadingPhotos(false);
    }
  }, []);

  const fetchSavedPhotos = useCallback(async () => {
    setLoadingSaves(true);
    try {
      let eventsList: any[] = [];
      try {
        const eventsRes = await api.get('/api/gallery/family/events');
        eventsList = eventsRes.data?.events || (Array.isArray(eventsRes.data) ? eventsRes.data : []);
      } catch (_e) {
        try {
          const eventsRes = await api.get('/api/events');
          eventsList = eventsRes.data?.events || (Array.isArray(eventsRes.data) ? eventsRes.data : []);
        } catch (_e2) {}
      }

      let grandTotal = 0;
      const groups: EventMatchedGroup[] = [];

      if (Array.isArray(eventsList) && eventsList.length > 0) {
        for (const ev of eventsList) {
          let evFavs: any[] = [];
          try {
            const favRes = await api.get(`/api/gallery/public/events/${ev.slug}/favorites`);
            const raw =
              favRes.data?.photos ||
              favRes.data?.favorites ||
              (Array.isArray(favRes.data) ? favRes.data : []);
            if (Array.isArray(raw) && raw.length > 0) {
              evFavs = raw.map((p) => ({ ...p, isLiked: true }));
            }
          } catch (_e) {}

          const validPhotos = evFavs.filter((p) => !!getPhotoUri(p));
          if (validPhotos.length > 0) {
            grandTotal += validPhotos.length;

            groups.push({
              eventSlug: ev.slug || `event-${ev.id}`,
              eventTitle: ev.title || ev.name || 'Celebration',
              eventDate: ev.date || ev.eventDate,
              coverImage: ev.coverImage || ev.imageUrl,
              photos: validPhotos,
            });
          }
        }
      }

      setFavouriteEventGroups(groups);
      setTotalFavouriteCount(grandTotal);
    } catch (_err) {
      setFavouriteEventGroups([]);
      setTotalFavouriteCount(0);
    } finally {
      setLoadingSaves(false);
    }
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        fetchMyCelebrationPhotos(),
        fetchSavedPhotos(),
      ]);
    } catch (_) {
    } finally {
      setRefreshing(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  const [aspectMap, setAspectMap] = useState<{ [url: string]: number }>({});

  useEffect(() => {
    fetchMyCelebrationPhotos();
    fetchSavedPhotos();

    const unsubSaves = tabEvents.on(EVENT_SAVES_UPDATED, fetchSavedPhotos);
    const unsubJoined = tabEvents.on(EVENT_JOINED_CELEBRATION, () => {
      fetchMyCelebrationPhotos();
      fetchSavedPhotos();
    });

    return () => {
      unsubSaves();
      unsubJoined();
    };
  }, [fetchMyCelebrationPhotos, fetchSavedPhotos]);

  useFocusEffect(
    useCallback(() => {
      fetchMyCelebrationPhotos();
      fetchSavedPhotos();
    }, [fetchMyCelebrationPhotos, fetchSavedPhotos])
  );

  const handleLogout = async () => {
    setShowSettingsModal(false);
    await logout();
    router.replace('/');
  };

  const getRoleLabel = () => {
    if (profile?.displayRole === 'BRIDE') return '👑 BRIDE';
    if (profile?.displayRole === 'GROOM') return '💍 GROOM';
    return '✨ CIRCLE MEMBER';
  };

  const handleUnsaveFromProfile = (item: SavedPhotoItem) => {
    setSavedPhotos((prevSaves) => {
      const nextSaves = prevSaves.filter((s) => s.id !== item.id);
      if (selectedSavedIdx !== null) {
        if (nextSaves.length === 0) {
          setSelectedSavedIdx(null);
        } else {
          const targetIdx = Math.min(selectedSavedIdx, nextSaves.length - 1);
          setSelectedSavedIdx(targetIdx);
        }
      }
      return nextSaves;
    });
  };

  const mainScrollRef = useRef<ScrollView>(null);
  const cardRefs = useRef<{ [key: string]: View | null }>({});

  const getBoundsForIndex = useCallback((idx: number, callback: (bounds: LightboxBounds) => void) => {
    const list = selectedSavedList.length > 0 ? selectedSavedList : savedPhotos;
    if (idx < 0 || idx >= list.length) return;
    const p = list[idx];
    if (!p) return;
    const cardId = (p as any).cardKey || getProfileCardKey(p, idx, 'saved');
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
  }, [selectedSavedList, savedPhotos]);

  const getMyPhotoBoundsForIndex = useCallback((idx: number, callback: (bounds: LightboxBounds) => void) => {
    if (idx < 0 || idx >= selectedMyPhotoList.length) return;
    const p = selectedMyPhotoList[idx];
    if (!p) return;
    const cardId = p.cardKey || getProfileCardKey(p, idx, selectedMyPhotoTitle);
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
  }, [selectedMyPhotoList, selectedMyPhotoTitle]);

  const renderMasonryCard = (
    p: any,
    index: number,
    isSavedTab: boolean = false,
    photosList: any[] = [],
    groupTitle: string = ''
  ) => {
    const imgUri = getPhotoUri(p);
    const targetIndex = p.globalIndex !== undefined ? p.globalIndex : index;
    const cardId = p.cardKey || getProfileCardKey(p, targetIndex, isSavedTab ? 'saved' : groupTitle);

    const handlePress = () => {
      const ref = cardRefs.current[cardId];
      if (isSavedTab) {
        if (ref) {
          ref.measureInWindow((x, y, w, h) => {
            setSelectedSavedList(photosList);
            setSelectedSavedTitle(groupTitle || 'CELEBRATION FAVOURITES');
            setSelectedSavedBounds({ x, y, width: w, height: h });
            setSelectedSavedIdx(targetIndex);
          });
        } else {
          setSelectedSavedList(photosList);
          setSelectedSavedTitle(groupTitle || 'CELEBRATION FAVOURITES');
          setSelectedSavedBounds(null);
          setSelectedSavedIdx(targetIndex);
        }
      } else {
        if (ref) {
          ref.measureInWindow((x, y, w, h) => {
            setSelectedMyPhotoList(photosList);
            setSelectedMyPhotoTitle(groupTitle || 'MY CELEBRATION PHOTOS');
            setSelectedMyPhotoBounds({ x, y, width: w, height: h });
            setSelectedMyPhotoIdx(targetIndex);
          });
        } else {
          setSelectedMyPhotoList(photosList);
          setSelectedMyPhotoTitle(groupTitle || 'MY CELEBRATION PHOTOS');
          setSelectedMyPhotoBounds(null);
          setSelectedMyPhotoIdx(targetIndex);
        }
      }
    };

    return (
      <Pressable
        key={cardId}
        ref={(ref) => {
          if (cardId) cardRefs.current[cardId] = ref;
        }}
        style={[styles.masonryCard, { aspectRatio: p.cardAspect || 0.75 }]}
        onPress={handlePress}
      >
        <Image source={{ uri: imgUri }} style={styles.masonryImage} contentFit="cover" cachePolicy="memory-disk" />
      </Pressable>
    );
  };

  const renderPhotoListMasonry = (photosList: any[], isSavedTab: boolean = false, title: string = '') => {
    const { column0, column1 } = balancePhotosIntoColumns(photosList, aspectMap);

    return (
      <View style={styles.masonryGridContainer}>
        <View style={styles.masonryColumn}>
          {column0.map((p, idx) =>
            renderMasonryCard(p, p.globalIndex ?? idx * 2, isSavedTab, photosList, title)
          )}
        </View>
        <View style={styles.masonryColumn}>
          {column1.map((p, idx) =>
            renderMasonryCard(p, p.globalIndex ?? idx * 2 + 1, isSavedTab, photosList, title)
          )}
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#ffffff"
          />
        }
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
                            <View style={styles.eventCountPill}>
                              <Text style={styles.eventCountText}>{group.photos.length} MATCHES</Text>
                            </View>
                          </View>

                          {/* 2-Column Featured Story Balanced Masonry Grid for this Event */}
                          {renderPhotoListMasonry(group.photos, false, group.eventTitle ? group.eventTitle.toUpperCase() : 'MY CELEBRATION PHOTOS')}
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
                            <View style={styles.eventCountPill}>
                              <Text style={styles.eventCountText}>{group.photos.length} FAVOURITES</Text>
                            </View>
                          </View>

                          {/* 2-Column Masonry Grid for this Event's Favourites */}
                          {renderPhotoListMasonry(
                            group.photos,
                            true,
                            group.eventTitle ? group.eventTitle.toUpperCase() : 'MY FAVOURITES'
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

      {/* ── Instagram-Style 3-Lines Settings & Logout Modal Sheet ── */}
      <Modal
        visible={showSettingsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettingsModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowSettingsModal(false)}>
          <View style={styles.actionSheetContainer}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetUserHeader}>
              <Text style={styles.sheetUserName}>{profile?.name || 'Account Settings'}</Text>
              <Text style={styles.sheetUserRole}>{getRoleLabel()}</Text>
            </View>

            <View style={styles.sheetDivider} />

            <Pressable style={styles.sheetOptionBtn} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={20} color="#ef4444" />
              <Text style={styles.logoutBtnText}>Log Out</Text>
            </Pressable>

            <Pressable style={styles.sheetOptionBtn} onPress={() => setShowSettingsModal(false)}>
              <Ionicons name="close-circle-outline" size={20} color="#666666" />
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

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

      {/* ── SAVED MOODBOARD Shared Universal Editorial Lightbox Modal ── */}
      {selectedSavedIdx !== null && (
        <EditorialLightbox
          visible={selectedSavedIdx !== null}
          images={selectedSavedList.length > 0 ? selectedSavedList : savedPhotos}
          initialIndex={selectedSavedIdx}
          initialBounds={selectedSavedBounds}
          onGetBoundsForIndex={getBoundsForIndex}
          onClose={() => {
            setSelectedSavedIdx(null);
            setSelectedSavedBounds(null);
          }}
          onUnsave={handleUnsaveFromProfile}
          title={selectedSavedTitle || 'CELEBRATION FAVOURITES'}
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
          title={selectedMyPhotoTitle}
        />
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
  masonryCard: {
    width: '100%',
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  masonryImage: {
    width: '100%',
    height: '100%',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  actionSheetContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#dddddd',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetUserHeader: {
    alignItems: 'center',
    marginBottom: 14,
  },
  sheetUserName: {
    fontSize: 16,
    fontFamily: FONT_FUTURA_BOLD,
    color: '#111111',
  },
  sheetUserRole: {
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#888888',
    marginTop: 2,
  },
  sheetDivider: {
    height: 1,
    backgroundColor: '#eeeeee',
    marginBottom: 8,
  },
  sheetOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  sheetOptionText: {
    fontSize: 14,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    color: '#111111',
  },
  logoutBtnText: {
    fontSize: 14,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#ef4444',
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    color: '#666666',
  },
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
  },
  lightboxSafeArea: {
    flex: 1,
  },
  lightboxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  lightboxTitle: {
    fontSize: 12,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.5,
    color: '#ffffff',
  },
  lightboxCloseBtn: {
    padding: 4,
  },
  lightboxImageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
  },
});
