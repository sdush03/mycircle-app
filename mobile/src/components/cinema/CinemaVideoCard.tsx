import React from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
} from '../../constants/fonts';
import { WatchProgress } from '../../services/videoWatchProgressManager';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Vertical Movie Poster Card Dimensions (~2:3 ratio, matching Netflix & Wedflix)
export const POSTER_CARD_WIDTH = 140;
export const POSTER_CARD_HEIGHT = 210;

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
  aspectRatio?: number | null;
  width?: number;
  height?: number;
  [key: string]: any;
}

interface CinemaVideoCardProps {
  video: CinemaVideoItem;
  variant?: 'poster' | 'shelf-film' | 'shelf-reel' | 'primary' | 'horizontal' | 'vertical';
  isFeatured?: boolean;
  badge?: string;
  watchProgress?: WatchProgress | null;
  onPress: (video: CinemaVideoItem, resumeTimeSec?: number) => void;
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
    video.raw?.thumbnailUrl,
    video.raw?.posterUrl,
    video.raw?.poster_url,
    video.raw?.coverUrl,
    video.raw?.cover_url,
    video.raw?.preview_url,
    video.raw?.thumbUri,
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
  if (video.aspectRatio && video.aspectRatio < 0.9) return true;
  if (video.width && video.height && video.height > video.width) return true;
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
}) => {
  const thumbUri = getValidImageThumbnail(video);
  const title = formatEditorialTitle(video);
  const durationText = formatDuration(video.duration);
  const isViewing = watchProgress && !watchProgress.isCompleted && watchProgress.progressPercent > 0;
  const isReel = isReelVideo(video);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const resumeTime =
      watchProgress && !watchProgress.isCompleted && watchProgress.currentTime > 0
        ? watchProgress.currentTime
        : undefined;
    onPress(video, resumeTime);
  };

  const displayBadge = (badge && badge.toUpperCase() !== 'FEATURE' && badge.toUpperCase() !== 'FEATURED') ? badge : undefined;

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

        {/* Scrim gradient: subtle dark bottom to guarantee title legibility */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.95)']}
          locations={[0.3, 0.62, 1]}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Top Badges Row */}
        {isViewing || displayBadge || isReel ? (
          <View style={[styles.topBadgesRow, { justifyContent: 'flex-end' }]}>
            {isViewing ? (
              <View style={styles.currentlyViewingBadge}>
                <Text style={styles.currentlyViewingText}>Currently Viewing</Text>
              </View>
            ) : displayBadge ? (
              <View style={styles.customBadge}>
                <Text style={styles.customBadgeText}>{displayBadge}</Text>
              </View>
            ) : isReel ? (
              <View style={styles.top10Badge}>
                <Text style={styles.top10BadgeText}>NEW</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Center Restrained Play Icon on tap/preview */}
        <View style={styles.playIconCenter} pointerEvents="none">
          <View style={styles.playIconCircle}>
            <Text style={styles.playIconGlyph}>▶</Text>
          </View>
        </View>

        {/* Poster Bottom Content: Title & Duration LAYERED INSIDE CARD (Wedflix ss6 style) */}
        <View style={styles.posterBottomContent} pointerEvents="none">
          <Text style={styles.posterTitle} numberOfLines={2}>
            {title}
          </Text>
          {durationText ? (
            <Text style={styles.posterDuration}>{durationText}</Text>
          ) : null}
        </View>

        {/* Docked Watch Progress Line (Netflix/Wedflix bottom rim) */}
        {isViewing ? (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(watchProgress.progressPercent * 100)}%` },
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
    marginRight: 10,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  mediaFrame: {
    width: POSTER_CARD_WIDTH,
    height: POSTER_CARD_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#161618',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  fillMedia: {
    width: '100%',
    height: '100%',
  },
  emptyMediaFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#18181B',
  },

  // ─── Top Badges ───────────────────────────────────────────────────────────
  topBadgesRow: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 2,
  },
  currentlyViewingBadge: {
    backgroundColor: '#E50914',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  currentlyViewingText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 8,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  top10Badge: {
    backgroundColor: '#E50914',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  top10BadgeText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 8,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  customBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.70)',
    borderWidth: 1,
    borderColor: '#E5C483',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  customBadgeText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 8,
    color: '#E5C483',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // ─── Center Play Circle ───────────────────────────────────────────────────
  playIconCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
  },
  playIconGlyph: {
    fontSize: 10,
    color: '#FFFFFF',
  },

  // ─── Bottom Typography Inside Card (Wedflix/Netflix Style) ────────────────
  posterBottomContent: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 8,
    alignItems: 'center',
    zIndex: 2,
  },
  posterTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 12,
    lineHeight: 15,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  posterDuration: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 10,
    color: '#E5C483',
    textAlign: 'center',
    marginTop: 2,
    letterSpacing: 0.4,
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
