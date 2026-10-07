import React, { useState, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
  scrollTo,
  withTiming,
  interpolate,
  type SharedValue,
  type AnimatedRef,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface SpatialFilmLoupeProps {
  thumbnails: string[];
  scrollY: SharedValue<number>;
  contentHeight: SharedValue<number>;
  layoutHeight: SharedValue<number>;
  loupeOpacity: SharedValue<number>;
  isEdgeScrubbing: SharedValue<boolean>;
  mainScrollRef: AnimatedRef<Animated.ScrollView>;
  isCinema?: boolean;
  topInset?: number;
  bottomInset?: number;
}

export const SpatialFilmLoupe = React.memo(function SpatialFilmLoupe({
  thumbnails,
  scrollY,
  contentHeight,
  layoutHeight,
  loupeOpacity,
  isEdgeScrubbing,
  mainScrollRef,
  isCinema = false,
  topInset = 80,
  bottomInset = 60,
}: SpatialFilmLoupeProps) {
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  const thumbCount = thumbnails.length;

  const triggerHaptic = useCallback(() => {
    try {
      Haptics.selectionAsync();
    } catch (_) {}
  }, []);

  // Update the displayed photo index only when crossing into a new sample slice (runs only ~100 times over full gallery)
  useAnimatedReaction(
    () => {
      'worklet';
      if (thumbCount <= 0) return 0;
      const maxScroll = Math.max(1, contentHeight.value - layoutHeight.value);
      const progress = Math.max(0, Math.min(1, scrollY.value / maxScroll));
      return Math.min(thumbCount - 1, Math.max(0, Math.floor(progress * thumbCount)));
    },
    (nextIdx, prevIdx) => {
      if (nextIdx !== prevIdx) {
        runOnJS(setActivePhotoIndex)(nextIdx);
        if (isEdgeScrubbing.value) {
          runOnJS(triggerHaptic)();
        }
      }
    },
    [thumbCount, triggerHaptic]
  );

  // Vertical gliding track bounds
  const minLoupeY = topInset + 20;
  const maxLoupeY = SCREEN_HEIGHT - bottomInset - 110;

  const loupeAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    const maxScroll = Math.max(1, contentHeight.value - layoutHeight.value);
    const progress = Math.max(0, Math.min(1, scrollY.value / maxScroll));
    const targetY = interpolate(progress, [0, 1], [minLoupeY, maxLoupeY], 'clamp');

    return {
      opacity: loupeOpacity.value,
      transform: [
        { translateY: targetY },
        { scale: interpolate(loupeOpacity.value, [0, 1], [0.82, 1], 'clamp') },
      ],
      pointerEvents: loupeOpacity.value > 0.05 ? ('auto' as const) : ('none' as const),
    };
  });

  // Invisible Edge Pan Gesture: Touching or dragging the right 36px activates the loupe directly
  const edgePanGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onBegin(() => {
      'worklet';
      isEdgeScrubbing.value = true;
      loupeOpacity.value = withTiming(1, { duration: 100 });
      runOnJS(triggerHaptic)();
    })
    .onUpdate((event) => {
      'worklet';
      const trackSpan = Math.max(1, maxLoupeY - minLoupeY);
      const touchY = event.y;
      const progress = Math.max(0, Math.min(1, (touchY - minLoupeY) / trackSpan));

      const maxScroll = Math.max(1, contentHeight.value - layoutHeight.value);
      const targetScrollY = progress * maxScroll;

      // Scroll FlashList directly on UI thread
      scrollTo(mainScrollRef, 0, targetScrollY, false);
    })
    .onFinalize(() => {
      'worklet';
      isEdgeScrubbing.value = false;
      loupeOpacity.value = withTiming(0, { duration: 320 });
    });

  // If Cinema tab is active or no thumbnails exist, do not render
  if (isCinema || thumbCount === 0) {
    return null;
  }

  const currentUri = thumbnails[activePhotoIndex] || thumbnails[0] || '';

  return (
    <>
      {/* ── Invisible 36px Right Edge Hitbox (Accessibility Gutter) ── */}
      <GestureDetector gesture={edgePanGesture}>
        <Animated.View
          style={[
            styles.edgeHitbox,
            {
              top: minLoupeY,
              bottom: SCREEN_HEIGHT - maxLoupeY,
            },
          ]}
        />
      </GestureDetector>

      {/* ── Pure-Photo Film Loupe Card (No text, pure photography) ── */}
      <Animated.View style={[styles.loupeContainer, loupeAnimatedStyle]}>
        <View style={styles.loupeCard}>
          {currentUri ? (
            <Image
              source={{ uri: currentUri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={80}
            />
          ) : (
            <View style={styles.emptyCard} />
          )}
        </View>

        {/* Tactile Golden Laser Bead against Bezel */}
        <View style={styles.laserBead} />
      </Animated.View>
    </>
  );
});

const styles = StyleSheet.create({
  edgeHitbox: {
    position: 'absolute',
    right: 0,
    width: 36,
    zIndex: 49,
    backgroundColor: 'transparent',
  },
  loupeContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
  },
  loupeCard: {
    width: 66,
    height: 88,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0a0a0c',
    borderWidth: 1.5,
    borderColor: '#d4af37',
    marginRight: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.65,
        shadowRadius: 16,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  emptyCard: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1c1c1f',
  },
  laserBead: {
    width: 3,
    height: 24,
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
    backgroundColor: '#d4af37',
    ...Platform.select({
      ios: {
        shadowColor: '#d4af37',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 6,
      },
      android: {
        elevation: 6,
      },
    }),
  },
});
