import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from './CommandPalette';
import { useAppStore } from '../../store';
import { AlertCircle } from 'lucide-react';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const activeCompany = useAppStore(state => state.activeCompany);

  return (
    <div className="app-shell min-h-screen flex flex-col md:flex-row">
      <CommandPalette />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative">
        <Header />
        {activeCompany?.isDemo && (
          <div className="bg-focus-blue-500/8 border-b border-focus-blue-500/15 px-4 py-2 flex items-center justify-center text-xs text-focus-blue-700 dark:text-focus-blue-300">
            <AlertCircle className="w-4 h-4 mr-2 shrink-0" />
            <span>You are viewing a <strong>demo organization</strong>. Its figures are illustrative only.</span>
          </div>
        )}
        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-9 lg:py-8 overflow-y-auto">
          <div className="app-page-container">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
