import axios, { AxiosError, type AxiosInstance } from 'axios';
import { Capacitor } from '@capacitor/core';
import { offlineAdapter } from './offline/adapter';

const ACCESS_KEY = 'atg.access';
const REFRESH_KEY = 'atg.refresh';
export const SESSION_EXPIRED_EVENT = 'atg:session-expired';

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const nativePlatform = Capacitor.isNativePlatform();
const parsedApiUrl = configuredApiUrl ? new URL(configuredApiUrl) : null;

if (nativePlatform && parsedApiUrl && parsedApiUrl.protocol !== 'https:') {
  throw new Error('Native builds require VITE_API_URL to use HTTPS.');
}

export const API_CONFIGURED = !nativePlatform || parsedApiUrl !== null;
export const API_ORIGIN = parsedApiUrl?.origin ?? window.location.origin;
const API_BASE_URL = parsedApiUrl ? `${parsedApiUrl.origin}/api` : '/api';

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
});

// ---------------------------------------------------------------------------
// Explicit offline/demo mode: the on-device database (src/lib/offline) serves
// API calls only when selected with `?offline=1` or the stored mode setting.
// Native apps otherwise use the configured shared server just like the web app.
// ---------------------------------------------------------------------------

const OFFLINE_KEY = 'atg.mode';

function applyModeParam(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('offline') || params.has('server')) {
      if (params.has('offline')) localStorage.setItem(OFFLINE_KEY, 'offline');
      else localStorage.removeItem(OFFLINE_KEY);
      params.delete('offline');
      params.delete('server');
      const qs = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    }
    return localStorage.getItem(OFFLINE_KEY) === 'offline';
  } catch {
    return false;
  }
}

export const OFFLINE_MODE = applyModeParam();

export function enableOfflineMode(): void {
  localStorage.setItem(OFFLINE_KEY, 'offline');
  window.location.reload();
}

export function disableOfflineMode(): void {
  localStorage.removeItem(OFFLINE_KEY);
  window.location.reload();
}

// In explicit offline mode, the local adapter also handles refresh requests.
if (OFFLINE_MODE) {
  api.defaults.adapter = offlineAdapter;
  axios.defaults.adapter = offlineAdapter;
}

api.interceptors.request.use((config) => {
  if (!API_CONFIGURED && !OFFLINE_MODE) {
    throw new Error('This mobile build is missing VITE_API_URL. Rebuild it with the shared API origin configured.');
  }
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function refreshAccess(): Promise<string | null> {
  const refresh = tokenStore.refresh;
  if (!refresh) return null;
  try {
    const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken: refresh });
    tokenStore.set(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch (error) {
    if (axios.isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0)) {
      tokenStore.clear();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      return null;
    }
    throw error;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    if (error.response?.status === 401 && original && !original._retry && tokenStore.refresh) {
      original._retry = true;
      refreshing ??= refreshAccess();
      const pending = refreshing;
      let token: string | null;
      try {
        token = await pending;
      } finally {
        if (refreshing === pending) refreshing = null;
      }
      if (token) {
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

export function apiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string; issues?: { message: string }[] } | undefined;
    if (data?.issues?.length) return data.issues.map((i) => i.message).join(', ');
    if (data?.error) return data.error;
    if (!error.response) return 'Network error — is the API running?';
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}

export function isUnauthorized(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401;
}
