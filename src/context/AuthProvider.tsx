import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../store';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  signOut: () => Promise<void>;
  signInWithOtp: (email: string) => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  signOut: async () => {},
  signInWithOtp: async () => ({ error: null })
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { setLocked } = useAppStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLocked(!session);
      if (session?.access_token) {
        localStorage.setItem('supabase-auth-token', session.access_token);
      } else {
        localStorage.removeItem('supabase-auth-token');
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLocked(!session);
      if (session?.access_token) {
        localStorage.setItem('supabase-auth-token', session.access_token);
      } else {
        localStorage.removeItem('supabase-auth-token');
      }
    });

    return () => subscription.unsubscribe();
  }, [setLocked]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const signInWithOtp = async (email: string) => {
    return supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin
      }
    });
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-ink-900 z-[100] flex items-center justify-center">
        <div className="text-white">Authenticating...</div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ session, user, signOut, signInWithOtp }}>
      {children}
    </AuthContext.Provider>
  );
}
