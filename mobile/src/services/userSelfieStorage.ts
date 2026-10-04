import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LOCAL_SELFIE_KEY = '@mycircle_user_selfie_v1';
const REMOTE_SELFIE_URL_KEY = '@mycircle_remote_selfie_url';
const LOCAL_SELFIE_FILENAME = 'user_profile_selfie.jpg';

function getLocalSelfieFilePath(): string {
  const dir = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  return `${dir}${LOCAL_SELFIE_FILENAME}`;
}

export const userSelfieStorage = {
  /**
   * Save selfie data (base64 data URL, remote URL, or local file URI) to persistent device storage.
   * Returns the permanent local file URI.
   */
  async saveLocalSelfie(selfieDataOrUri: string, remoteUrl?: string | null): Promise<string> {
    if (!selfieDataOrUri) return '';

    const targetFilePath = getLocalSelfieFilePath();

    try {
      if (selfieDataOrUri.startsWith('data:image')) {
        // Base64 Data URL -> write binary JPG file to local disk
        const base64Data = selfieDataOrUri.replace(/^data:image\/\w+;base64,/, '');
        await FileSystem.writeAsStringAsync(targetFilePath, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else if (selfieDataOrUri.startsWith('http://') || selfieDataOrUri.startsWith('https://')) {
        // Remote HTTP URL -> download to local disk
        try {
          const downloadRes = await FileSystem.downloadAsync(selfieDataOrUri, targetFilePath);
          if (!downloadRes.uri) throw new Error('Download returned empty URI');
        } catch (downloadErr) {
          // If direct download fails (e.g. requires auth), fallback to saving URL string in AsyncStorage
          console.warn('[SELFIE STORAGE] downloadAsync failed, storing raw URL in AsyncStorage:', downloadErr);
          await AsyncStorage.setItem(LOCAL_SELFIE_KEY, selfieDataOrUri);
          if (remoteUrl) {
            await AsyncStorage.setItem(REMOTE_SELFIE_URL_KEY, remoteUrl);
          }
          return selfieDataOrUri;
        }
      } else if (selfieDataOrUri.startsWith('file://')) {
        // Local file URI from camera picker -> copy to permanent document directory
        if (selfieDataOrUri !== targetFilePath) {
          await FileSystem.copyAsync({ from: selfieDataOrUri, to: targetFilePath });
        }
      } else {
        // Raw base64 string
        await FileSystem.writeAsStringAsync(targetFilePath, selfieDataOrUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      // Verify file exists
      const fileInfo = await FileSystem.getInfoAsync(targetFilePath);
      if (fileInfo.exists) {
        await AsyncStorage.setItem(LOCAL_SELFIE_KEY, targetFilePath);
        if (remoteUrl) {
          await AsyncStorage.setItem(REMOTE_SELFIE_URL_KEY, remoteUrl);
        }
        return targetFilePath;
      }
    } catch (err) {
      console.warn('[SELFIE STORAGE] Failed to write selfie to disk, falling back to AsyncStorage string:', err);
    }

    // Fallback: Store raw string in AsyncStorage if disk write failed
    await AsyncStorage.setItem(LOCAL_SELFIE_KEY, selfieDataOrUri);
    if (remoteUrl) {
      await AsyncStorage.setItem(REMOTE_SELFIE_URL_KEY, remoteUrl);
    }
    return selfieDataOrUri;
  },

  /**
   * Retrieve cached selfie URI from local storage for 0ms instant display.
   */
  async getLocalSelfie(): Promise<string | null> {
    try {
      // 1. Check AsyncStorage reference
      const cachedUri = await AsyncStorage.getItem(LOCAL_SELFIE_KEY);
      if (cachedUri) {
        if (cachedUri.startsWith('file://')) {
          const info = await FileSystem.getInfoAsync(cachedUri);
          if (info.exists) return cachedUri;
        } else {
          return cachedUri;
        }
      }

      // 2. Check default document file location
      const defaultPath = getLocalSelfieFilePath();
      const info = await FileSystem.getInfoAsync(defaultPath);
      if (info.exists) {
        await AsyncStorage.setItem(LOCAL_SELFIE_KEY, defaultPath);
        return defaultPath;
      }
    } catch (err) {
      console.warn('[SELFIE STORAGE] Error reading local selfie:', err);
    }
    return null;
  },

  /**
   * Get cached remote URL string (used to skip re-downloading if server URL has not changed).
   */
  async getCachedRemoteUrl(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(REMOTE_SELFIE_URL_KEY);
    } catch {
      return null;
    }
  },

  /**
   * Clear local selfie files and storage keys on logout or selfie deletion.
   */
  async clearLocalSelfie(): Promise<void> {
    try {
      const targetFilePath = getLocalSelfieFilePath();
      await FileSystem.deleteAsync(targetFilePath, { idempotent: true }).catch(() => {});
      await AsyncStorage.removeItem(LOCAL_SELFIE_KEY).catch(() => {});
      await AsyncStorage.removeItem(REMOTE_SELFIE_URL_KEY).catch(() => {});
    } catch (err) {
      console.warn('[SELFIE STORAGE] Error clearing local selfie:', err);
    }
  },
};
