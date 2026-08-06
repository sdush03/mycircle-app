/**
 * Safe wrapper around expo-screen-capture.
 * Gracefully falls back to no-ops when the native module
 * is not linked (e.g. first build after install, Expo Go).
 */

let _module: any = null;
try {
  // Dynamic require so Metro bundler includes it but we catch any
  // native module initialisation errors at runtime
  _module = require('expo-screen-capture');
} catch (_) {}

export async function preventScreenCaptureAsync(key: string = 'default'): Promise<void> {
  try {
    if (_module?.preventScreenCaptureAsync) {
      await _module.preventScreenCaptureAsync(key);
    }
  } catch (_) {}
}

export async function allowScreenCaptureAsync(key: string = 'default'): Promise<void> {
  try {
    if (_module?.allowScreenCaptureAsync) {
      await _module.allowScreenCaptureAsync(key);
    }
  } catch (_) {}
}

export function addScreenshotListener(callback: () => void): { remove: () => void } {
  try {
    if (_module?.addScreenshotListener) {
      return _module.addScreenshotListener(callback);
    }
  } catch (_) {}
  return { remove: () => {} };
}

export function isAvailable(): boolean {
  return !!_module?.preventScreenCaptureAsync;
}
