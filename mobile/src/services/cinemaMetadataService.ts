/**
 * CinemaMetadataService
 *
 * Centralized, high-level normalization and metadata engine for MyCircle Cinema.
 * Resolves all raw database/API fields ONCE at the library level:
 * - Display title (cleaned of underscores, dashes, extensions)
 * - Clean video URL & poster thumbnail (resolved from 20+ candidate keys)
 * - Release year (parsed once from all date candidates, null if none)
 * - Duration (runtime player cache > database fields > watch progress cache)
 * - Resolution (4K vs FHD based on dimensions & metadata)
 * - Category classification & TitleCase formatting
 * - Synopsis (custom caption or category-tailored cinematic description)
 * - Starring couple names (cleaned of celebration suffixes)
 *
 * Child components (CinemaVideoDetailModal, CinemaVideoCard, Shelves) consume
 * the pre-computed properties directly in O(1) without running regexes or fallback
 * candidate scans on every render cycle.
 */

import { CinemaVideoItem, getValidImageThumbnail, isVideoComingSoon, isVerticalVideo } from '../components/cinema/CinemaVideoCard';
import { videoWatchProgressManager } from './videoWatchProgressManager';

export interface NormalizedCinemaVideo extends CinemaVideoItem {
  displayTitle: string;
  releaseYear: string | null;
  durationSec: number;
  durationFormatted: string;
  resolutionTag: '4K' | 'FHD';
  is4K: boolean;
  synopsis: string;
  starringCouple: string;
  cleanVideoUrl: string | null;
  cleanThumbnailUrl: string | null;
  cinemaCategory: string;
  categoryTitleCase: string;
  isPortrait: boolean;
  isComingSoon: boolean;
}

// ─── Pure Format & Extraction Utilities (Executed ONCE during normalization) ──

export function formatDuration(sec?: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}h ${remM > 0 ? `${remM}m` : ''}`.trim();
  }
  if (m === 0) {
    return `${s}s`;
  }
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

export function formatDisplayTitle(video?: any): string {
  if (!video) return 'The Wedding Film';
  const raw = video.title || video.exif?.title || video.name || video.filename;
  if (raw && typeof raw === 'string' && raw.trim()) {
    return raw
      .replace(/\.(mp4|mov|m4v|webm)$/i, '')
      .replace(/[_.-]+/g, ' ')
      .trim()
      .replace(/(?:^|\s)\w/g, (m) => m.toUpperCase());
  }
  if (video.category) {
    return String(video.category).toUpperCase();
  }
  return 'The Wedding Film';
}

export function formatCoupleNames(rawTitle?: string | null): string {
  if (!rawTitle) return 'The Couple & Family';
  const cleaned = rawTitle
    .replace(/['']s\s+Wedding/gi, '')
    .replace(/['']s\s+Celebration/gi, '')
    .replace(/\s+Wedding/gi, '')
    .replace(/\s+Celebration/gi, '')
    .replace(/[·•]/g, ' & ')
    .replace(/[_.-]+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => (w === '&' ? '&' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
  return cleaned || 'The Couple & Family';
}

export function extractCleanVideoUrl(video: any): string | null {
  if (!video) return null;
  if (typeof video === 'string') {
    const l = video.toLowerCase();
    if (l.endsWith('.jpg') || l.endsWith('.jpeg') || l.endsWith('.png') || l.endsWith('.webp')) return null;
    return video;
  }
  const candidates = [
    video.videoUrl,
    video.fullUri,
    video.photoUrl,
    video.file_url,
    video.r2Url,
    video.uri,
    video.raw?.videoUrl,
    video.raw?.fullUri,
    video.raw?.file_url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('http')) {
      const lower = c.toLowerCase().split('?')[0];
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')) {
        continue;
      }
      return c;
    }
  }
  return null;
}

export function classifyCinemaCategory(video: any): string {
  const explicit = (
    video.cinemaCategory ||
    video.exif?.cinemaCategory ||
    video.category ||
    video.meta?.category ||
    ''
  ).trim().toUpperCase().replace(/['']/g, '’');

  if (explicit.includes('DIRECTOR')) return 'THE DIRECTORS’ CUT';
  if (explicit.includes('CANDID') || explicit.includes('REEL') || explicit.includes('DIAR')) return 'CANDID DIARIES';
  if (explicit.includes('STAGE') || explicit.includes('SPOTLIGHT') || explicit.includes('PERFORMANCE') || explicit.includes('DANCE')) return 'STAGE & SPOTLIGHT';
  if (explicit.includes('EXTENDED') || explicit.includes('CUTS') || explicit.includes('CHAPTER') || explicit.includes('CEREMONY')) return 'THE EXTENDED CUTS';

  // Fallback auto-detection from orientation & keywords:
  if (isVerticalVideo(video)) {
    return 'CANDID DIARIES';
  }

  const clean = ((video.title || video.name || video.filename || '') + ' ' + (video.caption || '')).toLowerCase();
  if (clean.includes('dance') || clean.includes('performance') || clean.includes('solo') || clean.includes('squad') || clean.includes('choreography') || clean.includes('stage')) {
    return 'STAGE & SPOTLIGHT';
  }
  if (clean.includes('haldi') || clean.includes('mehendi') || clean.includes('mehndi') || clean.includes('sangeet') || clean.includes('wedding') || clean.includes('phera') || clean.includes('vow') || clean.includes('mandap') || clean.includes('reception') || clean.includes('engagement') || clean.includes('roka') || clean.includes('chapter')) {
    return 'THE EXTENDED CUTS';
  }

  return 'THE DIRECTORS’ CUT';
}

export function formatCinemaCategoryTitleCase(raw?: string): string {
  if (!raw) return "Director's Cut";
  const upper = raw.toUpperCase().replace(/['']/g, '’');
  if (upper.includes('DIRECTOR')) return "Director's Cut";
  if (upper.includes('CANDID') || upper.includes('REEL') || upper.includes('DIAR')) return 'Candid Diaries';
  if (upper.includes('STAGE') || upper.includes('SPOTLIGHT') || upper.includes('PERFORMANCE') || upper.includes('DANCE')) return 'Stage & Spotlight';
  if (upper.includes('EXTENDED') || upper.includes('CUTS') || upper.includes('CHAPTER') || upper.includes('CEREMONY')) return 'Extended Cuts';

  return raw
    .toLowerCase()
    .replace(/(?:^|\s)\w/g, (m) => m.toUpperCase())
    .replace(/^The\s+/i, '')
    .trim() || "Director's Cut";
}

// ─── Centralized Service Class ────────────────────────────────────────────────

class CinemaMetadataService {
  /** In-memory registry of runtime-detected metadata (populated by native player) */
  private runtimeRegistry: Map<string, { durationSec?: number; width?: number; height?: number }> = new Map();

  /**
   * Record ground-truth runtime metadata discovered by expo-video during playback
   */
  public recordRuntimeMetadata(
    keyOrUrl: string | number | null | undefined,
    meta: { durationSec?: number; width?: number; height?: number }
  ): void {
    if (!keyOrUrl) return;
    const key = String(keyOrUrl);
    const existing = this.runtimeRegistry.get(key) || {};
    this.runtimeRegistry.set(key, { ...existing, ...meta });
  }

  /**
   * High-level single normalization pass.
   * Produces a fully resolved NormalizedCinemaVideo object so child views
   * can render properties directly in O(1).
   */
  public normalize(video: any, eventTitle?: string): NormalizedCinemaVideo {
    if (!video) return video;

    const idKey = String(video.id || video.videoUrl || video.uri || '');
    const cleanUrl = extractCleanVideoUrl(video);
    const urlKey = cleanUrl ? String(cleanUrl) : idKey;
    const runtimeMeta = this.runtimeRegistry.get(idKey) || this.runtimeRegistry.get(urlKey);

    // 1. Duration (Runtime registry > Video payload > WatchProgress cache)
    const payloadDuration = Number(
      video.duration ||
      video.meta?.duration ||
      video.metadata?.duration ||
      video.exif?.duration ||
      video.videoDuration ||
      video.durationSec ||
      video.duration_sec ||
      video.raw?.duration ||
      0
    );
    const cachedProgressDur = videoWatchProgressManager.getProgress(video)?.duration || 0;
    const finalDurationSec = (runtimeMeta?.durationSec && runtimeMeta.durationSec > 0)
      ? runtimeMeta.durationSec
      : (payloadDuration > 0 ? payloadDuration : cachedProgressDur);
    const durationFormatted = formatDuration(finalDurationSec);

    // 2. Resolution (4K vs FHD)
    const w = Number(
      runtimeMeta?.width ||
      video.width ||
      video.exif?.width ||
      video.meta?.width ||
      video.raw?.width ||
      0
    );
    const h = Number(
      runtimeMeta?.height ||
      video.height ||
      video.exif?.height ||
      video.meta?.height ||
      video.raw?.height ||
      0
    );
    let is4K = false;
    if (w >= 3840 || h >= 3840 || (w >= 2160 && h >= 2160) || Math.min(w, h) >= 2160) {
      is4K = true;
    } else {
      const resStr = String(
        video.resolution ||
        video.quality ||
        video.meta?.resolution ||
        video.meta?.quality ||
        video.videoQuality ||
        ''
      ).toLowerCase();
      const urlStr = String(cleanUrl || '').toLowerCase();
      is4K =
        resStr.includes('4k') ||
        resStr.includes('2160') ||
        resStr.includes('uhd') ||
        urlStr.includes('4k') ||
        urlStr.includes('2160') ||
        urlStr.includes('uhd') ||
        Boolean(video.is4k || video.is4K);
    }
    const resolutionTag: '4K' | 'FHD' = is4K ? '4K' : 'FHD';

    // 3. Release Year (parsed once from all candidate fields, null if none)
    let releaseYear: string | null = null;
    const rawDate =
      video.year ||
      video.exif?.year ||
      video.createdAt ||
      video.created_at ||
      video.uploadedAt ||
      video.uploaded_at ||
      video.uploadDate ||
      video.upload_date ||
      video.date ||
      video.timestamp ||
      video.meta?.createdAt ||
      video.meta?.created_at ||
      video.metadata?.createdAt ||
      video.metadata?.created_at ||
      video.exif?.DateTimeOriginal ||
      video.exif?.CreateDate;
    if (rawDate) {
      if (typeof rawDate === 'number' && rawDate >= 2000 && rawDate <= 2100) {
        releaseYear = String(rawDate);
      } else if (typeof rawDate === 'string' && /^\d{4}$/.test(rawDate.trim())) {
        releaseYear = rawDate.trim();
      } else {
        const parsed = new Date(rawDate);
        if (!isNaN(parsed.getFullYear()) && parsed.getFullYear() >= 2000) {
          releaseYear = String(parsed.getFullYear());
        }
      }
    }

    // 4. Category Classification
    const cinemaCategory = classifyCinemaCategory(video);
    const categoryTitleCase = formatCinemaCategoryTitleCase(cinemaCategory);

    // 5. Synopsis
    const customDesc =
      video.description ||
      video.exif?.description ||
      video.caption ||
      video.exif?.caption ||
      video.meta?.description ||
      video.metadata?.description ||
      video.raw?.description ||
      video.raw?.caption;
    let synopsis: string;
    if (customDesc && typeof customDesc === 'string' && customDesc.trim()) {
      synopsis = customDesc.trim();
    } else {
      const upperCat = cinemaCategory.toUpperCase();
      if (upperCat.includes('DIRECTOR')) {
        synopsis = 'The signature cinematic film of the celebration, capturing the grand emotion, timeless vows, and unforgettable moments in full director’s vision.';
      } else if (upperCat.includes('CANDID') || upperCat.includes('DIAR') || upperCat.includes('REEL')) {
        synopsis = 'Intimate glances, unscripted laughter, and vibrant moments captured candidly throughout the festivities.';
      } else if (upperCat.includes('STAGE') || upperCat.includes('SPOTLIGHT') || upperCat.includes('DANCE')) {
        synopsis = 'Electrifying stage performances, choreographies, and celebratory dances preserved in high fidelity.';
      } else if (upperCat.includes('EXTENDED') || upperCat.includes('CUTS') || upperCat.includes('CHAPTER')) {
        synopsis = 'The complete ceremony, traditional rituals, and heartfelt family blessings documented in full unedited beauty.';
      } else {
        synopsis = 'The celebration comes alive through every glance, laughter, and timeless vow. A cinematic heirloom crafted with pure emotion.';
      }
    }

    // 6. Couple Names & Title
    const rawCouple =
      eventTitle ||
      video.eventTitle ||
      video.eventName ||
      video.galleryName ||
      video.raw?.eventTitle ||
      video.raw?.eventName;
    const starringCouple = formatCoupleNames(rawCouple);
    const displayTitle = formatDisplayTitle(video);
    const cleanThumbnailUrl = getValidImageThumbnail(video) || null;
    const isPortrait = isVerticalVideo(video);
    const isComingSoon = isVideoComingSoon(video);

    return {
      ...video,
      displayTitle,
      releaseYear,
      durationSec: finalDurationSec,
      durationFormatted,
      resolutionTag,
      is4K,
      synopsis,
      starringCouple,
      cleanVideoUrl: cleanUrl,
      cleanThumbnailUrl,
      cinemaCategory,
      categoryTitleCase,
      isPortrait,
      isComingSoon,
    };
  }

  /**
   * Normalizes an entire array of cinema videos once at the library level.
   */
  public normalizeList(videos: any[], eventTitle?: string): NormalizedCinemaVideo[] {
    if (!videos || !Array.isArray(videos)) return [];
    return videos.map((v) => this.normalize(v, eventTitle));
  }
}

export const cinemaMetadataService = new CinemaMetadataService();
