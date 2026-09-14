/**
 * HorizontalCinemaPlayer — Netflix-style full-screen cinema player
 *
 * Fixes applied vs. previous version:
 *  #2  — Backdrop fades as user drags; dismiss animates translateY + opacity together
 *  #3  — Controls auto-hide is suppressed while scrubbing or buffering/error
 *  #4  — Native fullscreen via RN Modal (presentationStyle="fullScreen") — no CSS rotation
 *  #9  — RNGH Gesture.Tap() replaces manual setTimeout double-tap discrimination
 *  #10 — LinearGradient scrim behind lower controls zone in portrait
 *  #11 — Resume toast uses formatTime() — single consistent string
 *  #12 — Top-right fullscreen button is now ✕ (close modal), not a duplicate minimize
 */
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  createRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  BackHandler,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, VideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  GestureDetector,
  GestureHandlerRootView,
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

// ── Props ─────────────────────────────────────────────────────────────────────
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

// ── Ripple flash overlay shown on double-tap seek zones ───────────────────────
function SeekZoneFlash({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <View
      style={[
        styles.seekZoneFlash,
        direction === 'back' ? styles.seekZoneLeft : styles.seekZoneRight,
      ]}
      pointerEvents="none"
    >
      <View style={styles.seekZoneBubble}>
        <Ionicons
          name={direction === 'back' ? 'play-back' : 'play-forward'}
          size={22}
          color="#FFFFFF"
        />
        <Text style={styles.seekZoneText}>
          {direction === 'back' ? '−10s' : '+10s'}
        </Text>
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════════════════════════
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // In portrait mode: narrow side = width, tall side = height
  const screenWidth = Math.min(windowWidth, windowHeight);
  const screenHeight = Math.max(windowWidth, windowHeight);
  const videoHeight = Math.round((screenWidth * 9) / 16);

  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether the scrubber is actively being dragged — suppress HUD hide
  const isScrubbing = useRef(false);

  // Restore status bar when component unmounts
  useEffect(() => {
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, []);

  // Android hardware back: exit fullscreen first
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isFullscreen) {
        setIsFullscreen(false);
        return true;
      }
      return false;
    });
    return () => backHandler.remove();
  }, [isFullscreen]);

  // ── Reanimated shared values ───────────────────────────────────────────────
  const controlsOpacity = useSharedValue(1);
  const dismissTranslateY = useSharedValue(0);
  /** 1 = fully opaque backdrop, 0 = transparent (during & after dismiss) */
  const backdropOpacity = useSharedValue(1);

  // ── Controls auto-hide ─────────────────────────────────────────────────────
  /**
   * Start (or restart) the 3s timer that fades out the HUD.
   * Never starts the timer if:
   *  - video is paused / completed
   *  - user is scrubbing
   *  - player is buffering or in error state
   */
  const resetControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsOpacity.value = withTiming(1, { duration: 180 });
    setAreControlsVisible(true);

    if (isPlaying && !isCompleted && !isBuffering && !isError) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (isScrubbing.current) return; // scrub in progress — skip
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

  // ── Scrubber callbacks for HUD suppress ───────────────────────────────────
  const handleScrubStart = useCallback(() => {
    isScrubbing.current = true;
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsOpacity.value = withTiming(1, { duration: 180 });
    setAreControlsVisible(true);
    onSeekStart();
  }, [onSeekStart, controlsOpacity]);

  const handleScrubEnd = useCallback(() => {
    isScrubbing.current = false;
    // 1.5s grace before auto-hide restarts
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying && !isCompleted && !isBuffering && !isError) {
      controlsTimeoutRef.current = setTimeout(() => {
        controlsOpacity.value = withTiming(0, { duration: 300 });
        setAreControlsVisible(false);
      }, 1500);
    }
  }, [isPlaying, isCompleted, isBuffering, isError, controlsOpacity]);

  // ── Swipe-to-dismiss gesture (portrait only) ───────────────────────────────
  const dismissGestureRef = useRef<any>(null);
  const panGesture = Gesture.Pan()
    .withRef(dismissGestureRef)
    .enabled(!isFullscreen)
    .activeOffsetY([8, Infinity]) // must move meaningfully downward to activate
    .failOffsetY([-8, Infinity]) // horizontal-first motion fails this gesture (scrubber wins)
    .onUpdate((e) => {
      'worklet';
      if (e.translationY > 0) {
        dismissTranslateY.value = e.translationY;
        // Fade backdrop as user drags — start fading after 20px drag
        const progress = Math.min(1, Math.max(0, (e.translationY - 20) / 180));
        backdropOpacity.value = 1 - progress * 0.6;
      }
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationY > 100 || e.velocityY > 500) {
        // Commit dismiss: slide down + full backdrop fade
        backdropOpacity.value = withTiming(0, { duration: 260 });
        dismissTranslateY.value = withTiming(
          screenHeight,
          { duration: 300, easing: Easing.bezier(0.25, 1, 0.5, 1) },
          (fin) => {
            if (fin) runOnJS(onClose)();
          },
        );
      } else {
        // Spring back
        dismissTranslateY.value = withSpring(0, { damping: 20, stiffness: 220 });
        backdropOpacity.value = withTiming(1, { duration: 200 });
      }
    });

  // ── RNGH Tap gestures ─────────────────────────────────────────────────────
  const handleSingleTap = useCallback(() => {
    toggleControls();
  }, [toggleControls]);

  const handleDoubleTap = useCallback(
    (x: number, canvasWidth: number) => {
      const isLeft = x < canvasWidth / 2;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onDoubleTapSeek(isLeft ? 'back' : 'forward');
      resetControlsTimer();
    },
    [onDoubleTapSeek, resetControlsTimer],
  );

  /**
   * Build tap gestures for the given canvas width.
   * Double-tap is exclusive over single-tap — RNGH natively handles the
   * discrimination without any setTimeout dead zone.
   */
  const buildTapGestures = useCallback(
    (canvasWidth: number) => {
      const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(300)
        .onEnd((e) => {
          'worklet';
          runOnJS(handleDoubleTap)(e.x, canvasWidth);
        });

      const singleTap = Gesture.Tap()
        .numberOfTaps(1)
        .requireExternalGestureToFail(doubleTap)
        .onEnd(() => {
          'worklet';
          runOnJS(handleSingleTap)();
        });

      return Gesture.Exclusive(doubleTap, singleTap);
    },
    [handleDoubleTap, handleSingleTap],
  );

  const portraitTapGesture = useMemo(
    () => buildTapGestures(screenWidth),
    [buildTapGestures, screenWidth],
  );
  const fullscreenTapGesture = useMemo(
    () => buildTapGestures(screenHeight),
    [buildTapGestures, screenHeight],
  );

  // ── Fullscreen ─────────────────────────────────────────────────────────────
  const handleFullscreenPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setIsFullscreen(true);
    resetControlsTimer();
  };

  const handleExitFullscreen = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setIsFullscreen(false);
    resetControlsTimer();
  };

  // Ensure playback continues after fullscreen toggle
  useEffect(() => {
    if (isPlaying) {
      try { player.play(); } catch {}
    }
  }, [isFullscreen]);

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

  // ── Fullscreen Modal Safe-Area ─────────────────────────────────────────────
  // In fullscreen Modal, the window rotates so windowWidth > windowHeight.
  // useWindowDimensions inside a Modal reflects the actual rotated dimensions on iOS.
  // On Android we do the same since Modal with fullscreen forces landscape.
  const fsInsets = insets;

  // ── Shared video + HUD sub-render ─────────────────────────────────────────
  const renderVideoAndHUD = (opts: {
    isFs: boolean;
    vidStyle: any;
    hudTopLeftInset: number;
    hudTopRightInset: number;
    hudBottomLeftInset: number;
    hudBottomRightInset: number;
  }) => {
    const {
      isFs,
      vidStyle,
      hudTopLeftInset,
      hudTopRightInset,
      hudBottomLeftInset,
      hudBottomRightInset,
    } = opts;

    const tapGesture = isFs ? fullscreenTapGesture : portraitTapGesture;

    return (
      <>
        {/* ── Video Surface ── */}
        <GestureDetector gesture={tapGesture}>
          <View style={vidStyle}>
            {cleanThumbnailUrl ? (
              <ExpoImage
                source={{ uri: cleanThumbnailUrl }}
                style={StyleSheet.absoluteFillObject}
                contentFit="contain"
                cachePolicy="memory-disk"
                priority="high"
              />
            ) : null}

            <VideoView
              ref={videoViewRef}
              player={player}
              style={StyleSheet.absoluteFillObject}
              contentFit="contain"
              nativeControls={false}
              surfaceType="textureView"
              fullscreenOptions={{ enable: false }}
              showsTimecodes={false}
            />

            {/* Seek zone flash overlays (always rendered, visible after double-tap) */}
            {seekRipple ? <SeekZoneFlash direction={seekRipple.direction} /> : null}

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

        {/* ── HUD Overlay ── */}
        <Animated.View
          style={[StyleSheet.absoluteFillObject, styles.hudContainer, animatedHudStyle]}
          pointerEvents={areControlsVisible ? 'box-none' : 'none'}
        >
          {/* Top bar gradient */}
          <LinearGradient
            colors={['rgba(0,0,0,0.82)', 'rgba(0,0,0,0.3)', 'transparent']}
            style={[
              styles.topBar,
              {
                paddingTop: Math.max(hudTopLeftInset + 10, 44),
                paddingLeft: isFs ? Math.max(hudTopLeftInset, 32) : 20,
                paddingRight: isFs ? Math.max(hudTopRightInset, 28) : 20,
              },
            ]}
            pointerEvents={areControlsVisible ? 'box-none' : 'none'}
          >
            {/* Left: Back / Minimize */}
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                if (isFs) {
                  handleExitFullscreen();
                } else {
                  onClose();
                }
              }}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              activeOpacity={0.7}
            >
              <Ionicons name={isFs ? 'arrow-back' : 'chevron-down'} size={20} color="#FFFFFF" />
              {isFs ? <Text style={styles.backButtonText}>CINEMA</Text> : null}
            </TouchableOpacity>

            {/* Center title (fullscreen only) */}
            {isFs ? (
              <View style={styles.fsTitleContainer}>
                <Text style={styles.fsTitleText} numberOfLines={1}>{title}</Text>
                {subtitle ? (
                  <Text style={styles.fsSubtitleText} numberOfLines={1}>{subtitle}</Text>
                ) : null}
              </View>
            ) : null}

            {/* Right buttons */}
            <View style={styles.topRightRow}>
              {/* Resumed toast */}
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
              <ScreenCastButton size={20} color="#FFFFFF" activeColor="#E5C483" videoTitle={title} />
              {/* In fullscreen: right button closes the modal entirely (✕).
                  In portrait: right button opens fullscreen. */}
              {isFs ? (
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    setIsFullscreen(false);
                    onClose();
                  }}
                  hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close" size={22} color="#FFFFFF" />
                </TouchableOpacity>
              ) : null}
            </View>
          </LinearGradient>

          {/* Center play/pause/replay — only when NOT fullscreen (fs has bottom controls) */}
          {!isFs ? (
            <View style={styles.centerControlsOverlay} pointerEvents={areControlsVisible ? 'auto' : 'none'}>
              <TouchableOpacity
                style={styles.centerPlayButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  resetControlsTimer();
                  if (isCompleted) onReplay(); else onPlayPauseToggle();
                }}
                hitSlop={16}
                activeOpacity={0.85}
              >
                {isCompleted ? (
                  <Ionicons name="reload" size={26} color="#E5C483" />
                ) : isPlaying ? (
                  <Ionicons name="pause" size={26} color="#FFFFFF" />
                ) : (
                  <Ionicons name="play" size={26} color="#FFFFFF" style={{ marginLeft: 3 }} />
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Bottom bar gradient */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
            style={[
              styles.bottomBar,
              {
                paddingBottom: Math.max(hudBottomLeftInset + 16, 32),
                paddingLeft: isFs ? Math.max(hudBottomLeftInset, 32) : 0,
                paddingRight: isFs ? Math.max(hudBottomRightInset, 28) : 0,
              },
            ]}
            pointerEvents={areControlsVisible ? 'box-none' : 'none'}
          >
            {/* Portrait title (shown above scrubber) */}
            {!isFs ? (
              <View style={styles.portraitTitleRow}>
                <Text style={styles.portraitTitleText} numberOfLines={1}>{title}</Text>
                {subtitle ? (
                  <Text style={styles.portraitSubtitleText} numberOfLines={1}>{subtitle}</Text>
                ) : null}
              </View>
            ) : null}

            {/* Scrubber */}
            <View style={styles.scrubberWrapper}>
              <CinemaScrubber
                currentTimeSec={currentTimeSec}
                durationSec={durationSec}
                bufferedSec={bufferedSec}
                onSeekStart={handleScrubStart}
                onSeek={(t) => { onSeek(t); }}
                onSeekEnd={(t) => { onSeekEnd(t); handleScrubEnd(); }}
                onScrubStart={handleScrubStart}
                onScrubEnd={handleScrubEnd}
                isControlsVisible={areControlsVisible}
                variant="horizontal"
                dismissGestureRef={dismissGestureRef}
              />
            </View>

            {/* Controls row */}
            <View style={styles.controlsRow}>
              {/* −10s */}
              <TouchableOpacity
                style={styles.seekButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  resetControlsTimer();
                  onDoubleTapSeek('back');
                }}
                hitSlop={12}
                activeOpacity={0.7}
              >
                <Ionicons name="play-back" size={18} color="#FFFFFF" />
                <Text style={styles.seekButtonText}>10s</Text>
              </TouchableOpacity>

              {/* Play / Pause / Replay — center */}
              <TouchableOpacity
                style={styles.centerPlayButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  resetControlsTimer();
                  if (isCompleted) onReplay(); else onPlayPauseToggle();
                }}
                hitSlop={16}
                activeOpacity={0.85}
              >
                {isCompleted ? (
                  <Ionicons name="reload" size={26} color="#E5C483" />
                ) : isPlaying ? (
                  <Ionicons name="pause" size={26} color="#FFFFFF" />
                ) : (
                  <Ionicons name="play" size={26} color="#FFFFFF" style={{ marginLeft: 3 }} />
                )}
              </TouchableOpacity>

              {/* +10s */}
              <TouchableOpacity
                style={styles.seekButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  resetControlsTimer();
                  onDoubleTapSeek('forward');
                }}
                hitSlop={12}
                activeOpacity={0.7}
              >
                <Text style={styles.seekButtonText}>10s</Text>
                <Ionicons name="play-forward" size={18} color="#FFFFFF" />
              </TouchableOpacity>

              {/* Fullscreen toggle (portrait only — in fullscreen this space is empty) */}
              {!isFs ? (
                <TouchableOpacity
                  style={[styles.iconButton, styles.fullscreenButtonAbs]}
                  onPress={handleFullscreenPress}
                  hitSlop={12}
                  activeOpacity={0.7}
                >
                  <Feather name="maximize" size={18} color="rgba(255,255,255,0.85)" />
                </TouchableOpacity>
              ) : null}
            </View>
          </LinearGradient>
        </Animated.View>
      </>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Animated.View style={[styles.root, animatedBackdropStyle]}>
      <StatusBar
        hidden={isFullscreen}
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />

      {/* ── Portrait mode (swipe-to-dismiss wrapper) ── */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.portraitRoot, animatedContainerStyle]}>
          {/* Video canvas */}
          <View style={[styles.videoCanvas, { width: screenWidth, height: videoHeight }]}>
            {renderVideoAndHUD({
              isFs: false,
              vidStyle: StyleSheet.absoluteFillObject,
              hudTopLeftInset: insets.top,
              hudTopRightInset: insets.top,
              hudBottomLeftInset: 0,
              hudBottomRightInset: 0,
            })}
          </View>

          {/* ── Lower half: gradient scrim + controls overlay ── */}
          {/* Fix #10: gradient scrim from video bottom into dark controls zone */}
          <LinearGradient
            colors={['#0B0B0C', '#0B0B0C']}
            style={styles.lowerZone}
            pointerEvents="none"
          />
        </Animated.View>
      </GestureDetector>

      {/* ── Native Fullscreen Modal ── */}
      <Modal
        visible={isFullscreen}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}
        onRequestClose={handleExitFullscreen}
      >
        <GestureHandlerRootView style={styles.fsRoot}>
          <StatusBar hidden barStyle="light-content" />
          <View style={styles.fsVideoContainer}>
            {renderVideoAndHUD({
              isFs: true,
              vidStyle: StyleSheet.absoluteFillObject,
              hudTopLeftInset: fsInsets.top,
              hudTopRightInset: fsInsets.right,
              hudBottomLeftInset: fsInsets.bottom,
              hudBottomRightInset: fsInsets.right,
            })}
          </View>
        </GestureHandlerRootView>
      </Modal>
    </Animated.View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  portraitRoot: {
    flex: 1,
    backgroundColor: '#0B0B0C',
  },
  videoCanvas: {
    backgroundColor: '#000000',
    overflow: 'hidden',
  },

  // ─── Lower zone (portrait) ────────────────────────────────────────────────
  lowerZone: {
    flex: 1,
  },

  // ─── HUD container ────────────────────────────────────────────────────────
  hudContainer: {
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 20,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backButtonText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 12,
    letterSpacing: 2,
    color: '#FFFFFF',
  },
  fsTitleContainer: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 12,
  },
  fsTitleText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  fsSubtitleText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
    textAlign: 'center',
  },
  topRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(25,25,28,0.75)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerControlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPlayButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(20,20,24,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    paddingTop: 20,
  },
  portraitTitleRow: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  portraitTitleText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  portraitSubtitleText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
  },
  scrubberWrapper: {
    width: '100%',
    marginBottom: 12,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    paddingHorizontal: 20,
    position: 'relative',
  },
  seekButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(30,30,34,0.75)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  seekButtonText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    color: '#FFFFFF',
  },
  fullscreenButtonAbs: {
    position: 'absolute',
    right: 20,
  },

  // ─── Resume toast ─────────────────────────────────────────────────────────
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

  // ─── Seek zone flash ──────────────────────────────────────────────────────
  seekZoneFlash: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '40%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
  },
  seekZoneLeft: {
    left: 0,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
  seekZoneRight: {
    right: 0,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
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
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11,11,12,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  errorTitle: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 16,
    color: '#FFFFFF',
    marginTop: 12,
    marginBottom: 6,
  },
  errorSubtitle: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#E5C483',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 12,
    color: '#0B0B0C',
    letterSpacing: 1.5,
  },

  // ─── Native Fullscreen Modal ──────────────────────────────────────────────
  fsRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },
  fsVideoContainer: {
    flex: 1,
    backgroundColor: '#000000',
    position: 'relative',
  },
});
