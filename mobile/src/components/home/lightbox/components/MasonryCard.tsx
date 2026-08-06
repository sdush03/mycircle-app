import React, { useState, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { savePhotoAspect } from '../../../../utils/photoDimensionCache';

export interface MasonryCardProps {
  img: any;
  index: number;
  isColumn0: boolean;
  isHighPriority?: boolean;
  onSelect: (bounds: { x: number; y: number; width: number; height: number } | null) => void;
  onRegisterRef?: (cardId: string, ref: View | null) => void;
  onToggleLike?: (img: any) => void;
}

const DEFAULT_NEUTRAL_BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

export const MasonryCard = React.memo(function MasonryCard({ 
  img, index, isColumn0, isHighPriority, onSelect, onRegisterRef, onToggleLike
}: MasonryCardProps) {
  const cardRef = useRef<View>(null);
  const cardId = String(img.id || img.uri || `idx-${index}`);
  const primaryUri = typeof img === 'object' && img.uri ? img.uri : (typeof img === 'string' ? img : '');
  const fallbackUri = typeof img === 'object' && img.fullUri ? img.fullUri : '';
  const blurUri = typeof img === 'object' && img.blurUri ? img.blurUri : null;
  const blurhash = typeof img === 'object' && (img.blurhash || img.blur_hash || img.blurHash)
    ? (img.blurhash || img.blur_hash || img.blurHash)
    : null;
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const activeUri = (failedUri === primaryUri && fallbackUri) ? fallbackUri : primaryUri;

  const realAspect = (typeof img === 'object' && img.width && img.height && Number(img.height) > 0)
    ? Number(img.width) / Number(img.height)
    : (typeof img === 'object' && img.aspectRatio && !isNaN(img.aspectRatio) && img.aspectRatio > 0 ? img.aspectRatio : null);
  const isLandscape = Boolean(realAspect && realAspect > 1.05);

  const cardAspect = (typeof img === 'object' && img.cardAspect)
    ? img.cardAspect
    : (isLandscape && realAspect
      ? realAspect
      : ((index + (isColumn0 ? 0 : 1)) % 3 === 0 ? 0.67 : ((index + (isColumn0 ? 0 : 1)) % 3 === 1 ? 0.75 : 0.80)));

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

  const DEFAULT_BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DGR4';
  const effectiveBlurhash = blurhash || DEFAULT_BLURHASH;

  const placeholderSource = blurUri
    ? { uri: blurUri }
    : { blurhash: effectiveBlurhash, width: 32, height: 32 };

  const effectivePriority = typeof isHighPriority === 'boolean'
    ? (isHighPriority ? "high" : "low")
    : (index < 10 ? "high" : "low");

  return (
    <Pressable 
      ref={(ref) => {
        (cardRef as any).current = ref;
        if (onRegisterRef) onRegisterRef(cardId, ref);
      }} 
      style={[cardStyles.masonryCard, { width: '100%', aspectRatio: cardAspect }]} 
      onPress={handlePress}
    >
      {activeUri ? (
        <Image
          source={{ uri: activeUri }}
          style={cardStyles.masonryImage}
          contentFit="cover"
          priority={effectivePriority}
          cachePolicy="memory-disk"
          recyclingKey={String(cardId)}
          placeholder={placeholderSource}
          placeholderContentFit="cover"
          transition={50}
          onLoadStart={() => {
            loadStartTimeRef.current = Date.now();
          }}
          onLoad={(e) => {
            if (e.source?.width && e.source?.height) {
              const aspect = e.source.width / e.source.height;
              if (cardId) savePhotoAspect(cardId, aspect);
              if (activeUri) savePhotoAspect(activeUri, aspect);
            }
            const elapsed = Date.now() - (loadStartTimeRef.current || Date.now());
            const cacheType = elapsed < 35 ? '💾 CACHE HIT (0-35ms)' : `🌐 NETWORK DOWNLOAD (${elapsed}ms)`;
            const isThumb = activeUri.includes('thumb') || (e.source?.width && e.source.width <= 600);
            const resTag = isThumb ? '🖼️ [THUMBNAIL]' : '4️⃣K [FULL RES ORIGINAL]';
            console.log(`[MYCIRCLE DEBUG 📱 PAINTED ON SCREEN] Grid Card #${index + 1} | Type: ${resTag} | ${cacheType} | Rendered Res: ${e.source?.width}x${e.source?.height}px`);
          }}
          onError={(err) => {
            console.warn(`[MYCIRCLE DEBUG ⚠️] Photo #${index + 1} FAILED to load: ${activeUri}`);
            if (fallbackUri && activeUri !== fallbackUri) setFailedUri(primaryUri);
          }}
        />
      ) : null}

      {/* Bottom-Right Heart & Count Badge (Matching Web) */}
      {(onToggleLike || isLiked || likeCount > 0) ? (
        <Pressable
          style={cardStyles.heartOverlay}
          onPress={handleHeartPress}
          hitSlop={10}
        >
          <Ionicons
            name={isLiked ? 'heart' : 'heart-outline'}
            size={18}
            color={isLiked ? '#ef4444' : '#ffffff'}
            style={cardStyles.heartShadow}
          />
          {likeCount > 0 ? (
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
    prevProps.isHighPriority === nextProps.isHighPriority &&
    prevProps.img?.id === nextProps.img?.id &&
    prevProps.img?.uri === nextProps.img?.uri &&
    prevProps.img?.r2Url === nextProps.img?.r2Url &&
    prevProps.img?.isLiked === nextProps.img?.isLiked
  );
});

const cardStyles = StyleSheet.create({
  masonryCard: {
    width: '100%',
    backgroundColor: '#ffffff',
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
});
