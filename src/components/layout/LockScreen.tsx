import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useAuth } from '../../context/AuthProvider';
import { Mark } from '../ledger/Mark';
import { BrandMark } from '../ledger/BrandMark';

type Mode = 'signIn' | 'signUp' | 'reset';

const CONTENTS = [
  ['General ledger', 'Posted entries, account balances and a complete audit history.'],
  ['Operations', 'Invoices, bills, banking, payroll, inventory and projects.'],
  ['Reporting', 'Financial statements with export-ready schedules.'],
];

const fieldClass =
  'mt-1.5 block w-full h-11 rounded-sm border border-field bg-paper-100 px-3 text-[15px] text-ink-900 placeholder:text-graphite-500 focus:border-oxblood focus:shadow-[0_0_0_1px_var(--oxblood)] focus:outline-none';

/** The cover of the book, and its first page. */
export function LockScreen({ initialMode = 'signIn', onBack }: { initialMode?: 'signIn' | 'signUp'; onBack?: () => void } = {}) {
  const { signIn, signUp, resendConfirmation, requestPasswordReset } = useAuth();
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [resendError, setResendError] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setResetSent(false);
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
    if (mode === 'reset') {
      const { error: resetError } = await requestPasswordReset(email.trim());
      // A rate limit or a bad address is worth saying; whether the account exists is not.
      if (resetError && /rate|limit|invalid/i.test(resetError.message)) setError(resetError.message);
      else setResetSent(true);
    } else if (mode === 'signIn') {
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

  const handleResend = async () => {
    setResendStatus('sending');
    setResendError('');
    const { error: resendErr } = await resendConfirmation(email);
    if (resendErr) {
      setResendError(resendErr.message);
      setResendStatus('idle');
    } else {
      setResendStatus('sent');
    }
  };

  const stampedLabel = (compact: boolean) => (
    <div className={`inline-block border border-[var(--spine-rule)] p-[3px] ${compact ? '' : 'w-full max-w-[20rem]'}`}>
      <div className={`border border-[var(--spine-rule)] ${compact ? 'px-3 py-2' : 'px-5 py-4'}`}>
        <span className="flex items-center gap-2">
          <BrandMark className={compact ? 'h-3.5 w-3.5 shrink-0' : 'h-5 w-5 shrink-0'} />
          <p className={`ll-printed tracking-[0.16em] text-sidebar-ink leading-none ${compact ? 'text-[14px]' : 'text-[19px]'}`}>Ledger Link</p>
        </span>
        {!compact && <p className="mt-2.5 text-[12.5px] text-sidebar-muted">Books of account for Kenyan business</p>}
      </div>
    </div>
  );

  return (
    <motion.div
      className="fixed inset-0 z-[100] overflow-y-auto ll-grain-bg"
      initial={reducedMotion ? false : { opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.32, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="grid min-h-full grid-cols-1 md:grid-cols-[minmax(22rem,44%)_minmax(0,1fr)]">
        {/* The cover */}
        <aside className="ll-cloth hidden md:flex min-h-screen flex-col justify-between px-10 py-10 lg:px-14 lg:py-12 text-sidebar-ink">
          {stampedLabel(false)}

          <div className="max-w-[26rem]">
            <h1 className="ll-cover text-[40px] lg:text-[46px] leading-[1.02] text-sidebar-ink">Every invoice, bill and payment, posted to one ledger.</h1>
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
          <div className="ll-cloth flex items-center justify-between px-5 py-4 md:hidden">
            {stampedLabel(true)}
            {onBack && (
              <button type="button" onClick={onBack} className="p-1.5 text-sidebar-muted hover:text-sidebar-ink" aria-label="Back">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
          </div>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="hidden items-center gap-1.5 px-8 pt-6 text-[13px] text-graphite-600 hover:text-ink-900 md:flex"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            </button>
          )}

          <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
            <div className="ll-margin w-full max-w-[25rem] pl-6 sm:pl-8">
              {confirmationSent ? (
                <div>
                  <Mark kind="tick" draw className="[&_svg]:h-7 [&_svg]:w-7" />
                  <h2 className="mt-4 ll-heading text-[30px] leading-tight text-ink-900">Confirm your email</h2>
                  <p className="mt-3 text-[15px] leading-relaxed text-graphite-600">
                    Account created. A confirmation link went to <span className="font-semibold text-ink-900">{email}</span>. Open it to activate the account, then sign in.
                  </p>
                  <p className="mt-4 text-[13px] leading-relaxed text-graphite-600">
                    Nothing after a few minutes, check spam first. Still nothing?{' '}
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resendStatus === 'sending'}
                      className="font-semibold text-oxblood underline underline-offset-[3px] disabled:opacity-50"
                    >
                      {resendStatus === 'sending' ? 'Sending' : 'Send it again'}
                    </button>
                    .
                  </p>
                  {resendStatus === 'sent' && (
                    <p role="status" className="mt-2 text-[13px] text-graphite-600">Sent again to {email}.</p>
                  )}
                  {resendError && (
                    <p role="alert" className="mt-2 text-[13px] text-ledger-red">{resendError}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmationSent(false);
                      setResendStatus('idle');
                      setResendError('');
                      switchMode('signIn');
                    }}
                    className="mt-7 h-11 w-full rounded-sm bg-oxblood-fill text-[15px] font-semibold text-white hover:bg-[var(--oxblood-fill-hover)]"
                  >
                    Return to sign in
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="ll-cover text-[32px] leading-tight text-ink-900">
                    {mode === 'signIn' ? 'Open your books' : mode === 'reset' ? 'Reset your password' : 'Start a new book'}
                  </h2>
                  <p className="mt-2 text-[15px] text-graphite-600">
                    {mode === 'signIn'
                      ? 'Sign in with the email and password on your account.'
                      : mode === 'reset'
                        ? 'Enter the email on your account. A link to choose a new password is sent to it.'
                        : 'Use your work email. Your organization is set up next.'}
                  </p>
                  {mode === 'reset' && resetSent && (
                    <p role="status" className="mt-6 text-[14px] text-ink-900">
                      <Mark kind="tick" label={`If an account uses ${email.trim()}, a reset link is on its way. Open it on this device to choose a new password.`} />
                    </p>
                  )}

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

                    {mode !== 'reset' && (
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
                      {mode === 'signIn' && (
                        <button
                          type="button"
                          onClick={() => switchMode('reset')}
                          className="mt-1.5 text-[12.5px] text-oxblood underline underline-offset-[3px] decoration-[color-mix(in_srgb,currentColor_40%,transparent)] hover:decoration-current"
                        >
                          Forgot your password?
                        </button>
                      )}
                    </label>
                    )}

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
                      {loading
                        ? mode === 'signIn' ? 'Signing in…' : mode === 'reset' ? 'Sending…' : 'Creating account…'
                        : mode === 'signIn' ? 'Sign in' : mode === 'reset' ? 'Send the reset link' : 'Create account'}
                    </button>
                  </form>

                  <p className="mt-8 border-t border-feint pt-5 text-[14px] text-graphite-600">
                    {mode === 'signIn' ? 'New to Ledger Link? ' : mode === 'reset' ? 'Remembered it? ' : 'Already have an account? '}
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
    </motion.div>
  );
}
