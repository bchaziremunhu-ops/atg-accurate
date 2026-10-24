import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { api, clearTokens, isUnauthorized, restoreTokens, saveTokens, setSessionExpiredHandler } from './api';
import { disablePushNotifications } from './push';
import type { RegisterInput, User } from './types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<string | null>;
  refreshUser: () => Promise<void>;
  updateUser: (updates: Partial<User> & Pick<User, 'id'>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const refreshUser = useCallback(async () => {
    const response = await api.get<User>('/auth/me');
    setUser(response.data);
  }, []);
  const updateUser = useCallback((updates: Partial<User> & Pick<User, 'id'>) => {
    setUser((current) => (current?.id === updates.id ? { ...current, ...updates } : current));
  }, []);

  useEffect(() => {
    let active = true;
    setSessionExpiredHandler(() => {
      if (active) {
        setUser(null);
        queryClient.clear();
      }
    });

    async function restoreSession() {
      try {
        await restoreTokens();
        if (!await hasStoredSession()) return;
        const response = await api.get<User>('/auth/me');
        if (active) setUser(response.data);
      } catch (error) {
        if (isUnauthorized(error)) await clearTokens();
        else console.error('Session restoration failed:', error);
      } finally {
        if (active) setLoading(false);
      }
    }

    void restoreSession();
    return () => {
      active = false;
      setSessionExpiredHandler(null);
    };
  }, [queryClient]);

  const login = useCallback(async (identifier: string, password: string) => {
    const response = await api.post<{
      user: User;
      accessToken: string;
      refreshToken: string;
    }>('/auth/login', { identifier, password });
    await saveTokens(response.data.accessToken, response.data.refreshToken);
    setUser(response.data.user);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const response = await api.post<{
      user: User;
      accessToken: string;
      refreshToken: string;
    }>('/auth/register', input);
    await saveTokens(response.data.accessToken, response.data.refreshToken);
    setUser(response.data.user);
  }, []);

  const logout = useCallback(async () => {
    let errorMessage: string | null = null;
    try {
      await disablePushNotifications();
    } catch (error) {
      errorMessage = 'Push notifications could not be disconnected from this account.';
      console.error('Push token unregister failed during logout:', error);
    }
    try {
      await api.post('/auth/logout');
    } catch (error) {
      errorMessage = [errorMessage, 'Could not revoke the session on the server. You have been signed out on this device.'].filter(Boolean).join(' ');
      console.error('Server logout failed:', error);
    } finally {
      await clearTokens();
      setUser(null);
      queryClient.clear();
    }
    return errorMessage;
  }, [queryClient]);

  const value = useMemo(() => ({ user, loading, login, register, logout, refreshUser, updateUser }), [user, loading, login, register, logout, refreshUser, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function hasStoredSession(): Promise<boolean> {
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync('atg.access'),
    SecureStore.getItemAsync('atg.refresh'),
  ]);
  return Boolean(access || refresh);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
