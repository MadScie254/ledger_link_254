import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { statutoryDeadlines, dueIn as inDays } from '../../utils/statutory';
import { ArrowDownRight, ArrowUpRight, CalendarDays, GripVertical, Landmark, ReceiptText, RotateCcw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAppStore } from '../../store';
import { useRenderTracker } from '../../utils/monitoring';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';

/* ────────────────────────────────────────────────────────────────────────── */
/* Page composition                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

interface WidgetDef {
  id: string;
  title: string;
  category: 'KPI' | 'Charts' | 'Pinned Entities';
  size: 'small' | 'medium' | 'large';
  isPinned: boolean;
}

/**
 * Widget ids and the storage key are unchanged from the previous dashboard,
 * so a layout someone already arranged survives the redesign. Small KPI
 * widgets become summary cards; the rest become workspace cards.
 */
const DEFAULT_WIDGETS: WidgetDef[] = [
  { id: 'cash-position', title: 'Cash', category: 'KPI', size: 'small', isPinned: true },
  { id: 'money-in', title: 'Owed to you', category: 'KPI', size: 'small', isPinned: true },
  { id: 'money-out', title: 'You owe', category: 'KPI', size: 'small', isPinned: true },
  { id: 'net-profit-kpi', title: 'Net profit', category: 'KPI', size: 'small', isPinned: true },
  { id: 'financial-trends', title: 'Profit and loss', category: 'Charts', size: 'large', isPinned: true },
  { id: 'invoice-money', title: 'Invoice money', category: 'Charts', size: 'medium', isPinned: true },
  { id: 'expense-categories', title: 'Expenses by category', category: 'Charts', size: 'medium', isPinned: true },
  { id: 'bank-accounts', title: 'Bank and M-Pesa', category: 'Pinned Entities', size: 'medium', isPinned: true },
  { id: 'kra-deadlines', title: 'KRA deadlines', category: 'Pinned Entities', size: 'medium', isPinned: true },
  { id: 'recent-activity', title: 'Recent activity', category: 'Pinned Entities', size: 'medium', isPinned: true },
  { id: 'pnl-breakdown', title: 'Profit and loss to date', category: 'Charts', size: 'medium', isPinned: false },
  { id: 'unrealized-fx', title: 'Unrealised exchange differences', category: 'KPI', size: 'medium', isPinned: false },
  { id: 'high-value-invoices', title: 'Largest open invoices', category: 'Pinned Entities', size: 'medium', isPinned: false },
  { id: 'top-vendors', title: 'Supplier balances', category: 'Pinned Entities', size: 'medium', isPinned: false },
  { id: 'kra-tax-summary', title: 'VAT on sales', category: 'KPI', size: 'small', isPinned: false },
  { id: 'cash-runway', title: 'Months of cash', category: 'KPI', size: 'small', isPinned: false },
];

const TITLE_BY_ID = Object.fromEntries(DEFAULT_WIDGETS.map((w) => [w.id, w.title]));
const isColumn = (w: WidgetDef) => w.category === 'KPI' && w.size === 'small';
const storageKey = (orgId: string) => `ledgerline-dashboard-grid-${orgId}`;

function loadWidgets(orgId: string): WidgetDef[] {
  try {
    const saved = localStorage.getItem(storageKey(orgId));
    if (!saved) return DEFAULT_WIDGETS;
    const parsed = JSON.parse(saved) as WidgetDef[];
    // Keep the saved order and pins, take titles from the current page, and
    // add any widget introduced since the layout was saved.
    const known = parsed
      .filter((w) => TITLE_BY_ID[w.id])
      .map((w) => ({ ...DEFAULT_WIDGETS.find((d) => d.id === w.id)!, isPinned: w.isPinned }));
    const missing = DEFAULT_WIDGETS.filter((d) => !known.some((w) => w.id === d.id));
    return [...known, ...missing];
  } catch {
    return DEFAULT_WIDGETS;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Data                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

class RequestProblem extends Error {
  constructor(public path: string, public status: number) {
    super(`GET ${path} answered ${status}`);
  }
}

async function getJson(path: string, orgId: string) {
  const response = await fetch(path, { headers: { 'x-org-id': orgId } });
  if (!response.ok) throw new RequestProblem(path, response.status);
  return response.json();
}

/** Remembers a figure per organization and reports the previous value once. */
function useChangedSince(orgId: string, key: string, value: number | undefined) {
  const [previous, setPrevious] = useState<number | null>(null);
  useEffect(() => {
    if (value === undefined || !orgId) return;
    const storeKey = `ll-last-seen-${orgId}-${key}`;
    try {
      const stored = localStorage.getItem(storeKey);
      if (stored !== null && Number(stored) !== value) setPrevious(Number(stored));
      localStorage.setItem(storeKey, String(value));
    } catch {
      // Private windows can refuse storage; the figure still shows.
    }
  }, [orgId, key, value]);
  return previous;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pieces                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function Problem({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  const detail = error instanceof RequestProblem ? `${error.message}.` : 'The request did not complete.';
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-negative-soft p-3 text-[13px]">
      <Mark kind="circled" />
      <span className="text-ink-900">Could not load {what}.</span>
      <span className="text-graphite-600">{detail}</span>
      <button type="button" onClick={onRetry} className="font-semibold text-primary-ink hover:text-primary">
        Try again
      </button>
    </div>
  );
}

function TextLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded text-[12.5px] font-semibold text-primary-ink hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      {children}
    </button>
  );
}

function SectionHeading({ id, children, action }: { id: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 pb-4">
      <h2 id={id} className="text-[15px] font-semibold leading-5 text-text">
        {children}
      </h2>
      {action}
    </div>
  );
}

function EmptyCard({ icon: Icon, title, detail }: { icon: typeof ReceiptText; title: string; detail: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface-2 px-6 py-7 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary-ink"><Icon className="size-5" aria-hidden="true" /></span>
      <p className="text-sm font-semibold text-text">{title}</p>
      <p className="mt-1 max-w-64 text-[12.5px] leading-5 text-text-2">{detail}</p>
    </div>
  );
}

const chartMoney = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);

interface Movable {
  widget: WidgetDef;
  draggedId: string | null;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onMove: (id: string, delta: number) => void;
}

function MoveHandle({ widget, onMove }: Pick<Movable, 'widget' | 'onMove'>) {
  return (
    <button
      type="button"
      aria-label={`Move ${widget.title}. Use arrow keys to move earlier or later`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          onMove(widget.id, -1);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          onMove(widget.id, 1);
        }
      }}
      className="p-0.5 -m-0.5 text-graphite-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-ink-900 cursor-grab active:cursor-grabbing"
    >
      <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The page                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function DashboardView() {
  useRenderTracker('DashboardView');
  const { currentOrgId, activeCompany, setActiveView } = useAppStore();
  const currency = activeCompany?.baseCurrency || 'KES';
  const today = useMemo(() => new Date(), []);

  const [widgets, setWidgets] = useState<WidgetDef[]>(() => loadWidgets(currentOrgId));
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [isArranging, setIsArranging] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(currentOrgId), JSON.stringify(widgets));
    } catch {
      // Layout simply will not persist this session.
    }
  }, [widgets, currentOrgId]);

  const metrics = useQuery({
    queryKey: ['dashboard-metrics', currentOrgId],
    queryFn: () => getJson('/api/dashboard/metrics', currentOrgId),
  });
  const invoices = useQuery({ queryKey: ['invoices', currentOrgId], queryFn: () => getJson('/api/invoices', currentOrgId) });
  const vendors = useQuery({ queryKey: ['vendors', currentOrgId], queryFn: () => getJson('/api/vendors', currentOrgId) });
  // Invoices carry only a customer id; names come from the customer list.
  const customers = useQuery({ queryKey: ['customers', currentOrgId], queryFn: () => getJson('/api/customers', currentOrgId) });
  const customerName = (id: string) =>
    (customers.data?.customers || []).find((c: any) => c.id === id)?.displayName;
  // Its own key: the Accounting page keeps the paged journal under ['journal-entries', org].
  const entries = useQuery({ queryKey: ['journal-entries', currentOrgId, 'recent'], queryFn: () => getJson('/api/journal-entries?limit=20', currentOrgId) });
  const bankLines = useQuery({ queryKey: ['banking-transactions', currentOrgId], queryFn: () => getJson('/api/banking/transactions', currentOrgId) });
  const accounts = useQuery({ queryKey: ['accounts', currentOrgId], queryFn: () => getJson('/api/accounts', currentOrgId) });
  const pnl = useQuery({ queryKey: ['reports-pnl', currentOrgId, 'This Year-to-date'], queryFn: () => getJson('/api/reports/pnl?dateRange=This%20Year-to-date', currentOrgId) });
  const pnlMonthly = useQuery({
    queryKey: ['dashboard-pnl-monthly', currentOrgId, today.getFullYear(), today.getMonth()],
    queryFn: async () => {
      const current = await getJson('/api/reports/pnl-monthly?dateRange=This%20Year-to-date', currentOrgId);
      const previous = today.getMonth() < 5
        ? await getJson('/api/reports/pnl-monthly?dateRange=Last%20Financial%20Year', currentOrgId)
        : null;
      return { current, previous };
    },
  });

  const m = metrics.data || {};
  const cashCents: number | undefined = metrics.data ? m.cashPositionCents || 0 : undefined;
  const cashChangedFrom = useChangedSince(currentOrgId, 'cash', cashCents);
  const moneyInChangedFrom = useChangedSince(currentOrgId, 'money-in', metrics.data ? m.moneyInCents || 0 : undefined);
  const moneyOutChangedFrom = useChangedSince(currentOrgId, 'money-out', metrics.data ? m.moneyOutCents || 0 : undefined);
  const profitChangedFrom = useChangedSince(currentOrgId, 'net-profit', metrics.data ? m.netProfitCents || 0 : undefined);

  /* Reordering ---------------------------------------------------------- */
  const moveWidget = (id: string, delta: number) => {
    setWidgets((prev) => {
      const from = prev.findIndex((w) => w.id === id);
      const kind = isColumn(prev[from]);
      // Move past the next pinned widget of the same kind, so a keypress
      // always changes what is on the page.
      let to = from + delta;
      while (to >= 0 && to < prev.length && (!prev[to].isPinned || isColumn(prev[to]) !== kind)) to += delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const drag: Omit<Movable, 'widget'> = {
    draggedId,
    onDragStart: (e, id) => {
      setDraggedId(id);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (e, targetId) => {
      e.preventDefault();
      if (!draggedId || draggedId === targetId) return;
      setWidgets((prev) => {
        const from = prev.findIndex((w) => w.id === draggedId);
        const to = prev.findIndex((w) => w.id === targetId);
        if (from === -1 || to === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    onDragEnd: () => setDraggedId(null),
    onMove: moveWidget,
  };

  const togglePin = (id: string) => setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, isPinned: !w.isPinned } : w)));
  const resetLayout = () => {
    setWidgets(DEFAULT_WIDGETS);
    try {
      localStorage.removeItem(storageKey(currentOrgId));
    } catch {
      // Nothing stored to remove.
    }
  };

  const columns = widgets.filter((w) => w.isPinned && isColumn(w));
  const sections = widgets.filter((w) => w.isPinned && !isColumn(w));

  /* Queries: what needs doing ------------------------------------------ */
  const unmatchedLines = (bankLines.data?.transactions || []).filter((t: any) => t.status !== 'MATCHED');
  const deadlines = statutoryDeadlines(today);
  const trendMonths: any[] = m.monthlyTrends || [];
  const monthCount = Math.max(1, trendMonths.length);
  const moneyAccounts = (accounts.data?.accounts || []).filter((account: any) => account.isBankAccount && account.isActive !== false);
  const invoiceRows: any[] = invoices.data?.invoices || [];
  const todayKey = format(today, 'yyyy-MM-dd');
  const paidSince = format(subDays(today, 29), 'yyyy-MM-dd');
  const invoiceMoney = invoiceRows.reduce((totals: { overdue: number; notDue: number; paid: number }, invoice: any) => {
    if (['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) {
      const due = Number(invoice.amountDueCents) || 0;
      if (invoice.dueDate && invoice.dueDate.slice(0, 10) < todayKey) totals.overdue += due;
      else totals.notDue += due;
    }
    totals.paid += (invoice.payments || []).reduce((sum: number, payment: any) =>
      !payment.reversedAt && payment.paymentDate?.slice(0, 10) >= paidSince && payment.paymentDate?.slice(0, 10) <= todayKey
        ? sum + (Number(payment.amountCents) || 0) : sum, 0);
    return totals;
  }, { overdue: 0, notDue: 0, paid: 0 });
  const expenseCategories = (pnl.data?.expenses || [])
    .filter((row: any) => Number(row.amountCents) > 0)
    .sort((a: any, b: any) => b.amountCents - a.amountCents);
  const lastSixMonths = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(today.getFullYear(), today.getMonth() - 5 + index, 1);
    const period = format(month, 'yyyy-MM');
    const source = period.slice(0, 4) === String(today.getFullYear()) ? pnlMonthly.data?.current : pnlMonthly.data?.previous;
    const position = (source?.months || []).indexOf(period);
    return {
      period,
      label: format(month, 'MMM'),
      income: position < 0 ? 0 : Number(source.income?.months?.[position]) || 0,
      costs: position < 0 ? 0 : (Number(source.costOfSales?.months?.[position]) || 0) + (Number(source.expenses?.months?.[position]) || 0),
    };
  });

  /* Recent entries ------------------------------------------------------- */
  const recentEntries = [...(entries.data?.entries || [])]
    .sort((a: any, b: any) => String(b.entryDate).localeCompare(String(a.entryDate)))
    .slice(0, 8)
    .map((entry: any) => ({
      ...entry,
      amountCents: (entry.lines || []).reduce((sum: number, line: any) => sum + Number(line.debit || 0), 0),
    }));
  const postedUpTo = recentEntries[0]?.entryDate;

  /* ──────────────────────────────────────────────────────────────────── */

  const renderColumn = (widget: WidgetDef) => {
    let figure: React.ReactNode = null;
    let note: React.ReactNode = null;
    let link: React.ReactNode = null;

    switch (widget.id) {
      case 'cash-position':
        figure = <Amount cents={m.cashPositionCents || 0} currency={currency} size="xl" />;
        note =
          cashChangedFrom !== null ? (
            <>
              Was <Amount cents={cashChangedFrom} currency={currency} size="sm" tone="ink" /> when you last opened this page
            </>
          ) : (
            'Bank and M-Pesa accounts, as posted'
          );
        link = <TextLink onClick={() => setActiveView('Banking')}>Banking</TextLink>;
        break;
      case 'money-in':
        figure = <Amount cents={m.moneyInCents || 0} currency={currency} size="xl" />;
        note =
          (m.overdueInvoices || 0) > 0 ? (
            <span className="inline-flex flex-wrap items-baseline gap-x-1">
              <Mark kind="circled" className="self-center" />
              <span className="text-ledger-red">{m.overdueInvoices} overdue,</span>
              <Amount cents={m.overdueCents || 0} currency={currency} size="sm" tone="ink" />
            </span>
          ) : (
            'Nothing overdue'
          );
        link = <TextLink onClick={() => setActiveView('Sales')}>Invoices</TextLink>;
        break;
      case 'money-out':
        figure = <Amount cents={m.moneyOutCents || 0} currency={currency} size="xl" />;
        note = 'Unpaid bills';
        link = <TextLink onClick={() => setActiveView('Expenses & Bills')}>Bills</TextLink>;
        break;
      case 'net-profit-kpi': {
        const income = m.totalIncomeCents || 0;
        const margin = income > 0 ? ((m.netProfitCents || 0) / income) * 100 : null;
        figure = <Amount cents={m.netProfitCents || 0} currency={currency} size="xl" tone="result" />;
        note = margin === null ? 'All posted periods' : `All posted periods, ${margin.toFixed(1)}% of sales`;
        link = <TextLink onClick={() => setActiveView('Reports')}>Profit and loss</TextLink>;
        break;
      }
      case 'kra-tax-summary':
        figure = <Amount cents={Math.round((m.totalIncomeCents || 0) * 0.16)} currency={currency} size="xl" tone="ink" />;
        note = 'Estimate at 16% of posted sales. Not a filed return.';
        link = <TextLink onClick={() => setActiveView('Tax')}>Tax</TextLink>;
        break;
      case 'cash-runway': {
        // Average over the months in the trend chart (the last twelve), so the
        // spending total and the month count cover the same period.
        const trendSpendCents = trendMonths.reduce(
          (sum: number, d: any) => sum + (d.expenseCents ?? (d.expense || 0) * 100),
          0,
        );
        const monthlySpend = trendSpendCents / monthCount;
        const months = monthlySpend > 0 ? (m.cashPositionCents || 0) / monthlySpend : null;
        figure = (
          <span className="ll-figure text-[26px] xl:text-[32px] leading-none text-ink-900">
            {months === null ? '–' : months.toFixed(1)}
            <span className="ml-1.5 text-[15px] text-graphite-600">months</span>
          </span>
        );
        note = 'Estimate: cash over average monthly spend';
        link = <TextLink onClick={() => setActiveView('Reports')}>Cash flow</TextLink>;
        break;
      }
    }

    const snapshot = {
      'cash-position': { previous: cashChangedFrom, current: m.cashPositionCents || 0 },
      'money-in': { previous: moneyInChangedFrom, current: m.moneyInCents || 0 },
      'money-out': { previous: moneyOutChangedFrom, current: m.moneyOutCents || 0 },
      'net-profit-kpi': { previous: profitChangedFrom, current: m.netProfitCents || 0 },
    }[widget.id];
    const change = snapshot && snapshot.previous !== null ? snapshot.current - snapshot.previous : null;
    const emptyLabel = {
      'cash-position': 'Cash balance is zero',
      'money-in': 'No open invoice balance',
      'money-out': 'No unpaid bill balance',
      'net-profit-kpi': 'Net result is zero',
    }[widget.id];

    return (
      <div
        key={widget.id}
        role="group"
        aria-labelledby={`col-${widget.id}`}
        draggable
        onDragStart={(e) => drag.onDragStart(e, widget.id)}
        onDragOver={(e) => drag.onDragOver(e, widget.id)}
        onDragEnd={drag.onDragEnd}
        className={`group min-w-0 rounded-xl border border-border bg-surface p-5 shadow-sm transition-colors duration-150 ${
          drag.draggedId === widget.id ? 'bg-primary-soft' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-2 pb-4">
          <h3 id={`col-${widget.id}`} className="text-[13px] font-medium text-text-2">
            {widget.title}
          </h3>
          <MoveHandle widget={widget} onMove={drag.onMove} />
        </div>
        <div className="pb-3 [&_.ll-figure]:font-[700] [&_.ll-figure]:tracking-[-0.03em]">{figure}</div>
        <div className="mb-3 flex min-h-5 items-center gap-1 text-[12px] font-medium text-text-2">
          {change === null ? <span>No earlier snapshot</span> : change === 0 ? <span>Unchanged since last visit</span> : (
            <>
              {change > 0 ? <ArrowUpRight className="size-3.5" aria-hidden="true" /> : <ArrowDownRight className="size-3.5" aria-hidden="true" />}
              <Amount cents={Math.abs(change)} currency={currency} size="xs" tone="ink" />
              <span>{change > 0 ? 'higher' : 'lower'} since last visit</span>
            </>
          )}
        </div>
        <div className="flex flex-col items-start gap-2 text-[12.5px] leading-snug text-text-2">
          {snapshot?.current === 0 ? <span className="rounded-lg bg-surface-2 px-2.5 py-2 text-text-2">{emptyLabel}</span> : <span>{note}</span>}
          {link}
        </div>
      </div>
    );
  };

  const renderSection = (widget: WidgetDef) => {
    const headingId = `sec-${widget.id}`;
    let body: React.ReactNode = null;
    let action: React.ReactNode = null;

    switch (widget.id) {
      case 'pnl-breakdown': {
        const income = m.totalIncomeCents || 0;
        const cogs = m.totalCogsCents || 0;
        const expenses = m.totalExpenseCents || 0;
        const rows = [
          { label: 'Sales', cents: income },
          { label: 'Cost of goods sold', cents: -cogs },
        ];
        action = <TextLink onClick={() => setActiveView('Reports')}>Full statement</TextLink>;
        body = (
          <dl className="text-[13.5px]">
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-4 py-2 border-b border-feint">
                <dt className="text-ink-900">{r.label}</dt>
                <dd><Amount cents={r.cents} currency={currency} tone="ink" /></dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 py-2 border-b border-feint">
              <dt className="font-semibold text-ink-900">Gross profit</dt>
              <dd><Amount cents={income - cogs} currency={currency} tone="result" /></dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-ink-900">Operating expenses</dt>
              <dd><Amount cents={-expenses} currency={currency} tone="ink" /></dd>
            </div>
            <div className="ll-total flex items-baseline justify-between gap-4 py-2">
              <dt className="font-semibold text-ink-900">Net profit</dt>
              <dd><Amount cents={m.netProfitCents || 0} currency={currency} tone="result" className="font-semibold" /></dd>
            </div>
          </dl>
        );
        break;
      }

      case 'financial-trends': {
        action = <TextLink onClick={() => setActiveView('Reports')}>Full report</TextLink>;
        body = pnlMonthly.isError ? (
          <Problem error={pnlMonthly.error} onRetry={() => pnlMonthly.refetch()} what="monthly profit and loss" />
        ) : pnlMonthly.isLoading ? (
          <div className="h-64 animate-pulse rounded-lg bg-surface-2" aria-busy="true" aria-label="Loading profit and loss" />
        ) : lastSixMonths.every((month) => month.income === 0 && month.costs === 0) ? (
          <EmptyCard icon={ReceiptText} title="No posted activity yet" detail="Income and costs will appear here after entries are posted." />
        ) : (
          <figure>
            <p className="mb-4 text-[12.5px] text-text-2">Income and costs across the last six months</p>
            <div className="h-56 w-full" role="img" aria-label="Income and costs by month for the last six months">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lastSixMonths} barGap={4} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-3)', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} width={42} tick={{ fill: 'var(--text-3)', fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value / 100000)}k`} />
                  <Tooltip formatter={(value: number | undefined, name: string | undefined) => [chartMoney(Number(value) || 0, currency), name]} contentStyle={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)' }} />
                  <Bar dataKey="income" name="Income" fill="var(--chart-income)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="costs" name="Costs" fill="var(--chart-expense)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <figcaption className="mt-3 flex gap-5 text-xs text-text-2">
              <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-chart-income" />Income</span>
              <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-chart-expense" />Costs including cost of sales</span>
            </figcaption>
            <table className="sr-only"><caption>Profit and loss by month, {currency}</caption><thead><tr><th>Month</th><th>Income</th><th>Costs</th></tr></thead><tbody>{lastSixMonths.map((month) => <tr key={month.period}><th>{month.period}</th><td>{month.income}</td><td>{month.costs}</td></tr>)}</tbody></table>
          </figure>
        );
        break;
      }

      case 'invoice-money': {
        const parts = [
          { label: 'Overdue', cents: invoiceMoney.overdue, color: 'var(--warning)' },
          { label: 'Not due', cents: invoiceMoney.notDue, color: 'var(--chart-expense)' },
          { label: 'Paid in the last 30 days', cents: invoiceMoney.paid, color: 'var(--positive)' },
        ];
        const total = parts.reduce((sum, part) => sum + part.cents, 0);
        action = <TextLink onClick={() => setActiveView('Sales')}>View invoices</TextLink>;
        body = invoices.isError ? (
          <Problem error={invoices.error} onRetry={() => invoices.refetch()} what="invoices" />
        ) : invoices.isLoading ? (
          <div className="h-44 animate-pulse rounded-lg bg-surface-2" aria-busy="true" aria-label="Loading invoice money" />
        ) : total === 0 ? (
          <EmptyCard icon={ReceiptText} title="No invoice money to show" detail="Open balances and recent payments will appear here after invoices are posted." />
        ) : (
          <div>
            <p className="mb-4 text-[12.5px] text-text-2">Open balances and payments received</p>
            <div className="flex h-3 overflow-hidden rounded-full bg-neutral-soft" role="img" aria-label={parts.map((part) => `${part.label}: ${chartMoney(part.cents, currency)}`).join(', ')}>
              {parts.map((part) => <span key={part.label} style={{ width: `${(part.cents / total) * 100}%`, background: part.color }} />)}
            </div>
            <dl className="mt-5 space-y-3">
              {parts.map((part) => (
                <div key={part.label} className="flex items-center justify-between gap-4 text-[13px]">
                  <dt className="flex items-center gap-2 text-text-2"><span className="size-2.5 rounded-full" style={{ background: part.color }} />{part.label}</dt>
                  <dd><Amount cents={part.cents} currency={currency} tone="ink" /></dd>
                </div>
              ))}
            </dl>
          </div>
        );
        break;
      }

      case 'expense-categories': {
        const top = expenseCategories.slice(0, 5);
        const other = expenseCategories.slice(5).reduce((sum: number, row: any) => sum + Number(row.amountCents), 0);
        const chartRows = [...top.map((row: any) => ({ name: row.name, value: Number(row.amountCents) })), ...(other > 0 ? [{ name: 'Other', value: other }] : [])];
        const colors = ['var(--chart-category-1)', 'var(--chart-category-2)', 'var(--chart-category-3)', 'var(--chart-category-4)', 'var(--chart-category-5)', 'var(--chart-category-6)'];
        action = <TextLink onClick={() => setActiveView('Reports')}>Expense report</TextLink>;
        body = pnl.isError ? (
          <Problem error={pnl.error} onRetry={() => pnl.refetch()} what="expense categories" />
        ) : pnl.isLoading ? (
          <div className="h-44 animate-pulse rounded-lg bg-surface-2" aria-busy="true" aria-label="Loading expenses" />
        ) : chartRows.length === 0 ? (
          <EmptyCard icon={ReceiptText} title="No expenses in this period" detail="Posted expenses by account will appear here for this year." />
        ) : (
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="h-44 w-44 shrink-0" role="img" aria-label={`Expenses by category: ${chartRows.map((row) => row.name).join(', ')}`}>
              <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chartRows} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">{chartRows.map((row, index) => <Cell key={row.name} fill={colors[index]} />)}</Pie><Tooltip formatter={(value: number | undefined) => chartMoney(Number(value) || 0, currency)} contentStyle={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)' }} /></PieChart></ResponsiveContainer>
            </div>
            <dl className="w-full min-w-0 space-y-2.5">
              {chartRows.map((row, index) => <div key={row.name} className="flex items-center justify-between gap-3 text-xs"><dt className="flex min-w-0 items-center gap-2 text-text-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: colors[index] }} /><span className="truncate">{row.name}</span></dt><dd className="shrink-0"><Amount cents={row.value} currency={currency} size="xs" tone="ink" /></dd></div>)}
            </dl>
          </div>
        );
        break;
      }

      case 'bank-accounts': {
        action = <TextLink onClick={() => setActiveView('Banking')}>Review banking</TextLink>;
        body = accounts.isError || bankLines.isError ? (
          <Problem error={accounts.error || bankLines.error} onRetry={() => { accounts.refetch(); bankLines.refetch(); }} what="bank accounts" />
        ) : accounts.isLoading || bankLines.isLoading ? (
          <div className="h-44 animate-pulse rounded-lg bg-surface-2" aria-busy="true" aria-label="Loading bank accounts" />
        ) : moneyAccounts.length === 0 ? (
          <EmptyCard icon={Landmark} title="No money accounts yet" detail="Bank, cash and M-Pesa accounts appear here once they are set up." />
        ) : (
          <div className="space-y-1">
            {moneyAccounts.map((account: any) => {
              const reviewCount = unmatchedLines.filter((line: any) => line.bankAccountId === account.id).length;
              return <button key={account.id} type="button" onClick={() => setActiveView('Banking')} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary"><span className="min-w-0"><span className="block truncate text-[13px] font-semibold text-text">{account.name}</span><span className="text-xs text-text-2">{reviewCount} {reviewCount === 1 ? 'line' : 'lines'} to review</span></span><Amount cents={account.balanceCents || 0} currency={account.currency || currency} tone="ink" /></button>;
            })}
            {unmatchedLines.some((line: any) => !line.bankAccountId) && <button type="button" onClick={() => setActiveView('Banking')} className="w-full rounded-lg bg-warning-soft px-3 py-2 text-left text-xs font-medium text-text-2 hover:bg-hover">{unmatchedLines.filter((line: any) => !line.bankAccountId).length} statement lines need an account</button>}
          </div>
        );
        break;
      }

      case 'kra-deadlines':
        action = <TextLink onClick={() => setActiveView('Tax')}>Tax centre</TextLink>;
        body = deadlines.length === 0 ? (
          <EmptyCard icon={CalendarDays} title="No upcoming deadlines" detail="The next statutory dates will appear here when available." />
        ) : (
          <div className="space-y-1">
            {deadlines.map((deadline) => <button key={deadline.id} type="button" onClick={() => setActiveView(deadline.view)} className="flex w-full items-start justify-between gap-4 rounded-lg px-3 py-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary"><span><span className="block text-[13px] font-semibold text-text">{deadline.label}</span><span className="mt-0.5 block text-xs text-text-2">{deadline.rule}</span></span><span className="shrink-0 text-right"><span className="block text-[13px] font-semibold text-text">{format(deadline.due, 'd MMM')}</span><span className="block text-xs text-text-2">{inDays(deadline.due, today)}</span></span></button>)}
          </div>
        );
        break;

      case 'recent-activity':
        action = <TextLink onClick={() => setActiveView('Accounting')}>All activity</TextLink>;
        body = entries.isError ? (
          <Problem error={entries.error} onRetry={() => entries.refetch()} what="recent activity" />
        ) : entries.isLoading ? (
          <div className="h-44 animate-pulse rounded-lg bg-surface-2" aria-busy="true" aria-label="Loading recent activity" />
        ) : recentEntries.length === 0 ? (
          <EmptyCard icon={ReceiptText} title="No activity yet" detail="Posted entries will appear here, newest first." />
        ) : (
          <ol className="divide-y divide-border">
            {recentEntries.map((entry: any) => <li key={entry.id}><button type="button" onClick={() => setActiveView('Accounting')} className="flex w-full items-center justify-between gap-4 rounded-lg px-2 py-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary"><span className="min-w-0"><span className="block truncate text-[13px] font-medium text-text">{entry.memo || 'Journal entry'}</span><span className="text-xs text-text-2">{entry.entryDate ? format(new Date(entry.entryDate), 'd MMM yyyy') : 'Date unavailable'}{entry.referenceNo ? ` · ${entry.referenceNo}` : ''}</span></span><Amount cents={entry.amountCents} currency={currency} size="sm" tone="ink" /></button></li>)}
          </ol>
        );
        break;

      case 'unrealized-fx': {
        const ufx = m.unrealizedFX;
        const rows = [
          { label: 'Receivables', cents: ufx?.receivablesGainLossCents || 0 },
          { label: 'Payables', cents: ufx?.payablesGainLossCents || 0 },
          { label: 'Foreign currency bank', cents: ufx?.bankHoldingsGainLossCents || 0 },
        ];
        action = <TextLink onClick={() => setActiveView('Settings')}>Exchange rates</TextLink>;
        body = (
          <>
            <dl className="text-[13.5px]">
              {rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-4 py-2 border-b border-feint">
                  <dt className="text-ink-900">{r.label}</dt>
                  <dd><Amount cents={r.cents} currency={currency} tone="result" /></dd>
                </div>
              ))}
              <div className="ll-total flex items-baseline justify-between gap-4 py-2 mt-px">
                <dt className="font-semibold text-ink-900">Gain or (loss)</dt>
                <dd><Amount cents={ufx?.totalUnrealizedGainLossCents || 0} currency={currency} tone="result" className="font-semibold" /></dd>
              </div>
            </dl>
            <p className="mt-2.5 text-[12px] text-graphite-600">
              Revalued at the latest stored exchange rates (IAS 21).
              {(ufx?.currencySummaries || []).slice(0, 3).map((s: any) => (
                <span key={s.currency} className="ml-2 whitespace-nowrap">
                  {s.currency} {s.rate < 1 ? (1 / s.rate).toFixed(2) : Number(s.rate).toFixed(2)}
                </span>
              ))}
            </p>
          </>
        );
        break;
      }

      case 'high-value-invoices': {
        const open = (invoices.data?.invoices || [])
          .filter((inv: any) => inv.status !== 'PAID')
          .sort((a: any, b: any) => (b.totalCents || 0) - (a.totalCents || 0))
          .slice(0, 5);
        action = <TextLink onClick={() => setActiveView('Sales')}>All invoices</TextLink>;
        body = invoices.isError ? (
          <Problem error={invoices.error} onRetry={() => invoices.refetch()} what="invoices" />
        ) : open.length === 0 ? (
          <p className="py-4 flex items-center gap-2 text-[13px] text-graphite-600">
            <Mark kind="tick" /> Every invoice is paid. Open invoices are listed here, largest first.
          </p>
        ) : (
          <table className="w-full text-[13.5px]">
            <caption className="sr-only">Open invoices, largest first, {currency}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left pr-3">Customer</th>
                <th scope="col" className="text-left pr-3">Standing</th>
                <th scope="col" className="text-right">{currency}</th>
              </tr>
            </thead>
            <tbody>
              {open.map((inv: any) => (
                <tr key={inv.id}>
                  <td className="pr-3">
                    <span className="block text-ink-900">{customerName(inv.customerId) || 'Customer not found'}</span>
                    <span className="block text-[12px] text-graphite-500">{inv.invoiceNumber || inv.invoiceNo || `Invoice ${String(inv.id).slice(0, 6)}`}</span>
                  </td>
                  <td className="pr-3">
                    {inv.status === 'OVERDUE' ? (
                      <Mark kind="circled" label="Overdue" />
                    ) : (
                      <Mark kind="query" label="Awaiting payment" />
                    )}
                  </td>
                  <td className="text-right"><Amount cents={inv.totalCents || 0} currency={currency} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        );
        break;
      }

      case 'top-vendors': {
        const list = (vendors.data?.vendors || []).slice(0, 5);
        action = <TextLink onClick={() => setActiveView('Expenses & Bills')}>All vendors</TextLink>;
        body = vendors.isError ? (
          <Problem error={vendors.error} onRetry={() => vendors.refetch()} what="vendors" />
        ) : list.length === 0 ? (
          <p className="py-4 text-[13px] text-graphite-600">Suppliers you record appear here with what you owe each of them.</p>
        ) : (
          <table className="w-full text-[13.5px]">
            <caption className="sr-only">Supplier balances, {currency}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left pr-3">Supplier</th>
                <th scope="col" className="text-right">{currency}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v: any) => (
                <tr key={v.id}>
                  <td className="pr-3">
                    <span className="block text-ink-900">{v.displayName}</span>
                    {v.email && <span className="block text-[12px] text-graphite-500">{v.email}</span>}
                  </td>
                  <td className="text-right"><Amount cents={v.balance || 0} currency={currency} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        );
        break;
      }
    }

    return (
      <section
        key={widget.id}
        aria-labelledby={headingId}
        draggable
        onDragStart={(e) => drag.onDragStart(e, widget.id)}
        onDragOver={(e) => drag.onDragOver(e, widget.id)}
        onDragEnd={drag.onDragEnd}
        className={`group min-w-0 rounded-xl border border-border bg-surface p-5 shadow-sm ${widget.size === 'large' || widget.id === 'recent-activity' ? 'xl:col-span-2' : ''} ${drag.draggedId === widget.id ? 'opacity-50' : ''}`}
      >
        <SectionHeading
          id={headingId}
          action={
            <span className="flex items-center gap-3">
              {action}
              <MoveHandle widget={widget} onMove={drag.onMove} />
            </span>
          }
        >
          {widget.title}
        </SectionHeading>
        <div>{body}</div>
      </section>
    );
  };

  /* ──────────────────────────────────────────────────────────────────── */

  return (
    <div className="pb-16">
      {/* Today's page */}
      <header className="flex flex-col gap-4 pb-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] font-extrabold leading-[34px] tracking-[-0.03em] text-text">Home</h1>
          <p className="mt-1 text-[13px] text-text-2">
            {format(today, 'EEEE d MMMM yyyy')} · {activeCompany?.name || 'Your organization'} · Figures in {currency}
            {postedUpTo && <> · Posted up to {format(new Date(postedUpTo), 'd MMM yyyy')}</>}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setIsArranging((open) => !open)}
            aria-expanded={isArranging}
            aria-controls="arrange-page"
            className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-3 text-[13px] font-medium text-text-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Arrange page
          </button>
          <button
            type="button"
            onClick={() => setActiveView('Accounting')}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-[13px] font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Post an entry
          </button>
        </div>
      </header>

      {isArranging && (
        <section id="arrange-page" aria-labelledby="arrange-heading" className="mb-6 rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="arrange-heading" className="font-display text-[17px] font-bold text-text">Arrange this page</h2>
            <button type="button" onClick={resetLayout} className="inline-flex items-center gap-1.5 text-[12.5px] text-graphite-600 hover:text-ink-900">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset to the standard page
            </button>
          </div>
          <p className="mt-1 text-[12.5px] text-graphite-600">
            Choose what this page shows. Drag a column or section by its handle, or focus the handle and use the arrow keys.
          </p>
          <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {[
              { label: 'Columns', items: widgets.filter(isColumn) },
              { label: 'Sections', items: widgets.filter((w) => !isColumn(w)) },
            ].map((group) => (
              <fieldset key={group.label}>
                <legend className="ll-printed text-[11px] text-graphite-500 pb-1.5">{group.label}</legend>
                <ul className="border-t border-feint">
                  {group.items.map((w) => (
                    <li key={w.id} className="border-b border-feint">
                      <label className="flex items-center gap-2.5 py-2 text-[13px] text-ink-900 cursor-pointer">
                        <input type="checkbox" checked={w.isPinned} onChange={() => togglePin(w.id)} className="h-4 w-4" />
                        {w.title}
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}
          </div>
        </section>
      )}

      {/* The tour anchors to the wrapper so it exists whether figures load, fail or are empty. */}
      <div data-tour="dashboard-summary">
        {metrics.isError ? (
          <Problem error={metrics.error} onRetry={() => metrics.refetch()} what="the figures for this page" />
        ) : metrics.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading figures">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-3 rounded-xl border border-border bg-surface p-5 shadow-sm">
                <div className="h-3 w-16 bg-paper-200" />
                <div className="h-8 w-40 max-w-full bg-paper-200" />
                <div className="h-3 w-28 bg-paper-200" />
              </div>
            ))}
          </div>
        ) : columns.length > 0 ? (
          <section aria-label="Position" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {columns.map(renderColumn)}
          </section>
        ) : null}
      </div>

      {/* Sections */}
      {sections.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">{sections.map(renderSection)}</div>
      )}
    </div>
  );
}
