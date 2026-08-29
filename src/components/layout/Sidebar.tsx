import {
  Home,
  Landmark,
  Users,
  Receipt,
  BookOpen,
  Calculator,
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
} from "lucide-react";
import { useAppStore } from "../../store";

const navigation = [
  { name: "Home / Dashboard", icon: Home },
  { name: "Banking", icon: Landmark },
  { name: "Sales", icon: Users },
  { name: "Expenses & Bills", icon: Receipt },
  { name: "Accounting", icon: BookOpen },
  { name: "Payroll", icon: Briefcase },
  { name: "Tax", icon: FileSignature },
  { name: "Inventory", icon: Box },
  { name: "Projects", icon: Clock },
  { name: "Customer Hub", icon: Building },
  { name: "Reports", icon: FileText },
  { name: "Team", icon: Users },
  { name: "Audit Logs", icon: ClipboardList },
  { name: "Apps / Integrations", icon: LayoutGrid },
  { name: "Business Feed", icon: Sparkles },
  { name: "Settings", icon: Settings },
];

export function Sidebar() {
  const { activeView, setActiveView, activeCompany, organizations, setActiveCompany, setCurrentOrgId, setDisplayCurrency } = useAppStore();

  return (
    <div className="w-64 bg-ink-900 dark:bg-[#0B0F19] text-paper-50 dark:text-gray-300 flex flex-col hidden md:flex min-h-screen border-r border-ink-900/10 shrink-0">
      <div className="h-16 flex items-center justify-between px-6 border-b border-white/10 shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded bg-brass-500 flex items-center justify-center text-ink-900 font-bold font-serif text-sm shadow-xs">
            LL
          </div>
          <span className="text-xl font-serif font-semibold tracking-wide text-brass-500">
            Ledger Link
          </span>
        </div>
      </div>

      <div className="px-3 py-3 border-b border-white/5 bg-white/[0.02]">
        <button
          onClick={() => setActiveView('Settings')}
          className="w-full flex items-center justify-between p-2 rounded bg-white/5 hover:bg-white/10 transition-colors text-left"
          title="Click to manage companies in Settings"
        >
          <div className="min-w-0 pr-2">
            <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block">Company</span>
            <p className="text-xs font-semibold text-white truncate">{activeCompany?.name || 'Acme Corp Ltd.'}</p>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-brass-500/20 text-brass-400 font-bold shrink-0">
            {activeCompany?.baseCurrency || 'KES'}
          </span>
        </button>
      </div>

      <div className="px-3 py-3 flex-1 space-y-0.5 overflow-y-auto">
        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 px-3">
          Navigate
        </div>
        {navigation.map((item) => {
          const isActive =
            activeView === item.name ||
            (activeView === "Accounting" && item.name === "Accounting");
          return (
            <button
              key={item.name}
              onClick={() => setActiveView(item.name)}
              className={`w-full group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? "bg-white/10 text-brass-500"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <item.icon
                className={`mr-3 shrink-0 h-5 w-5 ${
                  isActive
                    ? "text-brass-500"
                    : "text-slate-500 group-hover:text-slate-300"
                }`}
                aria-hidden="true"
              />
              {item.name}
            </button>
          );
        })}
      </div>

      <div className="p-4 border-t border-white/10 shrink-0">
        <div className="flex items-center">
          <div className="h-8 w-8 rounded-full bg-brass-500 flex items-center justify-center text-ink-900 font-bold">
            JD
          </div>
          <div className="ml-3 truncate">
            <p className="text-sm font-medium text-white truncate">John Doe</p>
            <p className="text-xs font-medium text-slate-400 truncate">{activeCompany?.name || 'Acme Corp Ltd.'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
