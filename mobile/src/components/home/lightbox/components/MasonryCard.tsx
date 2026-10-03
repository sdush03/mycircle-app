import React, { useState, useRef, useCallback, useEffect } from 'react';
import { StyleSheet, View, Text, Pressable, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { savePhotoAspect, getPhotoCardAspect } from '../../../../utils/photoDimensionCache';
import { videoPreloadManager } from '../../../../services/videoPreloadManager';

export interface MasonryCardProps {
  img: any;
  index: number;
  isColumn0?: boolean;
  columnIndex?: number;
  numColumns?: number;
  isHighPriority?: boolean;
  onSelect: (bounds: { x: number; y: number; width: number; height: number } | null) => void;
  onRegisterRef?: (cardId: string, ref: View | null) => void;
  onToggleLike?: (img: any) => void;
}

const DEFAULT_NEUTRAL_BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

export const MasonryCard = React.memo(function MasonryCard({ 
  img, index, isColumn0, columnIndex, numColumns = 2, isHighPriority, onSelect, onRegisterRef, onToggleLike
}: MasonryCardProps) {
  const cardRef = useRef<View>(null);
  const cardId = String(img?.id || img?.uri || `idx-${index}`);
  const primaryUri = typeof img === 'object' && img?.uri ? img.uri : (typeof img === 'string' ? img : '');
  const fallbackUri = typeof img === 'object' && img.fullUri ? img.fullUri : '';
  const blurUri = typeof img === 'object' && img.blurUri ? img.blurUri : null;
  const blurhash = typeof img === 'object' && (img.blurhash || img.blur_hash || img.blurHash)
    ? (img.blurhash || img.blur_hash || img.blurHash)
    : null;
  const [failedUri, setFailedUri] = useState<string | null>(null);

  // Generate deterministic organic stagger & duration based on cardId/index
  const { randomDelay, randomDuration, startScale } = React.useMemo(() => {
    let hash = 0;
    const key = `${cardId}-${index}`;
    for (let i = 0; i < key.length; i++) {
      hash = (hash << 5) - hash + key.charCodeAt(i);
      hash |= 0;
    }
    const abs = Math.abs(hash);

    // Stagger delay between 0ms and 210ms in organic intervals (0, 28, 56, 84, 112, 140, 168, etc.)
    const delay = ((abs % 7) * 28) + ((abs % 3) * 12); // Range: 0 to 192ms
    // Duration between 380ms and 480ms
    const duration = 380 + (abs % 5) * 22; // Range: 380 to 468ms
    // Start scale slightly varied: 1.05 to 1.08
    const scaleVal = 1.05 + (abs % 4) * 0.01;

    return { randomDelay: delay, randomDuration: duration, startScale: scaleVal };
  }, [cardId, index]);

  const scale = useSharedValue(startScale);
  const opacity = useSharedValue(0);

  useEffect(() => {
    setFailedUri(null);
    scale.value = startScale;
    opacity.value = 0;
  }, [primaryUri, startScale, scale, opacity]);

  const animatedImageStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      width: '100%',
      height: '100%',
      transform: [{ scale: scale.value }],
      opacity: opacity.value,
    };
  });
  const activeUri = (failedUri === primaryUri && fallbackUri) ? fallbackUri : primaryUri;

  const colIdx = typeof columnIndex === 'number' ? columnIndex : (isColumn0 ? 0 : 1);
  const cardAspect = getPhotoCardAspect(img, index, colIdx, numColumns);

  const isLiked = typeof img === 'object' && !!img.isLiked;
  const likeCount = typeof img === 'object' && typeof img.likeCount === 'number' ? img.likeCount : 0;

  const handlePress = useCallback(() => {
    if (cardRef.current) {
      cardRef.current.measureInWindow((x, y, width, height) => {
        onSelect({ x, y, width, height });
      });
    } else {
      onSelect(null);
    }
  }, [onSelect]);

  const handleHeartPress = useCallback((e: any) => {
    e?.stopPropagation?.();
    if (onToggleLike) {
      onToggleLike(img);
    }
  }, [onToggleLike, img]);

  const loadStartTimeRef = useRef<number>(0);

  // Only pass placeholder if a real blurUri or blurhash exists (don't pass dummy fallback blurhash string
  // which causes Android's Glide decoder to fail and freeze transparent)
  const placeholderSource = blurUri
    ? { uri: blurUri }
    : (blurhash ? { blurhash, width: 32, height: 32 } : undefined);

  const effectivePriority = typeof isHighPriority === 'boolean'
    ? (isHighPriority ? "high" : "normal")
    : (index < 30 ? "high" : "normal");

  const isVideo =
    !!img?.isVideo ||
    (typeof img?.tabName === 'string' && img.tabName.trim().toUpperCase() === 'CINEMA') ||
    (typeof fallbackUri === 'string' && (fallbackUri.endsWith('.mp4') || fallbackUri.endsWith('.mov') || fallbackUri.includes('/videos/'))) ||
    (typeof primaryUri === 'string' && (primaryUri.endsWith('.mp4') || primaryUri.endsWith('.mov') || primaryUri.includes('/videos/')));

  // Instagram-style Preload: Pre-warm upcoming video player and poster when card renders
  useEffect(() => {
    if (isVideo) {
      const vUrl = img?.videoUrl || img?.fullUri || img?.r2Url || fallbackUri || (typeof primaryUri === 'string' && (primaryUri.endsWith('.mp4') || primaryUri.endsWith('.mov') || primaryUri.includes('/videos/')) ? primaryUri : null);
      const tUrl = img?.thumbnailUrl || img?.thumbUri || (activeUri && !activeUri.endsWith('.mp4') ? activeUri : null);
      if (vUrl && typeof vUrl === 'string' && vUrl.startsWith('http')) {
        videoPreloadManager.preload(vUrl, tUrl);
      }
    }
  }, [isVideo, img?.videoUrl, img?.fullUri, img?.r2Url, fallbackUri, primaryUri, activeUri]);

  const isVideoFile = (uri: string | null | undefined) => {
    if (!uri || typeof uri !== 'string') return false;
    const clean = uri.split('?')[0].toLowerCase();
    if (clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.webm')) {
      return true;
    }
    if (uri.includes('/api/gallery/resize')) {
      const lower = uri.toLowerCase();
      return lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.m4v') || lower.includes('.webm');
    }
    return false;
  };

  const rawThumb = typeof img === 'object' ? (img.thumbnailUrl || img.thumbUri) : null;
  const validThumb = rawThumb && !isVideoFile(rawThumb) ? rawThumb : null;
  let candidateUri = validThumb || (!isVideoFile(activeUri) ? activeUri : null);
  if (candidateUri && candidateUri.startsWith('/')) {
    candidateUri = `https://mycircle.mistyvisuals.com${candidateUri}`;
  }
  const imageDisplayUri = candidateUri;

  return (
    <Pressable 
      ref={(ref) => {
        (cardRef as any).current = ref;
        if (onRegisterRef) onRegisterRef(cardId, ref);
      }} 
      style={[cardStyles.masonryCard, { width: '100%', height: '100%' }]} 
      onPress={handlePress}
    >
      {imageDisplayUri ? (
        <Animated.View style={animatedImageStyle}>
          <Image
            source={{ uri: imageDisplayUri }}
            style={cardStyles.masonryImage}
            contentFit="cover"
            priority={effectivePriority}
            cachePolicy="memory-disk"
            placeholder={placeholderSource}
            placeholderContentFit="cover"
            transition={0}
            onLoadStart={() => {
              loadStartTimeRef.current = Date.now();
            }}
            onLoad={(e) => {
              scale.value = withDelay(
                randomDelay,
                withTiming(1, {
                  duration: randomDuration,
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                })
              );
              opacity.value = withDelay(
                randomDelay,
                withTiming(1, {
                  duration: Math.max(280, randomDuration - 40),
                  easing: Easing.out(Easing.quad),
                })
              );
              if (e.source?.width && e.source?.height) {
                const aspect = e.source.width / e.source.height;
                if (cardId) savePhotoAspect(cardId, aspect);
                if (imageDisplayUri) savePhotoAspect(imageDisplayUri, aspect);
              }
              const elapsed = Date.now() - (loadStartTimeRef.current || Date.now());
              const cacheType = elapsed < 35 ? '💾 CACHE HIT (0-35ms)' : `🌐 NETWORK DOWNLOAD (${elapsed}ms)`;
              const isThumb = imageDisplayUri.includes('thumb') || imageDisplayUri.includes('mobile') || imageDisplayUri.includes('/api/gallery/resize') || (e.source?.width && e.source.width <= 600);
              const resTag = isThumb ? '🖼️ [THUMBNAIL]' : '4️⃣K [FULL RES ORIGINAL]';
              console.log(`[MYCIRCLE DEBUG 📱 PAINTED ON SCREEN] Grid Card #${index + 1} | Stagger: +${randomDelay}ms | Type: ${resTag} | ${cacheType} | Rendered Res: ${e.source?.width}x${e.source?.height}px`);
            }}
            onError={() => {
              console.warn(`[MYCIRCLE DEBUG ⚠️] Photo #${index + 1} FAILED to load: ${imageDisplayUri}`);
              if (fallbackUri && imageDisplayUri !== fallbackUri && !isVideoFile(fallbackUri)) setFailedUri(primaryUri);
            }}
          />
        </Animated.View>
      ) : (
        <View style={[cardStyles.masonryImage, { backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center' }]}>
          <Ionicons name="videocam-outline" size={28} color="rgba(255, 255, 255, 0.25)" />
        </View>
      )}

      {/* Centered Play Badge for Video Media */}
      {isVideo ? (
        <View style={cardStyles.playIconContainer} pointerEvents="none">
          <View style={[
            cardStyles.playIconCircle,
            numColumns >= 5 ? { width: 22, height: 22, borderRadius: 11 } :
            numColumns === 4 ? { width: 28, height: 28, borderRadius: 14 } :
            numColumns === 3 ? { width: 36, height: 36, borderRadius: 18 } : undefined
          ]}>
            <Ionicons
              name="play"
              size={numColumns >= 5 ? 11 : (numColumns === 4 ? 14 : (numColumns === 3 ? 16 : 18))}
              color="#ffffff"
              style={{ marginLeft: 1 }}
            />
          </View>
        </View>
      ) : null}

      {/* Bottom-Right Heart & Count Badge (Matching Web) */}
      {(numColumns >= 4 ? isLiked : (onToggleLike || isLiked || likeCount > 0)) ? (
        <Pressable
          style={[cardStyles.heartOverlay, numColumns >= 4 && { bottom: 2, right: 3, paddingHorizontal: 0, paddingVertical: 0 }]}
          onPress={handleHeartPress}
          hitSlop={10}
        >
          <Ionicons
            name={isLiked ? 'heart' : 'heart-outline'}
            size={numColumns >= 5 ? 11 : (numColumns === 4 ? 13 : 18)}
            color={isLiked ? '#ef4444' : '#ffffff'}
            style={cardStyles.heartShadow}
          />
          {likeCount > 0 && numColumns < 4 ? (
            <Text style={cardStyles.likeCountText}>{likeCount}</Text>
          ) : null}
        </Pressable>
      ) : null}
    </Pressable>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.index === nextProps.index &&
    prevProps.isColumn0 === nextProps.isColumn0 &&
    prevProps.columnIndex === nextProps.columnIndex &&
    prevProps.numColumns === nextProps.numColumns &&
    prevProps.isHighPriority === nextProps.isHighPriority &&
    prevProps.img?.id === nextProps.img?.id &&
    prevProps.img?.uri === nextProps.img?.uri &&
    prevProps.img?.r2Url === nextProps.img?.r2Url &&
    prevProps.img?.isVideo === nextProps.img?.isVideo &&
    prevProps.img?.isLiked === nextProps.img?.isLiked
  );
});

const cardStyles = StyleSheet.create({
  masonryCard: {
    width: '100%',
    backgroundColor: '#f2eee8',
    overflow: 'hidden',
    position: 'relative',
  },
  masonryImage: {
    width: '100%',
    height: '100%',
  },
  heartOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  heartShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.85,
    shadowRadius: 3,
  },
  likeCountText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'System',
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  playIconContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 4,
    elevation: 4,
  },
});
