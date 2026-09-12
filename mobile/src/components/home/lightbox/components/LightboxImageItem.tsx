import React, { useState, useRef } from 'react';
import { StyleSheet, View, Dimensions, Pressable } from 'react-native';
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
  onPlayVideo?: (item: any) => void;
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
  onPlayVideo,
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

  const isVideoFileUrl = (u: string | null | undefined): boolean => {
    if (!u || typeof u !== 'string') return false;
    const clean = u.split('?')[0].toLowerCase();
    return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.webm');
  };

  const getImageOnlyUri = (i: any): string | null => {
    if (!i || typeof i !== 'object') return null;
    // Return the first candidate that is an image URL (not a video file)
    const candidates = [
      i.thumbnailUrl, i.thumbUri, i.coverUrl, i.cover_url,
      i.posterUrl, i.poster_url, i.coverPhotoUrl, i.cover_photo_url,
      i.preview_url, i.uri, i.r2Url, i.fullUri, i.photoUrl, i.url,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.startsWith('http') && !isVideoFileUrl(c)) return c;
    }
    return null;
  };

  const thumbnailUri = typeof item === 'object'
    ? (isVideoFileUrl(item.r2Url) ? (getImageOnlyUri(item) || item.r2Url) : (item.r2Url || item.thumbnailUrl || item.uri || getImageOnlyUri(item)))
    : item;
  const fullUri = typeof item === 'object' ? (item.fullUri || item.r2_url || item.file_url || item.url || thumbnailUri) : item;

  const isVideo =
    !!item?.isVideo ||
    (typeof item?.tabName === 'string' && item.tabName.trim().toUpperCase() === 'CINEMA') ||
    (typeof fullUri === 'string' && (fullUri.endsWith('.mp4') || fullUri.endsWith('.mov') || fullUri.includes('/videos/')));

  // For videos, always show an image thumbnail (never a .mp4 URL); fall back to any image-only URI
  const displayUri = isVideo
    ? (isVideoFileUrl(thumbnailUri) ? getImageOnlyUri(item) : thumbnailUri) || getImageOnlyUri(item)
    : (fullUri || thumbnailUri);

  const [currentUri, setCurrentUri] = useState<string | null>(displayUri);

  React.useEffect(() => {
    setCurrentUri(displayUri);
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
  }, [displayUri, scale, translateX, translateY]);

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

          {/* Layer 3: Video Play Button Overlay */}
          {isVideo ? (
            <Pressable
              style={styles.playButtonOverlay}
              onPress={() => {
                if (onPlayVideo) {
                  onPlayVideo(item);
                }
              }}
              hitSlop={20}
            >
              <View style={styles.playButtonCircle}>
                <Ionicons name="play" size={32} color="#ffffff" style={{ marginLeft: 3 }} />
              </View>
            </Pressable>
          ) : null}

          {/* Layer 4: Heart Pop Center Animation Overlay */}
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
  playButtonOverlay: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  playButtonCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
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
