// Who is logged in, and the server's public settings, for every page.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type PublicConfig, type User } from '@jobradar/shared';

type Session = {
  user: User | null;
  config: PublicConfig | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser((await api<{ user: User }>('/api/auth/me')).user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
    }
  }, []);

  useEffect(() => {
    Promise.all([api<PublicConfig>('/api/public/config').then(setConfig).catch(() => {}), refresh()]).finally(() => setLoading(false));
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { body: {} }).catch(() => {});
    setUser(null);
  }, []);

  return <SessionContext.Provider value={{ user, config, loading, setUser, refresh, logout }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
