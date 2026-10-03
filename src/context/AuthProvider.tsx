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
  requestPasswordReset: (email: string) => Promise<{ error: any }>;
  updatePassword: (password: string) => Promise<{ error: any }>;
  /** Signed in from a password-reset link: a new password is set before anything else. */
  isRecoveringPassword: boolean;
  justConfirmedEmail: boolean;
  dismissEmailConfirmed: () => void;
}

export const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  signOut: async () => {},
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null, needsEmailConfirmation: false }),
  resendConfirmation: async () => ({ error: null }),
  requestPasswordReset: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
  isRecoveringPassword: false,
  justConfirmedEmail: false,
  dismissEmailConfirmed: () => {}
});

export const useAuth = () => useContext(AuthContext);

// Read once, at module load, before Supabase's own client has a chance to
// process and strip this hash: the one moment it is safe to tell a
// confirmation-link visit apart from an ordinary sign-in.
let cameFromEmailConfirmation =
  typeof window !== 'undefined' && new URLSearchParams(window.location.hash.slice(1)).get('type') === 'signup';
let cameFromPasswordRecovery =
  typeof window !== 'undefined' && new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [justConfirmedEmail, setJustConfirmedEmail] = useState(false);
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);
  const { setLocked } = useAppStore();

  const noteSession = (session: Session | null) => {
    setSession(session);
    setUser(session?.user ?? null);
    setLocked(!session);
    // Removes the copy of the access token earlier versions kept.
    try { localStorage.removeItem('supabase-auth-token'); } catch { /* storage unavailable */ }
    // A confirmation link's tokens arrive in the URL hash, which Supabase
    // reads once on load. They are only useful for that one read: leaving
    // them visible afterwards is a bare access token sitting in the address
    // bar for no reason, so this is the point to both acknowledge the
    // confirmation and remove them.
    if (session && cameFromEmailConfirmation) {
      cameFromEmailConfirmation = false;
      setJustConfirmedEmail(true);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    // A password-reset link signs the person in only so they can choose a
    // new password; nothing else opens until they do.
    if (session && cameFromPasswordRecovery) {
      cameFromPasswordRecovery = false;
      setIsRecoveringPassword(true);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      noteSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecoveringPassword(true);
      noteSession(session);
    });

    return () => subscription.unsubscribe();
  }, [setLocked]);

  const signOut = async () => {
    await supabase.auth.signOut();
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

  // Always answers the same way, so the form cannot be used to learn which
  // addresses have accounts. The link lands back on this origin, which must
  // be on the Supabase project's redirect allow-list.
  const requestPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    return { error };
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) setIsRecoveringPassword(false);
    return { error };
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-sidebar-bg z-[100] flex items-center justify-center">
        <div className="text-white">Authenticating...</div>
      </div>
    );
  }

  const dismissEmailConfirmed = () => setJustConfirmedEmail(false);

  return (
    <AuthContext.Provider value={{ session, user, signOut, signIn, signUp, resendConfirmation, requestPasswordReset, updatePassword, isRecoveringPassword, justConfirmedEmail, dismissEmailConfirmed }}>
      {children}
    </AuthContext.Provider>
  );
}
