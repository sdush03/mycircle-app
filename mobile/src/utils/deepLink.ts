import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../store/authStore';

const LAST_PROCESSED_CLIPBOARD_KEY = 'last_processed_clipboard_link';

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
 * Check device clipboard on cold launch for deferred iOS install handoff.
 * If the user copied an invite link on the web landing page, process it once.
 */
export async function checkClipboardForDeferredDeepLink() {
  try {
    const hasString = await Clipboard.hasStringAsync();
    if (!hasString) return;

    const text = await Clipboard.getStringAsync();
    if (!text || (!text.includes('mycircle') && !text.includes('mycircle.mistyvisuals.com'))) {
      return;
    }

    const lastProcessed = await AsyncStorage.getItem(LAST_PROCESSED_CLIPBOARD_KEY);
    if (lastProcessed === text) {
      return;
    }

    const result = parseDeepLink(text);
    if (result) {
      await AsyncStorage.setItem(LAST_PROCESSED_CLIPBOARD_KEY, text);
      handleIncomingUrl(text);
    }
  } catch (e) {
    console.warn('[DeepLink] Clipboard check error:', e);
  }
}
