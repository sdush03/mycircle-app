import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
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
import { useScrollTabBarCollapse } from '../hooks/useScrollTabBarCollapse';
import { useAuthStore } from '../store/authStore';
import { savesService, SavedPhotoItem } from '../services/savesService';
import { tabEvents, TAB_OPEN_PROFILE_SETTINGS, EVENT_SAVES_UPDATED } from '../lib/tabEvents';
import { EditorialLightbox, LightboxBounds } from '../components/home/lightbox/EditorialLightbox';
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

type ProfileSubTab = 'my_photos' | 'saved_moodboard';

interface EventMatchedGroup {
  eventSlug: string;
  eventTitle: string;
  eventDate?: string;
  coverImage?: string;
  photos: any[];
}

// Helper to extract valid image URI from any backend photo object format
const getPhotoUri = (p: any): string => {
  if (!p) return '';
  if (typeof p === 'string') return p;
  return (
    p.r2Url ||
    p.thumbnailUrl ||
    p.r2_url ||
    p.file_url_mobile ||
    p.file_url ||
    p.url ||
    p.imageUrl ||
    p.photoUrl ||
    p.src ||
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

    const photoWithAspect = { ...photo, aspectRatio: cardAspect, cardAspect, globalIndex: index };
    const heightContribution = 1 / cardAspect;
    const shortestIdx = colHeights[0] <= colHeights[1] ? 0 : 1;
    cols[shortestIdx].push(photoWithAspect);
    colHeights[shortestIdx] += heightContribution;
  });

  return { column0: cols[0], column1: cols[1] };
};

export default function ProfileScreen() {
  const handleScroll = useScrollTabBarCollapse();
  const { profile, logout } = useAuthStore();

  const [activeSubTab, setActiveSubTab] = useState<ProfileSubTab>('my_photos');
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Event-grouped photos
  const [eventGroups, setEventGroups] = useState<EventMatchedGroup[]>([]);
  const [totalMatchedCount, setTotalMatchedCount] = useState<number>(0);
  const [loadingPhotos, setLoadingPhotos] = useState<boolean>(true);

  // Saved Moodboard photos
  const [savedPhotos, setSavedPhotos] = useState<SavedPhotoItem[]>([]);
  const [loadingSaves, setLoadingSaves] = useState(false);

  // MY PHOTOS lightbox state (kept separate as requested)
  const [selectedPhoto, setSelectedPhoto] = useState<any | null>(null);

  // SAVED MOODBOARD Featured Story Lightbox state & bounds
  const [selectedSavedIdx, setSelectedSavedIdx] = useState<number | null>(null);
  const [selectedSavedBounds, setSelectedSavedBounds] = useState<LightboxBounds | null>(null);

  // Fetch celebration events & matched photos grouped by event
  const fetchMyCelebrationPhotos = useCallback(async () => {
    setLoadingPhotos(true);
    try {
      // 1. Fetch user's joined celebration events
      const eventsRes = await api.get('/api/gallery/family/events');
      const eventsList = eventsRes.data?.events || [];

      // 2. Fetch all matched photos for user from my-photos endpoint as fallback/supplement
      let allMatched: any[] = [];
      try {
        const myPhotosRes = await api.get('/api/my-photos');
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
            const matchedRes = await api.get(`/api/gallery/public/events/${ev.slug}/matched-photos`);
            const raw =
              matchedRes.data?.photos ||
              matchedRes.data?.matchedPhotos ||
              (Array.isArray(matchedRes.data) ? matchedRes.data : []);
            if (Array.isArray(raw) && raw.length > 0) {
              evPhotos = raw;
            }
          } catch (_e) {}

          // Fallback: match from allMatched list if event endpoint returned empty
          if (evPhotos.length === 0 && allMatched.length > 0) {
            evPhotos = allMatched.filter(
              (p) =>
                String(p.eventSlug || '') === String(ev.slug || '') ||
                String(p.eventId || '') === String(ev.id || '') ||
                String(p.event_id || '') === String(ev.id || '')
            );
          }

          const validPhotos = evPhotos.filter((p) => !!getPhotoUri(p));
          grandTotal += validPhotos.length;

          groups.push({
            eventSlug: ev.slug,
            eventTitle: ev.title || ev.name || 'Celebration',
            eventDate: ev.date || ev.eventDate,
            coverImage: ev.coverImage || ev.imageUrl,
            photos: validPhotos,
          });
        }
      }

      // Fallback: if no events created groups, render allMatched as single celebration group
      if (grandTotal === 0 && allMatched.length > 0) {
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
      const data = await savesService.getSavedPhotos();
      setSavedPhotos(data || []);
    } catch (_err) {
      setSavedPhotos([]);
    } finally {
      setLoadingSaves(false);
    }
  }, []);

  const [aspectMap, setAspectMap] = useState<{ [url: string]: number }>({});

  useEffect(() => {
    savedPhotos.forEach((item) => {
      const url = getPhotoUri(item);
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
  }, [savedPhotos]);

  useEffect(() => {
    fetchMyCelebrationPhotos();
    fetchSavedPhotos();

    const unsubscribe = tabEvents.on(TAB_OPEN_PROFILE_SETTINGS, () => {
      setShowSettingsModal(true);
    });

    const unsubSaves = tabEvents.on(EVENT_SAVES_UPDATED, () => {
      fetchSavedPhotos();
    });

    return () => {
      unsubscribe();
      unsubSaves();
    };
  }, [fetchMyCelebrationPhotos, fetchSavedPhotos]);

  useFocusEffect(
    useCallback(() => {
      fetchSavedPhotos();
    }, [fetchSavedPhotos])
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
    if (idx < 0 || idx >= savedPhotos.length) return;
    const p = savedPhotos[idx];
    if (!p) return;
    const cardId = p.id || (p as any).uri || `photo-${idx}`;
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
  }, [savedPhotos]);

  const renderMasonryCard = (p: any, index: number, isSavedTab: boolean = false) => {
    const imgUri = getPhotoUri(p);
    const cardId = p.id || p.uri || `photo-${index}`;

    const handlePress = () => {
      if (isSavedTab) {
        const ref = cardRefs.current[cardId];
        if (ref) {
          ref.measureInWindow((x, y, w, h) => {
            setSelectedSavedBounds({ x, y, width: w, height: h });
            setSelectedSavedIdx(p.globalIndex ?? 0);
          });
        } else {
          setSelectedSavedBounds(null);
          setSelectedSavedIdx(p.globalIndex ?? 0);
        }
      } else {
        setSelectedPhoto(p);
      }
    };

    return (
      <Pressable
        key={p.id || index}
        ref={(ref) => {
          if (cardId) cardRefs.current[cardId] = ref;
        }}
        style={[styles.masonryCard, { aspectRatio: p.cardAspect || 0.75 }]}
        onPress={handlePress}
      >
        <Image source={{ uri: imgUri }} style={styles.masonryImage} resizeMode="cover" />
      </Pressable>
    );
  };

  // Render 2-column Featured Story balanced masonry grid
  const renderPhotoListMasonry = (photosList: any[], isSavedTab: boolean = false) => {
    const { column0, column1 } = balancePhotosIntoColumns(photosList, aspectMap);

    return (
      <View style={styles.masonryGridContainer}>
        <View style={styles.masonryColumn}>
          {column0.map((p, idx) => renderMasonryCard(p, idx * 2, isSavedTab))}
        </View>
        <View style={styles.masonryColumn}>
          {column1.map((p, idx) => renderMasonryCard(p, idx * 2 + 1, isSavedTab))}
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
      >
        {/* ── User Avatar & Info Card ── */}
        <View style={styles.profileHeaderCard}>
          {profile?.selfieUrl ? (
            <Image source={{ uri: profile.selfieUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>
                {profile?.name ? profile.name.charAt(0).toUpperCase() : 'U'}
              </Text>
            </View>
          )}

          <View style={styles.userMetaInfo}>
            <Text style={styles.userNameText}>{profile?.name || 'Circle Member'}</Text>
            {profile?.email && <Text style={styles.userEmailText}>{profile.email}</Text>}
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{getRoleLabel()}</Text>
            </View>
          </View>
        </View>

        {/* ── Sub-Tab Selector (MY PHOTOS vs SAVED MOODBOARD) ── */}
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
            style={[styles.subTabBtn, activeSubTab === 'saved_moodboard' && styles.subTabBtnActive]}
            onPress={() => setActiveSubTab('saved_moodboard')}
          >
            <Ionicons
              name={activeSubTab === 'saved_moodboard' ? 'heart' : 'heart-outline'}
              size={16}
              color={activeSubTab === 'saved_moodboard' ? '#111111' : '#888888'}
            />
            <Text style={[styles.subTabText, activeSubTab === 'saved_moodboard' && styles.subTabTextActive]}>
              SAVED MOODBOARD ({savedPhotos.length})
            </Text>
          </Pressable>
        </View>

        {/* ── Sub-Tab Content ── */}
        {activeSubTab === 'my_photos' ? (
          /* MY CELEBRATION PHOTOS CONTENT (Grouped by Events) */
          loadingPhotos ? (
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
                    {renderPhotoListMasonry(group.photos, false)}
                  </View>
                );
              })}
            </View>
          )
        ) : (
          /* SAVED MOODBOARD CONTENT */
          loadingSaves ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color="#111111" />
            </View>
          ) : savedPhotos.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="heart-outline" size={30} color="#888888" />
              </View>
              <Text style={styles.emptyTitle}>YOUR MOODBOARD IS EMPTY</Text>
              <Text style={styles.emptySub}>
                Heart or save photos while exploring stories & inspirations to add them to your moodboard.
              </Text>
              <Pressable style={styles.exploreBtn} onPress={() => router.replace('/moodboard')}>
                <Text style={styles.exploreBtnText}>GO TO MOODBOARD TAB</Text>
              </Pressable>
            </View>
          ) : (
            /* 2-Column Featured Story Balanced Masonry Grid for Saved Moodboard */
            renderPhotoListMasonry(savedPhotos, true)
          )
        )}
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

      {/* ── SAVED MOODBOARD Shared Universal Editorial Lightbox Modal ── */}
      {selectedSavedIdx !== null && (
        <EditorialLightbox
          visible={selectedSavedIdx !== null}
          images={savedPhotos}
          initialIndex={selectedSavedIdx}
          initialBounds={selectedSavedBounds}
          onGetBoundsForIndex={getBoundsForIndex}
          onClose={() => {
            setSelectedSavedIdx(null);
            setSelectedSavedBounds(null);
          }}
          onUnsave={handleUnsaveFromProfile}
          title="SAVED MOODBOARD"
        />
      )}

      {/* ── MY PHOTOS Standard Lightbox Modal (Kept separate as requested) ── */}
      {selectedPhoto && (
        <Modal
          visible={!!selectedPhoto}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedPhoto(null)}
        >
          <View style={styles.lightboxOverlay}>
            <SafeAreaView style={styles.lightboxSafeArea}>
              <View style={styles.lightboxHeader}>
                <Text style={styles.lightboxTitle}>PHOTO DETAIL</Text>
                <Pressable style={styles.lightboxCloseBtn} onPress={() => setSelectedPhoto(null)}>
                  <Ionicons name="close" size={24} color="#ffffff" />
                </Pressable>
              </View>

              <View style={styles.lightboxImageContainer}>
                <Image
                  source={{ uri: getPhotoUri(selectedPhoto) }}
                  style={styles.lightboxImage}
                  resizeMode="contain"
                />
              </View>
            </SafeAreaView>
          </View>
        </Modal>
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
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: '#111111',
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
