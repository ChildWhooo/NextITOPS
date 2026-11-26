import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, clearSession, getToken, setToken } from '@/lib/api';
import type { User } from '@/lib/types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, privacyConsent?: boolean) => Promise<any>;
  logout: () => void;
  refresh: () => Promise<void>;
  can: (permission?: string | string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => {
    throw new Error('AuthProvider missing');
  },
  logout: () => {},
  refresh: async () => {},
  can: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadMe = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const response = await api.get<{ user: User }>('/api/auth/me');
      setUser(response.user);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      const lastUserId = localStorage.getItem('nextitops_last_user_id');
      navigate(lastUserId ? `/login?themeUser=${lastUserId}` : '/login', { replace: true });
    };
    window.addEventListener('nextitops:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('nextitops:unauthorized', handleUnauthorized);
  }, [navigate]);

  const login = useCallback(async (username: string, password: string, privacyConsent = false) => {
    const response = await api.post<{ token?: string; user?: User; requiresConsent?: boolean; privacy?: any; account?: any }>(
      '/api/auth/login',
      { username, password, privacyConsent },
    );
    if (response.requiresConsent) return response;
    setToken(response.token!);
    setUser(response.user!);
    if (response.user?.id) localStorage.setItem('nextitops_last_user_id', String(response.user.id));
    return response;
  }, []);

  const logout = useCallback(() => {
    const themeUser = user?.id;
    setToken(null);
    clearSession();
    setUser(null);
    navigate(themeUser ? `/login?themeUser=${themeUser}` : '/login', { replace: true });
  }, [navigate, user]);

  const can = useCallback(
    (permission?: string | string[]) => {
      if (!permission) return true;
      if (!user) return false;
      if (user.role?.code === 'admin') return true;
      const permissions = user.permissions || user.role?.permissions || [];
      const required = Array.isArray(permission) ? permission : [permission];
      return required.some((item) => permissions.includes(item));
    },
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh: loadMe, can }),
    [user, loading, login, logout, loadMe, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
