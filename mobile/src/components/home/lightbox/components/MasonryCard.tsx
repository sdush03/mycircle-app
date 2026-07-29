import React, { useState, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

export interface MasonryCardProps {
  img: any;
  index: number;
  isColumn0: boolean;
  onSelect: (bounds: { x: number; y: number; width: number; height: number } | null) => void;
  onRegisterRef?: (cardId: string, ref: View | null) => void;
  onToggleLike?: (img: any) => void;
}

export const MasonryCard = React.memo(function MasonryCard({ 
  img, index, isColumn0, onSelect, onRegisterRef, onToggleLike
}: MasonryCardProps) {
  const cardRef = useRef<View>(null);
  const cardId = String(img.id || img.uri || `idx-${index}`);
  const primaryUri = typeof img === 'object' && img.uri ? img.uri : (typeof img === 'string' ? img : '');
  const fallbackUri = typeof img === 'object' && img.fullUri ? img.fullUri : '';
  const blurUri = typeof img === 'object' && img.blurUri ? img.blurUri : null;
  const [currentUri, setCurrentUri] = useState<string>(primaryUri);

  React.useEffect(() => { setCurrentUri(primaryUri); }, [primaryUri]);

  const cardAspect = (typeof img === 'object' && img.cardAspect)
    ? img.cardAspect
    : ((typeof img === 'object' && img.aspectRatio && !isNaN(img.aspectRatio) && img.aspectRatio > 0)
      ? img.aspectRatio
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

  return (
    <Pressable 
      ref={(ref) => {
        (cardRef as any).current = ref;
        if (onRegisterRef) onRegisterRef(cardId, ref);
      }} 
      style={[cardStyles.masonryCard, { aspectRatio: cardAspect }]} 
      onPress={handlePress}
    >
      {currentUri ? (
        <Image
          source={{ uri: currentUri }}
          style={cardStyles.masonryImage}
          contentFit="cover"
          priority={index < 40 ? "high" : "normal"}
          cachePolicy="memory-disk"
          recyclingKey={String(cardId)}
          placeholder={blurUri ? { uri: blurUri } : undefined}
          placeholderContentFit="cover"
          transition={blurUri ? 200 : 0}
          onLoadStart={() => {
            loadStartTimeRef.current = Date.now();
          }}
          onLoad={(e) => {
            const elapsed = Date.now() - (loadStartTimeRef.current || Date.now());
            const cacheType = elapsed < 35 ? '💾 CACHE HIT (0-35ms)' : `🌐 NETWORK DOWNLOAD (${elapsed}ms)`;
            const isThumb = currentUri.includes('thumb') || (e.source?.width && e.source.width <= 600);
            const resTag = isThumb ? '🖼️ [THUMBNAIL]' : '4️⃣K [FULL RES ORIGINAL]';
            console.log(`[MYCIRCLE DEBUG 📱 PAINTED ON SCREEN] Grid Card #${index + 1} | Type: ${resTag} | ${cacheType} | Rendered Res: ${e.source?.width}x${e.source?.height}px`);
          }}
          onError={(err) => {
            console.warn(`[MYCIRCLE DEBUG ⚠️] Photo #${index + 1} FAILED to load: ${currentUri}`);
            if (fallbackUri && currentUri !== fallbackUri) setCurrentUri(fallbackUri);
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
});

const cardStyles = StyleSheet.create({
  masonryCard: {
    width: '100%',
    backgroundColor: '#f5f5f5',
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
