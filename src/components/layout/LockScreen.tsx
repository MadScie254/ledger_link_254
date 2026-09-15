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
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-sidebar-bg p-4 sm:p-7">
      <div className="absolute -left-28 top-0 h-80 w-80 rounded-full bg-focus-blue-500/20 blur-3xl" aria-hidden="true" />
      <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-brass-500/15 blur-3xl" aria-hidden="true" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[1.5rem] border border-white/[0.10] bg-paper-100 shadow-[0_28px_90px_rgba(1,8,25,0.40)] md:grid-cols-[1.06fr_0.94fr]">
        <aside className="relative hidden min-h-[590px] overflow-hidden bg-[#111E37] p-9 text-white md:flex md:flex-col md:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_12%,rgba(95,124,255,0.30),transparent_30%),radial-gradient(circle_at_12%_85%,rgba(244,181,74,0.18),transparent_28%)]" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brass-500 font-serif text-xs font-bold text-ink-900">LL</div>
              <div>
                <p className="font-serif text-lg font-semibold leading-none">LedgerLink</p>
                <p className="mt-1 text-[9px] font-mono uppercase tracking-[0.15em] text-sidebar-muted">Financial OS</p>
              </div>
            </div>
            <div className="mt-20 max-w-sm">
              <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.16em] text-brass-500">Clearer financial decisions</p>
              <h1 className="mt-4 font-serif text-4xl font-semibold leading-[1.04] tracking-[-0.035em]">A calm home for every business number.</h1>
              <p className="mt-5 text-sm leading-relaxed text-slate-300">Bring cash, receivables, spend, and the books together in one focused workspace.</p>
            </div>
          </div>
          <div className="relative rounded-2xl border border-white/[0.10] bg-white/[0.06] p-4 backdrop-blur-sm">
            <p className="text-xs font-semibold text-white">Built for accountable work</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">A secure workspace designed around traceable financial operations.</p>
          </div>
        </aside>
        <div className="relative flex min-h-[590px] items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-sm text-center">
        {confirmationSent ? (
          <>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-ledger-green-700/10 text-ledger-green-700 mb-6">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-3xl tracking-[-0.03em] font-serif text-ink-900 mb-2">Confirm your email</h2>
            <p className="text-slate-500 mb-6 text-sm">
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account, then sign in below.
            </p>
            <button
              onClick={() => {
                setConfirmationSent(false);
                switchMode('signIn');
              }}
              className="w-full bg-focus-blue-500 text-white py-3 rounded-xl text-sm font-semibold hover:brightness-95 transition-colors"
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-focus-blue-500/10 text-focus-blue-500 mb-6">
              {mode === 'signIn' ? <LogIn className="w-8 h-8" /> : <UserPlus className="w-8 h-8" />}
            </div>
            <div className="md:hidden mb-6">
              <p className="font-serif text-lg font-semibold text-ink-900">LedgerLink</p>
              <p className="mt-1 text-[9px] font-mono uppercase tracking-[0.14em] text-slate-500">Financial OS</p>
            </div>
            <h2 className="text-3xl tracking-[-0.03em] font-serif text-ink-900 mb-2">Welcome back</h2>
            <p className="text-slate-500 mb-7 text-sm">
              {mode === 'signIn' ? 'Sign in with your email and password.' : 'Create an account to get started.'}
            </p>

            {error && (
              <div className="mb-4 text-sm text-rust-700 bg-rust-700/10 py-2.5 px-3 rounded-xl text-left">
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
                  className="w-full pl-10 pr-3 py-3 bg-paper-50 border border-ink-900/10 text-ink-900 text-sm rounded-xl focus:ring-2 focus:ring-focus-blue-500 outline-none"
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
                  className="w-full pl-10 pr-3 py-3 bg-paper-50 border border-ink-900/10 text-ink-900 text-sm rounded-xl focus:ring-2 focus:ring-focus-blue-500 outline-none"
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
                    className="w-full pl-10 pr-3 py-3 bg-paper-50 border border-ink-900/10 text-ink-900 text-sm rounded-xl focus:ring-2 focus:ring-focus-blue-500 outline-none"
                  />
                </div>
              )}

              {mode === 'signIn' && <div className="mb-4" />}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-focus-blue-500 text-white py-3 rounded-xl text-sm font-semibold hover:brightness-95 transition-colors disabled:opacity-50 disabled:cursor-wait"
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
      </div>
    </div>
  );
}
