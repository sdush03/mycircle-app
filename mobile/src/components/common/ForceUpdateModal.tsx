import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
  BackHandler,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import { isVersionLower } from '../../utils/versionCheck';
import { FONT_FUTURA_BOLD, FONT_MONTSERRAT_REGULAR } from '../../constants/fonts';

interface VersionConfig {
  minSupportedVersion: string;
  title?: string;
  message?: string;
  androidStoreUrl?: string;
  iosStoreUrl?: string;
  forceUpdate?: boolean;
}

const DEFAULT_ANDROID_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.mistyvisuals.mycircle';
const DEFAULT_IOS_STORE_URL =
  'https://apps.apple.com/app/id6796633077';

export default function ForceUpdateModal() {
  const [mustUpdate, setMustUpdate] = useState(false);
  const [config, setConfig] = useState<VersionConfig | null>(null);

  useEffect(() => {
    checkAppVersion();
  }, []);

  // Intercept and disable hardware back button on Android while update modal is visible
  useEffect(() => {
    if (!mustUpdate) return;
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => backHandler.remove();
  }, [mustUpdate]);

  const checkAppVersion = async () => {
    try {
      // Get currently installed app version from app.json / Constants
      const installedVersion = Constants.expoConfig?.version || '1.0.0';

      // Call backend version endpoint (fails silently if backend endpoint is not yet live)
      const response = await api.get('/api/app-config/version', { timeout: 5000 });
      const data: VersionConfig = response.data;

      if (data && data.minSupportedVersion) {
        const needsUpdate = isVersionLower(installedVersion, data.minSupportedVersion);
        const isForced = data.forceUpdate !== false; // defaults to true if omitted

        if (needsUpdate && isForced) {
          setConfig(data);
          setMustUpdate(true);
        }
      }
    } catch (_error) {
      // If server is unreachable or endpoint doesn't exist yet, do not block the user.
    }
  };

  const handleUpdatePress = () => {
    const storeUrl =
      Platform.OS === 'ios'
        ? config?.iosStoreUrl || DEFAULT_IOS_STORE_URL
        : config?.androidStoreUrl || DEFAULT_ANDROID_STORE_URL;

    Linking.canOpenURL(storeUrl)
      .then((supported) => {
        if (supported) {
          Linking.openURL(storeUrl);
        } else {
          Linking.openURL(storeUrl);
        }
      })
      .catch(() => {
        Linking.openURL(storeUrl);
      });
  };

  if (!mustUpdate) return null;

  const title = config?.title || 'Update Required';
  const message =
    config?.message ||
    'A new version of Misty Visuals is available. Please update the app to continue using all features.';

  return (
    <Modal
      visible={mustUpdate}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        // Prevent dismissal via back button on Android
      }}
    >
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Ionicons name="cloud-download-outline" size={64} color="#000000" />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <TouchableOpacity
            style={styles.updateButton}
            onPress={handleUpdatePress}
            activeOpacity={0.8}
          >
            <Text style={styles.updateButtonText}>UPDATE NOW</Text>
            <Ionicons name="arrow-forward" size={18} color="#ffffff" style={styles.buttonIcon} />
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.versionText}>
            Current Version: {Constants.expoConfig?.version || '1.1.6'}
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontFamily: FONT_FUTURA_BOLD,
    fontSize: 24,
    color: '#000000',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  message: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 15,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 36,
    paddingHorizontal: 12,
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    paddingVertical: 16,
    paddingHorizontal: 36,
    borderRadius: 30,
    width: '100%',
    maxWidth: 300,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  updateButtonText: {
    fontFamily: FONT_FUTURA_BOLD,
    fontSize: 14,
    color: '#ffffff',
    letterSpacing: 1.5,
  },
  buttonIcon: {
    marginLeft: 8,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 24,
  },
  versionText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12,
    color: '#999999',
  },
});
