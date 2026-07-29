import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { savesService, SavedPhotoItem } from '../../services/savesService';
import { useAuthStore, GuestProfile } from '../../store/authStore';
import {
  FONT_FUTURA_BOLD,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';

const { width } = Dimensions.get('window');

interface ProfileViewProps {
  visible: boolean;
  onClose: () => void;
  profile: GuestProfile | null;
  onLogout: () => void;
}

type TopTabType = 'my_photos' | 'saves';
type SavesSubTabType = 'moodboard' | 'favorites';
type MoodboardFilterType = 'all' | 'mine' | 'partner';

export const ProfileView: React.FC<ProfileViewProps> = ({
  visible,
  onClose,
  profile,
  onLogout,
}) => {
  const insets = useSafeAreaInsets();
  const [activeTopTab, setActiveTopTab] = useState<TopTabType>('saves');
  const [savesSubTab, setSavesSubTab] = useState<SavesSubTabType>('moodboard');
  const [moodboardFilter, setMoodboardFilter] = useState<MoodboardFilterType>('all');
  const [saves, setSaves] = useState<SavedPhotoItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedPhoto, setSelectedPhoto] = useState<SavedPhotoItem | null>(null);

  const fetchSaves = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    const data = await savesService.getSavedPhotos();
    setSaves(data);
    setLoading(false);
  }, [visible]);

  useEffect(() => {
    if (visible) {
      fetchSaves();
    }
  }, [visible, fetchSaves]);

  const handleUnsave = async (item: SavedPhotoItem) => {
    const success = await savesService.unsavePhoto(item.photoUrl, item.id);
    if (success) {
      setSaves((prev) => prev.filter((s) => s.id !== item.id));
      if (selectedPhoto?.id === item.id) {
        setSelectedPhoto(null);
      }
    }
  };

  // Helper to check if a saved item belongs to current user
  const isMine = (item: SavedPhotoItem) => {
    if (!profile) return false;
    
    // 1. Check user ID / selfieGuestId
    if (profile.id && String(item.userId) === String(profile.id)) return true;
    if (profile.selfieGuestId && String(item.userId) === String(profile.selfieGuestId)) return true;
    
    // 2. Check email match
    if (
      profile.email &&
      item.savedBy?.email &&
      String(item.savedBy.email).toLowerCase().trim() === String(profile.email).toLowerCase().trim()
    ) {
      return true;
    }
    
    // 3. Check display role match (e.g. BRIDE vs GROOM)
    if (profile.displayRole && item.savedBy?.displayRole) {
      return profile.displayRole === item.savedBy.displayRole;
    }

    return false;
  };

  const isCoupleRole = profile?.displayRole === 'BRIDE' || profile?.displayRole === 'GROOM';

  const filteredMoodboardSaves = saves.filter((item) => {
    if (!isCoupleRole) {
      return isMine(item);
    }
    if (moodboardFilter === 'mine') {
      return isMine(item);
    }
    if (moodboardFilter === 'partner') {
      return !isMine(item);
    }
    return true;
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Top Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Account Profile</Text>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>

        {/* User Profile Info Section */}
        <View style={styles.userSection}>
          {profile?.selfieUrl ? (
            <Image source={{ uri: profile.selfieUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>
                {profile?.name ? profile.name.charAt(0).toUpperCase() : 'U'}
              </Text>
            </View>
          )}
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{profile?.name || 'Circle Member'}</Text>
            {profile?.email ? (
              <Text style={styles.userEmail}>{profile.email}</Text>
            ) : null}

            {/* Admin-assigned Role Badge (Read-only) */}
            {profile?.displayRole === 'BRIDE' ? (
              <View style={styles.roleBadgeContainer}>
                <Text style={styles.roleBadgeTextReadOnly}>👰 Bride</Text>
              </View>
            ) : profile?.displayRole === 'GROOM' ? (
              <View style={styles.roleBadgeContainer}>
                <Text style={styles.roleBadgeTextReadOnly}>🤵 Groom</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── TOP-LEVEL SEGMENTED TABS: My Photos vs Saves ── */}
        <View style={styles.topTabContainer}>
          <Pressable
            style={[
              styles.topTabButton,
              activeTopTab === 'my_photos' && styles.activeTopTabButton,
            ]}
            onPress={() => setActiveTopTab('my_photos')}
          >
            <Text
              style={[
                styles.topTabText,
                activeTopTab === 'my_photos' && styles.activeTopTabText,
              ]}
            >
              My Photos
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.topTabButton,
              activeTopTab === 'saves' && styles.activeTopTabButton,
            ]}
            onPress={() => setActiveTopTab('saves')}
          >
            <Text
              style={[
                styles.topTabText,
                activeTopTab === 'saves' && styles.activeTopTabText,
              ]}
            >
              Saves
            </Text>
          </Pressable>
        </View>

        {/* Tab Content */}
        {activeTopTab === 'saves' ? (
          <View style={styles.savesTabWrapper}>
            {/* ── SUB-TABS: Moodboard vs Event Favorites ── */}
            <View style={styles.subTabContainer}>
              <Pressable
                style={[
                  styles.subTabPill,
                  savesSubTab === 'moodboard' && styles.activeSubTabPill,
                ]}
                onPress={() => setSavesSubTab('moodboard')}
              >
                <Text
                  style={[
                    styles.subTabText,
                    savesSubTab === 'moodboard' && styles.activeSubTabText,
                  ]}
                >
                  Moodboard ({saves.length})
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.subTabPill,
                  savesSubTab === 'favorites' && styles.activeSubTabPill,
                ]}
                onPress={() => setSavesSubTab('favorites')}
              >
                <Text
                  style={[
                    styles.subTabText,
                    savesSubTab === 'favorites' && styles.activeSubTabText,
                  ]}
                >
                  Event Favorites ❤️
                </Text>
              </Pressable>
            </View>

            {/* Sub-Tab 1: Moodboard (Inspo Saves) */}
            {savesSubTab === 'moodboard' ? (
              <View style={styles.subContentContainer}>
                {/* Moodboard Filter Pills: All | Mine | Partner's (Only shown for Bride or Groom) */}
                {isCoupleRole && (
                  <View style={styles.filterContainer}>
                    <Pressable
                      style={[
                        styles.filterPill,
                        moodboardFilter === 'all' && styles.activeFilterPill,
                      ]}
                      onPress={() => setMoodboardFilter('all')}
                    >
                      <Text
                        style={[
                          styles.filterText,
                          moodboardFilter === 'all' && styles.activeFilterText,
                        ]}
                      >
                        All
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.filterPill,
                        moodboardFilter === 'mine' && styles.activeFilterPill,
                      ]}
                      onPress={() => setMoodboardFilter('mine')}
                    >
                      <Text
                        style={[
                          styles.filterText,
                          moodboardFilter === 'mine' && styles.activeFilterText,
                        ]}
                      >
                        Mine
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.filterPill,
                        moodboardFilter === 'partner' && styles.activeFilterPill,
                      ]}
                      onPress={() => setMoodboardFilter('partner')}
                    >
                      <Text
                        style={[
                          styles.filterText,
                          moodboardFilter === 'partner' && styles.activeFilterText,
                        ]}
                      >
                        Partner's
                      </Text>
                    </Pressable>
                  </View>
                )}

                {loading ? (
                  <ActivityIndicator size="large" color="#000" style={{ marginTop: 40 }} />
                ) : filteredMoodboardSaves.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyTitle}>No moodboard saves found</Text>
                    <Text style={styles.emptySub}>
                      Bookmark photos in Featured Stories to curate your inspo moodboard here!
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={filteredMoodboardSaves}
                    numColumns={2}
                    keyExtractor={(item) => String(item.id)}
                    contentContainerStyle={styles.gridList}
                    renderItem={({ item }) => (
                      <Pressable
                        style={styles.gridCard}
                        onPress={() => setSelectedPhoto(item)}
                      >
                        <Image
                          source={{ uri: item.photoUrl }}
                          style={styles.gridImage}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                        />
                        {/* Source Badge */}
                        <View style={styles.sourceBadge}>
                          <Text style={styles.sourceBadgeText}>
                            {item.savedBy.displayRole === 'BRIDE'
                              ? '👰 Bride'
                              : item.savedBy.displayRole === 'GROOM'
                              ? '🤵 Groom'
                              : item.savedBy.name}
                          </Text>
                        </View>
                      </Pressable>
                    )}
                  />
                )}
              </View>
            ) : (
              /* Sub-Tab 2: Event Favorites (Liked Photos) */
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyTitle}>Event Favorites</Text>
                <Text style={styles.emptySub}>
                  Photos you like (❤️) in your event gallery will appear here.
                </Text>
              </View>
            )}
          </View>
        ) : (
          /* Top-Level Tab 2: My Photos */
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>My Event Photos</Text>
            <Text style={styles.emptySub}>
              Photos matched to you after the event will appear here automatically.
            </Text>
          </View>
        )}

        {/* Footer Actions */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Pressable style={styles.logoutBtn} onPress={onLogout}>
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>
        </View>

        {/* Lightbox Preview for Selected Saved Photo */}
        {selectedPhoto && (
          <Modal
            transparent
            visible
            animationType="fade"
            onRequestClose={() => setSelectedPhoto(null)}
          >
            <View style={styles.lightboxBg}>
              <Pressable style={styles.lightboxClose} onPress={() => setSelectedPhoto(null)}>
                <Text style={styles.lightboxCloseText}>✕</Text>
              </Pressable>
              <Image
                source={{ uri: selectedPhoto.photoUrl }}
                style={styles.lightboxImg}
                contentFit="contain"
              />
              <View style={styles.lightboxBar}>
                <Text style={styles.lightboxAuthor}>
                  Saved by {selectedPhoto.savedBy.displayRole || selectedPhoto.savedBy.name}
                </Text>
                <Pressable
                  style={styles.unsaveBtn}
                  onPress={() => handleUnsave(selectedPhoto)}
                >
                  <Text style={styles.unsaveText}>Remove Save</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF9F6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  headerTitle: {
    fontFamily: FONT_FUTURA_BOLD || 'System',
    fontSize: 18,
    color: '#111',
    letterSpacing: 1,
  },
  closeBtn: {
    padding: 8,
  },
  closeBtnText: {
    fontSize: 18,
    color: '#666',
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  userInfo: {
    marginLeft: 14,
  },
  userName: {
    fontFamily: FONT_JOST_SEMIBOLD || 'System',
    fontSize: 16,
    color: '#111',
  },
  userEmail: {
    fontFamily: FONT_JOST_REGULAR || 'System',
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  roleBadgeContainer: {
    backgroundColor: '#111',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  roleBadgeTextReadOnly: {
    color: '#FFF',
    fontSize: 11,
    fontFamily: FONT_JOST_SEMIBOLD || FONT_JOST_MEDIUM || 'System',
    fontWeight: '600',
  },

  /* ── TOP TABS: My Photos | Saves ── */
  topTabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: '#EAE8E3',
    borderRadius: 25,
    padding: 4,
    marginBottom: 12,
  },
  topTabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 20,
  },
  activeTopTabButton: {
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  topTabText: {
    fontFamily: FONT_JOST_MEDIUM || 'System',
    fontSize: 14,
    color: '#666',
  },
  activeTopTabText: {
    color: '#111',
    fontWeight: '600',
  },

  /* ── SAVES SUB-TABS: Moodboard | Event Favorites ── */
  savesTabWrapper: {
    flex: 1,
  },
  subTabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  subTabPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#EAE8E3',
    marginRight: 10,
  },
  activeSubTabPill: {
    backgroundColor: '#111',
  },
  subTabText: {
    fontFamily: FONT_JOST_MEDIUM || 'System',
    fontSize: 13,
    color: '#555',
  },
  activeSubTabText: {
    color: '#FFF',
    fontWeight: '600',
  },

  /* ── MOODBOARD FILTERS: All | Mine | Partner's ── */
  subContentContainer: {
    flex: 1,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#FFF',
    marginRight: 8,
  },
  activeFilterPill: {
    borderColor: '#111',
    backgroundColor: '#111',
  },
  filterText: {
    fontFamily: FONT_JOST_REGULAR || 'System',
    fontSize: 12,
    color: '#666',
  },
  activeFilterText: {
    color: '#FFF',
    fontWeight: '600',
  },

  /* ── PHOTO GRID ── */
  gridList: {
    paddingHorizontal: 15,
  },
  gridCard: {
    flex: 1,
    margin: 5,
    height: (width - 40) / 2 * 1.3,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#DDD',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  sourceBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  sourceBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontFamily: FONT_JOST_MEDIUM || 'System',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontFamily: FONT_FUTURA_BOLD || 'System',
    fontSize: 16,
    color: '#333',
    marginBottom: 6,
  },
  emptySub: {
    fontFamily: FONT_JOST_REGULAR || 'System',
    fontSize: 13,
    color: '#777',
    textAlign: 'center',
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  logoutBtn: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#EAE8E3',
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
  },
  logoutText: {
    fontFamily: FONT_JOST_SEMIBOLD || 'System',
    fontSize: 14,
    color: '#D93838',
  },
  lightboxBg: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  lightboxCloseText: {
    color: '#FFF',
    fontSize: 22,
  },
  lightboxImg: {
    width: '100%',
    height: '80%',
  },
  lightboxBar: {
    position: 'absolute',
    bottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '90%',
  },
  lightboxAuthor: {
    color: '#FFF',
    fontFamily: FONT_JOST_MEDIUM || 'System',
    fontSize: 14,
  },
  unsaveBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  unsaveText: {
    color: '#FF6B6B',
    fontSize: 12,
    fontWeight: '600',
  },
});
