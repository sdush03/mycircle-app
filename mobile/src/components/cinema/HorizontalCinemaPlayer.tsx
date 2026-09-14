/**
 * HorizontalCinemaPlayer — Netflix-style landscape-first cinema player
 *
 * Always opens in fullscreen landscape via RN Modal (presentationStyle="fullScreen").
 * UI matches Netflix: title top-left, cast+close top-right, large circular seek
 * buttons + pause in center, thick red-style scrubber at very bottom with time remaining.
 * No clip / speed / subtitle controls.
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
import { Ionicons } from '@expo/vector-icons';
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
  runOnJS,
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

/** Remaining time = duration − current, shown on the right of the scrubber */
function formatRemaining(currentSec: number, durationSec: number): string {
  const remaining = Math.max(0, durationSec - currentSec);
  return `-${formatTime(remaining)}`;
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

  // ── State ──────────────────────────────────────────────────────────────────
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScrubbing = useRef(false);

  // Restore status bar on unmount
  useEffect(() => {
    StatusBar.setHidden(true, 'fade');
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, []);

  // Android hardware back → close
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => backHandler.remove();
  }, [onClose]);

  // ── Reanimated ─────────────────────────────────────────────────────────────
  const controlsOpacity = useSharedValue(1);

  const animatedHudStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  // ── Controls auto-hide ─────────────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsOpacity.value = withTiming(1, { duration: 180 });
    setAreControlsVisible(true);

    if (isPlaying && !isCompleted && !isBuffering && !isError) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (isScrubbing.current) return;
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

  // Keep controls visible when buffering or error
  useEffect(() => {
    if (isBuffering || isError) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsOpacity.value = withTiming(1, { duration: 180 });
      setAreControlsVisible(true);
    }
  }, [isBuffering, isError, controlsOpacity]);

  const showControls = useCallback(() => {
    resetControlsTimer();
  }, [resetControlsTimer]);

  const toggleControls = useCallback(() => {
    if (areControlsVisible) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsOpacity.value = withTiming(0, { duration: 250 });
      setAreControlsVisible(false);
    } else {
      resetControlsTimer();
    }
  }, [areControlsVisible, resetControlsTimer, controlsOpacity]);

  // ── Scrubber suppress callbacks ────────────────────────────────────────────
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
        controlsOpacity.value = withTiming(0, { duration: 350 });
        setAreControlsVisible(false);
      }, 2000);
    }
  }, [isPlaying, isCompleted, isBuffering, isError, controlsOpacity]);

  // ── RNGH tap gestures ──────────────────────────────────────────────────────
  const handleSingleTap = useCallback(() => {
    toggleControls();
  }, [toggleControls]);

  const handleDoubleTap = useCallback(
    (x: number, canvasW: number) => {
      const isLeft = x < canvasW / 2;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      onDoubleTapSeek(isLeft ? 'back' : 'forward');
      resetControlsTimer();
    },
    [onDoubleTapSeek, resetControlsTimer],
  );

  // dismissGestureRef is unused in fullscreen but passed to CinemaScrubber for API compat
  const dismissGestureRef = useRef<any>(null);

  const buildTapGestures = useCallback(
    (canvasW: number) => {
      const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(300)
        .onEnd((e) => {
          'worklet';
          runOnJS(handleDoubleTap)(e.x, canvasW);
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

  // We render inside a landscape Modal so windowWidth > windowHeight
  const { width: wW, height: wH } = useWindowDimensions();
  // In fullscreen landscape Modal, width is the long side
  const fsW = Math.max(wW, wH);
  const fsH = Math.min(wW, wH);

  const fsTapGesture = useMemo(
    () => buildTapGestures(fsW),
    [buildTapGestures, fsW],
  );

  // ── Render fullscreen landscape content ────────────────────────────────────
  const renderFullscreenContent = () => (
    <GestureHandlerRootView style={styles.fsRoot}>
      <StatusBar hidden />

      {/* ── Video Surface ── */}
      <GestureDetector gesture={fsTapGesture}>
        <View style={StyleSheet.absoluteFillObject}>
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

          {/* Double-tap seek zone flash */}
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
                  size={24}
                  color="#FFFFFF"
                />
                <Text style={styles.seekZoneText}>
                  {seekRipple.direction === 'back' ? '−10s' : '+10s'}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Buffering spinner */}
          {isBuffering && !isCompleted ? (
            <View style={styles.bufferingOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color="#FFFFFF" />
            </View>
          ) : null}

          {/* Error overlay */}
          {isError ? (
            <View style={styles.errorOverlay}>
              <Ionicons name="alert-circle-outline" size={40} color="#E5C483" />
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
        style={[StyleSheet.absoluteFillObject, animatedHudStyle]}
        pointerEvents={areControlsVisible ? 'box-none' : 'none'}
      >
        {/* Top gradient */}
        <LinearGradient
          colors={['rgba(0,0,0,0.80)', 'rgba(0,0,0,0.25)', 'transparent']}
          style={[
            styles.topBar,
            {
              paddingTop: Math.max(insets.top + 10, 20),
              paddingLeft: Math.max(insets.left + 20, 32),
              paddingRight: Math.max(insets.right + 20, 32),
            },
          ]}
          pointerEvents={areControlsVisible ? 'box-none' : 'none'}
        >
          {/* Left: Title */}
          <View style={styles.topTitleBlock}>
            <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
            {subtitle ? (
              <Text style={styles.topSubtitle} numberOfLines={1}>{subtitle}</Text>
            ) : null}
            {resumedToastSec !== null ? (
              <View style={styles.resumedRow}>
                <Text style={styles.resumedText}>
                  Resumed from {formatTime(resumedToastSec)}
                </Text>
                <TouchableOpacity onPress={onRestartFromBeginning} hitSlop={10}>
                  <Text style={styles.restartLink}>  Restart</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {/* Right: Cast + Close */}
          <View style={styles.topRightRow}>
            <ScreenCastButton
              size={22}
              color="#FFFFFF"
              activeColor="#E5C483"
              videoTitle={title}
            />
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                onClose();
              }}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* ── Center Controls: ← 10 | Play/Pause/Replay | 10 → ── */}
        <View
          style={styles.centerControls}
          pointerEvents={areControlsVisible ? 'auto' : 'none'}
        >
          {/* −10s */}
          <TouchableOpacity
            style={styles.seekCircleButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              resetControlsTimer();
              onDoubleTapSeek('back');
            }}
            hitSlop={16}
            activeOpacity={0.75}
          >
            <View style={styles.seekCircle}>
              <Ionicons name="refresh" size={28} color="#FFFFFF" style={styles.seekIconFlip} />
              <Text style={styles.seekCircleLabel}>10</Text>
            </View>
          </TouchableOpacity>

          {/* Play / Pause / Replay — large center */}
          <TouchableOpacity
            style={styles.centerPlayButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              resetControlsTimer();
              if (isCompleted) onReplay(); else onPlayPauseToggle();
            }}
            hitSlop={20}
            activeOpacity={0.8}
          >
            {isCompleted ? (
              <Ionicons name="reload" size={44} color="#FFFFFF" />
            ) : isPlaying ? (
              <Ionicons name="pause" size={44} color="#FFFFFF" />
            ) : (
              <Ionicons name="play" size={44} color="#FFFFFF" style={{ marginLeft: 5 }} />
            )}
          </TouchableOpacity>

          {/* +10s */}
          <TouchableOpacity
            style={styles.seekCircleButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              resetControlsTimer();
              onDoubleTapSeek('forward');
            }}
            hitSlop={16}
            activeOpacity={0.75}
          >
            <View style={styles.seekCircle}>
              <Ionicons name="refresh" size={28} color="#FFFFFF" />
              <Text style={styles.seekCircleLabel}>10</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Bottom: scrubber + time ── */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.88)']}
          style={[
            styles.bottomBar,
            {
              paddingBottom: Math.max(insets.bottom + 14, 24),
              paddingLeft: Math.max(insets.left + 12, 24),
              paddingRight: Math.max(insets.right + 12, 24),
            },
          ]}
          pointerEvents={areControlsVisible ? 'box-none' : 'none'}
        >
          {/* Scrubber row: [current time] [scrubber] [remaining] */}
          <View style={styles.scrubberRow}>
            <Text style={styles.timecodeLeft}>{formatTime(currentTimeSec)}</Text>
            <View style={styles.scrubberFlex}>
              <CinemaScrubber
                currentTimeSec={currentTimeSec}
                durationSec={durationSec}
                bufferedSec={bufferedSec}
                onSeekStart={handleScrubStart}
                onSeek={(t) => onSeek(t)}
                onSeekEnd={(t) => { onSeekEnd(t); handleScrubEnd(); }}
                onScrubStart={handleScrubStart}
                onScrubEnd={handleScrubEnd}
                isControlsVisible={areControlsVisible}
                variant="horizontal"
                bare
                dismissGestureRef={dismissGestureRef}
              />
            </View>
            <Text style={styles.timecodeRight}>
              {formatRemaining(currentTimeSec, durationSec)}
            </Text>
          </View>
        </LinearGradient>
      </Animated.View>
    </GestureHandlerRootView>
  );

  // ── Always render inside landscape fullscreen Modal ────────────────────────
  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onClose();
      }}
    >
      {renderFullscreenContent()}
    </Modal>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  fsRoot: {
    flex: 1,
    backgroundColor: '#000000',
  },

  // ─── Top bar ──────────────────────────────────────────────────────────────
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 40,
    zIndex: 10,
  },
  topTitleBlock: {
    flex: 1,
    marginRight: 16,
  },
  topTitle: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  topSubtitle: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
  resumedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  resumedText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
  },
  restartLink: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 12,
    color: '#E5C483',
  },
  topRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(30,30,34,0.70)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Center controls ──────────────────────────────────────────────────────
  centerControls: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 56,
  },
  seekCircleButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  seekIconFlip: {
    transform: [{ scaleX: -1 }],
  },
  seekCircleLabel: {
    position: 'absolute',
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    color: '#FFFFFF',
    // Centered inside the circle below the icon
    bottom: 10,
  },
  centerPlayButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Bottom scrubber ──────────────────────────────────────────────────────
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 40,
    zIndex: 10,
  },
  scrubberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timecodeLeft: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    minWidth: 44,
    textAlign: 'right',
  },
  scrubberFlex: {
    flex: 1,
  },
  timecodeRight: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    minWidth: 54,
    textAlign: 'left',
  },

  // ─── Seek zone flash ──────────────────────────────────────────────────────
  seekZoneFlash: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '38%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  seekZoneLeft: { left: 0 },
  seekZoneRight: { right: 0 },
  seekZoneBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  seekZoneText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 14,
    color: '#FFFFFF',
  },

  // ─── Buffering / Error ────────────────────────────────────────────────────
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 18,
    color: '#FFFFFF',
    marginTop: 14,
    marginBottom: 8,
  },
  errorSubtitle: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginBottom: 22,
  },
  retryButton: {
    backgroundColor: '#E5C483',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 13,
    color: '#0B0B0C',
    letterSpacing: 1.5,
  },
});
