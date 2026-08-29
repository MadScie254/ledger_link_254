import React, { useState, useEffect } from 'react';
import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { format } from 'date-fns';
import { useRenderTracker } from '../../utils/monitoring';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend 
} from 'recharts';
import { 
  GripVertical, 
  Pin, 
  PinOff, 
  Plus, 
  RotateCcw, 
  Sliders, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  CreditCard, 
  Receipt, 
  FileText, 
  Building2, 
  ShieldAlert, 
  ArrowUpRight, 
  Check, 
  X,
  Globe,
  RefreshCw,
  Coins,
  ArrowRight
} from 'lucide-react';

interface WidgetDef {
  id: string;
  title: string;
  category: 'KPI' | 'Charts' | 'Pinned Entities';
  size: 'small' | 'medium' | 'large';
  isPinned: boolean;
}

const DEFAULT_WIDGETS: WidgetDef[] = [
  { id: 'cash-position', title: 'Cash Position (Bank & M-Pesa)', category: 'KPI', size: 'small', isPinned: true },
  { id: 'money-in', title: 'Invoices Owed to You', category: 'KPI', size: 'small', isPinned: true },
  { id: 'money-out', title: 'Bills You Owe', category: 'KPI', size: 'small', isPinned: true },
  { id: 'net-profit-kpi', title: 'Net Profit & Margins', category: 'KPI', size: 'small', isPinned: true },
  { id: 'pnl-breakdown', title: 'Profit & Loss Statement', category: 'Charts', size: 'medium', isPinned: true },
  { id: 'financial-trends', title: 'Revenue vs. Expense Trends', category: 'Charts', size: 'medium', isPinned: true },
  { id: 'unrealized-fx', title: 'Unrealized FX Gains & Losses', category: 'KPI', size: 'medium', isPinned: true },
  { id: 'high-value-invoices', title: 'High-Value Open Invoices', category: 'Pinned Entities', size: 'medium', isPinned: true },
  { id: 'top-vendors', title: 'Top Supplier Payables', category: 'Pinned Entities', size: 'medium', isPinned: true },
  { id: 'kra-tax-summary', title: 'KRA Withholding & VAT Liability', category: 'KPI', size: 'small', isPinned: false },
  { id: 'cash-runway', title: 'Estimated Runway & Burn Rate', category: 'KPI', size: 'small', isPinned: false }
];

export function DashboardView() {
  useRenderTracker("DashboardView");
  const { currentOrgId, setActiveView } = useAppStore();
  const [widgets, setWidgets] = useState<WidgetDef[]>(() => {
    try {
      const saved = localStorage.getItem(`ledgerline-dashboard-grid-${currentOrgId}`);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_WIDGETS;
  });

  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);

  // Save layout changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(`ledgerline-dashboard-grid-${currentOrgId}`, JSON.stringify(widgets));
    } catch (e) {
      console.error(e);
    }
  }, [widgets, currentOrgId]);

  // Fetch Dashboard Summary Metrics
  const { data: metricsData, isLoading: isMetricsLoading } = useQuery({
    queryKey: ['dashboard-metrics', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/metrics', {
        headers: { 'x-org-id': currentOrgId }
      });
      if (!res.ok) throw new Error('Failed to fetch metrics');
      return res.json();
    }
  });

  // Fetch Invoices for Pinned Open Invoices Widget
  const { data: invoicesData } = useQuery({
    queryKey: ['invoices', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/invoices', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { invoices: [] };
      return res.json();
    }
  });

  // Fetch Vendors for Pinned Vendor Spend Widget
  const { data: vendorsData } = useQuery({
    queryKey: ['vendors', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/vendors', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { vendors: [] };
      return res.json();
    }
  });

  // Derived Financial Values
  const cashPosition = (metricsData?.cashPositionCents || 0) / 100;
  const moneyIn = (metricsData?.moneyInCents || 0) / 100;
  const moneyOut = (metricsData?.moneyOutCents || 0) / 100;
  const totalIncome = (metricsData?.totalIncomeCents || 0) / 100;
  const totalCogs = (metricsData?.totalCogsCents || 0) / 100;
  const totalExpense = (metricsData?.totalExpenseCents || 0) / 100;
  const netProfit = (metricsData?.netProfitCents || 0) / 100;
  const overdueInvoices = metricsData?.overdueInvoices || 0;
  const overdueCents = (metricsData?.overdueCents || 0) / 100;

  // High-value open invoices
  const highValueInvoices = (invoicesData?.invoices || [])
    .filter((inv: any) => inv.status !== 'PAID')
    .sort((a: any, b: any) => (b.totalCents || 0) - (a.totalCents || 0))
    .slice(0, 4);

  // Top vendors
  const topVendors = (vendorsData?.vendors || [])
    .slice(0, 4);

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedWidgetId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedWidgetId || draggedWidgetId === targetId) return;

    setWidgets((prev) => {
      const fromIndex = prev.findIndex((w) => w.id === draggedWidgetId);
      const toIndex = prev.findIndex((w) => w.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  };

  const handleDragEnd = () => {
    setDraggedWidgetId(null);
  };

  const togglePin = (id: string) => {
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isPinned: !w.isPinned } : w))
    );
  };

  const resetLayout = () => {
    setWidgets(DEFAULT_WIDGETS);
    localStorage.removeItem(`ledgerline-dashboard-grid-${currentOrgId}`);
  };

  const pinnedWidgets = widgets.filter((w) => w.isPinned);

  // Widget Renderer
  const renderWidgetContent = (widget: WidgetDef) => {
    switch (widget.id) {
      case 'cash-position':
        return (
          <div className="flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cash Position (Bank)</span>
                <DollarSign className="w-4 h-4 text-ledger-green-700" />
              </div>
              <p className="text-2xl sm:text-3xl font-serif text-ink-900 tabular-currency">
                KES {formatCurrencyFromFloat(cashPosition)}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-ink-900/5">
              <span>Verified Ledger Balance</span>
              <button onClick={() => setActiveView('Banking')} className="text-focus-blue-600 hover:underline flex items-center">
                Feeds <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </button>
            </div>
          </div>
        );

      case 'money-in':
        return (
          <div className="flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Invoices Owed</span>
                <FileText className="w-4 h-4 text-focus-blue-600" />
              </div>
              <p className="text-2xl sm:text-3xl font-serif text-ink-900 tabular-currency">
                KES {formatCurrencyFromFloat(moneyIn)}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs font-medium pt-2 border-t border-ink-900/5">
              <span className="text-slate-500">{overdueInvoices} Overdue</span>
              <span className={overdueCents > 0 ? "text-rust-700" : "text-slate-500"}>
                KES {formatCurrencyFromFloat(overdueCents)}
              </span>
            </div>
          </div>
        );

      case 'money-out':
        return (
          <div className="flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Bills You Owe</span>
                <Receipt className="w-4 h-4 text-rust-700" />
              </div>
              <p className="text-2xl sm:text-3xl font-serif text-ink-900 tabular-currency">
                KES {formatCurrencyFromFloat(moneyOut)}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-ink-900/5">
              <span>Unpaid payables</span>
              <button onClick={() => setActiveView('Expenses & Bills')} className="text-focus-blue-600 hover:underline flex items-center">
                Pay Bills <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </button>
            </div>
          </div>
        );

      case 'net-profit-kpi':
        return (
          <div className="flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Operating Income</span>
                {netProfit >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-ledger-green-700" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-rust-700" />
                )}
              </div>
              <p className={`text-2xl sm:text-3xl font-serif tabular-currency ${netProfit >= 0 ? 'text-ledger-green-700' : 'text-rust-700'}`}>
                KES {formatCurrencyFromFloat(netProfit)}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-ink-900/5">
              <span>Operating Margin: {totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : 0}%</span>
              <button onClick={() => setActiveView('Reports')} className="text-focus-blue-600 hover:underline flex items-center">
                P&L Report <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </button>
            </div>
          </div>
        );

      case 'pnl-breakdown':
        return (
          <div className="h-full flex flex-col justify-between">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-base font-semibold text-ink-900">Profit & Loss Summary</h3>
              <button onClick={() => setActiveView('Reports')} className="text-xs text-focus-blue-600 hover:underline flex items-center">
                Full Statement <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </button>
            </div>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between items-center border-b border-ink-900/5 pb-1.5">
                <span className="text-slate-600">Total Income (Revenue)</span>
                <span className="font-medium tabular-currency text-ink-900">
                  KES {formatCurrencyFromFloat(totalIncome)}
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-ink-900/5 pb-1.5">
                <span className="text-slate-600">Cost of Goods Sold (COGS)</span>
                <span className="font-medium tabular-currency text-ink-900">
                  KES {formatCurrencyFromFloat(totalCogs)}
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-ink-900/5 pb-1.5">
                <span className="text-slate-600">Operating Expenses</span>
                <span className="font-medium tabular-currency text-ink-900">
                  KES {formatCurrencyFromFloat(totalExpense)}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1">
                <span className="font-bold text-ink-900">Net Profit</span>
                <span className={`font-bold tabular-currency ${netProfit >= 0 ? 'text-ledger-green-700' : 'text-rust-700'}`}>
                  KES {formatCurrencyFromFloat(netProfit)}
                </span>
              </div>
            </div>
          </div>
        );

      case 'financial-trends':
        return (
          <div className="h-full flex flex-col justify-between">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-base font-semibold text-ink-900">Revenue & Expense Trend</h3>
            </div>
            <div className="h-48 w-full">
              {metricsData?.monthlyTrends && metricsData.monthlyTrends.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metricsData.monthlyTrends} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} tickFormatter={(val) => `${val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val}`} />
                    <Tooltip 
                      cursor={{fill: '#F1F5F9', opacity: 0.4}}
                      contentStyle={{ backgroundColor: '#111827', color: '#fff', borderRadius: '4px', border: 'none', fontSize: '12px' }}
                      formatter={(val) => [`KES ${Number(val).toLocaleString()}`, '']}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="revenue" name="Revenue" fill="#15803D" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="expense" name="Expenses" fill="#B91C1C" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400 text-xs">
                  No monthly trend data available
                </div>
              )}
            </div>
          </div>
        );

      case 'unrealized-fx': {
        const ufx = metricsData?.unrealizedFX;
        const totalGainLoss = (ufx?.totalUnrealizedGainLossCents || 0) / 100;
        const isPositive = totalGainLoss >= 0;
        const recGain = (ufx?.receivablesGainLossCents || 0) / 100;
        const payGain = (ufx?.payablesGainLossCents || 0) / 100;
        const bankGain = (ufx?.bankHoldingsGainLossCents || 0) / 100;
        const summaries = ufx?.currencySummaries || [];

        return (
          <div className="h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-1.5">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Unrealized FX Gains / Losses</span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-focus-blue-50 text-focus-blue-700 dark:bg-focus-blue-900/30 dark:text-focus-blue-300">
                    IAS 21
                  </span>
                </div>
                <Globe className="w-4 h-4 text-focus-blue-600" />
              </div>

              <div className="flex items-baseline space-x-2">
                <p className={`text-2xl sm:text-3xl font-serif tabular-currency ${isPositive ? 'text-ledger-green-700' : 'text-rust-700'}`}>
                  {isPositive ? '+' : ''}KES {formatCurrencyFromFloat(totalGainLoss)}
                </p>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  isPositive ? 'bg-ledger-green-100 text-ledger-green-800' : 'bg-rust-100 text-rust-800'
                }`}>
                  {isPositive ? 'Unrealized Gain' : 'Unrealized Loss'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Based on daily automated live exchange rate feeds</p>
            </div>

            {/* Breakdown Sub-metrics */}
            <div className="grid grid-cols-3 gap-2 my-3 pt-2 border-t border-ink-900/5 text-xs">
              <div className="bg-paper-50  p-2 rounded">
                <span className="text-[10px] text-slate-500 block">Receivables (A/R)</span>
                <span className={`font-semibold tabular-currency ${recGain >= 0 ? 'text-ledger-green-700' : 'text-rust-700'}`}>
                  {recGain >= 0 ? '+' : ''}{formatCurrencyFromFloat(recGain)}
                </span>
              </div>
              <div className="bg-paper-50  p-2 rounded">
                <span className="text-[10px] text-slate-500 block">Payables (A/P)</span>
                <span className={`font-semibold tabular-currency ${payGain >= 0 ? 'text-ledger-green-700' : 'text-rust-700'}`}>
                  {payGain >= 0 ? '+' : ''}{formatCurrencyFromFloat(payGain)}
                </span>
              </div>
              <div className="bg-paper-50  p-2 rounded">
                <span className="text-[10px] text-slate-500 block">Foreign Bank</span>
                <span className={`font-semibold tabular-currency ${bankGain >= 0 ? 'text-ledger-green-700' : 'text-rust-700'}`}>
                  {bankGain >= 0 ? '+' : ''}{formatCurrencyFromFloat(bankGain)}
                </span>
              </div>
            </div>

            {/* Currency Rates Bar */}
            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-ink-900/5">
              <div className="flex items-center space-x-2 truncate">
                {summaries.slice(0, 3).map((s: any) => (
                  <span key={s.currency} className="font-mono bg-paper-100  px-1.5 py-0.5 rounded text-[10px]">
                    {s.currency}: {s.rate < 1 ? (1 / s.rate).toFixed(2) : s.rate.toFixed(2)}
                  </span>
                ))}
              </div>
              <button 
                onClick={() => setActiveView('Settings')} 
                className="text-focus-blue-600 hover:underline flex items-center shrink-0 ml-2 font-medium"
              >
                FX Engine <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </button>
            </div>
          </div>
        );
      }

      case 'high-value-invoices':
        return (
          <div className="h-full flex flex-col justify-between">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-base font-semibold text-ink-900">High-Value Open Invoices</h3>
              <button onClick={() => setActiveView('Sales')} className="text-xs text-focus-blue-600 hover:underline">
                View All
              </button>
            </div>
            <div className="space-y-2">
              {highValueInvoices.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">All invoices are settled.</p>
              ) : (
                highValueInvoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between text-xs p-2 bg-paper-50  rounded-sm border border-ink-900/5">
                    <div>
                      <p className="font-semibold text-ink-900">{inv.customerName || 'Client'}</p>
                      <p className="text-[10px] text-slate-500 font-mono">#{inv.invoiceNumber || inv.id.substring(0, 6)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold tabular-currency text-ink-900">KES {formatCurrency(inv.totalCents || 0)}</p>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                        inv.status === 'OVERDUE' ? 'bg-rust-700/10 text-rust-700' : 'bg-brass-500/20 text-brass-700'
                      }`}>
                        {inv.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );

      case 'top-vendors':
        return (
          <div className="h-full flex flex-col justify-between">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-base font-semibold text-ink-900">Top Supplier Accounts</h3>
              <button onClick={() => setActiveView('Expenses & Bills')} className="text-xs text-focus-blue-600 hover:underline">
                View All
              </button>
            </div>
            <div className="space-y-2">
              {topVendors.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No supplier records found.</p>
              ) : (
                topVendors.map((v: any) => (
                  <div key={v.id} className="flex items-center justify-between text-xs p-2 bg-paper-50  rounded-sm border border-ink-900/5">
                    <div>
                      <p className="font-semibold text-ink-900">{v.displayName}</p>
                      <p className="text-[10px] text-slate-500">{v.email || 'Supplier'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold tabular-currency text-ink-900">KES {formatCurrency(v.balance || 0)}</p>
                      <span className="text-[9px] text-slate-500">Balance</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );

      case 'kra-tax-summary':
        return (
          <div className="flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">KRA Tax Obligation</span>
                <ShieldAlert className="w-4 h-4 text-brass-600" />
              </div>
              <p className="text-2xl sm:text-3xl font-serif text-ink-900 tabular-currency">
                KES {formatCurrencyFromFloat(totalIncome * 0.16)}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-ink-900/5">
              <span>Standard 16% VAT Rate</span>
              <button onClick={() => setActiveView('Tax')} className="text-focus-blue-600 hover:underline flex items-center">
                Tax Center <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </button>
            </div>
          </div>
        );

      case 'cash-runway':
        return (
          <div className="flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Estimated Runway</span>
                <CreditCard className="w-4 h-4 text-slate-600" />
              </div>
              <p className="text-2xl sm:text-3xl font-serif text-ink-900 tabular-currency">
                {totalExpense > 0 ? (cashPosition / (totalExpense || 1)).toFixed(1) : '12+'} Months
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-ink-900/5">
              <span>Monthly Burn: KES {formatCurrencyFromFloat(totalExpense)}</span>
              <button onClick={() => setActiveView('Reports')} className="text-focus-blue-600 hover:underline flex items-center">
                Cash Flow <ArrowUpRight className="w-3 h-3 ml-0.5" />
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-serif text-ink-900">Executive Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">Drag to rearrange KPI widgets • Pinned for quick monitoring</p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsCustomizeOpen(!isCustomizeOpen)}
            className="flex items-center space-x-1.5 text-xs font-medium px-3 py-1.5 bg-paper-100 border border-ink-900/20 text-ink-900 rounded-sm hover:bg-paper-50 transition-colors shadow-xs"
          >
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
            <span>Customize Grid</span>
          </button>
          <button
            onClick={resetLayout}
            className="p-1.5 bg-paper-100 border border-ink-900/20 text-slate-500 hover:text-ink-900 rounded-sm hover:bg-paper-50 transition-colors"
            title="Reset to Default Layout"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="ledger-divider mb-6"></div>

      {/* Customize Drawer / Panel */}
      {isCustomizeOpen && (
        <div className="bg-paper-100 border border-ink-900/10 p-4 rounded-sm shadow-md mb-6 animate-in fade-in duration-150">
          <div className="flex items-center justify-between mb-3 border-b border-ink-900/10 pb-2">
            <div>
              <h3 className="text-sm font-semibold text-ink-900">Customize Dashboard Widgets</h3>
              <p className="text-xs text-slate-500">Toggle or pin widgets to show or hide them from your dashboard view.</p>
            </div>
            <button onClick={() => setIsCustomizeOpen(false)} className="text-slate-400 hover:text-ink-900">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {widgets.map((w) => (
              <div 
                key={w.id} 
                className={`flex items-center justify-between p-2.5 rounded-sm border transition-colors ${
                  w.isPinned ? 'border-focus-blue-500/40 bg-focus-blue-500/5' : 'border-ink-900/10 bg-paper-50/50'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <p className="text-xs font-semibold text-ink-900 truncate">{w.title}</p>
                  <span className="text-[10px] text-slate-400 font-mono">{w.category}</span>
                </div>
                <button
                  onClick={() => togglePin(w.id)}
                  className={`px-2 py-1 text-xs rounded-sm font-medium transition-colors flex items-center space-x-1 ${
                    w.isPinned 
                      ? 'bg-focus-blue-500 text-white' 
                      : 'bg-paper-100 text-slate-600 hover:bg-paper-200'
                  }`}
                >
                  {w.isPinned ? (
                    <>
                      <Check className="w-3 h-3" />
                      <span>Pinned</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3" />
                      <span>Pin</span>
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Draggable Grid */}
      {isMetricsLoading ? (
        <div className="p-16 text-center text-slate-500">Loading dashboard...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pinnedWidgets.map((widget) => {
            const isMedium = widget.size === 'medium';
            return (
              <div
                key={widget.id}
                draggable
                onDragStart={(e) => handleDragStart(e, widget.id)}
                onDragOver={(e) => handleDragOver(e, widget.id)}
                onDragEnd={handleDragEnd}
                className={`bg-paper-100 border border-ink-900/10 p-5 rounded-sm shadow-xs transition-all relative group flex flex-col justify-between ${
                  isMedium ? 'md:col-span-1 lg:col-span-1 min-h-[260px]' : 'min-h-[160px]'
                } ${draggedWidgetId === widget.id ? 'opacity-40 ring-2 ring-focus-blue-500' : 'hover:shadow-sm'}`}
              >
                {/* Drag Handle & Pin Action */}
                <div className="absolute top-2.5 right-2.5 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => togglePin(widget.id)}
                    className="p-1 text-slate-400 hover:text-rust-700 transition-colors"
                    title="Unpin Widget"
                  >
                    <PinOff className="w-3.5 h-3.5" />
                  </button>
                  <div className="cursor-grab active:cursor-grabbing p-1 text-slate-400 hover:text-ink-900">
                    <GripVertical className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Card Content */}
                {renderWidgetContent(widget)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
