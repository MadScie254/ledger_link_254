import { useState } from 'react';
import { Search, Menu, Plus, Building2, ChevronDown, Check, Moon, Sun } from 'lucide-react';
import { useAppStore } from '../../store';
import { useQueryClient } from '@tanstack/react-query';
import { NotificationDropdown } from './NotificationDropdown';
import { DynamicQuickAddModal, getContextualEntityType } from '../common/DynamicQuickAddModal';
import { EntityType } from '../../hooks/useEntityForm';

const pageDescriptions: Record<string, string> = {
  'Home / Dashboard': 'Financial command center',
  Banking: 'Cash and reconciliation',
  Sales: 'Receivables and customer revenue',
  'Expenses & Bills': 'Payables and operating spend',
  Accounting: 'Chart of accounts and journal activity',
  Payroll: 'People, payroll, and obligations',
  Tax: 'Tax position and filing readiness',
  Inventory: 'Stock, COGS, and fulfillment',
  Projects: 'Project profitability and time',
  'Customer Hub': 'Customer relationships and history',
  Reports: 'Financial statements and exports',
  Team: 'Workspace members and access',
  'Audit Logs': 'Traceable activity across the business',
  'Apps / Integrations': 'Connected financial workflows',
  'Business Feed': 'Signals that need your attention',
  Settings: 'Organization and financial preferences',
};

export function Header() {
  const queryClient = useQueryClient();
  const { setCommandPaletteOpen, activeView, setActiveView, activeCompany, organizations, setActiveCompany, setCurrentOrgId, setDisplayCurrency, theme, setTheme, setMobileSidebarOpen } = useAppStore();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalEntityType, setModalEntityType] = useState<EntityType>('ITEM');
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const pageDescription = pageDescriptions[activeView] || 'Your financial workspace';

  const openAddEntity = (type?: EntityType) => {
    const targetType = type || getContextualEntityType(activeView);
    setModalEntityType(targetType);
    setIsAddModalOpen(true);
  };

  const handleSelectCompany = (org: any) => {
    setActiveCompany(org);
    setCurrentOrgId(org.id);
    setDisplayCurrency(org.baseCurrency);
    setIsCompanyDropdownOpen(false);
    queryClient.invalidateQueries();
  };

  return (
    <>
      <header className="app-topbar sticky top-0 z-30 h-[4.75rem] border-b flex items-center justify-between px-4 sm:px-6 lg:px-9 shrink-0 transition-colors">
        <div className="flex flex-1 min-w-0 items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="md:hidden p-2 -ml-2 text-slate-500 hover:text-ink-900 hover:bg-paper-100 rounded-lg"
            title="Open navigation menu"
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="hidden lg:block min-w-0 pr-2">
            <p className="page-kicker">{pageDescription}</p>
            <p className="mt-1 text-sm font-semibold text-ink-900 truncate">{activeView}</p>
          </div>

          {/* Quick Company Selector */}
          <div className="relative">
            <button
              onClick={() => setIsCompanyDropdownOpen(!isCompanyDropdownOpen)}
              className="flex items-center gap-2 px-2.5 py-2 rounded-xl border border-ink-900/10 bg-paper-100/80 text-xs font-semibold text-ink-900 hover:border-focus-blue-500/35 hover:bg-paper-100 transition-all shadow-2xs"
            >
              <Building2 className="w-3.5 h-3.5 text-focus-blue-600 shrink-0" />
              <span className="max-w-[105px] sm:max-w-[150px] xl:max-w-[190px] truncate">{activeCompany?.name || 'No company'}</span>
              <span className="hidden sm:inline font-mono text-[10px] px-1.5 py-0.5 bg-paper-50 rounded-md text-slate-500 font-bold">
                {activeCompany?.baseCurrency || 'KES'}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {isCompanyDropdownOpen && (
              <div className="absolute left-0 mt-2 w-72 bg-paper-100 border border-ink-900/10 rounded-2xl shadow-[0_18px_45px_rgba(20,31,56,0.18)] py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-150 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-ink-900/5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.12em]">Switch workspace</span>
                  <button
                    onClick={() => {
                      setIsCompanyDropdownOpen(false);
                      setActiveView('Settings');
                    }}
                    className="text-[10px] text-focus-blue-600 hover:underline flex items-center"
                  >
                    Manage
                  </button>
                </div>
                <div className="max-h-56 overflow-y-auto py-1">
                  {organizations.map((org) => {
                    const isSelected = org.id === activeCompany?.id;
                    return (
                      <button
                        key={org.id}
                        onClick={() => handleSelectCompany(org)}
                        className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between hover:bg-paper-50 dark:hover:bg-ink-900/40 transition-colors ${
                          isSelected ? 'bg-focus-blue-500/8 font-semibold text-focus-blue-600' : 'text-ink-900'
                        }`}
                      >
                        <div className="min-w-0 pr-2 truncate">
                          <p className="truncate">{org.name}</p>
                          <span className="text-[10px] text-slate-400 font-mono">{org.country} • {org.baseCurrency}</span>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-focus-blue-600 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
                <div className="border-t border-ink-900/5 px-2 pt-2">
                  <button
                    onClick={() => {
                      setIsCompanyDropdownOpen(false);
                      setActiveView('Settings');
                    }}
                    className="w-full text-center py-1 text-xs text-slate-600 hover:text-ink-900 flex items-center justify-center space-x-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add New Company...</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <div className="hidden md:flex max-w-md xl:max-w-lg w-full cursor-text" onClick={() => setCommandPaletteOpen(true)}>
            <label htmlFor="search" className="sr-only">Search</label>
            <div className="relative w-full">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </div>
              <div
                className="block w-full pl-9 pr-3 py-2 border border-ink-900/10 rounded-xl leading-5 bg-paper-100/75 text-slate-500 text-xs hover:border-focus-blue-500/50 hover:bg-paper-100 transition-all flex items-center justify-between"
              >
                <span>Search across your workspace</span>
                <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-paper-50 border border-ink-900/10 rounded-md text-slate-400">
                  Ctrl K
                </kbd>
              </div>
            </div>
          </div>
        </div>
        
        <div className="ml-3 flex items-center sm:ml-5 gap-1.5 sm:gap-2">
          {/* Quick Add Dropdown */}
          <div className="relative">
            <button
              onClick={() => openAddEntity()}
              className="bg-focus-blue-500 text-white px-3.5 py-2 rounded-xl text-xs font-semibold hover:brightness-95 hover:-translate-y-px transition-all flex items-center gap-1.5 shadow-[0_8px_18px_color-mix(in_srgb,var(--focus-blue-500)_24%,transparent)]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New</span>
            </button>
          </div>

          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 text-slate-500 hover:text-ink-900 dark:hover:text-white hover:bg-paper-100 dark:hover:bg-ink-900/50 rounded-xl transition-colors"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Dynamic Notification Bell */}
          <NotificationDropdown />
        </div>
      </header>

      {/* Dynamic Context-Aware Quick Add Modal */}
      <DynamicQuickAddModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        overrideType={modalEntityType}
      />
    </>
  );
}
