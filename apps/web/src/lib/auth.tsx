import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me, MemberProfile } from '@commonhours/shared';
import { api, getToken, setToken } from './api';

interface AuthState {
  me: Me | undefined;
  loading: boolean;
  signedIn: boolean;
  signIn: (token: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [hasToken, setHasToken] = useState(!!getToken());
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), enabled: hasToken, retry: false });

  useEffect(() => {
    if (me.error && (me.error as { status?: number }).status === 401) {
      setToken(null);
      setHasToken(false);
    }
  }, [me.error]);

  const value: AuthState = {
    me: me.data,
    loading: hasToken && me.isLoading,
    signedIn: hasToken && !!me.data,
    signIn: (t) => {
      setToken(t);
      setHasToken(true);
      // Reset (not just clear) so active queries — including "me" — refetch as the new member.
      void qc.resetQueries();
    },
    signOut: () => {
      setToken(null);
      setHasToken(false);
      qc.clear();
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function useMe(): MemberProfile {
  const { me } = useAuth();
  if (!me) throw new Error('Not signed in');
  return me.member;
}
