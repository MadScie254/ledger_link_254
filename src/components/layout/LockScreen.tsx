import React, { useState } from 'react';
import { useAuth } from '../../context/AuthProvider';
import { Mark } from '../ledger/Mark';

type Mode = 'signIn' | 'signUp';

const CONTENTS = [
  ['General ledger', 'Posted entries, account balances and a complete audit history.'],
  ['Operations', 'Invoices, bills, banking, payroll, inventory and projects.'],
  ['Reporting', 'Financial statements with export-ready schedules.'],
];

const fieldClass =
  'mt-1.5 block w-full h-11 rounded-sm border border-field bg-paper-100 px-3 text-[15px] text-ink-900 placeholder:text-graphite-500 focus:border-oxblood focus:shadow-[0_0_0_1px_var(--oxblood)] focus:outline-none';

/** The cover of the book, and its first page. */
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

  const stampedLabel = (compact: boolean) => (
    <div className={`inline-block border border-[var(--spine-rule)] p-[3px] ${compact ? '' : 'w-full max-w-[20rem]'}`}>
      <div className={`border border-[var(--spine-rule)] ${compact ? 'px-3 py-2' : 'px-5 py-4'}`}>
        <p className={`ll-printed tracking-[0.16em] text-sidebar-ink leading-none ${compact ? 'text-[14px]' : 'text-[19px]'}`}>Ledger Link</p>
        {!compact && <p className="mt-2.5 text-[12.5px] text-sidebar-muted">Books of account for Kenyan business</p>}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-paper-50">
      <div className="grid min-h-full grid-cols-1 md:grid-cols-[minmax(22rem,44%)_minmax(0,1fr)]">
        {/* The cover */}
        <aside className="ll-cloth hidden md:flex min-h-screen flex-col justify-between px-10 py-10 lg:px-14 lg:py-12 text-sidebar-ink">
          {stampedLabel(false)}

          <div className="max-w-[26rem]">
            <h1 className="ll-heading text-[40px] lg:text-[46px] leading-[1.02] text-sidebar-ink">Every invoice, bill and payment, posted to one ledger.</h1>
            <p className="mt-5 text-[15px] leading-relaxed text-sidebar-muted">
              Day-to-day financial work stays tied to the ledger it affects.
            </p>
          </div>

          <div className="max-w-[26rem]">
            <p className="ll-printed text-[11px] text-sidebar-muted pb-2 border-b border-[var(--spine-rule)]">Contents</p>
            <ul>
              {CONTENTS.map(([title, description]) => (
                <li key={title} className="border-b border-[var(--spine-rule)] py-3">
                  <p className="text-[14px] font-semibold text-sidebar-ink">{title}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-sidebar-muted">{description}</p>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* The first page */}
        <main className="flex min-h-screen min-w-0 flex-col">
          <div className="ll-cloth md:hidden px-5 py-4">{stampedLabel(true)}</div>

          <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
            <div className="ll-margin w-full max-w-[25rem] pl-6 sm:pl-8">
              {confirmationSent ? (
                <div>
                  <Mark kind="tick" draw className="[&_svg]:h-7 [&_svg]:w-7" />
                  <h2 className="mt-4 ll-heading text-[30px] leading-tight text-ink-900">Confirm your email</h2>
                  <p className="mt-3 text-[15px] leading-relaxed text-graphite-600">
                    Account created. A confirmation link went to <span className="font-semibold text-ink-900">{email}</span>. Open it to activate the account, then sign in.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmationSent(false);
                      switchMode('signIn');
                    }}
                    className="mt-7 h-11 w-full rounded-sm bg-oxblood-fill text-[15px] font-semibold text-white hover:bg-[var(--oxblood-fill-hover)]"
                  >
                    Return to sign in
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="ll-heading text-[32px] leading-tight text-ink-900">
                    {mode === 'signIn' ? 'Open your books' : 'Start a new book'}
                  </h2>
                  <p className="mt-2 text-[15px] text-graphite-600">
                    {mode === 'signIn' ? 'Sign in with the email and password on your account.' : 'Use your work email. Your organization is set up next.'}
                  </p>

                  {error && (
                    <p role="alert" className="mt-6 flex items-start gap-2 text-[14px] text-ledger-red">
                      <Mark kind="circled" className="mt-0.5" />
                      <span>{error}</span>
                    </p>
                  )}

                  <form onSubmit={handleSubmit} className="mt-7 space-y-5" noValidate={false}>
                    <label className="block">
                      <span className="text-[13.5px] font-semibold text-ink-900">Work email</span>
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="name@company.co.ke"
                        className={fieldClass}
                      />
                    </label>

                    <label className="block">
                      <span className="text-[13.5px] font-semibold text-ink-900">Password</span>
                      <input
                        type="password"
                        required
                        minLength={8}
                        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className={fieldClass}
                      />
                      {mode === 'signUp' && <span className="mt-1.5 block text-[12.5px] text-graphite-600">At least 8 characters.</span>}
                    </label>

                    {mode === 'signUp' && (
                      <label className="block">
                        <span className="text-[13.5px] font-semibold text-ink-900">Confirm password</span>
                        <input
                          type="password"
                          required
                          minLength={8}
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          className={fieldClass}
                        />
                      </label>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="h-11 w-full rounded-sm bg-oxblood-fill text-[15px] font-semibold text-white hover:bg-[var(--oxblood-fill-hover)] disabled:cursor-wait disabled:opacity-60"
                    >
                      {loading ? (mode === 'signIn' ? 'Signing in…' : 'Creating account…') : mode === 'signIn' ? 'Sign in' : 'Create account'}
                    </button>
                  </form>

                  <p className="mt-8 border-t border-feint pt-5 text-[14px] text-graphite-600">
                    {mode === 'signIn' ? 'New to Ledger Link? ' : 'Already have an account? '}
                    <button
                      type="button"
                      onClick={() => switchMode(mode === 'signIn' ? 'signUp' : 'signIn')}
                      className="font-semibold text-oxblood underline underline-offset-[3px] decoration-[color-mix(in_srgb,currentColor_40%,transparent)] hover:decoration-current"
                    >
                      {mode === 'signIn' ? 'Create an account' : 'Sign in'}
                    </button>
                  </p>
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
