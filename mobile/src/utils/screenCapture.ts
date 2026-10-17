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

// Track all active caller keys demanding screen capture protection.
const activePreventedKeys = new Set<string>();
const GLOBAL_CAPTURE_TAG = 'mycircle_global_screen_capture_tag';
let isGloballyPrevented = false;

export async function preventScreenCaptureAsync(key: string = 'default'): Promise<void> {
  activePreventedKeys.add(key);

  if (!_mod?.preventScreenCaptureAsync) {
    return;
  }

  // If already natively prevented, do NOT re-invoke native swizzle/flags (prevents iOS layer corruption)
  if (isGloballyPrevented) {
    return;
  }

  try {
    isGloballyPrevented = true;
    await _mod.preventScreenCaptureAsync(GLOBAL_CAPTURE_TAG);
    console.log(`[MYCIRCLE SCREEN CAPTURE 🛡️ PREVENTED] key="${key}", totalActiveKeys=${activePreventedKeys.size}`);
  } catch (err: any) {
    isGloballyPrevented = false;
    console.error('[MYCIRCLE SCREEN CAPTURE ❌] prevent failed:', err?.message);
  }
}

export async function allowScreenCaptureAsync(key: string = 'default'): Promise<void> {
  activePreventedKeys.delete(key);

  // If other components or views still need protection, do not release native protection
  if (activePreventedKeys.size > 0) {
    return;
  }

  if (!isGloballyPrevented) {
    return;
  }

  if (!_mod?.allowScreenCaptureAsync) return;
  try {
    isGloballyPrevented = false;
    await _mod.allowScreenCaptureAsync(GLOBAL_CAPTURE_TAG);
    console.log(`[MYCIRCLE SCREEN CAPTURE 🔓 ALLOWED] key="${key}", all keys released`);
  } catch (err: any) {
    console.error('[MYCIRCLE SCREEN CAPTURE ❌] allow failed:', err?.message);
  }
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
