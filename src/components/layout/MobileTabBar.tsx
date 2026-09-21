import { FileText, House, Landmark, Menu, ReceiptText } from 'lucide-react';
import { useAppStore } from '../../store';

const PRIMARY_DESTINATIONS = [
  { view: 'Home / Dashboard', label: 'Home', icon: House },
  { view: 'Sales', label: 'Sales', icon: FileText },
  { view: 'Banking', label: 'Banking', icon: Landmark },
  { view: 'Expenses & Bills', label: 'Bills', icon: ReceiptText },
] as const;

/** Thumb-reachable navigation for the four daily jobs; the full index stays in More. */
export function MobileTabBar() {
  const { activeView, setActiveView, setMobileSidebarOpen } = useAppStore();
  const primaryIsActive = PRIMARY_DESTINATIONS.some(({ view }) => view === activeView);

  return (
    <nav
      data-tour="sidebar-index"
      aria-label="Primary sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-feint-strong bg-paper-100/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_28px_rgba(25,22,18,0.08)] backdrop-blur-md md:hidden"
    >
      <ul className="grid h-14 grid-cols-5">
        {PRIMARY_DESTINATIONS.map(({ view, label, icon: Icon }) => {
          const selected = activeView === view;
          return (
            <li key={view}>
              <button
                type="button"
                onClick={() => setActiveView(view)}
                aria-current={selected ? 'page' : undefined}
                className={`relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10.5px] ${
                  selected ? 'font-semibold text-oxblood' : 'text-graphite-600'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-4 top-0 h-0.5 bg-oxblood transition-opacity ${selected ? 'opacity-100' : 'opacity-0'}`}
                />
                <Icon className="h-[18px] w-[18px]" strokeWidth={selected ? 2.2 : 1.7} aria-hidden="true" />
                <span>{label}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open all sections"
            aria-current={!primaryIsActive ? 'page' : undefined}
            className={`relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10.5px] ${
              !primaryIsActive ? 'font-semibold text-oxblood' : 'text-graphite-600'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute inset-x-4 top-0 h-0.5 bg-oxblood transition-opacity ${!primaryIsActive ? 'opacity-100' : 'opacity-0'}`}
            />
            <Menu className="h-[18px] w-[18px]" strokeWidth={!primaryIsActive ? 2.2 : 1.7} aria-hidden="true" />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
