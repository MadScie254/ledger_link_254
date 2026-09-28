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
  resendConfirmation: (email: string) => Promise<{ error: any }>;
}

export const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  signOut: async () => {},
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null, needsEmailConfirmation: false }),
  resendConfirmation: async () => ({ error: null })
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
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // The confirmation email always lands back on whichever origin the
      // person signed up from: localhost while testing, the deployed site
      // once published. No manual switch to maintain between the two.
      // Supabase only honours this if that origin is also on the project's
      // Auth > URL Configuration > Redirect URLs allow-list; otherwise it
      // silently falls back to the configured Site URL.
      options: { emailRedirectTo: window.location.origin },
    });
    // If email confirmation is required by the Supabase project's auth
    // settings, signUp succeeds but returns no session until the user
    // clicks the confirmation link.
    const needsEmailConfirmation = !error && !data.session;
    return { error, needsEmailConfirmation };
  };

  // Supabase's own built-in email sender is rate-limited to a handful of
  // messages an hour and is documented as best-effort, not for production
  // use — a resend can fail quietly for that reason alone, with no error
  // returned here to explain it. A custom SMTP provider, set in the
  // Supabase project under Authentication > Settings, is the real fix.
  const resendConfirmation = async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error };
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-sidebar-bg z-[100] flex items-center justify-center">
        <div className="text-white">Authenticating...</div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ session, user, signOut, signIn, signUp, resendConfirmation }}>
      {children}
    </AuthContext.Provider>
  );
}
