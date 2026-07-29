/**
 * Minimal event emitter used to let the floating tab bar trigger
 * actions (open moodboards, open inspirations) inside index.tsx
 * without prop-drilling or adding to the auth store.
 */
type Listener = () => void;

const listeners: Record<string, Listener[]> = {};

export const tabEvents = {
  on(event: string, fn: Listener) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    return () => tabEvents.off(event, fn);
  },
  off(event: string, fn: Listener) {
    listeners[event] = (listeners[event] || []).filter((l) => l !== fn);
  },
  emit(event: string) {
    (listeners[event] || []).forEach((fn) => fn());
  },
};

export const TAB_OPEN_MOODBOARDS   = 'tab:openMoodboards';
export const TAB_OPEN_INSPIRATIONS = 'tab:openInspirations';
export const TAB_OPEN_PROFILE_SETTINGS = 'tab:openProfileSettings';
export const EVENT_SAVES_UPDATED = 'saves:updated';

