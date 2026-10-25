import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile, Role } from './types';
import { isStaff } from './permissions';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: Role | null;
  institutionId: string | null;
  loading: boolean;
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadProfile = useCallback(async (user: User | null) => {
    if (!user) {
      if (mounted.current) setProfile(null);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (!mounted.current) return;
    if (error) {
      setProfileError(
        `Your profile could not be loaded (${error.message}). If this persists, ask an administrator to check your account.`,
      );
      setProfile(null);
      return;
    }
    if (!data) {
      setProfileError(
        'No profile is linked to this account yet. Ask a System Administrator to provision your access.',
      );
      setProfile(null);
      return;
    }
    setProfileError(null);
    setProfile(data as Profile);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      await loadProfile(data.session?.user ?? null);
      if (!cancelled) setLoading(false);
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      void (async () => {
        if (cancelled) return;
        setSession(nextSession);
        if (event === 'SIGNED_OUT') {
          setProfile(null);
          setLoading(false);
          return;
        }
        await loadProfile(nextSession?.user ?? null);
        setLoading(false);
      })();
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    await loadProfile(data.user ?? null);
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      role: profile?.role ?? null,
      institutionId: profile?.institution_id ?? null,
      loading,
      profileError,
      signIn,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, profileError, signIn, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Convenience hook for pages that must know whether the user is AICTE staff. */
export function useIsStaff(): boolean {
  const { role } = useAuth();
  return isStaff(role);
}
