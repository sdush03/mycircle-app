import React, { useCallback } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  Modal, 
  ScrollView, 
  Image, 
  Pressable,
  StatusBar,
  Dimensions,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, Easing, runOnJS } from 'react-native-reanimated';
import { FONT_MONTSERRAT_REGULAR, FONT_JOST_REGULAR, FONT_JOST_SEMIBOLD } from '../../constants/fonts';

const { width: screenWidth, height: screenHeight } = Dimensions.get('screen');

interface Article {
  id: string;
  title: string;
  category: string;
  date: string;
  readTime: string;
  coverImage: any;
  content: string[];
}

interface ArticleViewProps {
  isOpen: boolean;
  onClose: () => void;
  article: Article | null;
}

const formatDateText = (rawDate?: string): string => {
  if (!rawDate) return '';
  const isoMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const monthIndex = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    if (months[monthIndex]) {
      return `${months[monthIndex]} ${day}, ${year}`;
    }
  }

  const parsed = new Date(rawDate);
  if (!isNaN(parsed.getTime())) {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return `${months[parsed.getMonth()]} ${parsed.getDate()}, ${parsed.getFullYear()}`;
  }

  return rawDate;
};

export default function ArticleView({ isOpen, onClose, article }: ArticleViewProps) {
  const insets = useSafeAreaInsets();
  // Native iOS Left-Edge Swipe Back Gesture
  const touchStartedOnLeftEdge = useSharedValue(false);
  const screenSwipeX = useSharedValue(0);

  const handleCloseScreen = useCallback(() => {
    screenSwipeX.value = withTiming(screenWidth, { duration: 220, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) {
        runOnJS(onClose)();
      }
    });
  }, [onClose]);

  // Android hardware back button handler
  React.useEffect(() => {
    if (!isOpen) return;
    const onBackPress = () => {
      handleCloseScreen();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [isOpen, handleCloseScreen]);

  const edgeSwipeGesture = Gesture.Pan()
    .activeOffsetX(15)
    .failOffsetY([-25, 25])
    .onStart((e) => {
      'worklet';
      touchStartedOnLeftEdge.value = e.x <= 45;
    })
    .onUpdate((e) => {
      'worklet';
      if (!touchStartedOnLeftEdge.value) return;
      if (e.translationX > 0) {
        screenSwipeX.value = e.translationX;
      }
    })
    .onEnd((e) => {
      'worklet';
      if (!touchStartedOnLeftEdge.value) return;
      if (e.translationX > screenWidth * 0.25 || e.velocityX > 400) {
        screenSwipeX.value = withTiming(screenWidth, { duration: 220, easing: Easing.out(Easing.quad) }, (finished) => {
          if (finished) {
            runOnJS(onClose)();
          }
        });
      } else {
        screenSwipeX.value = withSpring(0, { damping: 25, stiffness: 200 });
      }
      touchStartedOnLeftEdge.value = false;
    });

  const screenSwipeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: screenSwipeX.value }],
  }));

  React.useEffect(() => {
    if (isOpen) {
      // Slide in from right on open
      screenSwipeX.value = screenWidth;
      screenSwipeX.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) });
    }
  }, [isOpen]);

  if (!article) return null;

  const categoryText = (article.category || '').toUpperCase();
  const titleText = article.title || '';
  const dateText = formatDateText(article.date);
  const readTimeText = article.readTime || '';
  const contentParagraphs = Array.isArray(article.content) ? article.content : [];

  return (
    <Modal
      visible={isOpen}
      animationType="none"
      transparent={true}
      presentationStyle="overFullScreen"
      onRequestClose={handleCloseScreen}
      statusBarTranslucent={true}
    >
      <GestureHandlerRootView style={styles.container}>
        <GestureDetector gesture={edgeSwipeGesture}>
          <Animated.View style={[{ flex: 1, backgroundColor: '#ffffff' }, screenSwipeAnimatedStyle]}>
            <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

            {/* Borderless Editorial Back Button */}
            <Pressable 
              style={[styles.editorialBackButton, { top: Math.max(insets.top + 16, 48) }]} 
              onPress={handleCloseScreen}
              hitSlop={16}
            >
              <Text style={styles.editorialBackText}>← BACK</Text>
            </Pressable>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Cover Image */}
          <View style={styles.coverContainer}>
            <Image source={article.coverImage} style={styles.coverImage} />
            <View style={styles.coverOverlay} />
          </View>

          {/* Article Header Metadata */}
          <View style={styles.metaContainer}>
            {categoryText ? <Text style={styles.articleCategory}>{categoryText}</Text> : null}
            {titleText ? <Text style={styles.articleTitle}>{titleText}</Text> : null}
            <View style={styles.metaRow}>
              {dateText ? <Text style={styles.metaText}>{dateText}</Text> : null}
              <Text style={styles.metaDivider}>•</Text>
              {readTimeText ? <Text style={styles.metaText}>{readTimeText}</Text> : null}
              <Text style={styles.metaDivider}>•</Text>
              <Text style={styles.metaText}>By Misty Visuals</Text>
            </View>
            <View style={styles.lineDivider} />
          </View>

          {/* Body Content */}
          <View style={styles.bodyContainer}>
            {contentParagraphs.map((paragraph, index) => {
              const isFirst = index === 0;
              return (
                <Text 
                  key={index} 
                  style={[
                    styles.bodyParagraph, 
                    isFirst && styles.firstParagraph
                  ]}
                >
                  {paragraph}
                </Text>
              );
            })}
          </View>

          {/* Editorial Footer */}
          <View style={styles.footerContainer}>
            <View style={styles.footerDivider} />
            <Text style={styles.footerBrand}>MISTY VISUALS</Text>
            <Text style={styles.footerTagline}>FINE ART WEDDING PHOTOGRAPHY & FILMS</Text>
          </View>
        </ScrollView>
      </Animated.View>
    </GestureDetector>
  </GestureHandlerRootView>
</Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  editorialBackButton: {
    position: 'absolute',
    left: 24,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  editorialBackText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.5,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scrollContent: {
    paddingBottom: 60,
  },
  coverContainer: {
    width: '100%',
    height: Math.round(screenHeight * 0.70),
    backgroundColor: '#f5f5f5',
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.15)', // Gradient/tint overlay for close button contrast
  },
  metaContainer: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
  },
  articleCategory: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 3,
    color: '#8c867e',
    marginBottom: 12,
  },
  articleTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 24,
    color: '#1c1a18',
    lineHeight: 32,
    marginBottom: 16,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  metaText: {
    fontSize: 11,
    color: '#8c867e',
    letterSpacing: 0.5,
  },
  metaDivider: {
    fontSize: 11,
    color: '#ddd8d0',
    marginHorizontal: 8,
  },
  lineDivider: {
    width: '100%',
    height: 1,
    backgroundColor: '#f0ede8',
  },
  bodyContainer: {
    paddingHorizontal: 24,
  },
  bodyParagraph: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 15,
    lineHeight: 25,
    color: '#3a3630',
    marginBottom: 20,
  },
  firstParagraph: {
    fontSize: 17,
    lineHeight: 30,
    color: '#1c1a18',
  },
  footerContainer: {
    paddingHorizontal: 24,
    paddingTop: 40,
    alignItems: 'center',
  },
  footerDivider: {
    width: 60,
    height: 1,
    backgroundColor: '#ddd8d0',
    marginBottom: 24,
  },
  footerBrand: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 4,
    color: '#1c1a18',
    marginBottom: 6,
  },
  footerTagline: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 2,
    color: '#8c867e',
  },
});
