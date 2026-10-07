import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { handleIncomingUrl } from '../utils/deepLink';

const STORAGE_PUSH_TOKEN_KEY = '@mycircle_registered_push_token';
const PREF_PUSH_ENABLED_KEY = '@mycircle_pref_push_notifications';

// Ensure notifications show in foreground as heads-up banners
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

class PushNotificationService {
  private isConfigured = false;
  private responseSubscription: Notifications.Subscription | null = null;

  /**
   * Configure Android notification channel and setup response tap listener.
   */
  public async initialize(): Promise<void> {
    if (this.isConfigured) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Celebration Updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#111111',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      }).catch((err) => {
        console.warn('[PushNotificationService] Failed to set Android notification channel:', err);
      });
    }

    // Handle when user taps on a notification banner from system tray
    this.responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      this.handleNotificationTap(response);
    });

    // Check if app was opened directly by tapping a notification when killed/cold-started
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          this.handleNotificationTap(response);
        }
      })
      .catch(() => {});

    this.isConfigured = true;
  }

  /**
   * Request OS permissions, obtain Expo Push Token, and register it with backend.
   */
  public async registerForPushNotifications(): Promise<string | null> {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('[PushNotificationService] Push notification permissions not granted.');
        return null;
      }

      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ||
        Constants.easConfig?.projectId ||
        '0e3ae02b-253b-4061-b328-0ea03b9e7308';

      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      const token = tokenData?.data;

      if (!token) {
        console.warn('[PushNotificationService] Could not retrieve Expo push token.');
        return null;
      }

      console.log('[PushNotificationService] Retrieved Push Token:', token);

      // Sync with backend API
      await this.syncTokenWithBackend(token);

      return token;
    } catch (error: any) {
      console.warn('[PushNotificationService] Error registering push notifications:', error?.message || error);
      return null;
    }
  }

  /**
   * Sync push token with backend server
   */
  public async syncTokenWithBackend(token: string): Promise<void> {
    try {
      const lastRegistered = await AsyncStorage.getItem(STORAGE_PUSH_TOKEN_KEY);
      const isPushEnabled = (await AsyncStorage.getItem(PREF_PUSH_ENABLED_KEY)) !== 'false';

      // Avoid unnecessary network calls if already registered and preferences haven't changed
      if (lastRegistered === token && isPushEnabled) {
        return;
      }

      await api.post('/api/user/push-token', {
        token,
        platform: Platform.OS,
        isActive: isPushEnabled,
      });

      await AsyncStorage.setItem(STORAGE_PUSH_TOKEN_KEY, token);
      console.log('[PushNotificationService] Push token successfully registered on server.');
    } catch (apiErr: any) {
      console.warn('[PushNotificationService] Failed to sync push token with server:', apiErr?.message || apiErr);
    }
  }

  /**
   * Unregister / deactivate push token on user logout
   */
  public async unregister(): Promise<void> {
    try {
      const token = await AsyncStorage.getItem(STORAGE_PUSH_TOKEN_KEY);
      if (token) {
        await api.delete('/api/user/push-token', { data: { token } }).catch(() => {});
        await AsyncStorage.removeItem(STORAGE_PUSH_TOKEN_KEY);
      }
    } catch (_e) {}
  }

  /**
   * Update push notification active preference on server
   */
  public async updatePushPreference(enabled: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(PREF_PUSH_ENABLED_KEY, enabled ? 'true' : 'false');
      const token = await AsyncStorage.getItem(STORAGE_PUSH_TOKEN_KEY);
      if (token) {
        await api.patch('/api/user/push-preferences', {
          token,
          isActive: enabled,
        }).catch(() => {});
      }
    } catch (_e) {}
  }

  /**
   * Parse notification payload data and route via deepLink
   */
  private handleNotificationTap(response: Notifications.NotificationResponse) {
    try {
      const data = response?.notification?.request?.content?.data;
      if (!data) return;

      console.log('[PushNotificationService] Notification tapped with payload:', data);

      if (data.url && typeof data.url === 'string') {
        handleIncomingUrl(data.url);
      } else if (data.slug && typeof data.slug === 'string') {
        const query = data.tab ? `?tab=${encodeURIComponent(String(data.tab))}` : '';
        handleIncomingUrl(`mycircle://celebration/${data.slug}${query}`);
      }
    } catch (err) {
      console.warn('[PushNotificationService] Error handling notification tap:', err);
    }
  }

  public cleanup(): void {
    if (this.responseSubscription) {
      this.responseSubscription.remove();
      this.responseSubscription = null;
    }
  }
}

export const pushNotificationService = new PushNotificationService();
export default pushNotificationService;
