import { useMemo, useState } from 'react';
import { BarChart3, BookOpen, CalendarDays, Calculator, ChevronDown, FileText, FolderKanban, House, Landmark, MessageSquare, Package, PanelLeftClose, PanelLeftOpen, Plug, Plus, ReceiptText, Scale, ScrollText, Settings2, Users, Wallet, X, type LucideIcon } from 'lucide-react';
import { useAppStore } from '../../store';
import { CompanyMark } from '../ledger/CompanyMark';
import { BrandMark } from '../ledger/BrandMark';
import { editionDefinition, navigationGroupsFor } from '../../utils/editions';

const STORAGE_KEY = 'ledgerlink.sidebar.collapsed';
const ICONS: Record<string, LucideIcon> = {
  'Home / Dashboard': House, 'Business Feed': MessageSquare, Sales: FileText,
  'Customer Hub': Users, 'Expenses & Bills': ReceiptText, Banking: Landmark,
  Payroll: Wallet, Inventory: Package, Projects: FolderKanban, Reports: BarChart3,
  Tax: Calculator, Accounting: BookOpen, Team: Users, Settings: Settings2,
  'Apps / Integrations': Plug, 'Audit Logs': ScrollText, Documentation: BookOpen,
  'Law / Matters': Scale, 'Law / Court diary': CalendarDays,
  'Law / Time': CalendarDays, 'Law / Fee notes': FileText,
  'Law / Client account': Landmark, 'Law / Disbursements': ReceiptText,
  'Church / Members': Users, 'Church / Households': Users,
  'Church / Giving': Wallet, 'Church / Funds': Landmark,
  'Church / Cash count': Calculator, "Church / Treasurer's report": BarChart3,
  'Church / Fund balances': BarChart3,
};

export function Sidebar() {
  const { activeView, setActiveView, activeCompany, isMobileSidebarOpen, setMobileSidebarOpen, setNewMenuOpen } = useAppStore();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
  });

  const edition = editionDefinition(activeCompany?.edition);
  const groups = useMemo(
    () => navigationGroupsFor(activeCompany?.edition, activeCompany?.businessType, activeCompany?.role),
    [activeCompany?.edition, activeCompany?.businessType, activeCompany?.role],
  );
  const rail = collapsed && !isMobileSidebarOpen;
  const navGroups = groups.filter((group) => group.label.en !== 'Settings' && group.label.en !== 'Help');
  const settingsItems = edition.id === 'business'
    ? groups.find((group) => group.label.en === 'Settings')?.items || []
    : [{ view: 'Settings', name: { en: 'Company', sw: 'TODO-SW' as const } }];

  const toggleRail = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* The choice lasts for this session. */ }
  };

  const handleNavigate = (view: string) => {
    setActiveView(view);
    setMobileSidebarOpen(false);
  };

  const spine = (
    <div className={`ll-cloth flex h-full min-h-screen shrink-0 flex-col border-r border-border text-text transition-[width] duration-[220ms] ease-[var(--motion-ease)] ${rail ? 'w-[68px]' : 'w-64'}`}>
      <div className={`flex items-center gap-2 px-3 pt-5 pb-4 ${rail ? 'justify-center' : 'justify-between'}`}>
        <button type="button" onClick={() => handleNavigate('Home / Dashboard')}
          aria-label={`${edition.brandName}. Go to Home`}
          className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1.5 text-left text-text hover:bg-hover">
          <BrandMark className="h-6 w-6 shrink-0 text-primary" />
          {!rail && <span className="truncate font-display text-[15px] font-bold">{edition.brandName}</span>}
        </button>
        <button type="button" onClick={() => setMobileSidebarOpen(false)}
          className="rounded-md p-2 text-text-2 hover:bg-hover md:hidden" aria-label="Close navigation">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {!rail && <div className="mx-3 mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-[12px] text-text-2">
        <CompanyMark name={activeCompany?.name} size="sm" />
        <span className="truncate">{activeCompany?.name || 'No organization'}</span>
      </div>}
      <div className="px-3 pb-3">
        <button type="button" onClick={() => { setNewMenuOpen(true); setMobileSidebarOpen(false); }}
          disabled={!activeCompany} aria-label="New"
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-[14px] font-semibold text-on-primary shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50">
          <Plus className="h-4 w-4" aria-hidden="true" />{!rail && <span>New</span>}
        </button>
      </div>

      <nav data-tour="sidebar-index" aria-label="Sections" className="flex-1 overflow-y-auto px-2 pb-4">
        {navGroups.map((group) => (
          <section key={group.label.en} className="mt-4 first:mt-1">
            {!rail && <h2 className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">{group.label.en}</h2>}
            {rail && <div className="mx-3 mb-2 border-t border-border" />}
            <ul className="space-y-0.5">
              {group.items.filter((item) => item.view !== 'Settings').map((item) => {
                const Icon = ICONS[item.view] || FileText;
                const isOpen = activeView === item.view;
                const indent = item.childOf && !rail;
                return <li key={item.view}>
                  {item.available === false ? (
                    <span aria-disabled="true" title={item.name.en}
                      className={`flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] text-text-3 ${indent ? 'pl-8' : ''}`}>
                      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                      {!rail && <><span className="truncate">{item.name.en}</span><span className="ml-auto text-[10px]">Planned</span></>}
                    </span>
                  ) : (
                    <button type="button" onClick={() => handleNavigate(item.view)}
                      aria-label={item.name.en} title={rail ? item.name.en : undefined}
                      aria-current={isOpen ? 'page' : undefined}
                      className={`flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left text-[13.5px] ${rail ? 'justify-center' : ''} ${indent ? 'pl-8' : ''} ${isOpen ? 'bg-primary-soft font-semibold text-primary-ink' : 'text-text-2 hover:bg-hover hover:text-text'}`}>
                      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                      {!rail && <span className="truncate">{item.name.en}</span>}
                    </button>
                  )}
                </li>;
              })}
            </ul>
          </section>
        ))}
      </nav>

      <div className="border-t border-border px-2 py-3">
        <details className="group relative" onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.open = false; }}>
          <summary aria-label="Settings" className={`flex h-10 cursor-pointer list-none items-center gap-2.5 rounded-md px-3 text-[13.5px] text-text-2 hover:bg-hover hover:text-text [&::-webkit-details-marker]:hidden ${rail ? 'justify-center' : ''}`}>
            <Settings2 className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            {!rail && <><span>Settings</span><ChevronDown className="ml-auto h-4 w-4" aria-hidden="true" /></>}
          </summary>
          <div role="menu" aria-label="Settings" className="absolute bottom-full left-1 z-50 mb-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-md">
            {settingsItems.map((item) => <button key={item.view} type="button" role="menuitem" onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open');
              handleNavigate(item.view);
            }} className="flex h-9 w-full items-center rounded-md px-3 text-left text-[13px] text-text hover:bg-hover">
              {item.name.en}
            </button>)}
          </div>
        </details>
        <button type="button" onClick={toggleRail} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-[13px] text-text-3 hover:bg-hover hover:text-text md:flex">
          {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" /> : <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />}
          {!rail && <span>Collapse</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden md:flex shrink-0 sticky top-0 h-screen z-20">{spine}</div>
      {isMobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-[60] flex" role="dialog" aria-modal="true" aria-label="Sections">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Close navigation"
          />
          <div className="relative z-10 ll-lift">{spine}</div>
        </div>
      )}
    </>
  );
}
