import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiError, isUnauthorized, SESSION_EXPIRED_EVENT, tokenStore } from '../lib/api';
import { authApi } from '../lib/endpoints';
import type { RegisterInput, User } from '../lib/types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  authError: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  register: (data: RegisterInput) => Promise<User>;
  logout: () => Promise<{ serverRevoked: boolean; error?: string }>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const queryClient = useQueryClient();

  const refreshUser = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const request = (async () => {
      setLoading(true);
      try {
        if (!tokenStore.access) {
          setUser(null);
          setAuthError(false);
          return;
        }
        const me = await authApi.me();
        setUser(me);
        setAuthError(false);
      } catch (error) {
        if (!tokenStore.access || isUnauthorized(error)) {
          tokenStore.clear();
          setUser(null);
          setAuthError(false);
        } else {
          setAuthError(true);
          console.error(`Session verification failed: ${apiError(error)}`);
        }
      } finally {
        setLoading(false);
      }
    })();
    refreshInFlight.current = request;
    void request.finally(() => {
      if (refreshInFlight.current === request) refreshInFlight.current = null;
    });
    return request;
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    const handleSessionExpired = () => {
      setUser(null);
      setAuthError(false);
      queryClient.clear();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [queryClient]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const { user: u, accessToken, refreshToken } = await authApi.login({ identifier, password });
      tokenStore.set(accessToken, refreshToken);
      setUser(u);
      setAuthError(false);
      return u;
    },
    [],
  );

  const register = useCallback<AuthContextValue['register']>(async (data) => {
    const { user: u, accessToken, refreshToken } = await authApi.register(data);
    tokenStore.set(accessToken, refreshToken);
    setUser(u);
    setAuthError(false);
    return u;
  }, []);

  const logout = useCallback(async () => {
    const hasSession = Boolean(tokenStore.access || tokenStore.refresh);
    let serverRevoked = !hasSession;
    let errorMessage: string | undefined;

    try {
      if (hasSession) {
        await authApi.logout();
        serverRevoked = true;
      }
    } catch (error) {
      errorMessage = apiError(error);
      console.error(`Server logout failed: ${errorMessage}`);
    } finally {
      tokenStore.clear();
      setUser(null);
      setAuthError(false);
      queryClient.clear();
    }

    return errorMessage ? { serverRevoked, error: errorMessage } : { serverRevoked };
  }, [queryClient]);

  const value = useMemo(
    () => ({ user, loading, authError, login, register, logout, refreshUser }),
    [user, loading, authError, login, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
