import api from './api';
import { useAuthStore } from '../store/authStore';
import { tabEvents, EVENT_SAVES_UPDATED } from '../lib/tabEvents';

export interface SavedPhotoItem {
  id: number;
  eventId?: number;
  userId: number;
  photoUrl: string;
  storyId?: string;
  sourceType: string;
  createdAt: string;
  savedBy: {
    userId: number;
    name: string;
    email?: string;
    displayRole: 'BRIDE' | 'GROOM' | 'GUEST';
  };
}

export const savesService = {
  async savePhoto(photoUrl: string, storyId?: string, displayRole?: string): Promise<SavedPhotoItem | null> {
    const authState = useAuthStore.getState();
    if (!authState.token) return null;
    const eventSlug = authState.eventSlug || undefined;
    const email = authState.profile?.email || undefined;
    try {
      const res = await api.post('/api/saves', { photoUrl, storyId, sourceType: 'FEATURED_STORY', displayRole, eventSlug, email });
      tabEvents.emit(EVENT_SAVES_UPDATED);
      return res.data?.savedPhoto || null;
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        console.error('[savesService] savePhoto failed:', err);
      }
      return null;
    }
  },

  async unsavePhoto(photoUrl: string, id?: number): Promise<boolean> {
    const authState = useAuthStore.getState();
    if (!authState.token) return false;
    const eventSlug = authState.eventSlug || undefined;
    const email = authState.profile?.email || undefined;
    try {
      const res = await api.delete('/api/saves', { params: { photoUrl, id, eventSlug, email } });
      tabEvents.emit(EVENT_SAVES_UPDATED);
      return !!res.data?.success;
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        console.error('[savesService] unsavePhoto failed:', err);
      }
      return false;
    }
  },

  async getSavedPhotos(): Promise<SavedPhotoItem[]> {
    const authState = useAuthStore.getState();
    if (!authState.token) return [];
    const eventSlug = authState.eventSlug || undefined;
    const email = authState.profile?.email || undefined;
    try {
      const res = await api.get('/api/saves', { params: { eventSlug, email } });
      return res.data?.saves || [];
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        console.error('[savesService] getSavedPhotos failed:', err);
      }
      return [];
    }
  },

  async checkIsSaved(photoUrl: string): Promise<{ isSaved: boolean; savedBy?: { userId: number; displayRole: string } }> {
    const authState = useAuthStore.getState();
    if (!authState.token) return { isSaved: false };
    const eventSlug = authState.eventSlug || undefined;
    const email = authState.profile?.email || undefined;
    try {
      const res = await api.get('/api/saves/check', { params: { photoUrl, eventSlug, email } });
      return res.data || { isSaved: false };
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        console.error('[savesService] checkIsSaved failed:', err);
      }
      return { isSaved: false };
    }
  }
};
