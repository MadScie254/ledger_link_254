import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, getDayOfYear } from 'date-fns';
import { statutoryDeadlines, dueIn as inDays } from '../../utils/statutory';
import { GripVertical, RotateCcw } from 'lucide-react';
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
 * widgets become the page's analysis columns; the rest become ruled sections.
 */
const DEFAULT_WIDGETS: WidgetDef[] = [
  { id: 'cash-position', title: 'Cash', category: 'KPI', size: 'small', isPinned: true },
  { id: 'money-in', title: 'Owed to you', category: 'KPI', size: 'small', isPinned: true },
  { id: 'money-out', title: 'You owe', category: 'KPI', size: 'small', isPinned: true },
  { id: 'net-profit-kpi', title: 'Net profit', category: 'KPI', size: 'small', isPinned: true },
  { id: 'pnl-breakdown', title: 'Profit and loss to date', category: 'Charts', size: 'medium', isPinned: true },
  { id: 'financial-trends', title: 'Months at a glance', category: 'Charts', size: 'medium', isPinned: true },
  { id: 'unrealized-fx', title: 'Unrealised exchange differences', category: 'KPI', size: 'medium', isPinned: false },
  { id: 'high-value-invoices', title: 'Largest open invoices', category: 'Pinned Entities', size: 'medium', isPinned: true },
  { id: 'top-vendors', title: 'Supplier balances', category: 'Pinned Entities', size: 'medium', isPinned: true },
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


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
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-[13px]">
      <Mark kind="circled" />
      <span className="text-ink-900">Could not load {what}.</span>
      <span className="text-graphite-600">{detail}</span>
      <button type="button" onClick={onRetry} className="text-oxblood underline underline-offset-[3px] hover:text-ink-900">
        Try again
      </button>
    </div>
  );
}

function TextLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-[12.5px] text-oxblood underline underline-offset-[3px] decoration-[color-mix(in_srgb,currentColor_40%,transparent)] hover:decoration-current">
      {children}
    </button>
  );
}

function SectionHeading({ id, children, action }: { id: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-feint-strong pb-2">
      <h2 id={id} className="ll-heading text-[18px] leading-tight text-ink-900">
        {children}
      </h2>
      {action}
    </div>
  );
}

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
  const entries = useQuery({ queryKey: ['journal-entries', currentOrgId], queryFn: () => getJson('/api/journal-entries', currentOrgId) });
  const bankLines = useQuery({ queryKey: ['banking-transactions', currentOrgId], queryFn: () => getJson('/api/banking/transactions', currentOrgId) });

  const m = metrics.data || {};
  const cashCents: number | undefined = metrics.data ? m.cashPositionCents || 0 : undefined;
  const cashChangedFrom = useChangedSince(currentOrgId, 'cash', cashCents);

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
  const monthCount = Math.max(1, (m.monthlyTrends || []).length);

  /* Recent entries ------------------------------------------------------- */
  const recentEntries = [...(entries.data?.entries || [])]
    .sort((a: any, b: any) => String(b.entryDate).localeCompare(String(a.entryDate)))
    .slice(0, 8)
    .map((entry: any) => ({
      ...entry,
      amountCents: (entry.lines || []).reduce((sum: number, line: any) => sum + Number(line.debit || 0), 0),
    }));
  const recentTotal = recentEntries.reduce((sum: number, e: any) => sum + e.amountCents, 0);
  const postedUpTo = recentEntries[0]?.entryDate;

  /* ──────────────────────────────────────────────────────────────────── */

  const wideColumns = Math.min(4, columns.length);
  // Printed rules between analysis columns: two across on a phone, up to four
  // across on a wide screen, with a rule above any column that wraps.
  const columnRules = (i: number) =>
    [
      i % 2 === 1 ? 'border-l' : '',
      i >= 2 ? 'border-t' : '',
      i % wideColumns !== 0 ? 'lg:border-l' : 'lg:border-l-0',
      i >= wideColumns ? 'lg:border-t' : 'lg:border-t-0',
    ].join(' ');

  const renderColumn = (widget: WidgetDef, index: number) => {
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
        const monthlySpend = (m.totalExpenseCents || 0) / monthCount;
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

    return (
      <div
        key={widget.id}
        role="group"
        aria-labelledby={`col-${widget.id}`}
        draggable
        onDragStart={(e) => drag.onDragStart(e, widget.id)}
        onDragOver={(e) => drag.onDragOver(e, widget.id)}
        onDragEnd={drag.onDragEnd}
        className={`group min-w-0 row-span-3 grid grid-rows-subgrid gap-0 py-4 px-3 sm:px-4 border-feint-strong ${columnRules(index)} ${
          drag.draggedId === widget.id ? 'bg-paper-200' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-2 pb-3">
          <h3 id={`col-${widget.id}`} className="ll-printed text-[11.5px] text-graphite-600">
            {widget.title}
          </h3>
          <MoveHandle widget={widget} onMove={drag.onMove} />
        </div>
        <div className="pb-2.5">{figure}</div>
        <div className="flex flex-col items-start gap-1.5 text-[12.5px] leading-snug text-graphite-600">
          <span>{note}</span>
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
        const byMonth = [...(m.monthlyTrends || [])].sort(
          (a: any, b: any) => MONTHS.indexOf(a.month) - MONTHS.indexOf(b.month),
        );
        const scale = Math.max(1, ...byMonth.flatMap((d: any) => [d.revenue || 0, d.expense || 0]));
        body =
          byMonth.length === 0 ? (
            <p className="py-6 text-[13px] text-graphite-600">Each month's sales and spending appear here once entries are posted in it.</p>
          ) : (
            <figure>
              <div className="flex items-end gap-2 sm:gap-3 pt-4" aria-hidden="true">
                {byMonth.map((d: any) => {
                  const net = (d.revenue || 0) - (d.expense || 0);
                  return (
                    <div key={d.month} className="flex-1 min-w-0 flex flex-col items-stretch">
                      <div className="h-28 flex items-end justify-center gap-[3px] border-b border-feint-strong">
                        <div className="w-full max-w-3 bg-ink-900" style={{ height: `${((d.revenue || 0) / scale) * 100}%` }} />
                        <div className="w-full max-w-3 border border-graphite-500 bg-paper-200" style={{ height: `${((d.expense || 0) / scale) * 100}%` }} />
                      </div>
                      <span className="mt-1.5 text-center ll-printed text-[10.5px] text-graphite-600">{d.month}</span>
                      <span className="text-center">
                        <Amount cents={net * 100} currency={currency} size="xs" tone="result" />
                      </span>
                    </div>
                  );
                })}
              </div>
              <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-graphite-600">
                <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 bg-ink-900" />Sales</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 border border-graphite-500 bg-paper-200" />Spending</span>
                <span>Every month drawn to the same scale. The figure under each month is sales less spending.</span>
              </figcaption>
              <table className="sr-only">
                <caption>Sales and spending by month, {currency}</caption>
                <thead>
                  <tr><th scope="col">Month</th><th scope="col">Sales</th><th scope="col">Spending</th></tr>
                </thead>
                <tbody>
                  {byMonth.map((d: any) => (
                    <tr key={d.month}><th scope="row">{d.month}</th><td>{d.revenue}</td><td>{d.expense}</td></tr>
                  ))}
                </tbody>
              </table>
            </figure>
          );
        break;
      }

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
        className={`group min-w-0 ${drag.draggedId === widget.id ? 'opacity-50' : ''}`}
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
        <div className="pt-1">{body}</div>
      </section>
    );
  };

  /* ──────────────────────────────────────────────────────────────────── */

  return (
    <div className="pb-16">
      {/* Today's page */}
      <header className="flex flex-col gap-4 border-b-2 border-ink-900 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="ll-heading text-[30px] sm:text-[38px] leading-[0.95] text-ink-900">
            {format(today, 'EEEE d MMMM')}
          </h1>
          <p className="mt-2 text-[13px] text-graphite-600">
            {format(today, 'yyyy')} · Books of {activeCompany?.name || 'your organization'} · Figures in {currency}
            {postedUpTo && <> · Posted up to {format(new Date(postedUpTo), 'd MMM yyyy')}</>}
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="ll-printed text-[11.5px] text-graphite-500">Page {getDayOfYear(today)}</span>
          <button
            type="button"
            onClick={() => setIsArranging((open) => !open)}
            aria-expanded={isArranging}
            aria-controls="arrange-page"
            className="text-[13px] text-graphite-600 underline underline-offset-[3px] decoration-feint-strong hover:text-ink-900 hover:decoration-current"
          >
            Arrange page
          </button>
          <button
            type="button"
            onClick={() => setActiveView('Accounting')}
            className="inline-flex items-center justify-center h-9 px-3.5 rounded-sm bg-oxblood-fill text-white text-[13.5px] font-semibold hover:bg-[var(--oxblood-fill-hover)]"
          >
            Post an entry
          </button>
        </div>
      </header>

      {isArranging && (
        <section id="arrange-page" aria-labelledby="arrange-heading" className="mt-5 border border-feint-strong bg-paper-100 p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="arrange-heading" className="ll-heading text-[17px] text-ink-900">Arrange this page</h2>
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

      {/* Analysis columns */}
      {metrics.isError ? (
        <Problem error={metrics.error} onRetry={() => metrics.refetch()} what="the figures for this page" />
      ) : metrics.isLoading ? (
        <div data-tour="dashboard-summary" className="grid grid-cols-2 lg:grid-cols-4 border-b border-feint-strong" aria-busy="true" aria-label="Loading figures">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`py-4 px-4 space-y-3 ${i > 0 ? 'lg:border-l border-feint-strong' : ''}`}>
              <div className="h-3 w-16 bg-paper-200" />
              <div className="h-8 w-40 max-w-full bg-paper-200" />
              <div className="h-3 w-28 bg-paper-200" />
            </div>
          ))}
        </div>
      ) : columns.length > 0 ? (
        <section data-tour="dashboard-summary" aria-label="Position" className={`grid grid-cols-2 ${wideColumns === 4 ? 'lg:grid-cols-4' : wideColumns === 3 ? 'lg:grid-cols-3' : ''} border-b border-feint-strong`}>
          {columns.map(renderColumn)}
        </section>
      ) : null}

      {/* Queries and entries */}
      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-8">
        <section aria-labelledby="queries-heading" className="ll-margin pl-5">
          <SectionHeading id="queries-heading">Queries</SectionHeading>
          <ul className="text-[13.5px]">
            {(m.overdueInvoices || 0) > 0 && (
              <li className="border-b border-feint">
                <button type="button" onClick={() => setActiveView('Sales')} className="w-full text-left py-2.5 flex gap-2.5 hover:bg-paper-200">
                  <Mark kind="circled" className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-ink-900">
                      {m.overdueInvoices} {m.overdueInvoices === 1 ? 'invoice is' : 'invoices are'} overdue
                    </span>
                    <span className="block mt-0.5"><Amount cents={m.overdueCents || 0} currency={currency} size="sm" /></span>
                  </span>
                </button>
              </li>
            )}
            {unmatchedLines.length > 0 && (
              <li className="border-b border-feint">
                <button type="button" onClick={() => setActiveView('Banking')} className="w-full text-left py-2.5 flex gap-2.5 hover:bg-paper-200">
                  <Mark kind="query" className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-ink-900">
                      {unmatchedLines.length} bank {unmatchedLines.length === 1 ? 'line' : 'lines'} not matched
                    </span>
                    <span className="block mt-0.5 text-[12px] text-graphite-600">Match them to invoices or bills in Banking</span>
                  </span>
                </button>
              </li>
            )}
            {(m.moneyOutCents || 0) > 0 && (
              <li className="border-b border-feint">
                <button type="button" onClick={() => setActiveView('Expenses & Bills')} className="w-full text-left py-2.5 flex gap-2.5 hover:bg-paper-200">
                  <Mark kind="query" className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-ink-900">Bills to pay</span>
                    <span className="block mt-0.5"><Amount cents={m.moneyOutCents || 0} currency={currency} size="sm" /></span>
                  </span>
                </button>
              </li>
            )}
            {deadlines.map((d) => (
              <li key={d.id} className="border-b border-feint">
                <button type="button" onClick={() => setActiveView(d.view)} className="w-full text-left py-2.5 flex gap-2.5 hover:bg-paper-200">
                  <Mark kind="query" className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-ink-900">{d.label}</span>
                      <span className="shrink-0 text-[12.5px] font-semibold text-ink-900">{format(d.due, 'EEE d MMM')}</span>
                    </span>
                    <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[12px] text-graphite-600">
                      <span>{d.rule}</span>
                      <span className="shrink-0">{inDays(d.due, today)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="entries-heading" className="min-w-0">
          <SectionHeading id="entries-heading" action={<TextLink onClick={() => setActiveView('Accounting')}>All journal entries</TextLink>}>
            Recent entries
          </SectionHeading>
          {entries.isError ? (
            <Problem error={entries.error} onRetry={() => entries.refetch()} what="recent entries" />
          ) : entries.isLoading ? (
            <div className="space-y-0" aria-busy="true" aria-label="Loading entries">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 border-b border-feint flex items-center gap-4">
                  <div className="h-3 w-12 bg-paper-200" />
                  <div className="h-3 flex-1 bg-paper-200" />
                  <div className="h-3 w-24 bg-paper-200" />
                </div>
              ))}
            </div>
          ) : recentEntries.length === 0 ? (
            <div className="py-6 text-[13.5px] text-graphite-600">
              <p>No entries are posted yet. Posted entries are listed here, newest first, with their totals carried to the foot.</p>
              <div className="mt-2"><TextLink onClick={() => setActiveView('Accounting')}>Post the first entry</TextLink></div>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">The {recentEntries.length} most recent journal entries, {currency}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-left pr-3 w-16">Date</th>
                    <th scope="col" className="hidden sm:table-cell text-left pr-3 w-24">Ref.</th>
                    <th scope="col" className="text-left pr-3">Particulars</th>
                    <th scope="col" className="text-right">{currency}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEntries.map((entry: any) => (
                    <tr key={entry.id}>
                      <td className="pr-3 text-graphite-600 whitespace-nowrap">{entry.entryDate ? format(new Date(entry.entryDate), 'dd/MM') : '–'}</td>
                      <td className="hidden sm:table-cell pr-3 text-graphite-600 whitespace-nowrap">{entry.referenceNo || '–'}</td>
                      <td className="pr-3 min-w-0">
                        <button type="button" onClick={() => setActiveView('Accounting')} className="text-left text-ink-900 hover:underline underline-offset-[3px]">
                          {entry.memo || 'Journal entry'}
                        </button>
                      </td>
                      <td className="text-right"><Amount cents={entry.amountCents} currency={currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ll-total mt-px flex items-baseline justify-between gap-4 py-2 text-[13.5px]">
                <span className="font-semibold text-ink-900">Total of the {recentEntries.length} entries shown</span>
                <Amount cents={recentTotal} currency={currency} tone="ink" className="font-semibold" />
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Sections */}
      {sections.length > 0 && !metrics.isError && (
        <div className="mt-12 grid grid-cols-1 gap-x-10 gap-y-12 lg:grid-cols-2">{sections.map(renderSection)}</div>
      )}
    </div>
  );
}
