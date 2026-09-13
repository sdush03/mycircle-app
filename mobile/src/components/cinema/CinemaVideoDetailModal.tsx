import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
  Dimensions,
  Share,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Easing,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import {
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
} from '../../constants/fonts';
import {
  CinemaVideoItem,
  getValidImageThumbnail,
  isVideoComingSoon,
  isVideoNewVersion,
} from './CinemaVideoCard';
import { videoWatchProgressManager, WatchProgress } from '../../services/videoWatchProgressManager';
import { videoDownloadManager } from '../../services/videoDownloadManager';
import { videoWatchlistManager } from '../../services/videoWatchlistManager';
import { ScreenCastButton } from './ScreenCastButton';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// 3-column recommendation poster card width
const REC_CARD_MARGIN = 8;
const REC_CARD_WIDTH = Math.floor((SCREEN_WIDTH - 32 - REC_CARD_MARGIN * 2) / 3);
const REC_CARD_HEIGHT = Math.round(REC_CARD_WIDTH * 1.45);

export interface LightboxBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CinemaVideoDetailModalProps {
  visible: boolean;
  video: CinemaVideoItem | null;
  initialBounds?: LightboxBounds | null;
  coverUrl?: string;
  allVideos: CinemaVideoItem[];
  eventTitle?: string;
  onClose: () => void;
  onPlayVideo: (video: CinemaVideoItem, resumeTimeSec?: number) => void;
  onToggleLike?: (video: CinemaVideoItem) => void;
}

function formatDuration(sec?: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return '3m 45s';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}h ${remM > 0 ? `${remM}m` : ''}`;
  }
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

function extractCleanVideoUrl(video: any): string | null {
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
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('http')) {
      const lower = c.toLowerCase();
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')) {
        continue;
      }
      return c;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── Netflix-Style Autoplay 16:9 Video Preview Player Component ─────────────
// ─────────────────────────────────────────────────────────────────────────────
interface DetailHeroPlayerProps {
  videoUrl: string;
  thumbnailUrl?: string;
  videoTitle: string;
  onClose: () => void;
  height: number;
  translateY: SharedValue<number>;
  isDismissing: SharedValue<boolean>;
  dismissProgress: SharedValue<number>;
}

const DetailHeroPlayer: React.FC<DetailHeroPlayerProps> = ({
  videoUrl,
  thumbnailUrl,
  videoTitle,
  onClose,
  height,
  translateY,
  isDismissing,
  dismissProgress,
}) => {
  const localPath = videoDownloadManager.getLocalPath(videoUrl);
  const effectiveUrl = localPath
    ? (localPath.startsWith('file://') ? localPath : `file://${localPath}`)
    : videoUrl;

  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(true);

  const player = useVideoPlayer(effectiveUrl, (p) => {
    p.loop = true;
    p.muted = true;
    p.allowsExternalPlayback = true;
    try {
      p.play();
    } catch {}
  });

  useEffect(() => {
    try {
      player.muted = isMuted;
    } catch {}
  }, [player, isMuted]);

  useEffect(() => {
    try {
      player.play();
    } catch {}

    const playSub = (player as any).addListener?.('playingChange', (payload: any) => {
      setIsPlaying(payload?.isPlaying ?? player.playing);
    });
    const statusSub = (player as any).addListener?.('statusChange', (payload: any) => {
      const status = payload?.status ?? player.status;
      setIsBuffering(status === 'loading');
    });

    return () => {
      playSub?.remove?.();
      statusSub?.remove?.();
      try {
        player.pause();
      } catch {}
    };
  }, [player]);

  const handleTogglePlay = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
  }, [player]);

  const handleToggleMute = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setIsMuted((prev) => !prev);
  }, []);

  const controlsFadeAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    if (isDismissing.value) {
      return {
        opacity: Math.max(0, 1 - dismissProgress.value * 4),
      };
    }
    const dragProgress = Math.min(translateY.value / 80, 1);
    return {
      opacity: Math.max(0, 1 - dragProgress),
    };
  });

  return (
    <View style={[styles.previewContainer, { height: '100%' }]}>
      {/* 1. Underlying Poster Thumbnail (instant first frame) */}
      {thumbnailUrl ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={[StyleSheet.absoluteFillObject, styles.videoCanvasRadius]}
          contentFit="cover"
          priority="high"
          cachePolicy="memory-disk"
        />
      ) : null}

      {/* 2. Native VideoView */}
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFillObject, styles.videoCanvasRadius]}
        contentFit="cover"
        nativeControls={false}
        surfaceType="textureView"
        fullscreenOptions={{ enable: false }}
        showsTimecodes={false}
      />

      {/* 3. Controls & HUD (fades out immediately when closing starts) */}
      <Animated.View style={[StyleSheet.absoluteFillObject, controlsFadeAnimatedStyle]}>
        {/* Subtle Dark Gradient Overlay on Top and Bottom for HUD contrast */}
        <LinearGradient
          colors={['rgba(0,0,0,0.7)', 'transparent', 'rgba(0,0,0,0.65)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* Touch Area: tap toggles play/pause */}
        <Pressable style={StyleSheet.absoluteFillObject} onPress={handleTogglePlay}>
          {isBuffering && (
            <View style={styles.previewBufferingOverlay} pointerEvents="none">
              <ActivityIndicator size="small" color="#FFFFFF" />
            </View>
          )}

          {!isPlaying && !isBuffering && (
            <View style={styles.previewPausedOverlay} pointerEvents="none">
              <View style={styles.previewPlayGlyphBg}>
                <Ionicons name="play" size={28} color="#FFFFFF" style={{ marginLeft: 3 }} />
              </View>
            </View>
          )}
        </Pressable>

        {/* Top Right Controls Overlay: Cast Button + Close Button */}
        <View style={styles.previewTopRightRow} pointerEvents="box-none">
          <ScreenCastButton
            size={20}
            color="#FFFFFF"
            activeColor="#E5C483"
            videoTitle={videoTitle}
          />
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onClose();
            }}
            hitSlop={14}
            style={({ pressed }) => [
              styles.previewCircleBtn,
              pressed && styles.btnPressed,
            ]}
          >
            <Ionicons name="close" size={18} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* Bottom Right Controls Overlay: Mute / Unmute Button (Netflix Style) */}
        <View style={styles.previewBottomRightRow} pointerEvents="box-none">
          <Pressable
            onPress={handleToggleMute}
            hitSlop={12}
            style={({ pressed }) => [
              styles.previewCircleBtn,
              pressed && styles.btnPressed,
            ]}
          >
            <Ionicons
              name={isMuted ? 'volume-mute' : 'volume-high'}
              size={16}
              color="#FFFFFF"
            />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ─── Main Cinema Video Detail Full Page Component ───────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
export const CinemaVideoDetailModal: React.FC<CinemaVideoDetailModalProps> = ({
  visible,
  video: initialVideo,
  initialBounds,
  coverUrl,
  allVideos,
  eventTitle,
  onClose,
  onPlayVideo,
  onToggleLike,
}) => {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const topOffset = Math.max(insets.top + 6, 44);
  const videoHeight = Math.round((SCREEN_WIDTH * 9) / 16);

  // Active video currently focused in the modal (swappable via "More Like This")
  const [activeVideo, setActiveVideo] = useState<CinemaVideoItem | null>(initialVideo);
  const [activeTab, setActiveTab] = useState<'more' | 'trailers'>('more');
  const [inWatchlist, setInWatchlist] = useState<boolean>(false);
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'downloaded'>('idle');

  // ─── Universal Bounds & Animation Shared Values (Reused from EditorialLightbox) ───
  const expandProgress = useSharedValue(0);
  const thumbX = useSharedValue(initialBounds?.x ?? SCREEN_WIDTH / 2 - 67);
  const thumbY = useSharedValue(initialBounds?.y ?? SCREEN_HEIGHT / 2 - 90);
  const thumbW = useSharedValue(initialBounds?.width ?? 135);
  const thumbH = useSharedValue(initialBounds?.height ?? 180);

  // Interactive Drag & Spring Physics Shared Values
  const dragTranslateX = useSharedValue(0);
  const dragTranslateY = useSharedValue(0);
  const dragScale = useSharedValue(1);
  const scrollY = useSharedValue(0);

  // Dismiss transition shared values (animates smoothly from release position into shelf card)
  const isDismissing = useSharedValue(false);
  const dismissProgress = useSharedValue(0);
  const dismissStartX = useSharedValue(0);
  const dismissStartY = useSharedValue(0);
  const dismissStartScale = useSharedValue(1);

  // Trigger smooth zoom & blur in when visible (Exact Lightbox Timing & Physics)
  useEffect(() => {
    let animTimer: any = null;
    if (visible) {
      isDismissing.value = false;
      dismissProgress.value = 0;
      dismissStartX.value = 0;
      dismissStartY.value = 0;
      dismissStartScale.value = 1;

      dragTranslateX.value = 0;
      dragTranslateY.value = 0;
      dragScale.value = 1;
      expandProgress.value = 0;

      if (initialBounds && initialBounds.width > 0) {
        thumbX.value = initialBounds.x;
        thumbY.value = initialBounds.y;
        thumbW.value = initialBounds.width;
        thumbH.value = initialBounds.height;
      } else {
        thumbX.value = SCREEN_WIDTH / 2 - 67;
        thumbY.value = SCREEN_HEIGHT / 2 - 90;
        thumbW.value = 135;
        thumbH.value = 180;
      }

      // 60-120fps smooth opening: Wait for native Modal mount & layout pass to complete before animating expansion
      animTimer = setTimeout(() => {
        requestAnimationFrame(() => {
          expandProgress.value = withSpring(1, {
            damping: 25,
            stiffness: 250,
            mass: 0.8,
          });
        });
      }, Platform.OS === 'android' ? 45 : 30);
    }

    return () => {
      clearTimeout(animTimer);
    };
  }, [
    visible,
    initialBounds,
    dragTranslateX,
    dragTranslateY,
    dragScale,
    expandProgress,
    thumbX,
    thumbY,
    thumbW,
    thumbH,
    isDismissing,
    dismissProgress,
    dismissStartX,
    dismissStartY,
    dismissStartScale,
  ]);

  // Keep active video in sync when initialVideo prop changes
  useEffect(() => {
    if (initialVideo) {
      setActiveVideo(initialVideo);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [initialVideo]);

  // Sync watchlist & like & download state when activeVideo changes
  useEffect(() => {
    if (!activeVideo) return;
    setInWatchlist(videoWatchlistManager.isInWatchlist(activeVideo));
    setIsLiked(Boolean(activeVideo.isLiked));

    const vUrl = extractCleanVideoUrl(activeVideo);
    if (vUrl && videoDownloadManager.isDownloaded(vUrl)) {
      setDownloadStatus('downloaded');
    } else {
      setDownloadStatus('idle');
    }

    const unsubWatchlist = videoWatchlistManager.subscribe(() => {
      setInWatchlist(videoWatchlistManager.isInWatchlist(activeVideo));
    });

    return () => {
      unsubWatchlist();
    };
  }, [activeVideo]);

  const videoUrl = useMemo(() => extractCleanVideoUrl(activeVideo), [activeVideo]);
  const thumbUrl = useMemo(() => {
    return (activeVideo ? getValidImageThumbnail(activeVideo) : undefined) || coverUrl;
  }, [activeVideo, coverUrl]);
  const isComingSoon = isVideoComingSoon(activeVideo);
  const title = formatDisplayTitle(activeVideo);
  const duration = formatDuration(activeVideo?.duration);

  // Watch Progress
  const watchProgress: WatchProgress | null = useMemo(() => {
    return activeVideo ? videoWatchProgressManager.getProgress(activeVideo) : null;
  }, [activeVideo]);

  const hasProgress = Boolean(watchProgress && !watchProgress.isCompleted && watchProgress.currentTime > 0);
  const resumeTimeSec = hasProgress ? watchProgress?.currentTime : undefined;

  // Shelf Rank or Category Tag
  const categoryTag = useMemo(() => {
    if (!activeVideo) return 'THE DIRECTORS’ CUT';
    const cat = (activeVideo.cinemaCategory || activeVideo.category || '').toUpperCase();
    if (cat.includes('STAGE') || cat.includes('SPOTLIGHT') || cat.includes('DANCE')) return '#2 in Stage & Spotlight';
    if (cat.includes('CANDID') || cat.includes('REEL')) return '#1 in Candid Diaries';
    if (cat.includes('EXTENDED') || cat.includes('CHAPTER')) return '#3 in The Extended Cuts';
    return '#1 in The Directors’ Cut';
  }, [activeVideo]);

  // Year & Metadata Tags
  const releaseYear = useMemo(() => {
    const rawYear = activeVideo?.year || activeVideo?.exif?.year || activeVideo?.createdAt || activeVideo?.uploadDate;
    if (rawYear) {
      const parsed = new Date(rawYear);
      if (!isNaN(parsed.getFullYear())) return String(parsed.getFullYear());
    }
    return '2026';
  }, [activeVideo]);

  // Synopsis Story Text
  const synopsis = useMemo(() => {
    if (activeVideo?.description) return activeVideo.description;
    if (activeVideo?.exif?.description) return activeVideo.exif.description;
    return 'The celebration comes alive through every glance, laughter, and timeless vow. A cinematic heirloom crafted with pure emotion.';
  }, [activeVideo]);

  // More Like This list (exclude active video)
  const moreLikeThisVideos = useMemo(() => {
    if (!allVideos || allVideos.length === 0) return [];
    return allVideos
      .filter((v) => {
        const aKey = activeVideo?.id || activeVideo?.videoUrl || activeVideo?.uri;
        const vKey = v.id || v.videoUrl || v.uri;
        return aKey !== vKey;
      })
      .slice(0, 9);
  }, [allVideos, activeVideo]);

  // Animated Dismiss Handler: turns page into poster and closes directly into original shelf card
  // Animated Dismiss Handler: collapses back into original shelf card (Exact Lightbox Timing & Physics)
  // Animated Dismiss Handler: collapses back into original shelf card (Exact Apple Lightbox Physics)
  const handleDismiss = useCallback(() => {
    if (isDismissing.value) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    dismissStartX.value = dragTranslateX.value;
    dismissStartY.value = dragTranslateY.value;
    dismissStartScale.value = dragScale.value;
    isDismissing.value = true;
    dismissProgress.value = 0;

    const closingDuration = 380;
    dismissProgress.value = withTiming(
      1,
      {
        duration: closingDuration,
        easing: Easing.bezier(0.25, 1, 0.5, 1),
      },
      (finished) => {
        'worklet';
        if (finished) {
          runOnJS(onClose)();
        }
      }
    );
  }, [
    onClose,
    isDismissing,
    dismissProgress,
    dismissStartX,
    dismissStartY,
    dismissStartScale,
    dragTranslateX,
    dragTranslateY,
    dragScale,
  ]);

  // Interactive Swipe-Down-To-Dismiss Pan Gesture on the Unified Sheet
  // Finger-tracked 1:1 motion without compounding origin acceleration!
  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .activeOffsetY(12)
    .failOffsetY(-10)
    .failOffsetX([-25, 25])
    .onUpdate((e) => {
      'worklet';
      if (isDismissing.value) return;
      if (scrollY.value <= 1 && e.translationY > 0 && e.translationY > Math.abs(e.translationX)) {
        dragTranslateY.value = e.translationY;
        dragTranslateX.value = e.translationX * 0.2;
        const progress = Math.min(e.translationY / 400, 1);
        dragScale.value = 1 - progress * 0.18;
      } else if (e.translationY <= 0) {
        dragTranslateY.value = 0;
        dragTranslateX.value = 0;
        dragScale.value = 1;
      }
    })
    .onEnd((e) => {
      'worklet';
      if (isDismissing.value) return;
      if (dragTranslateY.value === 0) return;

      // Continuous downward motion requirement from AppleGestureEngine:
      const hasContinuousDownwardMotion = e.velocityY > 250 && e.velocityY > Math.abs(e.velocityX) * 1.2;
      const isContinuousDownwardFlick = e.translationY > 50 && e.velocityY > 650 && e.velocityY > Math.abs(e.velocityX) * 1.3;
      const isContinuousDownwardDrag = e.translationY > 150 && hasContinuousDownwardMotion;

      if (isContinuousDownwardFlick || isContinuousDownwardDrag) {
        dismissStartX.value = dragTranslateX.value;
        dismissStartY.value = dragTranslateY.value;
        dismissStartScale.value = dragScale.value;
        isDismissing.value = true;
        dismissProgress.value = 0;

        const closingDuration = 380;
        dismissProgress.value = withTiming(
          1,
          {
            duration: closingDuration,
            easing: Easing.bezier(0.25, 1, 0.5, 1),
          },
          (finished) => {
            'worklet';
            if (finished) {
              runOnJS(onClose)();
            }
          }
        );
      } else {
        // User stopped finger before releasing, or partial drag:
        // Snap back NATURALLY using Apple Lightbox spring physics (damping: 20, mass: 1, stiffness: 150)
        dragTranslateX.value = withSpring(0, { damping: 20, mass: 1, stiffness: 150 });
        dragTranslateY.value = withSpring(0, { damping: 20, mass: 1, stiffness: 150 });
        dragScale.value = withSpring(1, { damping: 20, mass: 1, stiffness: 150 });
      }
    });

  // Animated Styles (Tactile Apple-Grade Physics matching EditorialLightbox)
  const backdropAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    if (isDismissing.value) {
      const dp = dismissProgress.value;
      const initialDim = 1 - Math.min(dismissStartY.value / 400, 1) * 0.7;
      return {
        opacity: Math.max(0, (1 - dp) * initialDim),
      };
    }
    const p = expandProgress.value;
    const dragDim = 1 - Math.min(dragTranslateY.value / 400, 1) * 0.7;
    return {
      opacity: p * dragDim,
    };
  });

  // Unified Modal Sheet Animated Style (Video + Details move, scale, and spring together as ONE joined object)
  const sheetAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    const cx_thumb = thumbX.value + thumbW.value / 2;
    const cy_thumb = thumbY.value + thumbH.value / 2;
    const sheetHeight = SCREEN_HEIGHT - topOffset;
    const cy_sheet = topOffset + sheetHeight / 2;
    const aspect = thumbH.value / Math.max(thumbW.value, 1);
    const posterH = SCREEN_WIDTH * aspect;
    const dy_poster = (posterH - sheetHeight) / 2;

    const initialScale = Math.max(thumbW.value / SCREEN_WIDTH, 0.12);

    // Exact target translation aligning POSTER center with thumbnail center at initialScale
    const targetTx = cx_thumb - SCREEN_WIDTH / 2;
    const targetTy = cy_thumb - (cy_sheet + dy_poster * initialScale);

    if (isDismissing.value) {
      const dp = dismissProgress.value;

      const translateX = dismissStartX.value + (targetTx - dismissStartX.value) * dp;
      const translateY = dismissStartY.value + (targetTy - dismissStartY.value) * dp;
      const scale = dismissStartScale.value + (initialScale - dismissStartScale.value) * dp;

      const topRadius = (1 - dp) * 16 + dp * 6;
      const bottomRadius = dp * 6;

      return {
        transform: [
          { translateX },
          { translateY },
          { scale },
        ],
        borderTopLeftRadius: topRadius,
        borderTopRightRadius: topRadius,
        borderBottomLeftRadius: bottomRadius,
        borderBottomRightRadius: bottomRadius,
        backgroundColor: `rgba(0, 0, 0, ${Math.max(0, 1 - dp * 3)})`,
        overflow: 'hidden',
        opacity: dp >= 0.98 ? 1 - (dp - 0.98) / 0.02 : 1,
      };
    }

    const p = expandProgress.value;
    const baseScale = initialScale + (1 - initialScale) * p;
    const finalScale = baseScale * dragScale.value;

    // Center-offset-aware translation during expansion:
    // At p = 0: currentIdealTy aligns poster center with cy_thumb
    // At p = 1: currentIdealTy is 0 (sheet top at topOffset)
    const currentIdealTy = cy_thumb - (cy_sheet + dy_poster * baseScale);
    const expandTx = targetTx * (1 - p);
    const expandTy = currentIdealTy * (1 - p);

    const translateX = expandTx + dragTranslateX.value;
    const translateY = expandTy + dragTranslateY.value;

    // Corner curves: card has 6pt all around; fully open modal sheet has 16pt top curves
    const topRadius = (1 - p) * 6 + p * 16;
    const bottomRadius = (1 - p) * 6;

    return {
      transform: [
        { translateX },
        { translateY },
        { scale: finalScale },
      ],
      borderTopLeftRadius: topRadius,
      borderTopRightRadius: topRadius,
      borderBottomLeftRadius: bottomRadius,
      borderBottomRightRadius: bottomRadius,
      backgroundColor: '#000000',
      overflow: 'hidden',
      opacity: p > 0.001 ? 1 : 0,
    };
  });

  // Full-Page Poster Cover Animated Style:
  // Converts the ENTIRE unified sheet (video + text) into the clean poster thumbnail.
  // The cross-fade from live page to poster occurs ONLY once the user is done with the slide-down gesture!
  const fullPagePosterAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    const aspect = thumbH.value / Math.max(thumbW.value, 1);
    const posterH = SCREEN_WIDTH * aspect;

    if (isDismissing.value) {
      const dp = dismissProgress.value;
      // Cross-fade happens now that the user is done with the slide down gesture:
      // Page smoothly cross-fades into poster over the first 30% of dismissal (dp: 0 -> 0.3)
      const posterOpacity = Math.min(dp * 3.3, 1);
      return {
        height: posterH,
        opacity: posterOpacity,
        borderTopLeftRadius: (1 - dp) * 16 + dp * 6,
        borderTopRightRadius: (1 - dp) * 16 + dp * 6,
        borderBottomLeftRadius: dp * 6,
        borderBottomRightRadius: dp * 6,
      };
    }

    const p = expandProgress.value;
    if (p < 0.99) {
      // Opening phase: smoothly dissolve poster into live video and details
      const openPosterOpacity = 1 - interpolate(p, [0, 0.45], [0, 1]);
      return {
        height: posterH,
        opacity: openPosterOpacity,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderBottomLeftRadius: (1 - p) * 6,
        borderBottomRightRadius: (1 - p) * 6,
      };
    }

    // While user is sliding down: KEEP LIVE PAGE 100% VISIBLE!
    // No premature cross-fade during the swipe gesture.
    return {
      height: posterH,
      opacity: 0,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    };
  });

  const contentFadeAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    if (isDismissing.value) {
      const dp = dismissProgress.value;
      // Mirror cross-fade: page fades out as poster fades in
      return {
        opacity: Math.max(0, 1 - dp * 3.3),
      };
    }
    const p = expandProgress.value;
    // Keep page 100% visible while user is sliding down!
    const opacity = interpolate(p, [0.35, 0.95], [0, 1]);
    return {
      opacity,
    };
  });

  const controlsFadeAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    if (isDismissing.value) {
      const dp = dismissProgress.value;
      return {
        opacity: Math.max(0, 1 - dp * 4),
      };
    }
    const dragProgress = Math.min(dragTranslateY.value / 120, 1);
    const p = expandProgress.value;
    const opacity = interpolate(p, [0.85, 1], [0, 1]) * (1 - dragProgress * 0.4);
    return {
      opacity,
    };
  });

  // Handlers
  const handlePlay = () => {
    if (!activeVideo) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onClose();
    onPlayVideo(activeVideo, resumeTimeSec);
  };

  const handleDownload = async () => {
    if (!videoUrl) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (downloadStatus === 'downloaded') {
      return;
    }
    setDownloadStatus('downloading');
    videoDownloadManager.queue(videoUrl);
    setTimeout(() => {
      setDownloadStatus('downloaded');
    }, 1800);
  };

  const handleToggleWatchlist = async () => {
    if (!activeVideo) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await videoWatchlistManager.toggleWatchlist(activeVideo);
  };

  const handleToggleRate = () => {
    if (!activeVideo) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setIsLiked((prev) => !prev);
    if (onToggleLike) {
      onToggleLike(activeVideo);
    }
  };

  const handleShare = async () => {
    if (!activeVideo) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await Share.share({
        message: `Watch "${title}" from ${eventTitle || 'the wedding celebration'} on MyCircle Cinema!`,
        url: videoUrl || undefined,
      });
    } catch {}
  };

  const handleSelectMoreVideo = (item: CinemaVideoItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setActiveVideo(item);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  if (!visible || !activeVideo) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={true}
      presentationStyle="overFullScreen"
      statusBarTranslucent={true}
      onRequestClose={handleDismiss}
    >
      <GestureHandlerRootView style={styles.modalRoot}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        {/* ── 0. Solid Black Cinema Backdrop (Zero Blur) ── */}
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: '#000000' },
            backdropAnimatedStyle,
          ]}
        />

        {/* Top safe-area spacer below status bar notch (Solid Black, not blurred) */}
        <Animated.View
          style={[{ height: topOffset, backgroundColor: '#000000' }, backdropAnimatedStyle]}
          pointerEvents="none"
        />

        {/* ── 1. UNIFIED MODAL SHEET (Video + Details joined as 1 single physical element) ── */}
        <GestureDetector gesture={panGesture}>
          <Animated.View style={[styles.unifiedSheet, sheetAnimatedStyle]}>
            {/* Top Video Header */}
            <View style={[styles.previewContainer, { height: videoHeight }]}>
              {videoUrl && !isComingSoon ? (
                <DetailHeroPlayer
                  key={videoUrl}
                  videoUrl={videoUrl}
                  thumbnailUrl={thumbUrl}
                  videoTitle={title}
                  onClose={handleDismiss}
                  height={videoHeight}
                  translateY={dragTranslateY}
                  isDismissing={isDismissing}
                  dismissProgress={dismissProgress}
                />
              ) : (
                <View style={[styles.previewContainer, { height: '100%' }]}>
                  {thumbUrl ? (
                    <Image
                      source={{ uri: thumbUrl }}
                      style={[StyleSheet.absoluteFillObject, styles.videoCanvasRadius]}
                      contentFit="cover"
                      priority="high"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={[StyleSheet.absoluteFillObject, styles.fallbackBg, styles.videoCanvasRadius]} />
                  )}

                  {/* Controls Overlay: Scrim, Cast, Close, Coming Soon Badge */}
                  <Animated.View style={[StyleSheet.absoluteFillObject, controlsFadeAnimatedStyle]} pointerEvents="box-none">
                    <LinearGradient
                      colors={['rgba(0,0,0,0.65)', 'transparent', '#000000']}
                      locations={[0, 0.45, 1]}
                      style={StyleSheet.absoluteFillObject}
                      pointerEvents="none"
                    />

                    {/* Top Right Controls Overlay: Cast Button + Close Button */}
                    <View style={styles.previewTopRightRow} pointerEvents="box-none">
                      <ScreenCastButton
                        size={20}
                        color="#FFFFFF"
                        activeColor="#E5C483"
                        videoTitle={title}
                      />
                      <Pressable
                        onPress={handleDismiss}
                        hitSlop={14}
                        style={({ pressed }) => [
                          styles.previewCircleBtn,
                          pressed && styles.btnPressed,
                        ]}
                      >
                        <Ionicons name="close" size={18} color="#FFFFFF" />
                      </Pressable>
                    </View>

                    {/* Centered Coming Soon Badge */}
                    {isComingSoon && (
                      <View style={styles.comingSoonCenterBadge}>
                        <Text style={styles.comingSoonCenterText}>✨ PREMIERE COMING SOON</Text>
                      </View>
                    )}
                  </Animated.View>
                </View>
              )}
            </View>

            {/* Scrollable Detail Section (Directly attached to video inside unified sheet) */}
            <Animated.View style={[{ flex: 1 }, contentFadeAnimatedStyle]}>
              <ScrollView
                ref={scrollRef}
                style={styles.scrollContent}
                contentContainerStyle={[
                  styles.scrollInner,
                  { paddingBottom: Math.max(insets.bottom + 36, 52) },
                ]}
                showsVerticalScrollIndicator={false}
                bounces={false}
                scrollEventThrottle={16}
                onScroll={(e) => {
                  scrollY.value = e.nativeEvent.contentOffset.y;
                }}
              >
                {/* Main Title */}
                <Text style={styles.filmTitle}>{title}</Text>

            {/* Metadata Row: 2026 | U/A 13+ | 2h 21m | HD | Spatial Audio */}
            <View style={styles.metadataRow}>
              <Text style={styles.metaYearText}>{releaseYear}</Text>

              {/* Age Rating Chip */}
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>U/A 13+</Text>
              </View>

              {/* Duration */}
              <Text style={styles.metaDurationText}>{duration}</Text>

              {/* HD / 4K Chip */}
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>4K</Text>
              </View>

              {/* Spatial Audio Badge */}
              <View style={styles.spatialAudioBadge}>
                <MaterialCommunityIcons name="surround-sound" size={15} color="rgba(255,255,255,0.85)" />
                <Text style={styles.spatialAudioText}>Spatial Audio</Text>
              </View>
            </View>

            {/* Ranking / Category Badge: [TOP 10] #1 in The Directors' Cut */}
            <View style={styles.rankingBadgeRow}>
              <View style={styles.top10Badge}>
                <Text style={styles.top10Text}>TOP</Text>
                <Text style={styles.top10Number}>10</Text>
              </View>
              <Text style={styles.rankingText}>{categoryTag}</Text>
            </View>

            {/* Primary CTA: [ ▶ Play / Resume ] */}
            {isComingSoon ? (
              <View style={styles.comingSoonBannerBtn}>
                <Text style={styles.comingSoonBannerText}>✨ Premiere in Post-Production</Text>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.primaryPlayBtn,
                  pressed && styles.btnPressed,
                ]}
                onPress={handlePlay}
              >
                <Ionicons name="play" size={20} color="#000000" />
                <Text style={styles.primaryPlayBtnText}>
                  {hasProgress ? `Resume (${formatDuration(resumeTimeSec)})` : 'Play'}
                </Text>
              </Pressable>
            )}

            {/* Red Progress Bar if in progress */}
            {hasProgress && watchProgress && (
              <View style={styles.inProgressContainer}>
                <View style={styles.inProgressBarTrack}>
                  <View
                    style={[
                      styles.inProgressBarFill,
                      { width: `${Math.round(watchProgress.progressPercent * 100)}%` },
                    ]}
                  />
                </View>
              </View>
            )}

            {/* Secondary CTA: [ 📥 Download ] */}
            {!isComingSoon && (
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryDownloadBtn,
                  downloadStatus === 'downloaded' && styles.downloadedBtnBg,
                  pressed && styles.btnPressed,
                ]}
                onPress={handleDownload}
              >
                {downloadStatus === 'downloading' ? (
                  <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 6 }} />
                ) : (
                  <Feather
                    name={downloadStatus === 'downloaded' ? 'check' : 'download'}
                    size={18}
                    color="#FFFFFF"
                  />
                )}
                <Text style={styles.secondaryDownloadText}>
                  {downloadStatus === 'downloaded'
                    ? 'Downloaded'
                    : downloadStatus === 'downloading'
                    ? 'Downloading...'
                    : 'Download'}
                </Text>
              </Pressable>
            )}

            {/* Story Synopsis */}
            <Text style={styles.synopsisText}>{synopsis}</Text>

            {/* Credits Metadata */}
            <View style={styles.creditsContainer}>
              <Text style={styles.creditLine}>
                <Text style={styles.creditLabel}>Filmed by: </Text>
                <Text style={styles.creditValue}>Misty Visuals Cinema</Text>
              </Text>
              <Text style={styles.creditLine}>
                <Text style={styles.creditLabel}>Starring: </Text>
                <Text style={styles.creditValue}>{eventTitle || 'The Couple & Family'}</Text>
              </Text>
              <Text style={styles.creditLine}>
                <Text style={styles.creditLabel}>Mastered in: </Text>
                <Text style={styles.creditValue}>4K Ultra HD • Color Graded • Stereo Spatial</Text>
              </Text>
            </View>

            {/* Action Row: [+ My List] [👍 Rate] [↗ Share] */}
            <View style={styles.actionRow}>
              {/* 1. My List / Watchlist */}
              <Pressable
                style={({ pressed }) => [
                  styles.actionItem,
                  pressed && styles.btnPressed,
                ]}
                onPress={handleToggleWatchlist}
              >
                <Ionicons
                  name={inWatchlist ? 'checkmark' : 'add'}
                  size={26}
                  color={inWatchlist ? '#E5C483' : '#FFFFFF'}
                />
                <Text style={[styles.actionLabel, inWatchlist && styles.actionLabelActive]}>
                  {inWatchlist ? 'My List' : 'My List'}
                </Text>
              </Pressable>

              {/* 2. Rate / Like */}
              <Pressable
                style={({ pressed }) => [
                  styles.actionItem,
                  pressed && styles.btnPressed,
                ]}
                onPress={handleToggleRate}
              >
                <Ionicons
                  name={isLiked ? 'thumbs-up' : 'thumbs-up-outline'}
                  size={23}
                  color={isLiked ? '#E50914' : '#FFFFFF'}
                />
                <Text style={[styles.actionLabel, isLiked && styles.actionLabelLiked]}>
                  {isLiked ? 'Rated' : 'Rate'}
                </Text>
              </Pressable>

              {/* 3. Share */}
              <Pressable
                style={({ pressed }) => [
                  styles.actionItem,
                  pressed && styles.btnPressed,
                ]}
                onPress={handleShare}
              >
                <Feather name="send" size={21} color="#FFFFFF" />
                <Text style={styles.actionLabel}>Share</Text>
              </Pressable>
            </View>

            {/* Divider Line */}
            <View style={styles.tabsDivider} />

            {/* Tabs: [More Like This] [Trailers & More] */}
            <View style={styles.tabsRow}>
              <Pressable
                style={styles.tabButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setActiveTab('more');
                }}
              >
                <Text
                  style={[
                    styles.tabButtonText,
                    activeTab === 'more' && styles.tabButtonTextActive,
                  ]}
                >
                  More Like This
                </Text>
                {activeTab === 'more' && <View style={styles.tabIndicatorActive} />}
              </Pressable>

              <Pressable
                style={styles.tabButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setActiveTab('trailers');
                }}
              >
                <Text
                  style={[
                    styles.tabButtonText,
                    activeTab === 'trailers' && styles.tabButtonTextActive,
                  ]}
                >
                  Trailers & More
                </Text>
                {activeTab === 'trailers' && <View style={styles.tabIndicatorActive} />}
              </Pressable>
            </View>

            {/* 3-Column Poster Grid for "More Like This" */}
            {activeTab === 'more' ? (
              <View style={styles.recommendationsGrid}>
                {moreLikeThisVideos.length > 0 ? (
                  moreLikeThisVideos.map((item, idx) => {
                    const itemThumb = getValidImageThumbnail(item);
                    const itemDuration = formatDuration(item.duration);
                    const itemTitle = formatDisplayTitle(item);
                    const itemComingSoon = isVideoComingSoon(item);

                    return (
                      <Pressable
                        key={String(item.id || item.videoUrl || item.uri || idx)}
                        style={({ pressed }) => [
                          styles.recCard,
                          pressed && styles.btnPressed,
                        ]}
                        onPress={() => handleSelectMoreVideo(item)}
                      >
                        {itemThumb ? (
                          <Image
                            source={{ uri: itemThumb }}
                            style={styles.recCardImage}
                            contentFit="cover"
                            priority="normal"
                            cachePolicy="memory-disk"
                          />
                        ) : (
                          <View style={[styles.recCardImage, styles.recCardFallback]}>
                            <Ionicons name="film-outline" size={24} color="#666" />
                          </View>
                        )}

                        {/* Subtle Bottom Vignette */}
                        <LinearGradient
                          colors={['transparent', 'rgba(0,0,0,0.85)']}
                          style={StyleSheet.absoluteFillObject}
                          pointerEvents="none"
                        />

                        {/* Badge / Duration on Poster Card */}
                        {itemComingSoon ? (
                          <View style={styles.recCardComingSoonPill}>
                            <Text style={styles.recCardComingSoonText}>SOON</Text>
                          </View>
                        ) : itemDuration ? (
                          <View style={styles.recCardDurationPill}>
                            <Text style={styles.recCardDurationText}>{itemDuration}</Text>
                          </View>
                        ) : null}

                        {/* Title at bottom of recommendation card */}
                        <View style={styles.recCardInfo}>
                          <Text style={styles.recCardTitle} numberOfLines={2}>
                            {itemTitle}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })
                ) : (
                  <View style={styles.emptyRecsContainer}>
                    <Text style={styles.emptyRecsText}>No other films in this collection yet.</Text>
                  </View>
                )}
              </View>
            ) : (
              /* "Trailers & More" Content */
              <View style={styles.trailersContainer}>
                <View style={styles.trailerItemCard}>
                  <View style={styles.trailerThumbWrapper}>
                    {thumbUrl ? (
                      <Image
                        source={{ uri: thumbUrl }}
                        style={styles.trailerThumb}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.trailerThumb, styles.fallbackBg]} />
                    )}
                    <View style={styles.trailerPlayCircle}>
                      <Ionicons name="play" size={18} color="#FFFFFF" style={{ marginLeft: 2 }} />
                    </View>
                  </View>
                  <View style={styles.trailerInfo}>
                    <Text style={styles.trailerTitle}>Official Teaser</Text>
                    <Text style={styles.trailerMeta}>1m 15s • 4K Master</Text>
                    <Text style={styles.trailerDesc} numberOfLines={2}>
                      Experience the grand highlight montage with original score.
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
            </Animated.View>

            {/* ── 2. FULL-PAGE POSTER COVER: Converts WHOLE page (video + text) into poster ── */}
            {thumbUrl ? (
              <Animated.View
                style={[
                  styles.fullPagePosterCover,
                  fullPagePosterAnimatedStyle,
                ]}
                pointerEvents="none"
              >
                <Image
                  source={{ uri: thumbUrl }}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                  priority="high"
                  cachePolicy="memory-disk"
                />
              </Animated.View>
            ) : null}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  fullPagePosterCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 60,
    overflow: 'hidden',
  },
  unifiedSheet: {
    flex: 1,
    width: SCREEN_WIDTH,
    backgroundColor: '#000000',
    zIndex: 10,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  scrollContent: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollInner: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },

  // ─── 16:9 Video Canvas ───────────────────────────────────────────────────
  previewContainer: {
    width: SCREEN_WIDTH,
    backgroundColor: '#121214',
    position: 'relative',
    overflow: 'hidden',
  },
  videoCanvasRadius: {
    overflow: 'hidden',
  },
  fallbackBg: {
    backgroundColor: '#16161a',
  },
  previewBufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPausedOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPlayGlyphBg: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTopRightRow: {
    position: 'absolute',
    top: 10,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 20,
  },
  previewBottomRightRow: {
    position: 'absolute',
    bottom: 12,
    right: 14,
    zIndex: 20,
  },
  previewCircleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(20, 20, 24, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  comingSoonCenterBadge: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: 'rgba(229, 196, 131, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(229, 196, 131, 0.45)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  comingSoonCenterText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 11,
    color: '#E5C483',
    letterSpacing: 1,
  },

  // ─── Details Section ─────────────────────────────────────────────────────
  filmTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 24,
    lineHeight: 29,
    color: '#FFFFFF',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  metaYearText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.75)',
  },
  metaChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  metaChipText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  metaDurationText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.75)',
  },
  spatialAudioBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 2,
  },
  spatialAudioText: {
    fontFamily: FONT_MONTSERRAT_MEDIUM,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.85)',
  },

  // ─── Ranking Badge: [TOP 10] #1 in The Directors' Cut ──────────────────
  rankingBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  top10Badge: {
    backgroundColor: '#E50914',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  top10Text: {
    ...Platform.select({
      ios: { fontWeight: '800' as const },
      android: { fontFamily: FONT_FUTURA_BOLD },
      default: { fontWeight: '800' as const },
    }),
    fontSize: 7.5,
    color: '#FFFFFF',
    lineHeight: 8.5,
  },
  top10Number: {
    ...Platform.select({
      ios: { fontWeight: '900' as const },
      android: { fontFamily: FONT_FUTURA_BOLD },
      default: { fontWeight: '900' as const },
    }),
    fontSize: 10,
    color: '#FFFFFF',
    lineHeight: 11,
  },
  rankingText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 13,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  // ─── Buttons: Play & Download ──────────────────────────────────────────
  primaryPlayBtn: {
    backgroundColor: '#FFFFFF',
    height: 44,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  primaryPlayBtnText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 15,
    color: '#000000',
    letterSpacing: 0.2,
  },
  inProgressContainer: {
    width: '100%',
    marginBottom: 10,
    marginTop: -4,
  },
  inProgressBarTrack: {
    width: '100%',
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  inProgressBarFill: {
    height: '100%',
    backgroundColor: '#E50914',
  },
  secondaryDownloadBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    height: 44,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  downloadedBtnBg: {
    backgroundColor: 'rgba(52, 199, 89, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(52, 199, 89, 0.4)',
  },
  secondaryDownloadText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  comingSoonBannerBtn: {
    backgroundColor: 'rgba(229, 196, 131, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(229, 196, 131, 0.35)',
    height: 44,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  comingSoonBannerText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 13.5,
    color: '#E5C483',
    letterSpacing: 0.4,
  },

  // ─── Synopsis & Credits ─────────────────────────────────────────────────
  synopsisText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12.5,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.88)',
    marginBottom: 14,
  },
  creditsContainer: {
    gap: 3,
    marginBottom: 20,
  },
  creditLine: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    lineHeight: 15,
  },
  creditLabel: {
    color: 'rgba(255, 255, 255, 0.45)',
  },
  creditValue: {
    color: 'rgba(255, 255, 255, 0.82)',
  },

  // ─── Action Row: [+ My List] [👍 Rate] [↗ Share] ─────────────────────────
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 36,
    paddingHorizontal: 8,
    marginBottom: 22,
  },
  actionItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  actionLabel: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.75)',
  },
  actionLabelActive: {
    color: '#E5C483',
  },
  actionLabelLiked: {
    color: '#E50914',
  },

  // ─── Tabs: [More Like This] [Trailers & More] ────────────────────────────
  tabsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginBottom: 14,
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginBottom: 16,
  },
  tabButton: {
    position: 'relative',
    paddingBottom: 8,
  },
  tabButtonText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 13.5,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
  },
  tabIndicatorActive: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#E50914', // Signature Netflix red active tab indicator
    borderRadius: 1.5,
  },

  // ─── 3-Column Recommendations Grid ──────────────────────────────────────
  recommendationsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: REC_CARD_MARGIN,
    marginTop: 4,
  },
  recCard: {
    width: REC_CARD_WIDTH,
    height: REC_CARD_HEIGHT,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#18181c',
    position: 'relative',
  },
  recCardImage: {
    width: '100%',
    height: '100%',
  },
  recCardFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#18181c',
  },
  recCardComingSoonPill: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(229, 196, 131, 0.9)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 3,
  },
  recCardComingSoonText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 8,
    color: '#000000',
    letterSpacing: 0.3,
  },
  recCardDurationPill: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 3,
  },
  recCardDurationText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 9,
    color: '#FFFFFF',
  },
  recCardInfo: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
  },
  recCardTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 10.5,
    lineHeight: 13,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  emptyRecsContainer: {
    paddingVertical: 30,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  emptyRecsText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.45)',
  },

  // ─── Trailers & More Tab Content ─────────────────────────────────────────
  trailersContainer: {
    marginTop: 4,
    gap: 14,
  },
  trailerItemCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    padding: 8,
  },
  trailerThumbWrapper: {
    width: 110,
    height: 65,
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  trailerThumb: {
    width: '100%',
    height: '100%',
  },
  trailerPlayCircle: {
    position: 'absolute',
    alignSelf: 'center',
    top: 18,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailerInfo: {
    flex: 1,
  },
  trailerTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 13,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  trailerMeta: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 10.5,
    color: '#E5C483',
    marginBottom: 4,
  },
  trailerDesc: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.65)',
  },

  btnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
});
