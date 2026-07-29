import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Image } from 'expo-image';

const TOKEN_KEY = 'user_session_token';
const PROFILE_KEY = 'user_profile_data';

export interface GuestProfile {
  id: number;
  name: string;
  email: string;
  phoneNumber?: string | null;
  hasSelfie?: boolean;
  selfieUrl?: string | null;
  selfieGuestId?: number | null;
  displayRole?: 'BRIDE' | 'GROOM' | 'GUEST';
  hasFullAccess?: boolean;
}

export interface GalleryCacheEntry {
  details?: any;
  photos?: any[];
  headers?: any;
  total?: number;
  hasFullAccess?: boolean;
  matched?: any[];
  favorites?: any[];
  tabCache?: Record<string, any[]>;
  timestamp: number;
}

interface AuthState {
  token: string | null;
  profile: GuestProfile | null;
  userEvents: any[];
  isLoading: boolean;
  eventSlug: string | null;
  passcode: string | null;
  eventCoverUrl: string | null;
  eventTitle: string | null;
  isTabBarCollapsed: boolean;
  galleryCache: Record<string, GalleryCacheEntry>;
  setTabBarCollapsed: (collapsed: boolean) => void;
  setUserEvents: (events: any[]) => void;
  setGalleryCache: (eventSlug: string, data: Partial<GalleryCacheEntry>) => void;
  getGalleryCache: (eventSlug: string) => GalleryCacheEntry | null;
  
  setAuth: (token: string, profile: GuestProfile, userEvents?: any[]) => Promise<void>;
  updateProfile: (profile: Partial<GuestProfile>) => Promise<void>;
  setEventDetails: (slug: string | null, passcode: string | null, coverUrl?: string | null, title?: string | null) => void;
  loadStoredAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  profile: null,
  userEvents: [],
  isLoading: true,
  eventSlug: null,
  passcode: null,
  eventCoverUrl: null,
  eventTitle: null,
  isTabBarCollapsed: false,
  galleryCache: {},
  
  setTabBarCollapsed: (collapsed) => set({ isTabBarCollapsed: collapsed }),
  setUserEvents: (events) => set({ userEvents: events }),
  setGalleryCache: (eventSlug, data) => {
    if (!eventSlug) return;
    const current = get().galleryCache[eventSlug] || { timestamp: Date.now() };
    set((state) => ({
      galleryCache: {
        ...state.galleryCache,
        [eventSlug]: {
          ...current,
          ...data,
          timestamp: Date.now(),
        },
      },
    }));
  },
  getGalleryCache: (eventSlug) => {
    if (!eventSlug) return null;
    return get().galleryCache[eventSlug] || null;
  },

  setAuth: async (token, profile, userEvents = []) => {
    try {
      const { selfieUrl, ...persistentProfile } = profile;
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(persistentProfile));
      set({ token, profile, userEvents, isLoading: false });
    } catch (e) {
      console.error('Error saving auth state', e);
    }
  },

  updateProfile: async (updatedFields) => {
    const currentProfile = get().profile;
    if (!currentProfile) return;
    const newProfile = { ...currentProfile, ...updatedFields };
    try {
      const { selfieUrl, ...persistentProfile } = newProfile;
      await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(persistentProfile));
      set({ profile: newProfile });
    } catch (e) {
      console.error('Error updating profile state', e);
    }
  },

  setEventDetails: (eventSlug, passcode, eventCoverUrl = null, eventTitle = null) => {
    if (eventCoverUrl) {
      Image.prefetch(eventCoverUrl);
    }
    set({ eventSlug, passcode, eventCoverUrl, eventTitle });
    if (eventSlug) {
      import('../services/galleryPrefetch').then((m) => {
        m.prefetchEventGalleryData(eventSlug, passcode);
      }).catch(() => {});
    }
  },

  loadStoredAuth: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const profileStr = await SecureStore.getItemAsync(PROFILE_KEY);
      const profile = profileStr ? JSON.parse(profileStr) : null;
      set({ token, profile, isLoading: false });
    } catch (e) {
      // SecureStore may fail on simulator builds without keychain entitlements — this is expected.
      console.warn('SecureStore unavailable, starting with no stored session:', e);
      set({ isLoading: false });
    }
  },

  logout: async () => {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(PROFILE_KEY);
      // Sign out of Google so the account picker is shown on next sign-in
      try {
        const { GoogleSignin } = require('@react-native-google-signin/google-signin');
        await GoogleSignin.signOut();
      } catch (_) {
        // Native module may not be available in all environments (e.g. Expo Go)
      }
      set({ token: null, profile: null, isLoading: false, eventSlug: null, passcode: null });
    } catch (e) {
      console.error('Error deleting auth state', e);
    }
  },
}));
