import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useMutation } from '@tanstack/react-query';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';
import {
  centsFromAmountText,
  isStockedItemType,
  lineAmounts,
  MAX_LINE_CENTS,
  orderTotals,
  quantityProblem,
  taxRateProblem,
} from '../../utils/salesOrders';

interface DraftLine {
  key: number;
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  accountId: string;
}

interface Checked {
  line: DraftLine;
  item: any | null;
  stocked: boolean;
  problem: string | null;
  amountCents: number;
  taxCents: number;
  unitPriceCents: number | null;
}

export type SalesDocumentKind = 'order' | 'estimate' | 'receipt';

/** What differs between the documents this builder writes. */
const KINDS: Record<SalesDocumentKind, {
  endpoint: string;
  title: string;
  editTitle: string;
  note: string;
  dateLabel: string;
  dateKey: string;
  secondDate: { label: string; key: string; hint: string } | null;
  linesHeading: string;
  totalLabel: string;
  submit: string;
  pending: string;
  failed: string;
  stockNote: (onHand: number) => string;
  serviceNote: string;
  notesHint: string;
  /** A sale paid on the spot: no customer needed, and the account the money went into. */
  paidNow?: boolean;
}> = {
  order: {
    endpoint: '/api/sales-orders',
    title: 'New order',
    editTitle: 'Edit order',
    note: 'Recorded now, invoiced when you choose. An order does not post to the books.',
    dateLabel: 'Order date',
    dateKey: 'orderDate',
    secondDate: { label: 'Promised for', key: 'promisedDate', hint: 'Optional' },
    linesHeading: 'What was ordered',
    totalLabel: 'Order total',
    submit: 'Record order',
    pending: 'Recording',
    failed: 'The order could not be recorded.',
    stockNote: (onHand) => `Only ${onHand} in stock. The order can still be recorded; completing it takes the count below zero.`,
    serviceNote: 'A service: completing the order does not change any stock count.',
    notesHint: 'Optional. Delivery address, colours, anything the team needs.',
  },
  estimate: {
    endpoint: '/api/estimates',
    title: 'New estimate',
    editTitle: 'Edit estimate',
    note: 'A priced offer to the customer. Nothing posts to the books until it becomes an invoice.',
    dateLabel: 'Estimate date',
    dateKey: 'estimateDate',
    secondDate: { label: 'Valid until', key: 'expiryDate', hint: 'Optional' },
    linesHeading: 'What is quoted',
    totalLabel: 'Estimate total',
    submit: 'Save estimate',
    pending: 'Saving',
    failed: 'The estimate could not be saved.',
    stockNote: (onHand) => `Only ${onHand} in stock now.`,
    serviceNote: 'A service, not counted as stock.',
    notesHint: 'Optional. Scope, terms or anything the customer should know.',
  },
  receipt: {
    endpoint: '/api/sales-receipts',
    title: 'New sales receipt',
    editTitle: 'Sales receipt',
    note: 'A sale paid on the spot. Income, VAT and the money received post together, and stock items are counted out.',
    dateLabel: 'Date',
    dateKey: 'date',
    secondDate: null,
    linesHeading: 'What was sold',
    totalLabel: 'Received',
    submit: 'Post sales receipt',
    pending: 'Posting',
    failed: 'The sales receipt could not be posted.',
    stockNote: (onHand) => `Only ${onHand} in stock. The sale can still be posted; the count goes below zero.`,
    serviceNote: 'A service, not counted as stock.',
    notesHint: 'Optional',
    paidNow: true,
  },
};

export interface SalesDocumentDraft {
  id: string;
  customerId: string;
  date: string;
  secondDate?: string | null;
  notes?: string | null;
  lines: Array<{ inventoryItemId?: string | null; description: string; quantity: number; unitPriceCents: number; taxRate: number; accountId: string }>;
}

/**
 * Writes a customer's order or an estimate: who it is for, its dates, and
 * priced lines with stock items, quantities and VAT. Nothing here posts to
 * the books; the totals are a preview computed the same way the database
 * computes them. With `initial`, the document is rewritten instead.
 */
export function SalesDocumentBuilder({
  kind,
  orgId,
  baseCurrency,
  customers,
  incomeAccounts,
  items,
  moneyAccounts = [],
  initial,
  onClose,
  onRecorded,
}: {
  kind: SalesDocumentKind;
  orgId: string;
  baseCurrency: string;
  customers: any[];
  incomeAccounts: any[];
  items: any[];
  /** Bank, cash and M-Pesa accounts, for a sales receipt. */
  moneyAccounts?: any[];
  initial?: SalesDocumentDraft | null;
  onClose: () => void;
  onRecorded: (document: any) => void;
}) {
  const config = KINDS[kind];
  // One key per opening of the form: pressing the button twice saves one document.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [customerId, setCustomerId] = useState(initial?.customerId || '');
  const [orderDate, setOrderDate] = useState(initial?.date || format(new Date(), 'yyyy-MM-dd'));
  const [promisedDate, setPromisedDate] = useState(initial?.secondDate || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [payeeName, setPayeeName] = useState('');
  const [depositAccountId, setDepositAccountId] = useState(moneyAccounts[0]?.id || '');
  const [reference, setReference] = useState('');
  const [problem, setProblem] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => initial?.lines.length
    ? initial.lines.map((line, index) => ({
        key: index + 1,
        itemId: line.inventoryItemId || '',
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: (line.unitPriceCents / 100).toFixed(2),
        taxRate: String(line.taxRate),
        accountId: line.accountId,
      }))
    : [{ key: 1, itemId: '', description: '', quantity: '1', unitPrice: '', taxRate: '0', accountId: incomeAccounts[0]?.id || '' }]);

  const setLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const chooseItem = (key: number, itemId: string) => {
    const item = items.find((candidate: any) => candidate.id === itemId);
    if (!item) {
      setLine(key, { itemId: '' });
      return;
    }
    const accountId = incomeAccounts.some((account: any) => account.id === item.incomeAccountId)
      ? item.incomeAccountId
      : undefined;
    setLine(key, {
      itemId,
      description: item.name || '',
      unitPrice: ((Number(item.unitPriceCents) || 0) / 100).toFixed(2),
      ...(accountId ? { accountId } : {}),
    });
  };

  const checked: Checked[] = useMemo(() => lines.map((line) => {
    const item = line.itemId ? items.find((candidate: any) => candidate.id === line.itemId) || null : null;
    const stocked = Boolean(item) && isStockedItemType(item?.type);
    const unitPriceCents = centsFromAmountText(line.unitPrice);
    let lineProblem: string | null = null;
    if (!line.description.trim()) lineProblem = 'Describe what was ordered.';
    else if (line.description.trim().length > 500) lineProblem = 'Keep the description to 500 characters.';
    else lineProblem = quantityProblem(line.quantity, Boolean(item))
      || (unitPriceCents === null ? 'Enter a unit price in shillings, such as 750 or 750.50.' : null)
      || taxRateProblem(line.taxRate)
      || (!line.accountId ? 'Choose the income account the sale goes to.' : null);

    let amountCents = 0;
    let taxCents = 0;
    if (!lineProblem && unitPriceCents !== null) {
      ({ amountCents, taxCents } = lineAmounts(line.quantity, unitPriceCents, line.taxRate));
      if (amountCents <= 0) lineProblem = 'This line comes to nothing; give it a price.';
      else if (amountCents > MAX_LINE_CENTS) lineProblem = 'This line is too large to record.';
    }
    return { line, item, stocked, problem: lineProblem, amountCents, taxCents, unitPriceCents };
  }), [lines, items]);

  const totals = orderTotals(checked.filter((c) => !c.problem));

  const record = useMutation({
    mutationFn: async () => {
      const res = await fetch(initial ? `${config.endpoint}/${initial.id}` : config.endpoint, {
        method: initial ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          customerId: customerId || undefined,
          [config.dateKey]: orderDate,
          ...(config.secondDate ? { [config.secondDate.key]: promisedDate || undefined } : {}),
          ...(config.paidNow
            ? { memo: notes.trim() || undefined, payeeName: customerId ? undefined : payeeName.trim() || undefined, depositAccountId, reference: reference.trim() || undefined }
            : { notes: notes.trim() || undefined }),
          idempotencyKey,
          lines: checked.map(({ line, unitPriceCents }) => ({
            description: line.description.trim(),
            accountId: line.accountId,
            inventoryItemId: line.itemId || undefined,
            quantity: Number(line.quantity.trim()),
            unitPriceCents,
            taxRate: Number(line.taxRate.trim() || '0'),
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || config.failed);
      return body;
    },
    onSuccess: (document) => onRecorded(document),
    onError: (err: Error) => setProblem(err.message),
  });

  const submit = () => {
    setProblem('');
    if (!customerId && !config.paidNow) return setProblem(kind === 'order' ? 'Choose the customer who placed the order.' : 'Choose the customer.');
    if (!orderDate) return setProblem(`Enter the ${config.dateLabel.toLowerCase()}.`);
    if (config.secondDate && promisedDate && promisedDate < orderDate) return setProblem(`${config.secondDate.label} cannot be before the ${config.dateLabel.toLowerCase()}.`);
    if (config.paidNow && !depositAccountId) return setProblem('Choose the account the money went into.');
    const firstBad = checked.findIndex((c) => c.problem);
    if (firstBad !== -1) return setProblem(`Line ${firstBad + 1}: ${checked[firstBad].problem}`);
    record.mutate();
  };

  return (
    <Dialog
      open
      onClose={() => { if (!record.isPending) onClose(); }}
      width="lg"
      title={initial ? config.editTitle : config.title}
      note={config.note}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={record.isPending} className={buttonClass.secondary}>Cancel</button>
          <button type="button" onClick={submit} disabled={record.isPending} className={buttonClass.primary}>
            {record.isPending ? config.pending : config.submit}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            label="Customer"
            hint={config.paidNow ? 'Optional for a walk-in sale.' : customers.length === 0 ? 'Add the customer under Customers first. For walk-in sales, add one called Walk-in.' : undefined}
          >
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">{config.paidNow ? 'Walk-in, no customer record' : 'Choose a customer'}</option>
              {customers.map((customer: any) => (
                <option key={customer.id} value={customer.id}>{customer.displayName}</option>
              ))}
            </select>
          </Field>
          {config.paidNow && !customerId && (
            <Field label="Name on the receipt" hint="Optional">
              <input maxLength={200} value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
            </Field>
          )}
          <Field label={config.dateLabel}>
            <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </Field>
          {config.secondDate && (
            <Field label={config.secondDate.label} hint={config.secondDate.hint}>
              <input type="date" min={orderDate} value={promisedDate} onChange={(e) => setPromisedDate(e.target.value)} />
            </Field>
          )}
          {config.paidNow && (
            <>
              <Field label="Received into" hint={moneyAccounts.length === 0 ? 'Mark a bank, cash or M-Pesa account as holding money (Accounting, Edit) first.' : undefined}>
                <select value={depositAccountId} onChange={(e) => setDepositAccountId(e.target.value)}>
                  <option value="">Choose an account</option>
                  {moneyAccounts.map((account: any) => (
                    <option key={account.id} value={account.id}>{account.code} · {account.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Reference" hint="Optional, such as the M-Pesa code">
                <input maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </>
          )}
        </div>

        <section aria-labelledby="order-lines">
          <h3 id="order-lines" className="text-[14px] font-semibold text-ink-900 border-b border-feint-strong pb-1.5">{config.linesHeading} <span className="font-normal text-graphite-600">· prices in {baseCurrency}</span></h3>
          <ol className="divide-y divide-feint">
            {checked.map(({ line, item, stocked, problem: lineProblem, amountCents }, index) => {
              const onHand = Number(item?.quantityOnHand ?? 0);
              const quantity = Number(line.quantity);
              return (
                <li key={line.key} className="py-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-12 sm:items-end">
                    <label className="col-span-2 sm:col-span-3 block">
                      <span className="block text-[12.5px] font-semibold text-ink-900">Stock item</span>
                      <select
                        aria-label={`Line ${index + 1} stock item`}
                        value={line.itemId}
                        onChange={(e) => chooseItem(line.key, e.target.value)}
                        className="mt-1 h-10 w-full border px-2.5 text-[14px]"
                      >
                        <option value="">None, describe it</option>
                        {items.map((candidate: any) => (
                          <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="col-span-2 sm:col-span-3 block">
                      <span className="block text-[12.5px] font-semibold text-ink-900">Description</span>
                      <input
                        aria-label={`Line ${index + 1} description`}
                        value={line.description}
                        onChange={(e) => setLine(line.key, { description: e.target.value })}
                        className="mt-1 h-10 w-full border px-3 text-[14px]"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="block text-[12.5px] font-semibold text-ink-900">Qty</span>
                      <input
                        aria-label={`Line ${index + 1} quantity`}
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                        className="mt-1 h-10 w-full border px-3 text-right text-[14px] tabular-currency"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="block text-[12.5px] font-semibold text-ink-900">Unit price</span>
                      <input
                        aria-label={`Line ${index + 1} unit price, ${baseCurrency}`}
                        inputMode="decimal"
                        value={line.unitPrice}
                        onChange={(e) => setLine(line.key, { unitPrice: e.target.value })}
                        className="mt-1 h-10 w-full border px-3 text-right text-[14px] tabular-currency"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="block text-[12.5px] font-semibold text-ink-900">VAT %</span>
                      <input
                        aria-label={`Line ${index + 1} VAT rate`}
                        inputMode="decimal"
                        value={line.taxRate}
                        onChange={(e) => setLine(line.key, { taxRate: e.target.value })}
                        className="mt-1 h-10 w-full border px-3 text-right text-[14px] tabular-currency"
                      />
                    </label>
                    <label className="col-span-2 sm:col-span-6 block">
                      <span className="block text-[12.5px] font-semibold text-ink-900">Income account</span>
                      <select
                        aria-label={`Line ${index + 1} income account`}
                        value={line.accountId}
                        onChange={(e) => setLine(line.key, { accountId: e.target.value })}
                        className="mt-1 h-10 w-full border px-2.5 text-[14px]"
                      >
                        <option value="">Choose an account</option>
                        {incomeAccounts.map((account: any) => (
                          <option key={account.id} value={account.id}>{account.code} {account.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="col-span-2 sm:col-span-6 flex items-baseline justify-between gap-3 sm:justify-end sm:pb-2.5">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                          className={`${buttonClass.quiet} mr-auto`}
                          aria-label={`Remove line ${index + 1}`}
                        >
                          Remove
                        </button>
                      )}
                      <span className="text-[12.5px] text-graphite-600">Line, before VAT</span>
                      <Amount cents={lineProblem ? 0 : amountCents} currency={baseCurrency} tone="ink" />
                    </div>
                  </div>
                  {stocked && Number.isFinite(quantity) && quantity > onHand && (
                    <p className="mt-1.5 text-[12.5px] text-graphite-600">{config.stockNote(onHand)}</p>
                  )}
                  {item && !stocked && (
                    <p className="mt-1.5 text-[12.5px] text-graphite-600">{config.serviceNote}</p>
                  )}
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, {
              key: Math.max(...prev.map((l) => l.key)) + 1,
              itemId: '', description: '', quantity: '1', unitPrice: '', taxRate: '0',
              accountId: incomeAccounts[0]?.id || '',
            }])}
            disabled={lines.length >= 200}
            className={`${buttonClass.quiet} mt-2`}
          >
            Add a line
          </button>
        </section>

        <dl className="text-[13.5px]">
          <div className="flex items-baseline justify-between gap-4 py-2 border-b border-feint">
            <dt className="text-ink-900">Subtotal</dt>
            <dd><Amount cents={totals.subtotalCents} currency={baseCurrency} tone="ink" /></dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-2 border-b border-feint">
            <dt className="text-ink-900">VAT</dt>
            <dd><Amount cents={totals.taxCents} currency={baseCurrency} tone="ink" /></dd>
          </div>
          <div className="ll-total flex items-baseline justify-between gap-4 py-2">
            <dt className="font-semibold text-ink-900">{config.totalLabel}, {baseCurrency}</dt>
            <dd><Amount cents={totals.totalCents} currency={baseCurrency} tone="ink" className="font-semibold" /></dd>
          </div>
        </dl>

        <Field label="Notes" hint={config.notesHint}>
          <textarea rows={2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {problem && <p role="alert" className="text-[13.5px] text-ledger-red">{problem}</p>}
      </div>
    </Dialog>
  );
}

/** The order form, as the Orders tab has always opened it. */
export function OrderBuilder(props: Omit<Parameters<typeof SalesDocumentBuilder>[0], 'kind'>) {
  return <SalesDocumentBuilder kind="order" {...props} />;
}
