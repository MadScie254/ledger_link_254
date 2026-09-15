import {
  Home,
  Landmark,
  Users,
  Receipt,
  BookOpen,
  FileText,
  Settings,
  Clock,
  Briefcase,
  FileSignature,
  Box,
  LayoutGrid,
  Sparkles,
  ClipboardList,
  Building,
  LogOut,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store';
import { useAuth } from '../../context/AuthProvider';

const navigationGroups = [
  {
    label: 'Workspace',
    items: [
      { name: 'Home / Dashboard', icon: Home },
      { name: 'Banking', icon: Landmark },
      { name: 'Sales', icon: Users },
      { name: 'Expenses & Bills', icon: Receipt },
    ],
  },
  {
    label: 'Operations',
    items: [
      { name: 'Accounting', icon: BookOpen },
      { name: 'Payroll', icon: Briefcase },
      { name: 'Tax', icon: FileSignature },
      { name: 'Inventory', icon: Box },
      { name: 'Projects', icon: Clock },
      { name: 'Customer Hub', icon: Building },
    ],
  },
  {
    label: 'Control center',
    items: [
      { name: 'Reports', icon: FileText },
      { name: 'Team', icon: Users },
      { name: 'Audit Logs', icon: ClipboardList },
      { name: 'Apps / Integrations', icon: LayoutGrid },
      { name: 'Business Feed', icon: Sparkles },
      { name: 'Settings', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const {
    activeView,
    setActiveView,
    activeCompany,
    isMobileSidebarOpen,
    setMobileSidebarOpen,
  } = useAppStore();
  const { user, signOut } = useAuth();

  const userEmail = user?.email || '';
  const userInitials = userEmail ? userEmail.slice(0, 2).toUpperCase() : '??';

  const handleNavigate = (viewName: string) => {
    setActiveView(viewName);
    setMobileSidebarOpen(false);
  };

  const sidebarContent = (
    <div className="w-[17.25rem] bg-sidebar-bg text-sidebar-ink flex flex-col h-full min-h-screen border-r border-white/[0.08] shrink-0 shadow-[12px_0_36px_rgba(5,12,28,0.14)]">
      <div className="h-[4.75rem] flex items-center justify-between px-5 border-b border-white/[0.08] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-brass-500 flex items-center justify-center text-ink-900 font-bold font-serif text-[11px] shadow-[0_7px_18px_rgba(244,181,74,0.24)]">
            LL
          </div>
          <div>
            <span className="block text-[15px] font-serif font-semibold tracking-[0.01em] text-white leading-none">LedgerLink</span>
            <span className="block mt-1 text-[9px] uppercase tracking-[0.12em] text-sidebar-muted">Accounting workspace</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(false)}
          className="md:hidden p-1.5 text-sidebar-muted hover:text-white hover:bg-white/10 rounded-lg"
          title="Close navigation menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-4 py-4 border-b border-white/[0.06] bg-white/[0.015]">
        <button
          onClick={() => handleNavigate('Settings')}
          className="w-full flex items-center justify-between gap-2 p-3 rounded-xl bg-white/[0.055] hover:bg-white/[0.10] ring-1 ring-white/[0.06] transition-all duration-200 text-left"
          title="Click to manage companies in Settings"
        >
          <div className="min-w-0 pr-2">
            <span className="text-[9px] text-sidebar-muted font-mono uppercase tracking-[0.14em] block">Active workspace</span>
            <p className="mt-1 text-xs font-semibold text-white truncate">{activeCompany?.name || 'No company selected'}</p>
          </div>
          <span className="text-[10px] font-mono px-2 py-1 rounded-lg bg-brass-500/15 text-brass-500 font-bold shrink-0">
            {activeCompany?.baseCurrency || 'KES'}
          </span>
        </button>
      </div>

      <nav aria-label="Primary navigation" className="px-3 py-4 flex-1 space-y-5 overflow-y-auto">
        {navigationGroups.map((group) => (
          <section key={group.label}>
            <h2 className="text-[9px] font-semibold text-sidebar-muted uppercase tracking-[0.16em] mb-2 px-3">{group.label}</h2>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = activeView === item.name;
                return (
                  <button
                    key={item.name}
                    onClick={() => handleNavigate(item.name)}
                    className={`w-full group flex items-center px-3 py-2.5 text-[13px] font-medium rounded-xl transition-all duration-200 ${
                      isActive
                        ? 'bg-white/[0.12] text-white shadow-[0_6px_16px_rgba(0,0,0,0.12)]'
                        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    <span className={`mr-3 flex h-6 w-6 items-center justify-center rounded-lg transition-colors ${isActive ? 'bg-brass-500 text-ink-900' : 'text-sidebar-muted group-hover:text-white group-hover:bg-white/[0.08]'}`}>
                      <item.icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="truncate">{item.name}</span>
                    {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brass-500" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="p-4 border-t border-white/[0.08] shrink-0">
        <div className="flex items-center rounded-xl bg-white/[0.035] p-2.5">
          <div className="h-8 w-8 rounded-lg bg-brass-500 flex items-center justify-center text-ink-900 text-xs font-bold shrink-0">
            {userInitials}
          </div>
          <div className="ml-2.5 truncate">
            <p className="text-xs font-semibold text-white truncate">{userEmail || 'Signed in'}</p>
            <p className="mt-0.5 text-[10px] font-medium text-sidebar-muted truncate">Signed in</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="ml-auto p-1.5 text-sidebar-muted transition-colors hover:bg-white/[0.07] hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden md:flex shrink-0 sticky top-0 h-screen">{sidebarContent}</div>
      {isMobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-[60] flex">
          <button
            type="button"
            className="absolute inset-0 bg-ink-900/55 backdrop-blur-[2px]"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Close navigation menu"
          />
          <div className="relative z-10 shadow-2xl animate-in slide-in-from-left duration-200">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
