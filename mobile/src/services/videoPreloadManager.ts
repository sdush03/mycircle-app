import { createVideoPlayer, VideoPlayer, setVideoCacheSizeAsync } from 'expo-video';
import { Image as ExpoImage } from 'expo-image';
import { videoDownloadManager } from './videoDownloadManager';
import { playbackFocusManager } from './playbackFocusManager';

/**
 * VideoPreloadManager
 *
 * Permanent Instagram-grade video pre-buffering & disk cache engine.
 * Specifically optimized for galleries with 2-5 cinema films/reels:
 *
 * 1. Permanent Player Pool: Never destroys or deletes pre-warmed players.
 *    When a video is closed, it rewinds to 0 and stays warm in memory.
 * 2. Local File Priority: If VideoDownloadManager has the video on disk,
 *    creates the AVPlayer with a file:// URL — zero network, instant decode.
 * 3. Native Disk Caching: Utilizes expo-video's 1GB persistent cache
 *    (setVideoCacheSizeAsync) for streamed videos.
 * 4. Playback Focus: Skips network probes while a video is actively playing
 *    to give 100% bandwidth to the playing video.
 * 5. Pre-warms poster thumbnails into ExpoImage memory-disk cache.
 */

// Initialize 1GB persistent video streaming cache (for non-downloaded videos)
try {
  setVideoCacheSizeAsync(1024 * 1024 * 1024).catch(() => {});
} catch {}

class VideoPreloadManager {
  private cache: Map<string, VideoPlayer> = new Map();
  private maxCached: number = 2; // 2 players max in RAM prevents iOS memory pressure & buffer purge for 4K video
  private probedUrls: Set<string> = new Set();

  constructor() {
    // When cinema playback is active, suspend all cached background players to free up bandwidth & RAM
    playbackFocusManager.subscribe((isPlaying) => {
      if (isPlaying) {
        this.cache.forEach((player) => {
          try {
            player.bufferOptions = {
              waitsToMinimizeStalling: false,
              preferredForwardBufferDuration: 0,
            };
            player.pause();
          } catch {}
        });
        console.log('[VIDEO PRELOAD ⏸️] Background players suspended — 100% bandwidth & decoder focus given to active Cinema film.');
      }
    });
  }

  /**
   * Predictively pre-buffers a video URL into permanent memory.
   * If the video is already downloaded locally, uses the local file:// path
   * so the player reads from disk at full speed with zero network usage.
   */
  public preload(
    url: string | null | undefined,
    thumbnailUrl?: string | null,
    metadata?: { title?: string; artist?: string; artwork?: string }
  ): void {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return;
    // If Cinema playback is active, NEVER preload new players or steal bandwidth!
    if (playbackFocusManager.isPlaying) {
      return;
    }
    const cleanUrl = url.split('?')[0].toLowerCase();
    if (cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg') || cleanUrl.endsWith('.png') || cleanUrl.endsWith('.webp')) {
      return;
    }

    // If video player already exists in cache, keep it warm and return immediately!
    if (this.cache.has(url)) {
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

    // 2. Network Diagnostic Probe: Run AT MOST ONCE per URL, NEVER during playback
    if (!playbackFocusManager.isPlaying && !this.probedUrls.has(url)) {
      this.probedUrls.add(url);
      const probeStart = Date.now();
      fetch(url, { headers: { Range: 'bytes=0-262143' } }) // 256KB probe
        .then((res) => {
          const ttfb = Date.now() - probeStart;
          const cl = res.headers.get('content-length');
          const cr = res.headers.get('content-range');
          const ar = res.headers.get('accept-ranges');
          const ct = res.headers.get('content-type');
          console.log(`[NETWORK PROBE 🌐] HTTP ${res.status} | TTFB: ${ttfb}ms | Content-Type: ${ct} | Accept-Ranges: ${ar} | Content-Range: ${cr} | Size: ${cl} bytes | URL: ${url.slice(0, 60)}...`);
        })
        .catch((err) => {
          console.warn(`[NETWORK PROBE ❌] Failed for ${url.slice(0, 60)}...:`, err.message);
        });
    }

    try {
      // Evict oldest player if exceeding pool limit
      if (this.cache.size >= this.maxCached) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) {
          const oldPlayer = this.cache.get(oldestKey);
          try { oldPlayer?.pause(); } catch {}
          this.cache.delete(oldestKey);
          console.log(`[PERMANENT PRELOAD ♻️] Evicted oldest player: ${oldestKey.slice(0, 50)}...`);
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
        preferredForwardBufferDuration: 0, // 0 lets iOS/TV auto-negotiate optimal streaming buffer
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
    if (player.status === 'error') {
      console.warn('[PRELOAD CACHE ⚠️] Cached player had error status, evicting');
      this.cache.delete(url);
      return null;
    }
    player.muted = false;
    console.log(`[PRELOAD CACHE ⚡ HIT] Returning warm player! Status: ${player.status} | Buffered: ${player.bufferedPosition?.toFixed(1) ?? '?'}s`);
    return player;
  }

  /**
   * Backward-compatible alias for getPlayer.
   * DOES NOT delete the player so it remains warm for subsequent taps.
   */
  public takePlayer(url: string | null | undefined): VideoPlayer | null {
    return this.getPlayer(url);
  }

  /**
   * Called when modal closes: pauses player, rewinds to 0s, and keeps it warm.
   */
  public returnPlayer(url: string | null | undefined): void {
    if (!url || !this.cache.has(url)) return;
    const player = this.cache.get(url)!;
    try {
      player.allowsExternalPlayback = false; // Disconnect AirPlay route immediately
      player.showNowPlayingNotification = false;
      player.pause();
      player.currentTime = 0;
      player.muted = true;
    } catch {}
    console.log(`[PRELOAD CACHE 🔁] Rewound to 0s and kept warm in permanent cache!`);
  }

  public clear(): void {
    this.cache.forEach((player) => {
      try { player.pause(); } catch {}
    });
    this.cache.clear();
  }
}

export const videoPreloadManager = new VideoPreloadManager();
