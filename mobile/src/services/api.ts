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

// Handle API error responses — auto-logout only on auth endpoint 401s,
// not on every 401 across the app (e.g. public/family data fetches).
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response && error.response.status === 401) {
      const url: string = error.config?.url || '';
      const isAuthEndpoint =
        url.includes('/api/gallery/family/auth') ||
        (url.includes('/api/gallery/public/events') && url.includes('/auth') && !url.includes('/auth-from-family'));
      if (isAuthEndpoint) {
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

