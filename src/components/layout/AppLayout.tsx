import React from 'react';
import { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from './CommandPalette';
import { useAppStore } from '../../store';
import { AlertCircle } from 'lucide-react';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const activeCompany = useAppStore(state => state.activeCompany);

  return (
    <div className="min-h-screen bg-paper-50 flex flex-col md:flex-row">
      <CommandPalette />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        {activeCompany?.isDemo && (
          <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center justify-center text-sm text-blue-800">
            <AlertCircle className="w-4 h-4 mr-2" />
            <span>You are currently viewing a <strong>Demo Organization</strong>. Data here is populated for demonstration purposes only.</span>
          </div>
        )}
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
