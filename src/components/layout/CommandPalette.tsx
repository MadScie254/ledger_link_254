import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { Amount } from '../ledger/Amount';

type Section = 'Pages' | 'Reports' | 'Invoices' | 'Bills' | 'Customers' | 'Vendors' | 'Stock' | 'Accounts';

interface SearchItem {
  id: string;
  title: string;
  subtitle?: string;
  category: Section;
  /** A figure printed at the right of the row, in the base currency. */
  cents?: number;
  shortcut?: string;
  action: () => void;
}

/** Pages under the names the sidebar gives them, with the same number keys App.tsx listens for. */
const PAGES: { view: string; title: string; subtitle: string; shortcut?: string }[] = [
  { view: 'Home / Dashboard', title: 'Home', subtitle: 'Cash, what is owed and what is due', shortcut: '1' },
  { view: 'Banking', title: 'Banking', subtitle: 'Statement lines, matches and rules', shortcut: '4' },
  { view: 'Sales', title: 'Sales', subtitle: 'Invoices and what customers owe', shortcut: '2' },
  { view: 'Customer Hub', title: 'Customers', subtitle: 'Customer records and balances' },
  { view: 'Expenses & Bills', title: 'Bills and expenses', subtitle: 'Supplier bills, receipts and payments', shortcut: '3' },
  { view: 'Accounting', title: 'Accounting', subtitle: 'Chart of accounts, journal entries and budgets', shortcut: '5' },
  { view: 'Reports', title: 'Reports', subtitle: 'Statements, ledgers and tax summaries', shortcut: '6' },
  { view: 'Tax', title: 'Tax', subtitle: 'VAT position, eTIMS and the filing calendar' },
  { view: 'Payroll', title: 'Payroll', subtitle: 'Employees, pay runs and statutory returns' },
  { view: 'Inventory', title: 'Inventory', subtitle: 'Stock items and reorder points' },
  { view: 'Projects', title: 'Projects', subtitle: 'Budget against cost, and hours logged' },
  { view: 'Business Feed', title: 'Business feed', subtitle: 'Questions about the books' },
  { view: 'Team', title: 'Team', subtitle: 'Who can open these books' },
  { view: 'Apps / Integrations', title: 'Integrations', subtitle: 'Connections that are and are not built' },
  { view: 'Audit Logs', title: 'Audit log', subtitle: 'Every change to accounts, entries and the team' },
  { view: 'Documentation', title: 'Documentation', subtitle: 'Tutorials, troubleshooting and technical runbooks' },
  { view: 'Settings', title: 'Settings', subtitle: 'Companies, currencies and security' },
  { view: 'System Health', title: 'System health', subtitle: 'Response and render times in this browser' },
];

const REPORTS: { title: string; subtitle: string }[] = [
  { title: 'Profit and loss', subtitle: 'Sales less cost of sales and expenses' },
  { title: 'Balance sheet', subtitle: 'Assets, liabilities and equity' },
  { title: 'Cash flow statement', subtitle: 'Operating, investing and financing' },
  { title: 'General ledger', subtitle: 'Every line posted to one account' },
  { title: 'Trial balance', subtitle: 'Every account, debits against credits' },
  { title: 'VAT and eTIMS summary', subtitle: 'Output and input VAT for the period' },
  { title: 'Receivables by age', subtitle: 'What customers owe, by how late' },
  { title: 'Payables by age', subtitle: 'What the business owes, by how late' },
];

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { setActiveView, isCommandPaletteOpen, setCommandPaletteOpen, currentOrgId, activeCompany } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Global keyboard listener (Ctrl+K / Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCommandPaletteOpen, setCommandPaletteOpen]);

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isCommandPaletteOpen]);

  const listQuery = (key: string, path: string, field: string) => ({
    queryKey: [key, currentOrgId],
    queryFn: async () => {
      const res = await fetch(path, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { [field]: [] };
      return res.json();
    },
    enabled: isCommandPaletteOpen && Boolean(currentOrgId),
  });

  const { data: invoicesData } = useQuery(listQuery('invoices', '/api/invoices', 'invoices'));
  const { data: customersData } = useQuery(listQuery('customers', '/api/customers', 'customers'));
  const { data: vendorsData } = useQuery(listQuery('vendors', '/api/vendors', 'vendors'));
  const { data: itemsData } = useQuery(listQuery('inventory', '/api/inventory', 'items'));
  const { data: billsData } = useQuery(listQuery('bills', '/api/bills', 'bills'));
  const { data: accountsData } = useQuery(listQuery('accounts', '/api/accounts', 'accounts'));

  const allItems: SearchItem[] = useMemo(() => {
    const go = (view: string) => () => {
      setActiveView(view);
      setCommandPaletteOpen(false);
    };
    const customerNames = new Map<string, string>((customersData?.customers || []).map((c: any) => [c.id, c.displayName || c.name]));
    const vendorNames = new Map<string, string>((vendorsData?.vendors || []).map((v: any) => [v.id, v.displayName || v.name]));

    const items: SearchItem[] = [
      ...PAGES.map((p) => ({ id: `page-${p.view}`, title: p.title, subtitle: p.subtitle, category: 'Pages' as const, shortcut: p.shortcut, action: go(p.view) })),
      ...REPORTS.map((r) => ({ id: `report-${r.title}`, title: r.title, subtitle: r.subtitle, category: 'Reports' as const, action: go('Reports') })),
    ];

    (invoicesData?.invoices || []).forEach((inv: any) => {
      items.push({
        id: `inv-${inv.id}`,
        title: inv.invoiceNo || inv.invoiceNumber || 'Invoice',
        subtitle: customerNames.get(inv.customerId) || undefined,
        category: 'Invoices',
        cents: inv.totalCents || 0,
        action: go('Sales'),
      });
    });

    (billsData?.bills || []).forEach((b: any) => {
      items.push({
        id: `bill-${b.id}`,
        title: b.billNumber || 'Bill',
        subtitle: vendorNames.get(b.vendorId) || undefined,
        category: 'Bills',
        cents: b.totalCents || 0,
        action: go('Expenses & Bills'),
      });
    });

    (customersData?.customers || []).forEach((c: any) => {
      items.push({
        id: `cust-${c.id}`,
        title: c.displayName || c.name || 'Customer',
        subtitle: [c.email, c.phone].filter(Boolean).join(' · ') || undefined,
        category: 'Customers',
        action: go('Customer Hub'),
      });
    });

    (vendorsData?.vendors || []).forEach((v: any) => {
      items.push({
        id: `vend-${v.id}`,
        title: v.displayName || v.name || 'Vendor',
        subtitle: [v.kraPin && `KRA PIN ${v.kraPin}`, v.email].filter(Boolean).join(' · ') || undefined,
        category: 'Vendors',
        action: go('Expenses & Bills'),
      });
    });

    (itemsData?.items || []).forEach((item: any) => {
      items.push({
        id: `item-${item.id}`,
        title: item.name || 'Stock item',
        subtitle: `${item.sku ? `${item.sku} · ` : ''}${item.quantityOnHand ?? 0} on hand`,
        category: 'Stock',
        action: go('Inventory'),
      });
    });

    (accountsData?.accounts || []).forEach((acc: any) => {
      items.push({
        id: `acc-${acc.id}`,
        title: `${acc.code} ${acc.name}`,
        subtitle: acc.type ? acc.type.charAt(0) + acc.type.slice(1).toLowerCase() : undefined,
        category: 'Accounts',
        action: go('Accounting'),
      });
    });

    return items;
  }, [invoicesData, customersData, vendorsData, itemsData, billsData, accountsData, setActiveView, setCommandPaletteOpen]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems.filter((i) => i.category === 'Pages');

    const q = query.toLowerCase();
    return allItems
      .map((item) => {
        let score = 0;
        const title = item.title.toLowerCase();
        if (title === q) score += 100;
        else if (title.startsWith(q)) score += 50;
        else if (title.includes(q)) score += 30;
        if ((item.subtitle || '').toLowerCase().includes(q)) score += 15;
        if (item.category.toLowerCase().includes(q)) score += 10;
        return { item, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.item)
      .slice(0, 30);
  }, [allItems, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < filteredItems.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filteredItems[selectedIndex]?.action();
    } else if (e.key === 'Escape') {
      setCommandPaletteOpen(false);
    }
  };

  useEffect(() => {
    const activeEl = listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isCommandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-3 pt-14 sm:px-4 sm:pt-24">
      <div className="fixed inset-0 bg-black/45" onClick={() => setCommandPaletteOpen(false)} aria-hidden="true" />

      <div className="ll-lift relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col border border-feint-strong border-t-2 border-t-ink-900 bg-paper-100" role="dialog" aria-modal="true" aria-label="Find">
        <div className="flex items-center gap-3 border-b border-feint px-4 py-2.5">
          <Search className="h-5 w-5 shrink-0 text-graphite-600" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="find-results"
            aria-activedescendant={filteredItems[selectedIndex] ? `find-${filteredItems[selectedIndex].id}` : undefined}
            aria-label="Find a page, customer, invoice or account"
            className="h-9 w-full border-0 bg-transparent text-[15px] text-ink-900 outline-none focus:ring-0"
            placeholder="Find a page, customer, invoice or account"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="hidden shrink-0 border border-field px-1.5 py-0.5 text-[11px] text-graphite-600 sm:inline">Esc</kbd>
        </div>

        <ul ref={listRef} id="find-results" role="listbox" className="overflow-y-auto">
          {filteredItems.length === 0 ? (
            <li className="px-5 py-10 text-center">
              <p className="text-[14px] text-ink-900">Nothing found for “{query}”.</p>
              <p className="mt-1 text-[12.5px] text-graphite-600">Try a customer name, an invoice number such as INV-2026-0041, or an account code.</p>
            </li>
          ) : (
            filteredItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              const startsSection = index === 0 || filteredItems[index - 1].category !== item.category;
              return (
                <React.Fragment key={item.id}>
                  {startsSection && (
                    <li role="presentation" className="border-b border-ink-900 px-4 pb-1 pt-3">
                      <span className="ll-printed text-[10.5px] text-graphite-600">{item.category}</span>
                    </li>
                  )}
                  <li
                    id={`find-${item.id}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => item.action()}
                    className={`flex cursor-pointer items-baseline justify-between gap-3 border-b border-feint px-4 py-2.5 ${isSelected ? 'bg-paper-200' : ''}`}
                  >
                    <div className="min-w-0">
                      <p className={`truncate text-[14px] text-ink-900 ${isSelected ? 'font-semibold' : ''}`}>{item.title}</p>
                      {item.subtitle && <p className="truncate text-[12.5px] text-graphite-600">{item.subtitle}</p>}
                    </div>
                    <div className="flex shrink-0 items-baseline gap-3">
                      {item.cents !== undefined && <Amount cents={item.cents} currency={baseCurrency} size="sm" tone="ink" />}
                      {item.shortcut && <kbd className="hidden border border-field px-1.5 py-0.5 text-[10.5px] text-graphite-600 sm:inline">{item.shortcut}</kbd>}
                    </div>
                  </li>
                </React.Fragment>
              );
            })
          )}
        </ul>

        <div className="border-t border-feint px-4 py-2 text-[11.5px] text-graphite-600">
          <span className="sm:hidden">Tap a result to open it</span>
          <div className="hidden items-center gap-4 sm:flex">
            <span>
              <kbd className="border border-field px-1">↑</kbd> <kbd className="border border-field px-1">↓</kbd> to move
            </span>
            <span>
              <kbd className="border border-field px-1">Enter</kbd> to open
            </span>
            <span>Number keys open pages from anywhere</span>
          </div>
        </div>
      </div>
    </div>
  );
}
