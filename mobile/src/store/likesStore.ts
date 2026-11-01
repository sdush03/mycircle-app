import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { guestApi } from '../services/api';
import { tabEvents, EVENT_PHOTO_LIKED, EVENT_SAVES_UPDATED } from '../lib/tabEvents';
import { useAuthStore } from './authStore';

const STORAGE_PREFIX = '@mycircle_likes_v2_';

export interface LikesState {
  likes: Record<string, boolean>;
  likeCounts: Record<string, number>;
  inFlightSync: Record<string, boolean>;
  currentUserId: string | number | null;

  initForUser: (userId: string | number | null) => Promise<void>;
  isLiked: (photoId: string | number | null | undefined, fallback?: boolean) => boolean;
  getLikeCount: (photoId: string | number | null | undefined, fallback?: number) => number;
  setLikesBatch: (
    photos: Array<{ id?: string | number; isLiked?: boolean; likeCount?: number }>
  ) => void;
  toggleLike: (params: {
    photoId: string | number;
    eventSlug: string;
    explicitLiked?: boolean;
    currentCount?: number;
    authHeaders?: Record<string, string>;
  }) => Promise<{ liked: boolean; likeCount: number }>;
  clearLikes: () => void;
  getAllLikedPhotoIds: () => Set<string>;
}

export const useLikesStore = create<LikesState>((set, get) => ({
  likes: {},
  likeCounts: {},
  inFlightSync: {},
  currentUserId: null,

  initForUser: async (userId: string | number | null) => {
    const key = `${STORAGE_PREFIX}${userId || 'guest'}`;
    set({ currentUserId: userId });
    try {
      const stored = await AsyncStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          set((state) => ({
            likes: { ...parsed.likes, ...state.likes },
            likeCounts: { ...parsed.likeCounts, ...state.likeCounts },
          }));
        }
      }
    } catch (_) {}
  },

  isLiked: (photoId: string | number | null | undefined, fallback: boolean = false) => {
    if (photoId == null) return fallback;
    const key = String(photoId);
    const val = get().likes[key];
    return typeof val === 'boolean' ? val : fallback;
  },

  getLikeCount: (photoId: string | number | null | undefined, fallback: number = 0) => {
    if (photoId == null) return fallback;
    const key = String(photoId);
    const count = get().likeCounts[key];
    return typeof count === 'number' ? count : fallback;
  },

  setLikesBatch: (
    photos: Array<{ id?: string | number; isLiked?: boolean; likeCount?: number }>
  ) => {
    if (!Array.isArray(photos) || photos.length === 0) return;

    set((state) => {
      const nextLikes = { ...state.likes };
      const nextCounts = { ...state.likeCounts };
      let changed = false;

      for (const p of photos) {
        if (!p || p.id == null) continue;
        const key = String(p.id);

        // Do NOT overwrite photos currently synchronizing with the server
        if (state.inFlightSync[key]) continue;

        if (typeof p.isLiked === 'boolean') {
          if (nextLikes[key] !== p.isLiked) {
            nextLikes[key] = p.isLiked;
            changed = true;
          }
        }
        if (typeof p.likeCount === 'number') {
          if (nextCounts[key] !== p.likeCount) {
            nextCounts[key] = p.likeCount;
            changed = true;
          }
        }
      }

      if (!changed) return state;

      // Persist in background
      const userId = state.currentUserId || useAuthStore.getState().profile?.id || 'guest';
      AsyncStorage.setItem(
        `${STORAGE_PREFIX}${userId}`,
        JSON.stringify({ likes: nextLikes, likeCounts: nextCounts })
      ).catch(() => {});

      return { likes: nextLikes, likeCounts: nextCounts };
    });
  },

  toggleLike: async ({
    photoId,
    eventSlug,
    explicitLiked,
    currentCount,
    authHeaders,
  }) => {
    const key = String(photoId);
    const state = get();

    // Prevent concurrent duplicate in-flight requests for the exact same photo
    if (state.inFlightSync[key]) {
      const current = typeof state.likes[key] === 'boolean' ? state.likes[key] : false;
      const count = typeof state.likeCounts[key] === 'number' ? state.likeCounts[key] : (currentCount || 0);
      return { liked: current, likeCount: count };
    }

    const wasLiked = typeof state.likes[key] === 'boolean' ? state.likes[key] : false;
    const nextLiked = typeof explicitLiked === 'boolean' ? explicitLiked : !wasLiked;
    const currentLikeCount = typeof state.likeCounts[key] === 'number'
      ? state.likeCounts[key]
      : (typeof currentCount === 'number' ? currentCount : 0);
    const nextLikeCount = Math.max(0, currentLikeCount + (nextLiked ? 1 : -1));

    // 1. Optimistic state update in centralized store
    set((s) => ({
      likes: { ...s.likes, [key]: nextLiked },
      likeCounts: { ...s.likeCounts, [key]: nextLikeCount },
      inFlightSync: { ...s.inFlightSync, [key]: true },
    }));

    // Broadcast instant photo like event to legacy listeners
    tabEvents.emit(EVENT_PHOTO_LIKED, {
      photoId: key,
      isLiked: nextLiked,
      likeCount: nextLikeCount,
    });

    // 2. Persist to AsyncStorage immediately
    const userId = state.currentUserId || useAuthStore.getState().profile?.id || 'guest';
    const updatedStore = {
      likes: { ...get().likes, [key]: nextLiked },
      likeCounts: { ...get().likeCounts, [key]: nextLikeCount },
    };
    AsyncStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(updatedStore)).catch(() => {});

    // 3. Dispatch idempotent API request to backend
    try {
      const headers = authHeaders || {};
      const res = await guestApi.post(
        `/api/gallery/public/events/${eventSlug}/photos/${photoId}/like`,
        { liked: nextLiked },
        { headers }
      );

      const serverLiked = typeof res.data?.liked === 'boolean' ? res.data.liked : nextLiked;
      const serverCount = typeof res.data?.likeCount === 'number' ? res.data.likeCount : nextLikeCount;

      set((s) => {
        const nextInFlight = { ...s.inFlightSync };
        delete nextInFlight[key];
        return {
          likes: { ...s.likes, [key]: serverLiked },
          likeCounts: { ...s.likeCounts, [key]: serverCount },
          inFlightSync: nextInFlight,
        };
      });

      tabEvents.emit(EVENT_PHOTO_LIKED, {
        photoId: key,
        isLiked: serverLiked,
        likeCount: serverCount,
      });
      tabEvents.emit(EVENT_SAVES_UPDATED);

      return { liked: serverLiked, likeCount: serverCount };
    } catch (err) {
      console.warn(`[likesStore ⚠️] toggleLike failed for photo ${photoId}:`, err);
      // Revert on error
      set((s) => {
        const nextInFlight = { ...s.inFlightSync };
        delete nextInFlight[key];
        return {
          likes: { ...s.likes, [key]: wasLiked },
          likeCounts: { ...s.likeCounts, [key]: currentLikeCount },
          inFlightSync: nextInFlight,
        };
      });

      tabEvents.emit(EVENT_PHOTO_LIKED, {
        photoId: key,
        isLiked: wasLiked,
        likeCount: currentLikeCount,
      });

      return { liked: wasLiked, likeCount: currentLikeCount };
    }
  },

  clearLikes: () => {
    set({ likes: {}, likeCounts: {}, inFlightSync: {} });
  },

  getAllLikedPhotoIds: () => {
    const s = get().likes;
    const result = new Set<string>();
    for (const [id, isLiked] of Object.entries(s)) {
      if (isLiked) result.add(id);
    }
    return result;
  },
}));
