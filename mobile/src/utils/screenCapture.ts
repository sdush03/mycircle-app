/**
 * Safe wrapper around expo-screen-capture.
 * Falls back to no-ops when native module is not linked.
 * Do NOT use a static import — native module must be loaded via try-require
 * so that missing native bindings don't crash the app on startup.
 */

let _mod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rawMod = require('expo-screen-capture');
  _mod = rawMod?.preventScreenCaptureAsync
    ? rawMod
    : (rawMod?.default?.preventScreenCaptureAsync ? rawMod.default : null);
  if (_mod?.preventScreenCaptureAsync) {
    console.log('[MYCIRCLE SCREEN CAPTURE 🛡️] expo-screen-capture loaded successfully');
  } else {
    console.warn('[MYCIRCLE SCREEN CAPTURE ⚠️] expo-screen-capture loaded but preventScreenCaptureAsync missing');
    _mod = null;
  }
} catch (e: any) {
  console.warn('[MYCIRCLE SCREEN CAPTURE ⚠️] expo-screen-capture unavailable — rebuild required:', e?.message);
}

export async function preventScreenCaptureAsync(key: string = 'default'): Promise<void> {
  // In development mode, screen mirroring or QuickTime to Mac is commonly used for testing.
  // Enabling native screen capture prevention can blank out the screen to black.
  if (__DEV__) {
    console.log(`[MYCIRCLE SCREEN CAPTURE 🛡️ DEV] Bypassed preventScreenCaptureAsync('${key}') in development mode to prevent black screen`);
    return;
  }
  if (!_mod?.preventScreenCaptureAsync) {
    console.warn(`[MYCIRCLE SCREEN CAPTURE ⚠️] preventScreenCaptureAsync skipped — module not available`);
    return;
  }
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
    console.log(`[MYCIRCLE SCREEN CAPTURE 🔓] ALLOWED — key: ${key}`);
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
