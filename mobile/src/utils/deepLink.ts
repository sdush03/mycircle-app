import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';

const HAS_CHECKED_DEFERRED_INVITE_KEY = 'has_checked_server_deferred_invite';

export function parseDeepLink(incomingUrl: string): { slug: string; passcode: string | null } | null {
  if (!incomingUrl) return null;

  try {
    const parsed = Linking.parse(incomingUrl);
    const rawCode = parsed.queryParams?.code || parsed.queryParams?.passcode || null;
    const passcode = Array.isArray(rawCode) ? rawCode[0] : (rawCode as string | null);

    let slug: string | null = null;

    if (parsed.queryParams?.slug) {
      const qSlug = parsed.queryParams.slug;
      slug = Array.isArray(qSlug) ? qSlug[0] : qSlug;
    } else if (parsed.path) {
      const parts = parsed.path.split('/').filter(Boolean);
      if (parts[0] === 'gallery' && parts[1]) {
        slug = parts[1];
      } else if (parts[0] === 'join' && parts[1]) {
        slug = parts[1];
      } else if (parts[0] && parts[0] !== 'join' && parts[0] !== 'gallery') {
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
        /^(?:\d{1,3}\.){3}\d{1,3}$/.test(lower);

      if (!isDevOrSystem) {
        return { slug, passcode: passcode || null };
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

  const { slug, passcode } = result;
  const token = useAuthStore.getState().token;

  console.log('[DeepLink] Processing event invite:', { slug, passcode, isAuthenticated: !!token });

  if (token) {
    useAuthStore.getState().setEventDetails(slug, passcode, null, null, 'mycircle');
  } else {
    useAuthStore.getState().setPendingInvite({ slug, passcode });
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
