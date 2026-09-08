/**
 * PlaybackFocusManager
 *
 * Lightweight event bus that signals whether a video is actively playing.
 * All background services (VideoDownloadManager, VideoPreloadManager) subscribe
 * and pause their work when a video is playing, giving 100% of network and CPU
 * to buttery-smooth 4K playback.
 */
type FocusListener = (isPlaying: boolean) => void;

class PlaybackFocusManager {
  private listeners: Set<FocusListener> = new Set();
  private _isPlaying = false;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /** Call this when a video starts playing. */
  notifyPlaybackStarted(): void {
    if (this._isPlaying) return; // already notified
    this._isPlaying = true;
    console.log('[PLAYBACK FOCUS 🎯 ACTIVE] All background tasks paused for smooth playback.');
    this.listeners.forEach((fn) => {
      try { fn(true); } catch {}
    });
  }

  /** Call this when a video pauses, ends, or the modal closes. */
  notifyPlaybackStopped(): void {
    if (!this._isPlaying) return; // already notified
    this._isPlaying = false;
    console.log('[PLAYBACK FOCUS 🎯 RELEASED] Background tasks resumed.');
    this.listeners.forEach((fn) => {
      try { fn(false); } catch {}
    });
  }

  subscribe(fn: FocusListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const playbackFocusManager = new PlaybackFocusManager();
