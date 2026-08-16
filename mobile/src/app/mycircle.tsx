import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ActivityIndicator, Alert, BackHandler, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';

import { router } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';

// Sub-components
import LoginView from '../components/mycircle/LoginView';
import PhoneView from '../components/mycircle/PhoneView';
import CameraViewScreen from '../components/mycircle/CameraView';
import JoinEventView from '../components/mycircle/JoinEventView';
import PasscodeView from '../components/mycircle/PasscodeView';
import GalleryView from '../components/mycircle/GalleryView';

export default function MyCircleScreen() {
  const url = Linking.useURL();
  const [eventRequiresPasscode, setEventRequiresPasscode] = useState<boolean | null>(null);
  const [isValidatingEvent, setIsValidatingEvent] = useState(false);

  const token = useAuthStore((s) => s.token);
  const profile = useAuthStore((s) => s.profile);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isPhoneSkipped = Platform.OS === 'ios' && useAuthStore((s) => s.isPhoneSkipped);
  const eventSlug = useAuthStore((s) => s.eventSlug);
  const passcode = useAuthStore((s) => s.passcode);
  const openedFrom = useAuthStore((s) => s.openedFrom);
  const setEventDetails = useAuthStore((s) => s.setEventDetails);
  const logout = useAuthStore((s) => s.logout);

  const handleCloseGallery = () => {
    const from = useAuthStore.getState().openedFrom;
    setEventDetails(null, null);
    if (from === 'home') {
      router.replace('/');
    }
  };

  // Handle Android system back swipe/button inside My Circle screens
  useEffect(() => {
    const onBackPress = () => {
      if (eventSlug) {
        handleCloseGallery();
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [eventSlug]);
  // Note: loadStoredAuth() is already called by _layout.tsx on mount — no need to duplicate here.

  // Parse deep link when it changes
  useEffect(() => {
    if (url) {
      handleDeepLink(url);
    }
  }, [url]);

  // Whenever the eventSlug changes, check if the event requires a passcode
  useEffect(() => {
    const checkEventStatus = async () => {
      if (!eventSlug) {
        setEventRequiresPasscode(null);
        return;
      }

      try {
        setIsValidatingEvent(true);

        // 1. Try exchanging global family session token for event guest token (Seamless SSO)
        const res = await api.post(`/api/gallery/public/events/${eventSlug}/auth-from-family`, {
          code: passcode || undefined,
        });

        if (res.data?.token) {
          // User is authorized for this celebration — bypass passcode screen completely!
          setEventRequiresPasscode(false);
          return;
        }
      } catch (err: any) {
        const status = err?.response?.status;
        const errorMsg = err?.response?.data?.error || '';

        if (status === 404) {
          setEventDetails(null, null);
          setEventRequiresPasscode(null);
          return;
        }

        if (errorMsg.toLowerCase().includes('passcode')) {
          setEventRequiresPasscode(true);
          return;
        }
      } finally {
        setIsValidatingEvent(false);
      }

      try {
        setIsValidatingEvent(true);
        const res = await api.get(`/api/gallery/public/events/${eventSlug}`);
        const eventData = res.data;
        setEventRequiresPasscode(!!eventData.hasPasscode);
      } catch (err: any) {
        console.error('Failed to validate event requirements', err);
        const status = err?.response?.status;
        if (status === 404) {
          setEventDetails(null, null);
          setEventRequiresPasscode(null);
        } else {
          setEventRequiresPasscode(false);
        }
      } finally {
        setIsValidatingEvent(false);
      }
    };

    checkEventStatus();
  }, [eventSlug, passcode]);

  const handleDeepLink = (incomingUrl: string) => {
    try {
      const parsed = Linking.parse(incomingUrl);
      
      // Support schemes:
      // 1. mycircle://wedding-slug?code=1234
      // 2. https://mycircle.mistyvisuals.com/wedding-slug?code=1234
      let slug = parsed.path;
      const rawCode = parsed.queryParams?.code || parsed.queryParams?.passcode || null;
      const code = Array.isArray(rawCode) ? rawCode[0] : rawCode;

      if (slug) {
        // Strip trailing subpaths if any
        const parts = slug.split('/').filter(Boolean);
        slug = parts[0] || null;
      } else if (parsed.hostname && parsed.hostname !== 'mycircle.mistyvisuals.com') {
        slug = parsed.hostname;
      }

      // Filter out internal Expo dev client / localhost / system routes
      if (slug) {
        const lower = slug.toLowerCase();
        const isDevOrSystem =
          lower.includes('expo') ||
          lower.includes('development-client') ||
          lower.includes('localhost') ||
          lower === 'build' ||
          lower === 'exp' ||
          /^(?:\d{1,3}\.){3}\d{1,3}$/.test(lower);

        if (!isDevOrSystem) {
          setEventDetails(slug, code);
        }
      }
    } catch (err) {
      console.error('Error parsing deep link', err);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: () => logout() },
    ]);
  };

  // State Machine Controller
  // Initial auth loading
  if ((isLoading || isValidatingEvent) && !token) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#000000" />
      </View>
    );
  }

  // 1. Authenticate user
  if (!token) {
    return <LoginView onSuccess={() => {}} />;
  }

  // 2. Set Phone Number (if not filled and not skipped this session)
  const hasValidPhoneNumber = Boolean(profile?.phoneNumber && profile.phoneNumber !== 'skipped');
  if (!hasValidPhoneNumber && !isPhoneSkipped) {
    return <PhoneView onSuccess={() => {}} />;
  }

  // 3. Take selfie (mandatory)
  if (!profile?.hasSelfie) {
    return <CameraViewScreen onSuccess={() => {}} />;
  }

  // 4. Base Screen: JoinEventView (All Celebrations screen) with overlays (matching FeaturedStoryView)
  return (
    <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
      <JoinEventView onSuccess={() => {}} />

      {/* Passcode Modal overlay if passcode is required */}
      {eventSlug && eventRequiresPasscode && !passcode && (
        <PasscodeView
          onSuccess={() => {}}
          onBack={() => setEventDetails(null, null)}
        />
      )}

      {/* Gallery Overlay Modal when eventSlug is set and opened from My Circle */}
      {eventSlug && openedFrom === 'mycircle' && (!eventRequiresPasscode || passcode) && (
        <GalleryView
          onLogout={handleLogout}
          onChangeEvent={handleCloseGallery}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
