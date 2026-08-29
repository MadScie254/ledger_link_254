import React, { useState } from 'react';
import { LogIn, Mail, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthProvider';

export function LockScreen() {
  const { signInWithOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await signInWithOtp(email);
    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-ink-900 z-[100] flex items-center justify-center p-4">
      <div className="bg-paper-100 p-8 rounded-lg shadow-2xl w-full max-w-sm text-center">
        {success ? (
          <>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 mb-6">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-serif text-ink-900 mb-2">Check your email</h2>
            <p className="text-slate-500 mb-6 text-sm">We sent a magic link to <strong>{email}</strong>.</p>
          </>
        ) : (
          <>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-focus-blue-500/10 text-focus-blue-500 mb-6">
              <LogIn className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-serif text-ink-900 mb-2">Welcome to LedgerLink</h2>
            <p className="text-slate-500 mb-6 text-sm">Sign in with a magic link sent to your email.</p>
            
            {error && (
              <div className="mb-4 text-sm text-red-500 bg-red-500/10 py-2 rounded">
                {error}
              </div>
            )}

            <form onSubmit={handleLogin}>
              <div className="relative mb-4 text-left">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-10 pr-3 py-3 bg-paper-50 dark:bg-[#0B0F19] border border-ink-900/10 text-ink-900 text-sm rounded-sm focus:ring-2 focus:ring-focus-blue-500 outline-none"
                />
              </div>
              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-ink-900 text-white  py-3 rounded-sm font-medium hover:bg-ink-900/90 transition-colors disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send Magic Link'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
