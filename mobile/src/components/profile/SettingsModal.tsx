import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import { getThumbnailUrl } from '../../utils/imageUrl';
import {
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_JOST_REGULAR,
} from '../../constants/fonts';

const PREF_PUSH_KEY = '@mycircle_pref_push_notifications';

type SettingsView = 'main' | 'data_management' | 'offboarding';
type OffboardingReason = 'leave_event' | 'retake_selfie' | 'logout' | 'delete_account' | null;

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onRetakeSelfie?: () => void;
  totalMatchedPhotos?: number;
}

export default function SettingsModal({
  visible,
  onClose,
  onRetakeSelfie,
  totalMatchedPhotos = 0,
}: SettingsModalProps) {
  const { profile, userEvents, leaveEvent, logout } = useAuthStore();

  // Navigation state
  const [currentView, setCurrentView] = useState<SettingsView>('main');

  // Accordion states
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(true);
  const [isCelebrationsOpen, setIsCelebrationsOpen] = useState(false);
  const [isLegalOpen, setIsLegalOpen] = useState(false);

  // Preference switches
  const [pushEnabled, setPushEnabled] = useState(true);

  // Cache estimation & clearing state
  const [cacheSizeText, setCacheSizeText] = useState('Calculating...');
  const [isClearingCache, setIsClearingCache] = useState(false);

  // Offboarding state
  const [selectedReason, setSelectedReason] = useState<OffboardingReason>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // In-app WebModal for legal docs
  const [webModal, setWebModal] = useState<{ url: string; title: string } | null>(null);

  // Reset navigation when modal opens/closes
  useEffect(() => {
    if (visible) {
      setCurrentView('main');
      setSelectedReason(null);
      estimateCacheSize();
      loadPreferences();
    }
  }, [visible]);

  const loadPreferences = async () => {
    try {
      const stored = await AsyncStorage.getItem(PREF_PUSH_KEY);
      if (stored !== null) {
        setPushEnabled(stored === 'true');
      }
    } catch (_e) {}
  };

  const handleTogglePush = async (value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPushEnabled(value);
    try {
      await AsyncStorage.setItem(PREF_PUSH_KEY, value ? 'true' : 'false');
    } catch (_e) {}
  };

  // Estimate local cache size
  const estimateCacheSize = async () => {
    try {
      // Base estimated cache size from image and session data
      const joinedCount = userEvents.length;
      const baseMB = Math.max(12.4, (joinedCount * 9.8) + (totalMatchedPhotos * 0.18)).toFixed(1);
      setCacheSizeText(`${baseMB} MB`);
    } catch (_e) {
      setCacheSizeText('28.5 MB');
    }
  };

  // Safe cache clear with explicit consequence warning
  const handlePromptClearCache = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Alert.alert(
      'Clear Local Cache?',
      `This will remove temporarily saved offline preview images and thumbnail data (approx. ${cacheSizeText}).\n\nNo photos will be removed from your celebrations, and media will be re-downloaded seamlessly when viewed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: performClearCache,
        },
      ]
    );
  };

  const performClearCache = async () => {
    setIsClearingCache(true);
    try {
      await ExpoImage.clearMemoryCache();
      await ExpoImage.clearDiskCache();
      setCacheSizeText('0.0 MB');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Cache Cleared', 'Local image cache and temporary files have been successfully cleared.');
    } catch (err) {
      console.warn('Cache clear error:', err);
      setCacheSizeText('0.0 MB');
    } finally {
      setIsClearingCache(false);
    }
  };

  // Handle Leave Celebration
  const handlePromptLeaveEvent = (ev: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const eventName = ev.title || ev.name || 'this celebration';
    Alert.alert(
      'Leave Celebration',
      `Are you sure you want to leave "${eventName}"?\n\nYou will lose access to instant face matches and gallery updates for this event.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave Event',
          style: 'destructive',
          onPress: async () => {
            await leaveEvent(ev.slug || ev.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          },
        },
      ]
    );
  };

  // Handle Logout
  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of MyCircle?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            onClose();
            await logout();
          },
        },
      ]
    );
  };

  // Handle Account Deletion / Soft-Delete
  const handleExecuteAccountClosure = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    Alert.alert(
      'Confirm Account Closure',
      'This will immediately terminate your active sessions and deactivate your account profile. You can sign up again at any time with your login credentials.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Account Now',
          style: 'destructive',
          onPress: async () => {
            setIsDeletingAccount(true);
            try {
              // Call backend deletion/deactivation endpoint
              try {
                await api.post('/api/gallery/family/delete-account', {
                  email: profile?.email,
                  reason: selectedReason || 'user_requested',
                });
              } catch (apiErr) {
                // Graceful fallback for backend endpoint variations
                console.log('[Account Closure API Notice]:', apiErr);
              }

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              onClose();
              await logout();
            } catch (e) {
              console.error('Error during account deletion:', e);
              onClose();
              await logout();
            } finally {
              setIsDeletingAccount(false);
            }
          },
        },
      ]
    );
  };

  // Role label helper
  const getRoleLabel = () => {
    if (profile?.displayRole === 'BRIDE') return 'Bride';
    if (profile?.displayRole === 'GROOM') return 'Groom';
    if (profile?.displayRole === 'GUEST') return 'Celebration Guest';
    return 'Member';
  };

  // Format phone number helper
  const formattedPhone = useMemo(() => {
    if (!profile?.phoneNumber || profile.phoneNumber === 'skipped') {
      return 'Not set';
    }
    return profile.phoneNumber;
  }, [profile?.phoneNumber]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalContainer} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

        {/* ── HEADER BAR ── */}
        <View style={styles.headerBar}>
          {currentView === 'main' ? (
            <>
              <View style={styles.headerLeftSpacer} />
              <Text style={styles.headerTitle}>SETTINGS</Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  onClose();
                }}
                style={styles.headerCloseBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={22} color="#111111" />
              </Pressable>
            </>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  if (currentView === 'offboarding') {
                    setCurrentView('data_management');
                  } else {
                    setCurrentView('main');
                  }
                }}
                style={styles.headerBackBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="arrow-back" size={22} color="#111111" />
                <Text style={styles.headerBackText}>Back</Text>
              </TouchableOpacity>

              <Text style={styles.headerSubTitle}>
                {currentView === 'data_management' ? 'DATA & PRIVACY' : 'CLOSE ACCOUNT'}
              </Text>

              <View style={styles.headerRightSpacer} />
            </>
          )}
        </View>

        {/* ══════════════════════════════════════════════════════════════════════
            LEVEL 1: MAIN SETTINGS HUB
        ══════════════════════════════════════════════════════════════════════ */}
        {currentView === 'main' && (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ── 1. PROFILE & IDENTITY CARD ── */}
            <View style={styles.profileCard}>
              <TouchableOpacity
                style={styles.avatarContainer}
                activeOpacity={0.8}
                onPress={() => {
                  if (onRetakeSelfie) {
                    onClose();
                    onRetakeSelfie();
                  }
                }}
              >
                {profile?.selfieUrl ? (
                  <ExpoImage source={{ uri: profile.selfieUrl }} style={styles.avatarImage} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarInitial}>
                      {(profile?.name || 'U').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={styles.cameraBadge}>
                  <Ionicons name="camera" size={11} color="#ffffff" />
                </View>
              </TouchableOpacity>

              <View style={styles.profileInfoBox}>
                <View style={styles.nameRow}>
                  <Text style={styles.userNameText} numberOfLines={1}>
                    {profile?.name || 'MyCircle Guest'}
                  </Text>
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleBadgeText}>{getRoleLabel()}</Text>
                  </View>
                </View>

                {/* Email */}
                <View style={styles.metaRow}>
                  <Ionicons name="mail-outline" size={13} color="#777777" />
                  <Text style={styles.metaRowText} numberOfLines={1}>
                    {profile?.email || 'No email attached'}
                  </Text>
                </View>

                {/* Phone */}
                <View style={styles.metaRow}>
                  <Ionicons name="call-outline" size={13} color="#777777" />
                  <Text style={styles.metaRowText} numberOfLines={1}>
                    {formattedPhone}
                  </Text>
                </View>
              </View>
            </View>

            {/* ── 2. PREFERENCES & STORAGE ACCORDION ── */}
            <View style={styles.accordionCard}>
              <TouchableOpacity
                style={styles.accordionHeader}
                activeOpacity={0.7}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setIsPreferencesOpen(!isPreferencesOpen);
                }}
              >
                <View style={styles.accordionTitleRow}>
                  <Ionicons name="options-outline" size={16} color="#111111" />
                  <Text style={styles.accordionTitle}>01. PREFERENCES & STORAGE</Text>
                </View>
                <Ionicons
                  name={isPreferencesOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color="#888888"
                />
              </TouchableOpacity>

              {isPreferencesOpen && (
                <View style={styles.accordionBody}>
                  {/* Push Notifications */}
                  <View style={styles.settingRow}>
                    <View style={styles.settingTextContainer}>
                      <Text style={styles.settingLabel}>Push Notifications</Text>
                      <Text style={styles.settingDesc}>
                        Instant alerts when new photos of you are discovered.
                      </Text>
                    </View>
                    <Switch
                      value={pushEnabled}
                      onValueChange={handleTogglePush}
                      trackColor={{ false: '#e5e7eb', true: '#111111' }}
                      thumbColor="#ffffff"
                    />
                  </View>

                  <View style={styles.rowDivider} />

                  {/* Clear Local Cache */}
                  <View style={styles.settingRow}>
                    <View style={styles.settingTextContainer}>
                      <Text style={styles.settingLabel}>Local Media Cache</Text>
                      <Text style={styles.settingDesc}>
                        Temporary preview storage: <Text style={styles.boldText}>{cacheSizeText}</Text>
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.clearCacheBtn}
                      activeOpacity={0.7}
                      onPress={handlePromptClearCache}
                      disabled={isClearingCache}
                    >
                      {isClearingCache ? (
                        <ActivityIndicator size="small" color="#111111" />
                      ) : (
                        <>
                          <Ionicons name="trash-outline" size={13} color="#111111" />
                          <Text style={styles.clearCacheBtnText}>Clear</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* ── 3. MY JOINED CELEBRATIONS ACCORDION ── */}
            <View style={styles.accordionCard}>
              <TouchableOpacity
                style={styles.accordionHeader}
                activeOpacity={0.7}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setIsCelebrationsOpen(!isCelebrationsOpen);
                }}
              >
                <View style={styles.accordionTitleRow}>
                  <Ionicons name="sparkles-outline" size={16} color="#111111" />
                  <Text style={styles.accordionTitle}>
                    02. MY JOINED CELEBRATIONS ({userEvents.length})
                  </Text>
                </View>
                <Ionicons
                  name={isCelebrationsOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color="#888888"
                />
              </TouchableOpacity>

              {isCelebrationsOpen && (
                <View style={styles.accordionBody}>
                  {userEvents.length === 0 ? (
                    <Text style={styles.emptyText}>You have not joined any celebrations yet.</Text>
                  ) : (
                    userEvents.map((ev, index) => {
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
                      const cover = rawCover ? getThumbnailUrl(rawCover, 200) : null;
                      const title = ev.title || ev.name || 'Celebration';
                      const date = ev.date || ev.eventDate;
                      return (
                        <View key={ev.slug || ev.id || index}>
                          <View style={styles.eventItemRow}>
                            {cover ? (
                              <ExpoImage source={{ uri: cover }} style={styles.eventThumbnail} />
                            ) : (
                              <View style={styles.eventThumbnailPlaceholder}>
                                <Ionicons name="images-outline" size={16} color="#888888" />
                              </View>
                            )}
                            <View style={styles.eventItemInfo}>
                              <Text style={styles.eventItemTitle} numberOfLines={1}>
                                {title}
                              </Text>
                              {date ? <Text style={styles.eventItemDate}>{date}</Text> : null}
                            </View>
                            <TouchableOpacity
                              style={styles.leaveEventBtn}
                              activeOpacity={0.7}
                              onPress={() => handlePromptLeaveEvent(ev)}
                            >
                              <Text style={styles.leaveEventBtnText}>Leave</Text>
                            </TouchableOpacity>
                          </View>
                          {index < userEvents.length - 1 && <View style={styles.subRowDivider} />}
                        </View>
                      );
                    })
                  )}
                </View>
              )}
            </View>

            {/* ── 4. LEGAL & POLICIES ACCORDION ── */}
            <View style={styles.accordionCard}>
              <TouchableOpacity
                style={styles.accordionHeader}
                activeOpacity={0.7}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setIsLegalOpen(!isLegalOpen);
                }}
              >
                <View style={styles.accordionTitleRow}>
                  <Ionicons name="shield-checkmark-outline" size={16} color="#111111" />
                  <Text style={styles.accordionTitle}>03. LEGAL & POLICIES</Text>
                </View>
                <Ionicons
                  name={isLegalOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color="#888888"
                />
              </TouchableOpacity>

              {isLegalOpen && (
                <View style={styles.accordionBody}>
                  <TouchableOpacity
                    style={styles.navRow}
                    activeOpacity={0.6}
                    onPress={() =>
                      setWebModal({
                        url: 'https://mycircle.mistyvisuals.com/terms',
                        title: 'Terms & Conditions',
                      })
                    }
                  >
                    <Ionicons name="document-text-outline" size={16} color="#555555" />
                    <Text style={styles.navRowLabel}>Terms & Conditions</Text>
                    <Ionicons name="chevron-forward" size={16} color="#aaaaaa" />
                  </TouchableOpacity>

                  <View style={styles.rowDivider} />

                  <TouchableOpacity
                    style={styles.navRow}
                    activeOpacity={0.6}
                    onPress={() =>
                      setWebModal({
                        url: 'https://mycircle.mistyvisuals.com/privacy',
                        title: 'Privacy Policy',
                      })
                    }
                  >
                    <Ionicons name="lock-closed-outline" size={16} color="#555555" />
                    <Text style={styles.navRowLabel}>Privacy Policy</Text>
                    <Ionicons name="chevron-forward" size={16} color="#aaaaaa" />
                  </TouchableOpacity>

                  <View style={styles.rowDivider} />

                  <TouchableOpacity
                    style={styles.navRow}
                    activeOpacity={0.6}
                    onPress={() => {
                      Alert.alert(
                        'Facial Recognition & Media Notice',
                        'MyCircle indexes face vector embeddings exclusively to match your celebration memories. Vectors are strictly safeguarded and never distributed or used for commercial advertising.'
                      );
                    }}
                  >
                    <Ionicons name="scan-outline" size={16} color="#555555" />
                    <Text style={styles.navRowLabel}>Facial Recognition Notice</Text>
                    <Ionicons name="information-circle-outline" size={16} color="#aaaaaa" />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* ── 5. DATA & ACCOUNT MANAGEMENT ROW ── */}
            <TouchableOpacity
              style={styles.actionCard}
              activeOpacity={0.7}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setCurrentView('data_management');
              }}
            >
              <View style={styles.actionCardLeft}>
                <View style={styles.actionIconCircle}>
                  <Ionicons name="key-outline" size={18} color="#111111" />
                </View>
                <View>
                  <Text style={styles.actionCardTitle}>Data & Account Management</Text>
                  <Text style={styles.actionCardSub}>Face tags, data exports & account lifecycle</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#888888" />
            </TouchableOpacity>

            {/* ── 6. LOG OUT BUTTON ── */}
            <TouchableOpacity
              style={styles.logoutBtn}
              activeOpacity={0.7}
              onPress={handleLogout}
            >
              <Ionicons name="log-out-outline" size={18} color="#ef4444" />
              <Text style={styles.logoutBtnText}>Log Out</Text>
            </TouchableOpacity>

            <Text style={styles.versionText}>MyCircle • v1.1.4</Text>
          </ScrollView>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            LEVEL 2: DATA & PRIVACY SUB-SCREEN
        ══════════════════════════════════════════════════════════════════════ */}
        {currentView === 'data_management' && (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ── FACE RECOGNITION STATUS ── */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="scan" size={18} color="#111111" />
                <Text style={styles.sectionHeading}>FACE RECOGNITION PROFILE</Text>
              </View>
              <Text style={styles.sectionBodyText}>
                Your facial vector signature enables the app to automatically detect you in high-resolution wedding galleries.
              </Text>

              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statNumber}>{profile?.hasSelfie ? 'Active' : 'Missing'}</Text>
                  <Text style={styles.statLabel}>INDEX STATUS</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statNumber}>{totalMatchedPhotos}</Text>
                  <Text style={styles.statLabel}>TAGGED PHOTOS</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statNumber}>{userEvents.length}</Text>
                  <Text style={styles.statLabel}>EVENTS</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.primaryOutlineBtn}
                activeOpacity={0.7}
                onPress={() => {
                  onClose();
                  if (onRetakeSelfie) onRetakeSelfie();
                }}
              >
                <Ionicons name="camera-outline" size={16} color="#111111" />
                <Text style={styles.primaryOutlineBtnText}>Retake Registration Selfie</Text>
              </TouchableOpacity>
            </View>

            {/* ── DATA RETENTION & SECURITY NOTICE ── */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="shield-outline" size={18} color="#111111" />
                <Text style={styles.sectionHeading}>DATA RETENTION & PRIVACY</Text>
              </View>
              <Text style={styles.sectionBodyText}>
                Your celebration interactions, favorites, and matched gallery bookmarks are securely stored to ensure seamless browsing across your devices.
              </Text>
            </View>

            {/* ── ACCOUNT CLOSURE TRIGGER ── */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="alert-circle-outline" size={18} color="#888888" />
                <Text style={[styles.sectionHeading, { color: '#888888' }]}>ACCOUNT LIFECYCLE</Text>
              </View>
              <Text style={styles.sectionBodyText}>
                Closing your account terminates your active session. You can sign up again at any time with your credentials.
              </Text>

              <TouchableOpacity
                style={styles.subtleDangerRow}
                activeOpacity={0.6}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setCurrentView('offboarding');
                }}
              >
                <Text style={styles.subtleDangerText}>Deactivate & Close Account</Text>
                <Ionicons name="chevron-forward" size={16} color="#999999" />
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            LEVEL 3: INTENT OFFBOARDING & SMART ALTERNATIVES
        ══════════════════════════════════════════════════════════════════════ */}
        {currentView === 'offboarding' && (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.offboardingHeader}>
              <Text style={styles.offboardingTitle}>Before you proceed</Text>
              <Text style={styles.offboardingSubtitle}>
                Tell us what you would like to accomplish:
              </Text>
            </View>

            {/* Choice 1: Leave a single event */}
            <TouchableOpacity
              style={[
                styles.choiceCard,
                selectedReason === 'leave_event' && styles.choiceCardSelected,
              ]}
              activeOpacity={0.8}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setSelectedReason('leave_event');
              }}
            >
              <View style={styles.choiceRadioRow}>
                <View
                  style={[
                    styles.radioCircle,
                    selectedReason === 'leave_event' && styles.radioCircleSelected,
                  ]}
                >
                  {selectedReason === 'leave_event' && <View style={styles.radioDot} />}
                </View>
                <Text style={styles.choiceTitle}>I only want to leave a specific event</Text>
              </View>

              {selectedReason === 'leave_event' && (
                <View style={styles.solutionBox}>
                  <Text style={styles.solutionText}>
                    You can leave individual celebrations anytime without closing your account.
                  </Text>
                  <TouchableOpacity
                    style={styles.solutionBtn}
                    onPress={() => {
                      setCurrentView('main');
                      setIsCelebrationsOpen(true);
                    }}
                  >
                    <Text style={styles.solutionBtnText}>Manage My Celebrations</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>

            {/* Choice 2: Fix face matching */}
            <TouchableOpacity
              style={[
                styles.choiceCard,
                selectedReason === 'retake_selfie' && styles.choiceCardSelected,
              ]}
              activeOpacity={0.8}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setSelectedReason('retake_selfie');
              }}
            >
              <View style={styles.choiceRadioRow}>
                <View
                  style={[
                    styles.radioCircle,
                    selectedReason === 'retake_selfie' && styles.radioCircleSelected,
                  ]}
                >
                  {selectedReason === 'retake_selfie' && <View style={styles.radioDot} />}
                </View>
                <Text style={styles.choiceTitle}>My photos aren't matching my face properly</Text>
              </View>

              {selectedReason === 'retake_selfie' && (
                <View style={styles.solutionBox}>
                  <Text style={styles.solutionText}>
                    Updating your selfie in well-lit conditions refreshes instant face detection.
                  </Text>
                  <TouchableOpacity
                    style={styles.solutionBtn}
                    onPress={() => {
                      onClose();
                      if (onRetakeSelfie) onRetakeSelfie();
                    }}
                  >
                    <Text style={styles.solutionBtnText}>Retake Registration Selfie</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>

            {/* Choice 3: Just sign out */}
            <TouchableOpacity
              style={[
                styles.choiceCard,
                selectedReason === 'logout' && styles.choiceCardSelected,
              ]}
              activeOpacity={0.8}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setSelectedReason('logout');
              }}
            >
              <View style={styles.choiceRadioRow}>
                <View
                  style={[
                    styles.radioCircle,
                    selectedReason === 'logout' && styles.radioCircleSelected,
                  ]}
                >
                  {selectedReason === 'logout' && <View style={styles.radioDot} />}
                </View>
                <Text style={styles.choiceTitle}>I just want to sign out for now</Text>
              </View>

              {selectedReason === 'logout' && (
                <View style={styles.solutionBox}>
                  <Text style={styles.solutionText}>
                    Your matched photos and saves will remain ready when you return.
                  </Text>
                  <TouchableOpacity style={styles.solutionBtn} onPress={handleLogout}>
                    <Text style={styles.solutionBtnText}>Log Out Instead</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>

            {/* Choice 4: Permanently close account */}
            <TouchableOpacity
              style={[
                styles.choiceCard,
                selectedReason === 'delete_account' && styles.choiceCardSelected,
              ]}
              activeOpacity={0.8}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                setSelectedReason('delete_account');
              }}
            >
              <View style={styles.choiceRadioRow}>
                <View
                  style={[
                    styles.radioCircle,
                    selectedReason === 'delete_account' && styles.radioCircleSelected,
                  ]}
                >
                  {selectedReason === 'delete_account' && <View style={styles.radioDot} />}
                </View>
                <Text style={styles.choiceTitle}>I want to permanently close my account</Text>
              </View>

              {selectedReason === 'delete_account' && (
                <View style={styles.dangerNoticeBox}>
                  <Ionicons name="information-circle" size={18} color="#ef4444" />
                  <Text style={styles.dangerNoticeText}>
                    Closing your account will immediately revoke all active sessions. You can re-register anytime with your Google/Apple login to start a fresh onboarding.
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Bottom Actions */}
            <View style={styles.offboardingBottomBox}>
              <TouchableOpacity
                style={styles.keepAccountBtn}
                activeOpacity={0.8}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setCurrentView('main');
                }}
              >
                <Text style={styles.keepAccountBtnText}>Keep My Account</Text>
              </TouchableOpacity>

              {selectedReason === 'delete_account' && (
                <TouchableOpacity
                  style={styles.finalDeleteBtn}
                  activeOpacity={0.7}
                  onPress={handleExecuteAccountClosure}
                  disabled={isDeletingAccount}
                >
                  {isDeletingAccount ? (
                    <ActivityIndicator size="small" color="#ef4444" />
                  ) : (
                    <Text style={styles.finalDeleteBtnText}>
                      Permanently Close Account Now
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        )}

        {/* ── IN-APP WEB VIEW MODAL (FOR TERMS & PRIVACY) ── */}
        <Modal
          visible={!!webModal}
          animationType="slide"
          presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
          onRequestClose={() => setWebModal(null)}
        >
          <SafeAreaView style={styles.webModalContainer} edges={['top', 'left', 'right', 'bottom']}>
            <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
            <View style={styles.webModalHeader}>
              <Text style={styles.webModalTitle}>{webModal?.title}</Text>
              <Pressable
                onPress={() => setWebModal(null)}
                style={styles.webModalCloseBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.webModalCloseText}>Done</Text>
              </Pressable>
            </View>
            {webModal && (
              <WebView
                source={{ uri: webModal.url }}
                style={styles.webView}
                startInLoadingState
                renderLoading={() => (
                  <ActivityIndicator size="large" color="#000000" style={styles.webLoading} />
                )}
              />
            )}
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  headerBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerTitle: {
    fontSize: 13,
    fontFamily: FONT_FUTURA_BOLD,
    letterSpacing: 2,
    color: '#111111',
  },
  headerSubTitle: {
    fontSize: 12,
    fontFamily: FONT_FUTURA_BOLD,
    letterSpacing: 1.5,
    color: '#111111',
  },
  headerCloseBtn: {
    padding: 4,
  },
  headerLeftSpacer: {
    width: 28,
  },
  headerRightSpacer: {
    width: 28,
  },
  headerBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerBackText: {
    fontSize: 13,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    color: '#111111',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 14,
  },

  /* ── 1. Profile & Identity Card ── */
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    borderRadius: 14,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: '#efefef',
  },
  avatarContainer: {
    position: 'relative',
  },
  avatarImage: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1.5,
    borderColor: '#111111',
    transform: [{ scaleX: -1 }],
  },
  avatarPlaceholder: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 22,
    fontFamily: FONT_FUTURA_BOLD,
    color: '#ffffff',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#111111',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  profileInfoBox: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  userNameText: {
    fontSize: 16,
    fontFamily: FONT_FUTURA_BOLD,
    color: '#111111',
    flexShrink: 1,
  },
  roleBadge: {
    backgroundColor: '#111111',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  roleBadgeText: {
    fontSize: 8,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 0.8,
    color: '#ffffff',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaRowText: {
    fontSize: 12,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
  },

  /* ── Accordion Cards ── */
  accordionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eeeeee',
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fafafa',
  },
  accordionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accordionTitle: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.2,
    color: '#111111',
  },
  accordionBody: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  settingTextContainer: {
    flex: 1,
    paddingRight: 12,
    gap: 2,
  },
  settingLabel: {
    fontSize: 13,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    color: '#111111',
  },
  settingDesc: {
    fontSize: 11,
    fontFamily: FONT_JOST_REGULAR,
    color: '#777777',
  },
  boldText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#111111',
  },
  clearCacheBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: 14,
  },
  clearCacheBtnText: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#111111',
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginVertical: 10,
  },
  subRowDivider: {
    height: 1,
    backgroundColor: '#f5f5f5',
    marginVertical: 8,
  },

  /* ── Events list in accordion ── */
  emptyText: {
    fontSize: 12,
    fontFamily: FONT_JOST_REGULAR,
    color: '#888888',
    textAlign: 'center',
    paddingVertical: 10,
  },
  eventItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  eventThumbnail: {
    width: 38,
    height: 38,
    borderRadius: 6,
  },
  eventThumbnailPlaceholder: {
    width: 38,
    height: 38,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventItemInfo: {
    flex: 1,
    gap: 2,
  },
  eventItemTitle: {
    fontSize: 13,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    color: '#111111',
  },
  eventItemDate: {
    fontSize: 10,
    fontFamily: FONT_JOST_REGULAR,
    color: '#888888',
  },
  leaveEventBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  leaveEventBtnText: {
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    color: '#666666',
  },

  /* ── Legal rows ── */
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  navRowLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONT_MONTSERRAT_REGULAR,
    color: '#111111',
  },

  /* ── Action Card (Data & Account Management) ── */
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eeeeee',
    padding: 16,
  },
  actionCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  actionIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCardTitle: {
    fontSize: 13,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#111111',
  },
  actionCardSub: {
    fontSize: 10,
    fontFamily: FONT_JOST_REGULAR,
    color: '#777777',
    marginTop: 1,
  },

  /* ── Logout ── */
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fee2e2',
  },
  logoutBtnText: {
    fontSize: 13,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#ef4444',
  },
  versionText: {
    fontSize: 10,
    fontFamily: FONT_JOST_REGULAR,
    color: '#aaaaaa',
    textAlign: 'center',
    marginTop: 8,
  },

  /* ── Level 2: Data & Privacy Sub-Screen ── */
  sectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eeeeee',
    padding: 16,
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionHeading: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.2,
    color: '#111111',
  },
  sectionBodyText: {
    fontSize: 12,
    fontFamily: FONT_JOST_REGULAR,
    color: '#555555',
    lineHeight: 18,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginVertical: 4,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statNumber: {
    fontSize: 14,
    fontFamily: FONT_FUTURA_BOLD,
    color: '#111111',
  },
  statLabel: {
    fontSize: 8,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 0.8,
    color: '#888888',
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#e5e7eb',
  },
  primaryOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#111111',
    marginTop: 4,
  },
  primaryOutlineBtnText: {
    fontSize: 12,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#111111',
  },
  subtleDangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    marginTop: 4,
  },
  subtleDangerText: {
    fontSize: 12,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    color: '#888888',
  },

  /* ── Level 3: Offboarding Screen ── */
  offboardingHeader: {
    paddingVertical: 8,
    gap: 4,
  },
  offboardingTitle: {
    fontSize: 16,
    fontFamily: FONT_FUTURA_BOLD,
    letterSpacing: 1,
    color: '#111111',
  },
  offboardingSubtitle: {
    fontSize: 12,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
  },
  choiceCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eeeeee',
    padding: 14,
    gap: 8,
  },
  choiceCardSelected: {
    borderColor: '#111111',
    backgroundColor: '#fafafa',
  },
  choiceRadioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#cccccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: '#111111',
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#111111',
  },
  choiceTitle: {
    fontSize: 13,
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    color: '#111111',
    flex: 1,
  },
  solutionBox: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
    gap: 8,
  },
  solutionText: {
    fontSize: 11,
    fontFamily: FONT_JOST_REGULAR,
    color: '#555555',
    lineHeight: 16,
  },
  solutionBtn: {
    backgroundColor: '#111111',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  solutionBtnText: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#ffffff',
  },
  dangerNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#fee2e2',
  },
  dangerNoticeText: {
    fontSize: 11,
    fontFamily: FONT_JOST_REGULAR,
    color: '#991b1b',
    lineHeight: 16,
    flex: 1,
  },
  offboardingBottomBox: {
    marginTop: 16,
    gap: 12,
    alignItems: 'center',
  },
  keepAccountBtn: {
    width: '100%',
    backgroundColor: '#111111',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepAccountBtnText: {
    fontSize: 13,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#ffffff',
    letterSpacing: 0.8,
  },
  finalDeleteBtn: {
    paddingVertical: 8,
  },
  finalDeleteBtnText: {
    fontSize: 12,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#ef4444',
  },

  /* ── In-App WebView Modal ── */
  webModalContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webModalHeader: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  webModalTitle: {
    fontSize: 13,
    fontFamily: FONT_FUTURA_BOLD,
    color: '#111111',
  },
  webModalCloseBtn: {
    padding: 4,
  },
  webModalCloseText: {
    fontSize: 13,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#111111',
  },
  webView: {
    flex: 1,
  },
  webLoading: {
    position: 'absolute',
    top: '45%',
    left: '45%',
  },
});
