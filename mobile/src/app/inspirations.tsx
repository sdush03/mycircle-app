import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useScrollTabBarCollapse } from '../hooks/useScrollTabBarCollapse';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_MEDIUM,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../constants/fonts';

// Lightbox & Modal Viewers
import FeaturedStoryView from '../components/home/FeaturedStoryView';
import ArticleView from '../components/home/ArticleView';
import MoodboardsView from '../components/home/MoodboardsView';

const { width } = Dimensions.get('window');

// Default Curated Journal Entries (Fallback if server data is unavailable)
const DEFAULT_JOURNAL_ARTICLES = [
  {
    id: 'journal-1',
    title: 'The Art of Heritage Lighting & Architecture',
    category: 'EDITORIAL JOURNAL',
    date: 'July 20, 2026',
    readTime: '5 MIN READ',
    coverImage: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=800&q=80',
    content: [
      'Capturing royal Indian architecture requires a deep understanding of natural light casting across ancient stone corridors.',
      'When working with heritage palaces like Jaipur and Udaipur, we focus on shadow framing and ambient golden hour warmth to create timeless visual narratives.',
      'Every doorway and carved arch becomes a frame for intimacy, balancing monumental scale with quiet personal moments.'
    ]
  },
  {
    id: 'journal-2',
    title: 'Crafting Your Fine Art Wedding Color Palette',
    category: 'STYLING GUIDE',
    date: 'July 14, 2026',
    readTime: '4 MIN READ',
    coverImage: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=800&q=80',
    content: [
      'A cohesive color palette is the foundation of luxury wedding visual storytelling.',
      'From earthy muted tones to regal emerald greens and warm champagne golds, alignment between floral styling, attire, and decor ensures timeless imagery.',
      'Here are our recommendations for curating a color moodboard that feels organic, sophisticated, and distinctly yours.'
    ]
  },
  {
    id: 'journal-3',
    title: 'Editorial Portraiture: Authentic & Unfiltered',
    category: 'CREATIVE PHILOSOPHY',
    date: 'June 28, 2026',
    readTime: '6 MIN READ',
    coverImage: 'https://images.unsplash.com/photo-1583939003579-730e3918a45a?auto=format&fit=crop&w=800&q=80',
    content: [
      'True luxury photography is not about rigid poses; it is about unscripted grace.',
      'We guide couples through quiet movement, allowing genuine emotion to unfold while applying editorial composition and cinematic depth.',
      'Explore how we combine fine art portraiture with candid documentary storytelling.'
    ]
  }
];

export default function InspirationsScreen() {
  const handleScroll = useScrollTabBarCollapse();

  // Data states
  const [websiteInspirations, setWebsiteInspirations] = useState<any[]>([]);
  const [websiteStories, setWebsiteStories] = useState<any[]>([]);
  const [journalArticles, setJournalArticles] = useState<any[]>(DEFAULT_JOURNAL_ARTICLES);
  const [selectedVibe, setSelectedVibe] = useState<string>('All');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Modal states
  const [selectedStory, setSelectedStory] = useState<any | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<any | null>(null);
  const [isMoodboardsOpen, setIsMoodboardsOpen] = useState<boolean>(false);
  const [selectedAestheticCategory, setSelectedAestheticCategory] = useState<string | undefined>(undefined);

  // Fetch dynamic inspirations, stories, and journal articles
  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      try {
        const [inspoRes, storyRes, articleRes] = await Promise.allSettled([
          fetch('https://www.mistyvisuals.com/api/app/inspirations'),
          fetch('https://www.mistyvisuals.com/api/website/stories'),
          fetch('https://www.mistyvisuals.com/api/website/articles')
        ]);

        if (inspoRes.status === 'fulfilled' && inspoRes.value.ok) {
          const inspoData = await inspoRes.value.json();
          if (isMounted && Array.isArray(inspoData)) setWebsiteInspirations(inspoData);
        }

        if (storyRes.status === 'fulfilled' && storyRes.value.ok) {
          const storyData = await storyRes.value.json();
          if (isMounted && Array.isArray(storyData)) setWebsiteStories(storyData);
        }

        if (articleRes.status === 'fulfilled' && articleRes.value.ok) {
          const articleData = await articleRes.value.json();
          if (isMounted && Array.isArray(articleData) && articleData.length > 0) {
            setJournalArticles(articleData);
          }
        }
      } catch (err) {
        console.warn('Failed fetching inspirations data:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchData();
    return () => { isMounted = false; };
  }, []);

  // Vibe Category Cards generated dynamically from websiteInspirations & websiteStories
  const vibeCategoryCards = React.useMemo(() => {
    const categoryMap = new Map<string, { name: string; count: number; items: any[] }>();

    websiteInspirations.forEach((item: any) => {
      const cats = (item.category || '').split(',').map((c: string) => c.trim()).filter(Boolean);
      cats.forEach((catName: string) => {
        if (!categoryMap.has(catName)) {
          categoryMap.set(catName, { name: catName, count: 1, items: [item] });
        } else {
          const existing = categoryMap.get(catName)!;
          existing.count += 1;
          existing.items.push(item);
        }
      });
    });

    const categoryList = Array.from(categoryMap.values()).slice(0, 4);

    if (categoryList.length === 0) {
      return [
        { name: 'Royal Heritage', count: 14, coverImage: { uri: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=800&q=80' } },
        { name: 'Editorial Monochrome', count: 18, coverImage: { uri: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=800&q=80' } },
        { name: 'Sunset Coastal', count: 12, coverImage: { uri: 'https://images.unsplash.com/photo-1583939003579-730e3918a45a?auto=format&fit=crop&w=800&q=80' } },
        { name: 'Bridal Portraits', count: 22, coverImage: { uri: 'https://images.unsplash.com/photo-1532712938310-34cb3982ef74?auto=format&fit=crop&w=800&q=80' } }
      ];
    }

    return categoryList.map((cat) => {
      const firstItem = cat.items[0];
      const coverUri = firstItem?.coverImageMobile || firstItem?.coverImage || (firstItem?.images && firstItem.images[0]);
      return {
        name: cat.name,
        count: cat.count,
        coverImage: coverUri ? (typeof coverUri === 'string' ? { uri: coverUri } : coverUri) : null,
      };
    });
  }, [websiteInspirations]);

  const vibesList = ['All', 'Royal Heritage', 'Editorial Monochrome', 'Sunset Coastal', 'Minimalist', 'Ethereal Romance', 'Pre-Wedding', 'Bridal Portraits'];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {/* ── 1. Page Hero Banner ── */}
        <View style={styles.heroSection}>
          <Text style={styles.heroGreetingText}>Inspirations & Journal</Text>
          <Text style={styles.heroSubtitleText}>
            Explore curated fine art aesthetics, vibe collections, and editorial journal stories for your celebration.
          </Text>
        </View>

        {/* ── 2. SECTION: AESTHETICS & MOODBOARDS ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeader}>AESTHETICS & MOODBOARDS</Text>
            <Pressable
              style={styles.viewAllBtn}
              onPress={() => {
                setSelectedAestheticCategory('All');
                setIsMoodboardsOpen(true);
              }}
            >
              <Text style={styles.viewAllText}>Explore All →</Text>
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
            {(websiteInspirations.length > 0 ? websiteInspirations : [
              { id: 1, title: 'Royal Gold & Champagne', category: 'COLLECTION', images: ['https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=800&q=80'] },
              { id: 2, title: 'Editorial Monochrome', category: 'STYLE BOARD', images: ['https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=800&q=80'] },
              { id: 3, title: 'Coastal Sunkissed Glow', category: 'MOODBOARD', images: ['https://images.unsplash.com/photo-1583939003579-730e3918a45a?auto=format&fit=crop&w=800&q=80'] },
            ]).map((item: any, idx: number) => {
              const coverSrc = item.coverImageMobile || item.coverImage || (item.images && item.images[0]);
              const photoCount = Array.isArray(item.images) ? item.images.length : 12;
              return (
                <Pressable
                  key={idx}
                  style={styles.aestheticCard}
                  onPress={() => {
                    setSelectedStory({
                      id: String(item.id || idx),
                      title: item.title,
                      subtitle: item.category || 'FINE ART AESTHETIC',
                      location: 'CURATED MOODBOARD',
                      date: 'AESTHETIC',
                      coverImage: coverSrc,
                      description: item.description || '',
                      images: (item.images || [coverSrc]).map((imgUrl: any, i: number) => ({
                        id: `inspo-${idx}-${i}`,
                        uri: typeof imgUrl === 'string' ? imgUrl : imgUrl?.uri || imgUrl,
                        caption: item.title,
                        originalIndex: i,
                      })),
                    });
                  }}
                >
                  <Image
                    source={typeof coverSrc === 'string' ? { uri: coverSrc } : coverSrc}
                    style={styles.cardImage}
                  />
                  <LinearGradient
                    colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.85)']}
                    locations={[0, 0.4, 1]}
                    style={styles.cardOverlay}
                  />
                  <View style={styles.cardContent}>
                    <Text style={styles.cardBadge}>{(item.category || 'AESTHETIC').toUpperCase()}</Text>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.cardSubtext}>{photoCount} Photos • Explore Board →</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* ── 3. SECTION: BROWSE BY VIBE ── */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>BROWSE BY VIBE</Text>

          {/* Horizontal Vibe Filter Pills */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vibePillsContainer}>
            {vibesList.map((vibe) => {
              const isSelected = selectedVibe === vibe;
              return (
                <Pressable
                  key={vibe}
                  style={[styles.vibePill, isSelected && styles.vibePillActive]}
                  onPress={() => setSelectedVibe(vibe)}
                >
                  <Text style={[styles.vibePillText, isSelected && styles.vibePillTextActive]}>
                    {vibe.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* 2x2 Category Cards Grid */}
          <View style={styles.vibeGridContainer}>
            {vibeCategoryCards.map((card, idx) => {
              const formattedTitle = card.name
                .split(' ')
                .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ');
              return (
                <Pressable
                  key={idx}
                  style={styles.vibeGridCard}
                  onPress={() => {
                    setSelectedAestheticCategory(card.name);
                    setIsMoodboardsOpen(true);
                  }}
                >
                  {card.coverImage ? (
                    <Image source={typeof card.coverImage === 'string' ? { uri: card.coverImage } : card.coverImage} style={styles.cardImage} />
                  ) : (
                    <View style={[styles.cardImage, { backgroundColor: '#1c1a18' }]} />
                  )}
                  <LinearGradient
                    colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.85)']}
                    locations={[0, 0.4, 1]}
                    style={styles.cardOverlay}
                  />
                  <View style={styles.cardContent}>
                    <Text style={styles.vibeCardTitle} numberOfLines={1}>{formattedTitle}</Text>
                    <Text style={styles.vibeCardSubtext} numberOfLines={1}>{card.count} Collections →</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ── 4. SECTION: CIRCLE GENERAL JOURNAL ── */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>CIRCLE GENERAL JOURNAL</Text>

          <View style={styles.journalListContainer}>
            {journalArticles.map((article, idx) => (
              <Pressable
                key={article.id || idx}
                style={styles.journalCard}
                onPress={() => setSelectedArticle(article)}
              >
                <Image
                  source={typeof article.coverImage === 'string' ? { uri: article.coverImage } : article.coverImage}
                  style={styles.journalImage}
                />
                <View style={styles.journalInfo}>
                  <View style={styles.journalMetaRow}>
                    <Text style={styles.journalCategory}>{article.category || 'EDITORIAL JOURNAL'}</Text>
                    <Text style={styles.journalReadTime}>{article.readTime || '4 MIN READ'}</Text>
                  </View>
                  <Text style={styles.journalTitle}>{article.title}</Text>
                  <Text style={styles.journalExcerpt} numberOfLines={2}>
                    {Array.isArray(article.content) ? article.content[0] : (article.content || '')}
                  </Text>
                  <Text style={styles.journalDate}>{article.date || 'PUBLISHED EDITION'}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Lightbox Modals */}
      <FeaturedStoryView
        isOpen={selectedStory !== null}
        onClose={() => setSelectedStory(null)}
        story={selectedStory}
      />

      <ArticleView
        isOpen={selectedArticle !== null}
        onClose={() => setSelectedArticle(null)}
        article={selectedArticle}
      />

      <MoodboardsView
        isOpen={isMoodboardsOpen}
        onClose={() => {
          setIsMoodboardsOpen(false);
          setSelectedAestheticCategory(undefined);
        }}
        selectedCategoryName={selectedAestheticCategory}
        inspirations={websiteInspirations}
        categoryCards={vibeCategoryCards}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    paddingBottom: 110,
  },
  // Hero section styling matching Home Page index.tsx exactly
  heroSection: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    backgroundColor: 'transparent',
  },
  heroGreetingText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 24,
    color: '#1c1917',
    lineHeight: 30,
    letterSpacing: -0.2,
  },
  heroSubtitleText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 14,
    lineHeight: 21,
    color: '#403d39',
    marginTop: 6,
  },
  // Section headers matching Home Page index.tsx
  section: {
    paddingTop: 32,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 24,
  },
  sectionHeader: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    letterSpacing: 2,
    color: '#8c867e',
    marginHorizontal: 24,
    marginBottom: 16,
  },
  viewAllBtn: {
    paddingVertical: 4,
    marginBottom: 16,
  },
  viewAllText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    letterSpacing: 1,
    color: '#1c1a18',
  },
  horizontalScroll: {
    paddingLeft: 24,
    paddingRight: 12,
  },
  aestheticCard: {
    width: width * 0.68,
    height: 270,
    marginRight: 16,
    backgroundColor: '#1c1a18',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 4,
  },
  cardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  cardContent: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
  cardBadge: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 8.5,
    letterSpacing: 1.5,
    color: '#C5A059',
    marginBottom: 4,
  },
  cardTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 17,
    color: '#ffffff',
    marginBottom: 4,
    lineHeight: 22,
  },
  cardSubtext: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    color: '#e5dfd5',
  },
  vibePillsContainer: {
    gap: 8,
    marginHorizontal: 24,
    marginBottom: 16,
  },
  vibePill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#f0ede8',
  },
  vibePillActive: {
    backgroundColor: '#1c1917',
    borderColor: '#1c1917',
  },
  vibePillText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 10,
    letterSpacing: 1,
    color: '#666666',
  },
  vibePillTextActive: {
    color: '#ffffff',
  },
  vibeGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    rowGap: 16,
  },
  vibeGridCard: {
    width: (width - 64) / 2,
    aspectRatio: 4 / 3,
    backgroundColor: '#1c1a18',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 4,
  },
  vibeCardTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 14,
    color: '#ffffff',
    marginBottom: 2,
    letterSpacing: 0.2,
  },
  vibeCardSubtext: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10.5,
    color: '#e5dfd5',
  },
  journalListContainer: {
    paddingHorizontal: 24,
    gap: 16,
  },
  journalCard: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#f0ede8',
    padding: 12,
    gap: 14,
  },
  journalImage: {
    width: 100,
    height: 110,
    borderRadius: 4,
    resizeMode: 'cover',
  },
  journalInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  journalMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  journalCategory: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 8.5,
    letterSpacing: 1.2,
    color: '#8C6721',
  },
  journalReadTime: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 8.5,
    color: '#8c867e',
  },
  journalTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 14,
    color: '#1c1a18',
    marginBottom: 4,
    lineHeight: 19,
  },
  journalExcerpt: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    lineHeight: 17,
    color: '#555555',
    marginBottom: 6,
  },
  journalDate: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10,
    color: '#8c867e',
  },
});
