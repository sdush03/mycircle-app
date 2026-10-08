import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { getBaseUrl } from '../utils/imageUrl';

export interface FilmstripKeyframe {
  index: number;
  id: number;
  r2Url: string;
  thumbnailUrl: string;
  tabName?: string;
  localPath?: string;
}

export interface FilmstripData {
  total: number;
  step: number;
  tab: string;
  keyframes: FilmstripKeyframe[];
}

/**
 * Returns a crystal-clear 150px thumbnail URL (~2.4KB per image) for the spatial film loupe.
 * Matches Retina displays on mobile while keeping overall album payload under 160KB.
 */
export function getKeyframe150pxUrl(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let trimmed = rawUrl.trim();
  if (!trimmed) return '';

  const base = getBaseUrl();
  if (trimmed.startsWith('/')) {
    trimmed = `${base}${trimmed}`;
  }

  // Local file or data URI: return as is
  if (trimmed.startsWith('file:') || trimmed.startsWith('ph:') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  // If already a resize endpoint, ensure w=150 and q=75
  if (trimmed.includes('/api/gallery/resize')) {
    return trimmed
      .replace(/([?&])w=\d+/, '$1w=150')
      .replace(/([?&])q=\d+/, '$1q=75');
  }

  // Route through Cloudflare-backed backend image resizer at 150px
  return `${base}/api/gallery/resize?url=${encodeURIComponent(trimmed)}&w=150&q=75`;
}

// Backward-compatible alias
export const getKeyframe50pxUrl = getKeyframe150pxUrl;

/**
 * Resolves the permanent document storage directory for an event's filmstrip.
 * Files stored here are never purged by the OS (unlike cacheDirectory).
 */
export async function getPermanentFilmstripDir(eventSlug: string): Promise<string> {
  const baseDir = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  const cleanSlug = (eventSlug || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const targetDir = `${baseDir.replace(/\/+$/, '')}/filmstrip_permanent/${cleanSlug}/`;

  try {
    const info = await FileSystem.getInfoAsync(targetDir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
    }
  } catch (err) {
    console.warn('[FILMSTRIP STORAGE ⚠️] Could not create permanent directory:', err);
  }

  return targetDir;
}

/**
 * Reads permanently stored filmstrip metadata and verifies local files exist.
 */
export async function getStoredFilmstrip(
  eventSlug: string,
  tabName: string
): Promise<FilmstripData | null> {
  if (!eventSlug) return null;
  const normTab = (tabName || 'ALL').trim().toUpperCase();
  const storageKey = `@mycircle_filmstrip_perm_${eventSlug}_${normTab}`;

  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) return null;

    const data: FilmstripData = JSON.parse(raw);
    if (!data || !Array.isArray(data.keyframes) || data.keyframes.length === 0) {
      return null;
    }

    // Verify the first and last keyframe file actually exist on disk
    const firstKf = data.keyframes[0];
    if (firstKf?.thumbnailUrl?.startsWith('file:')) {
      const check = await FileSystem.getInfoAsync(firstKf.thumbnailUrl);
      if (!check.exists) {
        // Files were moved or purged; invalidate stale metadata
        return null;
      }
    }

    // Pre-warm all verified local keyframe files into expo-image memory cache immediately
    const localUris = data.keyframes.map((k) => k.thumbnailUrl).filter(Boolean);
    if (localUris.length > 0) {
      Image.prefetch(localUris, 'memory-disk');
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Downloads all 150px keyframes to permanent storage and saves the mapping to AsyncStorage.
 * Downloads in parallel batches of 8 for optimal network throughput.
 */
export async function persistFilmstripKeyframes(
  eventSlug: string,
  tabName: string,
  data: FilmstripData
): Promise<FilmstripData> {
  if (!eventSlug || !data || !Array.isArray(data.keyframes) || data.keyframes.length === 0) {
    return data;
  }

  const normTab = (tabName || 'ALL').trim().toUpperCase();
  const storageKey = `@mycircle_filmstrip_perm_${eventSlug}_${normTab}`;

  try {
    const dir = await getPermanentFilmstripDir(eventSlug);
    const updatedKeyframes: FilmstripKeyframe[] = [];

    // Helper: process a single keyframe download
    const processKeyframe = async (kf: FilmstripKeyframe): Promise<FilmstripKeyframe> => {
      const localFilename = `${normTab}_kf_${kf.id}_150px.jpg`;
      const localPath = `${dir}${localFilename}`;

      try {
        const fileInfo = await FileSystem.getInfoAsync(localPath);
        if (fileInfo.exists && fileInfo.size && fileInfo.size > 200) {
          return {
            ...kf,
            thumbnailUrl: localPath,
            localPath,
          };
        }

        const remote150pxUrl = getKeyframe150pxUrl(kf.thumbnailUrl || kf.r2Url);
        if (!remote150pxUrl) return kf;

        const downloadRes = await FileSystem.downloadAsync(remote150pxUrl, localPath);
        if (downloadRes.status === 200) {
          return {
            ...kf,
            thumbnailUrl: downloadRes.uri,
            localPath: downloadRes.uri,
          };
        }
      } catch {
        // Fallback to remote 150px URL if download fails
      }

      return {
        ...kf,
        thumbnailUrl: getKeyframe150pxUrl(kf.thumbnailUrl || kf.r2Url),
      };
    };

    // Download in concurrency chunks of 8
    const CHUNK_SIZE = 8;
    for (let i = 0; i < data.keyframes.length; i += CHUNK_SIZE) {
      const chunk = data.keyframes.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(chunk.map((kf) => processKeyframe(kf)));
      updatedKeyframes.push(...results);
    }

    // Clean up any stale/orphaned keyframe files for this tab no longer in the milestone list
    try {
      const allFiles = await FileSystem.readDirectoryAsync(dir);
      const currentFilenames = new Set(updatedKeyframes.map((kf) => `${normTab}_kf_${kf.id}_150px.jpg`));
      for (const file of allFiles) {
        if (file.startsWith(`${normTab}_kf_`) && !currentFilenames.has(file)) {
          FileSystem.deleteAsync(`${dir}${file}`, { idempotent: true }).catch(() => {});
        }
      }
    } catch (_) {}

    const persistedData: FilmstripData = {
      ...data,
      keyframes: updatedKeyframes,
    };

    // Save updated metadata to persistent AsyncStorage
    await AsyncStorage.setItem(storageKey, JSON.stringify(persistedData));
    console.log(`[FILMSTRIP STORAGE 💾] Successfully stored ${updatedKeyframes.length} 150px keyframes permanently for "${eventSlug}" [${normTab}]`);

    // Pre-warm all permanently stored keyframes into expo-image RAM cache
    const localUris = updatedKeyframes.map((k) => k.thumbnailUrl).filter(Boolean);
    if (localUris.length > 0) {
      Image.prefetch(localUris, 'memory-disk');
    }

    return persistedData;
  } catch (err) {
    console.warn('[FILMSTRIP STORAGE ⚠️] Could not persist keyframes:', err);
    return data;
  }
}
