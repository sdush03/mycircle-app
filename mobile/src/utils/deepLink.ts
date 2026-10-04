import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';

const HAS_CHECKED_DEFERRED_INVITE_KEY = 'has_checked_server_deferred_invite';

export interface DeepLinkResult {
  slug: string;
  passcode: string | null;
  tab?: string | null;
}

export function parseDeepLink(incomingUrl: string): DeepLinkResult | null {
  if (!incomingUrl) return null;

  try {
    const parsed = Linking.parse(incomingUrl);
    const rawCode = parsed.queryParams?.code || parsed.queryParams?.passcode || null;
    const passcode = Array.isArray(rawCode) ? rawCode[0] : (rawCode as string | null);
    const rawTab = parsed.queryParams?.tab || null;
    const tab = Array.isArray(rawTab) ? rawTab[0] : (rawTab as string | null);

    let slug: string | null = null;

    if (parsed.queryParams?.slug) {
      const qSlug = parsed.queryParams.slug;
      slug = Array.isArray(qSlug) ? qSlug[0] : qSlug;
    } else if (parsed.path) {
      const parts = parsed.path.split('/').filter(Boolean);
      const galleryIdx = parts.indexOf('gallery');
      const prefixIdx = parts.findIndex(p => p === 'celebration' || p === 'event' || p === 'join' || p === 'mycircle');

      if (galleryIdx > 0) {
        slug = parts[galleryIdx - 1];
      } else if (galleryIdx === 0 && parts[1]) {
        slug = parts[1];
      } else if (prefixIdx !== -1 && parts[prefixIdx + 1]) {
        slug = parts[prefixIdx + 1];
      } else if (parts[0] && parts[0] !== 'join' && parts[0] !== 'gallery' && parts[0] !== 'celebration' && parts[0] !== 'event') {
        slug = parts[0];
      }
    } else if (parsed.hostname && parsed.hostname !== 'mycircle.mistyvisuals.com' && parsed.hostname !== 'join') {
      slug = parsed.hostname;
    }

    if (slug) {
      const lower = slug.toLowerCase();
      const isDevOrSystem =
        lower.includes('expo') ||
        lower.includes('development-client') ||
        lower.includes('localhost') ||
        lower === 'build' ||
        lower === 'exp' ||
        lower === 'gallery' ||
        lower === 'join' ||
        lower === 'terms' ||
        lower === 'privacy' ||
        /^(?:\d{1,3}\.){3}\d{1,3}$/.test(lower);

      if (!isDevOrSystem) {
        return { slug, passcode: passcode || null, tab: tab || null };
      }
    }
  } catch (err) {
    console.warn('[DeepLink] Error parsing url:', incomingUrl, err);
  }

  return null;
}

export function handleIncomingUrl(url: string) {
  const result = parseDeepLink(url);
  if (!result) return;

  const { slug, passcode, tab } = result;
  const token = useAuthStore.getState().token;

  console.log('[DeepLink] Processing event invite:', { slug, passcode, tab, isAuthenticated: !!token });

  if (token) {
    useAuthStore.getState().setEventDetails(slug, passcode, null, null, 'mycircle', tab || null);
  } else {
    useAuthStore.getState().setPendingInvite({ slug, passcode, tab: tab || null });
  }
}

/**
 * Check backend server for pending deferred invite on first launch.
 * Zero clipboard access, Zero "Allow Paste" popups!
 */
export async function checkServerDeferredDeepLink() {
  try {
    const hasChecked = await AsyncStorage.getItem(HAS_CHECKED_DEFERRED_INVITE_KEY);
    if (hasChecked) return;

    await AsyncStorage.setItem(HAS_CHECKED_DEFERRED_INVITE_KEY, 'true');

    const res = await api.get('/api/gallery/public/consume-deferred-invite');
    if (res.data?.found && res.data?.slug) {
      const { slug, passcode } = res.data;
      console.log('[DeepLink] Found server deferred invite:', { slug, passcode });
      const token = useAuthStore.getState().token;
      if (token) {
        useAuthStore.getState().setEventDetails(slug, passcode, null, null, 'mycircle');
      } else {
        useAuthStore.getState().setPendingInvite({ slug, passcode });
      }
    }
  } catch (e) {
    console.warn('[DeepLink] Server deferred invite check error:', e);
  }
}

export interface ShareUrlOptions {
  customSlug?: string | null;
  tab?: 'Cinema' | 'Gallery' | string | null;
  storySlug?: string | null;
}

/**
 * Returns a universal web/app link for sharing instead of exposing direct media file URLs.
 * - Event gallery: https://mycircle.mistyvisuals.com/<slug>/gallery
 * - Event cinema: https://mycircle.mistyvisuals.com/<slug>/gallery?tab=Cinema
 * - Website story: https://www.mistyvisuals.com/stories/<storySlug>
 * - Fallback: https://mycircle.mistyvisuals.com
 */
export function getAppShareUrl(options?: ShareUrlOptions | string | null): string {
  const customSlug = typeof options === 'string' ? options : options?.customSlug;
  const tab = typeof options === 'object' && options ? options.tab : null;
  const storySlug = typeof options === 'object' && options ? options.storySlug : null;

  // 1. Website featured story
  if (storySlug) {
    return `https://www.mistyvisuals.com/stories/${storySlug}`;
  }

  const { eventSlug } = useAuthStore.getState();
  const slug = customSlug || eventSlug;

  // 2. Event celebration gallery
  if (slug) {
    const params: string[] = [];
    if (tab && tab.toLowerCase() !== 'all') {
      params.push(`tab=${encodeURIComponent(tab)}`);
    }
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    return `https://mycircle.mistyvisuals.com/${slug}/gallery${query}`;
  }

  // 3. Fallback
  return 'https://mycircle.mistyvisuals.com';
}


