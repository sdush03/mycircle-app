import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Dimensions,
  ActivityIndicator,
  Animated as RNAnimated,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, VideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather } from '@expo/vector-icons';
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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// 16:9 Dimensions
const VIDEO_WIDTH = SCREEN_WIDTH;
const VIDEO_HEIGHT = Math.round((SCREEN_WIDTH * 9) / 16);

interface HorizontalCinemaPlayerProps {
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

export const HorizontalCinemaPlayer: React.FC<HorizontalCinemaPlayerProps> = ({
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
  const [areControlsVisible, setAreControlsVisible] = useState<boolean>(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reanimated values for HUD opacity and interactive swipe-to-dismiss
  const controlsOpacity = useSharedValue(1);
  const dismissTranslateY = useSharedValue(0);

  // 2.5s Auto-hide timer
  const resetControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsOpacity.value = withTiming(1, { duration: 180 });
    setAreControlsVisible(true);

    if (isPlaying && !isCompleted) {
      controlsTimeoutRef.current = setTimeout(() => {
        controlsOpacity.value = withTiming(0, { duration: 300 });
        setAreControlsVisible(false);
      }, 2500);
    }
  }, [isPlaying, isCompleted, controlsOpacity]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [resetControlsTimer]);

  const toggleControls = useCallback(() => {
    if (areControlsVisible) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsOpacity.value = withTiming(0, { duration: 200 });
      setAreControlsVisible(false);
    } else {
      resetControlsTimer();
    }
  }, [areControlsVisible, resetControlsTimer, controlsOpacity]);

  // Tap & Double-Tap gesture discrimination
  const lastTapRef = useRef<number>(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleVideoTouch = (e: any) => {
    const now = Date.now();
    const x = e.nativeEvent.locationX;
    const isLeftHalf = x < VIDEO_WIDTH / 2;

    if (now - lastTapRef.current < 300) {
      // Double tap detected!
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onDoubleTapSeek(isLeftHalf ? 'back' : 'forward');
      resetControlsTimer();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
      singleTapTimerRef.current = setTimeout(() => {
        toggleControls();
      }, 300);
    }
  };

  // Fullscreen trigger
  const handleFullscreenPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      videoViewRef.current?.enterFullscreen?.();
    } catch (e) {
      console.warn('[CINEMA FULLSCREEN ⚠️] enterFullscreen error:', e);
    }
  };

  // Interactive Swipe-down-to-dismiss gesture
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      if (e.translationY > 0) {
        dismissTranslateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationY > 120 || e.velocityY > 600) {
        dismissTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 220 }, (fin) => {
          if (fin) runOnJS(onClose)();
        });
      } else {
        dismissTranslateY.value = withSpring(0, { damping: 18, stiffness: 200 });
      }
    });

  const animatedContainerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissTranslateY.value }],
  }));

  const animatedHudStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.root, animatedContainerStyle]}>
        {/* ── 1. Top Navigation Bar (Always Accessible When HUD is On) ── */}
        <Animated.View
          style={[styles.topBar, { paddingTop: Math.max(insets.top + 6, 36) }, animatedHudStyle]}
          pointerEvents={areControlsVisible ? 'auto' : 'none'}
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onClose();
            }}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={18} color="#FFFFFF" />
            <Text style={styles.backButtonText}>CINEMA</Text>
          </TouchableOpacity>

          {/* Resumed Pill Toast */}
          {resumedToastSec !== null ? (
            <View style={styles.resumedToast}>
              <Text style={styles.resumedToastText}>
                Resumed from {Math.floor(resumedToastSec / 60)}:
                {Math.floor(resumedToastSec % 60) < 10 ? '0' : ''}
                {Math.floor(resumedToastSec % 60)}
              </Text>
              <TouchableOpacity onPress={onRestartFromBeginning} hitSlop={10}>
                <Text style={styles.restartLink}>Restart</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Animated.View>

        {/* ── 2. 16:9 Video Canvas (Positioned in Upper-Middle Optical Center) ── */}
        <View style={styles.videoCanvasWrapper}>
          <Pressable onPress={handleVideoTouch} style={styles.videoPressable}>
            {/* Background High-Res Poster Frame (0ms Render on Frame 1) */}
            {cleanThumbnailUrl ? (
              <ExpoImage
                source={{ uri: cleanThumbnailUrl }}
                style={StyleSheet.absoluteFillObject}
                contentFit="contain"
                cachePolicy="memory-disk"
                priority="high"
              />
            ) : null}

            {/* Native VideoView (with nativeControls=false for custom luxury UI) */}
            <VideoView
              ref={videoViewRef}
              player={player}
              style={StyleSheet.absoluteFillObject}
              contentFit="contain"
              nativeControls={false}
              fullscreenOptions={{ enable: true }}
              showsTimecodes={false}
            />

            {/* ±10s Double Tap Ripple Feedback */}
            {seekRipple ? (
              <View
                style={[
                  styles.seekRippleContainer,
                  seekRipple.direction === 'back' ? styles.seekRippleLeft : styles.seekRippleRight,
                ]}
                pointerEvents="none"
              >
                <View style={styles.seekRippleBubble}>
                  <Ionicons
                    name={seekRipple.direction === 'back' ? 'play-back' : 'play-forward'}
                    size={20}
                    color="#FFFFFF"
                  />
                  <Text style={styles.seekRippleText}>
                    {seekRipple.direction === 'back' ? '-10s' : '+10s'}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Buffering Indicator HUD */}
            {isBuffering && !isCompleted ? (
              <View style={styles.bufferingOverlay} pointerEvents="none">
                <View style={styles.bufferingPill}>
                  <ActivityIndicator size="small" color="#E5C483" />
                  <Text style={styles.bufferingText}>Buffering stream...</Text>
                </View>
              </View>
            ) : null}

            {/* Network Error Overlay */}
            {isError ? (
              <View style={styles.errorOverlay}>
                <Ionicons name="alert-circle-outline" size={32} color="#E5C483" />
                <Text style={styles.errorTitle}>Stream Interrupted</Text>
                <Text style={styles.errorSubtitle}>{errorMessage || 'Please check your connection.'}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => {
                    try { player.play(); } catch {}
                  }}
                >
                  <Text style={styles.retryButtonText}>RETRY</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* ── 3. Lower Half Controls Zone (Thumb-Friendly Portrait Zone) ── */}
        <Animated.View
          style={[styles.lowerControlsZone, animatedHudStyle]}
          pointerEvents={areControlsVisible ? 'auto' : 'none'}
        >
          {/* Editorial Title & Subtitle */}
          <View style={styles.titleContainer}>
            <Text style={styles.titleText} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitleText} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          {/* Timeline Scrubber */}
          <View style={styles.scrubberWrapper}>
            <CinemaScrubber
              currentTimeSec={currentTimeSec}
              durationSec={durationSec}
              bufferedSec={bufferedSec}
              onSeekStart={() => {
                resetControlsTimer();
                onSeekStart();
              }}
              onSeek={(t) => {
                resetControlsTimer();
                onSeek(t);
              }}
              onSeekEnd={(t) => {
                resetControlsTimer();
                onSeekEnd(t);
              }}
              isControlsVisible={areControlsVisible}
              variant="horizontal"
            />
          </View>

          {/* Primary Controls Row: Play/Pause/Replay & Fullscreen */}
          <View style={styles.controlsBarRow}>
            {/* Center Play / Pause / Replay Button */}
            <TouchableOpacity
              style={styles.centerPlayButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                resetControlsTimer();
                if (isCompleted) {
                  onReplay();
                } else {
                  onPlayPauseToggle();
                }
              }}
              hitSlop={15}
              activeOpacity={0.8}
            >
              {isCompleted ? (
                <Ionicons name="reload" size={24} color="#E5C483" />
              ) : isPlaying ? (
                <Ionicons name="pause" size={24} color="#FFFFFF" />
              ) : (
                <Ionicons name="play" size={24} color="#FFFFFF" style={{ marginLeft: 3 }} />
              )}
            </TouchableOpacity>

            {/* Right Fullscreen Button */}
            <TouchableOpacity
              style={styles.fullscreenButton}
              onPress={handleFullscreenPress}
              hitSlop={15}
              activeOpacity={0.7}
            >
              <Feather name="maximize" size={18} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0B0C',
    justifyContent: 'space-between',
  },

  // ─── Top Bar ──────────────────────────────────────────────────────────────
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    zIndex: 50,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  backButtonText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 12,
    letterSpacing: 2,
    color: '#FFFFFF',
  },
  resumedToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(25, 25, 28, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  resumedToastText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  restartLink: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    color: '#E5C483',
    textDecorationLine: 'underline',
  },

  // ─── 16:9 Video Canvas ────────────────────────────────────────────────────
  videoCanvasWrapper: {
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPressable: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },

  // ─── Lower Half Controls Zone (Portrait) ──────────────────────────────────
  lowerControlsZone: {
    paddingBottom: 40,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  titleContainer: {
    alignItems: 'center',
    marginBottom: 20,
    width: '100%',
  },
  titleText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  subtitleText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: '#8E8E93',
    letterSpacing: 0.5,
    marginTop: 4,
    textAlign: 'center',
  },
  scrubberWrapper: {
    width: '100%',
    marginBottom: 16,
  },
  controlsBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    position: 'relative',
  },
  centerPlayButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(30, 30, 34, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenButton: {
    position: 'absolute',
    right: 4,
    padding: 10,
  },

  // ─── Double Tap Ripple ────────────────────────────────────────────────────
  seekRippleContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '40%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekRippleLeft: {
    left: 0,
  },
  seekRippleRight: {
    right: 0,
  },
  seekRippleBubble: {
    backgroundColor: 'rgba(11, 11, 12, 0.75)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  seekRippleText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 12,
    color: '#FFFFFF',
  },

  // ─── Buffering & Error States ─────────────────────────────────────────────
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  bufferingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(11, 11, 12, 0.85)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  bufferingText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: '#E5C483',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 11, 12, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorTitle: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 15,
    color: '#FFFFFF',
    marginTop: 10,
    marginBottom: 4,
  },
  errorSubtitle: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#E5C483',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryButtonText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    color: '#0B0B0C',
    letterSpacing: 1.5,
  },
});
