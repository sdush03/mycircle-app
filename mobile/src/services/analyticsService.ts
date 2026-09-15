import { AppState, AppStateStatus } from 'react-native';
import api, { guestApi } from './api';
import { useAuthStore } from '../store/authStore';

export type AnalyticsEventType =
  | 'IMPRESSION'
  | 'DISCOVERY'
  | 'DOWNLOAD'
  | 'VIDEO_PLAYBACK'
  | 'MEDIA_ERROR';

export type VideoPlaybackAction =
  | 'START'
  | 'MILESTONE_25'
  | 'MILESTONE_50'
  | 'MILESTONE_75'
  | 'COMPLETE'
  | 'REPLAY';

export interface AnalyticsEventMetrics {
  durationMs?: number;
  watchTimeSeconds?: number;
  totalDurationSeconds?: number;
  completionRatio?: number;
  errorType?: string;
  errorMessage?: string;
  [key: string]: any;
}

export interface AnalyticsEvent {
  eventType: AnalyticsEventType;
  mediaId?: string | number;
  mediaType?: 'PHOTO' | 'VIDEO';
  mediaUrl?: string;
  action?: VideoPlaybackAction | 'VIEW' | 'DOWNLOAD' | 'ERROR';
  source?: string;
  metrics?: AnalyticsEventMetrics;
  timestamp: number;
}

class AnalyticsService {
  private queue: AnalyticsEvent[] = [];
  private flushIntervalTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;
  private lastImpressionCache: Map<string, number> = new Map();
  private readonly IMPRESSION_DEDUPE_MS = 15000; // 15 seconds deduplication window per media item

  constructor() {
    this.startAutoFlushTimer();
    this.listenToAppState();
  }

  private listenToAppState(): void {
    AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        this.flush();
      }
    });
  }

  private startAutoFlushTimer(): void {
    if (this.flushIntervalTimer) clearInterval(this.flushIntervalTimer);
    this.flushIntervalTimer = setInterval(() => {
      if (this.queue.length > 0) {
        this.flush();
      }
    }, 10000); // Flush every 10 seconds
  }

  /**
   * Add event to batch queue
   */
  public enqueue(event: AnalyticsEvent): void {
    this.queue.push(event);
    if (this.queue.length >= 20) {
      this.flush();
    }
  }

  /**
   * Track photo/video card impression
   */
  public trackImpression(
    mediaId: string | number,
    mediaType: 'PHOTO' | 'VIDEO' = 'PHOTO',
    source: string = 'GRID',
    mediaUrl?: string
  ): void {
    if (!mediaId) return;
    const cacheKey = `${mediaId}_${source}`;
    const now = Date.now();
    const lastSeen = this.lastImpressionCache.get(cacheKey);

    if (lastSeen && now - lastSeen < this.IMPRESSION_DEDUPE_MS) {
      return; // Skip deduplicated rapid impression
    }

    this.lastImpressionCache.set(cacheKey, now);

    this.enqueue({
      eventType: 'IMPRESSION',
      mediaId,
      mediaType,
      mediaUrl,
      action: 'VIEW',
      source,
      timestamp: now,
    });
  }

  /**
   * Track video playback action (START, MILESTONE, COMPLETE, REPLAY)
   */
  public trackVideoPlayback(
    videoId: string | number,
    action: VideoPlaybackAction,
    metrics?: AnalyticsEventMetrics,
    source: string = 'CINEMA_PLAYER',
    videoUrl?: string
  ): void {
    this.enqueue({
      eventType: 'VIDEO_PLAYBACK',
      mediaId: videoId,
      mediaType: 'VIDEO',
      mediaUrl: videoUrl,
      action,
      source,
      metrics,
      timestamp: Date.now(),
    });
  }

  /**
   * Track photo or video download
   */
  public trackDownload(
    mediaId?: string | number,
    mediaType: 'PHOTO' | 'VIDEO' = 'PHOTO',
    source: string = 'DIRECT_DOWNLOAD',
    mediaUrl?: string
  ): void {
    this.enqueue({
      eventType: 'DOWNLOAD',
      mediaId,
      mediaType,
      mediaUrl,
      action: 'DOWNLOAD',
      source,
      timestamp: Date.now(),
    });
  }

  /**
   * Track media buffering or playback errors
   */
  public trackMediaError(
    mediaId?: string | number,
    mediaType: 'PHOTO' | 'VIDEO' = 'PHOTO',
    errorType: string = 'PLAYBACK_ERROR',
    errorMessage?: string,
    source: string = 'PLAYER',
    mediaUrl?: string
  ): void {
    this.enqueue({
      eventType: 'MEDIA_ERROR',
      mediaId,
      mediaType,
      mediaUrl,
      action: 'ERROR',
      source,
      metrics: {
        errorType,
        errorMessage,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Flush queued events to backend API
   */
  public async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    const eventsToSend = [...this.queue];
    this.queue = [];

    const authState = useAuthStore.getState();
    const eventSlug = authState.eventSlug;

    if (!eventSlug) {
      // Re-queue events if no eventSlug is active yet
      this.queue = [...eventsToSend, ...this.queue];
      this.isFlushing = false;
      return;
    }

    try {
      const payload = {
        events: eventsToSend,
        user: authState.profile
          ? {
              id: authState.profile.id,
              name: authState.profile.name,
              email: authState.profile.email,
              phone: authState.profile.phoneNumber,
              displayRole: authState.profile.displayRole,
            }
          : null,
      };

      // Non-blocking POST to backend API
      const apiInstance = authState.token ? api : guestApi;
      await apiInstance.post(
        `/api/gallery/public/events/${eventSlug}/analytics/batch`,
        payload
      );
    } catch (err: any) {
      // Fail silently to guarantee zero impact on UI or user playback experience
      if (err?.response?.status !== 404) {
        console.warn('[ANALYTICS ⚠️] Batch upload error:', err?.message || err);
      }
    } finally {
      this.isFlushing = false;
    }
  }
}

export const analyticsService = new AnalyticsService();
