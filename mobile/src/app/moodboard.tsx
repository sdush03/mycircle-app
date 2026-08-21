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
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useScrollTabBarCollapse } from '../hooks/useScrollTabBarCollapse';
import { savesService, SavedPhotoItem } from '../services/savesService';
import { useAuthStore } from '../store/authStore';
import { tabEvents, EVENT_SAVES_UPDATED, TAB_SCROLL_TO_TOP_MOODBOARD } from '../lib/tabEvents';
import { EditorialLightbox, LightboxBounds } from '../components/home/lightbox/EditorialLightbox';
import { MasonryCard } from '../components/home/lightbox/components/MasonryCard';
import { AddInspirationModal } from '../components/moodboard/AddInspirationModal';
import { CoupleFeatureLockedModal } from '../components/moodboard/CoupleFeatureLockedModal';
import { getPhotoAspect, savePhotoAspect } from '../utils/photoDimensionCache';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../constants/fonts';

type MoodboardFilterType = 'all' | 'mine' | 'partner';

interface PendingUploadItem {
  tempId: string;
  localUri: string;
  tags: string[];
  displayRole?: string;
  failed?: boolean;
}

export default function MoodboardScreen() {
  const insets = useSafeAreaInsets();
  const handleScroll = useScrollTabBarCollapse();
  const { profile, userEvents, eventSlug } = useAuthStore();

  const [saves, setSaves] = useState<SavedPhotoItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [selectedFilter, setSelectedFilter] = useState<MoodboardFilterType>('all');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState<number | null>(null);
  const [selectedBounds, setSelectedBounds] = useState<LightboxBounds | null>(null);

  // Manual Upload Modal state (Couple only)
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  // Guest Feature Locked Modal state
  const [showLockedModal, setShowLockedModal] = useState<boolean>(false);

  // Instagram-style Background Upload queue
  const [pendingUploads, setPendingUploads] = useState<PendingUploadItem[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  const showMoodboardToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  }, []);

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

  const handleUploadButtonPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (isCoupleRole) {
      setShowUploadModal(true);
    } else {
      setShowLockedModal(true);
    }
  }, [isCoupleRole]);

  // Instagram-style background upload dispatcher
  const handleBackgroundUpload = useCallback(async (payload: { localUri: string; tags: string[]; displayRole?: string }) => {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Immediately pre-calculate local image aspect ratio for zero layout shift
    RNImage.getSize(
      payload.localUri,
      (w, h) => {
        if (w > 0 && h > 0) {
          const aspect = w / h;
          setAspectMap((prev) => ({ ...prev, [payload.localUri]: aspect }));
          savePhotoAspect(payload.localUri, aspect);
        }
      },
      () => {}
    );

    const newPendingItem: PendingUploadItem = {
      tempId,
      localUri: payload.localUri,
      tags: payload.tags,
      displayRole: payload.displayRole,
      failed: false,
    };

    setPendingUploads((prev) => [newPendingItem, ...prev]);
    showMoodboardToast('⚡ Uploading inspiration in background...');

    try {
      const saved = await savesService.uploadInspirationPhoto(
        payload.localUri,
        payload.tags,
        payload.displayRole
      );

      if (saved) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setPendingUploads((prev) => prev.filter((p) => p.tempId !== tempId));
        setSaves((prev) => [saved, ...prev.filter((s) => s.id !== saved.id && s.photoUrl !== saved.photoUrl)]);
        showMoodboardToast('Inspiration saved to Moodboard ✨');
      } else {
        throw new Error('Upload completed without saved response');
      }
    } catch (err: any) {
      console.error('[Moodboard] Background upload error:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setPendingUploads((prev) =>
        prev.map((p) => (p.tempId === tempId ? { ...p, failed: true } : p))
      );
      showMoodboardToast('⚠️ Upload failed. Tap photo to retry.');
    }
  }, [showMoodboardToast]);

  const handleRetryPendingUpload = useCallback((item: PendingUploadItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setPendingUploads((prev) => prev.filter((p) => p.tempId !== item.tempId));
    handleBackgroundUpload({
      localUri: item.localUri,
      tags: item.tags,
      displayRole: item.displayRole,
    });
  }, [handleBackgroundUpload]);

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
  }, [fetchSaves]);

  useFocusEffect(
    useCallback(() => {
      fetchSaves();
    }, [fetchSaves])
  );

  useEffect(() => {
    const unsub = tabEvents.on(EVENT_SAVES_UPDATED, () => {
      fetchSaves();
    });
    return () => unsub();
  }, [fetchSaves]);

  useEffect(() => {
    const unsub = tabEvents.on(TAB_SCROLL_TO_TOP_MOODBOARD, () => {
      mainScrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return () => unsub();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchSaves();
  }, [fetchSaves]);

  const handleUnsave = useCallback(async (item: any) => {
    const photoUrl = item.photoUrl || item.r2Url || item.uri || item.file_url;
    const photoId = item.id;
    const success = await savesService.unsavePhoto(photoUrl, photoId);
    if (success) {
      setSaves((prev) => prev.filter((s) => s.id !== photoId && s.photoUrl !== photoUrl));
      if (selectedPhotoIdx !== null) {
        setSelectedPhotoIdx(null);
        setSelectedBounds(null);
      }
    }
  }, [selectedPhotoIdx]);

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

  // Combine background optimistic uploads with confirmed saves
  const combinedSaves = React.useMemo(() => {
    const optimisticList: any[] = pendingUploads.map((p) => ({
      id: p.tempId,
      photoUrl: p.localUri,
      uri: p.localUri,
      fullUri: p.localUri,
      sourceType: 'MANUAL_UPLOAD',
      tags: p.tags,
      isPending: !p.failed,
      hasFailed: !!p.failed,
      pendingItem: p,
      savedBy: {
        name: 'YOU',
        displayRole: (effectiveDisplayRole || 'YOU') as any,
      },
      userId: profile?.id,
    }));
    return [...optimisticList, ...saves];
  }, [pendingUploads, saves, effectiveDisplayRole, profile]);

  // Extract all distinct tags present across saves
  const availableTags = React.useMemo(() => {
    const tagsFound = new Set<string>();
    combinedSaves.forEach((item) => {
      if (Array.isArray(item.tags)) {
        item.tags.forEach((t) => {
          if (t && typeof t === 'string' && t.trim()) {
            tagsFound.add(t.trim());
          }
        });
      }
    });
    return ['ALL', ...Array.from(tagsFound)];
  }, [combinedSaves]);

  // Filter saves by couple/mine/partner AND by selected tag
  const filteredSaves = React.useMemo(() => {
    return combinedSaves.filter((item) => {
      if (!isCoupleRole) {
        if (!isMine(item) && !item.isPending && !item.hasFailed) return false;
      } else {
        const itemRole = (item.savedBy?.displayRole || '').toString().toUpperCase();
        const isCoupleItem = isMine(item) || item.isPending || item.hasFailed || ['BRIDE', 'GROOM'].includes(itemRole);
        if (!isCoupleItem) return false;

        if (selectedFilter === 'mine' && !isMine(item) && !item.isPending && !item.hasFailed) return false;
        if (selectedFilter === 'partner' && (isMine(item) || item.isPending || item.hasFailed)) return false;
      }

      // Tag filter
      if (selectedTag !== 'ALL') {
        const itemTags = Array.isArray(item.tags) ? item.tags : [];
        if (!itemTags.includes(selectedTag)) return false;
      }

      return true;
    });
  }, [combinedSaves, isCoupleRole, isMine, selectedFilter, selectedTag]);

  const [aspectMap, setAspectMap] = useState<{ [url: string]: number }>({});

  useEffect(() => {
    combinedSaves.forEach((item) => {
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
  }, [combinedSaves]);

  // Shortest Column Height Balancing algorithm
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
    const isManualUpload = item.sourceType === 'MANUAL_UPLOAD';
    const isPending = !!item.isPending;
    const hasFailed = !!item.hasFailed;

    let badgeLabel = '';
    if (isPending) {
      badgeLabel = '⚡ UPLOADING...';
    } else if (hasFailed) {
      badgeLabel = '⚠️ TAP TO RETRY';
    } else if (photoMine) {
      badgeLabel = isManualUpload ? '📸 YOU' : 'YOU';
    } else if (item.savedBy?.displayRole === 'BRIDE') {
      const name = item.savedBy?.name ? item.savedBy.name.toUpperCase() : 'BRIDE';
      badgeLabel = isManualUpload ? `📸 👰 ${name}` : `👰 ${name}`;
    } else if (item.savedBy?.displayRole === 'GROOM') {
      const name = item.savedBy?.name ? item.savedBy.name.toUpperCase() : 'GROOM';
      badgeLabel = isManualUpload ? `📸 🤵 ${name}` : `🤵 ${name}`;
    } else if (item.savedBy?.name) {
      badgeLabel = item.savedBy.name.toUpperCase();
    } else {
      badgeLabel = 'PARTNER';
    }

    const itemTags: string[] = Array.isArray(item.tags) ? item.tags : [];

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
            if (hasFailed && item.pendingItem) {
              handleRetryPendingUpload(item.pendingItem);
              return;
            }
            if (isPending) {
              showMoodboardToast('⚡ Photo is uploading in background...');
              return;
            }
            setSelectedBounds(bounds);
            setSelectedPhotoIdx(item.globalIndex ?? 0);
          }}
          onRegisterRef={(id, ref) => {
            if (id) cardRefs.current[id] = ref;
            if (cardId) cardRefs.current[cardId] = ref;
          }}
        />

        {/* Top Heart / Creator / Uploading Badge */}
        <View style={[styles.cardBadgeOverlay, hasFailed && styles.cardBadgeOverlayFailed, isPending && styles.cardBadgeOverlayPending]}>
          {isPending ? (
            <ActivityIndicator size="small" color="#ffffff" style={{ transform: [{ scale: 0.65 }] }} />
          ) : hasFailed ? (
            <Ionicons name="refresh-circle" size={13} color="#ffffff" />
          ) : (
            <Ionicons name="heart" size={12} color="#ef4444" />
          )}
          <Text style={styles.badgeRoleText}>{badgeLabel}</Text>
        </View>

        {/* Bottom Tag Chips if present */}
        {itemTags.length > 0 && (
          <View style={styles.cardTagsOverlay}>
            {itemTags.slice(0, 2).map((tag, tIdx) => (
              <View key={tIdx} style={styles.cardTagPill}>
                <Text style={styles.cardTagPillText}>{tag}</Text>
              </View>
            ))}
            {itemTags.length > 2 && (
              <View style={styles.cardTagPill}>
                <Text style={styles.cardTagPillText}>+{itemTags.length - 2}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* ── Instagram-Style Floating Top Status Banner ── */}
      {toastMessage && (
        <View style={[styles.toastBannerContainer, { top: insets.top + 8 }]}>
          <View style={[styles.toastBannerCard, toastMessage.includes('⚠️') && styles.toastBannerCardError]}>
            {toastMessage.includes('⚡') ? (
              <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 6 }} />
            ) : toastMessage.includes('⚠️') ? (
              <Ionicons name="alert-circle" size={16} color="#ffffff" style={{ marginRight: 6 }} />
            ) : (
              <Ionicons name="checkmark-circle" size={16} color="#10b981" style={{ marginRight: 6 }} />
            )}
            <Text style={styles.toastBannerText}>{toastMessage}</Text>
          </View>
        </View>
      )}

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
          <View style={styles.headerTitleRow}>
            <View style={styles.headerTextGroup}>
              <Text style={styles.headerSubtitle}>
                {isCoupleRole ? 'YOUR SHARED WEDDING INSPIRATION' : 'YOUR PERSONAL VISUAL COLLECTION'}
              </Text>
              <Text style={styles.headerTitle}>
                {isCoupleRole ? 'OUR MOODBOARD' : 'MY SAVES'}
              </Text>
            </View>

            {/* Quick Header + Upload Button */}
            <Pressable
              style={styles.headerAddBtn}
              onPress={handleUploadButtonPress}
              hitSlop={8}
            >
              <Ionicons name="add" size={18} color="#ffffff" />
              <Text style={styles.headerAddBtnText}>UPLOAD</Text>
            </Pressable>
          </View>

          <Text style={styles.headerDesc}>
            {isCoupleRole
              ? 'All reference photos, screenshots, and story inspirations you and your partner collect for your photographers and stylists.'
              : 'All reference photos and story inspirations you bookmark in your personal collection.'}
          </Text>
        </View>

        {/* ── Couple Filter Pills (All / Mine / Partner) ── */}
        {isCoupleRole && (
          <View style={styles.filterPillsContainer}>
            <Pressable
              style={[styles.filterPill, selectedFilter === 'all' && styles.filterPillActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setSelectedFilter('all');
              }}
            >
              <Text style={[styles.filterPillText, selectedFilter === 'all' && styles.filterPillTextActive]}>
                ALL SAVES ({combinedSaves.length})
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, selectedFilter === 'mine' && styles.filterPillActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setSelectedFilter('mine');
              }}
            >
              <Text style={[styles.filterPillText, selectedFilter === 'mine' && styles.filterPillTextActive]}>
                MY SAVES
              </Text>
            </Pressable>

            <Pressable
              style={[styles.filterPill, selectedFilter === 'partner' && styles.filterPillActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setSelectedFilter('partner');
              }}
            >
              <Text style={[styles.filterPillText, selectedFilter === 'partner' && styles.filterPillTextActive]}>
                PARTNER'S SAVES
              </Text>
            </Pressable>
          </View>
        )}

        {/* ── Horizontal Tag Filter Bar (All / #Haldi / #Mehendi / etc.) ── */}
        {availableTags.length > 1 && (
          <View style={styles.tagBarWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tagBarScroll}
            >
              {availableTags.map((tag) => {
                const isActive = selectedTag === tag;
                return (
                  <Pressable
                    key={tag}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                      setSelectedTag(tag);
                    }}
                    style={[styles.tagBarPill, isActive && styles.tagBarPillActive]}
                  >
                    <Text style={[styles.tagBarPillText, isActive && styles.tagBarPillTextActive]}>
                      {tag}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── Section Title & Count ── */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            {selectedTag === 'ALL' ? 'SAVED INSPIRATIONS' : `${selectedTag} INSPIRATIONS`}
          </Text>
          <Text style={styles.sectionCount}>{filteredSaves.length} PHOTOS</Text>
        </View>

        {/* ── Content View ── */}
        {loading && combinedSaves.length === 0 ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="small" color="#111111" />
          </View>
        ) : filteredSaves.length === 0 ? (
          /* ── Empty Moodboard State ── */
          <View style={styles.emptyStateContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="images-outline" size={32} color="#888888" />
            </View>
            <Text style={styles.emptyTitle}>
              {selectedTag === 'ALL' ? 'YOUR MOODBOARD IS EMPTY' : `NO PHOTOS TAGGED WITH ${selectedTag}`}
            </Text>
            <Text style={styles.emptySub}>
              {selectedTag === 'ALL'
                ? 'Save photos while exploring stories or upload your own screenshots and Pinterest inspirations directly from your camera roll.'
                : `Tag your inspirations with ${selectedTag} to easily filter and view them here.`}
            </Text>

            <View style={styles.emptyActionsRow}>
              <Pressable
                style={styles.emptyUploadBtn}
                onPress={handleUploadButtonPress}
              >
                <Ionicons name="cloud-upload-outline" size={16} color="#ffffff" />
                <Text style={styles.emptyUploadBtnText}>UPLOAD INSPIRATION</Text>
              </Pressable>
              {selectedTag === 'ALL' && (
                <Pressable style={styles.exploreBtn} onPress={() => router.replace('/')}>
                  <Text style={styles.exploreBtnText}>EXPLORE STORIES</Text>
                </Pressable>
              )}
            </View>
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

      {/* ── Floating Action Button (+ Upload Inspiration) ── */}
      <Pressable
        style={styles.fabUploadButton}
        onPress={handleUploadButtonPress}
        android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
      >
        <Ionicons name="add" size={22} color="#ffffff" />
        <Text style={styles.fabUploadText}>INSPIRATION</Text>
      </Pressable>

      {/* ── Add Inspiration Modal (Couple Only) ── */}
      <AddInspirationModal
        visible={showUploadModal}
        displayRole={effectiveDisplayRole}
        onClose={() => {
          setShowUploadModal(false);
        }}
        onUploadStart={handleBackgroundUpload}
        onSuccess={(_item) => {
          fetchSaves();
        }}
      />

      {/* ── Couple Feature Locked Modal (Guests) ── */}
      <CoupleFeatureLockedModal
        visible={showLockedModal}
        onClose={() => setShowLockedModal(false)}
      />

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
  toastBannerContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 1000,
    alignItems: 'center',
  },
  toastBannerCard: {
    backgroundColor: 'rgba(17, 17, 17, 0.94)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  toastBannerCardError: {
    backgroundColor: 'rgba(220, 38, 38, 0.95)',
  },
  toastBannerText: {
    color: '#ffffff',
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 0.4,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerTextGroup: {
    flex: 1,
  },
  headerSubtitle: {
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 2.2,
    color: '#888888',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: FONT_FUTURA_BOLD,
    color: '#111111',
    letterSpacing: 0.5,
  },
  headerAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    gap: 4,
  },
  headerAddBtnText: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1,
  },
  headerDesc: {
    fontSize: 13,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
    lineHeight: 19,
  },
  // Couple Filter Pills (All Saves / My Saves / Partner's Saves)
  filterPillsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 12,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  filterPillActive: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  filterPillText: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_REGULAR,
    color: '#666666',
    letterSpacing: 0.8,
  },
  filterPillTextActive: {
    color: '#ffffff',
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
  },
  // Horizontal Tag Bar
  tagBarWrapper: {
    marginBottom: 16,
  },
  tagBarScroll: {
    paddingHorizontal: 20,
    gap: 8,
  },
  tagBarPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  tagBarPillActive: {
    backgroundColor: '#27272a',
    borderColor: '#27272a',
  },
  tagBarPillText: {
    fontSize: 11,
    fontFamily: FONT_JOST_MEDIUM,
    color: '#666666',
  },
  tagBarPillTextActive: {
    color: '#ffffff',
    fontFamily: FONT_JOST_SEMIBOLD,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.5,
    color: '#222222',
  },
  sectionCount: {
    fontSize: 11,
    fontFamily: FONT_JOST_MEDIUM,
    color: '#888888',
    letterSpacing: 0.5,
  },
  centerLoading: {
    height: 250,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateContainer: {
    paddingHorizontal: 32,
    paddingVertical: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: {
    fontSize: 14,
    fontFamily: FONT_FUTURA_BOLD,
    color: '#222222',
    letterSpacing: 1,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 24,
  },
  emptyActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emptyUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#111111',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 24,
  },
  emptyUploadBtnText: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.2,
  },
  exploreBtn: {
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 24,
  },
  exploreBtnText: {
    color: '#18181b',
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.2,
  },
  // Masonry Grid
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
  cardBadgeOverlayPending: {
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 0.5,
  },
  cardBadgeOverlayFailed: {
    backgroundColor: 'rgba(220, 38, 38, 0.85)',
  },
  badgeRoleText: {
    fontSize: 9,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#ffffff',
    letterSpacing: 0.8,
  },
  cardTagsOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  cardTagPill: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  cardTagPillText: {
    fontSize: 8,
    fontFamily: FONT_JOST_SEMIBOLD,
    color: '#ffffff',
    letterSpacing: 0.2,
  },
  // Floating Action Button (Upload Inspiration)
  fabUploadButton: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 84 : 70,
    right: 18,
    backgroundColor: '#111111',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 28,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
    zIndex: 10,
  },
  fabUploadText: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.2,
  },
});
