import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from './CommandPalette';
import { MobileTabBar } from './MobileTabBar';
import { useAppStore } from '../../store';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const activeCompany = useAppStore((state) => state.activeCompany);

  return (
    <div className="app-shell min-h-screen flex flex-col md:flex-row">
      <CommandPalette />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative">
        <Header />
        {activeCompany?.isDemo && (
          <p className="flex flex-wrap items-baseline gap-x-2 border-b border-feint-strong bg-paper-200 px-4 sm:px-6 lg:px-8 py-1.5 text-[12.5px] text-ink-900">
            <span className="ll-printed text-[11px] text-graphite-600">Specimen</span>
            <span>Demo organization. Its figures are sample books, not a real business.</span>
          </p>
        )}
        <main className="flex-1 overflow-y-auto px-4 pt-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-6 lg:px-8 lg:py-7">
          <div className="app-page-container">{children}</div>
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
