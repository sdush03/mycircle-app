import axios from 'axios';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/authStore';

// In local development, change this to your computer's IP address (e.g. 'http://192.168.1.X:3004')
// when testing on a physical phone via Expo Go.
export const API_BASE_URL = 'https://mycircle.mistyvisuals.com';

const appVersion = Constants.nativeAppVersion || Constants.expoConfig?.version || '1.2.3';

export type ApiErrorInfo = {
  url: string;
  method?: string;
  status?: number;
  message: string;
  durationMs?: number;
  isTimeout?: boolean;
  isNetworkError?: boolean;
};

type ApiErrorListener = (info: ApiErrorInfo) => void;
let apiErrorListener: ApiErrorListener | null = null;

export function setApiErrorListener(listener: ApiErrorListener | null) {
  apiErrorListener = listener;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 25000,
  headers: {
    'Content-Type': 'application/json',
    'X-App-Version': appVersion,
    'x-client-type': 'app',
    'x-device-type': 'mobile',
  },
});

// Automatically inject authorization header if token exists
// ONLY injects the family token when NO Authorization header is already set.
// This lets callers pass a per-event guest token without it being overwritten.
api.interceptors.request.use(
  (config) => {
    (config as any)._requestStartTime = Date.now();
    if (config.headers && typeof (config.headers as any).set === 'function') {
      (config.headers as any).set('X-App-Version', appVersion);
      (config.headers as any).set('x-app-version', appVersion);
    }
    config.headers['X-App-Version'] = appVersion;
    config.headers['x-app-version'] = appVersion;

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

function decodeJwtRole(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const decoded = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
    const parsed = JSON.parse(decoded);
    return parsed?.role || (parsed?.roles && parsed.roles[0]) || null;
  } catch {
    return null;
  }
}

// Handle API responses — auto-refresh token if present, and auto-logout on 401 when session expires
api.interceptors.response.use(
  (response) => {
    // Only persist refreshed tokens from family endpoints (e.g. /api/gallery/family/events or /auth)
    // NEVER overwrite the global family token with event-specific guest tokens (e.g. /auth-from-family)
    const url: string = response.config?.url || '';
    const isFamilyEndpoint = url.includes('/api/gallery/family');
    if (isFamilyEndpoint && response.data?.token && typeof response.data.token === 'string') {
      const currentToken = useAuthStore.getState().token;
      // Only update if an existing authenticated session is active and not in the middle of auth endpoint
      if (currentToken && !url.includes('/auth')) {
        useAuthStore.getState().updateToken(response.data.token).catch(() => {});
      }
    }

    // Fix 3: Silently rotate guest tokens — backend emits a fresh token in X-Refreshed-Token
    // whenever photos load successfully. Save it so the token never goes stale (365-day window resets).
    const refreshedToken = response.headers?.['x-refreshed-token'];
    if (refreshedToken && typeof refreshedToken === 'string') {
      const currentToken = useAuthStore.getState().token;
      // Guard: NEVER overwrite a global family session token with an event-scoped guest token.
      if (currentToken && currentToken !== refreshedToken) {
        const currentRole = decodeJwtRole(currentToken);
        if (currentRole !== 'family') {
          useAuthStore.getState().updateToken(refreshedToken).catch(() => {});
        }
      }
    }

    return response;
  },
  async (error) => {
    const url: string = error.config?.url || '';
    const method = error.config?.method?.toUpperCase() || 'GET';
    const status = error.response?.status;
    const startTime = (error.config as any)?._requestStartTime;
    const durationMs = startTime ? Date.now() - startTime : undefined;
    const isTimeout = error.code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout');
    const isNetworkError = !error.response;

    const errMsg = isTimeout
      ? `Request timed out (${durationMs || 25000}ms)`
      : isNetworkError
      ? 'Network offline or server unreachable'
      : (error.response?.data?.message || error.message || `HTTP ${status}`);

    if (isTimeout) {
      console.warn(`[API TIMEOUT ⏱️] ${method} ${url} timed out after ${durationMs}ms`);
    } else if (isNetworkError) {
      console.warn(`[API NETWORK 📡] Connection failed for ${method} ${url}:`, error.message);
    } else if (status && status >= 500) {
      console.warn(`[API 5xx ⚠️] Server error ${status} on ${method} ${url}:`, errMsg);
    }

    if (apiErrorListener) {
      try {
        apiErrorListener({
          url,
          method,
          status,
          message: errMsg,
          durationMs,
          isTimeout,
          isNetworkError,
        });
      } catch (_) {}
    }

    if (error.response && error.response.status === 401) {
      // Only skip logout for operations where 401 is an input error, NOT a session expiration
      // (e.g. invalid bulk download PIN or invalid login credentials).
      const isInputPinError = url.includes('/download');
      const isAuthUrl = url.includes('/auth') && !url.includes('/session-check');
      if (!isInputPinError && !isAuthUrl) {
        console.warn('[API 401] Session token expired or invalid for URL:', url, '-> Auto-logging out to Login screen.');
        await useAuthStore.getState().logout();
      }
    }
    return Promise.reject(error);
  }
);

// Deduplicate concurrent in-flight GET requests to prevent cold-boot request storms
const inFlightGetRequests = new Map<string, Promise<any>>();
const originalApiGet = api.get.bind(api);

(api as any).get = function (url: string, config?: any) {
  const token = config?.headers?.Authorization || useAuthStore.getState().token || '';
  const key = `${url}|${JSON.stringify(config?.params || {})}|${token}`;

  if (inFlightGetRequests.has(key)) {
    return inFlightGetRequests.get(key);
  }

  const promise = originalApiGet(url, config).finally(() => {
    inFlightGetRequests.delete(key);
  });

  inFlightGetRequests.set(key, promise);
  return promise;
};

export default api;

// A bare axios instance with NO auth interceptors.
// Use this when you already have a per-event guest token and need
// to call verifyGuestAuth-protected endpoints without header overwriting.
export const guestApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 25000,
  headers: {
    'Content-Type': 'application/json',
    'X-App-Version': appVersion,
    'x-app-version': appVersion,
    'x-client-type': 'app',
    'x-device-type': 'mobile',
  },
});
guestApi.interceptors.request.use((config) => {
  (config as any)._requestStartTime = Date.now();
  if (config.headers && typeof (config.headers as any).set === 'function') {
    (config.headers as any).set('X-App-Version', appVersion);
    (config.headers as any).set('x-app-version', appVersion);
  }
  config.headers['X-App-Version'] = appVersion;
  config.headers['x-app-version'] = appVersion;
  return config;
});
guestApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const url: string = error.config?.url || '';
    const method = error.config?.method?.toUpperCase() || 'GET';
    const status = error.response?.status;
    const startTime = (error.config as any)?._requestStartTime;
    const durationMs = startTime ? Date.now() - startTime : undefined;
    const isTimeout = error.code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout');
    const isNetworkError = !error.response;

    const errMsg = isTimeout
      ? `Guest request timed out (${durationMs || 25000}ms)`
      : isNetworkError
      ? 'Guest network offline or server unreachable'
      : (error.response?.data?.message || error.message || `HTTP ${status}`);

    if (apiErrorListener) {
      try {
        apiErrorListener({
          url,
          method,
          status,
          message: errMsg,
          durationMs,
          isTimeout,
          isNetworkError,
        });
      } catch (_) {}
    }

    if (error.response && error.response.status === 401) {
      const data = error.response.data;
      if (data?.code === 'SESSION_TERMINATED' || data?.code === 'SESSION_EXPIRED') {
        console.warn('[guestApi 401] Session terminated on server -> Auto-logging out to Login screen.');
        useAuthStore.getState().logout().catch(() => {});
      }
    }

    return Promise.reject(error);
  }
);

