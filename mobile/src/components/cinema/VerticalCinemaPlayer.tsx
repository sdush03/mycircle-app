/**
 * VerticalCinemaPlayer — Netflix-style full-screen portrait reel player
 *
 * Fixes applied vs. previous version:
 *  #2  — Backdrop fades as user drags; dismiss animates translateY + opacity
 *  #3  — Controls auto-hide suppressed while scrubbing or buffering/error
 *  #7  — Vertical scrubber now has a thumb dot (handled in CinemaScrubber)
 *  #8  — Time bubble no longer clipped (CinemaScrubber renders it outside container)
 *  #9  — RNGH Gesture.Tap replaces manual setTimeout double-tap (no dead zone)
 *  #11 — Resume toast uses formatTime() — single clean string
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, VideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  GestureDetector,
  Gesture,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import {
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';
import { ScreenCastButton } from './ScreenCastButton';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) return '00:00';
  const totalSec = Math.floor(sec);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }
  return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface VerticalCinemaPlayerProps {
  player: VideoPlayer;
  videoViewRef: React.RefObject<any>;
  cleanThumbnailUrl?: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  currentTimeSec: number;
  durationSec: number;
  bufferedSec: number;
  isPlaying: boolean;
  isBuffering: boolean;
  isCompleted: boolean;
  isError: boolean;
  errorMessage: string | null;
  onPlayPauseToggle: () => void;
  onSeekStart: () => void;
  onSeek: (targetTimeSec: number) => void;
  onSeekEnd: (targetTimeSec: number) => void;
  onReplay: () => void;
  onDoubleTapSeek: (direction: 'back' | 'forward') => void;
  seekRipple: { direction: 'back' | 'forward'; id: number } | null;
  resumedToastSec: number | null;
  onRestartFromBeginning: () => void;
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════════════════════════
export const VerticalCinemaPlayer: React.FC<VerticalCinemaPlayerProps> = ({
  player,
  videoViewRef,
  cleanThumbnailUrl,
  title,
  subtitle,
  onClose,
  currentTimeSec,
  durationSec,
  bufferedSec,
  isPlaying,
  isBuffering,
  isCompleted,
  isError,
  errorMessage,
  onPlayPauseToggle,
  onSeekStart,
  onSeek,
  onSeekEnd,
  onReplay,
  onDoubleTapSeek,
  seekRipple,
  resumedToastSec,
  onRestartFromBeginning,
}) => {
  const insets = useSafeAreaInsets();
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Scrubber state ─────────────────────────────────────────────────────────
  const isScrubbingRef = useRef(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTimeSec, setScrubTimeSec] = useState(0);
  const [activeScrubSec, setActiveScrubSec] = useState<number | null>(null);
  const scrubReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrubTimeRef = useRef(0);
  const trackWidthRef = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);

  // ── Reanimated shared values ───────────────────────────────────────────────
  const controlsOpacity = useSharedValue(1);
  const dismissTranslateY = useSharedValue(0);
  const dismissScale = useSharedValue(1);
  const dismissBorderRadius = useSharedValue(0);
  const backdropOpacity = useSharedValue(1);
  const isPinching = useSharedValue(false);
  const pinchScale = useSharedValue(1);

  // ── Controls auto-hide ─────────────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsOpacity.value = withTiming(1, { duration: 180 });
    setAreControlsVisible(true);

    if (isPlaying && !isCompleted && !isBuffering && !isError) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (isScrubbingRef.current) return;
        controlsOpacity.value = withTiming(0, { duration: 300 });
        setAreControlsVisible(false);
      }, 3000);
    }
  }, [isPlaying, isCompleted, isBuffering, isError, controlsOpacity]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (scrubReleaseTimerRef.current) clearTimeout(scrubReleaseTimerRef.current);
    };
  }, [resetControlsTimer]);

  // Keep controls visible whenever buffering or error
  useEffect(() => {
    if (isBuffering || isError) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsOpacity.value = withTiming(1, { duration: 180 });
      setAreControlsVisible(true);
    }
  }, [isBuffering, isError, controlsOpacity]);

  const toggleControls = useCallback(() => {
    if (areControlsVisible) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsOpacity.value = withTiming(0, { duration: 200 });
      setAreControlsVisible(false);
    } else {
      resetControlsTimer();
    }
  }, [areControlsVisible, resetControlsTimer, controlsOpacity]);

  // ── Zoom / Aspect Ratio mode (Default: 'cover' full-screen, pinch to toggle) ─
  const [contentFitMode, setContentFitMode] = useState<'cover' | 'contain'>('cover');
  const [zoomToast, setZoomToast] = useState<'cover' | 'contain' | null>(null);
  const zoomToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showZoomToast = useCallback((mode: 'cover' | 'contain') => {
    setContentFitMode(mode);
    setZoomToast(mode);
    if (zoomToastTimerRef.current) clearTimeout(zoomToastTimerRef.current);
    zoomToastTimerRef.current = setTimeout(() => {
      setZoomToast(null);
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (zoomToastTimerRef.current) clearTimeout(zoomToastTimerRef.current);
    };
  }, []);

  // ── Swipe-to-dismiss gesture (Apple fluid physics, zero bounce) ────────────
  const dismissGestureRef = useRef<any>(null);
  const pinchGestureRef = useRef<any>(null);

  const panGesture = useMemo(() => {
    let p = Gesture.Pan()
      .withRef(dismissGestureRef)
      .maxPointers(1)
      .activeOffsetY(14)
      .failOffsetY(-10)
      .failOffsetX([-25, 25])
      .onUpdate((e) => {
        'worklet';
        if (isPinching.value) return;
        if (e.translationY > 0) {
          dismissTranslateY.value = e.translationY;
          const progress = Math.min(1, Math.max(0, e.translationY / 360));
          dismissScale.value = 1 - progress * 0.1;
          dismissBorderRadius.value = progress * 24;
          backdropOpacity.value = 1 - progress * 0.7;
        } else {
          dismissTranslateY.value = e.translationY * 0.08;
        }
      })
      .onEnd((e) => {
        'worklet';
        if (isPinching.value) {
          dismissTranslateY.value = withTiming(0, { duration: 200 });
          return;
        }
        const isFlickDown = e.velocityY > 450 && e.velocityY > Math.abs(e.velocityX) * 1.2;
        const isDragDown = e.translationY > 90;

        if (isFlickDown || isDragDown) {
          // Apple dismiss: smooth slide off to the bottom
          backdropOpacity.value = withTiming(0, { duration: 280 });
          dismissScale.value = withTiming(0.86, { duration: 300, easing: Easing.bezier(0.25, 1, 0.5, 1) });
          dismissBorderRadius.value = withTiming(24, { duration: 300 });
          dismissTranslateY.value = withTiming(
            SCREEN_HEIGHT + 80,
            { duration: 320, easing: Easing.bezier(0.25, 1, 0.5, 1) },
            (fin) => {
              if (fin) runOnJS(onClose)();
            }
          );
        } else {
          // Apple cancel: smooth non-bouncing glide back to center
          dismissTranslateY.value = withTiming(0, {
            duration: 280,
            easing: Easing.bezier(0.25, 1, 0.5, 1),
          });
          dismissScale.value = withTiming(1, {
            duration: 280,
            easing: Easing.bezier(0.25, 1, 0.5, 1),
          });
          dismissBorderRadius.value = withTiming(0, { duration: 220 });
          backdropOpacity.value = withTiming(1, { duration: 260 });
        }
      });

    if (pinchGestureRef) {
      p = (p as any).simultaneousWithExternalGesture(pinchGestureRef) as typeof p;
    }
    return p;
  }, [onClose, isPinching, dismissTranslateY, dismissScale, dismissBorderRadius, backdropOpacity]);

  // ── Pinch to Zoom Gesture (Fluid scaling with Apple snap-back) ─────────────
  const pinchGesture = useMemo(() => {
    let g = Gesture.Pinch()
      .withRef(pinchGestureRef)
      .onStart(() => {
        'worklet';
        isPinching.value = true;
      })
      .onUpdate((e) => {
        'worklet';
        pinchScale.value = Math.max(0.65, Math.min(3.5, e.scale));
      })
      .onEnd((e) => {
        'worklet';
        isPinching.value = false;
        if (e.scale < 0.88) {
          // Pinch in: Zoom out to fit full uncropped frame
          runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
          runOnJS(showZoomToast)('contain');
        } else if (e.scale > 1.14) {
          // Pinch out: Zoom in to fill screen
          runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
          runOnJS(showZoomToast)('cover');
        }
        pinchScale.value = withTiming(1, {
          duration: 260,
          easing: Easing.bezier(0.25, 1, 0.5, 1),
        });
      })
      .onFinalize(() => {
        'worklet';
        isPinching.value = false;
        pinchScale.value = withTiming(1, {
          duration: 260,
          easing: Easing.bezier(0.25, 1, 0.5, 1),
        });
      });

    if (dismissGestureRef) {
      g = (g as any).simultaneousWithExternalGesture(dismissGestureRef) as typeof g;
    }
    return g;
  }, [isPinching, pinchScale, showZoomToast]);

  const rootGestures = useMemo(() => {
    return Gesture.Simultaneous(panGesture, pinchGesture);
  }, [panGesture, pinchGesture]);

  // ── RNGH Tap gestures ─────────────────────────────────────────────────────
  const handleSingleTap = useCallback(() => {
    toggleControls();
  }, [toggleControls]);

  const handleDoubleTap = useCallback(
    (x: number) => {
      const isLeft = x < SCREEN_WIDTH / 2;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onDoubleTapSeek(isLeft ? 'back' : 'forward');
      resetControlsTimer();
    },
    [onDoubleTapSeek, resetControlsTimer],
  );

  const tapGestures = useMemo(() => {
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(300)
      .simultaneousWithExternalGesture(dismissGestureRef)
      .onEnd((e) => {
        'worklet';
        runOnJS(handleDoubleTap)(e.x);
      });

    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .requireExternalGestureToFail(doubleTap)
      .simultaneousWithExternalGesture(dismissGestureRef)
      .onEnd(() => {
        'worklet';
        runOnJS(handleSingleTap)();
      });

    return Gesture.Exclusive(doubleTap, singleTap);
  }, [handleDoubleTap, handleSingleTap]);

  // ── RNGH Scrubber Gesture & Callbacks ──────────────────────────────────────
  const getTimeFromX = useCallback(
    (locX: number): number => {
      const w = trackWidthRef.current;
      if (w <= 0 || durationSec <= 0) return 0;
      const clampedX = Math.max(0, Math.min(w, locX));
      return (clampedX / w) * durationSec;
    },
    [durationSec]
  );

  const handleScrubBegin = useCallback(
    (x: number) => {
      if (scrubReleaseTimerRef.current) clearTimeout(scrubReleaseTimerRef.current);
      isScrubbingRef.current = true;
      setIsScrubbing(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsOpacity.value = withTiming(1, { duration: 150 });
      setAreControlsVisible(true);
      const t = getTimeFromX(x);
      lastScrubTimeRef.current = t;
      setScrubTimeSec(t);
      setActiveScrubSec(t);
      onSeekStart();
      onSeek(t);
    },
    [controlsOpacity, getTimeFromX, onSeekStart, onSeek]
  );

  const handleScrubMove = useCallback(
    (x: number) => {
      if (!isScrubbingRef.current) return;
      const t = getTimeFromX(x);
      lastScrubTimeRef.current = t;
      setScrubTimeSec(t);
      setActiveScrubSec(t);
      onSeek(t);
    },
    [getTimeFromX, onSeek]
  );

  const handleScrubEnd = useCallback(
    (x: number) => {
      isScrubbingRef.current = false;
      setIsScrubbing(false);
      const t = getTimeFromX(x);
      lastScrubTimeRef.current = t;
      setActiveScrubSec(t);
      onSeekEnd(t);
      resetControlsTimer();
      if (scrubReleaseTimerRef.current) clearTimeout(scrubReleaseTimerRef.current);
      scrubReleaseTimerRef.current = setTimeout(() => {
        setActiveScrubSec(null);
      }, 400);
    },
    [getTimeFromX, onSeekEnd, resetControlsTimer]
  );

  const handleScrubFinalize = useCallback(() => {
    if (isScrubbingRef.current) {
      isScrubbingRef.current = false;
      setIsScrubbing(false);
      const t = lastScrubTimeRef.current;
      setActiveScrubSec(t);
      onSeekEnd(t);
      resetControlsTimer();
      if (scrubReleaseTimerRef.current) clearTimeout(scrubReleaseTimerRef.current);
      scrubReleaseTimerRef.current = setTimeout(() => {
        setActiveScrubSec(null);
      }, 400);
    }
  }, [onSeekEnd, resetControlsTimer]);

  const scrubGesture = useMemo(() => {
    let g = Gesture.Pan()
      .minDistance(0)
      .maxPointers(1)
      .onBegin((e) => {
        'worklet';
        if (isPinching.value) return;
        runOnJS(handleScrubBegin)(e.x);
      })
      .onUpdate((e) => {
        'worklet';
        if (isPinching.value) return;
        runOnJS(handleScrubMove)(e.x);
      })
      .onEnd((e) => {
        'worklet';
        if (isPinching.value) return;
        runOnJS(handleScrubEnd)(e.x);
      })
      .onFinalize(() => {
        'worklet';
        runOnJS(handleScrubFinalize)();
      });

    if (dismissGestureRef) {
      g = (g as any).simultaneousWithExternalGesture(dismissGestureRef) as typeof g;
    }
    if (pinchGestureRef) {
      g = (g as any).simultaneousWithExternalGesture(pinchGestureRef) as typeof g;
    }
    return g;
  }, [handleScrubBegin, handleScrubMove, handleScrubEnd, handleScrubFinalize, isPinching]);

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTrackWidth(w);
    trackWidthRef.current = w;
  };

  // ── Progress calculations ──────────────────────────────────────────────────
  const displayTimeSec = activeScrubSec !== null ? activeScrubSec : currentTimeSec;
  const progressRatio = durationSec > 0 ? Math.min(1, Math.max(0, displayTimeSec / durationSec)) : 0;
  const bufferedRatio = durationSec > 0 ? Math.min(1, Math.max(0, bufferedSec / durationSec)) : 0;

  // ── Animated styles ────────────────────────────────────────────────────────
  const animatedContainerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: dismissTranslateY.value },
      { scale: dismissScale.value },
    ],
    borderRadius: dismissBorderRadius.value,
    overflow: 'hidden',
  }));

  const animatedBackdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const animatedHudStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  const watermarkAnimatedStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, 1 - controlsOpacity.value)),
  }));

  const animatedVideoZoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pinchScale.value }],
    backgroundColor: '#000000',
  }));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Animated.View style={[styles.backdrop, animatedBackdropStyle]}>
      <GestureDetector gesture={rootGestures}>
        <Animated.View style={[styles.root, animatedContainerStyle]}>

          {/* ── Full-height video touch area (Tap to toggle/seek) ── */}
          <GestureDetector gesture={tapGestures}>
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000000' }]}>
              <Animated.View style={[StyleSheet.absoluteFillObject, animatedVideoZoomStyle]}>
                {/* Background poster */}
                {cleanThumbnailUrl ? (
                  <ExpoImage
                    source={{ uri: cleanThumbnailUrl }}
                    style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000000' }]}
                    contentFit={contentFitMode}
                    cachePolicy="memory-disk"
                    priority="high"
                  />
                ) : null}

                {/* Native VideoView (default 'cover' full screen, pinch to toggle 'contain') */}
                <VideoView
                  ref={videoViewRef}
                  player={player}
                  style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000000' }]}
                  contentFit={contentFitMode}
                  nativeControls={false}
                  fullscreenOptions={{ enable: false }}
                  showsTimecodes={false}
                  allowsVideoFrameAnalysis={false}
                />
              </Animated.View>

              {/* Floating Zoom Toast Badge */}
              {zoomToast ? (
                <View
                  style={[
                    styles.zoomToastContainer,
                    { top: Math.max(insets.top + 58, 88) },
                  ]}
                  pointerEvents="none"
                >
                  <View style={styles.zoomToastBubble}>
                    <Ionicons
                      name={zoomToast === 'cover' ? 'expand-outline' : 'contract-outline'}
                      size={14}
                      color="#E5C483"
                    />
                    <Text style={styles.zoomToastText}>
                      {zoomToast === 'cover' ? 'Zoomed to Fill' : 'Fit to Screen'}
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* Seek zone flash indicators */}
              {seekRipple ? (
                <View
                  style={[
                    styles.seekZoneFlash,
                    seekRipple.direction === 'back' ? styles.seekZoneLeft : styles.seekZoneRight,
                  ]}
                  pointerEvents="none"
                >
                  <View style={styles.seekZoneBubble}>
                    <Ionicons
                      name={seekRipple.direction === 'back' ? 'play-back' : 'play-forward'}
                      size={22}
                      color="#FFFFFF"
                    />
                    <Text style={styles.seekZoneText}>
                      {seekRipple.direction === 'back' ? '−10s' : '+10s'}
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* Buffering */}
              {isBuffering && !isCompleted ? (
                <View style={styles.bufferingOverlay} pointerEvents="none">
                  <ActivityIndicator size="large" color="#E5C483" />
                </View>
              ) : null}

              {/* Error */}
              {isError ? (
                <View style={styles.errorOverlay}>
                  <Ionicons name="alert-circle-outline" size={36} color="#E5C483" />
                  <Text style={styles.errorTitle}>Stream Interrupted</Text>
                  <Text style={styles.errorSubtitle}>
                    {errorMessage || 'Please check your connection.'}
                  </Text>
                  <TouchableOpacity
                    style={styles.retryButton}
                    onPress={() => { try { player.play(); } catch {} }}
                  >
                    <Text style={styles.retryButtonText}>RETRY</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </GestureDetector>

          {/* ── Netflix HUD Overlay (Fades in/out on tap anywhere) ── */}
          <Animated.View
            style={[StyleSheet.absoluteFillObject, animatedHudStyle]}
            pointerEvents={areControlsVisible ? 'box-none' : 'none'}
          >
            {/* ── Top Bar ── */}
            <LinearGradient
              colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.4)', 'transparent']}
              style={[
                styles.topBar,
                { paddingTop: Math.max(insets.top + 6, 36) },
              ]}
              pointerEvents={areControlsVisible ? 'box-none' : 'none'}
            >
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  onClose();
                }}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-down" size={24} color="#FFFFFF" />
              </TouchableOpacity>

              <View style={styles.topRightRow}>
                {resumedToastSec !== null ? (
                  <View style={styles.resumedToast}>
                    <Text style={styles.resumedToastText}>
                      Resumed from {formatTime(resumedToastSec)}
                    </Text>
                    <TouchableOpacity onPress={onRestartFromBeginning} hitSlop={10}>
                      <Text style={styles.restartLink}>Restart</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                <ScreenCastButton
                  size={22}
                  color="#FFFFFF"
                  activeColor="#E5C483"
                  videoTitle={title}
                />
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    onClose();
                  }}
                  hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
                  activeOpacity={0.7}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={28} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </LinearGradient>

            {/* ── Center Play / Pause / Replay ── */}
            <View
              style={styles.centerControlsOverlay}
              pointerEvents={areControlsVisible ? 'box-none' : 'none'}
            >
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  resetControlsTimer();
                  if (isCompleted) {
                    onReplay();
                  } else {
                    onPlayPauseToggle();
                  }
                }}
                hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
                activeOpacity={0.7}
                style={styles.centerButton}
              >
                {isCompleted ? (
                  <MaterialIcons name="replay" size={62} color="#FFFFFF" />
                ) : isPlaying ? (
                  <MaterialIcons name="pause" size={68} color="#FFFFFF" />
                ) : (
                  <MaterialIcons name="play-arrow" size={72} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            </View>

            {/* ── Bottom Section: title + time + seekbar ── */}
            <LinearGradient
              colors={['transparent', 'rgba(11,11,12,0.65)', 'rgba(11,11,12,0.96)']}
              locations={[0, 0.4, 1]}
              style={[
                styles.bottomContainer,
                { paddingBottom: Math.max(insets.bottom + 8, 20) },
              ]}
              pointerEvents={areControlsVisible ? 'box-none' : 'none'}
            >
              {/* Title & Subtitle */}
              <View style={styles.titleWrapper}>
                <Text style={styles.reelTitleText} numberOfLines={1}>{title}</Text>
                {subtitle ? (
                  <Text style={styles.reelSubtitleText} numberOfLines={1}>{subtitle}</Text>
                ) : null}
              </View>

              {/* Time above seekbar on left: position / total time */}
              <View style={styles.timeRow}>
                <Text style={styles.timecodeText}>
                  {formatTime(displayTimeSec)} / {formatTime(durationSec)}
                </Text>
              </View>

              {/* Seekbar Track */}
              <View style={styles.scrubberRow}>
                <GestureDetector gesture={scrubGesture}>
                  <View
                    style={styles.trackTouchArea}
                    onLayout={handleTrackLayout}
                  >
                    {/* Background Track */}
                    <View style={styles.trackBackground}>
                      {/* Buffer Track */}
                      <View
                        style={[styles.trackBuffer, { width: `${bufferedRatio * 100}%` }]}
                      />
                      {/* Played Progress Track */}
                      <View
                        style={[styles.trackPlayed, { width: `${progressRatio * 100}%` }]}
                      />
                    </View>

                    {/* Circular Thumb */}
                    {trackWidth > 0 ? (
                      <View
                        style={[
                          styles.scrubThumb,
                          isScrubbing && styles.scrubThumbActive,
                          {
                            left: Math.max(
                              0,
                              Math.min(
                                trackWidth - (isScrubbing ? 18 : 14),
                                progressRatio * trackWidth - (isScrubbing ? 9 : 7)
                              )
                            ),
                          },
                        ]}
                        pointerEvents="none"
                      />
                    ) : null}

                    {/* Floating Time Bubble while dragging */}
                    {isScrubbing && trackWidth > 0 ? (
                      <View
                        style={[
                          styles.scrubBubble,
                          {
                            left: Math.max(
                              0,
                              Math.min(trackWidth - 54, progressRatio * trackWidth - 27)
                            ),
                          },
                        ]}
                        pointerEvents="none"
                      >
                        <Text style={styles.scrubBubbleText}>
                          {formatTime(displayTimeSec)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </GestureDetector>
              </View>
            </LinearGradient>
          </Animated.View>

          {/* ── YouTube-style Bottom-Right Watermark Logo (visible when controls are hidden) ── */}
          <Animated.View
            style={[
              styles.watermarkContainer,
              {
                bottom: Math.max(insets.bottom + 12, 24),
                right: 20,
              },
              watermarkAnimatedStyle,
            ]}
            pointerEvents="none"
          >
            <ExpoImage
              source={require('../../../assets/images/logo-header-white.png')}
              style={styles.watermarkLogo}
              contentFit="contain"
            />
          </Animated.View>

        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000000',
  },
  root: {
    flex: 1,
    backgroundColor: '#000000',
    position: 'relative',
  },

  // ─── Top Bar ──────────────────────────────────────────────────────────────
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  topRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  closeButton: {
    padding: 4,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  resumedToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(25,25,28,0.88)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  resumedToastText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
  },
  restartLink: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    color: '#E5C483',
    textDecorationLine: 'underline',
  },

  // ─── Center Controls ──────────────────────────────────────────────────────
  centerControlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  centerButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Bottom Section ───────────────────────────────────────────────────────
  bottomContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 45,
    paddingTop: 80,
    paddingHorizontal: 20,
    overflow: 'visible',
  },
  titleWrapper: {
    width: '100%',
    marginBottom: 8,
  },
  reelTitleText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  reelSubtitleText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: '#C5A880',
    marginTop: 3,
    letterSpacing: 0.3,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: -4,
  },
  timecodeText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 12.5,
    color: 'rgba(255, 255, 255, 0.9)',
    letterSpacing: 0.5,
  },
  scrubberRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackTouchArea: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBackground: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    overflow: 'hidden',
    position: 'relative',
  },
  trackBuffer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  trackPlayed: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#E5C483',
  },
  scrubThumb: {
    position: 'absolute',
    top: '50%',
    marginTop: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#E5C483',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 2,
    elevation: 4,
  },
  scrubThumbActive: {
    top: '50%',
    marginTop: -9,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#E5C483',
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 6,
  },
  scrubBubble: {
    position: 'absolute',
    top: -30,
    backgroundColor: 'rgba(11, 11, 12, 0.92)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrubBubbleText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  // ─── Watermark ───────────────────────────────────────────────────────────
  watermarkContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 25,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.9,
    shadowRadius: 3,
  },
  watermarkLogo: {
    width: 90,
    height: 26,
  },

  // ─── Seek Zone Flash ──────────────────────────────────────────────────────
  seekZoneFlash: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '40%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  seekZoneLeft: {
    left: 0,
  },
  seekZoneRight: {
    right: 0,
  },
  seekZoneBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(11,11,12,0.72)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  seekZoneText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 13,
    color: '#FFFFFF',
  },

  // ─── Buffering / Error ────────────────────────────────────────────────────
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
    zIndex: 30,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11,11,12,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 60,
  },
  errorTitle: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 15,
    color: '#FFFFFF',
    marginTop: 12,
    marginBottom: 6,
  },
  errorSubtitle: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginBottom: 18,
  },
  retryButton: {
    backgroundColor: '#E5C483',
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 8,
  },
  retryButtonText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    color: '#0B0B0C',
    letterSpacing: 1.5,
  },

  // ─── Floating Zoom Toast ──────────────────────────────────────────────────
  zoomToastContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 60,
  },
  zoomToastBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(11, 11, 12, 0.85)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  zoomToastText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 12,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});
