/**
 * Safe wrapper around expo-screen-capture.
 * Falls back to no-ops when native module is not linked.
 * Note: requires `cd ios && pod install` + a full native rebuild to activate.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
let _mod: any = null;
if (typeof require !== 'undefined') {
  try {
    // NativeModules check first — if the native module isn't registered, skip entirely
    const { NativeModules } = require('react-native');
    if (NativeModules?.ExpoScreenCapture) {
      _mod = require('expo-screen-capture');
      console.log('[MYCIRCLE SCREEN CAPTURE 🛡️] Native module loaded successfully');
    } else {
      console.warn('[MYCIRCLE SCREEN CAPTURE ⚠️] ExpoScreenCapture native module not found — rebuild with pod install required');
    }
  } catch (e: any) {
    console.warn('[MYCIRCLE SCREEN CAPTURE ⚠️] expo-screen-capture unavailable:', e?.message);
  }
}

export async function preventScreenCaptureAsync(key: string = 'default'): Promise<void> {
  if (!_mod?.preventScreenCaptureAsync) return;
  try {
    await _mod.preventScreenCaptureAsync(key);
    console.log(`[MYCIRCLE SCREEN CAPTURE ✅] PREVENTED — key: ${key}`);
  } catch (err: any) {
    console.error('[MYCIRCLE SCREEN CAPTURE ❌] prevent failed:', err?.message);
  }
}

export async function allowScreenCaptureAsync(key: string = 'default'): Promise<void> {
  if (!_mod?.allowScreenCaptureAsync) return;
  try {
    await _mod.allowScreenCaptureAsync(key);
  } catch (_) {}
}

export function addScreenshotListener(callback: () => void): { remove: () => void } {
  if (!_mod?.addScreenshotListener) return { remove: () => {} };
  try {
    return _mod.addScreenshotListener(callback);
  } catch (_) {}
  return { remove: () => {} };
}

export function isAvailable(): boolean {
  return !!_mod;
}
