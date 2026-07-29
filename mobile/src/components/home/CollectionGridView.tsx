import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  ScrollView,
  Image,
  Pressable,
  Dimensions,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_LIGHT,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';
import { formatUniversalGalleryImages } from '@/utils/masonryHelper';
import FeaturedStoryView from './FeaturedStoryView';

const { width } = Dimensions.get('window');

export interface CollectionItem {
  id: string | number;
  title: string;
  category?: string;
  location?: string;
  subtext?: string;
  coverImage?: any;
  horizontalCoverImage?: any;
  rawItem: any;
}

interface CollectionGridViewProps {
  isOpen: boolean;
  onClose: () => void;
  headerTitle: string;
  headerDescription?: string;
  sectionHeadingPrefix?: string;
  items: CollectionItem[];
  initialCategory?: string;
  customCategoryCards?: any[];
  onSelectItem: (item: CollectionItem) => void;
}

export default function CollectionGridView({
  isOpen,
  onClose,
  headerTitle,
  headerDescription,
  sectionHeadingPrefix = 'COLLECTIONS',
  items,
  initialCategory = 'All',
  customCategoryCards,
  onSelectItem,
}: CollectionGridViewProps) {
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [activeStoryModalItem, setActiveStoryModalItem] = useState<any | null>(null);
  const isClickBusyRef = useRef(false);
  const storyDetailsCacheRef = useRef<Record<string, any>>({});

  // Background pre-fetch story details into memory cache
  React.useEffect(() => {
    if (isOpen && items && items.length > 0) {
      items.forEach((item) => {
        const raw = item.rawItem;
        if (raw && raw.slug && !storyDetailsCacheRef.current[raw.slug] && (!raw.images || raw.images.length === 0)) {
          fetch(`https://www.mistyvisuals.com/api/website/stories/${raw.slug}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((fullStory) => {
              if (fullStory) {
                const photos = fullStory.photos || fullStory.images || fullStory.gallery || [];
                const galleryImages = formatUniversalGalleryImages(photos, fullStory.title || raw.title, fullStory.category || raw.subtitle || 'GALLERY');

                const rawTabs = fullStory.tabs || fullStory.categories || fullStory.category || [];
                const parsedTabs = Array.isArray(rawTabs)
                  ? rawTabs.filter((s: any) => typeof s === 'string' && s.trim().length <= 25)
                  : (typeof rawTabs === 'string' ? rawTabs.split(',').map((s: string) => s.trim()).filter((s: string) => s && s.length <= 25) : []);

                const coverUri = fullStory.cover_image_mobile_url || fullStory.cover_image_url || fullStory.grid_image_url;

                storyDetailsCacheRef.current[raw.slug] = {
                  ...raw,
                  id: String(fullStory.id || raw.id),
                  title: fullStory.title || raw.title,
                  subtitle: fullStory.subtitle || fullStory.category || raw.subtitle,
                  location: fullStory.location || raw.location,
                  date: fullStory.date || raw.date,
                  coverImage: coverUri ? { uri: coverUri } : raw.coverImage,
                  description: fullStory.description || fullStory.subtitle || raw.description,
                  images: galleryImages,
                  tabs: parsedTabs,
                };
              }
            })
            .catch(() => {});
        }
      });
    }
  }, [isOpen, items]);

  const handleItemClick = async (item: CollectionItem) => {
    if (isClickBusyRef.current || activeStoryModalItem !== null) return;
    isClickBusyRef.current = true;
    setTimeout(() => { isClickBusyRef.current = false; }, 500);

    const raw = item.rawItem;
    if (!raw) return;

    // 0ms instant load if pre-cached in memory
    if (raw.slug && storyDetailsCacheRef.current[raw.slug]) {
      setActiveStoryModalItem(storyDetailsCacheRef.current[raw.slug]);
      return;
    }

    // If it's already a moodboard or story with populated images array
    if (Array.isArray(raw.images) && raw.images.length > 0) {
      setActiveStoryModalItem(raw);
      return;
    }

    // Fetch full gallery photos payload if slug is present (single modal trigger)
    if (raw.slug) {
      try {
        const res = await fetch(`https://www.mistyvisuals.com/api/website/stories/${raw.slug}`);
        if (res.ok) {
          const fullStory = await res.json();
          const photos = fullStory.photos || fullStory.images || fullStory.gallery || [];
          const galleryImages = formatUniversalGalleryImages(photos, fullStory.title || raw.title, fullStory.category || raw.subtitle || 'GALLERY');

          const rawTabs = fullStory.tabs || fullStory.categories || fullStory.category || [];
          const parsedTabs = Array.isArray(rawTabs)
            ? rawTabs.filter((s: any) => typeof s === 'string' && s.trim().length <= 25)
            : (typeof rawTabs === 'string' ? rawTabs.split(',').map((s: string) => s.trim()).filter((s: string) => s && s.length <= 25) : []);

          const coverUri = fullStory.cover_image_mobile_url || fullStory.cover_image_url || fullStory.grid_image_url;

          const parsedStory = {
            ...raw,
            id: String(fullStory.id || raw.id),
            title: fullStory.title || raw.title,
            subtitle: fullStory.subtitle || fullStory.category || raw.subtitle,
            location: fullStory.location || raw.location,
            date: fullStory.date || raw.date,
            coverImage: coverUri ? { uri: coverUri } : raw.coverImage,
            description: fullStory.description || fullStory.subtitle || raw.description,
            images: galleryImages,
            tabs: parsedTabs,
          };

          storyDetailsCacheRef.current[raw.slug] = parsedStory;
          setActiveStoryModalItem(parsedStory);
          return;
        }
      } catch (err) {
        console.warn('Failed to fetch story gallery photos:', err);
      }
    }

    setActiveStoryModalItem(raw);
  };

  const translateX = useSharedValue(0);
  const touchStartX = useSharedValue(0);
  const isSwipeFromEdge = useSharedValue(false);

  // Dynamic Category filters
  const categories = React.useMemo(() => {
    const categoriesSet = new Set<string>();
    const presetCategories = [
      'Day Wedding', 'Destination', 'Intimate', 'Luxury',
      'Haldi Poses', 'Bridal Entry', 'Decor', 'Pre-Wedding'
    ];

    items.forEach((item) => {
      const cats = (item.category || '').split(',').map((c) => c.trim()).filter(Boolean);
      cats.forEach((c) => categoriesSet.add(c));

      const title = (item.title || '').toLowerCase();
      const loc = (item.location || '').toLowerCase();
      const sub = (item.subtext || '').toLowerCase();

      presetCategories.forEach((preset) => {
        const pLower = preset.toLowerCase();
        if (title.includes(pLower) || loc.includes(pLower) || sub.includes(pLower)) {
          categoriesSet.add(preset);
        }
      });
    });
    if (categoriesSet.size === 0) return ['All'];
    return ['All', ...Array.from(categoriesSet).sort()];
  }, [items]);

  const prevIsOpenRef = React.useRef(isOpen);
  const isDirectFromHomeRef = React.useRef(false);

  React.useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      translateX.value = width;
      translateX.value = withTiming(0, {
        duration: 280,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      });

      if (initialCategory && initialCategory !== 'All') {
        isDirectFromHomeRef.current = true;
        const found = categories.find((c) => c.toLowerCase() === initialCategory.toLowerCase());
        setSelectedCategory(found || initialCategory);
      } else {
        isDirectFromHomeRef.current = false;
        setSelectedCategory('All');
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, initialCategory, categories]);

  // Generate visual Category Cards for the "All" view mode with priority cover deduplication
  const categoryCards = React.useMemo(() => {
    const validCategories = categories.filter((c) => c !== 'All');

    const categoryList = validCategories.map((catName) => {
      const catLower = catName.toLowerCase();
      const catItems = items.filter((item) => {
        const dbCategories = (item.category || '').split(',').map((c) => c.trim().toLowerCase());
        if (dbCategories.includes(catLower)) return true;
        const title = (item.title || '').toLowerCase();
        const loc = (item.location || '').toLowerCase();
        return title.includes(catLower) || loc.includes(catLower);
      });
      return { name: catName, count: catItems.length, items: catItems };
    });

    const sortedCategories = [...categoryList].sort((a, b) => a.count - b.count);
    const assignedCoversMap = new Map<string, any>();
    const usedCoverUris = new Set<string>();

    sortedCategories.forEach((cat) => {
      let chosenCoverSrc: any = null;
      let chosenUriKey: string | null = null;

      for (const item of cat.items) {
        const coverUri = item.coverImage || item.horizontalCoverImage;
        const coverSrc = coverUri ? (typeof coverUri === 'string' ? { uri: coverUri } : coverUri) : null;
        const uriKey = typeof coverSrc === 'object' && coverSrc?.uri ? coverSrc.uri : (typeof coverSrc === 'string' ? coverSrc : null);

        if (coverSrc && uriKey && !usedCoverUris.has(uriKey)) {
          chosenCoverSrc = coverSrc;
          chosenUriKey = uriKey;
          break;
        }
      }

      if (!chosenCoverSrc && cat.items.length > 0) {
        const firstItem = cat.items[0];
        const coverUri = firstItem.coverImage || firstItem.horizontalCoverImage;
        chosenCoverSrc = coverUri ? (typeof coverUri === 'string' ? { uri: coverUri } : coverUri) : null;
        chosenUriKey = typeof chosenCoverSrc === 'object' && chosenCoverSrc?.uri ? chosenCoverSrc.uri : (typeof chosenCoverSrc === 'string' ? chosenCoverSrc : null);
      }

      if (chosenUriKey) {
        usedCoverUris.add(chosenUriKey);
      }
      assignedCoversMap.set(cat.name, chosenCoverSrc);
    });

    return categoryList.map((cat) => {
      const formattedTitle = cat.name
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
      const subtext = cat.count > 0 ? `${cat.count} ${cat.count === 1 ? 'Collection' : 'Collections'} →` : 'Explore Category →';

      return {
        name: cat.name,
        title: formattedTitle,
        count: cat.count,
        subtext,
        coverImage: assignedCoversMap.get(cat.name) || null,
      };
    });
  }, [categories, items]);

  const categoryTransitionTranslateX = useSharedValue(0);
  const categoryTransitionOpacity = useSharedValue(1);

  const categoryAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: categoryTransitionTranslateX.value }],
    opacity: categoryTransitionOpacity.value,
  }));

  const selectCategoryWithPush = React.useCallback((catName: string) => {
    if (isClickBusyRef.current) return;
    isClickBusyRef.current = true;
    setTimeout(() => { isClickBusyRef.current = false; }, 400);

    categoryTransitionTranslateX.value = width * 0.35;
    categoryTransitionOpacity.value = 0.5;
    setSelectedCategory(catName);
    categoryTransitionTranslateX.value = withTiming(0, {
      duration: 250,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
    categoryTransitionOpacity.value = withTiming(1, { duration: 200 });
  }, [categoryTransitionTranslateX, categoryTransitionOpacity]);

  const popToAllCategories = React.useCallback(() => {
    categoryTransitionTranslateX.value = withTiming(
      width * 0.35,
      { duration: 180, easing: Easing.out(Easing.poly(3)) },
      () => {
        runOnJS(setSelectedCategory)('All');
        categoryTransitionTranslateX.value = withTiming(0, {
          duration: 200,
          easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        });
        categoryTransitionOpacity.value = withTiming(1, { duration: 180 });
      }
    );
    categoryTransitionOpacity.value = withTiming(0.5, { duration: 180 });
  }, [categoryTransitionTranslateX, categoryTransitionOpacity]);

  const performCloseAnimation = React.useCallback(() => {
    translateX.value = withTiming(
      width,
      { duration: 240, easing: Easing.out(Easing.poly(3)) },
      () => {
        runOnJS(onClose)();
      }
    );
  }, [onClose, translateX]);

  const handleBackPress = React.useCallback(() => {
    if (activeStoryModalItem !== null) {
      setActiveStoryModalItem(null);
      return;
    }
    if (isDirectFromHomeRef.current) {
      performCloseAnimation();
      return;
    }
    if (selectedCategory !== 'All') {
      popToAllCategories();
    } else {
      performCloseAnimation();
    }
  }, [activeStoryModalItem, selectedCategory, performCloseAnimation, popToAllCategories]);

  const isCategoryViewActive = selectedCategory !== 'All' && !isDirectFromHomeRef.current;

  // iOS native-feel Edge Swipe Back gesture (swipe right from left 65px edge)
  const edgeSwipeGesture = Gesture.Pan()
    .onBegin((e) => {
      'worklet';
      if (e.x <= 65) {
        touchStartX.value = e.x;
        isSwipeFromEdge.value = true;
      } else {
        isSwipeFromEdge.value = false;
      }
    })
    .activeOffsetX(5)
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      'worklet';
      if (isSwipeFromEdge.value && e.translationX > 0) {
        if (isCategoryViewActive) {
          categoryTransitionTranslateX.value = e.translationX;
        } else {
          translateX.value = e.translationX;
        }
      }
    })
    .onEnd((e) => {
      'worklet';
      if (isSwipeFromEdge.value) {
        if (e.translationX > 100 || e.velocityX > 500) {
          runOnJS(handleBackPress)();
        } else {
          if (isCategoryViewActive) {
            categoryTransitionTranslateX.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) });
          } else {
            translateX.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) });
          }
        }
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Android hardware back button handler
  React.useEffect(() => {
    if (!isOpen) return;
    const onBackPress = () => {
      handleBackPress();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [isOpen, handleBackPress]);

  const filteredItems = React.useMemo(() => {
    if (selectedCategory === 'All') return items;
    const catLower = selectedCategory.toLowerCase();
    return items.filter((item) => {
      const dbCategories = (item.category || '').split(',').map((c) => c.trim().toLowerCase());
      if (dbCategories.includes(catLower)) return true;
      const title = (item.title || '').toLowerCase();
      const loc = (item.location || '').toLowerCase();
      return title.includes(catLower) || loc.includes(catLower);
    });
  }, [items, selectedCategory]);

  const currentDisplayTitle = React.useMemo(() => {
    if (selectedCategory === 'All' || !selectedCategory) {
      return headerTitle;
    }
    return selectedCategory
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }, [selectedCategory, headerTitle]);

  const featuredItem = filteredItems.length > 0 ? filteredItems[0] : null;
  const gridItems = filteredItems.length > 1 ? filteredItems.slice(1) : (filteredItems.length === 1 ? [] : []);

  const categoryCardsToRender = customCategoryCards && customCategoryCards.length > 0
    ? customCategoryCards
    : categoryCards;

  return (
    <Modal
      visible={isOpen}
      animationType="none"
      transparent={true}
      onRequestClose={handleBackPress}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <GestureDetector gesture={edgeSwipeGesture}>
          <Animated.View style={[styles.container, animatedStyle]}>
            {/* Clean Top Header Bar */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
              <Pressable style={styles.backButton} onPress={handleBackPress}>
                <Text style={styles.backIcon}>←</Text>
              </Pressable>
              <Image
                source={require('@/assets/images/logo-black.png')}
                style={styles.headerLogo}
                resizeMode="contain"
              />
              <View style={{ width: 40 }} />
            </View>

            {/* Main Content Area (Native iOS Push/Pop Animation) */}
            <Animated.View style={[{ flex: 1 }, categoryAnimatedStyle]}>
              <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Centered Editorial Title & Description Banner */}
                <View style={styles.titleSection}>
                  <Text style={styles.bannerTitle}>{currentDisplayTitle}</Text>
                  {headerDescription ? (
                    <Text style={styles.bannerDescription}>{headerDescription}</Text>
                  ) : null}
                </View>

                {filteredItems.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>No items found under "{selectedCategory}".</Text>
                  </View>
                ) : selectedCategory === 'All' && categoryCardsToRender.length > 0 ? (
                  /* Categories Overview Grid View */
                  <View style={styles.gridSection}>
                    {sectionHeadingPrefix ? (
                      <Text style={styles.sectionHeading}>{sectionHeadingPrefix}</Text>
                    ) : null}
                    <View style={styles.grid}>
                      {categoryCardsToRender.map((catCard) => (
                        <Pressable
                          key={catCard.name}
                          style={styles.card}
                          onPress={() => selectCategoryWithPush(catCard.name)}
                        >
                        {catCard.coverImage ? (
                          <Image
                            source={
                              typeof catCard.coverImage === 'string'
                                ? { uri: catCard.coverImage }
                                : catCard.coverImage
                            }
                            style={styles.cover}
                          />
                        ) : (
                          <View style={[styles.cover, { backgroundColor: '#18181b' }]} />
                        )}
                        <LinearGradient
                          colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.88)']}
                          locations={[0, 0.45, 1]}
                          style={styles.overlay}
                        />
                        <View style={styles.info}>
                          <Text style={styles.title} numberOfLines={1}>
                            {catCard.title || catCard.name}
                          </Text>
                          <Text style={styles.subtext} numberOfLines={1}>
                            {catCard.subtext || (catCard.count ? `${catCard.count} Collections →` : 'Explore Category →')}
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : (
                  <>
                    {/* FEATURED Section */}
                    {featuredItem && (
                      <View style={styles.featuredSection}>
                      <Pressable
                        style={styles.featuredCard}
                        onPress={() => handleItemClick(featuredItem)}
                      >
                        {(featuredItem.horizontalCoverImage || featuredItem.coverImage) ? (
                          <Image
                            source={
                              typeof (featuredItem.horizontalCoverImage || featuredItem.coverImage) === 'string'
                                ? { uri: featuredItem.horizontalCoverImage || featuredItem.coverImage }
                                : (featuredItem.horizontalCoverImage || featuredItem.coverImage)
                            }
                            style={styles.featuredCover}
                          />
                        ) : (
                          <View style={[styles.featuredCover, { backgroundColor: '#18181b' }]} />
                        )}
                        <LinearGradient
                          colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.88)']}
                          locations={[0, 0.4, 1]}
                          style={styles.overlay}
                        />

                        <View style={styles.featuredInfo}>
                          <Text style={styles.featuredTitle} numberOfLines={1}>
                            {(featuredItem.title || '')
                              .split(' ')
                              .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                              .join(' ')}
                          </Text>
                          <Text style={styles.featuredSubtext} numberOfLines={1}>
                            {featuredItem.subtext || featuredItem.location || 'Collection'}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  )}

                  {/* ALL COLLECTIONS Grid Section */}
                  <View style={styles.gridSection}>
                    <View style={styles.grid}>
                      {(gridItems.length > 0 ? gridItems : (featuredItem ? [] : filteredItems)).map((item) => {
                        const formattedTitle = (item.title || '')
                          .split(' ')
                          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                          .join(' ');
                        const imageSource = item.coverImage
                          ? typeof item.coverImage === 'string'
                            ? { uri: item.coverImage }
                            : item.coverImage
                          : null;

                        return (
                          <Pressable
                            key={item.id}
                            style={styles.card}
                            onPress={() => handleItemClick(item)}
                          >
                            {imageSource ? (
                              <Image source={imageSource} style={styles.cover} />
                            ) : (
                              <View style={[styles.cover, { backgroundColor: '#18181b' }]} />
                            )}
                            <LinearGradient
                              colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.88)']}
                              locations={[0, 0.45, 1]}
                              style={styles.overlay}
                            />
                            <View style={styles.info}>
                              <Text style={styles.title} numberOfLines={2}>
                                {formattedTitle}
                              </Text>
                              <Text style={styles.subtext} numberOfLines={1}>
                                {item.subtext || item.location || 'Collection'}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </>
              )}

              {/* Editorial Brand Footer */}
              <View style={styles.brandFooter}>
                <View style={styles.brandLine} />
                <Text style={styles.brandFooterTitle}>MISTY VISUALS</Text>
                <Text style={styles.brandFooterSubtext}>FINE ART & DESTINATION WEDDING PHOTOGRAPHY</Text>
                <Text style={styles.brandFooterDescription}>Capturing unscripted moments & intentional design worldwide.</Text>
              </View>
            </ScrollView>
          </Animated.View>

            <FeaturedStoryView
              isOpen={activeStoryModalItem !== null}
              onClose={() => setActiveStoryModalItem(null)}
              story={activeStoryModalItem}
            />
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
  },
  backButton: {
    paddingVertical: 6,
    paddingRight: 16,
  },
  backIcon: {
    fontSize: 20,
    color: '#1c1a18',
    fontWeight: '300',
  },
  headerLogo: {
    height: 38,
    width: 135,
    tintColor: '#000000',
  },
  scrollContent: {
    paddingBottom: 60,
  },
  titleSection: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 12,
    paddingBottom: 18,
  },
  bannerTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 32,
    color: '#1c1a18',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  bannerDescription: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    lineHeight: 19,
    color: '#7a756d',
    textAlign: 'center',
  },
  backToCategoriesLink: {
    alignSelf: 'center',
    marginBottom: 20,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  backToCategoriesText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    letterSpacing: 2,
    color: '#9a7d52',
  },
  featuredSection: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionHeading: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    letterSpacing: 2,
    color: '#a0988e',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  featuredCard: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1c1a18',
  },
  featuredCover: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  featuredInfo: {
    position: 'absolute',
    bottom: 16,
    left: 18,
    right: 18,
  },
  featuredTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 20,
    color: '#ffffff',
    marginBottom: 2,
  },
  featuredSubtext: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: '#d0c8be',
  },
  gridSection: {
    paddingHorizontal: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  card: {
    width: (width - 54) / 2,
    aspectRatio: 3 / 4,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1c1a18',
  },
  cover: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  info: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
  },
  title: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 2,
    lineHeight: 20,
  },
  subtext: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    color: '#d0c8be',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    color: '#8c867e',
  },
  filterPillsContainer: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    backgroundColor: '#ffffff',
  },
  filterPillActive: {
    borderColor: '#1c1a18',
    backgroundColor: '#1c1a18',
  },
  filterPillText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    letterSpacing: 1.2,
    color: '#666666',
    textTransform: 'uppercase',
  },
  filterPillTextActive: {
    color: '#ffffff',
  },
  brandFooter: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 40,
    paddingHorizontal: 24,
  },
  brandLine: {
    width: 32,
    height: 1,
    backgroundColor: '#d0c8be',
    marginBottom: 16,
  },
  brandFooterTitle: {
    fontFamily: FONT_FUTURA,
    fontSize: 11,
    letterSpacing: 3,
    color: '#1c1a18',
    marginBottom: 6,
  },
  brandFooterSubtext: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 9,
    letterSpacing: 1.8,
    color: '#9a7d52',
    marginBottom: 8,
    textAlign: 'center',
  },
  brandFooterDescription: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    color: '#888888',
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
