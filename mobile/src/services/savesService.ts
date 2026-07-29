import api from './api';
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
    try {
      const res = await api.post('/api/saves', { photoUrl, storyId, sourceType: 'FEATURED_STORY', displayRole });
      tabEvents.emit(EVENT_SAVES_UPDATED);
      return res.data?.savedPhoto || null;
    } catch (err) {
      console.error('[savesService] savePhoto failed:', err);
      return null;
    }
  },

  async unsavePhoto(photoUrl: string, id?: number): Promise<boolean> {
    try {
      const res = await api.delete('/api/saves', { params: { photoUrl, id } });
      tabEvents.emit(EVENT_SAVES_UPDATED);
      return !!res.data?.success;
    } catch (err) {
      console.error('[savesService] unsavePhoto failed:', err);
      return false;
    }
  },

  async getSavedPhotos(): Promise<SavedPhotoItem[]> {
    try {
      const res = await api.get('/api/saves');
      return res.data?.saves || [];
    } catch (err) {
      console.error('[savesService] getSavedPhotos failed:', err);
      return [];
    }
  },

  async checkIsSaved(photoUrl: string): Promise<{ isSaved: boolean; savedBy?: { userId: number; displayRole: string } }> {
    try {
      const res = await api.get('/api/saves/check', { params: { photoUrl } });
      return res.data || { isSaved: false };
    } catch (err) {
      console.error('[savesService] checkIsSaved failed:', err);
      return { isSaved: false };
    }
  }
};
