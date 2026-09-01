import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ActivityIndicator, Alert, BackHandler, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';

import { router } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { handleIncomingUrl } from '../utils/deepLink';
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
      handleIncomingUrl(url);
    }
  }, [url]);

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
