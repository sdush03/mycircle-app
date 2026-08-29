import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  isPhoneSkipped: boolean;
  eventSlug: string | null;
  passcode: string | null;
  eventCoverUrl: string | null;
  eventTitle: string | null;
  openedFrom: 'home' | 'mycircle' | null;
  isTabBarCollapsed: boolean;
  galleryCache: Record<string, GalleryCacheEntry>;
  setPhoneSkipped: (skipped: boolean) => void;
  setTabBarCollapsed: (collapsed: boolean) => void;
  setUserEvents: (events: any[]) => void;
  setGalleryCache: (eventSlug: string, data: Partial<GalleryCacheEntry>) => void;
  getGalleryCache: (eventSlug: string) => GalleryCacheEntry | null;
  
  setAuth: (token: string, profile: GuestProfile, userEvents?: any[]) => Promise<void>;
  updateProfile: (profile: Partial<GuestProfile>) => Promise<void>;
  setEventDetails: (slug: string | null, passcode: string | null, coverUrl?: string | null, title?: string | null, openedFrom?: 'home' | 'mycircle' | null) => void;
  leaveEvent: (eventSlugOrId: string | number) => Promise<void>;
  loadStoredAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  profile: null,
  userEvents: [],
  isLoading: true,
  isPhoneSkipped: false,
  eventSlug: null,
  passcode: null,
  eventCoverUrl: null,
  eventTitle: null,
  openedFrom: null,
  isTabBarCollapsed: false,
  galleryCache: {},
  
  setPhoneSkipped: (skipped) => set({ isPhoneSkipped: skipped }),
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

  setEventDetails: (
    eventSlug: string | null,
    passcode: string | null,
    eventCoverUrl?: string | null,
    eventTitle?: string | null,
    openedFrom?: 'home' | 'mycircle' | null
  ) => {
    if (!eventSlug) {
      set({
        eventSlug: null,
        passcode: null,
        eventCoverUrl: null,
        eventTitle: null,
        openedFrom: null,
      });
      return;
    }

    if (eventCoverUrl) {
      Image.prefetch(eventCoverUrl);
    }

    const currentOpenedFrom = get().openedFrom;
    const currentCoverUrl = get().eventCoverUrl;
    const currentTitle = get().eventTitle;

    set({
      eventSlug,
      passcode,
      eventCoverUrl: eventCoverUrl !== undefined ? eventCoverUrl : currentCoverUrl,
      eventTitle: eventTitle !== undefined ? eventTitle : currentTitle,
      openedFrom: openedFrom !== undefined ? openedFrom : (currentOpenedFrom || 'mycircle'),
    });

    import('../services/galleryPrefetch').then((m) => {
      m.prefetchEventGalleryData(eventSlug, passcode);
    }).catch(() => {});
  },

  leaveEvent: async (eventSlugOrId: string | number) => {
    console.log('[LEAVE EVENT 🚪] Triggered for:', eventSlugOrId);

    const currentEvents = get().userEvents;
    const updatedEvents = currentEvents.filter(
      (ev) => String(ev.slug || ev.id) !== String(eventSlugOrId)
    );
    set({ userEvents: updatedEvents });
    console.log('[LEAVE EVENT 🚪] Removed from local state. Events remaining:', updatedEvents.length);

    const profile = get().profile;
    console.log('[LEAVE EVENT 🚪] Profile:', {
      email: profile?.email,
      phoneNumber: profile?.phoneNumber,
      id: profile?.id,
    });

    try {
      await AsyncStorage.setItem('@mycircle_joined_events_list', JSON.stringify(updatedEvents));
      await SecureStore.deleteItemAsync('joined_events_list').catch(() => {});
      console.log('[LEAVE EVENT 🚪] AsyncStorage updated successfully');
    } catch (storageErr: any) {
      console.warn('[LEAVE EVENT ⚠️] AsyncStorage write failed:', storageErr?.message);
    }

    // Notify backend server of WhatsApp-style status: 'LEFT' participant state
    try {
      const apiService = require('../services/api').default;
      const payload = {
        status: 'LEFT',
        email: profile?.email || undefined,
        phoneNumber: profile?.phoneNumber || undefined,
      };
      console.log('[LEAVE EVENT 🚪] Calling API:', `/api/gallery/public/events/${eventSlugOrId}/leave`);
      console.log('[LEAVE EVENT 🚪] Payload:', JSON.stringify(payload));
      const response = await apiService.post(`/api/gallery/public/events/${eventSlugOrId}/leave`, payload);
      console.log('[LEAVE EVENT ✅] Server response:', JSON.stringify(response?.data));
    } catch (apiErr: any) {
      console.error('[LEAVE EVENT ❌] API call failed:', apiErr?.message);
      console.error('[LEAVE EVENT ❌] Status:', apiErr?.response?.status, '| Endpoint: /events/' + eventSlugOrId + '/leave');

    }
  },


  loadStoredAuth: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const profileStr = await SecureStore.getItemAsync(PROFILE_KEY);
      let profile: GuestProfile | null = profileStr ? JSON.parse(profileStr) : null;
      if (profile && profile.phoneNumber === 'skipped') {
        profile.phoneNumber = null;
      }
      set({ token, profile, isLoading: false, isPhoneSkipped: false });
    } catch (e) {
      // SecureStore may fail on simulator builds without keychain entitlements — this is expected.
      console.warn('SecureStore unavailable, starting with no stored session:', e);
      set({ isLoading: false, isPhoneSkipped: false });
    }
  },

  logout: async () => {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
      await SecureStore.deleteItemAsync(PROFILE_KEY).catch(() => {});
      await SecureStore.deleteItemAsync('joined_events_list').catch(() => {});
      await AsyncStorage.removeItem('@mycircle_user_events_cache').catch(() => {});
      await AsyncStorage.removeItem('@mycircle_joined_events_list').catch(() => {});

      // Sign out of Google so the account picker is shown on next sign-in
      try {
        const { GoogleSignin } = require('@react-native-google-signin/google-signin');
        await GoogleSignin.signOut();
      } catch (_) {
        // Native module may not be available in all environments (e.g. Expo Go)
      }
      set({
        token: null,
        profile: null,
        userEvents: [],
        galleryCache: {},
        isLoading: false,
        eventSlug: null,
        passcode: null,
        eventCoverUrl: null,
        eventTitle: null,
        openedFrom: null,
        isPhoneSkipped: false,
      });
    } catch (e) {
      console.error('Error deleting auth state', e);
    }
  },
}));
