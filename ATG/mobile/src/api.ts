import axios, { create, isAxiosError, type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
let apiBaseUrl: string | undefined;
export let apiConfigurationError: string | null = null;

if (!configuredApiUrl) {
  apiConfigurationError = 'Set EXPO_PUBLIC_API_URL to the HTTPS address of the ATG API.';
} else {
  try {
    const url = new URL(configuredApiUrl);
    if (url.protocol !== 'https:') {
      apiConfigurationError = 'The mobile app requires EXPO_PUBLIC_API_URL to use HTTPS.';
    } else {
      apiBaseUrl = `${url.origin}/api`;
    }
  } catch {
    apiConfigurationError = 'EXPO_PUBLIC_API_URL must be a valid HTTPS URL.';
  }
}

const ACCESS_KEY = 'atg.access';
const REFRESH_KEY = 'atg.refresh';
let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export const api = create({ baseURL: apiBaseUrl });

export async function restoreTokens(): Promise<void> {
  [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, access),
    SecureStore.setItemAsync(REFRESH_KEY, refresh),
  ]);
  accessToken = access;
  refreshToken = refresh;
  void import('./realtime').then(({ reconnectSocket }) => reconnectSocket()).catch(console.error);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
  accessToken = null;
  refreshToken = null;
  void import('./realtime').then(({ disconnectSocket }) => disconnectSocket()).catch(console.error);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getApiOrigin(): string | null {
  if (!apiBaseUrl) return null;
  return new URL(apiBaseUrl).origin;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshToken || !apiBaseUrl) return null;
  try {
    const response = await axios.post(`${apiBaseUrl}/auth/refresh`, {
      refreshToken,
    });
    await saveTokens(response.data.accessToken, response.data.refreshToken);
    return response.data.accessToken as string;
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    if (status === 401 || status === 403) {
      await clearTokens();
      onSessionExpired?.();
    }
    throw error;
  }
}

api.interceptors.request.use((config) => {
  if (apiConfigurationError) throw new Error(apiConfigurationError);
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (error.response?.status !== 401 || !original || original._retry || !refreshToken) {
      return Promise.reject(error);
    }

    original._retry = true;
    refreshInFlight ??= refreshAccessToken();
    const pendingRefresh = refreshInFlight;
    let token: string | null;
    try {
      token = await pendingRefresh;
    } catch (refreshError) {
      return Promise.reject(refreshError);
    } finally {
      if (refreshInFlight === pendingRefresh) refreshInFlight = null;
    }

    if (!token) {
      await clearTokens();
      onSessionExpired?.();
      return Promise.reject(error);
    }

    original.headers.Authorization = `Bearer ${token}`;
    return api(original);
  },
);

export function apiError(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as
      | { error?: string; issues?: { message: string }[] }
      | undefined;
    if (data?.issues?.length) return data.issues.map((issue) => issue.message).join(', ');
    if (data?.error) return data.error;
    if (!error.response) return 'Network error — check your connection and API address.';
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function isUnauthorized(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 401;
}
