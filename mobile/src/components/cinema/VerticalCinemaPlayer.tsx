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
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, VideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  GestureDetector,
  Gesture,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import {
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';
import { CinemaScrubber } from './CinemaScrubber';
import { ScreenCastButton } from './ScreenCastButton';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
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
  const isScrubbing = useRef(false);

  // ── Reanimated shared values ───────────────────────────────────────────────
  const controlsOpacity = useSharedValue(1);
  const dismissTranslateY = useSharedValue(0);
  const backdropOpacity = useSharedValue(1);

  // ── Controls auto-hide ─────────────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsOpacity.value = withTiming(1, { duration: 180 });
    setAreControlsVisible(true);

    if (isPlaying && !isCompleted && !isBuffering && !isError) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (isScrubbing.current) return;
        controlsOpacity.value = withTiming(0, { duration: 300 });
        setAreControlsVisible(false);
      }, 3000);
    }
  }, [isPlaying, isCompleted, isBuffering, isError, controlsOpacity]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
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

  // ── Scrubber callbacks ─────────────────────────────────────────────────────
  const handleScrubStart = useCallback(() => {
    isScrubbing.current = true;
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsOpacity.value = withTiming(1, { duration: 180 });
    setAreControlsVisible(true);
    onSeekStart();
  }, [onSeekStart, controlsOpacity]);

  const handleScrubEnd = useCallback(() => {
    isScrubbing.current = false;
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying && !isCompleted && !isBuffering && !isError) {
      controlsTimeoutRef.current = setTimeout(() => {
        controlsOpacity.value = withTiming(0, { duration: 300 });
        setAreControlsVisible(false);
      }, 1500);
    }
  }, [isPlaying, isCompleted, isBuffering, isError, controlsOpacity]);

  // ── Swipe-to-dismiss gesture ───────────────────────────────────────────────
  const dismissGestureRef = useRef<any>(null);
  const panGesture = Gesture.Pan()
    .withRef(dismissGestureRef)
    .activeOffsetY([8, Infinity])
    .failOffsetY([-8, Infinity])
    .onUpdate((e) => {
      'worklet';
      if (e.translationY > 0) {
        dismissTranslateY.value = e.translationY;
        const progress = Math.min(1, Math.max(0, (e.translationY - 20) / 200));
        backdropOpacity.value = 1 - progress * 0.65;
      }
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationY > 100 || e.velocityY > 500) {
        backdropOpacity.value = withTiming(0, { duration: 270 });
        dismissTranslateY.value = withTiming(
          SCREEN_HEIGHT,
          { duration: 310, easing: Easing.bezier(0.25, 1, 0.5, 1) },
          (fin) => {
            if (fin) runOnJS(onClose)();
          },
        );
      } else {
        dismissTranslateY.value = withSpring(0, { damping: 20, stiffness: 220 });
        backdropOpacity.value = withTiming(1, { duration: 200 });
      }
    });

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
      .onEnd((e) => {
        'worklet';
        runOnJS(handleDoubleTap)(e.x);
      });

    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .requireExternalGestureToFail(doubleTap)
      .onEnd(() => {
        'worklet';
        runOnJS(handleSingleTap)();
      });

    return Gesture.Exclusive(doubleTap, singleTap);
  }, [handleDoubleTap, handleSingleTap]);

  // ── Animated styles ────────────────────────────────────────────────────────
  const animatedContainerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissTranslateY.value }],
  }));

  const animatedBackdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const animatedHudStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Animated.View style={[styles.backdrop, animatedBackdropStyle]}>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.root, animatedContainerStyle]}>

          {/* ── Full-height video touch area ── */}
          <GestureDetector gesture={tapGestures}>
            <View style={StyleSheet.absoluteFillObject}>
              {/* Background poster */}
              {cleanThumbnailUrl ? (
                <ExpoImage
                  source={{ uri: cleanThumbnailUrl }}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  priority="high"
                />
              ) : null}

              {/* Native VideoView */}
              <VideoView
                ref={videoViewRef}
                player={player}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                nativeControls={false}
                fullscreenOptions={{ enable: false }}
                showsTimecodes={false}
              />

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

          {/* ── Top Bar ── */}
          <Animated.View
            style={[
              styles.topBar,
              { paddingTop: Math.max(insets.top + 6, 36) },
              animatedHudStyle,
            ]}
            pointerEvents={areControlsVisible ? 'auto' : 'none'}
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
              <Ionicons name="chevron-down" size={22} color="#FFFFFF" />
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
                size={20}
                color="#FFFFFF"
                activeColor="#E5C483"
                videoTitle={title}
              />
            </View>
          </Animated.View>

          {/* ── Center Play / Pause / Replay ── */}
          <Animated.View
            style={[styles.centerControlsOverlay, animatedHudStyle]}
            pointerEvents={areControlsVisible ? 'auto' : 'none'}
          >
            <TouchableOpacity
              style={styles.centerPlayButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                resetControlsTimer();
                if (isCompleted) onReplay(); else onPlayPauseToggle();
              }}
              hitSlop={20}
              activeOpacity={0.85}
            >
              {isCompleted ? (
                <Ionicons name="reload" size={28} color="#E5C483" />
              ) : isPlaying ? (
                <Ionicons name="pause" size={28} color="#FFFFFF" />
              ) : (
                <Ionicons name="play" size={28} color="#FFFFFF" style={{ marginLeft: 3 }} />
              )}
            </TouchableOpacity>
          </Animated.View>

          {/* ── Bottom Section: title + scrubber ── */}
          <View style={styles.bottomContainer} pointerEvents="box-none">
            <LinearGradient
              colors={['transparent', 'rgba(11,11,12,0.65)', 'rgba(11,11,12,0.96)']}
              locations={[0, 0.4, 1]}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />

            <Animated.View
              style={[
                styles.bottomInfoRow,
                { paddingBottom: Math.max(insets.bottom + 8, 16) },
                animatedHudStyle,
              ]}
              pointerEvents={areControlsVisible ? 'auto' : 'none'}
            >
              <View style={styles.titleWrapper}>
                <Text style={styles.reelTitleText} numberOfLines={1}>{title}</Text>
                {subtitle ? (
                  <Text style={styles.reelSubtitleText} numberOfLines={1}>{subtitle}</Text>
                ) : null}
              </View>
            </Animated.View>

            {/* Flush scrubber at the very bottom — thumb + time bubble now visible */}
            <CinemaScrubber
              currentTimeSec={currentTimeSec}
              durationSec={durationSec}
              bufferedSec={bufferedSec}
              onSeekStart={handleScrubStart}
              onSeek={onSeek}
              onSeekEnd={(t) => { onSeekEnd(t); handleScrubEnd(); }}
              onScrubStart={handleScrubStart}
              onScrubEnd={handleScrubEnd}
              isControlsVisible={areControlsVisible}
              variant="vertical"
              dismissGestureRef={dismissGestureRef}
            />
          </View>

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
    backgroundColor: '#0B0B0C',
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
    gap: 10,
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
  centerPlayButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'rgba(20,20,24,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
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
    // Taller than needed so time bubble from scrubber can float upward
    paddingTop: 80,
    overflow: 'visible',
  },
  bottomInfoRow: {
    paddingHorizontal: 20,
  },
  titleWrapper: {
    width: '100%',
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
});
