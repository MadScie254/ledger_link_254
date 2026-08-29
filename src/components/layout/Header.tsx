import { useState } from 'react';
import { Search, Menu, Plus, Building2, ChevronDown, Check, Moon, Sun } from 'lucide-react';
import { useAppStore } from '../../store';
import { useQueryClient } from '@tanstack/react-query';
import { NotificationDropdown } from './NotificationDropdown';
import { DynamicQuickAddModal, getContextualEntityType } from '../common/DynamicQuickAddModal';
import { EntityType } from '../../hooks/useEntityForm';

export function Header() {
  const queryClient = useQueryClient();
  const { setCommandPaletteOpen, activeView, setActiveView, activeCompany, organizations, setActiveCompany, setCurrentOrgId, setDisplayCurrency, theme, setTheme } = useAppStore();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalEntityType, setModalEntityType] = useState<EntityType>('ITEM');
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);

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
      <header className="h-16 bg-paper-50 dark:bg-[#0b0f17] border-b border-ink-900/10 flex items-center justify-between px-4 sm:px-6 shrink-0 transition-colors">
        <div className="flex flex-1 items-center space-x-4">
          <button type="button" className="md:hidden p-2 -ml-2 text-slate-500 hover:text-ink-900">
            <Menu className="h-6 w-6" />
          </button>

          {/* Quick Company Selector in Header */}
          <div className="relative">
            <button
              onClick={() => setIsCompanyDropdownOpen(!isCompanyDropdownOpen)}
              className="flex items-center space-x-2 px-2.5 py-1.5 rounded-sm border border-ink-900/15 bg-paper-100 text-xs font-semibold text-ink-900 hover:bg-paper-50 transition-colors shadow-2xs"
            >
              <Building2 className="w-3.5 h-3.5 text-focus-blue-600 shrink-0" />
              <span className="max-w-[140px] sm:max-w-[180px] truncate">{activeCompany?.name || 'Acme Corp Ltd.'}</span>
              <span className="font-mono text-[10px] px-1 py-0.2 bg-paper-100  rounded text-slate-500 font-bold">
                {activeCompany?.baseCurrency || 'KES'}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {isCompanyDropdownOpen && (
              <div className="absolute left-0 mt-1.5 w-64 bg-paper-100 border border-ink-900/15 rounded-sm shadow-lg py-1.5 z-50 animate-in fade-in">
                <div className="px-3 py-1.5 border-b border-ink-900/5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Switch Company</span>
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
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-paper-50 dark:hover:bg-ink-900/40 transition-colors ${
                          isSelected ? 'bg-focus-blue-500/5 font-semibold text-focus-blue-600' : 'text-ink-900'
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
                <div className="border-t border-ink-900/5 px-2 pt-1.5">
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
          
          <div className="hidden md:flex max-w-md w-full cursor-text" onClick={() => setCommandPaletteOpen(true)}>
            <label htmlFor="search" className="sr-only">Search</label>
            <div className="relative w-full">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </div>
              <div
                className="block w-full pl-9 pr-3 py-1.5 border border-ink-900/10 rounded-sm leading-5 bg-paper-100 text-slate-500 text-xs hover:border-focus-blue-500 transition-colors flex items-center justify-between"
              >
                <span>Search (Cmd+K)</span>
                <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-paper-100  border border-ink-900/10 rounded text-slate-400">
                  ⌘K
                </kbd>
              </div>
            </div>
          </div>
        </div>
        
        <div className="ml-4 flex items-center md:ml-6 space-x-3">
          {/* Quick Add Dropdown */}
          <div className="relative">
            <button
              onClick={() => openAddEntity()}
              className="bg-ink-900 text-white  px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-ink-900/90 transition-colors flex items-center space-x-1.5 shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New</span>
            </button>
          </div>

          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 text-slate-500 hover:text-ink-900 dark:hover:text-white hover:bg-paper-100 dark:hover:bg-ink-900/50 rounded-sm transition-colors"
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


