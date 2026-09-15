import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@mycircle_video_watch_progress';

export interface WatchProgress {
  currentTime: number;
  duration: number;
  progressPercent: number; // 0.0 to 1.0
  isCompleted: boolean;
  updatedAt: number;
}

class VideoWatchProgressManager {
  private cache: Map<string, WatchProgress> = new Map();
  private isLoaded = false;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private getKeys(item: any): string[] {
    if (!item) return [];
    const keys: string[] = [];
    if (typeof item === 'string') {
      const clean = item.split('?')[0].toLowerCase();
      keys.push(clean);
      if (clean !== item) keys.push(item);
      return keys;
    }
    if (item.id !== undefined && item.id !== null) {
      keys.push(String(item.id));
    }
    const rawUrl = item.videoUrl || item.r2Url || item.fullUri || item.uri || item.photoUrl || item.file_url || item.filename;
    if (rawUrl && typeof rawUrl === 'string') {
      const clean = rawUrl.split('?')[0].toLowerCase();
      if (!keys.includes(clean)) keys.push(clean);
      if (clean !== rawUrl && !keys.includes(rawUrl)) keys.push(rawUrl);
    }
    return keys;
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          Object.entries(parsed).forEach(([k, v]) => {
            this.cache.set(k, v as WatchProgress);
          });
        }
      }
    } catch (e) {
      console.warn('[WATCH PROGRESS ⚠️] Failed to load watch progress:', e);
    } finally {
      this.isLoaded = true;
      this.notifyListeners();
    }
  }

  private async persistToStorage(): Promise<void> {
    try {
      const obj: Record<string, WatchProgress> = {};
      this.cache.forEach((v, k) => {
        obj[k] = v;
      });
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      console.warn('[WATCH PROGRESS ⚠️] Failed to persist watch progress:', e);
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch {}
    });
  }

  /**
   * Returns watch progress for a video item.
   * Checks multi-key fallback (both ID and videoUrl).
   * If < 5% watched: returns null (clean unwatched state).
   * If >= 90% watched or completed: returns { isCompleted: true, progressPercent: 0, currentTime: 0 } (reset state).
   * If 5% <= progress < 90%: returns { isCompleted: false, progressPercent, currentTime }.
   */
  public getProgress(item: any): WatchProgress | null {
    const keys = this.getKeys(item);
    if (keys.length === 0) return null;

    let entry: WatchProgress | undefined;
    for (const k of keys) {
      const found = this.cache.get(k);
      if (found) {
        entry = found;
        break;
      }
    }
    if (!entry) return null;

    // If video was replaced with a new version after this progress was saved, invalidate stale progress
    const replacedRaw = item?.videoReplacedAt || item?.exif?.videoReplacedAt || item?.meta?.videoReplacedAt || item?.raw?.videoReplacedAt || item?.raw?.exif?.videoReplacedAt;
    if (replacedRaw) {
      const replacedTime = new Date(replacedRaw).getTime();
      if (!isNaN(replacedTime) && entry.updatedAt && entry.updatedAt < replacedTime) {
        return null;
      }
    }

    if (entry.isCompleted) {
      return {
        ...entry,
        progressPercent: 0,
        isCompleted: true,
        currentTime: 0,
      };
    }

    const ratio = entry.duration > 0 ? entry.currentTime / entry.duration : 0;

    // Completed threshold: >= 90%
    if (ratio >= 0.9) {
      return {
        ...entry,
        progressPercent: 0,
        isCompleted: true,
        currentTime: 0,
      };
    }

    // Meaningful progress threshold: >= 3% or >= 5 seconds watched
    if (ratio >= 0.03 || entry.currentTime >= 5) {
      return {
        ...entry,
        progressPercent: Math.min(1, Math.max(0, ratio)),
        isCompleted: false,
      };
    }

    // Below threshold is treated as unwatched
    return null;
  }

  /**
   * Save playback progress. Called during video playback.
   */
  public saveProgress(item: any, currentTime: number, duration: number): void {
    const keys = this.getKeys(item);
    if (keys.length === 0 || duration <= 0) return;

    const ratio = currentTime / duration;
    const isCompleted = ratio >= 0.9;

    const progress: WatchProgress = {
      currentTime: isCompleted ? 0 : currentTime,
      duration,
      progressPercent: isCompleted ? 0 : ratio,
      isCompleted,
      updatedAt: Date.now(),
    };

    keys.forEach((k) => this.cache.set(k, progress));
    this.persistToStorage();
    this.notifyListeners();
  }

  /**
   * Clear watch progress for a video (e.g. restart from 0:00).
   */
  public clearProgress(item: any): void {
    const keys = this.getKeys(item);
    if (keys.length === 0) return;
    keys.forEach((k) => this.cache.delete(k));
    this.persistToStorage();
    this.notifyListeners();
  }

  /**
   * Check whether a video item is currently being viewed (active, incomplete progress).
   */
  public isCurrentlyViewing(item: any): boolean {
    const progress = this.getProgress(item);
    return Boolean(
      progress &&
      !progress.isCompleted &&
      progress.progressPercent > 0 &&
      progress.currentTime > 0
    );
  }

  /**
   * Check whether a video item has been seen completely (>= 90% or explicitly completed).
   */
  public isSeenCompletely(item: any): boolean {
    const keys = this.getKeys(item);
    if (keys.length === 0) return false;

    for (const key of keys) {
      const entry = this.cache.get(key);
      if (!entry) continue;

      // If video was replaced with a new version after this was completed, it hasn't been seen completely
      const replacedRaw = item?.videoReplacedAt || item?.exif?.videoReplacedAt || item?.meta?.videoReplacedAt || item?.raw?.videoReplacedAt || item?.raw?.exif?.videoReplacedAt;
      if (replacedRaw) {
        const replacedTime = new Date(replacedRaw).getTime();
        if (!isNaN(replacedTime) && entry.updatedAt && entry.updatedAt < replacedTime) {
          continue;
        }
      }

      if (entry.isCompleted) return true;
      const ratio = entry.duration > 0 ? entry.currentTime / entry.duration : 0;
      if (ratio >= 0.9) return true;
    }

    return false;
  }

  /**
   * Check whether a video has been watched (either in progress or completed).
   */
  public hasWatched(item: any): boolean {
    if (this.isSeenCompletely(item)) return true;
    const progress = this.getProgress(item);
    return Boolean(progress && (progress.currentTime > 0 || progress.isCompleted));
  }

  /**
   * Explicitly mark a video as completed (seen completely).
   * Keeps completed status permanently so "New for you" badge never re-appears.
   */
  public markCompleted(item: any): void {
    const keys = this.getKeys(item);
    if (keys.length === 0) return;

    let existingDuration = 0;
    for (const k of keys) {
      const e = this.cache.get(k);
      if (e?.duration) {
        existingDuration = e.duration;
        break;
      }
    }
    const dur = existingDuration || (typeof item?.duration === 'number' ? item.duration : 0);

    const completedProgress: WatchProgress = {
      currentTime: 0,
      duration: dur,
      progressPercent: 0,
      isCompleted: true,
      updatedAt: Date.now(),
    };

    keys.forEach((k) => this.cache.set(k, completedProgress));
    this.persistToStorage();
    this.notifyListeners();
  }
}

export const videoWatchProgressManager = new VideoWatchProgressManager();
