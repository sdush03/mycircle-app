/**
 * CinemaScrubber — RNGH-based scrubber (portrait & vertical variants)
 *
 * Fixes:
 *  #1  — Uses RNGH Gesture.Pan instead of PanResponder, participates in the
 *         same gesture tree as the parent swipe-to-dismiss. Pass dismissGestureRef
 *         so RNGH can arbitrate: horizontal-first motion → scrubber wins,
 *         vertical-first motion → dismiss wins.
 *  #6  — Uses gesture.x (relative to the GestureDetector view) instead of
 *         nativeEvent.locationX which is inaccurate on Android during move.
 *  #7  — Vertical scrubber now has a visible thumb dot that grows on drag.
 *  #8  — Vertical time bubble renders above the component, not inside a
 *         clipped container.
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  LayoutChangeEvent,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { FONT_JOST_MEDIUM } from '../../constants/fonts';

interface CinemaScrubberProps {
  currentTimeSec: number;
  durationSec: number;
  bufferedSec: number;
  onSeekStart?: () => void;
  onSeek: (targetTimeSec: number) => void;
  onSeekEnd: (targetTimeSec: number) => void;
  /** Called when drag starts — parent suppresses HUD auto-hide */
  onScrubStart?: () => void;
  /** Called when drag ends — parent restarts HUD auto-hide */
  onScrubEnd?: () => void;
  isControlsVisible: boolean;
  variant?: 'horizontal' | 'vertical';
  /**
   * Ref to the parent swipe-to-dismiss gesture. Passed to
   * simultaneousWithExternalGesture() so the two gestures can be active
   * concurrently — RNGH will hand off based on direction heuristics set
   * on each gesture (activeOffsetX / activeOffsetY).
   */
  dismissGestureRef?: React.RefObject<any>;
}

function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

export const CinemaScrubber: React.FC<CinemaScrubberProps> = ({
  currentTimeSec,
  durationSec,
  bufferedSec,
  onSeekStart,
  onSeek,
  onSeekEnd,
  onScrubStart,
  onScrubEnd,
  isControlsVisible,
  variant = 'horizontal',
  dismissGestureRef,
}) => {
  const [trackWidth, setTrackWidth] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragTimeSec, setDragTimeSec] = useState<number>(0);

  // Mutable refs safe to read from worklet via runOnJS callbacks
  const trackWidthRef = useRef<number>(0);
  const durationRef = useRef<number>(durationSec);
  durationRef.current = durationSec;

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTrackWidth(w);
    trackWidthRef.current = w;
  };

  // JS-thread callbacks — called via runOnJS from the worklet
  const jsOnBegin = useCallback(
    (localX: number) => {
      const w = trackWidthRef.current;
      const dur = durationRef.current;
      const t = w > 0 && dur > 0 ? (Math.max(0, Math.min(w, localX)) / w) * dur : 0;
      setIsDragging(true);
      setDragTimeSec(t);
      onSeekStart?.();
      onScrubStart?.();
      onSeek(t);
    },
    [onSeekStart, onScrubStart, onSeek],
  );

  const jsOnMove = useCallback(
    (localX: number) => {
      const w = trackWidthRef.current;
      const dur = durationRef.current;
      if (w <= 0 || dur <= 0) return;
      const t = (Math.max(0, Math.min(w, localX)) / w) * dur;
      setDragTimeSec(t);
      onSeek(t);
    },
    [onSeek],
  );

  const jsOnEnd = useCallback(
    (localX: number) => {
      const w = trackWidthRef.current;
      const dur = durationRef.current;
      const t = w > 0 && dur > 0 ? (Math.max(0, Math.min(w, localX)) / w) * dur : 0;
      setIsDragging(false);
      onSeekEnd(t);
      onScrubEnd?.();
    },
    [onSeekEnd, onScrubEnd],
  );

  const jsOnFinalize = useCallback(() => {
    setIsDragging(false);
    onScrubEnd?.();
  }, [onScrubEnd]);

  // ── Build RNGH Pan gesture ─────────────────────────────────────────────────
  // NOTE: gesture is rebuilt each render so closures always capture fresh callbacks.
  // This is intentional and harmless — RNGH handles it fine.
  const buildGesture = () => {
    let g = Gesture.Pan()
      // Activate immediately on any horizontal movement; vertical-first motion
      // is deferred to the parent dismiss gesture.
      .activeOffsetX([-4, 4])
      .onBegin((e) => {
        'worklet';
        runOnJS(jsOnBegin)(e.x);
      })
      .onUpdate((e) => {
        'worklet';
        runOnJS(jsOnMove)(e.x);
      })
      .onEnd((e) => {
        'worklet';
        runOnJS(jsOnEnd)(e.x);
      })
      .onFinalize(() => {
        'worklet';
        runOnJS(jsOnFinalize)();
      });

    if (dismissGestureRef) {
      // Allow both to be active simultaneously — direction heuristics on each
      // gesture determine which one actually wins the touch.
      g = (g as any).simultaneousWithExternalGesture(dismissGestureRef) as typeof g;
    }

    return g;
  };

  const scrubGesture = buildGesture();

  const displayTime = isDragging ? dragTimeSec : currentTimeSec;
  const progressRatio = durationSec > 0 ? Math.min(1, Math.max(0, displayTime / durationSec)) : 0;
  const bufferedRatio = durationSec > 0 ? Math.min(1, Math.max(0, bufferedSec / durationSec)) : 0;

  // ─────────────────────────────────────────────────────────────────────────
  // VERTICAL REEL SCRUBBER
  // ─────────────────────────────────────────────────────────────────────────
  if (variant === 'vertical') {
    const thumbLeft = trackWidth > 0
      ? Math.max(0, Math.min(trackWidth - (isDragging ? 14 : 8), progressRatio * trackWidth - (isDragging ? 7 : 4)))
      : 0;

    return (
      // outer wrapper is overflow:visible so the time bubble can float above
      // the bottomContainer clip boundary (fixes #8)
      <View style={styles.verticalOuterWrapper} onLayout={handleLayout}>
        {/* Time bubble — above the track, outside any clipping parent */}
        {isDragging && trackWidth > 0 ? (
          <View
            style={[
              styles.timeBubble,
              styles.timeBubbleAboveVertical,
              { left: Math.max(10, Math.min(trackWidth - 60, progressRatio * trackWidth - 25)) },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.timeBubbleText}>{formatTime(displayTime)}</Text>
          </View>
        ) : null}

        <GestureDetector gesture={scrubGesture}>
          <View style={styles.verticalScrubberRoot}>
            <View style={styles.verticalTrackBackground}>
              <View style={[styles.verticalTrackBuffer, { width: `${bufferedRatio * 100}%` }]} />
              <View style={[styles.verticalTrackPlayed, { width: `${progressRatio * 100}%` }]} />
            </View>

            {/* Thumb dot — discoverable affordance for the scrubber (fixes #7) */}
            {trackWidth > 0 ? (
              <View
                style={[
                  styles.verticalThumb,
                  isDragging && styles.verticalThumbDragging,
                  { left: thumbLeft },
                ]}
                pointerEvents="none"
              />
            ) : null}
          </View>
        </GestureDetector>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HORIZONTAL CINEMA SCRUBBER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.horizontalRoot}>
      <Text style={styles.timecodeText}>{formatTime(displayTime)}</Text>

      <GestureDetector gesture={scrubGesture}>
        <View style={styles.horizontalTouchArea} onLayout={handleLayout}>
          <View style={styles.horizontalTrackBackground}>
            <View style={[styles.horizontalTrackBuffer, { width: `${bufferedRatio * 100}%` }]} />
            <View style={[styles.horizontalTrackPlayed, { width: `${progressRatio * 100}%` }]} />
          </View>

          {/* Scrub handle dot */}
          {trackWidth > 0 ? (
            <View
              style={[
                styles.scrubHandle,
                isDragging && styles.scrubHandleDragging,
                {
                  left: Math.max(
                    0,
                    Math.min(
                      trackWidth - (isDragging ? 16 : 10),
                      progressRatio * trackWidth - (isDragging ? 8 : 5),
                    ),
                  ),
                },
              ]}
              pointerEvents="none"
            />
          ) : null}

          {/* Floating time bubble during drag */}
          {isDragging && trackWidth > 0 ? (
            <View
              style={[
                styles.timeBubble,
                { left: Math.max(0, Math.min(trackWidth - 54, progressRatio * trackWidth - 27)) },
              ]}
              pointerEvents="none"
            >
              <Text style={styles.timeBubbleText}>{formatTime(displayTime)}</Text>
            </View>
          ) : null}
        </View>
      </GestureDetector>

      <Text style={styles.timecodeText}>{formatTime(durationSec)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  // ─── Horizontal ──────────────────────────────────────────────────────────
  horizontalRoot: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
    gap: 12,
  },
  timecodeText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    letterSpacing: 1,
    color: 'rgba(255, 255, 255, 0.85)',
    minWidth: 40,
    textAlign: 'center',
  },
  horizontalTouchArea: {
    flex: 1,
    height: 44,
    justifyContent: 'center',
    position: 'relative',
  },
  horizontalTrackBackground: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
    position: 'relative',
  },
  horizontalTrackBuffer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  horizontalTrackPlayed: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#E5C483',
  },
  scrubHandle: {
    position: 'absolute',
    top: 17,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E5C483',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 3,
  },
  scrubHandleDragging: {
    top: 14,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#E5C483',
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 6,
  },

  // ─── Vertical ─────────────────────────────────────────────────────────────
  verticalOuterWrapper: {
    width: '100%',
    height: 44,
    justifyContent: 'flex-end',
    position: 'relative',
    overflow: 'visible',
  },
  verticalScrubberRoot: {
    width: '100%',
    height: 44,
    justifyContent: 'flex-end',
    position: 'relative',
  },
  verticalTrackBackground: {
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    position: 'relative',
  },
  verticalTrackBuffer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  verticalTrackPlayed: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#E5C483',
  },
  verticalThumb: {
    position: 'absolute',
    bottom: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5C483',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 3,
  },
  verticalThumbDragging: {
    bottom: -6,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#E5C483',
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 6,
  },

  // ─── Time Bubble ──────────────────────────────────────────────────────────
  timeBubble: {
    position: 'absolute',
    top: -30,
    backgroundColor: 'rgba(11, 11, 12, 0.92)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBubbleAboveVertical: {
    // Bubble floats above the outer wrapper, which is overflow:visible,
    // so it escapes the parent bottomContainer clip (fixes #8)
    top: -38,
  },
  timeBubbleText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 10,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
