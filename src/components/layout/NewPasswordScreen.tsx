import React, { useState } from 'react';
import { useAuth } from '../../context/AuthProvider';
import { Mark } from '../ledger/Mark';

const fieldClass =
  'mt-1.5 block w-full h-11 rounded-sm border border-field bg-paper-100 px-3 text-[15px] text-ink-900 focus:border-oxblood focus:shadow-[0_0_0_1px_var(--oxblood)] focus:outline-none';

/** Shown after a password-reset link signs someone in, before the books open. */
export function NewPasswordScreen() {
  const { updatePassword, signOut, user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    const { error: updateError } = await updatePassword(password);
    setSaving(false);
    if (updateError) setError(updateError.message);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-paper-100 px-5 py-10">
      <div className="ll-margin w-full max-w-[25rem] pl-6 sm:pl-8">
        <h1 className="ll-cover text-[32px] leading-tight text-ink-900">Choose a new password</h1>
        <p className="mt-2 text-[15px] text-graphite-600">For {user?.email || 'your account'}. You stay signed in once it is saved.</p>
        {error && (
          <p role="alert" className="mt-6 flex items-start gap-2 text-[14px] text-ledger-red">
            <Mark kind="circled" className="mt-0.5" />
            <span>{error}</span>
          </p>
        )}
        <form onSubmit={submit} className="mt-7 space-y-5">
          <label className="block">
            <span className="text-[13.5px] font-semibold text-ink-900">New password</span>
            <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
            <span className="mt-1.5 block text-[12.5px] text-graphite-600">At least 8 characters.</span>
          </label>
          <label className="block">
            <span className="text-[13.5px] font-semibold text-ink-900">Confirm new password</span>
            <input type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={fieldClass} />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="h-11 w-full rounded-sm bg-oxblood-fill text-[15px] font-semibold text-white hover:bg-[var(--oxblood-fill-hover)] disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save new password'}
          </button>
        </form>
        <button type="button" onClick={() => void signOut()} className="mt-6 text-[13px] text-graphite-600 underline underline-offset-[3px]">
          Sign out instead
        </button>
      </div>
    </div>
  );
}
