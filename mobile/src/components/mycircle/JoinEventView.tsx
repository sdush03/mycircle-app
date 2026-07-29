import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../../store/authStore';
import { useScrollTabBarCollapse } from '../../hooks/useScrollTabBarCollapse';
import api from '../../services/api';
import JoinCelebrationModal from '../JoinCelebrationModal';
import {
  FONT_FUTURA,
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';

const JOINED_EVENTS_KEY = 'joined_events_list';
const { width } = Dimensions.get('window');

// 2-column layout math: 24px screen padding on each side, 12px gap between columns
const PADDING = 24;
const GAP = 12;
const COLUMN_WIDTH = (width - PADDING * 2 - GAP) / 2;

interface JoinEventViewProps {
  onSuccess: (slug: string, passcode: string | null) => void;
}

export default function JoinEventView({ onSuccess }: JoinEventViewProps) {
  const [events, setEvents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);

  const handleScroll = useScrollTabBarCollapse();

  const setEventDetails = useAuthStore((state) => state.setEventDetails);
  const profile = useAuthStore((state) => state.profile);

  // Load user's joined events from backend API + fallback to SecureStore
  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      setIsLoading(true);
      
      // 1. Fetch live events list from family endpoint
      const res = await api.get('/api/gallery/family/events');
      if (res.data?.events && Array.isArray(res.data.events)) {
        const sorted = [...res.data.events].sort((a, b) => {
          const timeA = a.date ? new Date(a.date).getTime() : 0;
          const timeB = b.date ? new Date(b.date).getTime() : 0;
          return timeB - timeA;
        });
        setEvents(sorted);
      } else {
        // Fallback to recent events from SecureStore
        loadRecentEvents();
      }
    } catch (e) {
      console.warn('Failed to fetch family events list, falling back to local storage:', e);
      loadRecentEvents();
    } finally {
      setIsLoading(false);
    }
  };

  const loadRecentEvents = async () => {
    try {
      const storedStr = await SecureStore.getItemAsync(JOINED_EVENTS_KEY);
      if (storedStr) {
        const parsed = JSON.parse(storedStr);
        if (Array.isArray(parsed)) {
          const sorted = [...parsed].sort((a, b) => {
            const timeA = a.date ? new Date(a.date).getTime() : 0;
            const timeB = b.date ? new Date(b.date).getTime() : 0;
            return timeB - timeA;
          });
          setEvents(sorted);
        }
      }
    } catch (e) {
      console.error('Failed to load recent events from storage:', e);
    }
  };

  // Helper for My Circle card status subtext (Editorial Lifecycle Presentation)
  const getMyCircleStatusCopy = (ev: any): string => {
    const today = new Date();
    const eventDate = new Date(ev.date || Date.now());
    const isToday =
      eventDate.getFullYear() === today.getFullYear() &&
      eventDate.getMonth() === today.getMonth() &&
      eventDate.getDate() === today.getDate();

    const hasHighlightsPhotos = (ev.highlightsPhotoCount || 0) > 0;
    if ((ev.stage === 'HIGHLIGHTS' || ev.highlightsReady || ev.isHighlights) && hasHighlightsPhotos) {
      return 'Highlights ready';
    }

    if (ev.stage === 'LIVE' || isToday) {
      return 'Happening today';
    }

    if (ev.stage === 'UPCOMING' || eventDate > today) {
      const d1 = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
      const d2 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const days = Math.round((d1.getTime() - d2.getTime()) / 86400000);
      if (days <= 0) return 'Happening today';
      if (days === 1) return 'Wedding tomorrow';
      return `In ${days} days`;
    }

    if (ev.stage === 'CURATING' || (eventDate < today && !isToday && (ev.matchedCount || 0) === 0 && ev.stage !== 'READY')) {
      return 'Currently curating';
    }

    return 'Gallery ready';
  };

  const handleSelectEvent = (ev: any) => {
    const slug = ev.slug;
    const coverUrl = ev.coverPhotoMobileUrl || ev.coverPhotoUrl || ev.coverPhotoSquareUrl || null;
    const title = ev.title || slug;
    
    setEventDetails(slug, ev.passcode || null, coverUrl, title);
    onSuccess(slug, ev.passcode || null);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      {/* Editorial Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View>
            <Text style={styles.headerCategory}>MY CIRCLE</Text>
            <Text style={styles.headerTitle}>All Celebrations</Text>
          </View>
          <Pressable style={styles.addBtn} onPress={() => setIsJoinModalOpen(true)}>
            <Text style={styles.addBtnText}>+ Join</Text>
          </Pressable>
        </View>
        <Text style={styles.headerSubtitle}>
          Select a celebration gallery to explore your private memories.
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1c1a18" />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.gridContainer}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          {events.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Text style={styles.emptyIcon}>✨</Text>
              </View>
              <Text style={styles.emptyTitle}>You are not part of any celebration yet</Text>
              <Text style={styles.emptySubtitle}>
                Scan your event QR code, enter an invite code, or open an invitation link to explore private memories.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.emptyPrimaryBtn,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => setIsJoinModalOpen(true)}
              >
                <Text style={styles.emptyPrimaryBtnText}>+ Join Celebration</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.gridRow}>
              {/* Render joined gallery cards */}
              {events.map((ev) => {
                const coverUrl = ev.coverPhotoMobileUrl || ev.coverPhotoUrl || ev.coverPhotoSquareUrl || null;
                const statusMsg = getMyCircleStatusCopy(ev);
                const locationText = (ev.location || 'MISTY VISUALS').toUpperCase();

                return (
                  <Pressable
                    key={ev.id || ev.slug}
                    style={({ pressed }) => [
                      styles.galleryCard,
                      pressed && styles.cardPressed,
                    ]}
                    onPress={() => handleSelectEvent(ev)}
                  >
                    {coverUrl ? (
                      <Image source={{ uri: coverUrl }} style={styles.cardCoverImage} contentFit="cover" />
                    ) : (
                      <View style={styles.cardFallbackImage}>
                        <Text style={{ fontSize: 28, color: '#a07850' }}>✨</Text>
                      </View>
                    )}

                    {/* Dark linear gradient overlay matching Featured Stories */}
                    <LinearGradient
                      colors={['transparent', 'rgba(18, 16, 14, 0.25)', 'rgba(18, 16, 14, 0.9)']}
                      locations={[0, 0.45, 1]}
                      style={styles.cardOverlay}
                    />

                    {/* Content overlay at bottom */}
                    <View style={styles.cardContent}>
                      <Text style={styles.cardTag} numberOfLines={1}>{locationText}</Text>
                      <Text style={styles.cardTitle} numberOfLines={1}>{ev.title}</Text>
                      <View style={styles.cardBottomRow}>
                        <Text style={styles.cardStatus} numberOfLines={1}>{statusMsg}</Text>
                        <Text style={styles.cardCta}>View →</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}

              {/* ── Join Celebration / Join Circle Card at the end of 2-column grid ── */}
              <Pressable
                style={({ pressed }) => [
                  styles.joinCard,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => setIsJoinModalOpen(true)}
              >
                <View style={styles.joinIconCircle}>
                  <Text style={styles.joinIconPlus}>+</Text>
                </View>
                <Text style={styles.joinCardTitle}>Join Circle</Text>
                <Text style={styles.joinCardSubtext}>Scan QR or enter code</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}

      {/* Pop-up Modal Component for Joining Celebrations */}
      <JoinCelebrationModal
        visible={isJoinModalOpen}
        onClose={() => setIsJoinModalOpen(false)}
        onSuccess={() => {
          fetchEvents();
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
  header: {
    paddingHorizontal: PADDING,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  headerCategory: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 9,
    letterSpacing: 2,
    color: '#a07850',
    marginBottom: 4,
  },
  headerTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 26,
    color: '#1c1a18',
  },
  addBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#1c1a18',
    borderRadius: 14,
    marginTop: 4,
  },
  addBtnText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    letterSpacing: 0.5,
    color: '#ffffff',
  },
  headerSubtitle: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12,
    color: '#60646c',
    lineHeight: 18,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridContainer: {
    paddingHorizontal: PADDING,
    paddingTop: 20,
    paddingBottom: 40,
  },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  galleryCard: {
    width: COLUMN_WIDTH,
    height: COLUMN_WIDTH * 1.35,
    backgroundColor: '#1c1a18',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  cardCoverImage: {
    width: '100%',
    height: '100%',
  },
  cardFallbackImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1c1a18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  cardContent: {
    position: 'absolute',
    bottom: 14,
    left: 12,
    right: 12,
  },
  cardTag: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 7,
    letterSpacing: 1.5,
    color: '#d0c8be',
    marginBottom: 3,
    opacity: 0.85,
  },
  cardTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 4,
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  cardStatus: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 9,
    color: '#e5dfd5',
    flex: 1,
    marginRight: 6,
  },
  cardCta: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 9,
    letterSpacing: 0.8,
    color: '#ffffff',
    opacity: 0.9,
  },

  /* Join Card (Last card in 2-column grid) */
  joinCard: {
    width: COLUMN_WIDTH,
    height: COLUMN_WIDTH * 1.35,
    backgroundColor: '#fbfaf8',
    borderWidth: 1.5,
    borderColor: '#e5e0d8',
    borderStyle: 'dashed',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  joinIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#a07850',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  joinIconPlus: {
    fontSize: 22,
    fontWeight: '300',
    color: '#a07850',
    lineHeight: 24,
  },
  joinCardTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 16,
    color: '#1c1a18',
    marginBottom: 4,
    textAlign: 'center',
  },
  joinCardSubtext: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 10,
    color: '#8c867e',
    textAlign: 'center',
    lineHeight: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
    marginTop: 20,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fbfaf8',
    borderWidth: 1,
    borderColor: '#e5e0d8',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyIcon: {
    fontSize: 26,
  },
  emptyTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 20,
    color: '#1c1a18',
    textAlign: 'center',
    marginBottom: 10,
  },
  emptySubtitle: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    color: '#60646c',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
    maxWidth: 320,
  },
  emptyPrimaryBtn: {
    backgroundColor: '#1c1a18',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 24,
    alignItems: 'center',
  },
  emptyPrimaryBtnText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 12,
    letterSpacing: 1,
    color: '#ffffff',
  },
});
