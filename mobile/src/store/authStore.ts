import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { userSelfieStorage } from '../services/userSelfieStorage';

const TOKEN_KEY = 'user_session_token';
const PROFILE_KEY = 'user_profile_data';
const GALLERY_CACHE_KEY = '@mycircle_gallery_cache_v1';
const PROFILE_CACHE_KEY = '@mycircle_profile_cache_v1';

export interface ProfileCacheData {
  eventGroups: any[];
  favouriteEventGroups: any[];
  totalMatchedCount: number;
  totalFavouriteCount: number;
  timestamp: number;
}

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
  totalMatched?: number;
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
  profileCache: ProfileCacheData | null;
  pendingInvite: { slug: string; passcode: string | null; tab?: string | null } | null;
  initialTab: string | null;
  setPendingInvite: (invite: { slug: string; passcode: string | null; tab?: string | null } | null) => void;
  clearInitialTab: () => void;
  setPhoneSkipped: (skipped: boolean) => void;
  setTabBarCollapsed: (collapsed: boolean) => void;
  setUserEvents: (events: any[]) => void;
  setGalleryCache: (eventSlug: string, data: Partial<GalleryCacheEntry>) => void;
  clearGalleryCache: (eventSlug: string) => void;
  getGalleryCache: (eventSlug: string) => GalleryCacheEntry | null;
  setProfileCache: (data: Partial<ProfileCacheData>) => void;
  getProfileCache: () => ProfileCacheData | null;
  
  setAuth: (token: string, profile: GuestProfile, userEvents?: any[]) => Promise<void>;
  updateToken: (token: string) => Promise<void>;
  updateProfile: (profile: Partial<GuestProfile>) => Promise<void>;
  setEventDetails: (slug: string | null, passcode: string | null, coverUrl?: string | null, title?: string | null, openedFrom?: 'home' | 'mycircle' | null, initialTab?: string | null) => void;
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
  profileCache: null,
  pendingInvite: null,
  initialTab: null,

  setPendingInvite: (pendingInvite) => set({ pendingInvite }),
  clearInitialTab: () => set({ initialTab: null }),
  setPhoneSkipped: (skipped) => set({ isPhoneSkipped: skipped }),
  setTabBarCollapsed: (collapsed) => set({ isTabBarCollapsed: collapsed }),
  setUserEvents: (events) => set({ userEvents: events }),
  setGalleryCache: (eventSlug, data) => {
    if (!eventSlug) return;
    const current = get().galleryCache[eventSlug] || { timestamp: Date.now() };
    const updatedEntry: GalleryCacheEntry = {
      ...current,
      ...data,
      timestamp: Date.now(),
    };
    const newCache = {
      ...get().galleryCache,
      [eventSlug]: updatedEntry,
    };
    set({ galleryCache: newCache });
    AsyncStorage.setItem(GALLERY_CACHE_KEY, JSON.stringify(newCache)).catch(() => {});
  },
  clearGalleryCache: (eventSlug) => {
    if (!eventSlug) return;
    const newCache = { ...get().galleryCache };
    delete newCache[eventSlug];
    set({ galleryCache: newCache });
    AsyncStorage.setItem(GALLERY_CACHE_KEY, JSON.stringify(newCache)).catch(() => {});
  },
  getGalleryCache: (eventSlug) => {
    if (!eventSlug) return null;
    const entry = get().galleryCache[eventSlug];
    if (!entry) return null;
    // Invalidate stale cache if it contains synthetic upgrade banner photo (id 999999)
    if (entry.photos && entry.photos.some((p: any) => p.id === 999999)) {
      return null;
    }
    return entry;
  },
  setProfileCache: (data) => {
    const current = get().profileCache || { eventGroups: [], favouriteEventGroups: [], totalMatchedCount: 0, totalFavouriteCount: 0, timestamp: Date.now() };
    const updated: ProfileCacheData = {
      ...current,
      ...data,
      timestamp: Date.now(),
    };
    set({ profileCache: updated });
    AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(updated)).catch(() => {});
  },
  getProfileCache: () => {
    return get().profileCache;
  },

  setAuth: async (token, profile, userEvents = []) => {
    try {
      // Increment session epoch to invalidate any pending in-flight token updates from previous sessions
      if (!(global as any)._sessionEpoch) {
        (global as any)._sessionEpoch = 1;
      } else {
        (global as any)._sessionEpoch++;
      }
      const sessionEpochAtStart = (global as any)._sessionEpoch;

      const { selfieUrl, ...persistentProfile } = profile;
      await SecureStore.setItemAsync(TOKEN_KEY, token);

      // If epoch changed while saving, abort
      if ((global as any)._sessionEpoch !== sessionEpochAtStart) return;

      await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(persistentProfile));
      if ((global as any)._sessionEpoch !== sessionEpochAtStart) return;

      if (selfieUrl) {
        userSelfieStorage.saveLocalSelfie(selfieUrl).then((localUri) => {
          const current = get().profile;
          if (current && current.selfieUrl !== localUri) {
            set({ profile: { ...current, selfieUrl: localUri, hasSelfie: true } });
          }
        }).catch(() => {});
      }

      import('./likesStore').then((m) => m.useLikesStore.getState().initForUser(profile.id)).catch(() => {});

      const pending = get().pendingInvite;
      if (pending && pending.slug) {
        set({ 
          token, 
          profile, 
          userEvents, 
          isLoading: false, 
          pendingInvite: null,
          eventSlug: pending.slug,
          passcode: pending.passcode,
          openedFrom: 'mycircle',
          initialTab: pending.tab || null,
        });
        import('../services/galleryPrefetch').then((m) => {
          m.prefetchEventGalleryData(pending.slug, pending.passcode);
        }).catch(() => {});
      } else {
        set({ token, profile, userEvents, isLoading: false });
      }
    } catch (e) {
      console.error('Error saving auth state', e);
    }
  },

  // Serialized mutex queue & 15s throttle window to prevent parallel rotation races
  updateToken: async (token: string) => {
    try {
      if (!token || typeof token !== 'string') return;

      const epochAtCall = (global as any)._sessionEpoch || 0;

      const getJwtMeta = (t: string) => {
        try {
          const parts = t.split('.');
          if (parts.length < 2) return { iat: 0 };
          let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          while (base64.length % 4) base64 += '=';
          const decoded = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
          const parsed = JSON.parse(decoded);
          return { iat: parsed?.iat || 0 };
        } catch {
          return { iat: 0 };
        }
      };

      if (!(global as any)._tokenUpdateChain) {
        (global as any)._tokenUpdateChain = Promise.resolve();
        (global as any)._lastTokenUpdateAt = 0;
      }

      (global as any)._tokenUpdateChain = (global as any)._tokenUpdateChain.then(async () => {
        // If user logged out or a new user logged in while this update was queued, discard immediately
        if (((global as any)._sessionEpoch || 0) !== epochAtCall) {
          return;
        }

        const currentToken = get().token;
        if (currentToken === token) return;

        const now = Date.now();
        const lastUpdate = (global as any)._lastTokenUpdateAt || 0;
        // Throttle automatic rolling token refreshes to at most once every 15 seconds
        // to completely eliminate out-of-order race conditions from parallel gallery fetch bursts.
        if (now - lastUpdate < 15000) {
          return;
        }

        const incomingMeta = getJwtMeta(token);
        const currentMeta = getJwtMeta(currentToken || '');

        if (incomingMeta.iat > 0 && currentMeta.iat > 0) {
          if (incomingMeta.iat < currentMeta.iat) {
            console.warn('[AUTH 🛡️] Discarding obsolete token (incoming iat older than current iat)');
            return;
          }
        }

        // Attempt SecureStore persistence first — if this throws, we do NOT update Zustand state
        await SecureStore.setItemAsync(TOKEN_KEY, token);

        // Re-check epoch after async SecureStore write
        if (((global as any)._sessionEpoch || 0) !== epochAtCall) {
          return;
        }

        // Persistence succeeded, update in-memory state and timestamp tracker
        (global as any)._lastTokenUpdateAt = now;
        set({ token });
      });

      await (global as any)._tokenUpdateChain;
    } catch (e) {
      console.warn('Error updating token in storage (SecureStore failure):', e);
      // SecureStore failed: state remains unchanged, avoiding silent divergence
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

      if (updatedFields.selfieUrl !== undefined) {
        if (updatedFields.selfieUrl) {
          userSelfieStorage.saveLocalSelfie(updatedFields.selfieUrl).then((localUri) => {
            const current = get().profile;
            if (current && current.selfieUrl !== localUri) {
              set({ profile: { ...current, selfieUrl: localUri, hasSelfie: true } });
            }
          }).catch(() => {});
        } else {
          userSelfieStorage.clearLocalSelfie().catch(() => {});
        }
      }
    } catch (e) {
      console.error('Error updating profile state', e);
    }
  },

  setEventDetails: (
    eventSlug: string | null,
    passcode: string | null,
    eventCoverUrl?: string | null,
    eventTitle?: string | null,
    openedFrom?: 'home' | 'mycircle' | null,
    initialTab?: string | null
  ) => {
    if (!eventSlug) {
      set({
        eventSlug: null,
        passcode: null,
        eventCoverUrl: null,
        eventTitle: null,
        openedFrom: null,
        initialTab: null,
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
      initialTab: initialTab !== undefined ? initialTab : null,
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
      get().clearGalleryCache(String(eventSlugOrId));
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

      // Load persisted selfie from local storage (0ms Frame 1 instant render)
      if (profile) {
        try {
          const cachedSelfie = await userSelfieStorage.getLocalSelfie();
          if (cachedSelfie) {
            profile.selfieUrl = cachedSelfie;
            profile.hasSelfie = true;
          }
        } catch (e) {
          console.warn('Error loading cached selfie:', e);
        }
      }
      
      // Load persisted gallery cache into memory so Frame 1 gallery launch is instant (0ms) even after cold start
      let galleryCache: Record<string, GalleryCacheEntry> = {};
      try {
        const cachedStr = await AsyncStorage.getItem(GALLERY_CACHE_KEY);
        if (cachedStr) {
          const parsed = JSON.parse(cachedStr);
          if (parsed && typeof parsed === 'object') {
            galleryCache = parsed;
          }
        }
      } catch (_) {}

      let profileCache: ProfileCacheData | null = null;
      try {
        const cachedProfileStr = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
        if (cachedProfileStr) {
          const parsed = JSON.parse(cachedProfileStr);
          if (parsed && typeof parsed === 'object') {
            profileCache = parsed;
          }
        }
      } catch (_) {}

      // If an incoming deep link arrived while Keychain was loading, activate it immediately
      import('./likesStore').then((m) => m.useLikesStore.getState().initForUser(profile?.id || null)).catch(() => {});

      const pending = get().pendingInvite;
      if (token && pending && pending.slug) {
        set({
          token,
          profile,
          galleryCache,
          profileCache,
          isLoading: false,
          isPhoneSkipped: false,
          pendingInvite: null,
          eventSlug: pending.slug,
          passcode: pending.passcode,
          openedFrom: 'mycircle',
          initialTab: pending.tab || null,
        });
        import('../services/galleryPrefetch').then((m) => {
          m.prefetchEventGalleryData(pending.slug, pending.passcode);
        }).catch(() => {});
      } else {
        set({ token, profile, galleryCache, profileCache, isLoading: false, isPhoneSkipped: false });
      }
    } catch (e) {
      // SecureStore may fail on simulator builds without keychain entitlements — this is expected.
      console.warn('SecureStore unavailable, starting with no stored session:', e);
      set({ isLoading: false, isPhoneSkipped: false });
    }
  },

  logout: async () => {
    try {
      // Increment session epoch to immediately invalidate any pending in-flight token updates
      if (!(global as any)._sessionEpoch) {
        (global as any)._sessionEpoch = 1;
      } else {
        (global as any)._sessionEpoch++;
      }

      await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
      await SecureStore.deleteItemAsync(PROFILE_KEY).catch(() => {});
      await SecureStore.deleteItemAsync('joined_events_list').catch(() => {});
      await AsyncStorage.removeItem('@mycircle_user_events_cache').catch(() => {});
      await AsyncStorage.removeItem('@mycircle_joined_events_list').catch(() => {});
      await AsyncStorage.removeItem(GALLERY_CACHE_KEY).catch(() => {});
      await AsyncStorage.removeItem(PROFILE_CACHE_KEY).catch(() => {});
      await userSelfieStorage.clearLocalSelfie().catch(() => {});
      import('./likesStore').then((m) => m.useLikesStore.getState().clearLikes()).catch(() => {});

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
        profileCache: null,
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
