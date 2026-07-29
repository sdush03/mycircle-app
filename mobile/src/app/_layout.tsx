import React, { useEffect, useState } from 'react';
import { Image, useColorScheme, StyleSheet, Platform, View, Pressable, Text, Modal, ActivityIndicator, StatusBar, BackHandler, LogBox } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { Tabs, router, useSegments } from 'expo-router';
import { ThemeProvider, DarkTheme, DefaultTheme } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Jost_400Regular, Jost_500Medium, Jost_600SemiBold } from '@expo-google-fonts/jost';
import { Montserrat_400Regular, Montserrat_300Light, Montserrat_500Medium, Montserrat_600SemiBold } from '@expo-google-fonts/montserrat';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, FadeIn } from 'react-native-reanimated';
import { useAuthStore } from '../store/authStore';
import api, { API_BASE_URL } from '../services/api';
import LoginView from '../components/mycircle/LoginView';
import { ProfileView } from '../components/profile/ProfileView';
import { tabEvents, TAB_OPEN_MOODBOARDS, TAB_OPEN_INSPIRATIONS, TAB_OPEN_PROFILE_SETTINGS } from '../lib/tabEvents';

SplashScreen.preventAutoHideAsync().catch(() => {});

LogBox.ignoreLogs([
  'SafeAreaView has been deprecated',
  'Unable to activate keep awake',
  'Error: Unable to activate keep awake',
  'InvocationTargetException',
]);

if (typeof global !== 'undefined' && (global as any).ErrorUtils) {
  const defaultHandler = (global as any).ErrorUtils.getGlobalHandler();
  (global as any).ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
    if (error?.message?.includes('keep awake') || error?.message?.includes('Keep awake')) {
      return;
    }
    if (defaultHandler) {
      defaultHandler(error, isFatal);
    }
  });
}

if (__DEV__) {
  const origError = console.error;
  console.error = (...args: any[]) => {
    const str = args.map(a => (typeof a === 'object' ? (a?.message || JSON.stringify(a)) : String(a))).join(' ');
    if (str.includes('keep awake') || str.includes('Keep awake') || str.includes('InvocationTargetException')) {
      return;
    }
    origError(...args);
  };
}

export { FONT_FUTURA, FONT_FUTURA_BOLD, FONT_MONTSERRAT_REGULAR } from '../constants/fonts';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <RootLayoutContent />
    </SafeAreaProvider>
  );
}

function RootLayoutContent() {
  const colorScheme = useColorScheme();
  const segments = useSegments();
  const insets = useSafeAreaInsets();

  const [fontsLoaded] = useFonts({
    Jost_400Regular,
    Jost_500Medium,
    Jost_600SemiBold,
    Montserrat_400Regular,
    Montserrat_300Light,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    'Futura-Medium': require('../../assets/fonts/Futura-Medium.ttf'),
    'Futura-Bold': require('../../assets/fonts/Futura-Bold.ttf'),
  });

  const [showProfileModal, setShowProfileModal] = useState(false);

  const isCollapsed = useAuthStore((state) => state.isTabBarCollapsed);
  const token = useAuthStore((state) => state.token);
  const profile = useAuthStore((state) => state.profile);
  const isLoading = useAuthStore((state) => state.isLoading);
  const loadStoredAuth = useAuthStore((state) => state.loadStoredAuth);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const logout = useAuthStore((state) => state.logout);
  const eventSlug = useAuthStore((state) => state.eventSlug);

  const [isReady, setIsReady] = useState(false);

  // Load persisted session once on mount
  useEffect(() => {
    async function initialize() {
      try {
        await loadStoredAuth();
      } catch (e) {
        console.warn('Auth initialization error:', e);
      } finally {
        setIsReady(true);
      }
    }
    initialize();
  }, []);

  const [isSplashHidden, setIsSplashHidden] = useState(false);

  // Hide the native splash screen as soon as auth and fonts are both resolved.
  useEffect(() => {
    if (isReady && !isLoading && fontsLoaded && !isSplashHidden) {
      SplashScreen.hideAsync()
        .then(() => setIsSplashHidden(true))
        .catch(() => setIsSplashHidden(true));
    }
  }, [isReady, isLoading, fontsLoaded, isSplashHidden]);

  // Handle Android back button & swipe back gestures globally
  useEffect(() => {
    const onBackPress = () => {
      if (showProfileModal) {
        setShowProfileModal(false);
        return true;
      }
      if (!token) {
        BackHandler.exitApp();
        return true;
      }
      if (segments[0] === 'mycircle') {
        router.replace('/');
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [showProfileModal, token, segments]);

  // Fetch selfie once per session when authenticated.
  // Uses a ref flag so it never reruns due to profile state changes.
  const selfieFetchedRef = React.useRef(false);
  useEffect(() => {
    if (!token) { selfieFetchedRef.current = false; return; }
    if (selfieFetchedRef.current) return;
    selfieFetchedRef.current = true;

    const fetchSelfie = async () => {
      try {
        const res = await api.get('/api/gallery/family/events');
        const rawSelfieUrl: string | null = res.data?.selfieUrl || null;
        const profileData = res.data?.profile || {};

        if (rawSelfieUrl) {
          const fullUrl = rawSelfieUrl.startsWith('http') ? rawSelfieUrl : `${API_BASE_URL}${rawSelfieUrl}`;
          const headers: Record<string, string> = rawSelfieUrl.startsWith('http') ? {} : { Authorization: `Bearer ${token}` };
          const imgRes = await fetch(fullUrl, { headers });
          if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const selfieUrl = `data:image/jpeg;base64,${btoa(binary)}`;
            await updateProfile({ ...profileData, selfieUrl });
            return;
          }
        }
        await updateProfile({ ...profileData, selfieUrl: null });
      } catch (_err) {
        // 401 or network failure — just mark selfieUrl as null so avatar shows initials
        await updateProfile({ selfieUrl: null }).catch(() => {});
      }
    };

    fetchSelfie();
  }, [token]);

  // Determine current active tab
  const currentTab: 'index' | 'mycircle' | 'moodboard' | 'inspirations' | 'profile' =
    segments[0] === 'mycircle' ? 'mycircle' :
    segments[0] === 'inspirations' ? 'inspirations' :
    segments[0] === 'moodboard' ? 'moodboard' :
    segments[0] === 'profile' ? 'profile' : 'index';
  const topInset = insets.top;
  const headerHeight = 52 + topInset;

  // 1. Keep screen solid white matching native splash until fonts & stored auth are initialized (prevents black flicker)
  if (!isReady || isLoading || !fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#ffffff' }} />;
  }

  // 2. Render LoginView directly when unauthenticated (prevents underlying Home screen from mounting/glimpsing)
  if (!token) {
    return <LoginView onSuccess={() => {}} startAnimation={isSplashHidden} />;
  }

  // 3. Enforce mandatory onboarding — catches users with saved sessions who haven't completed profile
  if (!profile?.phoneNumber || !profile?.hasSelfie) {
    return <LoginView onSuccess={() => {}} startAnimation={isSplashHidden} />;
  }

  const isHeaderHidden = currentTab === 'mycircle' && Boolean(eventSlug);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Animated.View entering={FadeIn.duration(350)} style={{ flex: 1, backgroundColor: '#ffffff' }}>
        {!isHeaderHidden && (
          <>
            <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
            {/* Global Header — Centered Logo */}
            <View style={[styles.globalHeader, { height: headerHeight, paddingTop: topInset }]}>
              <Image
                source={require('@/assets/images/logo-black.png')}
                style={styles.headerLogo}
                resizeMode="contain"
              />
              {currentTab === 'profile' && (
                <Pressable
                  style={styles.headerSettingsBtn}
                  onPress={() => tabEvents.emit(TAB_OPEN_PROFILE_SETTINGS)}
                  hitSlop={12}
                >
                  <Ionicons name="menu-outline" size={26} color="#111111" />
                </Pressable>
              )}
            </View>
          </>
        )}

        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: { display: 'none' },
          }}
        >
          <Tabs.Screen name="index" />
          <Tabs.Screen name="mycircle" />
          <Tabs.Screen name="moodboard" />
          <Tabs.Screen name="inspirations" />
          <Tabs.Screen name="profile" />
        </Tabs>

        {/* Custom Animated Floating Tab Bar (Instagram 3-Tab Style) */}
        <CustomFloatingTabBar
          activeTab={currentTab}
          isCollapsed={isCollapsed}
          bottomInset={insets.bottom}
          profile={profile}
          onOpenProfile={() => setShowProfileModal(true)}
        />

        {/* ── Profile & Moodboard Saves Modal ── */}
        <ProfileView
          visible={showProfileModal}
          onClose={() => setShowProfileModal(false)}
          profile={profile}
          onLogout={async () => {
            setShowProfileModal(false);
            await logout();
          }}
        />
      </Animated.View>
    </ThemeProvider>
  );
}

interface CustomTabBarProps {
  activeTab: 'index' | 'mycircle' | 'moodboard' | 'inspirations' | 'profile';
  isCollapsed: boolean;
  bottomInset: number;
  profile: any;
  onOpenProfile: () => void;
}

// ── Icon components ────────────────────────────────────────────────────────
function IconProfile({ active, profile }: { active: boolean; profile: any }) {
  if (profile?.selfieUrl) {
    return (
      <Image
        source={{ uri: profile.selfieUrl }}
        style={[styles.tabAvatarImage, active && styles.tabAvatarImageActive]}
      />
    );
  }
  return (
    <View style={[styles.tabAvatarCircle, active && styles.tabAvatarCircleActive]}>
      <Text style={styles.tabAvatarText}>
        {profile?.name ? profile.name.charAt(0).toUpperCase() : 'U'}
      </Text>
    </View>
  );
}

// ── Floating tab bar ────────────────────────────────────────────────────────
function CustomFloatingTabBar({ activeTab, isCollapsed, bottomInset, profile, onOpenProfile }: CustomTabBarProps) {
  const targetWidth  = isCollapsed ? 180 : 310;
  const targetHeight = isCollapsed ? 48  : 64;
  const widthVal  = useSharedValue(310);
  const heightVal = useSharedValue(64);

  useEffect(() => {
    const spring = { damping: 18, stiffness: 150, mass: 0.8 };
    widthVal.value  = withSpring(targetWidth,  spring);
    heightVal.value = withSpring(targetHeight, spring);
  }, [isCollapsed]);

  const animatedStyle = useAnimatedStyle(() => ({
    width:        widthVal.value,
    height:       heightVal.value,
    borderRadius: heightVal.value / 2,
  }));

  const setTabBarCollapsed = useAuthStore((state) => state.setTabBarCollapsed);

  const handleTabPress = (tabName: 'index' | 'mycircle' | 'moodboard' | 'inspirations' | 'profile') => {
    setTabBarCollapsed(false);
    if (tabName === 'index') {
      router.replace('/');
    } else if (tabName === 'mycircle') {
      router.replace('/mycircle');
    } else if (tabName === 'moodboard') {
      router.replace('/moodboard');
    } else if (tabName === 'inspirations') {
      router.replace('/inspirations');
    } else if (tabName === 'profile') {
      router.replace('/profile');
    }
  };

  const MoodboardMasonryIcon = ({ active, size = 22, color }: { active: boolean; size?: number; color: string }) => {
    const bw = active ? 2 : 1.6;
    return (
      <View style={{ width: size, height: size, flexDirection: 'row', gap: 2.5, paddingVertical: 1 }}>
        <View
          style={{
            flex: 1,
            height: '100%',
            borderWidth: bw,
            borderColor: color,
            borderRadius: 2,
            backgroundColor: active ? color : 'transparent',
          }}
        />
        <View style={{ flex: 1, height: '100%', flexDirection: 'column', gap: 2.5 }}>
          <View
            style={{
              flex: 1,
              borderWidth: bw,
              borderColor: color,
              borderRadius: 2,
              backgroundColor: active ? color : 'transparent',
            }}
          />
          <View
            style={{
              flex: 1,
              borderWidth: bw,
              borderColor: color,
              borderRadius: 2,
              backgroundColor: active ? color : 'transparent',
            }}
          />
        </View>
      </View>
    );
  };

  const bottomPosition = bottomInset > 0 ? bottomInset + 10 : 20;

  const ICON_SIZE = 22;
  const tabs: Array<{
    key: 'index' | 'mycircle' | 'moodboard' | 'inspirations' | 'profile';
    label: string;
    icon: (active: boolean) => React.ReactNode;
  }> = [
    {
      key: 'index',
      label: 'Home',
      icon: (a) => <Ionicons name={a ? 'home' : 'home-outline'} size={ICON_SIZE} color={a ? '#1c1a18' : 'rgba(0,0,0,0.35)'} />,
    },
    {
      key: 'mycircle',
      label: 'My Circle',
      icon: (a) => <Ionicons name={a ? 'disc' : 'disc-outline'} size={ICON_SIZE} color={a ? '#1c1a18' : 'rgba(0,0,0,0.35)'} />,
    },
    {
      key: 'moodboard',
      label: 'Moodboard',
      icon: (a) => <MoodboardMasonryIcon active={a} size={ICON_SIZE} color={a ? '#1c1a18' : 'rgba(0,0,0,0.35)'} />,
    },
    {
      key: 'profile',
      label: 'Profile',
      icon: (a) => <IconProfile active={a} profile={profile} />,
    },
  ];

  return (
    <Animated.View style={[styles.floatingTabBar, animatedStyle, { bottom: bottomPosition }]}>
      {tabs.map(({ key, label, icon }) => {
        const isActive = activeTab === key;
        const labelColor = isActive ? '#1c1a18' : 'rgba(0,0,0,0.35)';
        return (
          <Pressable
            key={key}
            style={[styles.tabButton, isActive && styles.tabButtonActive]}
            onPress={() => handleTabPress(key)}
          >
            <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
              {icon(isActive)}
            </View>
            {!isCollapsed && (
              <Text style={[styles.tabLabel, { color: labelColor }]} numberOfLines={1}>{label}</Text>
            )}
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingLogo: {
    height: 34,
    width: 160,
    tintColor: '#000000',
  },
  floatingTabBar: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 2,
    paddingVertical: 6,
    borderRadius: 20,
  },
  tabButtonActive: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  tabIcon: {
    width: 20,
    height: 20,
  },
  tabLabel: {
    fontSize: 9,
    fontFamily: 'Montserrat_600SemiBold',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  globalHeader: {
    width: '100%',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    position: 'relative',
  },
  headerLogo: {
    height: 38,
    width: 135,
    tintColor: '#000000',
  },
  headerSettingsBtn: {
    position: 'absolute',
    right: 18,
    bottom: 12,
    padding: 4,
  },
  tabAvatarImage: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tabAvatarImageActive: {
    borderColor: '#000000',
  },
  tabAvatarCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tabAvatarCircleActive: {
    borderColor: '#000000',
  },
  tabAvatarText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  profileHeaderBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  profileCardModal: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  profileModalHeader: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  profileModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
    letterSpacing: 0.5,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 16,
    color: '#888888',
    fontWeight: '600',
  },
  profileInfoSection: {
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
  },
  largeAvatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  largeAvatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 12,
  },
  largeAvatarText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 13,
    color: '#666666',
    marginBottom: 4,
  },
  profilePhone: {
    fontSize: 13,
    color: '#888888',
    marginTop: 2,
  },
  logoutModalBtn: {
    width: '100%',
    paddingVertical: 12,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    alignItems: 'center',
  },
  logoutModalBtnText: {
    color: '#dc2626',
    fontSize: 14,
    fontWeight: '700',
  },
});
