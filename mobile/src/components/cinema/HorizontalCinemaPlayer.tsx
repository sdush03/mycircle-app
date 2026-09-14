/**
 * HorizontalCinemaPlayer — Netflix-style compulsory rotated landscape player
 *
 * Matches the official Netflix Mobile UI:
 *  - Compulsorily rotated 90 degrees into landscape when phone is held in portrait.
 *  - Automatically adapts to native landscape if phone is physically turned.
 *  - Red "N" brand badge + title top-left.
 *  - Cast + pure white X close button top-right (no circle borders).
 *  - Clean center controls: replay-10, large borderless pause/play, forward-10.
 *  - Netflix Red (#E50914) scrubber bar spanning the bottom with remaining time on the right.
 *  - No clip, speed, or subtitle clutter.
 */
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  BackHandler,
  StatusBar,
  useWindowDimensions,
  PanResponder,
  LayoutChangeEvent,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, VideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';
import { ScreenCastButton } from './ScreenCastButton';

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function formatRemaining(currentSec: number, durationSec: number): string {
  if (isNaN(currentSec) || isNaN(durationSec) || durationSec <= 0) return '0:00';
  const remaining = Math.max(0, Math.floor(durationSec - currentSec));
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = Math.floor(remaining % 60);

  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m}:${s < 10 ? '0' : ''}${s}`;
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

  // Screen dimensions
  const isPhysicalLandscape = windowWidth > windowHeight;
  const screenWidth = Math.min(windowWidth, windowHeight);
  const screenHeight = Math.max(windowWidth, windowHeight);

  // Landscape player dimensions:
  const playerWidth = screenHeight;
  const playerHeight = screenWidth;

  // ── HUD state ──────────────────────────────────────────────────────────────
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScrubbingRef = useRef(false);

  // ── Scrubber state ─────────────────────────────────────────────────────────
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTimeSec, setScrubTimeSec] = useState(0);
  const trackWidthRef = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);

  // ── Hide Status Bar while cinema is active ─────────────────────────────────
  useEffect(() => {
    StatusBar.setHidden(true, 'fade');
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, []);

  // ── Android hardware back button ───────────────────────────────────────────
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => backHandler.remove();
  }, [onClose]);

  // ── Reanimated HUD Fade ────────────────────────────────────────────────────
  const controlsOpacity = useSharedValue(1);
  const animatedHudStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  // ── Controls auto-hide timer (3.5s) ────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsOpacity.value = withTiming(1, { duration: 180 });
    setAreControlsVisible(true);

    if (isPlaying && !isCompleted && !isBuffering && !isError) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (isScrubbingRef.current) return;
        controlsOpacity.value = withTiming(0, { duration: 350 });
        setAreControlsVisible(false);
      }, 3500);
    }
  }, [isPlaying, isCompleted, isBuffering, isError, controlsOpacity]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [resetControlsTimer]);

  // Keep HUD visible when buffering or in error state
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
      controlsOpacity.value = withTiming(0, { duration: 250 });
      setAreControlsVisible(false);
    } else {
      resetControlsTimer();
    }
  }, [areControlsVisible, resetControlsTimer, controlsOpacity]);

  // ── Video Touch & Double-Tap ───────────────────────────────────────────────
  const lastTapRef = useRef<number>(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleVideoTouch = (e: GestureResponderEvent) => {
    const now = Date.now();
    const x = e.nativeEvent.locationX;
    const isLeftHalf = x < playerWidth / 2;

    if (now - lastTapRef.current < 300) {
      // Double tap detected
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      lastTapRef.current = 0;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onDoubleTapSeek(isLeftHalf ? 'back' : 'forward');
      resetControlsTimer();
    } else {
      lastTapRef.current = now;
      singleTapTimerRef.current = setTimeout(() => {
        toggleControls();
      }, 300);
    }
  };

  // ── Scrubber PanResponder ──────────────────────────────────────────────────
  const getTimeFromX = useCallback(
    (locX: number): number => {
      const w = trackWidthRef.current;
      if (w <= 0 || durationSec <= 0) return 0;
      const clampedX = Math.max(0, Math.min(w, locX));
      return (clampedX / w) * durationSec;
    },
    [durationSec]
  );

  const scrubberPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          isScrubbingRef.current = true;
          setIsScrubbing(true);
          if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
          controlsOpacity.value = withTiming(1, { duration: 150 });
          setAreControlsVisible(true);
          onSeekStart();
          const t = getTimeFromX(evt.nativeEvent.locationX);
          setScrubTimeSec(t);
          onSeek(t);
        },
        onPanResponderMove: (evt) => {
          const t = getTimeFromX(evt.nativeEvent.locationX);
          setScrubTimeSec(t);
          onSeek(t);
        },
        onPanResponderRelease: (evt) => {
          isScrubbingRef.current = false;
          setIsScrubbing(false);
          const t = getTimeFromX(evt.nativeEvent.locationX);
          onSeekEnd(t);
          resetControlsTimer();
        },
        onPanResponderTerminate: () => {
          isScrubbingRef.current = false;
          setIsScrubbing(false);
          resetControlsTimer();
        },
      }),
    [getTimeFromX, onSeekStart, onSeek, onSeekEnd, resetControlsTimer, controlsOpacity]
  );

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTrackWidth(w);
    trackWidthRef.current = w;
  };

  // ── Progress calculations ──────────────────────────────────────────────────
  const displayTimeSec = isScrubbing ? scrubTimeSec : currentTimeSec;
  const progressRatio = durationSec > 0 ? Math.min(1, Math.max(0, displayTimeSec / durationSec)) : 0;
  const bufferedRatio = durationSec > 0 ? Math.min(1, Math.max(0, bufferedSec / durationSec)) : 0;

  // ── Rotated Container Style ────────────────────────────────────────────────
  const containerStyle = useMemo<ViewStyle>(() => {
    if (isPhysicalLandscape) {
      return {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#000000',
      };
    }
    // Compulsorily rotated 90 degrees clockwise to fill portrait screens in landscape
    return {
      position: 'absolute',
      top: (screenHeight - screenWidth) / 2,
      left: (screenWidth - screenHeight) / 2,
      width: screenHeight,
      height: screenWidth,
      transform: [{ rotate: '90deg' }],
      backgroundColor: '#000000',
    };
  }, [isPhysicalLandscape, screenWidth, screenHeight]);

  // Safe area insets protection for notch / dynamic island / home bar
  const paddingLeft = isPhysicalLandscape ? Math.max(insets.left, 24) : Math.max(insets.top, 24);
  const paddingRight = isPhysicalLandscape ? Math.max(insets.right, 24) : Math.max(insets.bottom, 24);
  const paddingTop = isPhysicalLandscape ? Math.max(insets.top, 16) : 16;
  const paddingBottom = isPhysicalLandscape ? Math.max(insets.bottom, 16) : 16;

  return (
    <View style={styles.root}>
      {/* ── Compulsorily Rotated Landscape Stage ── */}
      <View style={containerStyle}>
        {/* ── Video Canvas ── */}
        <Pressable onPress={handleVideoTouch} style={StyleSheet.absoluteFillObject}>
          {/* Background Poster fallback */}
          {cleanThumbnailUrl ? (
            <ExpoImage
              source={{ uri: cleanThumbnailUrl }}
              style={StyleSheet.absoluteFillObject}
              contentFit="contain"
              cachePolicy="memory-disk"
              priority="high"
            />
          ) : null}

          {/* Native VideoView (textureView allows seamless Android 90deg CSS rotation) */}
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
                <MaterialIcons
                  name={seekRipple.direction === 'back' ? 'replay-10' : 'forward-10'}
                  size={26}
                  color="#FFFFFF"
                />
                <Text style={styles.seekRippleText}>
                  {seekRipple.direction === 'back' ? '-10s' : '+10s'}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Buffering Spinner */}
          {isBuffering && !isCompleted ? (
            <View style={styles.bufferingOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color="#E50914" />
            </View>
          ) : null}

          {/* Error Overlay */}
          {isError ? (
            <View style={styles.errorOverlay}>
              <Ionicons name="alert-circle-outline" size={38} color="#E50914" />
              <Text style={styles.errorTitle}>Stream Interrupted</Text>
              <Text style={styles.errorSubtitle}>
                {errorMessage || 'Please check your connection.'}
              </Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => {
                  try {
                    player.play();
                  } catch {}
                }}
              >
                <Text style={styles.retryButtonText}>RETRY</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Pressable>

        {/* ── Netflix HUD Overlay ── */}
        <Animated.View
          style={[StyleSheet.absoluteFillObject, animatedHudStyle]}
          pointerEvents={areControlsVisible ? 'box-none' : 'none'}
        >
          {/* ── Top Bar ── */}
          <LinearGradient
            colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.4)', 'transparent']}
            style={[
              styles.topBar,
              {
                paddingTop,
                paddingLeft,
                paddingRight,
              },
            ]}
            pointerEvents={areControlsVisible ? 'box-none' : 'none'}
          >
            {/* Left: Netflix Red N Badge + Video Title */}
            <View style={styles.topLeftContainer}>
              <View style={styles.brandBadge}>
                <Text style={styles.brandNText}>N</Text>
              </View>
              <View style={styles.titleWrapper}>
                <Text style={styles.titleText} numberOfLines={1}>
                  {title}
                </Text>
                {resumedToastSec !== null ? (
                  <View style={styles.resumedRow}>
                    <Text style={styles.resumedText}>
                      Resumed from {formatTime(resumedToastSec)}
                    </Text>
                    <TouchableOpacity onPress={onRestartFromBeginning} hitSlop={10}>
                      <Text style={styles.restartLink}>Restart</Text>
                    </TouchableOpacity>
                  </View>
                ) : subtitle ? (
                  <Text style={styles.subtitleText} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Right: Cast Button + Clean White Close (X) */}
            <View style={styles.topRightContainer}>
              <ScreenCastButton
                size={22}
                color="#FFFFFF"
                activeColor="#E50914"
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

          {/* ── Center Controls (Borderless Netflix Style) ── */}
          <View
            style={styles.centerControls}
            pointerEvents={areControlsVisible ? 'box-none' : 'none'}
          >
            {/* -10s Rewind */}
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                resetControlsTimer();
                onDoubleTapSeek('back');
              }}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              activeOpacity={0.7}
              style={styles.centerButton}
            >
              <MaterialIcons name="replay-10" size={52} color="#FFFFFF" />
            </TouchableOpacity>

            {/* Play / Pause / Replay (Large icon, no circle border) */}
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

            {/* +10s Forward */}
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                resetControlsTimer();
                onDoubleTapSeek('forward');
              }}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              activeOpacity={0.7}
              style={styles.centerButton}
            >
              <MaterialIcons name="forward-10" size={52} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* ── Bottom Scrubber (Netflix Red Bar + Remaining Time) ── */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.95)']}
            style={[
              styles.bottomBar,
              {
                paddingBottom,
                paddingLeft,
                paddingRight,
              },
            ]}
            pointerEvents={areControlsVisible ? 'box-none' : 'none'}
          >
            <View style={styles.scrubberRow}>
              {/* Interactive Scrubber Track */}
              <View
                style={styles.trackTouchArea}
                onLayout={handleTrackLayout}
                {...scrubberPanResponder.panHandlers}
              >
                {/* Background Track */}
                <View style={styles.trackBackground}>
                  {/* Buffer Track */}
                  <View
                    style={[styles.trackBuffer, { width: `${bufferedRatio * 100}%` }]}
                  />
                  {/* Played Progress Track (Netflix Red) */}
                  <View
                    style={[styles.trackPlayed, { width: `${progressRatio * 100}%` }]}
                  />
                </View>

                {/* Red Circular Thumb */}
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

              {/* Remaining Time on Far Right (e.g. 2:12:24) */}
              <Text style={styles.remainingText}>
                {formatRemaining(displayTimeSec, durationSec)}
              </Text>
            </View>
          </LinearGradient>
        </Animated.View>
      </View>
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },

  // ─── Top Bar ──────────────────────────────────────────────────────────────
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 28,
    zIndex: 10,
  },
  topLeftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 20,
  },
  brandBadge: {
    width: 24,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandNText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 28,
    fontWeight: '900',
    color: '#E50914', // Classic Netflix Red
    letterSpacing: -1,
  },
  titleWrapper: {
    flex: 1,
  },
  titleText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  subtitleText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 2,
  },
  resumedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  resumedText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.75)',
  },
  restartLink: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    color: '#E5C483',
    textDecorationLine: 'underline',
  },
  topRightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  closeButton: {
    padding: 4,
  },

  // ─── Center Controls ──────────────────────────────────────────────────────
  centerControls: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 68,
    zIndex: 5,
  },
  centerButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Bottom Scrubber Bar ──────────────────────────────────────────────────
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 36,
    zIndex: 10,
  },
  scrubberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  trackTouchArea: {
    flex: 1,
    height: 40,
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
    backgroundColor: '#E50914', // Netflix Red
  },
  scrubThumb: {
    position: 'absolute',
    top: 13,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#E50914',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 2,
    elevation: 4,
  },
  scrubThumbActive: {
    top: 11,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E50914',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
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
  remainingText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    minWidth: 54,
    textAlign: 'right',
  },

  // ─── Double Tap Ripple ────────────────────────────────────────────────────
  seekRippleContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '38%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  seekRippleLeft: {
    left: 0,
  },
  seekRippleRight: {
    right: 0,
  },
  seekRippleBubble: {
    backgroundColor: 'rgba(11, 11, 12, 0.75)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  seekRippleText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 13,
    color: '#FFFFFF',
  },

  // ─── Buffering & Error ────────────────────────────────────────────────────
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    zIndex: 20,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 11, 12, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    zIndex: 30,
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
    color: 'rgba(255, 255, 255, 0.65)',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#E50914',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 6,
  },
  retryButtonText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 12,
    color: '#FFFFFF',
    letterSpacing: 1.5,
  },
});
