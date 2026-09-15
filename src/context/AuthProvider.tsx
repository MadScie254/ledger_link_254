import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../store';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  signOut: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any; needsEmailConfirmation: boolean }>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  signOut: async () => {},
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null, needsEmailConfirmation: false })
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
    localStorage.removeItem('supabase-auth-token');
    setLocked(true);
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    // If email confirmation is required by the Supabase project's auth
    // settings, signUp succeeds but returns no session until the user
    // clicks the confirmation link.
    const needsEmailConfirmation = !error && !data.session;
    return { error, needsEmailConfirmation };
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-sidebar-bg z-[100] flex items-center justify-center">
        <div className="text-white">Authenticating...</div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ session, user, signOut, signIn, signUp }}>
      {children}
    </AuthContext.Provider>
  );
}
