import React from 'react';
import { Lock } from 'lucide-react';
import { useAppStore } from '../../store';
import { useState } from 'react';

export function LockScreen() {
  const { setLocked } = useAppStore();
  const [password, setPassword] = useState('');

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'password') { // Placeholder password for now
      setLocked(false);
    } else {
      setLocked(false); // since it's just a mockup, let's unlock easily.
    }
  };

  return (
    <div className="fixed inset-0 bg-ink-900 z-[100] flex items-center justify-center">
      <div className="bg-white dark:bg-[#111827] p-8 rounded-lg shadow-2xl w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-focus-blue-500/10 text-focus-blue-500 mb-6">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-serif text-ink-900 mb-2">Session Locked</h2>
        <p className="text-slate-500 mb-6 text-sm">You were inactive for 15 minutes.</p>
        <form onSubmit={handleUnlock}>
          <input
            type="password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password to unlock"
            className="w-full bg-paper-50 dark:bg-[#0B0F19] border border-ink-900/10 text-ink-900 text-sm rounded-sm px-3 py-3 focus:ring-2 focus:ring-focus-blue-500 outline-none mb-4"
          />
          <button type="submit" className="w-full bg-ink-900 text-white dark:text-slate-900 py-3 rounded-sm font-medium hover:bg-ink-900/90 transition-colors">
            Unlock
          </button>
        </form>
      </div>
    </div>
  );
}
