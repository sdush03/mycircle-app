import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_FUTURA,
} from '../../constants/fonts';
import {
  CinemaVideoItem,
  getValidImageThumbnail,
} from './CinemaVideoCard';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface ComingSoonTeaser {
  icon: string;
  title: string;
  body: string;
}

export const COMING_SOON_TEASERS: readonly ComingSoonTeaser[] = [
  {
    icon: '🍿',
    title: 'Popcorn on standby',
    body: 'Great stories can’t be microwaved. This blockbuster is simmering on low flame until every emotion is seasoned to perfection.',
  },
  {
    icon: '🤌',
    title: 'Chef’s Secret Recipe',
    body: 'Real cinema takes patience. We don’t rush the good stuff—keep your high-fives and happy tissues handy for premiere day.',
  },
  {
    icon: '🤫',
    title: 'No spoilers, strictly vibes',
    body: 'The romance was simply too iconic to rush out. Savor the anticipation; the best chapters always make a grand entrance.',
  },
  {
    icon: '🎟️',
    title: 'Curtain call in the queue',
    body: 'Legendary love stories deserve red-carpet treatment. Front-row tickets reserved, just waiting for the lights to dim.',
  },
  {
    icon: '🍲',
    title: 'Slow-cooked magic',
    body: 'Fast food is quick, but royal feasts take their sweet time. Your love story is getting the full five-star banquet treatment.',
  },
  {
    icon: '🎬',
    title: 'Houseful feelings incoming',
    body: 'Warning: Excessive smiling, happy tears, and continuous rewinds expected upon premiere. Worth every single second of the wait.',
  },
  {
    icon: '🍷',
    title: 'Vintage cut in reserve',
    body: 'Like fine wine and classic vinyl records, true masterpieces only get richer while they rest. Savor the suspense!',
  },
  {
    icon: '🌶️',
    title: 'Tadka lagna abhi baaki hai',
    body: 'The ingredients are all top-tier, and the flavors are settling in. When this film drops, it’s going to hit just right.',
  },
  {
    icon: '☕',
    title: 'Blockbuster brewing',
    body: 'Some love stories are so big they deserve their own theater marquee. We’re keeping the reel safe until showtime.',
  },
  {
    icon: '🎭',
    title: 'Zero preservatives, 100% drama',
    body: 'Instant noodles take 2 minutes, but timeless memories take care. Pure, unfiltered emotions coming your way.',
  },
  {
    icon: '🛋️',
    title: 'Binge-watch worthy',
    body: 'Prepare your cozy blanket and favorite snacks. When the premiere unlocks, you won’t be able to press pause.',
  },
  {
    icon: '🎞️',
    title: 'The reel is resting',
    body: 'Even rockstars take a moment before walking on stage. The stage is set, and the applause will be deafening.',
  },
  {
    icon: '✨',
    title: 'Main character energy',
    body: 'You brought the charisma, the dance moves, and the chemistry. The big screen is officially waiting on you.',
  },
  {
    icon: '🦸',
    title: 'Patience is a superpower',
    body: 'Good things come to those who wait—especially when the film stars two legends. Grab a seat, the show will begin in style.',
  },
  {
    icon: '📽️',
    title: 'Red carpet reserved',
    body: 'All the smiles, the rituals, and the crazy late-night dancing are safely preserved. Big screen magic awaits!',
  },
  {
    icon: '💃🕺',
    title: 'Bollywood level romance',
    body: 'If Bollywood saw this chemistry, they’d take notes. Keeping the magic under wraps until the red carpet rolls out.',
  },
  {
    icon: '🍰',
    title: 'Sweet surprises take time',
    body: 'You wouldn’t rush a multi-tier wedding cake, would you? Let the sweetness bake. It’s going to be iconic.',
  },
  {
    icon: '🙈',
    title: 'Pure romantic electricity',
    body: 'Too much chemistry in one single film. Warning: butterflies, happy tears, and unstoppable smiles are guaranteed.',
  },
  {
    icon: '🎫',
    title: 'Front row seats saved',
    body: 'No queue jumping allowed. When the projector flickers on, you’ll have the best seat in the entire universe.',
  },
  {
    icon: '🪩',
    title: 'Afterparty on replay',
    body: 'The dance floor was wild, the memories are legendary, and this celebration is going down in history.',
  },
  {
    icon: '👑',
    title: 'Royal treatment only',
    body: 'True royalty doesn’t do express shortcuts. Your celebration deserves nothing less than grand cinematic majesty.',
  },
  {
    icon: '🪕',
    title: 'Dhol beats and pure joy',
    body: 'From the first drumbeat of the baraat to the last dance of the night, every memory is pure nostalgia gold.',
  },
  {
    icon: '💐',
    title: 'The eternal flower toss',
    body: 'The stolen glances, the heartfelt laughter, and the rituals—crafting forever takes genuine care and passion.',
  },
  {
    icon: '💌',
    title: 'Love letter on film',
    body: 'Written with real laughter, sealed with emotional promises, and made to be replayed for decades.',
  },
  {
    icon: '🕶️',
    title: 'Main event swagger',
    body: 'That grand entrance alone set a new standard. Some love stories just naturally look like blockbuster cinema.',
  },
  {
    icon: '🕯️',
    title: 'Golden memories',
    body: 'Warm lights, heartfelt blessings, and two incredible souls. This is the kind of story that never gets old.',
  },
  {
    icon: '🥁',
    title: 'Sangeet energy on standby',
    body: 'Unscripted dance moves, family sing-alongs, and late-night madness. The hype is going to be very real.',
  },
  {
    icon: '🛸',
    title: 'One in a billion',
    body: 'Legends say the universe aligned just for this wedding. We’re keeping the sparkle safe until premiere day.',
  },
  {
    icon: '🧁',
    title: 'The cherry on top',
    body: 'The cake was devoured, the flowers dried, but this film is crafted to taste fresh even fifty years from now.',
  },
  {
    icon: '🌟',
    title: 'Oscar-worthy romance',
    body: 'Script? What script? When real love is this spontaneous, movies can only try to imitate.',
  },
  {
    icon: '💫',
    title: 'Stardust and smiles',
    body: 'Some love stories shine bright enough to illuminate the whole room. Savor the anticipation—it’s worth every second.',
  },
  {
    icon: '🍾',
    title: 'Champagne on ice',
    body: 'A vintage this sparkling deserves to be uncorked with proper ceremony. Keep the celebration glasses ready.',
  },
  {
    icon: '🎁',
    title: 'The best gift takes time',
    body: 'The finest surprises in life are never rushed. Prepare yourself for endless rewinds and happy tears.',
  },
  {
    icon: '💃',
    title: 'Dance floor hall of fame',
    body: 'The moves were bold, the shoes were kicked off, and the energy was electric. An absolute celebration of a lifetime.',
  },
  {
    icon: '📸',
    title: 'Picture perfect moments',
    body: 'Behind every candid laugh was an unforgettable memory. Treating every second with five-star respect.',
  },
  {
    icon: '🎶',
    title: 'Soundtrack to your story',
    body: 'Every cheer from your closest circle and every tender vow—some melodies are meant to last forever.',
  },
  {
    icon: '💖',
    title: 'Tears of pure happiness',
    body: 'Tissues may be required upon premiere. When two families come together like this, the emotions are unmatched.',
  },
  {
    icon: '🎪',
    title: 'Grand celebration archives',
    body: 'All the joy, color, and grandeur of your wedding day, woven together with timeless love and care.',
  },
  {
    icon: '🦚',
    title: 'Royalty in every moment',
    body: 'From heritage rituals to high-energy celebrations, this wedding is living proof that fairy tales exist.',
  },
  {
    icon: '🌠',
    title: 'Destined for greatness',
    body: 'Two hearts, one massive party, and memories that will echo forever. The best is yet to come!',
  },
];

export interface ComingSoonDrawerProps {
  visible: boolean;
  video: CinemaVideoItem | null;
  eventTitle?: string;
  onClose: () => void;
}

function formatFilmTitle(video?: CinemaVideoItem | null): string {
  if (!video) return 'The Wedding Film';
  const t = video.title || video.exif?.title || video.name;
  if (t && t.trim()) {
    return t.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[_.-]+/g, ' ').trim();
  }
  return 'The Wedding Film';
}

export const ComingSoonDrawer: React.FC<ComingSoonDrawerProps> = ({
  visible,
  video,
  eventTitle,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const [teaserIndex, setTeaserIndex] = useState<number>(0);
  const [modalVisible, setModalVisible] = useState(visible);
  const [cachedVideo, setCachedVideo] = useState<CinemaVideoItem | null>(video);

  const backdropOpacity = useSharedValue(0);
  const sheetTranslateY = useSharedValue(SCREEN_HEIGHT);

  useEffect(() => {
    if (video) {
      setCachedVideo(video);
    }
  }, [video]);

  // Exact JoinCelebrationModal animation: cubic bezier slide + backdrop fade
  useEffect(() => {
    if (visible) {
      const randomIndex = Math.floor(Math.random() * COMING_SOON_TEASERS.length);
      setTeaserIndex(randomIndex);
      setModalVisible(true);
      backdropOpacity.value = withTiming(1, { duration: 250 });
      sheetTranslateY.value = withTiming(0, {
        duration: 280,
        easing: Easing.out(Easing.poly(3)),
      });
    } else if (modalVisible) {
      backdropOpacity.value = withTiming(0, { duration: 200 });
      sheetTranslateY.value = withTiming(
        SCREEN_HEIGHT,
        { duration: 220, easing: Easing.in(Easing.poly(3)) },
        () => {
          runOnJS(setModalVisible)(false);
        }
      );
    }
  }, [visible]);

  const activeTeaser = useMemo(() => {
    return COMING_SOON_TEASERS[teaserIndex] || COMING_SOON_TEASERS[0];
  }, [teaserIndex]);

  const handleDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const onCloseComplete = () => {
      setModalVisible(false);
      onClose();
    };

    backdropOpacity.value = withTiming(0, { duration: 200 });
    sheetTranslateY.value = withTiming(
      SCREEN_HEIGHT,
      { duration: 220, easing: Easing.in(Easing.poly(3)) },
      () => {
        runOnJS(onCloseComplete)();
      }
    );
  }, [onClose]);

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  const displayVideo = video || cachedVideo;
  if (!modalVisible || !displayVideo) {
    return null;
  }

  const thumbUrl = getValidImageThumbnail(displayVideo);
  const filmTitle = formatFilmTitle(displayVideo);
  const subtitle = (eventTitle || 'THE WEDDING')
    .replace(/'s\s+Wedding/gi, '')
    .replace('&', '·')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  return (
    <Modal
      visible={modalVisible}
      animationType="none"
      transparent={true}
      onRequestClose={handleDismiss}
      statusBarTranslucent={true}
    >
      <View style={styles.modalRoot}>
        {/* Fade-in dark backdrop (Same as JoinCelebrationModal) */}
        <Animated.View style={[styles.modalBackdrop, backdropAnimatedStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} />
        </Animated.View>

        {/* Bottom-anchored container */}
        <View style={styles.modalOverlayContainer} pointerEvents="box-none">
          {/* Slide-up lower sheet with cubic polynomial easing */}
          <Animated.View
            style={[
              styles.modalSheet,
              { paddingBottom: Math.max(insets.bottom + 16, 28) },
              sheetAnimatedStyle,
            ]}
          >
            {/* Top Drag Handle */}
            <View style={styles.modalDragHandle} />

            {/* Close Button Top Right */}
            <Pressable
              onPress={handleDismiss}
              hitSlop={16}
              style={styles.modalCloseBtn}
              accessibilityLabel="Close"
            >
              <Text style={styles.modalCloseText}>✕</Text>
            </Pressable>

            {/* Brand Header & Badge */}
            <View style={styles.headerBadgeRow}>
              <View style={styles.inProductionBadge}>
                <Text style={styles.inProductionBadgeText}>✨ PREMIERE COMING SOON</Text>
              </View>
            </View>

            {/* Video Metadata Header with optional Poster Thumbnail */}
            <View style={styles.filmHeaderRow}>
              {thumbUrl ? (
                <View style={styles.posterThumbnailWrapper}>
                  <Image
                    source={{ uri: thumbUrl }}
                    style={styles.posterThumbnail}
                    contentFit="cover"
                    priority="high"
                    cachePolicy="memory-disk"
                  />
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.4)']}
                    style={StyleSheet.absoluteFillObject}
                  />
                </View>
              ) : null}

              <View style={styles.filmMetaContainer}>
                <Text style={styles.filmSubtitle}>{subtitle}</Text>
                <Text style={styles.filmTitle} numberOfLines={2}>
                  {filmTitle}
                </Text>
              </View>
            </View>

            {/* Elevated Teaser Card */}
            <View style={styles.teaserCard}>
              <LinearGradient
                colors={['rgba(229, 196, 131, 0.12)', 'rgba(255, 255, 255, 0.03)']}
                style={StyleSheet.absoluteFillObject}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              />
              <View style={styles.teaserHeader}>
                <Text style={styles.teaserIcon}>{activeTeaser.icon}</Text>
                <Text style={styles.teaserTitle}>{activeTeaser.title}</Text>
              </View>
              <Text style={styles.teaserBody}>{activeTeaser.body}</Text>
            </View>

            {/* Action Button: Got It */}
            <Pressable
              style={({ pressed }) => [
                styles.primaryDismissBtn,
                pressed && styles.btnPressed,
              ]}
              onPress={handleDismiss}
            >
              <Text style={styles.primaryDismissBtnText}>Got It 🍿</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
  },
  modalOverlayContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#161618',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  modalDragHandle: {
    width: 38,
    height: 4.5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 14,
    right: 18,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  modalCloseText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  inProductionBadge: {
    backgroundColor: 'rgba(229, 196, 131, 0.14)',
    borderColor: 'rgba(229, 196, 131, 0.45)',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  inProductionBadgeText: {
    fontFamily: FONT_FUTURA,
    fontSize: 10,
    letterSpacing: 1.5,
    color: '#E5C483',
    fontWeight: '700',
  },
  filmHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    gap: 14,
  },
  posterThumbnailWrapper: {
    width: 54,
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#202024',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  posterThumbnail: {
    width: '100%',
    height: '100%',
  },
  filmMetaContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  filmSubtitle: {
    fontFamily: FONT_FUTURA,
    fontSize: 9.5,
    letterSpacing: 2,
    color: '#A1A1AA',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  filmTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  teaserCard: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(229, 196, 131, 0.3)',
    padding: 16,
    marginBottom: 20,
  },
  teaserHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  teaserIcon: {
    fontSize: 22,
  },
  teaserTitle: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  teaserBody: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 13,
    lineHeight: 20,
    color: '#D4D4D8',
    letterSpacing: 0.2,
  },
  primaryDismissBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryDismissBtnText: {
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: 0.5,
  },
  btnPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
});
