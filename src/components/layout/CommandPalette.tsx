import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Search, 
  FileText, 
  Users, 
  Building2, 
  Package, 
  CreditCard, 
  Receipt, 
  PieChart, 
  Sliders, 
  ArrowRight, 
  Sparkles, 
  Plus, 
  FolderGit2, 
  ShieldCheck, 
  Activity,
  DollarSign
} from 'lucide-react';
import { useAppStore } from '../../store';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '../../utils/currency';

interface SearchItem {
  id: string;
  title: string;
  subtitle?: string;
  category: 'Views & Tools' | 'Invoices & Sales' | 'Customers' | 'Vendors & Bills' | 'Inventory Items' | 'Accounts' | 'Reports' | 'Actions';
  icon: React.ElementType;
  shortcut?: string;
  badge?: string;
  action: () => void;
}

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { setActiveView, isCommandPaletteOpen, setCommandPaletteOpen, currentOrgId } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Global Keyboard Listener (Cmd+K / Ctrl+K)
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

  // Focus input when opened
  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isCommandPaletteOpen]);

  // Fetch dynamic entities for live search
  const { data: invoicesData } = useQuery({
    queryKey: ['invoices', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/invoices', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { invoices: [] };
      return res.json();
    },
    enabled: isCommandPaletteOpen,
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/customers', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { customers: [] };
      return res.json();
    },
    enabled: isCommandPaletteOpen,
  });

  const { data: vendorsData } = useQuery({
    queryKey: ['vendors', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/vendors', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { vendors: [] };
      return res.json();
    },
    enabled: isCommandPaletteOpen,
  });

  const { data: itemsData } = useQuery({
    queryKey: ['items', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/items', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { items: [] };
      return res.json();
    },
    enabled: isCommandPaletteOpen,
  });

  const { data: billsData } = useQuery({
    queryKey: ['bills', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/bills', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { bills: [] };
      return res.json();
    },
    enabled: isCommandPaletteOpen,
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { accounts: [] };
      return res.json();
    },
    enabled: isCommandPaletteOpen,
  });

  // Build searchable items list
  const allItems: SearchItem[] = useMemo(() => {
    const items: SearchItem[] = [
      // Views & Modules
      {
        id: 'view-dashboard',
        title: 'Home / Dashboard',
        subtitle: 'Executive KPIs, Cash Flow & Financial Health',
        category: 'Views & Tools',
        icon: Sliders,
        shortcut: '1',
        action: () => { setActiveView('Home / Dashboard'); setCommandPaletteOpen(false); }
      },
      {
        id: 'view-sales',
        title: 'Sales & Invoicing',
        subtitle: 'Customer Invoices, Recurring Billing & Quotes',
        category: 'Views & Tools',
        icon: FileText,
        shortcut: '2',
        action: () => { setActiveView('Sales'); setCommandPaletteOpen(false); }
      },
      {
        id: 'view-expenses',
        title: 'Expenses & Bills',
        subtitle: 'Vendor Invoices, Receipts & Operational Costs',
        category: 'Views & Tools',
        icon: Receipt,
        shortcut: '3',
        action: () => { setActiveView('Expenses & Bills'); setCommandPaletteOpen(false); }
      },
      {
        id: 'view-banking',
        title: 'Banking & M-Pesa Feed',
        subtitle: 'Bank Feeds, AI Reconciliations & Rule Categorization',
        category: 'Views & Tools',
        icon: CreditCard,
        shortcut: '4',
        action: () => { setActiveView('Banking'); setCommandPaletteOpen(false); }
      },
      {
        id: 'view-accounting',
        title: 'Accounting & Journal Entries',
        subtitle: 'General Ledger, Chart of Accounts & Trial Balances',
        category: 'Views & Tools',
        icon: FolderGit2,
        shortcut: '5',
        action: () => { setActiveView('Accounting'); setCommandPaletteOpen(false); }
      },
      {
        id: 'view-reports',
        title: 'Reports & Statements',
        subtitle: 'Balance Sheet, P&L, Cash Flow, Tax Summary',
        category: 'Views & Tools',
        icon: PieChart,
        shortcut: '6',
        action: () => { setActiveView('Reports'); setCommandPaletteOpen(false); }
      },
      {
        id: 'view-customers',
        title: 'Customer Hub (CRM)',
        subtitle: 'Client Profiles, Credit Limits & Interaction Logs',
        category: 'Views & Tools',
        icon: Users,
        action: () => { setActiveView('Customer Hub'); setCommandPaletteOpen(false); }
      },
      {
        id: 'view-inventory',
        title: 'Inventory & Stock Control',
        subtitle: 'Product Catalogue, Reorder Triggers & Stock Valuation',
        category: 'Views & Tools',
        icon: Package,
        action: () => { setActiveView('Inventory'); setCommandPaletteOpen(false); }
      },
      {
        id: 'view-audit',
        title: 'Audit Logs & Governance',
        subtitle: 'Immutable Ledger Activity & Telemetry Tracker',
        category: 'Views & Tools',
        icon: ShieldCheck,
        action: () => { setActiveView('Audit Logs'); setCommandPaletteOpen(false); }
      },
      {
        id: 'view-health',
        title: 'System Health & Integrations',
        subtitle: 'WebSocket status, API endpoints & sync latencies',
        category: 'Views & Tools',
        icon: Activity,
        action: () => { setActiveView('System Health'); setCommandPaletteOpen(false); }
      },

      // Financial Reports
      {
        id: 'rep-pnl',
        title: 'Profit & Loss Statement (Income Statement)',
        subtitle: 'Revenue, COGS, Gross Margin & Net Operating Income',
        category: 'Reports',
        icon: PieChart,
        badge: 'PDF Ready',
        action: () => { setActiveView('Reports'); setCommandPaletteOpen(false); }
      },
      {
        id: 'rep-bs',
        title: 'Balance Sheet (Statement of Financial Position)',
        subtitle: 'Current Assets, Non-Current Liabilities & Total Equity',
        category: 'Reports',
        icon: PieChart,
        badge: 'PDF Ready',
        action: () => { setActiveView('Reports'); setCommandPaletteOpen(false); }
      },
      {
        id: 'rep-cf',
        title: 'Cash Flow Statement',
        subtitle: 'Operating, Investing & Financing Cash Movements',
        category: 'Reports',
        icon: DollarSign,
        badge: 'PDF Ready',
        action: () => { setActiveView('Reports'); setCommandPaletteOpen(false); }
      },
      {
        id: 'rep-tb',
        title: 'Trial Balance',
        subtitle: 'Pre-Closing Debit & Credit Verification Ledger',
        category: 'Reports',
        icon: FolderGit2,
        badge: 'PDF Ready',
        action: () => { setActiveView('Reports'); setCommandPaletteOpen(false); }
      },
      {
        id: 'rep-tax',
        title: 'Tax Summary & KRA Withholding Statement',
        subtitle: '16% Output VAT, 2% WH VAT & Digital Service Tax',
        category: 'Reports',
        icon: ShieldCheck,
        badge: 'PDF Ready',
        action: () => { setActiveView('Reports'); setCommandPaletteOpen(false); }
      },
    ];

    // Invoices
    if (invoicesData?.invoices) {
      invoicesData.invoices.forEach((inv: any) => {
        items.push({
          id: `inv-${inv.id}`,
          title: `Invoice #${inv.invoiceNumber || inv.id.substring(0, 8)}`,
          subtitle: `${inv.customerName || 'Customer'} • KES ${formatCurrency(inv.totalCents || 0)} • Status: ${inv.status}`,
          category: 'Invoices & Sales',
          icon: FileText,
          badge: inv.status,
          action: () => {
            setActiveView('Sales');
            setCommandPaletteOpen(false);
          }
        });
      });
    }

    // Customers
    if (customersData?.customers) {
      customersData.customers.forEach((c: any) => {
        items.push({
          id: `cust-${c.id}`,
          title: c.name,
          subtitle: `${c.email || 'No email'} • Phone: ${c.phone || 'N/A'} • Status: ${c.status || 'ACTIVE'}`,
          category: 'Customers',
          icon: Users,
          badge: c.status || 'ACTIVE',
          action: () => {
            setActiveView('Customer Hub');
            setCommandPaletteOpen(false);
          }
        });
      });
    }

    // Vendors
    if (vendorsData?.vendors) {
      vendorsData.vendors.forEach((v: any) => {
        items.push({
          id: `vend-${v.id}`,
          title: v.name,
          subtitle: `${v.category || 'Vendor'} • PIN: ${v.taxPin || 'N/A'} • Payment Terms: ${v.paymentTerms || 'Net 30'}`,
          category: 'Vendors & Bills',
          icon: Building2,
          action: () => {
            setActiveView('Expenses & Bills');
            setCommandPaletteOpen(false);
          }
        });
      });
    }

    // Bills
    if (billsData?.bills) {
      billsData.bills.forEach((b: any) => {
        items.push({
          id: `bill-${b.id}`,
          title: `Bill #${b.billNumber || b.id.substring(0, 8)}`,
          subtitle: `${b.vendorName || 'Vendor'} • KES ${formatCurrency(b.totalCents || 0)} • Status: ${b.status}`,
          category: 'Vendors & Bills',
          icon: Receipt,
          badge: b.status,
          action: () => {
            setActiveView('Expenses & Bills');
            setCommandPaletteOpen(false);
          }
        });
      });
    }

    // Items
    if (itemsData?.items) {
      itemsData.items.forEach((item: any) => {
        items.push({
          id: `item-${item.id}`,
          title: item.name,
          subtitle: `SKU: ${item.sku || 'N/A'} • Price: KES ${formatCurrency(item.unitPriceCents || 0)} • Stock: ${item.stockQuantity || 0} units`,
          category: 'Inventory Items',
          icon: Package,
          action: () => {
            setActiveView('Inventory');
            setCommandPaletteOpen(false);
          }
        });
      });
    }

    // Accounts
    if (accountsData?.accounts) {
      accountsData.accounts.forEach((acc: any) => {
        items.push({
          id: `acc-${acc.id}`,
          title: `${acc.code} - ${acc.name}`,
          subtitle: `Classification: ${acc.type} • Balance: KES ${formatCurrency(acc.balanceCents || 0)}`,
          category: 'Accounts',
          icon: FolderGit2,
          badge: acc.type,
          action: () => {
            setActiveView('Accounting');
            setCommandPaletteOpen(false);
          }
        });
      });
    }

    return items;
  }, [invoicesData, customersData, vendorsData, itemsData, billsData, accountsData, setActiveView, setCommandPaletteOpen]);

  // Fuzzy Search filter & score
  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 25);

    const q = query.toLowerCase();
    const scored = allItems.map((item) => {
      let score = 0;
      const titleLower = item.title.toLowerCase();
      const subLower = (item.subtitle || '').toLowerCase();
      const catLower = item.category.toLowerCase();

      if (titleLower === q) score += 100;
      else if (titleLower.startsWith(q)) score += 50;
      else if (titleLower.includes(q)) score += 30;

      if (subLower.includes(q)) score += 15;
      if (catLower.includes(q)) score += 10;

      // Character match bonus
      let charIdx = 0;
      let matchedCount = 0;
      for (const char of q) {
        const found = titleLower.indexOf(char, charIdx);
        if (found !== -1) {
          matchedCount++;
          charIdx = found + 1;
        }
      }
      if (matchedCount === q.length) score += 10;

      return { item, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.item)
      .slice(0, 30);
  }, [allItems, query]);

  // Key navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1 < filteredItems.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 >= 0 ? prev - 1 : filteredItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
      }
    } else if (e.key === 'Escape') {
      setCommandPaletteOpen(false);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isCommandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-16 sm:pt-24 px-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-ink-900/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-150" 
        onClick={() => setCommandPaletteOpen(false)}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-2xl bg-paper-100 rounded-sm shadow-2xl overflow-hidden border border-ink-900/20 z-10 flex flex-col max-h-[80vh]">
        {/* Search Bar Header */}
        <div className="flex items-center px-4 py-3 border-b border-ink-900/10 bg-paper-50 dark:bg-[#0e1420]">
          <Search className="h-5 w-5 text-slate-400 mr-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent border-0 text-ink-900 placeholder-slate-400 focus:ring-0 sm:text-base outline-none font-medium"
            placeholder="Type a command, invoice #, customer name, or ledger code..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="hidden sm:inline-flex items-center px-2 py-1 text-[11px] font-mono font-medium text-slate-400 bg-paper-100 border border-ink-900/10 rounded-sm">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <ul 
          ref={listRef}
          className="overflow-y-auto py-2 divide-y divide-ink-900/5 text-sm"
        >
          {filteredItems.length === 0 ? (
            <li className="px-6 py-12 text-center text-slate-400">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="font-medium text-ink-900">No records found for "{query}"</p>
              <p className="text-xs text-slate-500 mt-1">Try searching by client name, invoice number (e.g. INV-100), or report type.</p>
            </li>
          ) : (
            filteredItems.map((item, index) => {
              const Icon = item.icon;
              const isSelected = index === selectedIndex;

              return (
                <li
                  key={item.id}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => item.action()}
                  className={`px-4 py-2.5 cursor-pointer transition-colors flex items-center justify-between group ${
                    isSelected 
                      ? 'bg-focus-blue-500 text-white ' 
                      : 'hover:bg-paper-50 text-ink-900'
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-0 pr-2">
                    <div className={`p-2 rounded-sm shrink-0 ${
                      isSelected 
                        ? 'bg-white/20 text-white ' 
                        : 'bg-paper-100 text-slate-600'
                    }`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className={`font-semibold truncate text-sm ${isSelected ? 'text-white ' : 'text-ink-900'}`}>
                        {item.title}
                      </p>
                      {item.subtitle && (
                        <p className={`text-xs truncate ${isSelected ? 'text-white/80 dark:text-slate-800' : 'text-slate-500'}`}>
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    {item.badge && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isSelected 
                          ? 'bg-white/30 text-white ' 
                          : 'bg-ink-900/5 text-slate-600'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                    <span className={`text-[11px] font-mono ${isSelected ? 'text-white/70' : 'text-slate-400'}`}>
                      {item.category}
                    </span>
                    {item.shortcut && (
                      <kbd className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-paper-100 text-slate-500 border border-ink-900/10'
                      }`}>
                        {item.shortcut}
                      </kbd>
                    )}
                    <ArrowRight className={`h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                      isSelected ? 'opacity-100 text-white' : 'text-slate-400'
                    }`} />
                  </div>
                </li>
              );
            })
          )}
        </ul>

        {/* Footer info */}
        <div className="px-4 py-2 border-t border-ink-900/10 bg-paper-50 dark:bg-[#0e1420] flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center space-x-4">
            <span className="flex items-center space-x-1">
              <kbd className="px-1 py-0.5 bg-paper-100 border border-ink-900/10 rounded">↑</kbd>
              <kbd className="px-1 py-0.5 bg-paper-100 border border-ink-900/10 rounded">↓</kbd>
              <span className="ml-1">Navigate</span>
            </span>
            <span className="flex items-center space-x-1">
              <kbd className="px-1.5 py-0.5 bg-paper-100 border border-ink-900/10 rounded">↵</kbd>
              <span className="ml-1">Select</span>
            </span>
          </div>
          <span className="font-mono text-slate-400">Ledgerline Global Navigation</span>
        </div>
      </div>
    </div>
  );
}
