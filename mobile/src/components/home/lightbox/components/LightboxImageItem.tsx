import React, { useState, useRef } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import { Image } from 'expo-image';
// @ts-ignore
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, SharedValue } from 'react-native-reanimated';
import { useApplePhotosGesture } from '../gestures/AppleGestureEngine';

const { width: defaultScreenWidth, height: defaultScreenHeight } = Dimensions.get('screen');

export interface LightboxImageItemProps {
  item: any;
  width: number;
  onDoubleTap: () => void;
  onNavigate: (direction: 'next' | 'prev') => void;
  onZoomChange: (isZoomed: boolean) => void;
  onToggleControls: () => void;
  onCloseLightbox: () => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  expandProgress: SharedValue<number>;
  heartPopScale: SharedValue<number>;
  heartPopOpacity: SharedValue<number>;
}

export const LightboxImageItem = React.memo(function LightboxImageItem({
  item,
  width = defaultScreenWidth,
  onDoubleTap,
  onNavigate,
  onZoomChange,
  onToggleControls,
  onCloseLightbox,
  onInteractionStart,
  onInteractionEnd,
  expandProgress,
  heartPopScale,
  heartPopOpacity,
}: LightboxImageItemProps) {
  const [loadedAspect, setLoadedAspect] = useState<number | null>(null);

  const rawAspect = typeof item === 'object' && (item.aspectRatio || item.cardAspect)
    ? (item.aspectRatio || item.cardAspect)
    : (typeof item === 'object' && item.width && item.height && item.height > 0
      ? item.width / item.height
      : null);

  const imageAspect = rawAspect || loadedAspect;

  const {
    scale,
    translateX,
    translateY,
    composedGesture,
  } = useApplePhotosGesture({
    width,
    screenHeight: defaultScreenHeight,
    containerW: width,
    containerH: defaultScreenHeight,
    imageAspect,
    expandProgress,
    onZoomChange,
    onToggleControls,
    onCloseLightbox,
    onInteractionStart,
    onInteractionEnd,
  });

  const heartPopAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartPopScale.value }],
    opacity: heartPopOpacity.value,
  }));

  const imageZoomAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const getMediaUri = (i: any): string | null => {
    if (!i) return null;
    if (typeof i === 'string') return i;
    return (
      i.fullUri ||
      i.r2Url ||
      i.r2_url ||
      i.file_url ||
      i.file_url_mobile ||
      i.url ||
      i.imageUrl ||
      i.photoUrl ||
      i.thumbnailUrl ||
      i.uri ||
      null
    );
  };

  const thumbnailUri = typeof item === 'object' ? (item.r2Url || item.thumbnailUrl || item.uri || getMediaUri(item)) : item;
  const fullUri = typeof item === 'object' ? (item.fullUri || item.r2_url || item.file_url || item.url || thumbnailUri) : item;

  const [currentUri, setCurrentUri] = useState<string | null>(fullUri || thumbnailUri);

  React.useEffect(() => {
    setCurrentUri(fullUri || thumbnailUri);
  }, [fullUri, thumbnailUri]);

  const loadStartRef = useRef<number>(0);

  return (
    <GestureDetector gesture={composedGesture}>
      <View style={{ width, height: '100%', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        <Animated.View style={[styles.lightboxImageStack, imageZoomAnimatedStyle]}>
          {/* Layer 1: Instant 0ms Cached Grid Thumbnail (Guarantees ZERO black screens) */}
          {thumbnailUri && currentUri !== thumbnailUri && (
            <Image
              source={{ uri: thumbnailUri }}
              style={[styles.lightboxImage, StyleSheet.absoluteFillObject]}
              contentFit="contain"
              cachePolicy="memory-disk"
              priority="high"
            />
          )}

          {/* Layer 2: Main Image with Failover Fallback */}
          {currentUri && (
            <Image
              source={{ uri: currentUri }}
              style={styles.lightboxImage}
              contentFit="contain"
              cachePolicy="memory-disk"
              priority="high"
              transition={150}
              onLoadStart={() => {
                loadStartRef.current = Date.now();
              }}
              onLoad={(e) => {
                const duration = Date.now() - (loadStartRef.current || Date.now());
                const sourceTag = duration < 35 ? '💾 DISK CACHE HIT (0-35ms)' : `🌐 NETWORK DOWNLOAD (${duration}ms)`;
                console.log(`[MYCIRCLE DEBUG 🔎 LIGHTBOX PAINTED] High-Res Photo Rendered | Source: ${sourceTag} | Dimensions: ${e.source?.width}x${e.source?.height}px`);
                if (e.source && e.source.width && e.source.height && e.source.height > 0) {
                  setLoadedAspect(e.source.width / e.source.height);
                }
              }}
              onError={(err) => {
                console.warn(`[MYCIRCLE DEBUG ⚠️] Lightbox photo failed to load: ${currentUri}`, err);
                if (thumbnailUri && currentUri !== thumbnailUri) {
                  setCurrentUri(thumbnailUri);
                }
              }}
            />
          )}
          {/* Layer 3: Heart Pop Center Animation Overlay */}
          <Animated.View 
            style={[
              styles.heartPopContainer, 
              heartPopAnimatedStyle
            ]} 
            pointerEvents="none"
          >
            <Ionicons name="heart" size={80} color="rgba(255, 255, 255, 0.75)" style={styles.heartPopShadow} />
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  lightboxImageStack: {
    width: defaultScreenWidth,
    height: '100%',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxImage: {
    width: defaultScreenWidth,
    height: '100%',
  },
  heartPopContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heartPopShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
});
