import { Platform } from 'react-native';
import { createVideoPlayer, VideoPlayer, setVideoCacheSizeAsync } from 'expo-video';
import { Image as ExpoImage } from 'expo-image';
import { videoDownloadManager } from './videoDownloadManager';
import { playbackFocusManager } from './playbackFocusManager';

/**
 * VideoPreloadManager
 *
 * Lightweight video pre-buffering & disk cache engine.
 * Specifically optimized for galleries with cinema films/reels:
 *
 * 1. Safe Player Pool: On iOS, pre-buffers at most 1 player. On Android,
 *    skips background ExoPlayer creation to avoid MediaCodec hardware decoder
 *    starvation and OutOfMemory crashes.
 * 2. Pre-warms poster thumbnails into ExpoImage memory-disk cache for 0ms visual continuity.
 * 3. Native Disk Caching: Utilizes expo-video's 256MB persistent cache.
 * 4. Playback Focus: Skips background tasks while a video is actively playing.
 */

// Initialize 256MB persistent video streaming cache (safe footprint for mobile heap)
try {
  setVideoCacheSizeAsync(256 * 1024 * 1024).catch(() => {});
} catch {}

class VideoPreloadManager {
  private cache: Map<string, VideoPlayer> = new Map();
  private maxCached: number = Platform.OS === 'android' ? 0 : 1; // 0 on Android avoids ExoPlayer / MediaCodec exhaustion; 1 on iOS
  private probedUrls: Set<string> = new Set();
  private activeUrl: string | null = null;

  constructor() {
    // When cinema playback is active, clear background preloaded players to prevent Android MediaCodec hardware decoder contention
    playbackFocusManager.subscribe((isPlaying) => {
      if (isPlaying) {
        this.cache.forEach((player, url) => {
          if (this.activeUrl && url === this.activeUrl) {
            return;
          }
          try { player.pause(); } catch {}
          try { (player as any).release?.(); } catch {}
        });
        this.cache.clear();
        console.log('[VIDEO PRELOAD 🧹] Background preloaded players released — 100% decoder focus given to active Cinema film.');
      }
    });
  }

  public setActiveUrl(url: string | null): void {
    this.activeUrl = url;
  }

  /**
   * Predictively pre-buffers a video URL into memory.
   */
  public preload(
    url: string | null | undefined,
    thumbnailUrl?: string | null,
    metadata?: { title?: string; artist?: string; artwork?: string }
  ): void {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return;
    // If Cinema playback is active or url is currently active, NEVER create new background players!
    if (playbackFocusManager.isPlaying || (this.activeUrl && url === this.activeUrl)) {
      return;
    }
    const cleanUrl = url.split('?')[0].toLowerCase();
    if (cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg') || cleanUrl.endsWith('.png') || cleanUrl.endsWith('.webp')) {
      return;
    }

    // 1. Pre-warm poster thumbnail in memory-disk cache for 0ms visual continuity
    //    Skip while video is playing — don't steal bandwidth
    if (!playbackFocusManager.isPlaying && thumbnailUrl && typeof thumbnailUrl === 'string' && thumbnailUrl.startsWith('http')) {
      const cleanThumb = thumbnailUrl.split('?')[0].toLowerCase();
      if (!cleanThumb.endsWith('.mp4') && !cleanThumb.endsWith('.mov') && !cleanThumb.endsWith('.m4v') && !cleanThumb.endsWith('.webm')) {
        try {
          ExpoImage.prefetch(thumbnailUrl);
        } catch {}
      }
    }

    // On Android, creating background ExoPlayer instances hogs native MediaCodec hardware decoders,
    // allocates heap in OkHttp, and spawns MediaSession services, causing OutOfMemory crashes.
    // We pre-warm the poster thumbnail into ExpoImage memory-disk cache for 0ms visual continuity,
    // and let CinemaVideoModal create the single active player instance on demand with full resources.
    if (Platform.OS === 'android' || this.maxCached === 0) {
      return;
    }

    // If video player already exists in cache, keep it warm and return immediately!
    if (this.cache.has(url)) {
      return;
    }

    try {
      // Evict oldest player if exceeding pool limit
      if (this.cache.size >= this.maxCached) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) {
          const oldPlayer = this.cache.get(oldestKey);
          try { oldPlayer?.pause(); } catch {}
          try { (oldPlayer as any)?.release?.(); } catch {}
          this.cache.delete(oldestKey);
          console.log(`[PERMANENT PRELOAD ♻️] Evicted and released oldest player: ${oldestKey.slice(0, 50)}...`);
        }
      }

      // CRITICAL FOR TV AIRPLAY: Smart TVs (Samsung, Hisense, LG, Roku) run third-party
      // AirPlay 2 receiver SDKs that require a network-reachable HTTP/HTTPS URL.
      // If initialized with a local sandbox file:// URL, Smart TVs get stuck on the AirPlay splash screen.
      const effectiveUrl = url;

      // Create native player instance.
      const player = createVideoPlayer({
        uri: effectiveUrl,
        metadata: {
          title: metadata?.title || 'The Wedding Film',
          artist: metadata?.artist || "Director's Cut",
          artwork: metadata?.artwork || thumbnailUrl || undefined,
        },
      });
      player.loop = false;
      player.muted = true; // Preloaded players in background must be muted to avoid audio hardware contention
      player.audioMixingMode = 'auto';
      player.allowsExternalPlayback = true;
      player.bufferOptions = {
        waitsToMinimizeStalling: true,
      };
      player.pause(); // Keep paused while pre-buffering in background

      // Attach diagnostic listeners to monitor native player lifecycle
      (player as any).addListener?.('statusChange', (payload: any) => {
        console.log(`[BACKGROUND PRELOAD 📡 STATUS] URL: ${url.slice(0, 50)}... -> Status: ${payload?.status} | Buffered: ${player.bufferedPosition?.toFixed?.(1) ?? '?'}s | Duration: ${player.duration?.toFixed?.(1) ?? '?'}s`);
      });

      this.cache.set(url, player);
      console.log(`[PERMANENT PRELOAD 🚀] Pre-buffering started for: ${url.slice(0, 75)}...`);
    } catch (err) {
      console.warn('[PERMANENT PRELOAD ⚠️] Could not pre-warm player:', err);
    }
  }

  /**
   * Retrieves the preloaded player without deleting it from cache.
   */
  public getPlayer(url: string | null | undefined): VideoPlayer | null {
    if (!url || !this.cache.has(url)) {
      console.log(`[PRELOAD CACHE ❌ MISS] No cached player for: ${url ? url.slice(0, 50) : 'null'}...`);
      return null;
    }
    const player = this.cache.get(url)!;
    try {
      // Accessing .status on a player whose native object was released (by OS memory pressure
      // or explicit .release()) throws NativeSharedObjectNotFoundException. Evict gracefully.
      if (player.status === 'error') {
        console.warn('[PRELOAD CACHE ⚠️] Cached player had error status, evicting');
        this.cache.delete(url);
        return null;
      }
    } catch (e) {
      console.warn('[PRELOAD CACHE ⚠️] Cached player native object is dead, evicting:', e);
      this.cache.delete(url);
      return null;
    }
    player.muted = false;
    console.log(`[PRELOAD CACHE ⚡ HIT] Returning warm player! Status: ${player.status} | Buffered: ${player.bufferedPosition?.toFixed(1) ?? '?'}s`);
    return player;
  }

  /**
   * Backward-compatible alias for getPlayer.
   * Transfers ownership to active modal and removes from preloader pool.
   */
  public takePlayer(url: string | null | undefined): VideoPlayer | null {
    if (url) {
      this.activeUrl = url;
    }
    const player = this.getPlayer(url);
    if (player && url) {
      this.cache.delete(url);
    }
    return player;
  }

  /**
   * Called when modal closes: pauses player, rewinds to 0s, and keeps it warm in the pool.
   * Accepts an optional player parameter for players that were taken out of the cache
   * via takePlayer() — without this, taken players would leak native decoder resources
   * because cache.has(url) returns false after takePlayer() deletes the entry.
   */
  public returnPlayer(url: string | null | undefined, takenPlayer?: VideoPlayer | null): void {
    if (url && this.activeUrl === url) {
      this.activeUrl = null;
    }
    if (!url) return;

    // Resolve the player: either from cache (if still there) or the explicitly passed reference
    const player = this.cache.get(url) || takenPlayer;
    if (!player) return;

    try {
      player.allowsExternalPlayback = false; // Disconnect AirPlay route immediately
      player.showNowPlayingNotification = false;
      player.pause();
      player.currentTime = 0;
      player.muted = true;
    } catch {}

    // Re-add to cache if pool has room (so next open is instant),
    // otherwise release the native player to free decoder resources.
    if (this.cache.size < this.maxCached && !this.cache.has(url)) {
      this.cache.set(url, player);
      console.log(`[PRELOAD CACHE 🔁] Rewound to 0s and kept warm in permanent cache!`);
    } else if (!this.cache.has(url)) {
      // Pool is full or Android (maxCached=0): release native resources to prevent OOM
      try {
        (player as any).release?.();
      } catch {}
      console.log(`[PRELOAD CACHE 🧹] Pool full — released native player to free decoder resources.`);
    }
  }

  public clear(): void {
    this.cache.forEach((player) => {
      try { player.pause(); } catch {}
      try { (player as any).release?.(); } catch {}
    });
    this.cache.clear();
  }
}

export const videoPreloadManager = new VideoPreloadManager();
