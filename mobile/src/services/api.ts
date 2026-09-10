import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// In local development, change this to your computer's IP address (e.g. 'http://192.168.1.X:3004')
// when testing on a physical phone via Expo Go.
export const API_BASE_URL = 'https://mycircle.mistyvisuals.com';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Automatically inject authorization header if token exists
// ONLY injects the family token when NO Authorization header is already set.
// This lets callers pass a per-event guest token without it being overwritten.
api.interceptors.request.use(
  (config) => {
    if (!config.headers.Authorization) {
      const token = useAuthStore.getState().token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle API responses — auto-refresh token if present, and auto-logout on 401 when session expires
api.interceptors.response.use(
  (response) => {
    // Only persist refreshed tokens from family endpoints (e.g. /api/gallery/family/events or /auth)
    // NEVER overwrite the global family token with event-specific guest tokens (e.g. /auth-from-family)
    const url: string = response.config?.url || '';
    const isFamilyEndpoint = url.includes('/api/gallery/family');
    if (isFamilyEndpoint && response.data?.token && typeof response.data.token === 'string') {
      useAuthStore.getState().updateToken(response.data.token).catch(() => {});
    }
    return response;
  },
  async (error) => {
    if (error.response && error.response.status === 401) {
      const url: string = error.config?.url || '';
      // Only skip logout for operations where 401 is an input error, NOT a session expiration
      // (e.g. invalid bulk download PIN).
      const isInputPinError = url.includes('/download');
      if (!isInputPinError) {
        console.warn('[API 401] Session token expired or invalid for URL:', url, '-> Auto-logging out to Login screen.');
        await useAuthStore.getState().logout();
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// A bare axios instance with NO auth interceptors.
// Use this when you already have a per-event guest token and need
// to call verifyGuestAuth-protected endpoints without header overwriting.
export const guestApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

