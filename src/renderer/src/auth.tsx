import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SessionInfo } from '../../shared/types';
import { api } from './api';

interface AuthContextValue {
  session: SessionInfo | null;
  booting: boolean;
  signingOut: boolean;
  login: (input: { username: string; password: string; serverUrl?: string }) => Promise<void>;
  signOut: (opts?: { localOnly?: boolean }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [booting, setBooting] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.auth
      .getSession()
      .then((restored) => {
        if (!cancelled) setSession(restored);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (input: { username: string; password: string; serverUrl?: string }) => {
      const next = await api.auth.login(input);
      setSession(next);
    },
    [],
  );

  const signOut = useCallback(
    async (opts?: { localOnly?: boolean }) => {
      setSigningOut(true);
      try {
        if (!opts?.localOnly) {
          await api.auth.logout();
        }
      } finally {
        setSession(null);
        setSigningOut(false);
      }
    },
    [],
  );

  const value = useMemo(
    () => ({ session, booting, signingOut, login, signOut }),
    [session, booting, signingOut, login, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
