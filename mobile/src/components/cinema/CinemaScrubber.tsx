import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
  LayoutChangeEvent,
} from 'react-native';
import { FONT_JOST_MEDIUM } from '../../constants/fonts';

interface CinemaScrubberProps {
  currentTimeSec: number;
  durationSec: number;
  bufferedSec: number;
  onSeekStart?: () => void;
  onSeek: (targetTimeSec: number) => void;
  onSeekEnd: (targetTimeSec: number) => void;
  isControlsVisible: boolean;
  variant?: 'horizontal' | 'vertical';
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
  isControlsVisible,
  variant = 'horizontal',
}) => {
  const [trackWidth, setTrackWidth] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragTimeSec, setDragTimeSec] = useState<number>(0);

  const isDraggingRef = useRef<boolean>(false);
  const trackWidthRef = useRef<number>(0);
  const durationRef = useRef<number>(durationSec);
  durationRef.current = durationSec;

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTrackWidth(w);
    trackWidthRef.current = w;
  };

  const getTimeFromX = useCallback((pageX: number, locationX: number): number => {
    const w = trackWidthRef.current;
    const dur = durationRef.current;
    if (w <= 0 || dur <= 0) return 0;
    const clampedX = Math.max(0, Math.min(w, locationX));
    return (clampedX / w) * dur;
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        isDraggingRef.current = true;
        setIsDragging(true);
        onSeekStart?.();
        const t = getTimeFromX(evt.nativeEvent.pageX, evt.nativeEvent.locationX);
        setDragTimeSec(t);
        onSeek(t);
      },
      onPanResponderMove: (evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        if (!isDraggingRef.current) return;
        const w = trackWidthRef.current;
        const dur = durationRef.current;
        if (w <= 0 || dur <= 0) return;
        const currentPos = evt.nativeEvent.locationX;
        const clampedX = Math.max(0, Math.min(w, currentPos));
        const t = (clampedX / w) * dur;
        setDragTimeSec(t);
        onSeek(t);
      },
      onPanResponderRelease: (evt: GestureResponderEvent) => {
        isDraggingRef.current = false;
        setIsDragging(false);
        const t = getTimeFromX(evt.nativeEvent.pageX, evt.nativeEvent.locationX);
        onSeekEnd(t);
      },
      onPanResponderTerminate: () => {
        isDraggingRef.current = false;
        setIsDragging(false);
      },
    })
  ).current;

  const displayTime = isDragging ? dragTimeSec : currentTimeSec;
  const progressRatio = durationSec > 0 ? Math.min(1, Math.max(0, displayTime / durationSec)) : 0;
  const bufferedRatio = durationSec > 0 ? Math.min(1, Math.max(0, bufferedSec / durationSec)) : 0;

  // ───────────────────────────────────────────────────────────────────────────
  // VERTICAL REEL SCRUBBER: Ultra-thin 2px line at the very bottom
  // ───────────────────────────────────────────────────────────────────────────
  if (variant === 'vertical') {
    return (
      <View
        style={styles.verticalScrubberRoot}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.verticalTrackBackground}>
          {/* Buffer Track */}
          <View style={[styles.verticalTrackBuffer, { width: `${bufferedRatio * 100}%` }]} />
          {/* Played Progress Track */}
          <View style={[styles.verticalTrackPlayed, { width: `${progressRatio * 100}%` }]} />
        </View>

        {/* Time Bubble during dragging */}
        {isDragging ? (
          <View
            style={[
              styles.timeBubble,
              { left: Math.max(10, Math.min(trackWidth - 60, progressRatio * trackWidth - 25)) },
            ]}
          >
            <Text style={styles.timeBubbleText}>{formatTime(displayTime)}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // HORIZONTAL CINEMA SCRUBBER: Elegant timeline with timecodes and knob
  // ───────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.horizontalRoot}>
      {/* Timecode Left */}
      <Text style={styles.timecodeText}>{formatTime(displayTime)}</Text>

      {/* Scrubber Touch Area */}
      <View
        style={styles.horizontalTouchArea}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.horizontalTrackBackground}>
          {/* Buffer Track */}
          <View style={[styles.horizontalTrackBuffer, { width: `${bufferedRatio * 100}%` }]} />
          {/* Played Progress Track */}
          <View style={[styles.horizontalTrackPlayed, { width: `${progressRatio * 100}%` }]} />
        </View>

        {/* Scrub Handle Dot */}
        {trackWidth > 0 ? (
          <View
            style={[
              styles.scrubHandle,
              isDragging && styles.scrubHandleDragging,
              { left: Math.max(0, Math.min(trackWidth - (isDragging ? 16 : 10), progressRatio * trackWidth - (isDragging ? 8 : 5))) },
            ]}
          />
        ) : null}

        {/* Floating Bubble during drag */}
        {isDragging && trackWidth > 0 ? (
          <View
            style={[
              styles.timeBubble,
              { left: Math.max(0, Math.min(trackWidth - 50, progressRatio * trackWidth - 25)) },
            ]}
          >
            <Text style={styles.timeBubbleText}>{formatTime(displayTime)}</Text>
          </View>
        ) : null}
      </View>

      {/* Timecode Right (Total Duration) */}
      <Text style={styles.timecodeText}>{formatTime(durationSec)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  // ─── Horizontal Scrubber ──────────────────────────────────────────────────
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
    minWidth: 38,
    textAlign: 'center',
  },
  horizontalTouchArea: {
    flex: 1,
    height: 36,
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
    backgroundColor: '#E5C483', // Warm champagne
  },
  scrubHandle: {
    position: 'absolute',
    top: 13,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E5C483',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 3,
  },
  scrubHandleDragging: {
    top: 10,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#E5C483',
  },

  // ─── Vertical Reel Scrubber ───────────────────────────────────────────────
  verticalScrubberRoot: {
    width: '100%',
    height: 24,
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

  // ─── Floating Time Bubble ─────────────────────────────────────────────────
  timeBubble: {
    position: 'absolute',
    top: -28,
    backgroundColor: 'rgba(11, 11, 12, 0.88)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBubbleText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 10,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
