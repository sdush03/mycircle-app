import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router, useLocalSearchParams, usePathname } from 'expo-router';
import * as Linking from 'expo-linking';
import { handleIncomingUrl, parseDeepLink } from '../utils/deepLink';
import { useAuthStore } from '../store/authStore';

export default function NotFoundScreen() {
  const url = Linking.useURL();
  const params = useLocalSearchParams();
  const pathname = usePathname();

  useEffect(() => {
    let resolved = false;

    if (url) {
      const parsed = parseDeepLink(url);
      if (parsed) {
        handleIncomingUrl(url);
        resolved = true;
      }
    }

    if (!resolved && pathname) {
      // Pathname could be "/vomika-zenith"
      const slug = pathname.replace(/^\/+/, '').split('/')[0];
      const rawCode = params.code || params.passcode;
      const code = Array.isArray(rawCode) ? rawCode[0] : (rawCode as string | undefined);

      if (slug && slug !== '+not-found') {
        const token = useAuthStore.getState().token;
        if (token) {
          useAuthStore.getState().setEventDetails(slug, code || null, null, null, 'mycircle');
        } else {
          useAuthStore.getState().setPendingInvite({ slug, passcode: code || null });
        }
      }
    }

    // Redirect to home where GalleryView overlay takes over
    router.replace('/');
  }, [url, pathname, params]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#ffffff" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
