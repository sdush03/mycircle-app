import React from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions, Platform } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_FUTURA_BOLD,
} from '../../constants/fonts';
import {
  videoWatchProgressManager,
  WatchProgress,
} from '../../services/videoWatchProgressManager';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Vertical Movie Poster Card Dimensions (3:4 portrait / 4:3 vertical ratio, height: 180pt)
export const POSTER_CARD_WIDTH = 135;
export const POSTER_CARD_HEIGHT = 180;

// Backward-compatible exports for any shelf imports
export const SHELF_FILM_WIDTH = POSTER_CARD_WIDTH;
export const SHELF_FILM_HEIGHT = POSTER_CARD_HEIGHT;
export const SHELF_REEL_WIDTH = POSTER_CARD_WIDTH;
export const SHELF_REEL_HEIGHT = POSTER_CARD_HEIGHT;
export const PRIMARY_FILM_WIDTH = SCREEN_WIDTH - 32;
export const PRIMARY_FILM_HEIGHT = Math.round((PRIMARY_FILM_WIDTH * 9) / 16);

export interface CinemaVideoItem {
  id: number | string;
  videoUrl?: string;
  r2Url?: string;
  thumbnailUrl?: string;
  uri?: string;
  title?: string;
  category?: string;
  duration?: number; // seconds
  isFeatured?: boolean;
  featured?: boolean;
  hasBakedCover?: boolean;
  isCoverBaked?: boolean;
  aspectRatio?: number | null;
  width?: number;
  height?: number;
  createdAt?: string | number | Date;
  created_at?: string | number | Date;
  uploadedAt?: string | number | Date;
  uploaded_at?: string | number | Date;
  isRecentlyAdded?: boolean;
  recentlyAdded?: boolean;
  isNewForYou?: boolean;
  newForYou?: boolean;
  isOlderThan10Days?: boolean;
  isComingSoon?: boolean;
  comingSoon?: boolean;
  videoReplacedAt?: string | number | Date;
  version?: number;
  [key: string]: any;
}

export function parseDateFlexible(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;

  if (typeof val === 'number') {
    // If Unix timestamp in seconds (< 100 billion), convert to ms
    const ms = val < 100000000000 ? val * 1000 : val;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return null;

    // Numeric timestamp string (e.g. "1726056000000" or "1726056000")
    if (/^\d{10,13}$/.test(s)) {
      const num = Number(s);
      const ms = num < 100000000000 ? num * 1000 : num;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d;
    }

    // EXIF format: "2026:09:10 14:30:00" -> replace colons in date part with dashes
    let normalized = s.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');

    // Space separator: "2026-09-10 14:30:00" -> replace space with 'T' for iOS Safari/JSC
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}/.test(normalized)) {
      normalized = normalized.replace(' ', 'T');
    }

    const d = new Date(normalized);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

export function getVideoDaysOld(video: CinemaVideoItem): number | null {
  const raw = video.raw || {};
  const exif = video.exif || video.raw?.exif || {};
  const meta = video.meta || video.raw?.meta || {};
  const metadata = video.metadata || video.raw?.metadata || {};

  const candidates = [
    video.createdAt,
    video.created_at,
    video.uploadedAt,
    video.uploaded_at,
    video.uploadDate,
    video.upload_date,
    video.addedAt,
    video.added_at,
    video.date,
    video.dateCreated,
    video.date_created,
    video.timestamp,
    raw.createdAt,
    raw.created_at,
    raw.uploadedAt,
    raw.uploaded_at,
    raw.uploadDate,
    raw.upload_date,
    raw.addedAt,
    raw.added_at,
    raw.date,
    raw.dateCreated,
    raw.date_created,
    raw.timestamp,
    meta.createdAt,
    meta.created_at,
    meta.uploadDate,
    meta.uploadedAt,
    metadata.createdAt,
    metadata.created_at,
    metadata.uploadDate,
    metadata.uploadedAt,
    exif.DateTimeOriginal,
    exif.CreateDate,
    exif.ModifyDate,
    exif.date,
    exif.DateTime,
  ];

  for (const c of candidates) {
    const parsed = parseDateFlexible(c);
    if (parsed) {
      const diffMs = Date.now() - parsed.getTime();
      return diffMs / (1000 * 60 * 60 * 24);
    }
  }

  return null;
}

interface CinemaVideoCardProps {
  video: CinemaVideoItem;
  variant?: 'poster' | 'shelf-film' | 'shelf-reel' | 'primary' | 'horizontal' | 'vertical';
  isFeatured?: boolean;
  badge?: string;
  watchProgress?: WatchProgress | null;
  onPress: (video: CinemaVideoItem, resumeTimeSec?: number) => void;
  isContinueWatching?: boolean;
  showPlayButton?: boolean;
  showProgressBar?: boolean;
}

export function getValidImageThumbnail(video: CinemaVideoItem): string | undefined {
  const candidates = [
    video.thumbnailUrl,
    video.preview_url,
    video.posterUrl,
    video.poster_url,
    video.coverUrl,
    video.cover_url,
    video.thumbUri,
    video.uri,
    video.photoUrl,
    video.fullUri,
    video.r2Url,
    video.file_url,
    video.raw?.thumbnailUrl,
    video.raw?.posterUrl,
    video.raw?.poster_url,
    video.raw?.coverUrl,
    video.raw?.cover_url,
    video.raw?.preview_url,
    video.raw?.thumbUri,
    video.raw?.photoUrl,
    video.raw?.fullUri,
    video.raw?.r2Url,
    video.raw?.file_url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('http')) {
      const clean = c.split('?')[0].toLowerCase();
      if (!clean.endsWith('.mp4') && !clean.endsWith('.mov') && !clean.endsWith('.m4v') && !clean.endsWith('.webm')) {
        return c;
      }
    }
  }
  return undefined;
}

export function hasActualVideoFile(video?: any): boolean {
  if (!video) return false;
  const isVideoStr = (val?: any) => {
    if (!val || typeof val !== 'string') return false;
    const clean = val.split('?')[0].toLowerCase().trim();
    return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.includes('/videos/');
  };

  return Boolean(
    isVideoStr(video.videoUrl) ||
    isVideoStr(video.r2Url) ||
    isVideoStr(video.file_url) ||
    isVideoStr(video.fullUri) ||
    isVideoStr(video.photoUrl) ||
    isVideoStr(video.uri) ||
    isVideoStr(video.filename) ||
    isVideoStr(video.name) ||
    isVideoStr(video.raw?.videoUrl) ||
    isVideoStr(video.raw?.r2Url) ||
    isVideoStr(video.raw?.file_url) ||
    isVideoStr(video.raw?.fullUri) ||
    isVideoStr(video.raw?.filename) ||
    isVideoStr(video.raw?.name)
  );
}

export function isCinemaVideoItem(item?: any): boolean {
  if (!item) return false;
  const tab = (item.tabName || item.raw?.tabName || item.tab || '').trim().toUpperCase();
  return (
    tab === 'CINEMA' ||
    item.isVideo === true ||
    item.raw?.isVideo === true ||
    item.isComingSoon === true ||
    item.comingSoon === true ||
    item.exif?.isComingSoon === true ||
    item.raw?.exif?.isComingSoon === true ||
    hasActualVideoFile(item)
  );
}

export function isVideoComingSoon(video?: any): boolean {
  if (!video) return false;
  // If it's a regular photo (not in Cinema and not a video), it is NEVER a coming soon video!
  if (!isCinemaVideoItem(video)) return false;

  if (
    video.isComingSoon === true ||
    video.comingSoon === true ||
    video.exif?.isComingSoon === true ||
    video.exif?.comingSoon === true ||
    video.meta?.isComingSoon === true ||
    video.raw?.isComingSoon === true ||
    video.raw?.exif?.isComingSoon === true
  ) {
    return true;
  }
  // AUTOMATIC: If it's a Cinema item and has NO video file attached -> automatically Coming Soon!
  return !hasActualVideoFile(video);
}

export function getVideoDaysSinceReplacement(video?: any): number | null {
  if (!video) return null;
  const raw = video.raw || {};
  const exif = video.exif || video.raw?.exif || {};
  const meta = video.meta || video.raw?.meta || {};

  const candidates = [
    video.videoReplacedAt,
    raw.videoReplacedAt,
    exif.videoReplacedAt,
    meta.videoReplacedAt,
  ];

  for (const cand of candidates) {
    const d = parseDateFlexible(cand);
    if (d) {
      const diffMs = Date.now() - d.getTime();
      if (diffMs >= 0) {
        return diffMs / (1000 * 60 * 60 * 24);
      }
    }
  }

  return null;
}

export function isVideoNewVersion(video?: any): boolean {
  if (!video || isVideoComingSoon(video)) return false;
  const daysSince = getVideoDaysSinceReplacement(video);
  return daysSince !== null && daysSince >= 0 && daysSince <= 7;
}

function formatDuration(sec?: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

function formatEditorialTitle(video: CinemaVideoItem): string {
  const t = video.title || video.exif?.title || video.name;
  if (t && t.trim()) {
    return t.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[_.-]+/g, ' ').trim();
  }
  if (video.category) {
    return video.category.toUpperCase();
  }
  return 'Wedding Film';
}

function isReelVideo(video: CinemaVideoItem): boolean {
  const w = Number(video.width) || Number(video.exif?.videoWidth) || 0;
  const h = Number(video.height) || Number(video.exif?.videoHeight) || 0;
  if (w > 0 && h > 0 && w > h) return false;
  if (w > 0 && h > 0 && h > w) return true;
  if (video.aspectRatio && video.aspectRatio < 0.9) return true;
  const title = (video.title || video.name || '').toLowerCase();
  const cat = (video.category || '').toLowerCase();
  if (title.includes('reel') || cat.includes('reel') || title.includes('vertical') || title.includes('short')) return true;
  return false;
}

export const CinemaVideoCard: React.FC<CinemaVideoCardProps> = ({
  video,
  badge,
  watchProgress = null,
  onPress,
  isContinueWatching = false,
  showPlayButton,
  showProgressBar,
}) => {
  const thumbUri = getValidImageThumbnail(video);
  const title = formatEditorialTitle(video);
  const durationText = formatDuration(video.duration);
  const isReel = isReelVideo(video);

  const progress = watchProgress ?? videoWatchProgressManager.getProgress(video);
  const isViewing = Boolean(progress && !progress.isCompleted && progress.progressPercent > 0 && progress.currentTime > 0);
  const isSeen = videoWatchProgressManager.isSeenCompletely(video);
  const hasWatched = Boolean(isSeen || (progress && (progress.currentTime > 0 || progress.isCompleted)));

  const isComingSoon = isVideoComingSoon(video);
  const isNewVersion = isVideoNewVersion(video);

  const daysOld = getVideoDaysOld(video);
  const isRecentlyAdded =
    !isComingSoon &&
    !isNewVersion &&
    (video.isRecentlyAdded === true ||
      video.recentlyAdded === true ||
      (daysOld !== null && daysOld <= 7));

  const isNewForYou =
    !isComingSoon &&
    !isNewVersion &&
    !isViewing &&
    !isRecentlyAdded &&
    !hasWatched;

  const shouldShowPlayButton = isComingSoon ? false : (showPlayButton ?? isContinueWatching);
  const shouldShowProgressBar = isComingSoon ? false : (showProgressBar ?? isContinueWatching);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const resumeTime =
      progress && !progress.isCompleted && progress.currentTime > 0
        ? progress.currentTime
        : undefined;
    onPress(video, resumeTime);
  };

  const displayBadge = (badge && badge.toUpperCase() !== 'FEATURE' && badge.toUpperCase() !== 'FEATURED') ? badge : undefined;

  // Top Badge: In Continue Watching, badges stick on top
  let topBadge: string | null = null;
  if (isContinueWatching && !isComingSoon) {
    if (isNewVersion) {
      topBadge = 'New version';
    } else if (isRecentlyAdded) {
      topBadge = 'Recently added';
    } else if (displayBadge) {
      topBadge = displayBadge;
    }
  }

  // Bottom Badge: In other shelves (catalog shelves), badges stick on bottom
  let bottomBadge: string | null = null;
  if (!isContinueWatching) {
    if (isComingSoon) {
      bottomBadge = 'Coming soon';
    } else if (isNewVersion) {
      // Replaced video cut: strictly 7-day automatic expiry
      bottomBadge = 'New version';
    } else if (isViewing) {
      // In continue watching progress, but on a catalog card below
      bottomBadge = 'Currently viewing';
    } else if (isRecentlyAdded) {
      // First 7 days of debut release
      bottomBadge = 'Recently added';
    } else if (isNewForYou) {
      // Catalog film not yet watched by this specific user
      bottomBadge = 'New for you';
    } else if (displayBadge) {
      bottomBadge = displayBadge;
    }
  }

  const isBaked = Boolean(
    video.hasBakedCover ||
    video.isCoverBaked ||
    video.meta?.hasBakedCover ||
    video.raw?.hasBakedCover ||
    video.exif?.hasBakedCover ||
    video.raw?.exif?.hasBakedCover
  );

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.cardContainer,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.mediaFrame}>
        {thumbUri ? (
          <Image
            source={{ uri: thumbUri }}
            style={styles.fillMedia}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
          />
        ) : (
          <View style={styles.emptyMediaFallback} />
        )}

        {/* Scrim gradient: subtle dark bottom to guarantee title legibility for unbaked posters */}
        {!isBaked && (
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.75)']}
            locations={[0.3, 0.62, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        )}

        {/* Top Badge: Recently added in Continue Watching (Stuck at top centre) */}
        {topBadge ? (
          <View style={styles.topBadgesRow}>
            <View style={styles.topBadgeContainer}>
              <Text style={styles.badgeText}>{topBadge}</Text>
            </View>
          </View>
        ) : null}

        {/* Center Restrained Play Icon (Only in Continue Watching) */}
        {shouldShowPlayButton && (
          <View style={styles.playIconCenter} pointerEvents="none">
            <View style={styles.playIconCircle}>
              <Text style={styles.playIconGlyph}>▶</Text>
            </View>
          </View>
        )}

        {/* Poster Bottom Content: Title & Duration LAYERED INSIDE CARD (Wedflix ss6 style) - skipped if baked */}
        {!isBaked && (
          <View
            style={[
              styles.posterBottomContent,
              bottomBadge ? { bottom: 24 } : null,
            ]}
            pointerEvents="none"
          >
            <Text style={styles.posterTitle} numberOfLines={2}>
              {title}
            </Text>
            {durationText ? (
              <Text style={styles.posterDuration}>{durationText}</Text>
            ) : null}
          </View>
        )}

        {/* Bottom Badge: Currently viewing, Recently added, Coming soon, or New for you in segment shelves */}
        {bottomBadge ? (
          <View style={styles.bottomBadgeRow} pointerEvents="none">
            <View
              style={[
                styles.bottomBadgeContainer,
                bottomBadge === 'Coming soon' && styles.comingSoonBadgeContainer,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  bottomBadge === 'Coming soon' && styles.comingSoonBadgeText,
                ]}
              >
                {bottomBadge}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Docked Watch Progress Line (Netflix/Wedflix bottom rim - Only in Continue Watching) */}
        {shouldShowProgressBar && isViewing ? (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(((watchProgress?.progressPercent || progress?.progressPercent || 0)) * 100)}%` },
              ]}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    width: POSTER_CARD_WIDTH,
    height: POSTER_CARD_HEIGHT,
    marginRight: 8,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  mediaFrame: {
    width: POSTER_CARD_WIDTH,
    height: POSTER_CARD_HEIGHT,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#161618',
    position: 'relative',
  },
  fillMedia: {
    width: '100%',
    height: '100%',
  },
  emptyMediaFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#18181B',
  },

  // ─── Top Badge (Stuck at Top Centre - Netflix Style) ──────────────────────
  topBadgesRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  topBadgeContainer: {
    backgroundColor: '#E50914',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.4,
    shadowRadius: 2.5,
    elevation: 3,
  },

  // ─── Bottom Badge (Stuck at Bottom Centre - Netflix Style) ───────────────────
  bottomBadgeRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  bottomBadgeContainer: {
    backgroundColor: '#E50914',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -1.5 },
    shadowOpacity: 0.35,
    shadowRadius: 2.5,
    elevation: 3,
  },
  comingSoonBadgeContainer: {
    backgroundColor: 'rgba(18, 18, 22, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(229, 196, 131, 0.85)',
    borderBottomWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  comingSoonBadgeText: {
    color: '#E5C483',
    letterSpacing: 0.1,
  },

  badgeText: {
    ...Platform.select({
      ios: {
        fontWeight: '700' as const,
      },
      android: {
        fontFamily: FONT_FUTURA_BOLD,
      },
      default: {
        fontWeight: '700' as const,
      },
    }),
    fontSize: 9,
    color: '#FFFFFF',
    letterSpacing: -0.1,
    lineHeight: 11,
    textAlign: 'center',
    includeFontPadding: false,
  },

  // ─── Center Play Circle ───────────────────────────────────────────────────
  playIconCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
  },
  playIconGlyph: {
    fontSize: 24,
    color: '#FFFFFF',
  },

  // ─── Bottom Typography Inside Card (Wedflix/Netflix Style) ────────────────
  posterBottomContent: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 6,
    alignItems: 'center',
    zIndex: 2,
  },
  posterTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 10,
    lineHeight: 12.5,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  posterDuration: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 8.5,
    color: '#E5C483',
    textAlign: 'center',
    marginTop: 1.5,
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // ─── Progress Bar ─────────────────────────────────────────────────────────
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    zIndex: 3,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#E50914',
  },
});
