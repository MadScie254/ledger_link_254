import React, { useState } from 'react';
import { Mail, Lock, CheckCircle2, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthProvider';

type Mode = 'signIn' | 'signUp';

const productAreas = [
  ['01', 'General ledger', 'Posted entries, account balances, and a complete audit history.'],
  ['02', 'Operations', 'Invoices, bills, banking, payroll, inventory, and projects.'],
  ['03', 'Reporting', 'Financial statements with export-ready schedules.'],
];

export function LockScreen({ initialMode = 'signIn' }: { initialMode?: Mode } = {}) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
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
      const { error: signInError } = await signIn(email, password);
      if (signInError) setError(signInError.message);
    } else {
      const { error: signUpError, needsEmailConfirmation } = await signUp(email, password);
      if (signUpError) {
        setError(signUpError.message);
      } else if (needsEmailConfirmation) {
        setConfirmationSent(true);
      }
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-paper-100">
      <div className="grid min-h-full md:grid-cols-[minmax(360px,46%)_1fr]">
        <aside className="hidden min-h-screen bg-sidebar-bg px-10 py-9 text-white md:flex md:flex-col md:justify-between lg:px-14 lg:py-11">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brass-500 font-serif text-xs font-bold text-ink-900">LL</div>
              <div>
                <p className="font-serif text-lg font-semibold leading-none">LedgerLink</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-sidebar-muted">Business accounting</p>
              </div>
            </div>

            <div className="mt-24 max-w-md">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-brass-500">One financial record</p>
              <h1 className="mt-4 font-serif text-[2.65rem] font-medium leading-[1.08] tracking-[-0.035em]">Your books and operations, connected.</h1>
              <p className="mt-5 max-w-sm text-sm leading-6 text-sidebar-muted">LedgerLink keeps day-to-day financial work tied to the ledger it affects.</p>
            </div>
          </div>

          <div className="max-w-lg border-t border-white/15">
            {productAreas.map(([number, title, description]) => (
              <div key={number} className="grid grid-cols-[2rem_1fr] gap-3 border-b border-white/10 py-4">
                <span className="pt-0.5 font-mono text-[10px] text-brass-500">{number}</span>
                <div>
                  <p className="text-xs font-semibold text-white">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-sidebar-muted">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full max-w-[24rem]">
            <div className="mb-12 flex items-center gap-2.5 md:hidden">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brass-500 font-serif text-[10px] font-bold text-ink-900">LL</div>
              <div>
                <p className="font-serif text-base font-semibold leading-none text-ink-900">LedgerLink</p>
                <p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-slate-500">Business accounting</p>
              </div>
            </div>

            {confirmationSent ? (
              <div>
                <CheckCircle2 className="mb-6 h-8 w-8 text-ledger-green-700" />
                <p className="page-kicker">Account created</p>
                <h2 className="mt-2 text-3xl tracking-[-0.03em] font-serif font-semibold text-ink-900">Confirm your email</h2>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  We sent a confirmation link to <strong className="text-ink-900">{email}</strong>. Open it to activate your account.
                </p>
                <button
                  onClick={() => {
                    setConfirmationSent(false);
                    switchMode('signIn');
                  }}
                  className="mt-7 w-full rounded-lg bg-focus-blue-500 py-3 text-sm font-semibold text-white transition-colors hover:brightness-95"
                >
                  Return to sign in
                </button>
              </div>
            ) : (
              <>
                <p className="page-kicker">{mode === 'signIn' ? 'Sign in' : 'Create an account'}</p>
                <h2 className="mt-2 text-3xl tracking-[-0.03em] font-serif font-semibold text-ink-900">
                  {mode === 'signIn' ? 'Access your books' : 'Set up your workspace'}
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {mode === 'signIn' ? 'Enter the details associated with your account.' : 'Use your work email to begin.'}
                </p>

                {error && (
                  <div role="alert" className="mt-6 border-l-2 border-rust-700 bg-rust-700/5 px-3 py-2.5 text-sm text-rust-700">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                  <label className="block text-left">
                    <span className="mb-2 block text-xs font-semibold text-ink-900">Work email</span>
                    <span className="relative block">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="name@company.com"
                        className="w-full rounded-lg border border-ink-900/15 bg-paper-100 py-3 pl-10 pr-3 text-sm text-ink-900 outline-none"
                      />
                    </span>
                  </label>

                  <label className="block text-left">
                    <span className="mb-2 block text-xs font-semibold text-ink-900">Password</span>
                    <span className="relative block">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="password"
                        required
                        minLength={8}
                        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Enter your password"
                        className="w-full rounded-lg border border-ink-900/15 bg-paper-100 py-3 pl-10 pr-3 text-sm text-ink-900 outline-none"
                      />
                    </span>
                  </label>

                  {mode === 'signUp' && (
                    <label className="block text-left">
                      <span className="mb-2 block text-xs font-semibold text-ink-900">Confirm password</span>
                      <span className="relative block">
                        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          type="password"
                          required
                          minLength={8}
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          placeholder="Re-enter your password"
                          className="w-full rounded-lg border border-ink-900/15 bg-paper-100 py-3 pl-10 pr-3 text-sm text-ink-900 outline-none"
                        />
                      </span>
                    </label>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-focus-blue-500 py-3 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-wait disabled:opacity-50"
                  >
                    {loading
                      ? (mode === 'signIn' ? 'Signing in…' : 'Creating account…')
                      : (mode === 'signIn' ? 'Sign in' : 'Create account')}
                  </button>
                </form>

                <div className="mt-8 border-t border-ink-900/10 pt-5 text-sm text-slate-500">
                  {mode === 'signIn' ? (
                    <>
                      New to LedgerLink?{' '}
                      <button onClick={() => switchMode('signUp')} className="font-semibold text-focus-blue-500 hover:underline">
                        Create an account
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{' '}
                      <button onClick={() => switchMode('signIn')} className="font-semibold text-focus-blue-500 hover:underline">
                        Sign in
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
