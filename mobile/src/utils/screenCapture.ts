/**
 * Safe wrapper around expo-screen-capture.
 * Uses static import since native module is linked after `npx expo run:ios --device`.
 */

import * as ExpoScreenCapture from 'expo-screen-capture';

const _available = !!ExpoScreenCapture?.preventScreenCaptureAsync;
console.log(`[MYCIRCLE SCREEN CAPTURE 🛡️] Module loaded: ${_available}`);

export async function preventScreenCaptureAsync(key: string = 'default'): Promise<void> {
  console.log(`[MYCIRCLE SCREEN CAPTURE 🛡️] preventScreenCaptureAsync(${key}) called | available: ${_available}`);
  if (!_available) return;
  try {
    await ExpoScreenCapture.preventScreenCaptureAsync(key);
    console.log(`[MYCIRCLE SCREEN CAPTURE ✅] Screen capture PREVENTED for key: ${key}`);
  } catch (err: any) {
    console.error(`[MYCIRCLE SCREEN CAPTURE ❌] Failed to prevent: ${err?.message}`, err);
  }
}

export async function allowScreenCaptureAsync(key: string = 'default'): Promise<void> {
  if (!_available) return;
  try {
    await ExpoScreenCapture.allowScreenCaptureAsync(key);
    console.log(`[MYCIRCLE SCREEN CAPTURE ✅] Screen capture ALLOWED for key: ${key}`);
  } catch (err: any) {
    console.error(`[MYCIRCLE SCREEN CAPTURE ❌] Failed to allow: ${err?.message}`, err);
  }
}

export function addScreenshotListener(callback: () => void): { remove: () => void } {
  if (!_available || typeof ExpoScreenCapture.addScreenshotListener !== 'function') {
    return { remove: () => {} };
  }
  try {
    return ExpoScreenCapture.addScreenshotListener(callback);
  } catch (_) {
    return { remove: () => {} };
  }
}

export function isAvailable(): boolean {
  return _available;
}
