import { useState } from 'react';
import { Search, Menu, ChevronDown, Check, Moon, Sun, HelpCircle, UserRound } from 'lucide-react';
import { useAppStore } from '../../store';
import { useQueryClient } from '@tanstack/react-query';
import { NotificationDropdown } from './NotificationDropdown';
import { CompanyMark } from '../ledger/CompanyMark';
import { BrandMark } from '../ledger/BrandMark';
import { editionDefinition } from '../../utils/editions';
import { useAuth } from '../../context/AuthProvider';
import { useOnboarding } from '../onboarding/OnboardingProvider';

/** The plain name each view goes by in the drill path. */
const SECTION_NAMES: Record<string, string> = {
  'Home / Dashboard': 'Home',
  Sales: 'Sales & customers',
  'Customer Hub': 'Customers',
  'Expenses & Bills': 'Expenses & suppliers',
  Tax: 'Taxes',
  'Apps / Integrations': 'Integrations',
  'Audit Logs': 'Audit log',
  'Business Feed': 'Business feed',
};

export function Header() {
  const queryClient = useQueryClient();
  const { user, signOut } = useAuth();
  const { restartTutorial, isReady: tutorialReady } = useOnboarding();
  const {
    setCommandPaletteOpen,
    activeView,
    setActiveView,
    activeCompany,
    organizations,
    setActiveCompany,
    setCurrentOrgId,
    setDisplayCurrency,
    theme,
    setTheme,
    setMobileSidebarOpen,
  } = useAppStore();
  const [isCompanyMenuOpen, setIsCompanyMenuOpen] = useState(false);

  const avatarLetter = (user?.user_metadata?.full_name || user?.email || 'A').charAt(0).toUpperCase();
  const edition = editionDefinition(activeCompany?.edition);
  const editionName = edition.sidebar.flatMap((group) => group.items)
    .find((item) => item.view === activeView)?.name.en;
  const sectionName = edition.id === 'business'
    ? SECTION_NAMES[activeView] || activeView : editionName || activeView;

  const handleSelectCompany = (org: any) => {
    setActiveCompany(org);
    setCurrentOrgId(org.id);
    setDisplayCurrency(org.baseCurrency);
    setActiveView(editionDefinition(org.edition).defaultView);
    setIsCompanyMenuOpen(false);
    queryClient.invalidateQueries();
  };

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="md:hidden p-2 -ml-1 text-graphite-600 hover:text-ink-900"
          aria-label="Open sections"
        >
          <Menu className="h-5 w-5" />
        </button>

        {edition.poweredBy && <BrandMark edition={edition.id} wordmark className="h-4 w-4" />}

        <nav data-tour="app-location" aria-label="Where you are" className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <div className="relative min-w-0 hidden sm:block">
            <button
              type="button"
              onClick={() => setIsCompanyMenuOpen(!isCompanyMenuOpen)}
              aria-expanded={isCompanyMenuOpen}
              aria-haspopup="menu"
              className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-text-2 hover:bg-hover hover:text-text"
            >
              <CompanyMark name={activeCompany?.name} size="sm" />
              <span className="truncate max-w-[6.5rem] sm:max-w-[14rem]">{activeCompany?.name || 'No organization'}</span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </button>

            {isCompanyMenuOpen && (
              <div role="menu" className="absolute left-0 z-50 mt-1.5 w-72 rounded-xl border border-border bg-surface shadow-md">
                <p className="px-3.5 pt-3 pb-2 ll-printed text-[10.5px] text-graphite-500 border-b border-feint">Books you can open</p>
                <ul className="max-h-64 overflow-y-auto py-1">
                  {organizations.map((org) => {
                    const isSelected = org.id === activeCompany?.id;
                    return (
                      <li key={org.id}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          onClick={() => handleSelectCompany(org)}
                          className="w-full text-left px-3.5 py-2 flex items-center gap-2.5 hover:bg-paper-200"
                        >
                          <CompanyMark name={org.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-[13px] ${isSelected ? 'font-semibold text-ink-900' : 'text-ink-900'}`}>{org.name}</span>
                            <span className="block text-[11.5px] text-graphite-500">{org.country} · {org.baseCurrency}</span>
                          </span>
                          {isSelected && <Check className="w-4 h-4 shrink-0 text-oxblood" aria-hidden="true" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="border-t border-feint px-3.5 py-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCompanyMenuOpen(false);
                      setActiveView('Settings');
                    }}
                    className="text-[12.5px] text-oxblood underline underline-offset-[3px] hover:text-ink-900"
                  >
                    Add or manage organizations
                  </button>
                </div>
              </div>
            )}
          </div>
          <span className="hidden sm:inline text-feint-strong" aria-hidden="true">/</span>
          <span className="truncate font-semibold text-ink-900" aria-current="page">{sectionName}</span>
        </nav>

        <button
          type="button"
          data-tour="header-search"
          onClick={() => setCommandPaletteOpen(true)}
          className="ml-auto hidden h-9 w-64 items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3 text-[12.5px] text-text-3 hover:border-primary hover:text-text md:flex lg:w-80"
        >
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">Find a record or report</span>
          <kbd className="text-graphite-500">Ctrl K</kbd>
        </button>

        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <button
            type="button"
            data-tour="header-search"
            onClick={() => setCommandPaletteOpen(true)}
            className="rounded-md p-2 text-text-2 hover:bg-hover hover:text-text md:hidden"
            aria-label="Find a record or report"
          >
            <Search className="h-4.5 w-4.5" />
          </button>

          <details className="relative" onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.open = false; }}>
            <summary aria-label="Help" className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md text-text-2 hover:bg-hover hover:text-text [&::-webkit-details-marker]:hidden">
              <HelpCircle className="h-[18px] w-[18px]" aria-hidden="true" />
            </summary>
            <div role="menu" aria-label="Help" className="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-border bg-surface p-1.5 shadow-md">
              <button type="button" role="menuitem" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setActiveView('Documentation'); }} className="flex h-9 w-full items-center rounded-md px-3 text-left text-[13px] text-text hover:bg-hover">Documentation</button>
              <button type="button" role="menuitem" disabled={!tutorialReady} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); restartTutorial(); }} className="flex h-9 w-full items-center rounded-md px-3 text-left text-[13px] text-text hover:bg-hover disabled:opacity-50">Take a tour</button>
            </div>
          </details>

          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex h-9 w-9 items-center justify-center rounded-md text-text-2 hover:bg-hover hover:text-text"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <NotificationDropdown />
          <details className="relative" onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.open = false; }}>
            <summary aria-label="Account menu" className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary-ink [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true">{avatarLetter}</span>
            </summary>
            <div role="menu" aria-label="Account" className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-md">
              <p className="truncate border-b border-border px-3 py-2 text-[12px] text-text-2">{user?.email || 'Signed-in account'}</p>
              <button type="button" role="menuitem" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setActiveView('Settings'); }} className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[13px] text-text hover:bg-hover"><UserRound className="h-4 w-4" aria-hidden="true" />Company settings</button>
              <button type="button" role="menuitem" onClick={() => void signOut()} className="flex h-9 w-full items-center rounded-md px-3 text-left text-[13px] text-text hover:bg-hover">Sign out</button>
            </div>
          </details>
        </div>
      </header>

    </>
  );
}
