import AsyncStorage from '@react-native-async-storage/async-storage';

const WATCHLIST_STORAGE_KEY = '@mycircle_video_watchlist_v1';

class VideoWatchlistManager {
  private watchlistIds: Set<string> = new Set();
  private isLoaded = false;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  public getKey(item: any): string {
    if (!item) return '';
    if (item.id !== undefined && item.id !== null) return String(item.id);
    if (item.videoUrl) return String(item.videoUrl);
    if (item.r2Url) return String(item.r2Url);
    if (item.uri) return String(item.uri);
    return '';
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(WATCHLIST_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.watchlistIds = new Set(parsed.map(String));
        }
      }
    } catch (e) {
      console.warn('[WATCHLIST ⚠️] Failed to load watchlist:', e);
    } finally {
      this.isLoaded = true;
      this.notifyListeners();
    }
  }

  private async persistToStorage(): Promise<void> {
    try {
      const arr = Array.from(this.watchlistIds);
      await AsyncStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {
      console.warn('[WATCHLIST ⚠️] Failed to persist watchlist:', e);
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

  public isInWatchlist(video: any): boolean {
    const key = this.getKey(video);
    if (!key) return false;
    return this.watchlistIds.has(key);
  }

  public async toggleWatchlist(video: any): Promise<boolean> {
    const key = this.getKey(video);
    if (!key) return false;

    const exists = this.watchlistIds.has(key);
    if (exists) {
      this.watchlistIds.delete(key);
    } else {
      this.watchlistIds.add(key);
    }

    this.notifyListeners();
    await this.persistToStorage();
    return !exists;
  }

  public getWatchlistIds(): string[] {
    return Array.from(this.watchlistIds);
  }
}

export const videoWatchlistManager = new VideoWatchlistManager();
