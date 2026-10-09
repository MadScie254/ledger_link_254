import { Banknote, FileText, HandCoins, House, Menu, Plus, ReceiptText, Settings2, Users } from 'lucide-react';
import { useAppStore } from '../../store';
import { editionDefinition, navigationGroupsFor } from '../../utils/editions';

const PRIMARY_DESTINATIONS = [
  { view: 'Home / Dashboard', label: 'Home', icon: House },
  { view: 'Sales', label: 'Sales', icon: FileText },
  { view: 'Expenses & Bills', label: 'Bills', icon: ReceiptText },
] as const;

/** An edition's daily jobs, in tab order; its other sections stay in More. */
const EDITION_PRIMARY: Partial<Record<string, string[]>> = {
  church: ['Home / Dashboard', 'Church / Giving', 'Church / Cash count', 'Church / Members'],
};
const rank = (preferred: string[], view: string) => {
  const index = preferred.indexOf(view);
  return index === -1 ? preferred.length : index;
};

/** Thumb-reachable navigation for the four daily jobs; the full index stays in More. */
export function MobileTabBar() {
  const { activeView, setActiveView, setMobileSidebarOpen, setNewMenuOpen, activeCompany } = useAppStore();
  const edition = editionDefinition(activeCompany?.edition);
  const preferred = EDITION_PRIMARY[edition.id] || [];
  const destinations = edition.id === 'business' ? PRIMARY_DESTINATIONS
    : navigationGroupsFor(activeCompany?.edition, activeCompany?.businessType, activeCompany?.role)
    .flatMap((group) => group.items)
    .filter((entry) => entry.available !== false)
    .sort((a, b) => rank(preferred, a.view) - rank(preferred, b.view))
    .slice(0, 3)
    .map((entry) => ({
      view: entry.view,
      label: entry.name.en,
      icon: entry.view === 'Home / Dashboard' ? House
        : entry.view === 'Expenses & Bills' ? ReceiptText
          : entry.view === 'Church / Giving' ? HandCoins
          : entry.view === 'Church / Members' ? Users
          : entry.view === 'Church / Cash count' ? Banknote
          : entry.view === 'Team' ? Users
            : entry.view === 'Settings' ? Settings2 : FileText,
    }));
  const primaryIsActive = destinations.some(({ view }) => view === activeView);
  const renderDestination = ({ view, label, icon: Icon }: (typeof destinations)[number]) => {
    const selected = activeView === view;
    return <li key={view}>
      <button type="button" onClick={() => setActiveView(view)} aria-current={selected ? 'page' : undefined}
        className={`relative flex h-full min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-lg text-[10.5px] ${selected ? 'font-semibold text-primary-ink' : 'text-text-2'}`}>
        <span aria-hidden="true" className={`absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary transition-opacity ${selected ? 'opacity-100' : 'opacity-0'}`} />
        <Icon className="size-[18px]" strokeWidth={selected ? 2.2 : 1.7} aria-hidden="true" />
        <span>{label}</span>
      </button>
    </li>;
  };

  return (
    <nav
      data-tour="sidebar-index"
      aria-label="Primary sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-md backdrop-blur-md md:hidden"
    >
      <ul className="grid h-16 grid-cols-5">
        {destinations.slice(0, 2).map(renderDestination)}
        <li>
          <button type="button" onClick={() => setNewMenuOpen(true)} aria-label="New"
            className="flex h-full min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold text-primary-ink">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary text-on-primary shadow-sm"><Plus className="size-5" aria-hidden="true" /></span>
            <span className="sr-only">New</span>
          </button>
        </li>
        {destinations.slice(2, 3).map(renderDestination)}
        <li>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open all sections"
            aria-current={!primaryIsActive ? 'page' : undefined}
            className={`relative flex h-full min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-lg text-[10.5px] ${
              !primaryIsActive ? 'font-semibold text-primary-ink' : 'text-text-2'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary transition-opacity ${!primaryIsActive ? 'opacity-100' : 'opacity-0'}`}
            />
            <Menu className="h-[18px] w-[18px]" strokeWidth={!primaryIsActive ? 2.2 : 1.7} aria-hidden="true" />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
