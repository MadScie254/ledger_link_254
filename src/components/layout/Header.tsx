import { useState } from 'react';
import { Search, Menu, Plus, ChevronDown, Check, Moon, Sun } from 'lucide-react';
import { useAppStore } from '../../store';
import { useQueryClient } from '@tanstack/react-query';
import { NotificationDropdown } from './NotificationDropdown';
import { DynamicQuickAddModal, getContextualEntityType } from '../common/DynamicQuickAddModal';
import { EntityType } from '../../hooks/useEntityForm';

/** The plain name each view goes by in the drill path. */
const SECTION_NAMES: Record<string, string> = {
  'Home / Dashboard': 'Home',
  'Customer Hub': 'Customers',
  'Expenses & Bills': 'Bills and expenses',
  'Apps / Integrations': 'Integrations',
  'Audit Logs': 'Audit log',
  'Business Feed': 'Business feed',
};

const ADD_LABELS: Record<EntityType, string> = {
  CUSTOMER: 'Add customer',
  VENDOR: 'Add vendor',
  ITEM: 'Add stock item',
  EMPLOYEE: 'Add employee',
  ACCOUNT: 'Add account',
} as Record<EntityType, string>;

/**
 * The header offers a quick add only where the record is obvious and the page
 * heading does not already carry it. Home adds customers, what owners add most;
 * pages such as Inventory, Customers and Payroll own their add action.
 */
const HEADER_ADD: Partial<Record<string, EntityType>> = {
  'Home / Dashboard': 'CUSTOMER',
  Sales: 'CUSTOMER',
  Banking: 'ACCOUNT',
};
const addTypeFor = (view: string): EntityType => HEADER_ADD[view] || getContextualEntityType(view);

export function Header() {
  const queryClient = useQueryClient();
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
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalEntityType, setModalEntityType] = useState<EntityType>('ITEM');
  const [isCompanyMenuOpen, setIsCompanyMenuOpen] = useState(false);

  const contextualType = addTypeFor(activeView);
  const sectionName = SECTION_NAMES[activeView] || activeView;

  const openAddEntity = () => {
    setModalEntityType(contextualType);
    setIsAddModalOpen(true);
  };

  const handleSelectCompany = (org: any) => {
    setActiveCompany(org);
    setCurrentOrgId(org.id);
    setDisplayCurrency(org.baseCurrency);
    setIsCompanyMenuOpen(false);
    queryClient.invalidateQueries();
  };

  return (
    <>
      <header className="sticky top-0 z-30 h-14 bg-paper-100 border-b border-feint-strong flex items-center gap-2 px-3 sm:px-6 lg:px-8 shrink-0">
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="md:hidden p-2 -ml-1 text-graphite-600 hover:text-ink-900"
          aria-label="Open sections"
        >
          <Menu className="h-5 w-5" />
        </button>

        <nav aria-label="Where you are" className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <div className="relative min-w-0 hidden sm:block">
            <button
              type="button"
              onClick={() => setIsCompanyMenuOpen(!isCompanyMenuOpen)}
              aria-expanded={isCompanyMenuOpen}
              aria-haspopup="menu"
              className="flex min-w-0 items-center gap-1 px-1.5 py-1 -ml-1.5 text-graphite-600 hover:text-ink-900 hover:bg-paper-200 rounded-sm"
            >
              <span className="truncate max-w-[6.5rem] sm:max-w-[14rem]">{activeCompany?.name || 'No organization'}</span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </button>

            {isCompanyMenuOpen && (
              <div role="menu" className="absolute left-0 mt-1.5 w-72 bg-paper-100 border border-feint-strong ll-lift z-50">
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
                          className="w-full text-left px-3.5 py-2 flex items-center justify-between gap-3 hover:bg-paper-200"
                        >
                          <span className="min-w-0">
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
          onClick={() => setCommandPaletteOpen(true)}
          className="ml-auto hidden md:flex w-64 lg:w-80 items-center gap-2 h-8 px-2.5 border border-field rounded-sm bg-paper-100 text-[12.5px] text-graphite-500 hover:border-ink-900 hover:text-ink-900"
        >
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">Find a record or report</span>
          <kbd className="text-graphite-500">Ctrl K</kbd>
        </button>

        <div className="ml-auto md:ml-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="md:hidden p-2 text-graphite-600 hover:text-ink-900"
            aria-label="Find a record or report"
          >
            <Search className="h-4.5 w-4.5" />
          </button>

          {HEADER_ADD[activeView] && (
          <button
            type="button"
            onClick={openAddEntity}
            aria-label={ADD_LABELS[contextualType]}
            className="flex items-center gap-1.5 h-8 px-2 sm:px-2.5 rounded-sm border border-field text-ink-900 text-[12.5px] hover:border-ink-900"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{ADD_LABELS[contextualType]}</span>
          </button>
          )}

          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 text-graphite-600 hover:text-ink-900"
            aria-label={theme === 'dark' ? 'Switch to paper (light)' : 'Switch to carbon (dark)'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <NotificationDropdown />
        </div>
      </header>

      <DynamicQuickAddModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} overrideType={modalEntityType} />
    </>
  );
}
