import React, { useEffect, useState, useRef, useCallback } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  ScrollView, 
  Image, 
  Pressable, 
  Platform, 
  ActivityIndicator, 
  Dimensions, 
  StatusBar,
  Animated,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useScrollTabBarCollapse } from '../hooks/useScrollTabBarCollapse';
import api from '../services/api';

import { Linking } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { Image as ExpoImage } from 'expo-image';
import {
  HeroType,
  type HeroCard,
  HERO_EXPIRY_MS,
  HERO_TRANSITION,
  HERO_STORAGE_KEYS,
  resolveHomeHero,
  pickWelcomeEditorial,
  pickLiveMessage,
  buildWelcomeHeadline,
  buildFaceMatchHeadlineSingle,
  buildFaceMatchHeadlineMulti,
  buildFaceMatchSubtitleSingle,
  buildFaceMatchSubtitleMulti,
  HIGHLIGHTS_COPY,
  GALLERY_READY_COPY,
  ANNIVERSARY_COPY,
  TOMORROW_COPY,
  TWO_DAYS_COPY,
  UPCOMING_COPY,
  HERO_CTA,
} from '../lib/hero';

// Sub-components for reading/exploring
import FeaturedStoryView from '../components/home/FeaturedStoryView';
import ArticleView from '../components/home/ArticleView';
import MoodboardsView from '../components/home/MoodboardsView';
import InspirationsView from '../components/home/InspirationsView';
import AllStoriesView from '../components/home/AllStoriesView';
import { formatUniversalGalleryImages } from '@/utils/masonryHelper';
import JoinCelebrationModal from '../components/JoinCelebrationModal';
import { tabEvents, TAB_OPEN_MOODBOARDS, TAB_OPEN_INSPIRATIONS } from '../lib/tabEvents';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../constants/fonts';

const { width } = Dimensions.get('window');

// Local Data Definitions for the Editorial Showcase
const VIBES = ['All', 'Luxury', 'Destination', 'Intimate', 'Traditional'];

export default function HomeScreen() {
  const { token, profile, setEventDetails, userEvents: events, setUserEvents: setEvents } = useAuthStore();
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedVibe, setSelectedVibe] = useState('All');

  // Modals for full articles / portfolios / moodboards
  const [selectedStory, setSelectedStory] = useState<any | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<any | null>(null);
  const [playingFilmId, setPlayingFilmId] = useState<string | null>(null);
  const [isMoodboardsOpen, setIsMoodboardsOpen] = useState(false);
  const [isInspirationsOpen, setIsInspirationsOpen] = useState(false);
  const [selectedMoodboardId, setSelectedMoodboardId] = useState<string | number | null>(null);
  const [isAllStoriesOpen, setIsAllStoriesOpen] = useState(false);
  const [isJoinCelebrationModalOpen, setIsJoinCelebrationModalOpen] = useState(false);
  const [selectedInspoCategory, setSelectedInspoCategory] = useState<string | undefined>(undefined);

  const handleScroll = useScrollTabBarCollapse();

  const [websiteStories, setWebsiteStories] = useState<any[]>([]);
  const [websiteFilms, setWebsiteFilms] = useState<any[]>([]);
  const [websiteInspirations, setWebsiteInspirations] = useState<any[]>([]);
  const [likedPhotos, setLikedPhotos] = useState<any[]>([]);

  // Hero seen data: tracks first-discovery time + last-seen count per event slug
  // Used for B+D combined expiry: show 7 days from first discovery OR on new photos
  const [heroSeenData, setHeroSeenData] = useState<Record<string, { lastSeenCount: number; firstSeenAt: number }>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);

  // Highlights Hero visibility: { firstShownAt, lastSeenCount } per slug
  const [highlightsHeroData, setHighlightsHeroData] = useState<Record<string, { firstShownAt: number; lastSeenCount: number }>>({});

  // Gallery Ready Hero visibility: { firstShownAt, lastSeenCount } per slug
  const [galleryReadyHeroData, setGalleryReadyHeroData] = useState<Record<string, { firstShownAt: number; lastSeenCount: number }>>({});

  // Handle Android system back gesture / back button to close any open modal
  useEffect(() => {
    const onBackPress = () => {
      if (selectedStory) { setSelectedStory(null); return true; }
      if (selectedArticle) { setSelectedArticle(null); return true; }
      if (playingFilmId) { setPlayingFilmId(null); return true; }
      if (selectedMoodboardId) { setSelectedMoodboardId(null); return true; }
      if (isMoodboardsOpen) { setIsMoodboardsOpen(false); return true; }
      if (isInspirationsOpen) { setIsInspirationsOpen(false); return true; }
      if (isAllStoriesOpen) { setIsAllStoriesOpen(false); return true; }
      if (isJoinCelebrationModalOpen) { setIsJoinCelebrationModalOpen(false); return true; }
      return false; // Let default system back behavior happen (exit app if on home)
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [selectedStory, selectedArticle, playingFilmId, selectedMoodboardId, isMoodboardsOpen, isInspirationsOpen, isAllStoriesOpen, isJoinCelebrationModalOpen]);

  // Tab bar event listeners — My Moodboard + Inspirations tabs
  useEffect(() => {
    const offMoodboards   = tabEvents.on(TAB_OPEN_MOODBOARDS,   () => setIsMoodboardsOpen(true));
    // Inspirations tab → opens dedicated Inspirations view
    const offInspirations = tabEvents.on(TAB_OPEN_INSPIRATIONS, () => setIsInspirationsOpen(true));
    return () => { offMoodboards(); offInspirations(); };
  }, []);

  // Tier 2 Editorial Rotation History: tracks lastShownAt per hero type
  const [tier2History, setTier2History] = useState<Record<string, { lastShownAt: number }>>({});

  // Session-locked Tier 2 Hero ref — persists selected Tier 2 hero for current app session
  const sessionTier2HeroRef = React.useRef<HeroCard | null>(null);

  // Welcome Hero editorial rotation — pick once per session, session-stable via ref
  const welcomeEditorialRef = React.useRef<string>(pickWelcomeEditorial());

  // Live Hero message stability — keyed by slug, picks once per LIVE period
  const liveMessageRef = React.useRef<Record<string, { h: string; s: string }>>({});
  const getStableLiveMessage = (slug: string, title: string): { h: string; s: string } => {
    if (!liveMessageRef.current[slug]) {
      liveMessageRef.current[slug] = pickLiveMessage(title);
    }
    return liveMessageRef.current[slug];
  };

  // Hero fade transition — fades out to 0 then back to 1 whenever the hero type changes
  const heroFadeAnim = React.useRef(new Animated.Value(1)).current;
  const prevHeroTypeRef = React.useRef<string | null>(null);

  // Load liked photos from storage
  useEffect(() => {
    AsyncStorage.getItem('@mycircle_liked_photos')
      .then((stored) => {
        if (stored) setLikedPhotos(JSON.parse(stored));
      })
      .catch(() => {});
  }, []);

  // Filter featured films ONLY (curated website featured films)
  const featuredFilmsOnly = React.useMemo(() => {
    return websiteFilms.filter((f: any) => f.is_featured || f.isFeatured || websiteFilms.every(item => !item.is_featured));
  }, [websiteFilms]);

  // Helper to extract YouTube 11-char video ID
  const extractYouTubeId = (film: any): string | null => {
    if (!film) return null;
    if (film.youtube_video_id) return film.youtube_video_id;
    const targetUrl = film.youtube_url || film.video_url || '';
    const match = targetUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    return match ? match[1] : null;
  };

  // Load cached stories, films, hero data & events from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.multiGet([
      HERO_STORAGE_KEYS.FACE_MATCHES,
      HERO_STORAGE_KEYS.HIGHLIGHTS,
      HERO_STORAGE_KEYS.GALLERY_READY,
      HERO_STORAGE_KEYS.TIER2_HISTORY,
      '@mycircle_user_events_cache',
      '@mycircle_cached_website_stories',
      '@mycircle_cached_website_films',
    ])
      .then(([seenDataItem, highlightsItem, galleryReadyItem, historyItem, eventsItem, storiesItem, filmsItem]) => {
        if (seenDataItem[1]) {
          try { setHeroSeenData(JSON.parse(seenDataItem[1])); } catch (_) {}
        }
        if (highlightsItem[1]) {
          try { setHighlightsHeroData(JSON.parse(highlightsItem[1])); } catch (_) {}
        }
        if (galleryReadyItem[1]) {
          try { setGalleryReadyHeroData(JSON.parse(galleryReadyItem[1])); } catch (_) {}
        }
        if (historyItem[1]) {
          try { setTier2History(JSON.parse(historyItem[1])); } catch (_) {}
        }
        if (eventsItem[1]) {
          try {
            const cachedEvents = JSON.parse(eventsItem[1]);
            if (Array.isArray(cachedEvents) && cachedEvents.length > 0 && events.length === 0) {
              const sorted = [...cachedEvents].sort((a, b) => {
                const timeA = a.date ? new Date(a.date).getTime() : 0;
                const timeB = b.date ? new Date(b.date).getTime() : 0;
                return timeB - timeA;
              });
              setEvents(sorted);
            }
          } catch (_) {}
        }
        if (storiesItem[1]) {
          try {
            const cachedStories = JSON.parse(storiesItem[1]);
            if (Array.isArray(cachedStories) && cachedStories.length > 0) {
              setWebsiteStories(cachedStories);
            }
          } catch (_) {}
        }
        if (filmsItem[1]) {
          try {
            const cachedFilms = JSON.parse(filmsItem[1]);
            if (Array.isArray(cachedFilms) && cachedFilms.length > 0) {
              setWebsiteFilms(cachedFilms);
            }
          } catch (_) {}
        }
      })
      .catch(() => {})
      .finally(() => setCountsLoaded(true));
  }, []);

  const storyDetailsCacheRef = useRef<Record<string, any>>({});

  // Helper to parse full story API payload into cached gallery format
  const parseFullStoryPayload = useCallback((fullStory: any, fallbackStory?: any) => {
    const photos = fullStory.photos || fullStory.images || fullStory.gallery || [];
    const galleryImages = formatUniversalGalleryImages(photos, fullStory.title || (fallbackStory && fallbackStory.title), fullStory.category || 'GALLERY');

    const rawTabs = fullStory.tabs || fullStory.categories || fullStory.category || [];
    const parsedTabs = Array.isArray(rawTabs) 
      ? rawTabs.filter((s: any) => typeof s === 'string' && s.trim().length <= 25)
      : (typeof rawTabs === 'string' ? rawTabs.split(',').map((s: string) => s.trim()).filter((s: string) => s && s.length <= 25) : []);

    const coverUri = fullStory.cover_image_mobile_url || fullStory.cover_image_url || fullStory.grid_image_url;

    return {
      ...(fallbackStory || {}),
      id: String(fullStory.id || (fallbackStory && fallbackStory.id)),
      title: fullStory.title || (fallbackStory && fallbackStory.title),
      subtitle: fullStory.subtitle || fullStory.category || (fallbackStory && fallbackStory.subtitle),
      location: fullStory.location || (fallbackStory && fallbackStory.location),
      date: fullStory.date || (fallbackStory && fallbackStory.date),
      coverImage: coverUri ? { uri: coverUri } : (fallbackStory && fallbackStory.coverImage),
      description: fullStory.description || fullStory.subtitle || (fallbackStory && fallbackStory.description),
      images: galleryImages,
      tabs: parsedTabs,
    };
  }, []);

  // Fetch featured stories & films from website API in background
  useEffect(() => {
    const fetchWebsiteData = async () => {
      try {
        const storiesRes = await fetch('https://www.mistyvisuals.com/api/website/stories');
        if (storiesRes.ok) {
          const storiesData = await storiesRes.json();
          if (Array.isArray(storiesData) && storiesData.length > 0) {
            setWebsiteStories(storiesData);
            AsyncStorage.setItem('@mycircle_cached_website_stories', JSON.stringify(storiesData)).catch(() => {});

            // Background pre-fetch full story details for top stories so tapping them opens INSTANTLY
            storiesData.forEach(async (s: any) => {
              if (!s.slug) return;
              try {
                const sRes = await fetch(`https://www.mistyvisuals.com/api/website/stories/${s.slug}`);
                if (sRes.ok) {
                  const fullStory = await sRes.json();
                  const parsed = parseFullStoryPayload(fullStory, s);
                  storyDetailsCacheRef.current[s.slug] = parsed;
                  const thumbUris = (parsed.images || []).map((g: any) => g.uri).filter(Boolean);
                  if (thumbUris.length > 0) {
                    ExpoImage.prefetch(thumbUris);
                  }
                }
              } catch (_) {}
            });
          }
        }
      } catch (e) {
        console.warn('Failed to fetch website stories:', e);
      }

      try {
        const filmsRes = await fetch('https://www.mistyvisuals.com/api/website/films');
        if (filmsRes.ok) {
          const filmsData = await filmsRes.json();
          if (Array.isArray(filmsData) && filmsData.length > 0) {
            setWebsiteFilms(filmsData);
            AsyncStorage.setItem('@mycircle_cached_website_films', JSON.stringify(filmsData)).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('Failed to fetch website films:', e);
      }

      try {
        const inspoRes = await fetch('https://www.mistyvisuals.com/api/app/inspirations');
        if (inspoRes.ok) {
          const inspoData = await inspoRes.json();
          if (Array.isArray(inspoData)) {
            setWebsiteInspirations(inspoData);
          }
        }
      } catch (e) {
        console.warn('Failed to fetch website inspirations:', e);
      }
    };
    fetchWebsiteData();
  }, [parseFullStoryPayload]);

  // Fetch joined wedding events if authenticated
  const fetchUserEvents = useCallback(async () => {
    if (!token) {
      setEvents([]);
      AsyncStorage.removeItem('@mycircle_user_events_cache').catch(() => {});
      return;
    }
    try {
      const res = await api.get('/api/gallery/family/events');
      const rawEvents: any[] = res.data.events || [];
      const sortedEvents = [...rawEvents].sort((a, b) => {
        const timeA = a.date ? new Date(a.date).getTime() : 0;
        const timeB = b.date ? new Date(b.date).getTime() : 0;
        return timeB - timeA;
      });
      setEvents(sortedEvents);
      AsyncStorage.setItem('@mycircle_user_events_cache', JSON.stringify(sortedEvents)).catch(() => {});
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        console.warn('fetchUserEvents failed:', err?.message);
      }
    } finally {
      setLoadingEvents(false);
    }
  }, [token]);

  useEffect(() => {
    fetchUserEvents();
  }, [fetchUserEvents]);

  const isGlobalClickBusyRef = useRef(false);

  const handleStoryPress = async (story: any) => {
    if (isGlobalClickBusyRef.current || selectedStory !== null) return;
    isGlobalClickBusyRef.current = true;
    setTimeout(() => { isGlobalClickBusyRef.current = false; }, 600);

    // 0ms instant load if pre-cached in background
    if (story && story.slug && storyDetailsCacheRef.current[story.slug]) {
      setSelectedStory(storyDetailsCacheRef.current[story.slug]);
      return;
    }

    // Immediately open modal with existing story metadata while fetching details
    setSelectedStory(story);

    if (story && story.slug) {
      try {
        const res = await fetch(`https://www.mistyvisuals.com/api/website/stories/${story.slug}`);
        if (res.ok) {
          const fullStory = await res.json();
          const parsed = parseFullStoryPayload(fullStory, story);
          storyDetailsCacheRef.current[story.slug] = parsed;
          setSelectedStory(parsed);

          const thumbUris = (parsed.images || []).map((g: any) => g.uri).filter(Boolean);
          if (thumbUris.length > 0) {
            ExpoImage.prefetch(thumbUris);
          }
        }
      } catch (e) {
        console.warn('Failed to load full story from website:', e);
      }
    }
  };

  // Helper for same-day date comparison
  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  // Lifecycle Stage Resolver:
  // 1. Primary Source of Truth: `ev.stage`
  // 2. Legacy Migration Fallback: executed ONLY if `ev.stage` is null/undefined
  const resolveCanonicalStage = (ev: any, today: Date): 'UPCOMING' | 'LIVE' | 'READY' | 'HIGHLIGHTS' | 'CURATING' => {
    const hasHighlightsPhotos = (ev.highlightsPhotoCount || 0) > 0;

    // 1. Primary Source of Truth (HIGHLIGHTS requires at least 1 highlight photo)
    if ((ev.stage === 'HIGHLIGHTS' || ev.highlightsReady || ev.isHighlights) && hasHighlightsPhotos) {
      return 'HIGHLIGHTS';
    }
    if (ev.stage && ev.stage !== 'HIGHLIGHTS') {
      return ev.stage;
    }

    const eventDate = new Date(ev.date);
    const isToday = isSameDay(eventDate, today);

    if (eventDate > today && !isToday) {
      return 'UPCOMING';
    }
    if (isToday) {
      return 'LIVE';
    }
    if (eventDate < today && !isToday && (ev.matchedCount || 0) === 0) {
      return 'CURATING';
    }

    return 'READY';
  };

  // Calendar days difference helper (midnight-to-midnight)
  const getCalendarDaysDifference = (targetDate: Date, currentDate: Date): number => {
    const d1 = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const d2 = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    return Math.round((d1.getTime() - d2.getTime()) / 86400000);
  };

  // Helper for My Circle card status subtext (Editorial Lifecycle Presentation)
  const getMyCircleStatusCopy = (ev: any, today: Date): string => {
    const eventDate = new Date(ev.date);
    const isToday = isSameDay(eventDate, today);
    const hasHighlightsPhotos = (ev.highlightsPhotoCount || 0) > 0;

    // 1. HIGHLIGHTS (Requires at least 1 published highlight photo)
    if ((ev.stage === 'HIGHLIGHTS' || ev.highlightsReady || ev.isHighlights) && hasHighlightsPhotos) {
      return 'Highlights are ready to relive';
    }

    // 2. LIVE / TODAY (Takes precedence if event is today)
    if (ev.stage === 'LIVE' || isToday) {
      return 'Celebration is happening today';
    }

    // 3. UPCOMING
    if (ev.stage === 'UPCOMING' || eventDate > today) {
      const days = getCalendarDaysDifference(eventDate, today);
      if (days <= 0) {
        return 'Celebration is happening today';
      }
      if (days === 1) {
        return 'Wedding tomorrow';
      }
      return `Wedding in ${days} days`;
    }

    // 4. CURATING (Begins AFTER wedding day, continues until first gallery is available)
    if (ev.stage === 'CURATING' || (eventDate < today && !isToday && (ev.matchedCount || 0) === 0 && ev.stage !== 'READY')) {
      return 'Currently curating your memories';
    }

    // 5. READY
    return 'Your gallery is ready to explore';
  };

  // ─── Scalable Two-Tier Hero Resolver Engine ────────────────────────────────
  const singleHeroCard = React.useMemo((): HeroCard | null => {
    return resolveHomeHero({
      events,
      heroSeenData,
      highlightsHeroData,
      galleryReadyHeroData,
      tier2History,
      profileName: profile?.name,
      today: new Date(),
      welcomeEditorial: welcomeEditorialRef.current,
      getStableLiveMessage,
      sessionTier2Ref: sessionTier2HeroRef,
    });
  }, [events, heroSeenData, highlightsHeroData, galleryReadyHeroData, tier2History, profile?.name, loadingEvents]);

  // Track lastShownAt timestamp for selected Tier 2 hero
  useEffect(() => {
    if (!singleHeroCard) return;
    const type = singleHeroCard.type;
    setTier2History((prev) => {
      const lastShown = prev[type]?.lastShownAt || 0;
      if (Date.now() - lastShown < 10000) return prev; // Avoid redundant saves within 10s
      const next = { ...prev, [type]: { lastShownAt: Date.now() } };
      AsyncStorage.setItem(HERO_STORAGE_KEYS.TIER2_HISTORY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [singleHeroCard]);

  // Hero fade transition — triggers only when the hero TYPE changes (not on content updates)
  useEffect(() => {
    const currentType = singleHeroCard?.type ?? null;
    if (prevHeroTypeRef.current !== null && prevHeroTypeRef.current !== currentType) {
      // Type changed: fade out → new content renders → fade in
      Animated.sequence([
        Animated.timing(heroFadeAnim, { toValue: 0, duration: HERO_TRANSITION.FADE_OUT_MS, useNativeDriver: true }),
        Animated.timing(heroFadeAnim, { toValue: 1, duration: HERO_TRANSITION.FADE_IN_MS, useNativeDriver: true }),
      ]).start();
    }
    prevHeroTypeRef.current = currentType;
  }, [singleHeroCard?.type]);

  // Initialise / reset galleryReadyHeroData for any event in READY stage or with published gallery photos
  useEffect(() => {
    if (!countsLoaded || events.length === 0) return;
    const now = Date.now();
    setGalleryReadyHeroData((prev) => {
      let changed = false;
      const next = { ...prev };
      events.forEach((e: any) => {
        const photoCount = e.totalPhotoCount || e.matchedCount || 0;
        if (e.stage === 'READY' || (photoCount > 0 && e.stage !== 'HIGHLIGHTS')) {
          const entry = next[e.slug];
          if (!entry) {
            next[e.slug] = { firstShownAt: now, lastSeenCount: photoCount };
            changed = true;
          } else if (photoCount > entry.lastSeenCount) {
            // New photos published — reset the 21-day window
            next[e.slug] = { firstShownAt: now, lastSeenCount: photoCount };
            changed = true;
          }
        }
      });
      if (changed) {
        AsyncStorage.setItem(HERO_STORAGE_KEYS.GALLERY_READY, JSON.stringify(next)).catch(() => {});
      }
      return changed ? next : prev;
    });
  }, [events, countsLoaded]);

  // When new events arrive: initialise heroSeenData entries for any event with matches
  // (sets firstSeenAt if this is the first time we see a non-zero matchedCount)
  useEffect(() => {
    if (!countsLoaded || events.length === 0) return;
    const now = Date.now();
    setHeroSeenData(prev => {
      let changed = false;
      const next = { ...prev };
      events.forEach((e: any) => {
        if ((e.matchedCount || 0) > 0 && !next[e.slug]) {
          // First ever detection of matches for this event — start the 7-day window
          next[e.slug] = { lastSeenCount: 0, firstSeenAt: now };
          changed = true;
        }
      });
      if (changed) {
        AsyncStorage.setItem(HERO_STORAGE_KEYS.FACE_MATCHES, JSON.stringify(next)).catch(() => {});
      }
      return changed ? next : prev;
    });
  }, [events, countsLoaded]);

  const handleHeroPress = (card: any) => {
    if (card.eventSlug) {
      // Mark current matchedCount as seen so hero only reappears on new photos
      const targetEvent = events.find((e: any) => e.slug === card.eventSlug);
      if (targetEvent && (targetEvent.matchedCount || 0) > 0) {
        setHeroSeenData(prev => {
          const next = {
            ...prev,
            [card.eventSlug]: {
              lastSeenCount: targetEvent.matchedCount,
              firstSeenAt: prev[card.eventSlug]?.firstSeenAt ?? Date.now(),
            },
          };
          AsyncStorage.setItem(HERO_STORAGE_KEYS.FACE_MATCHES, JSON.stringify(next)).catch(() => {});
          return next;
        });
      }
      const coverUrl = targetEvent?.coverPhotoUrl || targetEvent?.coverPhotoSquareUrl || targetEvent?.coverPhotoMobileUrl || null;
      const title = targetEvent?.title || null;
      setEventDetails(card.eventSlug, null, coverUrl, title);
      router.replace('/mycircle');
    }
  };

  const handleEventCardClick = (ev: any) => {
    const coverUrl = ev.coverPhotoUrl || ev.coverPhotoSquareUrl || ev.coverPhotoMobileUrl || null;
    setEventDetails(ev.slug, null, coverUrl, ev.title);
    router.replace('/mycircle');
  };

  // Dynamic Vibe filters from website story categories (100% dynamic from DB)
  const vibeFilters = React.useMemo(() => {
    const categoriesSet = new Set<string>();
    websiteStories.forEach((s: any) => {
      const cats = (s.category || '').split(',').map((c: string) => c.trim()).filter(Boolean);
      cats.forEach((c: string) => categoriesSet.add(c));
    });
    return ['All', ...Array.from(categoriesSet).sort()];
  }, [websiteStories]);

  // Vibe Category Cards for 2x2 grid (100% dynamic with priority-based unique cover deduplication)
  const vibeCategoryCards = React.useMemo(() => {
    const categoryMap = new Map<string, { name: string; count: number; items: any[] }>();

    // 1. Group stories by category
    websiteStories.forEach((item: any) => {
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

    // Sort processing priority by count ASCENDING so categories with fewer stories select their covers FIRST.
    // This prevents multi-story categories (like Destination with 3 stories) from stealing the only cover of single-story categories (like Intimate).
    const sortedCategories = [...categoryList].sort((a, b) => a.count - b.count);
    const assignedCoversMap = new Map<string, any>();
    const usedCoverUris = new Set<string>();

    sortedCategories.forEach((cat) => {
      let chosenCoverSrc: any = null;
      let chosenUriKey: string | null = null;

      // Try to find a story in this category with a cover URI not used by previous cards
      for (const item of cat.items) {
        const coverUri = item.cover_image_mobile_url || item.cover_image_url || item.grid_image_url;
        const coverSrc = coverUri ? { uri: coverUri } : typeof item.img === 'string' ? { uri: item.img } : item.img || null;
        const uriKey = typeof coverSrc === 'object' && coverSrc?.uri ? coverSrc.uri : (typeof coverSrc === 'string' ? coverSrc : null);

        if (coverSrc && uriKey && !usedCoverUris.has(uriKey)) {
          chosenCoverSrc = coverSrc;
          chosenUriKey = uriKey;
          break;
        }
      }

      // Fallback: if all covers in this category were used by previous cards, pick the first available cover
      if (!chosenCoverSrc && cat.items.length > 0) {
        const firstItem = cat.items[0];
        const coverUri = firstItem.cover_image_mobile_url || firstItem.cover_image_url || firstItem.grid_image_url;
        chosenCoverSrc = coverUri ? { uri: coverUri } : typeof firstItem.img === 'string' ? { uri: firstItem.img } : firstItem.img || null;
        chosenUriKey = typeof chosenCoverSrc === 'object' && chosenCoverSrc?.uri ? chosenCoverSrc.uri : (typeof chosenCoverSrc === 'string' ? chosenCoverSrc : null);
      }

      if (chosenUriKey) {
        usedCoverUris.add(chosenUriKey);
      }
      assignedCoversMap.set(cat.name, chosenCoverSrc);
    });

    // Return in original category list order
    return categoryList.map((cat) => ({
      name: cat.name,
      count: cat.count,
      coverImage: assignedCoversMap.get(cat.name) || null,
    }));
  }, [websiteStories]);

  // Inspiration Category Cards for 2x2 grid (100% dynamic from DB inspirations categories with unique cover deduplication)
  const inspoCategoryCards = React.useMemo(() => {
    const categoryMap = new Map<string, { name: string; count: number; totalPhotos: number; items: any[] }>();

    // 1. Group inspirations by category
    websiteInspirations.forEach((item: any) => {
      const cats = (item.category || '').split(',').map((c: string) => c.trim()).filter(Boolean);
      const photosCount = Array.isArray(item.images) ? item.images.length : 0;

      cats.forEach((catName: string) => {
        if (!categoryMap.has(catName)) {
          categoryMap.set(catName, { name: catName, count: 1, totalPhotos: photosCount, items: [item] });
        } else {
          const existing = categoryMap.get(catName)!;
          existing.count += 1;
          existing.totalPhotos += photosCount;
          existing.items.push(item);
        }
      });
    });

    const categoryList = Array.from(categoryMap.values()).slice(0, 4);

    // If no DB categories exist yet, fallback to individual inspiration collections
    if (categoryList.length === 0) {
      return websiteInspirations.slice(0, 4).map((board) => {
        const coverSrc = board.coverImageMobile || board.coverImage || (board.images && board.images[0]);
        const photoCount = Array.isArray(board.images) ? board.images.length : 0;
        return {
          name: board.title,
          count: photoCount,
          totalPhotos: photoCount,
          coverImage: coverSrc ? (typeof coverSrc === 'string' ? { uri: coverSrc } : coverSrc) : null,
          isDirectBoard: true,
          board: board,
        };
      });
    }

    const sortedCategories = [...categoryList].sort((a, b) => a.count - b.count);
    const assignedCoversMap = new Map<string, any>();
    const usedCoverUris = new Set<string>();

    sortedCategories.forEach((cat) => {
      let chosenCoverSrc: any = null;
      let chosenUriKey: string | null = null;

      for (const item of cat.items) {
        const coverUri = item.coverImageMobile || item.coverImage || (item.images && item.images[0]);
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
        const coverUri = firstItem.coverImageMobile || firstItem.coverImage || (firstItem.images && firstItem.images[0]);
        chosenCoverSrc = coverUri ? (typeof coverUri === 'string' ? { uri: coverUri } : coverUri) : null;
        chosenUriKey = typeof chosenCoverSrc === 'object' && chosenCoverSrc?.uri ? chosenCoverSrc.uri : (typeof chosenCoverSrc === 'string' ? chosenCoverSrc : null);
      }

      if (chosenUriKey) {
        usedCoverUris.add(chosenUriKey);
      }
      assignedCoversMap.set(cat.name, chosenCoverSrc);
    });

    return categoryList.map((cat) => ({
      name: cat.name,
      count: cat.count,
      totalPhotos: cat.totalPhotos,
      coverImage: assignedCoversMap.get(cat.name) || null,
      isDirectBoard: false,
      board: null,
    }));
  }, [websiteInspirations]);

  // Helper to filter website portfolio stories by selected Vibe
  const getFilteredVibeStories = () => {
    const sourceStories = websiteStories;

    if (selectedVibe === 'All') {
      return sourceStories;
    }

    return sourceStories.filter((s: any) => {
      const v = selectedVibe.toLowerCase();
      const dbCategories = (s.category || '').split(',').map((c: string) => c.trim().toLowerCase());
      if (dbCategories.includes(v)) return true;

      const title = (s.title || '').toLowerCase();
      const sub = (s.subtitle || '').toLowerCase();
      const loc = (s.location || '').toLowerCase();
      return title.includes(v) || sub.includes(v) || loc.includes(v);
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {/* ── 1. Hero Card (Minimalist Architectural — Editorial Copy) ── */}
        {singleHeroCard && (
          <Animated.View style={{ opacity: heroFadeAnim }}>
            <Pressable
              style={styles.heroSection}
              onPress={() => handleHeroPress(singleHeroCard)}
              disabled={!singleHeroCard.eventSlug || !singleHeroCard.cta}
            >
              <View style={styles.heroContentRow}>
                <View style={styles.heroGoldLine} />
                <View style={styles.heroTextContainer}>
                  <Text style={styles.greetingText}>{singleHeroCard.headline}</Text>
                  <Text style={styles.subtitleText}>{singleHeroCard.subtitle}</Text>
                  {singleHeroCard.cta ? (
                    <View style={styles.heroCtaButton}>
                      <Text style={styles.heroCtaText}>{singleHeroCard.cta}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          </Animated.View>
        )}

        {/* ── 2. My Circle (Only for users with joined celebrations) ── */}
        {token && events.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>MY CIRCLE</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              contentContainerStyle={styles.horizontalScroll}
              snapToInterval={width * 0.85 + 16}
              decelerationRate="fast"
            >
              {events.map((ev) => {
                const today = new Date();
                const statusMsg = getMyCircleStatusCopy(ev, today);
                const coverUrl = ev.coverPhotoUrl || ev.coverPhotoSquareUrl || ev.coverPhotoMobileUrl || null;

                return (
                  <Pressable 
                    key={ev.id} 
                    style={styles.myCircleCard}
                    onPress={() => handleEventCardClick(ev)}
                  >
                    {coverUrl ? (
                      <Image source={{ uri: coverUrl }} style={styles.myCircleCardImage} />
                    ) : (
                      <View style={styles.myCircleCardFallback}>
                        <Text style={{ fontSize: 32, color: '#a07850' }}>✨</Text>
                      </View>
                    )}
                    <LinearGradient 
                      colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.88)']} 
                      locations={[0, 0.45, 1]} 
                      style={styles.myCircleCardOverlay} 
                    />
                    <View style={styles.myCircleCardContent}>
                      <Text style={styles.myCircleCardTitle}>{ev.title}</Text>
                      <View style={styles.myCircleCardBottomRow}>
                        <Text style={styles.myCircleCardStatus}>{statusMsg}</Text>
                        <Text style={styles.myCircleCardCta}>View Gallery →</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── 3. My Likes (Conditional: ONLY rendered if user has liked photos) ── */}
        {likedPhotos.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>MY LIKES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {likedPhotos.map((photo, idx) => (
                <Pressable
                  key={photo.id || idx}
                  style={styles.likedCard}
                  onPress={() => {
                    // Open liked photo preview
                  }}
                >
                  <Image source={{ uri: photo.r2Url || photo.url }} style={styles.likedImage} />
                  <View style={styles.likedBadge}>
                    <Text style={styles.likedBadgeText}>❤️</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── 4. Featured Stories ─────────────────────────────────────────── */}
        {websiteStories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>FEATURED STORIES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {websiteStories
                .filter((s) => s.is_featured || websiteStories.every(item => !item.is_featured))
                .map((s) => ({
                  id: String(s.id),
                  slug: s.slug,
                  title: s.title,
                  subtitle: s.subtitle || s.category || 'Featured Story',
                  location: s.location || 'Misty Visuals',
                  date: s.date || '',
                  coverImage: (s.cover_image_mobile_url || s.cover_image_url || s.grid_image_url) 
                    ? { uri: s.cover_image_mobile_url || s.cover_image_url || s.grid_image_url }
                    : null,
                  description: s.subtitle || 'Unscripted moments and intentional design.',
                  images: []
                }))
                .map((story) => (
                  <Pressable 
                    key={story.id} 
                    style={styles.featuredCard}
                    onPress={() => handleStoryPress(story)}
                  >
                    {story.coverImage ? (
                      <Image source={story.coverImage} style={styles.featuredImage} />
                    ) : (
                      <View style={[styles.featuredImage, { backgroundColor: '#18181b' }]} />
                    )}
                    <LinearGradient 
                      colors={['transparent', 'rgba(18, 16, 14, 0.15)', 'rgba(18, 16, 14, 0.85)']} 
                      locations={[0, 0.45, 1]} 
                      style={styles.featuredOverlay} 
                    />
                    <View style={styles.featuredContent}>
                      <Text style={styles.featuredLocation}>{(story.location || 'MISTY VISUALS').toUpperCase()}</Text>
                      <Text style={styles.featuredTitle}>{story.title}</Text>
                      <Text style={styles.featuredReadMore}>View Collection →</Text>
                    </View>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        )}

        {/* ── 5. Featured Films (16:9 In-Place YouTube Playback) ───────────── */}
        {featuredFilmsOnly.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>FEATURED FILMS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {featuredFilmsOnly.map((film) => {
                const isPlaying = playingFilmId === String(film.id);
                const videoId = extractYouTubeId(film);
                const rawUrl = film.youtube_url || film.video_url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');

                const coverSrc =
                  typeof film.thumbnail_url === 'string'
                    ? { uri: film.thumbnail_url }
                    : film.thumbnail_url
                    ? film.thumbnail_url
                    : videoId
                    ? { uri: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` }
                    : null;

                const filmCardWidth = width * 0.84;
                const filmCardHeight = filmCardWidth * (9 / 16);

                return (
                  <View key={film.id} style={styles.filmCard}>
                    {isPlaying && videoId ? (
                      <View style={{ flex: 1, position: 'relative', backgroundColor: '#000000' }}>
                        <YoutubePlayer
                          height={filmCardHeight}
                          width={filmCardWidth}
                          videoId={videoId}
                          play={true}
                          forceAndroidAutoplay={true}
                          initialPlayerParams={{
                            controls: false,
                            modestbranding: true,
                            rel: false,
                            preventFullScreen: false,
                          }}
                          onChangeState={(state: string) => {
                            if (state === 'ended') setPlayingFilmId(null);
                          }}
                          webViewProps={{
                            allowsInlineMediaPlayback: true,
                            allowsFullscreenVideo: true,
                            mediaPlaybackRequiresUserAction: false,
                          }}
                        />
                        {rawUrl ? (
                          <Pressable
                            style={styles.openYouTubeBadge}
                            onPress={() => Linking.openURL(rawUrl).catch(() => {})}
                          >
                            <Text style={styles.openYouTubeBadgeText}>YouTube ↗</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : (
                      <Pressable
                        style={{ flex: 1, position: 'relative' }}
                        onPress={() => {
                          if (videoId) {
                            setPlayingFilmId(String(film.id));
                          } else if (rawUrl) {
                            Linking.openURL(rawUrl).catch(() => {});
                          }
                        }}
                      >
                        {coverSrc ? (
                          <Image source={coverSrc} style={styles.filmImage} />
                        ) : (
                          <View style={[styles.filmImage, { backgroundColor: '#18181b' }]} />
                        )}
                        <LinearGradient
                          colors={['transparent', 'rgba(18, 16, 14, 0.15)', 'rgba(18, 16, 14, 0.82)']}
                          locations={[0, 0.5, 1]}
                          style={styles.featuredOverlay}
                        />
                        
                        {/* Dead-Center Glassmorphic Play Button matching Website */}
                        <View style={styles.playCenterOverlay}>
                          <View style={styles.websitePlayCircle}>
                            <Text style={styles.websitePlayTriangle}>▶</Text>
                          </View>
                        </View>

                        <View style={styles.filmContent}>
                          <Text style={styles.filmTitle}>{film.title}</Text>
                          {film.location ? <Text style={styles.filmLocation}>📍 {film.location}</Text> : null}
                        </View>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── 6. Aesthetics (2x2 Category Cards Grid) ─────── */}
        {(websiteInspirations.length > 0 || inspoCategoryCards.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>AESTHETICS</Text>

            {/* 2x2 Grid of Inspiration Category Cards */}
            <View style={styles.vibeGridContainer}>
              {inspoCategoryCards.map((card, index) => {
                const formattedTitle = (card.name || '')
                  .split(' ')
                  .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                  .join(' ');
                const subtext = card.totalPhotos > 0
                  ? `${card.totalPhotos} ${card.totalPhotos === 1 ? 'Photo' : 'Photos'} →`
                  : 'Explore Category →';

                return (
                  <Pressable
                    key={card.name || index}
                    style={styles.vibeGridCard}
                    onPress={() => {
                      if (card.isDirectBoard && card.board) {
                        const board = card.board;
                        const coverSrc = board.coverImageMobile || board.coverImage || (board.images && board.images[0]);
                        setSelectedStory({
                          id: String(board.id || board.slug),
                          title: board.title,
                          subtitle: board.subtitle || '',
                          location: (board.category || 'FINE ART INSPIRATION').toUpperCase(),
                          date: 'CURATED COLLECTION',
                          coverImage: coverSrc,
                          description: board.description || '',
                          images: (board.images || []).map((imgUrl: any, imgIdx: number) => ({
                            id: `inspo-${board.id || board.slug}-${imgIdx}`,
                            uri: typeof imgUrl === 'string' ? imgUrl : imgUrl.uri || imgUrl,
                            caption: board.title,
                            originalIndex: imgIdx,
                          })),
                        });
                      } else {
                        setSelectedInspoCategory(card.name);
                        setIsMoodboardsOpen(true);
                      }
                    }}
                  >
                    {card.coverImage ? (
                      <Image
                        source={typeof card.coverImage === 'string' ? { uri: card.coverImage } : card.coverImage}
                        style={styles.vibeCardImage}
                      />
                    ) : (
                      <View style={[styles.vibeCardImage, { backgroundColor: '#18181b' }]} />
                    )}
                    <LinearGradient
                      colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.85)']}
                      locations={[0, 0.4, 1]}
                      style={styles.featuredOverlay}
                    />
                    <View style={styles.vibeCardContent}>
                      <Text style={styles.vibeCardTitle} numberOfLines={1}>{formattedTitle}</Text>
                      <Text style={styles.vibeCardSubtext} numberOfLines={1}>{subtext}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* View More → Button */}
            <Pressable 
              style={styles.viewMoreGridBtn}
              onPress={() => {
                setSelectedInspoCategory(undefined);
                setIsMoodboardsOpen(true);
              }}
            >
              <Text style={styles.viewAllText}>View More →</Text>
            </Pressable>
          </View>
        )}

        {/* ── 7. Circle Journal ─────────────────────────────────────────────
             Hidden until real blog posts are available via API.
             To enable: fetch articles from your CMS/blog API and set websiteArticles state,
             then render them here exactly like Featured Stories.
        ────────────────────────────────────────────────────────────────────── */}

        {/* ── 8. Browse by Vibe (2x2 Visual Vibe Category Cards Grid) ─────── */}
        {vibeCategoryCards.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>BROWSE BY VIBE</Text>

            {/* 2x2 Grid of Vibe Category Cards */}
            <View style={styles.vibeGridContainer}>
              {vibeCategoryCards.map((card, index) => {
                const formattedTitle = card.name
                  .split(' ')
                  .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                  .join(' ');
                const subtext = card.count > 0
                  ? `${card.count} ${card.count === 1 ? 'Story' : 'Stories'} →`
                  : 'Explore Vibe →';

                return (
                  <Pressable
                    key={card.name || index}
                    style={styles.vibeGridCard}
                    onPress={() => {
                      if (isGlobalClickBusyRef.current || isAllStoriesOpen) return;
                      isGlobalClickBusyRef.current = true;
                      setTimeout(() => { isGlobalClickBusyRef.current = false; }, 500);
                      setSelectedVibe(card.name);
                      setIsAllStoriesOpen(true);
                    }}
                  >
                    {card.coverImage ? (
                      <Image source={card.coverImage} style={styles.vibeCardImage} />
                    ) : (
                      <View style={[styles.vibeCardImage, { backgroundColor: '#18181b' }]} />
                    )}
                    <LinearGradient 
                      colors={['transparent', 'rgba(18, 16, 14, 0.2)', 'rgba(18, 16, 14, 0.85)']} 
                      locations={[0, 0.4, 1]} 
                      style={styles.featuredOverlay} 
                    />
                    <View style={styles.vibeCardContent}>
                      <Text style={styles.vibeCardTitle} numberOfLines={1}>{formattedTitle}</Text>
                      <Text style={styles.vibeCardSubtext} numberOfLines={1}>{subtext}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* View More → Button */}
            <Pressable 
              style={styles.viewMoreGridBtn}
              onPress={() => {
                if (isGlobalClickBusyRef.current || isAllStoriesOpen) return;
                isGlobalClickBusyRef.current = true;
                setTimeout(() => { isGlobalClickBusyRef.current = false; }, 500);
                setSelectedVibe('All');
                setIsAllStoriesOpen(true);
              }}
            >
              <Text style={styles.viewAllText}>View More →</Text>
            </Pressable>
          </View>
        )}

        {/* ── 9. Join Celebration CTA (Closing Section at the Bottom) ─────── */}
        <View style={styles.joinCtaSection}>
          <View style={styles.joinCtaDivider} />
          <Text style={styles.joinCtaHeader}>
            {events.length === 0 ? 'Ready to relive a celebration?' : 'Join Another Celebration'}
          </Text>
          <Text style={styles.joinCtaSubline}>
            {events.length === 0
              ? 'Join using your invitation code to unlock your private memories and AI face-matched photos.'
              : 'Enter your invitation code or scan a QR code to unlock more private memories.'}
          </Text>
          <Pressable style={styles.joinCtaBtn} onPress={() => setIsJoinCelebrationModalOpen(true)}>
            <Text style={styles.joinCtaBtnText}>JOIN CELEBRATION →</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Modals */}
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
          setSelectedInspoCategory(undefined);
        }}
        selectedBoardId={selectedMoodboardId}
        selectedCategoryName={selectedInspoCategory}
        inspirations={websiteInspirations}
        categoryCards={inspoCategoryCards}
        onSelectInspiration={(board) => {
          setSelectedStory({
            id: String(board.id || board.slug),
            title: board.title,
            subtitle: board.subtitle || board.category || 'FINE ART INSPIRATION',
            location: 'FINE ART INSPIRATION',
            date: 'CURATED COLLECTION',
            coverImage: board.coverImageMobile || board.coverImage || (board.images && board.images[0]),
            description: board.description || '',
            images: (board.images || []).map((imgUrl: any, imgIdx: number) => ({
              id: `inspo-${board.id || board.slug}-${imgIdx}`,
              uri: typeof imgUrl === 'string' ? imgUrl : imgUrl.uri || imgUrl,
              caption: board.title,
              originalIndex: imgIdx,
            })),
          });
        }}
      />

      <AllStoriesView
        isOpen={isAllStoriesOpen}
        onClose={() => {
          setIsAllStoriesOpen(false);
          setSelectedVibe('All');
        }}
        stories={websiteStories}
        initialVibe={selectedVibe}
        categoryCards={vibeCategoryCards}
        onSelectStory={(story) => handleStoryPress(story)}
      />

      <JoinCelebrationModal
        visible={isJoinCelebrationModalOpen}
        onClose={() => setIsJoinCelebrationModalOpen(false)}
        onSuccess={() => {
          fetchUserEvents();
        }}
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
    paddingBottom: 100, // Space for bottom custom navigation tab
  },
  heroSection: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    backgroundColor: 'transparent',
  },
  heroContentRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  heroGoldLine: {
    width: 2.5,
    backgroundColor: '#C5A059',
    borderRadius: 2,
    marginRight: 16,
  },
  heroTextContainer: {
    flex: 1,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  greetingText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 24,
    color: '#1c1917',
    lineHeight: 30,
    letterSpacing: -0.2,
  },
  heroBadgeInline: {
    backgroundColor: 'rgba(197, 160, 89, 0.22)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
    marginLeft: 10,
    marginTop: 6,
  },
  heroBadge: {
    backgroundColor: 'rgba(197, 160, 89, 0.22)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  heroBadgeText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 9.5,
    color: '#8C6721',
    letterSpacing: 1.5,
  },
  subtitleText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 14,
    lineHeight: 21,
    color: '#403d39',
    marginTop: 6,
  },
  heroCtaButton: {
    marginTop: 18,
    backgroundColor: '#1c1917',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  heroCtaText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 12,
    color: '#ffffff',
    letterSpacing: 0.8,
  },
  section: {
    paddingTop: 32,
  },
  sectionHeader: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    letterSpacing: 2,
    color: '#8c867e',
    marginHorizontal: 24,
    marginBottom: 16,
  },
  horizontalScroll: {
    paddingLeft: 24,
    paddingRight: 12,
  },
  eventCard: {
    width: 200,
    marginRight: 16,
    borderWidth: 1,
    borderColor: '#f0ede8',
    backgroundColor: '#ffffff',
  },
  cardImageContainer: {
    width: '100%',
    height: 120,
    backgroundColor: '#f5f5f5',
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardImageFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 2,
  },
  badgeText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 8,
    color: '#ffffff',
    letterSpacing: 1,
  },
  cardInfo: {
    padding: 12,
  },
  cardTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 13,
    color: '#1c1a18',
    marginBottom: 4,
  },
  cardSubtext: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10.5,
    color: '#8c867e',
  },
  myCircleCard: {
    width: width * 0.85,
    aspectRatio: 3 / 2,
    marginRight: 16,
    backgroundColor: '#1c1a18',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 4,
  },
  myCircleCardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  myCircleCardFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1c1a18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  myCircleCardOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  myCircleCardContent: {
    position: 'absolute',
    bottom: 18,
    left: 18,
    right: 18,
  },
  myCircleCardTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 19,
    color: '#ffffff',
    marginBottom: 4,
    lineHeight: 24,
    letterSpacing: 0.2,
  },
  myCircleCardBottomRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  myCircleCardStatus: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    color: '#e5dfd5',
    letterSpacing: 0.3,
    flex: 1,
    marginRight: 12,
  },
  myCircleCardCta: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10.5,
    letterSpacing: 0.5,
    color: '#d0c8be',
  },
  featuredCard: {
    width: width * 0.7,
    height: 360,
    marginRight: 16,
    backgroundColor: '#1c1a18',
    position: 'relative',
    overflow: 'hidden',
  },
  featuredImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  featuredOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  featuredContent: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
  },
  featuredLocation: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 9,
    letterSpacing: 2,
    color: '#ffffff',
    marginBottom: 6,
    opacity: 0.8,
  },
  featuredTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 21,
    color: '#ffffff',
    marginBottom: 12,
  },
  featuredReadMore: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10.5,
    letterSpacing: 0.5,
    color: '#d0c8be',
  },
  articlesContainer: {
    paddingHorizontal: 24,
    gap: 16,
  },
  articleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
  },
  articleImage: {
    width: 80,
    height: 80,
    backgroundColor: '#f5f5f5',
    resizeMode: 'cover',
  },
  articleInfo: {
    flex: 1,
    paddingLeft: 16,
  },
  articleCategory: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 8,
    letterSpacing: 1.8,
    color: '#8c867e',
    marginBottom: 6,
  },
  articleTitle: {
    fontFamily: FONT_FUTURA,
    fontSize: 15,
    lineHeight: 20,
    color: '#1c1a18',
    marginBottom: 6,
  },
  articleMeta: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10,
    color: '#8c867e',
  },
  vibePillScroll: {
    paddingLeft: 24,
    paddingRight: 12,
    marginBottom: 16,
  },
  vibePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd8d0',
    marginRight: 8,
    backgroundColor: '#ffffff',
  },
  vibePillActive: {
    backgroundColor: '#1c1a18',
    borderColor: '#1c1a18',
  },
  vibeText: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    color: '#8c867e',
    letterSpacing: 0.8,
  },
  vibeTextActive: {
    color: '#ffffff',
  },
  vibeGridContainer: {
    paddingHorizontal: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    marginTop: 8,
  },
  vibeGridCard: {
    width: (width - 60) / 2,
    aspectRatio: 3 / 4,
    backgroundColor: '#1c1a18',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 6,
  },
  viewMoreGridBtn: {
    alignSelf: 'center',
    marginTop: 18,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  vibeGalleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  vibeGalleryItem: {
    width: '48%',
    marginBottom: 12,
  },
  vibeGalleryImage: {
    width: '100%',
    height: 140,
    backgroundColor: '#f5f5f5',
    resizeMode: 'cover',
  },
  vibeGalleryLabel: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 12,
    color: '#1c1a18',
    marginTop: 6,
    textAlign: 'center',
  },
  vibeGallerySublabel: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 9,
    color: '#8c867e',
    marginTop: 2,
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  emptyVibeContainer: {
    width: '100%',
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyVibeText: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    fontStyle: 'italic',
    color: '#8c867e',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 24,
    marginBottom: 16,
  },
  viewAllText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 10,
    letterSpacing: 1.5,
    color: '#a07850',
  },
  likedCard: {
    width: 130,
    height: 170,
    marginRight: 14,
    position: 'relative',
    backgroundColor: '#f9fafb',
    borderRadius: 2,
    overflow: 'hidden',
  },
  likedImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  likedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(28, 26, 24, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  likedBadgeText: {
    fontSize: 11,
  },
  filmCard: {
    width: width * 0.84,
    aspectRatio: 16 / 9,
    marginRight: 16,
    backgroundColor: '#000000',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 0,
  },
  openYouTubeBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(28, 26, 24, 0.85)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    zIndex: 10,
  },
  openYouTubeBadgeText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 9,
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  filmImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  playCenterOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  websitePlayCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  websitePlayTriangle: {
    color: '#ffffff',
    fontSize: 16,
    paddingLeft: 3,
  },
  filmContent: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
  filmCategory: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 8.5,
    letterSpacing: 1.8,
    color: '#a07850',
    marginBottom: 4,
  },
  filmTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 18,
    color: '#ffffff',
    marginBottom: 4,
  },
  filmLocation: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10,
    color: '#d0c8be',
  },
  moodboardCard: {
    width: width * 0.6,
    height: 180,
    marginRight: 16,
    backgroundColor: '#1c1a18',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 2,
  },
  moodboardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  moodboardContent: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
  moodboardTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 19,
    color: '#ffffff',
    marginBottom: 4,
  },
  moodboardSub: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10,
    color: '#d0c8be',
    letterSpacing: 0.5,
  },
  vibeCardItem: {
    width: 170,
    height: 230,
    marginRight: 14,
    backgroundColor: '#1c1a18',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 2,
  },
  vibeCardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  vibeCardContent: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
  },
  vibeCardTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 2,
  },
  vibeCardSubtext: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 9.5,
    color: '#d0c8be',
    letterSpacing: 0.5,
  },
  continueExploringCard: {
    width: 170,
    height: 230,
    marginRight: 16,
    backgroundColor: '#fbfaf8',
    borderWidth: 1,
    borderColor: '#e5e0d8',
    borderRadius: 2,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueExploringIcon: {
    fontSize: 24,
    marginBottom: 10,
  },
  continueExploringTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 13,
    color: '#1c1a18',
    textAlign: 'center',
    marginBottom: 6,
  },
  continueExploringSub: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 11,
    color: '#8c867e',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 15,
  },
  continueExploringCta: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 10,
    letterSpacing: 1.5,
    color: '#a07850',
  },
  joinCtaSection: {
    marginHorizontal: 24,
    marginTop: 48,
    marginBottom: 20,
    paddingVertical: 36,
    paddingHorizontal: 24,
    backgroundColor: '#fbfaf8',
    borderWidth: 1,
    borderColor: '#f0ede8',
    alignItems: 'center',
  },
  joinCtaDivider: {
    width: 40,
    height: 1,
    backgroundColor: '#a07850',
    marginBottom: 20,
  },
  joinCtaHeader: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 21,
    color: '#1c1a18',
    textAlign: 'center',
    marginBottom: 10,
  },
  joinCtaSubline: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: '#60646c',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
    marginBottom: 24,
  },
  joinCtaBtn: {
    backgroundColor: '#1c1a18',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 2,
  },
  joinCtaBtnText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    letterSpacing: 2,
    color: '#ffffff',
  },
});
