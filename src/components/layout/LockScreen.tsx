import React, { useState } from 'react';
import { LogIn, Mail, Lock, CheckCircle2, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthProvider';

type Mode = 'signIn' | 'signUp';

export function LockScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmationSent, setConfirmationSent] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'signUp') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setLoading(true);
    if (mode === 'signIn') {
      const { error } = await signIn(email, password);
      if (error) setError(error.message);
    } else {
      const { error, needsEmailConfirmation } = await signUp(email, password);
      if (error) {
        setError(error.message);
      } else if (needsEmailConfirmation) {
        setConfirmationSent(true);
      }
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-sidebar-bg z-[100] flex items-center justify-center p-4">
      <div className="bg-paper-100 p-8 rounded-lg shadow-2xl w-full max-w-sm text-center">
        {confirmationSent ? (
          <>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 mb-6">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-serif text-ink-900 mb-2">Confirm your email</h2>
            <p className="text-slate-500 mb-6 text-sm">
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account, then sign in below.
            </p>
            <button
              onClick={() => {
                setConfirmationSent(false);
                switchMode('signIn');
              }}
              className="w-full bg-sidebar-bg text-sidebar-ink py-3 rounded-sm font-medium hover:bg-sidebar-bg/90 transition-colors"
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-focus-blue-500/10 text-focus-blue-500 mb-6">
              {mode === 'signIn' ? <LogIn className="w-8 h-8" /> : <UserPlus className="w-8 h-8" />}
            </div>
            <h2 className="text-2xl font-serif text-ink-900 mb-2">Welcome to LedgerLink</h2>
            <p className="text-slate-500 mb-6 text-sm">
              {mode === 'signIn' ? 'Sign in with your email and password.' : 'Create an account to get started.'}
            </p>

            {error && (
              <div className="mb-4 text-sm text-red-500 bg-red-500/10 py-2 px-3 rounded text-left">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="relative mb-3 text-left">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-10 pr-3 py-3 bg-paper-50 border border-ink-900/10 text-ink-900 text-sm rounded-sm focus:ring-2 focus:ring-focus-blue-500 outline-none"
                />
              </div>

              <div className="relative mb-3 text-left">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full pl-10 pr-3 py-3 bg-paper-50 border border-ink-900/10 text-ink-900 text-sm rounded-sm focus:ring-2 focus:ring-focus-blue-500 outline-none"
                />
              </div>

              {mode === 'signUp' && (
                <div className="relative mb-4 text-left">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="w-full pl-10 pr-3 py-3 bg-paper-50 border border-ink-900/10 text-ink-900 text-sm rounded-sm focus:ring-2 focus:ring-focus-blue-500 outline-none"
                  />
                </div>
              )}

              {mode === 'signIn' && <div className="mb-4" />}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-sidebar-bg text-sidebar-ink py-3 rounded-sm font-medium hover:bg-sidebar-bg/90 transition-colors disabled:opacity-50"
              >
                {loading
                  ? (mode === 'signIn' ? 'Signing in...' : 'Creating account...')
                  : (mode === 'signIn' ? 'Sign In' : 'Create Account')}
              </button>
            </form>

            <p className="mt-5 text-xs text-slate-500">
              {mode === 'signIn' ? (
                <>Don't have an account?{' '}
                  <button onClick={() => switchMode('signUp')} className="text-focus-blue-500 font-medium hover:underline">
                    Sign up
                  </button>
                </>
              ) : (
                <>Already have an account?{' '}
                  <button onClick={() => switchMode('signIn')} className="text-focus-blue-500 font-medium hover:underline">
                    Sign in
                  </button>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
