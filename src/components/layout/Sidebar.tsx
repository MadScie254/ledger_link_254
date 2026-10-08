import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../store';
import { useAuth } from '../../context/AuthProvider';
import { CompanyMark } from '../ledger/CompanyMark';
import { BrandMark } from '../ledger/BrandMark';
import { editionDefinition, navigationGroupsFor } from '../../utils/editions';

/**
 * The spine of the book. Sections read as a printed thumb index: plain words,
 * no icons, and the open section pulled out as a paper tab that runs straight
 * into the page. `view` values are the store's view keys and must not change.
 * Keyboard shortcuts live in the command palette, not on the spine, where
 * stray digits read as unread counts.
 */
export function Sidebar() {
  const { activeView, setActiveView, activeCompany, isMobileSidebarOpen, setMobileSidebarOpen } = useAppStore();
  const { user, signOut } = useAuth();

  const edition = editionDefinition(activeCompany?.edition);
  const groups = useMemo(
    () => navigationGroupsFor(activeCompany?.edition, activeCompany?.businessType, activeCompany?.role),
    [activeCompany?.edition, activeCompany?.businessType, activeCompany?.role],
  );

  const handleNavigate = (view: string) => {
    setActiveView(view);
    setMobileSidebarOpen(false);
  };

  const spine = (
    <div className="ll-cloth w-[14.5rem] text-sidebar-ink flex flex-col h-full min-h-screen shrink-0">
      <div className="px-4 pt-5 pb-4 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => handleNavigate('Settings')}
            className="group block w-full text-left border border-[var(--spine-rule)] p-[3px] focus-visible:outline-sidebar-ink"
            aria-label={`${edition.brandName}, book of ${activeCompany?.name || 'no organization'}. Open organization settings`}
          >
            <span className="block border border-[var(--spine-rule)] px-3 py-2.5 group-hover:bg-sidebar-surface">
              <span className="flex items-center gap-1.5">
                <BrandMark className="h-4 w-4 shrink-0" />
                <span className="ll-printed text-[15px] tracking-[0.14em] text-sidebar-ink leading-none">{edition.brandName}</span>
              </span>
              {edition.poweredBy && <span className="mt-1 block text-[9px] text-sidebar-muted">powered by Ledger Link</span>}
              <span className="mt-2 flex items-center gap-2">
                <CompanyMark name={activeCompany?.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-sidebar-muted">
                  {activeCompany?.name || 'No organization'}
                </span>
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="md:hidden -mr-1 mt-1 p-1.5 text-sidebar-muted hover:text-sidebar-ink"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <nav data-tour="sidebar-index" aria-label="Sections" className="flex-1 overflow-y-auto pb-4">
        {groups.map((group) => (
          <section key={group.label.en} className="mt-3 first:mt-1">
            <h2 className="px-4 pb-1.5 ll-printed text-[10.5px] text-sidebar-muted">{group.label.en}</h2>
            <ul>
              {group.items.map((item) => {
                const isOpen = activeView === item.view;
                return (
                  <li key={item.view}>
                    {item.available === false ? (
                      <span className="flex h-9 items-center justify-between pl-4 pr-3 text-[13.5px] text-sidebar-muted" aria-disabled="true">
                        <span className="truncate">{item.name.en}</span>
                        <span className="ml-2 text-[10px]">Planned</span>
                      </span>
                    ) : (
                    <button
                      type="button"
                      onClick={() => handleNavigate(item.view)}
                      aria-current={isOpen ? 'page' : undefined}
                      className={`relative w-full flex items-center justify-between pl-4 pr-3 h-9 text-left text-[13.5px] focus-visible:outline-offset-[-2px] ${
                        isOpen
                          ? 'bg-paper-50 text-ink-900 font-semibold md:-mr-px md:w-[calc(100%+1px)]'
                          : 'text-sidebar-ink/90 hover:bg-sidebar-surface hover:text-sidebar-ink'
                      }`}
                    >
                      <span className="truncate">{item.name.en}</span>
                    </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>

      <div className="px-4 py-3.5 shrink-0 border-t border-[var(--spine-rule)]">
        <p className="text-[11px] text-sidebar-muted">Signed in as</p>
        <p className="mt-0.5 text-[12.5px] text-sidebar-ink truncate">
          {user?.user_metadata?.full_name || user?.email || 'Signed-in account'}
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-2 text-[12.5px] text-sidebar-muted underline underline-offset-[3px] decoration-[var(--spine-rule)] hover:text-sidebar-ink hover:decoration-current"
        >
          Sign out
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
