import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image as RNImage,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useScrollTabBarCollapse } from '../hooks/useScrollTabBarCollapse';
import { savesService, SavedPhotoItem } from '../services/savesService';
import { useAuthStore } from '../store/authStore';
import { tabEvents, EVENT_SAVES_UPDATED, TAB_SCROLL_TO_TOP_MOODBOARD } from '../lib/tabEvents';
import { EditorialLightbox, LightboxBounds } from '../components/home/lightbox/EditorialLightbox';
import { MasonryCard } from '../components/home/lightbox/components/MasonryCard';
import { getPhotoAspect } from '../utils/photoDimensionCache';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
} from '../constants/fonts';

type MoodboardFilterType = 'all' | 'mine' | 'partner';

export default function MoodboardScreen() {
  const handleScroll = useScrollTabBarCollapse();
  const { profile, userEvents, eventSlug } = useAuthStore();

  const [saves, setSaves] = useState<SavedPhotoItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [selectedFilter, setSelectedFilter] = useState<MoodboardFilterType>('all');
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState<number | null>(null);
  const [selectedBounds, setSelectedBounds] = useState<LightboxBounds | null>(null);

  const effectiveDisplayRole = React.useMemo(() => {
    // 1. Check global profile displayRole or role
    const pRole = (
      profile?.displayRole ||
      (profile as any)?.role ||
      (profile as any)?.userRole ||
      ''
    ).toString().toUpperCase();

    if (['BRIDE', 'GROOM'].includes(pRole)) return pRole;

    // 2. Check per-event role from userEvents list
    if (Array.isArray(userEvents) && userEvents.length > 0) {
      if (eventSlug) {
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
          if (['BRIDE', 'GROOM'].includes(evRole)) return evRole;
        }
      }

      for (const ev of userEvents) {
        const evRole = (
          ev.guestInfo?.displayRole ||
          ev.displayRole ||
          ev.role ||
          ev.guestRole ||
          ev.userRole ||
          ev.guest?.displayRole ||
          ev.guest?.role ||
          ''
        ).toString().toUpperCase();
        if (['BRIDE', 'GROOM'].includes(evRole)) return evRole;
      }
    }

    return pRole || 'GUEST';
  }, [profile, userEvents, eventSlug]);

  const isCoupleRole = effectiveDisplayRole === 'BRIDE' || effectiveDisplayRole === 'GROOM';

  const fetchSaves = useCallback(async () => {
    try {
      const data = await savesService.getSavedPhotos();
      setSaves(data || []);
    } catch (_err) {
      setSaves([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSaves();
    const unsub = tabEvents.on(EVENT_SAVES_UPDATED, fetchSaves);
    const unsubScroll = tabEvents.on(TAB_SCROLL_TO_TOP_MOODBOARD, () => {
      mainScrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return () => {
      unsub();
      unsubScroll();
    };
  }, [fetchSaves]);

  useFocusEffect(
    useCallback(() => {
      fetchSaves();
    }, [fetchSaves])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSaves();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const handleUnsave = (item: SavedPhotoItem) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setSaves((prevSaves) => {
      const nextSaves = prevSaves.filter((s) => s.id !== item.id);
      if (selectedPhotoIdx !== null) {
        if (nextSaves.length === 0) {
          setSelectedPhotoIdx(null);
        } else {
          const targetIdx = Math.min(selectedPhotoIdx, nextSaves.length - 1);
          setSelectedPhotoIdx(targetIdx);
        }
      }
      return nextSaves;
    });
  };

  // Check if item belongs to current user
  const isMine = useCallback((item: SavedPhotoItem) => {
    if (!profile) return false;
    if (profile.id && String(item.userId) === String(profile.id)) return true;
    if (profile.selfieGuestId && String(item.userId) === String(profile.selfieGuestId)) return true;
    if (
      profile.email &&
      item.savedBy?.email &&
      String(item.savedBy.email).toLowerCase().trim() === String(profile.email).toLowerCase().trim()
    ) {
      return true;
    }
    if (effectiveDisplayRole && item.savedBy?.displayRole) {
      return effectiveDisplayRole === item.savedBy.displayRole;
    }
    return false;
  }, [profile, effectiveDisplayRole]);

  const filteredSaves = saves.filter((item) => {
    if (!isCoupleRole) return isMine(item);
    if (selectedFilter === 'mine') return isMine(item);
    if (selectedFilter === 'partner') return !isMine(item);
    return true;
  });

  const [aspectMap, setAspectMap] = useState<{ [url: string]: number }>({});

  useEffect(() => {
    saves.forEach((item) => {
      const url = item.photoUrl;
      if (url && !aspectMap[url]) {
        RNImage.getSize(
          url,
          (w, h) => {
            if (w > 0 && h > 0) {
              setAspectMap((prev) => ({ ...prev, [url]: w / h }));
            }
          },
          () => {}
        );
      }
    });
  }, [saves]);

  // Shortest Column Height Balancing algorithm — EXACTLY matching FeaturedStoryView
  const { column0, column1 } = React.useMemo(() => {
    const cols: [any[], any[]] = [[], []];
    const colHeights = [0, 0];

    filteredSaves.forEach((photo: any, index: number) => {
      const cachedAspect = getPhotoAspect(photo.photoUrl) || getPhotoAspect(photo.id);
      const realAspect =
        cachedAspect ||
        (photo.width && photo.height && Number(photo.height) > 0
          ? Number(photo.width) / Number(photo.height)
          : photo.aspectRatio || aspectMap[photo.photoUrl] || null);

      const isLandscape = realAspect ? realAspect > 1.05 : photo.isHorizontal;

      let cardAspect = 0.75;
      if (isLandscape) {
        cardAspect = realAspect && realAspect > 1.0 ? realAspect : 1.5;
      } else {
        const cycle = index % 3;
        cardAspect = realAspect && realAspect < 1.0 ? realAspect : (cycle === 0 ? 2 / 3 : cycle === 1 ? 3 / 4 : 4 / 5);
      }

      const photoWithAspect = {
        ...photo,
        aspectRatio: cardAspect,
        cardAspect,
        globalIndex: index,
      };
      const heightContribution = 1 / cardAspect;
      const shortestIdx = colHeights[0] <= colHeights[1] ? 0 : 1;
      cols[shortestIdx].push(photoWithAspect);
      colHeights[shortestIdx] += heightContribution;
    });

    return { column0: cols[0], column1: cols[1] };
  }, [filteredSaves, aspectMap]);

  const mainScrollRef = useRef<ScrollView>(null);
  const cardRefs = useRef<{ [key: string]: View | null }>({});

  const getBoundsForIndex = useCallback((idx: number, callback: (bounds: LightboxBounds) => void) => {
    if (idx < 0 || idx >= filteredSaves.length) return;
    const item = filteredSaves[idx];
    if (!item) return;
    const cardId = item.id || item.photoUrl || `save-${(item as any).globalIndex ?? idx}`;
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
  }, [filteredSaves]);

  const renderMasonryCard = (item: any, isColumn0: boolean) => {
    const photoMine = isMine(item);
    const cardId = item.id || item.photoUrl || `save-${item.globalIndex}`;
    const cardAspect = item.cardAspect || item.aspectRatio || 0.75;

    let badgeLabel = '';
    if (photoMine) {
      badgeLabel = 'YOU';
    } else if (item.savedBy?.displayRole === 'BRIDE') {
      badgeLabel = item.savedBy?.name ? `👰 ${item.savedBy.name.toUpperCase()}` : '👰 BRIDE';
    } else if (item.savedBy?.displayRole === 'GROOM') {
      badgeLabel = item.savedBy?.name ? `🤵 ${item.savedBy.name.toUpperCase()}` : '🤵 GROOM';
    } else if (item.savedBy?.name) {
      badgeLabel = item.savedBy.name.toUpperCase();
    } else {
      badgeLabel = 'PARTNER';
    }

    return (
      <View key={cardId} style={[styles.masonryCardWrapper, { aspectRatio: cardAspect }]}>
        <MasonryCard
          img={{
            ...item,
            id: item.id || item.photoUrl,
            uri: item.photoUrl || item.r2Url || item.file_url || item.uri || '',
            fullUri: item.photoUrl || item.r2Url || item.file_url || item.uri || '',
            aspectRatio: cardAspect,
          }}
          index={item.globalIndex ?? 0}
          isColumn0={isColumn0}
          onSelect={(bounds) => {
            setSelectedBounds(bounds);
            setSelectedPhotoIdx(item.globalIndex ?? 0);
          }}
          onRegisterRef={(id, ref) => {
            if (id) cardRefs.current[id] = ref;
            if (cardId) cardRefs.current[cardId] = ref;
          }}
        />

        {/* Top Heart Badge */}
        <View style={styles.cardBadgeOverlay}>
          <Ionicons name="heart" size={12} color="#ef4444" />
          <Text style={styles.badgeRoleText}>{badgeLabel}</Text>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#111111" />}
      >
        {/* ── Page Header ── */}
        <View style={styles.headerSection}>
          <Text style={styles.headerSubtitle}>
            {isCoupleRole ? 'YOUR SHARED WEDDING INSPIRATION' : 'YOUR PERSONAL VISUAL COLLECTION'}
          </Text>
          <Text style={styles.headerTitle}>
            {isCoupleRole ? 'OUR MOODBOARD' : 'MY SAVES'}
          </Text>
          <Text style={styles.headerDesc}>
            {isCoupleRole
              ? 'All the photos and fine art details you and your partner heart and save across stories and inspirations in one shared collection.'
              : 'All the photos and fine art details you heart and save across stories and inspirations in your personal collection.'}
          </Text>
        </View>

        {/* ── Couple Filter Pills (All / Mine / Partner) ── */}
        {isCoupleRole && (
          <View style={styles.filterPillsContainer}>
            <Pressable
              style={[styles.filterPill, selectedFilter === 'all' && styles.filterPillActive]}
              onPress={() => setSelectedFilter('all')}
            >
              <Text style={[styles.filterPillText, selectedFilter === 'all' && styles.filterPillTextActive]}>
                ALL SAVES ({saves.length})
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, selectedFilter === 'mine' && styles.filterPillActive]}
              onPress={() => setSelectedFilter('mine')}
            >
              <Text style={[styles.filterPillText, selectedFilter === 'mine' && styles.filterPillTextActive]}>
                MY SAVES
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, selectedFilter === 'partner' && styles.filterPillActive]}
              onPress={() => setSelectedFilter('partner')}
            >
              <Text style={[styles.filterPillText, selectedFilter === 'partner' && styles.filterPillTextActive]}>
                PARTNER'S SAVES
              </Text>
            </Pressable>
          </View>
        )}

        {/* ── Section Title & Count ── */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>SAVED INSPIRATIONS</Text>
          <Text style={styles.sectionCount}>{filteredSaves.length} PHOTOS</Text>
        </View>

        {/* ── Content View ── */}
        {loading ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="small" color="#111111" />
          </View>
        ) : filteredSaves.length === 0 ? (
          /* ── Empty Moodboard State ── */
          <View style={styles.emptyStateContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="heart-outline" size={32} color="#888888" />
            </View>
            <Text style={styles.emptyTitle}>YOUR MOODBOARD IS EMPTY</Text>
            <Text style={styles.emptySub}>
              Heart or save photos while exploring stories, aesthetics, and inspirations to build your personal visual moodboard.
            </Text>
            <Pressable style={styles.exploreBtn} onPress={() => router.replace('/')}>
              <Text style={styles.exploreBtnText}>EXPLORE STORIES & INSPIRATIONS</Text>
            </Pressable>
          </View>
        ) : (
          /* ── Featured Story Style Balanced 2-Column Masonry Grid ── */
          <View style={styles.masonryGridContainer}>
            <View style={styles.masonryColumn}>
              {column0.map((item) => renderMasonryCard(item, true))}
            </View>
            <View style={styles.masonryColumn}>
              {column1.map((item) => renderMasonryCard(item, false))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Shared Universal Editorial Lightbox Modal ── */}
      {selectedPhotoIdx !== null && (
        <EditorialLightbox
          visible={selectedPhotoIdx !== null}
          images={filteredSaves}
          initialIndex={selectedPhotoIdx}
          initialBounds={selectedBounds}
          onGetBoundsForIndex={getBoundsForIndex}
          onClose={() => {
            setSelectedPhotoIdx(null);
            setSelectedBounds(null);
          }}
          onUnsave={handleUnsave}
          title="MY MOODBOARD"
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
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerSubtitle: {
    fontSize: 9,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 2,
    color: '#888888',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: FONT_FUTURA_BOLD,
    letterSpacing: 1.5,
    color: '#111111',
    marginBottom: 6,
  },
  headerDesc: {
    fontSize: 13,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
    lineHeight: 18,
  },
  filterPillsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  filterPillActive: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  filterPillText: {
    fontSize: 9,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    letterSpacing: 1,
    color: '#555555',
  },
  filterPillTextActive: {
    color: '#ffffff',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.5,
    color: '#111111',
  },
  sectionCount: {
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    color: '#888888',
    letterSpacing: 1,
  },
  centerLoading: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyStateContainer: {
    paddingHorizontal: 30,
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
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
    borderColor: '#eeeeee',
  },
  emptyTitle: {
    fontSize: 14,
    fontFamily: FONT_FUTURA_BOLD,
    letterSpacing: 1.5,
    color: '#111111',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  exploreBtn: {
    backgroundColor: '#111111',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  exploreBtnText: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.2,
  },
  // Featured Story style 2-Column Masonry Grid
  masonryGridContainer: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
  },
  masonryColumn: {
    flex: 1,
    flexDirection: 'column',
    gap: 6,
  },
  masonryCardWrapper: {
    width: '100%',
    position: 'relative',
  },
  cardBadgeOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeRoleText: {
    color: '#ffffff',
    fontSize: 8,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 0.5,
  },
});
