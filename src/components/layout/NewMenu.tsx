import { useEffect } from 'react';
import { Dialog } from '../ledger/Dialog';
import { useAppStore, type CreateIntent } from '../../store';
import { navigationGroupsFor } from '../../utils/editions';

const columns: { title: string; actions: { label: string; view: string; intent: CreateIntent }[] }[] = [
  { title: 'Customers', actions: [
    { label: 'Invoice', view: 'Sales', intent: 'invoice' },
    { label: 'Receive payment', view: 'Sales', intent: 'payment' },
    { label: 'Estimate', view: 'Sales', intent: 'estimate' },
    { label: 'Sales receipt', view: 'Sales', intent: 'salesReceipt' },
    { label: 'Credit note', view: 'Sales', intent: 'creditNote' },
  ] },
  { title: 'Suppliers', actions: [
    { label: 'Bill', view: 'Expenses & Bills', intent: 'bill' },
    { label: 'Pay bills', view: 'Expenses & Bills', intent: 'payBills' },
    { label: 'Expense', view: 'Expenses & Bills', intent: 'expense' },
    { label: 'Purchase order', view: 'Expenses & Bills', intent: 'purchaseOrder' },
    { label: 'Supplier credit', view: 'Expenses & Bills', intent: 'supplierCredit' },
  ] },
  { title: 'Team', actions: [
    { label: 'Payroll run', view: 'Payroll', intent: 'payrollRun' },
    { label: 'Employee', view: 'Payroll', intent: 'employee' },
    { label: 'Time entry', view: 'Projects', intent: 'timeEntry' },
  ] },
  { title: 'Other', actions: [
    { label: 'Transfer', view: 'Banking', intent: 'transfer' },
    { label: 'Journal entry', view: 'Accounting', intent: 'journalEntry' },
    { label: 'Stock count', view: 'Inventory', intent: 'stockCount' },
    { label: 'Import a statement', view: 'Banking', intent: 'importStatement' },
  ] },
];

export function NewMenu() {
  const { activeCompany, isNewMenuOpen, setNewMenuOpen, setActiveView, setCreateIntent, setMobileSidebarOpen } = useAppStore();
  const reachable = new Set(navigationGroupsFor(activeCompany?.edition, activeCompany?.businessType, activeCompany?.role)
    .flatMap((group) => group.items).filter((item) => item.available !== false).map((item) => item.view));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== 'n') return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if (!activeCompany) return;
      event.preventDefault();
      setNewMenuOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeCompany, setNewMenuOpen]);

  const choose = (view: string, intent: CreateIntent) => {
    setCreateIntent(intent);
    setActiveView(view);
    setNewMenuOpen(false);
    setMobileSidebarOpen(false);
  };

  return (
    <Dialog open={isNewMenuOpen} onClose={() => setNewMenuOpen(false)} title="New" note="Choose what to record" width="xl">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {columns.map((column) => {
          const actions = column.actions.filter((action) => reachable.has(action.view));
          if (!actions.length) return null;
          return (
            <section key={column.title} aria-label={column.title}>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">{column.title}</h3>
              <div className="space-y-1">
                {actions.map((action) => (
                  <button key={action.intent} type="button" onClick={() => choose(action.view, action.intent)}
                    className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-[14px] text-text hover:bg-primary-soft hover:text-primary-ink">
                    {action.label}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
