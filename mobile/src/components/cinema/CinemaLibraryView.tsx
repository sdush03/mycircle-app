import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Pressable,
  Modal,
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

function isVerticalVideo(video: CinemaVideoItem): boolean {
  if (video.aspectRatio && video.aspectRatio < 0.9) return true;
  if (video.width && video.height && video.height > video.width) return true;
  const title = (video.title || video.name || '').toLowerCase();
  const cat = (video.category || '').toLowerCase();
  if (title.includes('reel') || cat.includes('reel') || title.includes('vertical') || title.includes('short')) return true;
  return false;
}

function isExplicitlyPrimary(video: CinemaVideoItem): boolean {
  if (
    video.isFeatured === true ||
    video.featured === true ||
    video.meta?.isFeatured === true ||
    video.raw?.isFeatured === true ||
    video.exif?.isFeatured === true ||
    video.raw?.exif?.isFeatured === true
  ) {
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
  const [infoModalVisible, setInfoModalVisible] = useState<boolean>(false);

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

    // 1. Check if ANY video in the gallery is explicitly marked as featured
    const explicitPrimary = videos.find(isExplicitlyPrimary);
    let primary: CinemaVideoItem | null = explicitPrimary || null;
    let remainingH: CinemaVideoItem[] = [];
    let remainingV: CinemaVideoItem[] = [];

    if (primary) {
      if (isVerticalVideo(primary)) {
        remainingH = [...horizontals];
        remainingV = verticals.filter((v) => v.id !== primary?.id);
      } else {
        remainingH = horizontals.filter((h) => h.id !== primary?.id);
        remainingV = [...verticals];
      }
    } else {
      // Fallback waterfall if no video is explicitly marked featured:
      if (horizontals.length > 0) {
        let primaryIdx = horizontals.findIndex(hasPrimaryTitleKeywords);

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
      } else if (verticals.length > 0) {
        primary = verticals[0];
        remainingH = [];
        remainingV = verticals.slice(1);
      }
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

  // Floating Hero Poster Card Height (~53vh)
  const heroCardHeight = Math.round(SCREEN_HEIGHT * 0.53);
  const primaryVideoThumb = primaryVideo ? getValidImageThumbnail(primaryVideo) : undefined;
  // Featured video strictly showcases the gallery cover on the Hero Marquee.
  // The video's own custom poster is preserved for shelf cards when not featured.
  const heroImageUri = coverUrl || primaryVideoThumb;
  const primaryProgress = primaryVideo ? getProgress(primaryVideo) : null;

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
          { paddingTop: Math.max(insets.top + 52, 92) },
        ]}
        refreshControl={refreshControl}
      >
        {/* 2. Floating Rounded Billboard Poster Card (Wedflix Strategy 1) */}
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

          {/* Top Red Brand Pill inside Hero (Wedflix/Netflix Style) */}
          <View style={styles.heroTopBrandRow}>
            <View style={styles.heroBrandPill}>
              <Text style={styles.heroBrandPillText}>MV</Text>
            </View>
          </View>

          {/* Multi-Stage Dark Bottom Vignette */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.68)', '#0B0B0C']}
            locations={[0, 0.4, 0.72, 1]}
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
                <Text style={styles.netflixPlayText}>
                  {primaryProgress && primaryProgress.currentTime > 0 ? 'Resume' : 'Play'}
                </Text>
              </Pressable>

              {/* Frosted More Info Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.netflixInfoBtn,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setInfoModalVisible(true);
                }}
              >
                <Text style={styles.netflixInfoIcon}>ⓘ</Text>
                <Text style={styles.netflixInfoText}>More Info</Text>
              </Pressable>
            </View>

            {/* Netflix Signature Red Progress Bar */}
            {primaryProgress && primaryProgress.currentTime > 0 && !primaryProgress.isCompleted ? (
              <View style={styles.heroProgressContainer}>
                <View style={styles.heroProgressBarTrack}>
                  <View
                    style={[
                      styles.heroProgressBarFill,
                      { width: `${Math.round(primaryProgress.progressPercent * 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.heroResumeText}>
                  Resume at {formatDuration(primaryProgress.currentTime)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* 3. Vertical Movie Poster Shelves (Wedflix ss6 & Strategy 1) */}
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
              {remainingHorizontals.length > 0 ? (
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
              {remainingVerticals.length > 0 ? (
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

          {/* 4. Minimalist Brand Footer */}
          <View style={styles.cinemaFooter}>
            <Text style={styles.footerBrandText}>MISTY VISUALS CINEMA</Text>
          </View>
        </View>
      </Animated.ScrollView>

      {/* 5. Netflix-Style "More Info" Bottom Sheet Modal */}
      <Modal
        visible={infoModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setInfoModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalDismissArea}
            onPress={() => setInfoModalVisible(false)}
          />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom + 16, 28) }]}>
            {/* Top Drag Handle */}
            <View style={styles.modalDragHandle} />

            {/* Close Button Top Right */}
            <Pressable
              onPress={() => setInfoModalVisible(false)}
              hitSlop={16}
              style={styles.modalCloseBtn}
            >
              <Text style={styles.modalCloseText}>✕</Text>
            </Pressable>

            {/* Couple Subtitle & Main Title */}
            <Text style={styles.modalCoupleSubtitle}>{coupleSubtitle}</Text>
            <Text style={styles.modalFilmTitle}>{heroFilmTitle}</Text>

            {/* Badges & Meta */}
            <View style={styles.modalMetaRow}>
              <View style={styles.top10Badge}>
                <Text style={styles.top10BadgeText}>TOP 10</Text>
              </View>
              <Text style={styles.modalMatchText}>#1 in Love Stories Today</Text>
              <View style={styles.modalSpecBadge}>
                <Text style={styles.modalSpecBadgeText}>4K UHD</Text>
              </View>
              <View style={styles.modalSpecBadge}>
                <Text style={styles.modalSpecBadgeText}>DOLBY</Text>
              </View>
              {primaryDuration ? (
                <Text style={styles.modalDurationText}>{primaryDuration}</Text>
              ) : null}
            </View>

            {/* Synopsis */}
            <Text style={styles.modalSynopsis}>
              The moment everything changed — nervous anticipation, heartfelt surprises, and the beginning of forever. Captured in cinematic high-definition with original audio master.
            </Text>

            {/* Big Play / Resume Button */}
            <Pressable
              style={({ pressed }) => [
                styles.modalPlayBtn,
                pressed && styles.btnPressed,
              ]}
              onPress={() => {
                setInfoModalVisible(false);
                handleWatchPrimary();
              }}
            >
              <Text style={styles.modalPlayBtnText}>
                {primaryProgress && primaryProgress.currentTime > 0 ? '▶  Resume Film' : '▶  Play Feature Film'}
              </Text>
            </Pressable>

            {/* Studio Credits */}
            <View style={styles.modalCreditsBlock}>
              <Text style={styles.modalCreditLabel}>
                Production: <Text style={styles.modalCreditVal}>Misty Visuals Cinema</Text>
              </Text>
              <Text style={styles.modalCreditLabel}>
                Format: <Text style={styles.modalCreditVal}>4K Cinema Master • Color Graded</Text>
              </Text>
            </View>
          </View>
        </View>
      </Modal>
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

  // ─── Floating Billboard Hero Card (Netflix ss1 & Wedflix ss5) ─────────────
  heroCardContainer: {
    width: SCREEN_WIDTH - 32,
    marginHorizontal: 16,
    borderRadius: 18,
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
    backgroundColor: '#E50914',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    shadowColor: '#E50914',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  heroBrandPillText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#FFFFFF',
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

  // ─── Hero Progress Bar ───────────────────────────────────────────────────
  heroProgressContainer: {
    width: '100%',
    maxWidth: 240,
    alignItems: 'center',
    marginTop: 10,
  },
  heroProgressBarTrack: {
    width: '100%',
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  heroProgressBarFill: {
    height: '100%',
    backgroundColor: '#E50914',
  },
  heroResumeText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
    letterSpacing: 0.2,
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
    marginBottom: 18,
  },
  shelfBlockSpaced: {
    marginTop: 8,
  },
  shelfTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 14,
    letterSpacing: 1.2,
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

  // ─── More Info Bottom Sheet Modal ─────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: '#161618',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  modalDragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 14,
    right: 18,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  modalCloseText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalCoupleSubtitle: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 11,
    letterSpacing: 2,
    color: 'rgba(255, 255, 255, 0.65)',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  modalFilmTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0.5,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  modalMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  modalMatchText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 12,
    color: '#FFFFFF',
    marginRight: 4,
  },
  modalSpecBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  modalSpecBadgeText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 9,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  modalDurationText: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 11,
    color: '#E5C483',
    marginLeft: 2,
  },
  modalSynopsis: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 20,
  },
  modalPlayBtn: {
    backgroundColor: '#FFFFFF',
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalPlayBtnText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 15,
    color: '#000000',
    letterSpacing: 0.3,
  },
  modalCreditsBlock: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 12,
    gap: 4,
  },
  modalCreditLabel: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.45)',
  },
  modalCreditVal: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    color: 'rgba(255, 255, 255, 0.85)',
  },
});




