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
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { playbackFocusManager } from './playbackFocusManager';

const DOWNLOAD_DIR = FileSystem.documentDirectory + 'mycircle-videos/';
const ASYNC_KEY = 'videoDownloadManager:v1:map';

// Storage caps by device tier (bytes)
const CAP_64GB = 1.5 * 1024 ** 3;   // 1.5 GB  → devices < 128 GB
const CAP_128GB = 2.5 * 1024 ** 3;  // 2.5 GB  → devices 128–255 GB
const CAP_256GB = 4.0 * 1024 ** 3;  // 4.0 GB  → devices ≥ 256 GB

interface DownloadEntry {
  localPath: string;   // absolute path inside documentDirectory
  lastAccessedAt: number; // unix ms — used for LRU eviction
  sizeBytes: number;
}

class VideoDownloadManager {
  /** url → DownloadEntry */
  private map: Map<string, DownloadEntry> = new Map();
  private _queue: string[] = [];
  private isDownloading = false;
  private isPaused = false;
  private currentDownloadResumable: FileSystem.DownloadResumable | null = null;
  private storageCap = CAP_128GB; // default; refined after getTotalDiskCapacityAsync

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
   * Add a remote video URL to the download queue.
   * Safe to call multiple times — already-downloaded or already-queued URLs are ignored.
   */
  public queue(url: string | null | undefined): void {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return;
    const cleanUrl = url.split('?')[0].toLowerCase();
    if (!cleanUrl.endsWith('.mp4') && !cleanUrl.endsWith('.mov') && !cleanUrl.endsWith('.m4v')) return;
    if (this.map.has(url)) return; // already downloaded
    if (this._queue.includes(url)) return; // already queued
    this._queue.push(url);
    console.log(`[VIDEO DOWNLOAD 📥 QUEUED] ${url.slice(0, 70)}... | Queue size: ${this._queue.length}`);
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
    // Update LRU access time (fire-and-forget)
    entry.lastAccessedAt = Date.now();
    this.persistMap();
    return entry.localPath;
  }

  public isDownloaded(url: string | null | undefined): boolean {
    return !!url && this.map.has(url);
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
    this.isDownloading = true;

    const url = this._queue.shift()!;

    // Double-check: another processQueue call might have already downloaded this
    if (this.map.has(url)) {
      this.isDownloading = false;
      this.processQueue();
      return;
    }

    try {
      await this.downloadOne(url);
    } catch (err) {
      console.warn(`[VIDEO DOWNLOAD ❌] Failed to download ${url.slice(0, 60)}...:`, err);
    }

    this.isDownloading = false;

    // Continue with next item if not paused
    if (!this.isPaused) {
      this.processQueue();
    }
  }

  private async downloadOne(url: string): Promise<void> {
    // Enforce storage cap before starting (LRU evict if needed)
    await this.enforceStorageCap();

    // Derive a stable filename from the URL
    const filename = this.urlToFilename(url);
    const finalPath = DOWNLOAD_DIR + filename;
    const tmpPath = DOWNLOAD_DIR + filename + '.tmp';

    // Check if final file already exists (race condition guard)
    const existing = await FileSystem.getInfoAsync(finalPath);
    if (existing.exists) {
      const size = (existing as any).size ?? 0;
      this.map.set(url, { localPath: finalPath, lastAccessedAt: Date.now(), sizeBytes: size });
      await this.persistMap();
      console.log(`[VIDEO DOWNLOAD ✅ SKIP] Already on disk: ${filename}`);
      return;
    }

    if (this.isPaused) {
      console.log(`[VIDEO DOWNLOAD ⏸️] Skipping download start because Cinema player is active.`);
      return;
    }

    console.log(`[VIDEO DOWNLOAD 📡 START] Downloading: ${url.slice(0, 70)}...`);
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

    // Rename .tmp → final path (atomic on most filesystems)
    await FileSystem.moveAsync({ from: tmpPath, to: finalPath });

    // Get file size
    const fileInfo = await FileSystem.getInfoAsync(finalPath);
    const sizeBytes = (fileInfo as any).size ?? 0;
    const sizeMB = (sizeBytes / 1024 ** 2).toFixed(1);
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    this.map.set(url, { localPath: finalPath, lastAccessedAt: Date.now(), sizeBytes });
    await this.persistMap();

    console.log(`[VIDEO DOWNLOAD ✅ DONE] ${filename} | ${sizeMB} MB in ${elapsed}s → ${finalPath}`);
  }

  // ─── Storage Management ────────────────────────────────────────────────────

  private async enforceStorageCap(): Promise<void> {
    const totalSize = await this.getTotalSize();
    if (totalSize <= this.storageCap) return;

    // Sort by lastAccessedAt ascending (oldest first = evict first)
    const sorted = Array.from(this.map.entries()).sort(
      ([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt
    );

    let freedBytes = 0;
    const toFree = totalSize - this.storageCap;

    for (const [url, entry] of sorted) {
      if (freedBytes >= toFree) break;
      try {
        await FileSystem.deleteAsync(entry.localPath, { idempotent: true });
        this.map.delete(url);
        freedBytes += entry.sizeBytes;
        console.log(`[VIDEO DOWNLOAD ♻️ EVICT] LRU evicted: ${entry.localPath.split('/').pop()} (${(entry.sizeBytes / 1024 ** 2).toFixed(1)} MB)`);
      } catch (err) {
        console.warn('[VIDEO DOWNLOAD ⚠️ EVICT] Could not evict:', err);
      }
    }

    await this.persistMap();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private urlToFilename(url: string): string {
    // Extract last path segment and strip query string
    const clean = url.split('?')[0];
    const segment = clean.split('/').pop() || 'video';
    // Sanitize to safe filename characters
    return segment.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private persistMap(): void {
    // Fire-and-forget; don't await to keep download flow unblocked
    const obj: Record<string, DownloadEntry> = {};
    this.map.forEach((entry, url) => { obj[url] = entry; });
    AsyncStorage.setItem(ASYNC_KEY, JSON.stringify(obj)).catch(() => {});
  }
}

export const videoDownloadManager = new VideoDownloadManager();
