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
  Platform,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_JOST_REGULAR,
} from '../../constants/fonts';
import {
  CinemaVideoCard,
  CinemaVideoItem,
  POSTER_CARD_WIDTH,
  POSTER_CARD_HEIGHT,
  getValidImageThumbnail,
  isVideoComingSoon,
  isVideoNewVersion,
  hasActualVideoFile,
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
  const t = video.title || video.exif?.title || video.name;
  if (t && t.trim()) {
    return t.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[_.-]+/g, ' ').trim();
  }
  if (video.category) {
    return video.category.toUpperCase();
  }
  return 'The Wedding Film';
}

export function classifyCinemaCategory(video: CinemaVideoItem): string {
  const explicit = (video.cinemaCategory || video.exif?.cinemaCategory || video.category || video.meta?.category || '').trim().toUpperCase().replace(/['']/g, '’');
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

function sortCinemaVideos(list: CinemaVideoItem[]): CinemaVideoItem[] {
  return [...list].sort((a, b) => {
    const orderA = a.sortOrder !== undefined ? a.sortOrder : (a.exif?.sortOrder !== undefined ? a.exif.sortOrder : 9999);
    const orderB = b.sortOrder !== undefined ? b.sortOrder : (b.exif?.sortOrder !== undefined ? b.exif.sortOrder : 9999);
    if (orderA !== orderB) return orderA - orderB;
    return 0;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── Hairline Didone Serif Ranked Numbers (Option 01: Vogue / Met Gala) ──
const STROKE_WIDTH = 1.2;
const STROKE_OFFSETS: [number, number][] = [
  [STROKE_WIDTH, 0],
  [STROKE_WIDTH * 0.92, STROKE_WIDTH * 0.38],
  [STROKE_WIDTH * 0.71, STROKE_WIDTH * 0.71],
  [STROKE_WIDTH * 0.38, STROKE_WIDTH * 0.92],
  [0, STROKE_WIDTH],
  [-STROKE_WIDTH * 0.38, STROKE_WIDTH * 0.92],
  [-STROKE_WIDTH * 0.71, STROKE_WIDTH * 0.71],
  [-STROKE_WIDTH * 0.92, STROKE_WIDTH * 0.38],
  [-STROKE_WIDTH, 0],
  [-STROKE_WIDTH * 0.92, -STROKE_WIDTH * 0.38],
  [-STROKE_WIDTH * 0.71, -STROKE_WIDTH * 0.71],
  [-STROKE_WIDTH * 0.38, -STROKE_WIDTH * 0.92],
  [0, -STROKE_WIDTH],
  [STROKE_WIDTH * 0.38, -STROKE_WIDTH * 0.92],
  [STROKE_WIDTH * 0.71, -STROKE_WIDTH * 0.71],
  [STROKE_WIDTH * 0.92, -STROKE_WIDTH * 0.38],
];

const RANK_FONT_FAMILY = Platform.select({
  ios: 'Didot',
  android: 'serif',
  default: 'Georgia',
});

interface OutlinedRankNumberProps {
  rank: number;
}

const OutlinedRankNumber: React.FC<OutlinedRankNumberProps> = React.memo(({ rank }) => {
  const text = String(rank);
  const letterSpacing = rank >= 10 ? -28 : -6;

  return (
    <View
      style={[
        styles.rankNumberContainer,
        { minWidth: rank >= 10 ? 64 : 52 },
      ]}
      pointerEvents="none"
    >
      <View style={styles.rankNumberInner}>
        {/* 16-direction circular outline for smooth stroke */}
        {STROKE_OFFSETS.map(([dx, dy], i) => (
          <Text
            key={i}
            style={[
              styles.rankNumberText,
              styles.rankNumberStroke,
              {
                letterSpacing,
                transform: [{ translateX: dx }, { translateY: dy }],
              },
            ]}
          >
            {text}
          </Text>
        ))}

        {/* Solid black inner fill */}
        <Text style={[styles.rankNumberText, styles.rankNumberFill, { letterSpacing }]}>
          {text}
        </Text>
      </View>
    </View>
  );
});

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
  const [progressTick, setProgressTick] = useState(0);
  const [infoModalVisible, setInfoModalVisible] = useState<boolean>(false);
  const [comingSoonModalVideo, setComingSoonModalVideo] = useState<CinemaVideoItem | null>(null);

  useEffect(() => {
    const unsubscribe = videoWatchProgressManager.subscribe(() => {
      setProgressTick((prev) => prev + 1);
    });
    return unsubscribe;
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // Content Partitioning & Editorial Hierarchy (4 Finalized Shelves: 1, 4, 3, 2)
  // ───────────────────────────────────────────────────────────────────────────
  const {
    primaryVideo,
    shelves,
    totalVideos,
  } = useMemo(() => {
    if (!videos || videos.length === 0) {
      return {
        primaryVideo: null,
        shelves: [],
        totalVideos: 0,
      };
    }

    const directorsCut: CinemaVideoItem[] = [];
    const candidDiaries: CinemaVideoItem[] = [];
    const stageSpotlight: CinemaVideoItem[] = [];
    const extendedCuts: CinemaVideoItem[] = [];

    videos.forEach((v) => {
      const cat = classifyCinemaCategory(v);
      if (cat === 'THE DIRECTORS’ CUT') directorsCut.push(v);
      else if (cat === 'CANDID DIARIES') candidDiaries.push(v);
      else if (cat === 'STAGE & SPOTLIGHT') stageSpotlight.push(v);
      else if (cat === 'THE EXTENDED CUTS') extendedCuts.push(v);
      else directorsCut.push(v);
    });

    const sortedDirectorsCut = sortCinemaVideos(directorsCut);
    const sortedCandidDiaries = sortCinemaVideos(candidDiaries);
    const sortedStageSpotlight = sortCinemaVideos(stageSpotlight);
    const sortedExtendedCuts = sortCinemaVideos(extendedCuts);

    // 1. Determine Featured Video for Hero Spotlight
    const explicitPrimary = videos.find(isExplicitlyPrimary);
    let primary: CinemaVideoItem | null = explicitPrimary || null;

    if (!primary) {
      if (sortedDirectorsCut.length > 0) {
        let pIdx = sortedDirectorsCut.findIndex(hasPrimaryTitleKeywords);
        if (pIdx === -1) {
          let maxDuration = -1;
          let longestIdx = -1;
          sortedDirectorsCut.forEach((v, idx) => {
            const d = Number(v.duration) || 0;
            if (d > maxDuration) {
              maxDuration = d;
              longestIdx = idx;
            }
          });
          pIdx = (longestIdx !== -1 && maxDuration > 0) ? longestIdx : 0;
        }
        primary = sortedDirectorsCut[pIdx];
      } else if (sortedExtendedCuts.length > 0) {
        primary = sortedExtendedCuts[0];
      } else if (sortedStageSpotlight.length > 0) {
        primary = sortedStageSpotlight[0];
      } else if (sortedCandidDiaries.length > 0) {
        primary = sortedCandidDiaries[0];
      }
    }

    // Exact finalized sequence: 1, 4, 3, 2
    // 1: THE DIRECTORS’ CUT
    // 2: CANDID DIARIES
    // 3: STAGE & SPOTLIGHT
    // 4: THE EXTENDED CUTS
    // Note: Primary film also appears in its shelf below as a 2:3 portrait card!
    type ShelfItem = {
      title: string;
      type: 'directors-cut' | 'candid-diaries' | 'stage-spotlight' | 'extended-cuts';
      items: CinemaVideoItem[];
    };

    const rawShelves: ShelfItem[] = [
      {
        title: 'THE DIRECTORS’ CUT',
        type: 'directors-cut',
        items: sortedDirectorsCut,
      },
      {
        title: 'CANDID DIARIES',
        type: 'candid-diaries',
        items: sortedCandidDiaries,
      },
      {
        title: 'STAGE & SPOTLIGHT',
        type: 'stage-spotlight',
        items: sortedStageSpotlight,
      },
      {
        title: 'THE EXTENDED CUTS',
        type: 'extended-cuts',
        items: sortedExtendedCuts,
      },
    ];
    const shelfList = rawShelves.filter((s) => s.items.length > 0);

    return {
      primaryVideo: primary,
      shelves: shelfList,
      totalVideos: videos.length,
    };
  }, [videos]);

  const getProgress = useCallback((item: CinemaVideoItem): WatchProgress | null => {
    return videoWatchProgressManager.getProgress(item);
  }, []);

  const continueWatchingVideos = useMemo(() => {
    if (!videos || videos.length === 0) return [];
    return videos
      .filter((v) => !isVideoComingSoon(v) && videoWatchProgressManager.isCurrentlyViewing(v))
      .sort((a, b) => {
        const pA = videoWatchProgressManager.getProgress(a);
        const pB = videoWatchProgressManager.getProgress(b);
        return (pB?.updatedAt || 0) - (pA?.updatedAt || 0);
      });
  }, [videos, progressTick]);

  const getBadgeForFilm = useCallback((film: CinemaVideoItem, index: number, shelfType: string) => {
    return undefined;
  }, []);

  const handleCardPress = useCallback((film: CinemaVideoItem, resumeTime?: number) => {
    if (isVideoComingSoon(film)) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setComingSoonModalVideo(film);
      return;
    }
    onSelectVideo(film, resumeTime);
  }, [onSelectVideo]);

  const isPrimaryComingSoon = isVideoComingSoon(primaryVideo);
  const isPrimaryNewVersion = isVideoNewVersion(primaryVideo);

  const handleWatchPrimary = useCallback(() => {
    if (!primaryVideo) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (isVideoComingSoon(primaryVideo)) {
      setComingSoonModalVideo(primaryVideo);
      return;
    }
    const progress = getProgress(primaryVideo);
    const resumeTime = progress && !progress.isCompleted && progress.currentTime > 0 ? progress.currentTime : undefined;
    onSelectVideo(primaryVideo, resumeTime);
  }, [primaryVideo, getProgress, onSelectVideo]);

  // Option B: Full-Bleed 70vh Circle Gallery Cover
  const heroCoverHeight = Math.round(SCREEN_HEIGHT * 0.70);
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
  const heroSynopsis = primaryVideo?.description || primaryVideo?.exif?.description || 'The moment everything changed — nervous anticipation, heartfelt promises, and the beginning of forever.';

  return (
    <View style={styles.screenContainer}>
      {/* 1. Floating Top Navigation (Matching Gallery Header Position) */}
      <View
        style={[
          styles.floatingNavBar,
          { height: Math.max(insets.top + 50, 88) },
        ]}
        pointerEvents="box-none"
      >
        <LinearGradient
          colors={['rgba(0, 0, 0, 0.70)', 'rgba(0, 0, 0, 0.25)', 'transparent']}
          locations={[0, 0.6, 1]}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* Center: Brand Logo (Exact Gallery Position) */}
        <View style={[styles.coverHeaderLogoContainer, { top: insets.top + 6 }]} pointerEvents="none">
          <Image
            source={require('../../../assets/images/logo-header-white.png')}
            style={styles.coverHeaderLogo}
            contentFit="contain"
          />
        </View>

        {/* Left: ← PHOTOS (Exact Gallery Position) */}
        <Pressable
          onPress={onBackToGallery}
          hitSlop={16}
          style={[styles.editorialBackButton, { top: Math.max(insets.top + 10, 42) }]}
        >
          <Text style={styles.editorialBackText}>← PHOTOS</Text>
        </Pressable>
      </View>

      <Animated.ScrollView
        ref={mainScrollRef}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        refreshControl={refreshControl}
      >
        {/* 2. Option B: Full-Bleed 70vh Circle Gallery Cover with Wedflix Red Theme */}
        <View style={[styles.heroCoverContainer, { height: heroCoverHeight }]}>
          {heroImageUri ? (
            <Image
              source={{ uri: heroImageUri }}
              style={styles.heroCoverImage}
              contentFit="cover"
              contentPosition="center"
              priority="high"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[styles.heroCoverImage, styles.heroFallbackBg]}>
              <ActivityIndicator size="small" color="#FFFFFF" />
            </View>
          )}

          {/* Multi-Stage Dark Vignette Overlay (Top dark for header, subtle mid, dark bottom for controls) */}
          <LinearGradient
            colors={['rgba(0,0,0,0.60)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.72)', '#000000']}
            locations={[0, 0.35, 0.70, 1]}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />

          {/* Lower Content Inside Hero Cover */}
          <View style={styles.heroContentLayer}>
            {/* Netflix Franchise Brand Prefix: On top in champagne gold */}
            <Text style={styles.heroOriginalPrefixText}>A MISTY VISUALS FILM</Text>

            {/* Couple Subtitle */}
            <Text style={styles.heroCoupleSubtitle} numberOfLines={1}>
              {coupleSubtitle}
            </Text>

            {/* Main Featured Film Title */}
            <Text style={styles.heroFilmTitle} numberOfLines={2}>
              {heroFilmTitle}
            </Text>

            {/* Film Duration (if available) & New Version Badge */}
            {(primaryDuration || isPrimaryNewVersion) ? (
              <View style={styles.heroDurationRow}>
                {primaryDuration ? (
                  <Text style={styles.heroDurationText}>{primaryDuration}</Text>
                ) : null}
                {isPrimaryNewVersion ? (
                  <View style={styles.heroNewVersionPill}>
                    <Text style={styles.heroNewVersionText}>NEW VERSION</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Romantic Cinematic Synopsis */}
            <Text style={styles.heroSynopsisText} numberOfLines={2}>
              {heroSynopsis}
            </Text>

            {/* Two Action Buttons Row: [ ▶ Play / ✨ Coming Soon ] + [ ⓘ More Info ] */}
            <View style={styles.heroButtonRow}>
              {isPrimaryComingSoon ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.netflixComingSoonBtn,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={handleWatchPrimary}
                >
                  <Text style={styles.netflixComingSoonIcon}>✨</Text>
                  <Text style={styles.netflixComingSoonText}>Coming Soon</Text>
                </Pressable>
              ) : (
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
              )}

              {/* Frosted More Info Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.netflixInfoBtn,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  if (isPrimaryComingSoon) {
                    setComingSoonModalVideo(primaryVideo);
                  } else {
                    setInfoModalVisible(true);
                  }
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

        {/* 3. Vertical Movie Poster Shelves (Option B - 4 Finalized Shelves) */}
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
              {/* 0. Continue Watching Shelf (Only visible when there are active in-progress videos) */}
              {continueWatchingVideos.length > 0 && (
                <View style={[styles.shelfBlock, styles.continueWatchingBlock]}>
                  <Text style={styles.shelfTitle}>CONTINUE WATCHING</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.shelfScrollContent}
                    snapToInterval={POSTER_CARD_WIDTH + 8}
                    decelerationRate="fast"
                  >
                    {continueWatchingVideos.map((film, index) => (
                      <CinemaVideoCard
                        key={`cw-${film.id || film.videoUrl || film.uri || index}`}
                        video={film}
                        variant="poster"
                        isContinueWatching={true}
                        watchProgress={getProgress(film)}
                        onPress={handleCardPress}
                      />
                    ))}
                  </ScrollView>
                </View>
              )}

              {shelves.map((shelf, shelfIdx) => {
                const isRanked = shelf.type === 'stage-spotlight';
                return (
                  <View
                    key={shelf.title}
                    style={[
                      styles.shelfBlock,
                      (shelfIdx > 0 || continueWatchingVideos.length > 0) && styles.shelfBlockSpaced,
                    ]}
                  >
                    <Text style={styles.shelfTitle}>{shelf.title}</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.shelfScrollContent}
                      snapToInterval={isRanked ? undefined : POSTER_CARD_WIDTH + 10}
                      decelerationRate="fast"
                    >
                      {shelf.items.map((film, index) => {
                        if (isRanked) {
                          const rank = index + 1;
                          return (
                            <View
                              key={String(film.id || film.videoUrl || film.uri || index)}
                              style={styles.rankedItemRow}
                            >
                              <Pressable
                                onPress={() => {
                                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                                  const progress = getProgress(film);
                                  const resumeTime = progress && !progress.isCompleted && progress.currentTime > 0 ? progress.currentTime : undefined;
                                  handleCardPress(film, resumeTime);
                                }}
                                style={styles.rankNumberPressable}
                              >
                                <OutlinedRankNumber rank={rank} />
                              </Pressable>
                              <View style={[styles.rankedCardOverlap, { marginLeft: rank >= 10 ? -26 : -22 }]}>
                                <CinemaVideoCard
                                  video={film}
                                  badge={getBadgeForFilm(film, index, shelf.type)}
                                  variant="poster"
                                  watchProgress={getProgress(film)}
                                  onPress={handleCardPress}
                                />
                              </View>
                            </View>
                          );
                        }

                        return (
                          <CinemaVideoCard
                            key={String(film.id || film.videoUrl || film.uri || index)}
                            video={film}
                            badge={getBadgeForFilm(film, index, shelf.type)}
                            variant="poster"
                            watchProgress={getProgress(film)}
                            onPress={handleCardPress}
                          />
                        );
                      })}
                    </ScrollView>
                  </View>
                );
              })}
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

            {/* Franchise Brand: On top in champagne gold */}
            <Text style={styles.modalOriginalPrefixText}>A MISTY VISUALS FILM</Text>

            {/* Couple Subtitle & Main Title */}
            <Text style={styles.modalCoupleSubtitle}>{coupleSubtitle}</Text>
            <Text style={styles.modalFilmTitle}>{heroFilmTitle}</Text>

            {/* Duration */}
            {primaryDuration ? (
              <View style={styles.modalMetaRow}>
                <Text style={styles.modalDurationText}>{primaryDuration}</Text>
              </View>
            ) : null}

            {/* Synopsis */}
            <Text style={styles.modalSynopsis}>
              {heroSynopsis}
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

      {/* 6. Coming Soon Premiere Teaser Modal */}
      <Modal
        visible={Boolean(comingSoonModalVideo)}
        animationType="slide"
        transparent
        onRequestClose={() => setComingSoonModalVideo(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalDismissArea}
            onPress={() => setComingSoonModalVideo(null)}
          />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom + 16, 28) }]}>
            {/* Top Drag Handle */}
            <View style={styles.modalDragHandle} />

            {/* Close Button Top Right */}
            <Pressable
              onPress={() => setComingSoonModalVideo(null)}
              hitSlop={16}
              style={styles.modalCloseBtn}
            >
              <Text style={styles.modalCloseText}>✕</Text>
            </Pressable>

            {/* Champagne Gold Coming Soon Badge */}
            <View style={styles.comingSoonHeaderBadge}>
              <Text style={styles.comingSoonHeaderBadgeText}>✨ PREMIERE COMING SOON</Text>
            </View>

            {/* Subtitle & Title */}
            <Text style={styles.modalCoupleSubtitle}>
              {comingSoonModalVideo?.subtitle || coupleSubtitle || 'CHAPTER I'}
            </Text>
            <Text style={styles.modalFilmTitle}>
              {formatDisplayTitle(comingSoonModalVideo)}
            </Text>

            {/* In-Production Teaser Banner Card */}
            <View style={styles.comingSoonNoticeCard}>
              <View style={styles.comingSoonNoticeHeader}>
                <Text style={styles.comingSoonNoticeIcon}>🎬</Text>
                <Text style={styles.comingSoonNoticeTitle}>Film in Production</Text>
              </View>
              <Text style={styles.comingSoonNoticeBody}>
                Our studio is currently crafting this film in the editing room. Check back soon for the exclusive premiere!
              </Text>
            </View>

            {/* Story Synopsis */}
            <Text style={styles.modalSynopsis}>
              {comingSoonModalVideo?.description ||
                comingSoonModalVideo?.exif?.description ||
                'From the quiet morning butterflies to the golden glow of their first steps as husband and wife, every second tells a story of genuine love.'}
            </Text>

            {/* Dismiss Button */}
            <Pressable
              style={({ pressed }) => [
                styles.modalDismissBtn,
                pressed && styles.btnPressed,
              ]}
              onPress={() => setComingSoonModalVideo(null)}
            >
              <Text style={styles.modalDismissBtnText}>Close</Text>
            </Pressable>
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

  // ─── Floating Top Navigation (Matching Gallery Header) ────────────────────
  floatingNavBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
  },
  coverHeaderLogoContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 95,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverHeaderLogo: {
    width: 135,
    height: 38,
  },
  editorialBackButton: {
    position: 'absolute',
    left: 24,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  editorialBackText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    color: '#ffffff',
  },

  // ─── Option B: Full-Bleed 70vh Circle Gallery Cover ────────────────────────
  heroCoverContainer: {
    width: '100%',
    position: 'relative',
    backgroundColor: '#1c1a18',
    overflow: 'hidden',
    marginBottom: 24,
  },
  heroCoverImage: {
    width: '100%',
    height: '100%',
  },
  heroFallbackBg: {
    backgroundColor: '#1c1a18',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroContentLayer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 22,
    alignItems: 'center',
    zIndex: 10,
  },
  heroOriginalPrefixText: {
    fontFamily: FONT_FUTURA,
    fontSize: 10.5,
    letterSpacing: 2.8,
    color: '#E5C483',
    textAlign: 'center',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  heroCoupleSubtitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: 1.2,
    color: 'rgba(255, 255, 255, 0.95)',
    textAlign: 'center',
    marginBottom: 4,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 5,
  },
  heroFilmTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 23,
    lineHeight: 28,
    letterSpacing: 0.8,
    color: '#FFFFFF',
    textAlign: 'center',
    textTransform: 'uppercase',
    marginBottom: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  heroDurationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    gap: 8,
  },
  heroDurationText: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 11.5,
    letterSpacing: 0.3,
    color: '#E5C483',
  },
  heroNewVersionPill: {
    backgroundColor: '#E50914',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroNewVersionText: {
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
    fontSize: 8.5,
    color: '#FFFFFF',
    letterSpacing: 0.3,
    includeFontPadding: false,
  },
  heroSynopsisText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    lineHeight: 15.5,
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    maxWidth: 320,
    paddingHorizontal: 12,
    marginBottom: 14,
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
    maxWidth: 280,
    gap: 12,
    marginBottom: 2,
  },
  netflixPlayBtn: {
    flex: 1,
    maxWidth: 135,
    height: 40,
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
    fontSize: 14,
    color: '#000000',
    letterSpacing: 0.3,
  },
  netflixInfoBtn: {
    flex: 1,
    maxWidth: 135,
    height: 40,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
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
    fontSize: 13.5,
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
  continueWatchingBlock: {
    marginBottom: 20,
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
    paddingLeft: 12,
    paddingRight: 12,
  },

  // ─── Ranked Shelves Layout (Option 01: Hairline Didone Serif) ─────────
  rankedItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    position: 'relative',
    marginRight: 18,
  },
  rankNumberPressable: {
    zIndex: 1,
  },
  rankedCardOverlap: {
    zIndex: 2,
    position: 'relative',
  },
  rankNumberContainer: {
    height: POSTER_CARD_HEIGHT,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    position: 'relative',
    overflow: 'visible',
    opacity: 0.5,
  },
  rankNumberInner: {
    transform: [
      {
        translateY: Platform.select({
          ios: 30,
          android: 18,
          default: 24,
        }),
      },
    ],
  },
  rankNumberText: {
    fontFamily: RANK_FONT_FAMILY,
    fontStyle: 'italic',
    fontSize: 130,
    lineHeight: 130,
    letterSpacing: -5,
    textAlign: 'right',
    includeFontPadding: false,
  },
  rankNumberStroke: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    color: '#E5E5EA',
  },
  rankNumberFill: {
    color: '#000000',
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
  modalOriginalPrefixText: {
    fontFamily: FONT_FUTURA,
    fontSize: 10,
    letterSpacing: 2.5,
    color: '#E5C483',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  modalCoupleSubtitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: 1.2,
    color: 'rgba(255, 255, 255, 0.92)',
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
  netflixComingSoonBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C1C22',
    borderWidth: 1,
    borderColor: 'rgba(229, 196, 131, 0.65)',
    paddingVertical: 10,
    borderRadius: 6,
    gap: 7,
  },
  netflixComingSoonIcon: {
    fontSize: 13,
  },
  netflixComingSoonText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 14,
    color: '#E5C483',
    letterSpacing: 0.3,
  },
  comingSoonHeaderBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(229, 196, 131, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(229, 196, 131, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 8,
  },
  comingSoonHeaderBadgeText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 9.5,
    color: '#E5C483',
    letterSpacing: 0.8,
  },
  comingSoonNoticeCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    padding: 12,
    marginVertical: 10,
  },
  comingSoonNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  comingSoonNoticeIcon: {
    fontSize: 14,
  },
  comingSoonNoticeTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 12,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  comingSoonNoticeBody: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    lineHeight: 16,
    color: '#A1A1AA',
  },
  modalDismissBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  modalDismissBtnText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 13,
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
});




