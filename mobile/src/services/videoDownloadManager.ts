/**
 * VideoDownloadManager
 *
 * Netflix-style silent background video downloader.
 * - Downloads cinema videos permanently to Documents/mycircle-videos/ (hidden from Files app & Photos)
 * - Sequential queue: 1 download at a time to avoid competing with streaming bandwidth
 * - Pauses completely when a video is playing (PlaybackFocusManager integration)
 * - 3-tier storage cap based on device storage (LRU eviction):
 *     < 128 GB device  → 1.5 GB cap
 *     128–255 GB device → 2.5 GB cap
 *     ≥ 256 GB device  → 4.0 GB cap
 * - Atomic writes: downloads to .tmp first, renames on success (no partial corrupt files)
 * - Persists url→localPath map in AsyncStorage so downloads survive app restarts
 * - Auto-download: throttled when app is foregrounded (3s gap between items),
 *   full speed when app is backgrounded/minimised. Never competes with active playback.
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { playbackFocusManager } from './playbackFocusManager';

const DOWNLOAD_DIR = FileSystem.documentDirectory + 'mycircle-videos/';
const ASYNC_KEY = 'videoDownloadManager:v1:map';

// Storage caps by device tier (bytes)
const CAP_64GB = 1.5 * 1024 ** 3;    // 1.5 GB  → devices < 128 GB
const CAP_128GB = 2.5 * 1024 ** 3;   // 2.5 GB  → devices 128–255 GB
const CAP_256GB = 4.0 * 1024 ** 3;   // 4.0 GB  → devices ≥ 256 GB

// Inter-item delay when app is foregrounded — prevents network jank during browsing
const FOREGROUND_ITEM_DELAY_MS = 3000;

interface DownloadEntry {
  localPath: string;       // absolute path inside documentDirectory
  lastAccessedAt: number;  // unix ms — used for LRU eviction
  sizeBytes: number;
  priority?: number;       // 100 = Director's Cut, 85 = Candid Diaries, 70 = Stage & Spotlight, 55 = Extended Cuts
}

interface QueueItem {
  url: string;
  priority: number;
}

class VideoDownloadManager {
  /** url → DownloadEntry */
  private map: Map<string, DownloadEntry> = new Map();
  private _queue: QueueItem[] = [];
  private isDownloading = false;
  private isPaused = false;
  private isAppBackground = false;
  private currentDownloadResumable: FileSystem.DownloadResumable | null = null;
  private storageCap = CAP_128GB;
  private lastItemCompletedAt = 0;
  /** url → set of callbacks fired when that URL finishes downloading */
  private completionListeners: Map<string, Set<() => void>> = new Map();

  constructor() {
    this.init();
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  private async init() {
    try {
      // 1. Ensure download directory exists
      const info = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
      }

      // 2. Restore persisted map from AsyncStorage
      const raw = await AsyncStorage.getItem(ASYNC_KEY);
      if (raw) {
        const parsed: Record<string, DownloadEntry> = JSON.parse(raw);
        // Validate that files still exist on disk
        await Promise.all(
          Object.entries(parsed).map(async ([url, entry]) => {
            const fileInfo = await FileSystem.getInfoAsync(entry.localPath);
            if (fileInfo.exists) {
              this.map.set(url, entry);
            }
          })
        );
        console.log(`[VIDEO DOWNLOAD 💾 RESTORE] Restored ${this.map.size} downloaded videos from disk.`);
      }

      // 3. Determine storage cap by device total capacity
      this.storageCap = await this.resolveStorageCap();

      // 4. Subscribe to playback focus — pause downloads when Cinema player is open
      playbackFocusManager.subscribe((isPlaying) => {
        if (isPlaying) {
          this.isPaused = true;
          console.log('[VIDEO DOWNLOAD ⏸️] Downloads paused — Cinema player is active.');
          if (this.currentDownloadResumable) {
            try {
              this.currentDownloadResumable.pauseAsync().catch(() => {});
            } catch {}
          }
        } else {
          this.isPaused = false;
          console.log('[VIDEO DOWNLOAD ▶️] Downloads resumed — Cinema player closed.');
          this.processQueue();
        }
      });

      // 5. AppState listener — run at full speed in background, throttle in foreground
      AppState.addEventListener('change', (nextState: AppStateStatus) => {
        const wasBackground = this.isAppBackground;
        this.isAppBackground = nextState === 'background' || nextState === 'inactive';

        if (this.isAppBackground && !wasBackground) {
          // App just moved to background — kick off pending downloads at full speed
          console.log('[VIDEO DOWNLOAD 📲→🌙] App backgrounded — downloads at full speed.');
          this.processQueue();
        } else if (!this.isAppBackground && wasBackground) {
          console.log('[VIDEO DOWNLOAD 🌙→📲] App foregrounded — downloads will throttle between items.');
        }
      });

      // Seed initial AppState value
      this.isAppBackground =
        AppState.currentState === 'background' || AppState.currentState === 'inactive';

    } catch (err) {
      console.warn('[VIDEO DOWNLOAD ⚠️ INIT] Initialization error:', err);
    }
  }

  private async resolveStorageCap(): Promise<number> {
    try {
      const totalBytes = await FileSystem.getTotalDiskCapacityAsync();
      const totalGB = totalBytes / 1024 ** 3;
      if (totalGB >= 256) return CAP_256GB;
      if (totalGB >= 128) return CAP_128GB;
      return CAP_64GB;
    } catch {
      return CAP_128GB; // safe default
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Automatically queue an entire cinema library for silent background download.
   * Called from CinemaLibraryView on mount. Already-downloaded videos are skipped.
   *
   * Priority scale used by CinemaLibraryView:
   *   100 — Director's Cut       (highest — always download first)
   *    85 — Candid Diaries
   *    70 — Stage & Spotlight    (Dance)
   *    55 — Extended Cuts        (Full Films)
   *    40 — Anything uncategorised
   *
   * Downloads are delayed 5s after mount to let the UI fully settle first,
   * then run at 3s intervals while foregrounded, full speed when minimised.
   */
  public scheduleAutoDownload(videos: Array<{ url: string; priority: number }>): void {
    if (!videos || videos.length === 0) return;
    let queued = 0;
    for (const { url, priority } of videos) {
      if (!url || typeof url !== 'string' || !url.startsWith('http')) continue;
      const cleanUrl = url.split('?')[0].toLowerCase();
      if (
        !cleanUrl.endsWith('.mp4') && !cleanUrl.endsWith('.mov') &&
        !cleanUrl.endsWith('.m4v') && !cleanUrl.endsWith('.webm')
      ) continue;
      if (this.map.has(url)) continue; // already fully on disk
      const inQueue = this._queue.findIndex((item) => item.url === url);
      if (inQueue >= 0) {
        if (priority > this._queue[inQueue].priority) {
          this._queue[inQueue].priority = priority;
        }
        continue;
      }
      this._queue.push({ url, priority });
      queued++;
    }
    if (queued > 0) {
      this._queue.sort((a, b) => b.priority - a.priority);
      console.log(`[VIDEO DOWNLOAD 🗂️ AUTO] Scheduled ${queued} cinema videos for silent background download.`);
      // 5s initial delay — lets the UI settle, images load, and React navigation complete
      setTimeout(() => this.processQueue(), 5000);
    }
  }

  /**
   * Manually add a remote video URL to the download queue (e.g. user taps Download button).
   * Higher priority moves the video to the front of the queue.
   */
  public queue(url: string | null | undefined, priority: number = 50): void {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return;
    const cleanUrl = url.split('?')[0].toLowerCase();
    if (
      !cleanUrl.endsWith('.mp4') && !cleanUrl.endsWith('.mov') &&
      !cleanUrl.endsWith('.m4v') && !cleanUrl.endsWith('.webm')
    ) return;

    // If already downloaded, upgrade stored priority if higher
    if (this.map.has(url)) {
      const existing = this.map.get(url)!;
      if (priority > (existing.priority ?? 0)) {
        existing.priority = priority;
        this.persistMap();
      }
      return;
    }

    // If already in queue, upgrade priority and re-sort
    const inQueueIdx = this._queue.findIndex((item) => item.url === url);
    if (inQueueIdx >= 0) {
      if (priority > this._queue[inQueueIdx].priority) {
        this._queue[inQueueIdx].priority = priority;
        this._queue.sort((a, b) => b.priority - a.priority);
      }
      return;
    }

    this._queue.push({ url, priority });
    this._queue.sort((a, b) => b.priority - a.priority);
    console.log(`[VIDEO DOWNLOAD 📥 QUEUED] priority=${priority} | ${url.slice(0, 70)}... | Queue size: ${this._queue.length}`);
    this.processQueue();
  }

  /**
   * Returns the local file:// path if the video has been fully downloaded, else null.
   * Updates lastAccessedAt for LRU tracking.
   */
  public getLocalPath(url: string | null | undefined): string | null {
    if (!url) return null;
    const entry = this.map.get(url);
    if (!entry) return null;
    entry.lastAccessedAt = Date.now();
    this.persistMap();
    return entry.localPath;
  }

  public isDownloaded(url: string | null | undefined): boolean {
    return !!url && this.map.has(url);
  }

  /** True if the URL is currently being downloaded or waiting in the queue. */
  public isQueued(url: string | null | undefined): boolean {
    if (!url) return false;
    return this._queue.some((item) => item.url === url) ||
      (this.isDownloading && !this.map.has(url) && this._queue.length >= 0 &&
        !!this.currentDownloadResumable);
  }

  /**
   * Subscribe to be notified when a specific URL finishes downloading.
   * The callback fires once, then is automatically removed.
   * Returns an unsubscribe function for cleanup.
   */
  public subscribeToUrl(url: string, callback: () => void): () => void {
    if (!this.completionListeners.has(url)) {
      this.completionListeners.set(url, new Set());
    }
    this.completionListeners.get(url)!.add(callback);
    return () => this.unsubscribeFromUrl(url, callback);
  }

  public unsubscribeFromUrl(url: string, callback: () => void): void {
    this.completionListeners.get(url)?.delete(callback);
  }

  /** Returns total bytes used by all downloaded videos. */
  public async getTotalSize(): Promise<number> {
    return Array.from(this.map.values()).reduce((sum, e) => sum + e.sizeBytes, 0);
  }

  /** Delete all downloaded videos and clear the map. */
  public async clearAll(): Promise<void> {
    try {
      await FileSystem.deleteAsync(DOWNLOAD_DIR, { idempotent: true });
      await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
      this.map.clear();
      this._queue = [];
      await AsyncStorage.removeItem(ASYNC_KEY);
      console.log('[VIDEO DOWNLOAD 🗑️] All downloaded videos cleared.');
    } catch (err) {
      console.warn('[VIDEO DOWNLOAD ⚠️ CLEAR] Failed to clear downloads:', err);
    }
  }

  // ─── Queue Processing ──────────────────────────────────────────────────────

  private async processQueue(): Promise<void> {
    if (this.isDownloading || this.isPaused || this._queue.length === 0) return;

    // Foreground throttle: if app is visible, wait 3s between items so downloads
    // don't steal bandwidth from image loading, API calls, or scrolling.
    if (!this.isAppBackground && this.lastItemCompletedAt > 0) {
      const elapsed = Date.now() - this.lastItemCompletedAt;
      if (elapsed < FOREGROUND_ITEM_DELAY_MS) {
        const waitMs = FOREGROUND_ITEM_DELAY_MS - elapsed;
        setTimeout(() => this.processQueue(), waitMs);
        return;
      }
    }

    this.isDownloading = true;
    const item = this._queue.shift()!;
    const url = item.url;

    // Double-check in case another call already downloaded it
    if (this.map.has(url)) {
      const existing = this.map.get(url)!;
      if (item.priority > (existing.priority ?? 0)) {
        existing.priority = item.priority;
        this.persistMap();
      }
      this.isDownloading = false;
      this.processQueue();
      return;
    }

    try {
      await this.downloadOne(url, item.priority);
    } catch (err) {
      console.warn(`[VIDEO DOWNLOAD ❌] Failed to download ${url.slice(0, 60)}...:`, err);
    }

    this.isDownloading = false;
    this.lastItemCompletedAt = Date.now();

    if (!this.isPaused) {
      this.processQueue();
    }
  }

  private async downloadOne(url: string, priority: number = 50): Promise<void> {
    await this.enforceStorageCap();

    const filename = this.urlToFilename(url);
    const finalPath = DOWNLOAD_DIR + filename;
    const tmpPath = DOWNLOAD_DIR + filename + '.tmp';

    // Race-condition guard: check if final file already exists on disk
    const existing = await FileSystem.getInfoAsync(finalPath);
    if (existing.exists) {
      const size = (existing as any).size ?? 0;
      const prevEntry = this.map.get(url);
      const effectivePriority = Math.max(priority, prevEntry?.priority ?? 0);
      this.map.set(url, { localPath: finalPath, lastAccessedAt: Date.now(), sizeBytes: size, priority: effectivePriority });
      await this.persistMap();
      console.log(`[VIDEO DOWNLOAD ✅ SKIP] Already on disk: ${filename} (priority ${effectivePriority})`);
      return;
    }

    if (this.isPaused) {
      console.log(`[VIDEO DOWNLOAD ⏸️] Skipping — Cinema player is active.`);
      return;
    }

    const mode = this.isAppBackground ? '🌙 BG' : '📲 FG';
    console.log(`[VIDEO DOWNLOAD 📡 START ${mode}] p=${priority} | ${url.slice(0, 70)}...`);
    const startMs = Date.now();

    const resumable = FileSystem.createDownloadResumable(url, tmpPath);
    this.currentDownloadResumable = resumable;

    let result;
    try {
      result = await resumable.downloadAsync();
    } catch (err: any) {
      this.currentDownloadResumable = null;
      if (this.isPaused) {
        console.log(`[VIDEO DOWNLOAD ⏸️] Download paused in-flight for cinema playback.`);
        return;
      }
      throw err;
    }
    this.currentDownloadResumable = null;

    if (this.isPaused) {
      console.log(`[VIDEO DOWNLOAD ⏸️] Download completed or paused while player active.`);
      return;
    }

    if (!result || result.status !== 200) {
      await FileSystem.deleteAsync(tmpPath, { idempotent: true });
      throw new Error(`HTTP ${result?.status}`);
    }

    // Atomic rename: .tmp → final
    await FileSystem.moveAsync({ from: tmpPath, to: finalPath });

    const fileInfo = await FileSystem.getInfoAsync(finalPath);
    const sizeBytes = (fileInfo as any).size ?? 0;
    const sizeMB = (sizeBytes / 1024 ** 2).toFixed(1);
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    this.map.set(url, { localPath: finalPath, lastAccessedAt: Date.now(), sizeBytes, priority });
    await this.persistMap();

    // Notify any UI listeners waiting on this specific URL
    const listeners = this.completionListeners.get(url);
    if (listeners && listeners.size > 0) {
      listeners.forEach((cb) => { try { cb(); } catch {} });
      this.completionListeners.delete(url);
    }

    console.log(`[VIDEO DOWNLOAD ✅ DONE] ${filename} | ${sizeMB} MB in ${elapsed}s (p=${priority}) → ${finalPath}`);
  }

  // ─── Storage Management ────────────────────────────────────────────────────

  private async enforceStorageCap(): Promise<void> {
    const totalSize = await this.getTotalSize();
    if (totalSize <= this.storageCap) return;

    // Evict lowest priority first, then LRU within same priority
    const sorted = Array.from(this.map.entries()).sort(([, a], [, b]) => {
      const pA = a.priority ?? 50;
      const pB = b.priority ?? 50;
      if (pA !== pB) return pA - pB;
      return a.lastAccessedAt - b.lastAccessedAt;
    });

    let freedBytes = 0;
    const toFree = totalSize - this.storageCap;

    for (const [url, entry] of sorted) {
      if (freedBytes >= toFree) break;
      try {
        await FileSystem.deleteAsync(entry.localPath, { idempotent: true });
        this.map.delete(url);
        freedBytes += entry.sizeBytes;
        console.log(`[VIDEO DOWNLOAD ♻️ EVICT] p=${entry.priority ?? 50}: ${entry.localPath.split('/').pop()} (${(entry.sizeBytes / 1024 ** 2).toFixed(1)} MB)`);
      } catch (err) {
        console.warn('[VIDEO DOWNLOAD ⚠️ EVICT] Could not evict:', err);
      }
    }

    await this.persistMap();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private urlToFilename(url: string): string {
    const clean = url.split('?')[0];
    const segment = clean.split('/').pop() || 'video';
    return segment.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private persistMap(): void {
    const obj: Record<string, DownloadEntry> = {};
    this.map.forEach((entry, url) => { obj[url] = entry; });
    AsyncStorage.setItem(ASYNC_KEY, JSON.stringify(obj)).catch(() => {});
  }
}

export const videoDownloadManager = new VideoDownloadManager();
