import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
} from '../../constants/fonts';
import {
  CinemaVideoCard,
  CinemaVideoItem,
  POSTER_CARD_WIDTH,
  getValidImageThumbnail,
} from './CinemaVideoCard';
import {
  videoWatchProgressManager,
  WatchProgress,
} from '../../services/videoWatchProgressManager';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface CinemaLibraryViewProps {
  videos: CinemaVideoItem[];
  coverUrl?: string;
  eventTitle?: string;
  onSelectVideo: (video: CinemaVideoItem, resumeTimeSec?: number) => void;
  onBackToGallery: () => void;
  onScroll?: any;
  scrollEventThrottle?: number;
  refreshControl?: any;
  mainScrollRef?: any;
  isLoading?: boolean;
}

type CinemaFilterType = 'ALL' | 'FILMS' | 'REELS';

function isVerticalVideo(video: CinemaVideoItem): boolean {
  if (video.aspectRatio && video.aspectRatio < 0.9) return true;
  if (video.width && video.height && video.height > video.width) return true;
  const title = (video.title || video.name || '').toLowerCase();
  const cat = (video.category || '').toLowerCase();
  if (title.includes('reel') || cat.includes('reel') || title.includes('vertical') || title.includes('short')) return true;
  return false;
}

function isExplicitlyPrimary(video: CinemaVideoItem): boolean {
  if (video.isFeatured === true || video.featured === true || video.meta?.isFeatured === true || video.raw?.isFeatured === true) {
    return true;
  }
  const cat = (video.category || video.meta?.category || video.raw?.category || '').toUpperCase();
  if (cat === 'FEATURE' || cat === 'FEATURED' || cat === 'FEATURE FILM' || cat === 'PRIMARY') {
    return true;
  }
  return false;
}

function hasPrimaryTitleKeywords(video: CinemaVideoItem): boolean {
  const title = (video.title || video.name || '').toLowerCase();
  return (
    title.includes('wedding film') ||
    title.includes('main film') ||
    title.includes('feature film') ||
    title.includes('highlight film') ||
    title.includes('highlights') ||
    title.includes('full film') ||
    title.includes('the film') ||
    title.includes('cinema film')
  );
}

function formatDuration(sec?: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

function formatDisplayTitle(video?: CinemaVideoItem | null): string {
  if (!video) return 'The Wedding Film';
  if (video.title && video.title.trim()) {
    return video.title.replace(/\.[a-zA-Z0-9]+$/, '').replace(/_/g, ' ').trim();
  }
  if (video.name && video.name.trim()) {
    return video.name.replace(/\.[a-zA-Z0-9]+$/, '').replace(/_/g, ' ').trim();
  }
  if (video.category) {
    return video.category.toUpperCase();
  }
  return 'The Wedding Film';
}

export const CinemaLibraryView: React.FC<CinemaLibraryViewProps> = ({
  videos,
  coverUrl,
  eventTitle,
  onSelectVideo,
  onBackToGallery,
  onScroll,
  scrollEventThrottle = 16,
  refreshControl,
  mainScrollRef,
  isLoading = false,
}) => {
  const insets = useSafeAreaInsets();
  const [, setProgressTick] = useState(0);
  const [activeFilter, setActiveFilter] = useState<CinemaFilterType>('ALL');

  useEffect(() => {
    const unsubscribe = videoWatchProgressManager.subscribe(() => {
      setProgressTick((prev) => prev + 1);
    });
    return unsubscribe;
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // Content Partitioning & Editorial Hierarchy (Metadata & Content Driven)
  // ───────────────────────────────────────────────────────────────────────────
  const {
    primaryVideo,
    remainingHorizontals,
    remainingVerticals,
    totalVideos,
  } = useMemo(() => {
    if (!videos || videos.length === 0) {
      return {
        primaryVideo: null,
        remainingHorizontals: [],
        remainingVerticals: [],
        totalVideos: 0,
      };
    }

    const horizontals: CinemaVideoItem[] = [];
    const verticals: CinemaVideoItem[] = [];

    videos.forEach((v) => {
      if (isVerticalVideo(v)) {
        verticals.push(v);
      } else {
        horizontals.push(v);
      }
    });

    let primary: CinemaVideoItem | null = null;
    let remainingH: CinemaVideoItem[] = [];
    let remainingV: CinemaVideoItem[] = [];

    if (horizontals.length > 0) {
      let primaryIdx = horizontals.findIndex(isExplicitlyPrimary);

      if (primaryIdx === -1) {
        primaryIdx = horizontals.findIndex(hasPrimaryTitleKeywords);
      }

      if (primaryIdx === -1) {
        let maxDuration = -1;
        let longestIdx = -1;
        horizontals.forEach((v, idx) => {
          const d = Number(v.duration) || 0;
          if (d > maxDuration) {
            maxDuration = d;
            longestIdx = idx;
          }
        });
        if (longestIdx !== -1 && maxDuration > 0) {
          primaryIdx = longestIdx;
        }
      }

      if (primaryIdx === -1) {
        primaryIdx = 0;
      }

      primary = horizontals[primaryIdx];
      remainingH = horizontals.filter((_, idx) => idx !== primaryIdx);
      remainingV = [...verticals];
    } else {
      let primaryIdx = verticals.findIndex(isExplicitlyPrimary);

      if (primaryIdx === -1) {
        let maxDuration = -1;
        let longestIdx = -1;
        verticals.forEach((v, idx) => {
          const d = Number(v.duration) || 0;
          if (d > maxDuration) {
            maxDuration = d;
            longestIdx = idx;
          }
        });
        primaryIdx = longestIdx !== -1 && maxDuration > 0 ? longestIdx : 0;
      }

      primary = verticals[primaryIdx];
      remainingH = [];
      remainingV = verticals.filter((_, idx) => idx !== primaryIdx);
    }

    return {
      primaryVideo: primary,
      remainingHorizontals: remainingH,
      remainingVerticals: remainingV,
      totalVideos: videos.length,
    };
  }, [videos]);

  const getProgress = useCallback((item: CinemaVideoItem): WatchProgress | null => {
    return videoWatchProgressManager.getProgress(item);
  }, []);

  const handleWatchPrimary = useCallback(() => {
    if (!primaryVideo) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const progress = getProgress(primaryVideo);
    const resumeTime = progress && !progress.isCompleted && progress.currentTime > 0 ? progress.currentTime : undefined;
    onSelectVideo(primaryVideo, resumeTime);
  }, [primaryVideo, getProgress, onSelectVideo]);

  const handleFilterPress = (filter: CinemaFilterType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setActiveFilter(filter);
  };

  // Floating Hero Poster Card Height (~53vh)
  const heroCardHeight = Math.round(SCREEN_HEIGHT * 0.53);
  const primaryVideoThumb = primaryVideo ? getValidImageThumbnail(primaryVideo) : undefined;
  const heroImageUri = primaryVideoThumb || coverUrl;

  // Clean couple subtitle
  const coupleSubtitle = (eventTitle || 'THE WEDDING')
    .replace(/'s\s+Wedding/gi, '')
    .replace('&', '·')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  const heroFilmTitle = formatDisplayTitle(primaryVideo);
  const primaryDuration = formatDuration(primaryVideo?.duration);

  return (
    <View style={styles.screenContainer}>
      {/* 1. Floating Netflix Top Header */}
      <View style={[styles.floatingNavBar, { paddingTop: Math.max(insets.top + 6, 44) }]}>
        <Pressable onPress={onBackToGallery} hitSlop={16} style={styles.navBackBtn}>
          <Text style={styles.navBackText}>← Photos</Text>
        </Pressable>
        <Text style={styles.navBrandText}>MISTY VISUALS</Text>
        <View style={styles.navRightPlaceholder} />
      </View>

      <Animated.ScrollView
        ref={mainScrollRef}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}
        contentContainerStyle={[
          styles.contentContainer,
          { paddingTop: Math.max(insets.top + 48, 88) },
        ]}
        refreshControl={refreshControl}
      >
        {/* 2. Netflix / Wedflix Filter Pills Row (ss1 & ss5) */}
        <View style={styles.filterPillsRow}>
          <Pressable
            onPress={() => handleFilterPress('ALL')}
            style={[
              styles.filterPill,
              activeFilter === 'ALL' && styles.filterPillActive,
            ]}
          >
            <Text
              style={[
                styles.filterPillText,
                activeFilter === 'ALL' && styles.filterPillTextActive,
              ]}
            >
              All Films
            </Text>
          </Pressable>

          {remainingHorizontals.length > 0 || (primaryVideo && !isVerticalVideo(primaryVideo)) ? (
            <Pressable
              onPress={() => handleFilterPress('FILMS')}
              style={[
                styles.filterPill,
                activeFilter === 'FILMS' && styles.filterPillActive,
              ]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  activeFilter === 'FILMS' && styles.filterPillTextActive,
                ]}
              >
                Wedding Films
              </Text>
            </Pressable>
          ) : null}

          {remainingVerticals.length > 0 || (primaryVideo && isVerticalVideo(primaryVideo)) ? (
            <Pressable
              onPress={() => handleFilterPress('REELS')}
              style={[
                styles.filterPill,
                activeFilter === 'REELS' && styles.filterPillActive,
              ]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  activeFilter === 'REELS' && styles.filterPillTextActive,
                ]}
              >
                Reels & Moments
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* 3. Floating Rounded Billboard Poster Card (Matching Netflix ss1 & Wedflix ss5) */}
        <View style={[styles.heroCardContainer, { height: heroCardHeight }]}>
          {heroImageUri ? (
            <Image
              source={{ uri: heroImageUri }}
              style={styles.heroImage}
              contentFit="cover"
              contentPosition="center"
              priority="high"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[styles.heroImage, styles.heroFallbackBg]} />
          )}

          {/* Top Brand Pill inside Hero (Wedflix/Netflix Style) */}
          <View style={styles.heroTopBrandRow}>
            <View style={styles.heroBrandPill}>
              <Text style={styles.heroBrandPillText}>MV</Text>
            </View>
          </View>

          {/* Multi-Stage Dark Bottom Vignette */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.65)', '#0B0B0C']}
            locations={[0, 0.42, 0.72, 1]}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />

          {/* Lower Content Inside Hero Card (Wedflix ss5 Style) */}
          <View style={styles.heroContentLayer}>
            {/* Couple Subtitle */}
            <Text style={styles.heroCoupleSubtitle} numberOfLines={1}>
              {coupleSubtitle}
            </Text>

            {/* Main Featured Film Title */}
            <Text style={styles.heroFilmTitle} numberOfLines={2}>
              {heroFilmTitle}
            </Text>

            {/* Wedflix #1 in Love Stories Today Badge Row (ss5) */}
            <View style={styles.heroBadgeRow}>
              <View style={styles.top10Badge}>
                <Text style={styles.top10BadgeText}>TOP 10</Text>
              </View>
              <Text style={styles.heroRankText}>#1 in Love Stories Today</Text>
              {primaryDuration ? (
                <>
                  <Text style={styles.heroBullet}>•</Text>
                  <Text style={styles.heroDurationText}>{primaryDuration}</Text>
                </>
              ) : null}
            </View>

            {/* Romantic Cinematic Synopsis (Wedflix ss5) */}
            <Text style={styles.heroSynopsisText} numberOfLines={2}>
              The moment everything changed — nervous anticipation, heartfelt surprises, and the beginning of forever.
            </Text>

            {/* Two Action Buttons Row: [ ▶ Play ] + [ ⓘ More Info ] */}
            <View style={styles.heroButtonRow}>
              {/* Solid White Play Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.netflixPlayBtn,
                  pressed && styles.btnPressed,
                ]}
                onPress={handleWatchPrimary}
              >
                <Text style={styles.netflixPlayIcon}>▶</Text>
                <Text style={styles.netflixPlayText}>Play</Text>
              </Pressable>

              {/* Frosted More Info Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.netflixInfoBtn,
                  pressed && styles.btnPressed,
                ]}
                onPress={handleWatchPrimary}
              >
                <Text style={styles.netflixInfoIcon}>ⓘ</Text>
                <Text style={styles.netflixInfoText}>More Info</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* 4. Vertical Movie Poster Shelves (Matching Wedflix ss6 & Netflix ss2-4) */}
        <View style={styles.shelvesContainer}>
          {isLoading && totalVideos === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#FFFFFF" />
            </View>
          ) : totalVideos === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>THE SCREENING ROOM</Text>
              <Text style={styles.emptySubtitle}>Films for this celebration are being curated.</Text>
            </View>
          ) : (
            <View style={styles.shelvesFlow}>
              {/* Shelf 1: OUR FILMS (Horizontal Films displayed as Movie Posters) */}
              {(activeFilter === 'ALL' || activeFilter === 'FILMS') && remainingHorizontals.length > 0 ? (
                <View style={styles.shelfBlock}>
                  <Text style={styles.shelfTitle}>OUR FILMS</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.shelfScrollContent}
                    snapToInterval={POSTER_CARD_WIDTH + 10}
                    decelerationRate="fast"
                  >
                    {remainingHorizontals.map((film) => (
                      <CinemaVideoCard
                        key={String(film.id || film.videoUrl || film.uri)}
                        video={film}
                        variant="poster"
                        watchProgress={getProgress(film)}
                        onPress={onSelectVideo}
                      />
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {/* Shelf 2: UNSCRIPTED MOMENTS (Reels & Highlights displayed as Movie Posters) */}
              {(activeFilter === 'ALL' || activeFilter === 'REELS') && remainingVerticals.length > 0 ? (
                <View style={[styles.shelfBlock, remainingHorizontals.length > 0 && styles.shelfBlockSpaced]}>
                  <Text style={styles.shelfTitle}>UNSCRIPTED MOMENTS</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.shelfScrollContent}
                    snapToInterval={POSTER_CARD_WIDTH + 10}
                    decelerationRate="fast"
                  >
                    {remainingVerticals.map((reel) => (
                      <CinemaVideoCard
                        key={String(reel.id || reel.videoUrl || reel.uri)}
                        video={reel}
                        variant="poster"
                        watchProgress={getProgress(reel)}
                        onPress={onSelectVideo}
                      />
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          )}

          {/* 5. Minimalist Brand Footer */}
          <View style={styles.cinemaFooter}>
            <Text style={styles.footerBrandText}>MISTY VISUALS CINEMA</Text>
          </View>
        </View>
      </Animated.ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#000000',
  },
  contentContainer: {
    paddingBottom: 60,
  },

  // ─── Floating Top Navigation ──────────────────────────────────────────────
  floatingNavBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  navBackBtn: {
    paddingVertical: 4,
    paddingRight: 12,
  },
  navBackText: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 14,
    letterSpacing: 0.3,
    color: '#FFFFFF',
  },
  navBrandText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 13,
    letterSpacing: 3,
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  navRightPlaceholder: {
    width: 50,
  },

  // ─── Filter Pills Row (ss1 & ss5) ─────────────────────────────────────────
  filterPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  filterPillActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  filterPillText: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 12,
    letterSpacing: 0.3,
    color: '#E5E5E5',
  },
  filterPillTextActive: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#000000',
  },

  // ─── Floating Billboard Hero Card (Netflix ss1 & Wedflix ss5) ─────────────
  heroCardContainer: {
    width: SCREEN_WIDTH - 32,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#121214',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    marginBottom: 26,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroFallbackBg: {
    backgroundColor: '#161618',
  },
  heroTopBrandRow: {
    position: 'absolute',
    top: 14,
    left: 14,
    zIndex: 2,
  },
  heroBrandPill: {
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  heroBrandPillText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 10,
    letterSpacing: 1,
    color: '#E5C483',
  },
  heroContentLayer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    alignItems: 'center',
    zIndex: 2,
  },
  heroCoupleSubtitle: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 11,
    letterSpacing: 2,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  heroFilmTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: 0.8,
    color: '#FFFFFF',
    textAlign: 'center',
    textTransform: 'uppercase',
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  top10Badge: {
    backgroundColor: '#E50914',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
    marginRight: 6,
  },
  top10BadgeText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 9,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  heroRankText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 12,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  heroBullet: {
    fontSize: 10,
    color: '#8E8E93',
    marginHorizontal: 6,
  },
  heroDurationText: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 11,
    color: '#E5C483',
  },
  heroSynopsisText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    lineHeight: 15,
    color: 'rgba(255, 255, 255, 0.72)',
    textAlign: 'center',
    paddingHorizontal: 12,
    marginBottom: 16,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // ─── Netflix Button Row ───────────────────────────────────────────────────
  heroButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    gap: 12,
  },
  netflixPlayBtn: {
    flex: 1,
    maxWidth: 160,
    height: 42,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  netflixPlayIcon: {
    fontSize: 14,
    color: '#000000',
  },
  netflixPlayText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 15,
    color: '#000000',
    letterSpacing: 0.3,
  },
  netflixInfoBtn: {
    flex: 1,
    maxWidth: 140,
    height: 42,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  netflixInfoIcon: {
    fontSize: 15,
    color: '#FFFFFF',
  },
  netflixInfoText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },

  // ─── Shelves & Content ────────────────────────────────────────────────────
  shelvesContainer: {
    backgroundColor: '#000000',
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    paddingVertical: 60,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 13,
    letterSpacing: 2,
    color: '#E5C483',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 13,
    color: '#A3A3A3',
    textAlign: 'center',
  },
  shelvesFlow: {
    width: '100%',
  },
  shelfBlock: {
    marginBottom: 16,
  },
  shelfBlockSpaced: {
    marginTop: 10,
  },
  shelfTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 16,
    letterSpacing: 0.6,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  shelfScrollContent: {
    paddingLeft: 16,
    paddingRight: 16,
  },

  // ─── Footer ───────────────────────────────────────────────────────────────
  cinemaFooter: {
    marginTop: 40,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerBrandText: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 10,
    letterSpacing: 3,
    color: '#444444',
  },
});




