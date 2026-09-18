import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { X } from 'lucide-react';
import { useAppStore } from '../../store';
import { SUPPORTED_CURRENCIES } from '../../utils/currency';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { Amount } from '../ledger/Amount';
import { Field } from '../ledger/Dialog';
import { PageHeading, EmptyNote, buttonClass } from '../ledger/Page';

interface Line {
  key: number;
  description: string;
  accountId: string;
  amount: string;
  taxRate: string;
}

/** Particulars, account, amount and a remove control, shared by the column heads and every line. */
const LINE_GRID = 'sm:grid-cols-[minmax(0,1fr)_14rem_5rem_10rem_2rem]';

const toCents = (value: string) => Math.round(parseFloat(value || '0') * 100) || 0;

/**
 * The invoice as a page being written: who it is for and when, then its lines
 * ruled like particulars, then the total under a red rule. Posting it writes
 * the receivable and income entries in one journal.
 */
export function InvoiceBuilder({ onDone }: { onDone: () => void }) {
  const { currentOrgId, activeCompany, exchangeRates } = useAppStore();
  const queryClient = useQueryClient();
  const base = activeCompany?.baseCurrency || 'KES';

  const [customerId, setCustomerId] = useState('');
  const [issueDate, setIssueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [currency, setCurrency] = useState(base);
  const [rate, setRate] = useState('1');
  const [lines, setLines] = useState<Line[]>([{ key: 1, description: '', accountId: '', amount: '', taxRate: '0' }]);
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [problem, setProblem] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const customersQuery = useQuery({
    queryKey: ['customers', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/customers', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch customers');
      return res.json();
    },
  });

  const accountsQuery = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    },
  });

  const customers: any[] = customersQuery.data?.customers || [];
  const incomeAccounts: any[] = (accountsQuery.data?.accounts || []).filter((a: any) => a.type === 'INCOME');
  const isForeign = currency !== base;
  const rateNum = parseFloat(rate) > 0 ? parseFloat(rate) : 1;
  const subtotalCents = lines.reduce((sum, line) => sum + toCents(line.amount), 0);
  const baseTaxCents = lines.reduce((sum, line) => {
    const netCents = toCents(line.amount);
    const taxRate = Number(line.taxRate) || 0;
    const baseNetCents = isForeign ? Math.round(netCents / rateNum) : netCents;
    return sum + Math.round(baseNetCents * taxRate / 100);
  }, 0);
  const displayedTaxCents = isForeign ? Math.round(baseTaxCents * rateNum) : baseTaxCents;
  const totalCents = subtotalCents + displayedTaxCents;

  const setLine = (key: number, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { key: Math.max(...prev.map((l) => l.key)) + 1, description: '', accountId: incomeAccounts[0]?.id || '', amount: '', taxRate: '0' }]);
  const removeLine = (key: number) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));

  const changeCurrency = (code: string) => {
    setCurrency(code);
    setRate(code === base ? '1' : String(exchangeRates[code] || 1));
  };

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem('');
    if (subtotalCents <= 0) {
      setProblem('Enter an amount on at least one line.');
      return;
    }
    setIsPosting(true);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({
          customerId,
          issueDate: new Date(issueDate).toISOString(),
          dueDate: new Date(dueDate).toISOString(),
          currency,
          exchangeRate: rateNum,
          idempotencyKey,
          // A foreign line is sent as its foreign amount; the server converts it
          // to the base currency at the invoice rate before posting.
          lines: lines
            .filter((l) => toCents(l.amount) > 0)
            .map((l) => {
              const foreignOrBaseNet = toCents(l.amount);
              const baseNet = isForeign ? Math.round(foreignOrBaseNet / rateNum) : foreignOrBaseNet;
              const taxCents = Math.round(baseNet * (Number(l.taxRate) || 0) / 100);
              return isForeign
                ? { description: l.description, accountId: l.accountId, amountCents: baseNet, foreignAmountCents: foreignOrBaseNet, taxCents }
                : { description: l.description, accountId: l.accountId, amountCents: baseNet, taxCents };
            }),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'The invoice could not be posted.');
      }
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onDone();
    } catch (err: any) {
      setProblem(err.message);
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-5 pb-16">
      <div>
        <button type="button" onClick={onDone} className={buttonClass.quiet}>
          Sales
        </button>
        <div className="mt-2">
          <PageHeading title="New invoice" note="Posting it records the amount owed and the income in one journal entry." />
        </div>
      </div>

      {customersQuery.isSuccess && customers.length === 0 ? (
        <EmptyNote
          action={
            <button type="button" onClick={() => setIsAddingCustomer(true)} className={buttonClass.quiet}>
              Add a customer
            </button>
          }
        >
          An invoice needs a customer. Add one to continue.
        </EmptyNote>
      ) : (
        <form onSubmit={post} className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Field label="Customer">
                <select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Choose a customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.displayName}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Issued">
              <input type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </Field>
            <Field label="Due">
              <input type="date" required min={issueDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Currency">
              <select value={currency} onChange={(e) => changeCurrency(e.target.value)}>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
                ))}
              </select>
            </Field>
            {isForeign && (
              <Field label={`${currency} per 1 ${base}`} hint={`1 ${currency} = ${(1 / rateNum).toFixed(2)} ${base}`}>
                <input type="number" step="any" min="0" inputMode="decimal" required value={rate} onChange={(e) => setRate(e.target.value)} className="tabular-currency" />
              </Field>
            )}
          </div>

          <div>
            {/* Ruled like a table from sm up; on a phone each line stacks so the amount and total stay on screen. */}
            <div role="group" aria-label={`Invoice lines, amounts in ${currency}`}>
              <div className={`hidden border-b border-feint-strong pb-1.5 sm:grid ${LINE_GRID}`} aria-hidden="true">
                <span className="ll-printed text-[11px] text-graphite-600">Particulars</span>
                <span className="ll-printed text-[11px] text-graphite-600">Income account</span>
                <span className="ll-printed text-right text-[11px] text-graphite-600">VAT %</span>
                <span className="ll-printed text-right text-[11px] text-graphite-600">Amount</span>
                <span />
              </div>
              <ol>
                {lines.map((l, i) => (
                  <li key={l.key} className={`grid grid-cols-1 gap-2 border-b border-feint py-3 sm:items-center sm:gap-3 sm:py-2 ${LINE_GRID}`}>
                    <label className="block">
                      <span className="mb-1 block text-[12.5px] text-graphite-600 sm:sr-only">Line {i + 1} particulars</span>
                      <input required value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} className="h-10 w-full border px-2.5 sm:h-9" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[12.5px] text-graphite-600 sm:sr-only">Line {i + 1} income account</span>
                      <select required value={l.accountId} onChange={(e) => setLine(l.key, { accountId: e.target.value })} className="h-10 w-full border px-2 sm:h-9">
                        <option value="">Choose an account</option>
                        {incomeAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[12.5px] text-graphite-600 sm:sr-only">Line {i + 1} VAT percentage</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        inputMode="decimal"
                        value={l.taxRate}
                        onChange={(e) => setLine(l.key, { taxRate: e.target.value })}
                        className="h-10 w-full border px-2 text-right tabular-currency sm:h-9"
                      />
                    </label>
                    <div className="flex items-end gap-2">
                      <label className="block min-w-0 flex-1">
                        <span className="mb-1 block text-[12.5px] text-graphite-600 sm:sr-only">Line {i + 1} amount in {currency}</span>
                        <input
                          required
                          type="number"
                          step="0.01"
                          min="0.01"
                          inputMode="decimal"
                          value={l.amount}
                          onChange={(e) => setLine(l.key, { amount: e.target.value })}
                          className="h-10 w-full border px-2.5 text-right tabular-currency text-ink-blue sm:h-9"
                        />
                      </label>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => removeLine(l.key)} aria-label={`Remove line ${i + 1}`} className="mb-2 p-1 text-graphite-600 hover:text-ledger-red sm:hidden">
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <div className="hidden sm:block">
                      {lines.length > 1 && (
                        <button type="button" onClick={() => removeLine(l.key)} aria-label={`Remove line ${i + 1}`} className="p-1 text-graphite-600 hover:text-ledger-red">
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="sm:pr-[calc(2rem+0.75rem)]">
                <div className="flex items-baseline justify-between gap-4 border-b border-feint py-1.5 text-[13px] text-graphite-600">
                  <span>Subtotal</span>
                  <Amount cents={subtotalCents} currency={currency} size="xs" tone="ink" />
                </div>
                <div className="flex items-baseline justify-between gap-4 border-b border-feint py-1.5 text-[13px] text-graphite-600">
                  <span>VAT</span>
                  <Amount cents={displayedTaxCents} currency={currency} size="xs" tone="ink" />
                </div>
                <div className="ll-total flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                  <span className="font-semibold text-ink-900">
                    Total
                    {isForeign && totalCents > 0 && (
                      <span className="ml-2 font-normal text-graphite-600">
                        posts as <Amount cents={Math.round(subtotalCents / rateNum) + baseTaxCents} currency={base} size="xs" tone="ink" />
                      </span>
                    )}
                  </span>
                  <span className="font-semibold" aria-live="polite">
                    <Amount cents={totalCents} currency={currency} tone="ink" />
                  </span>
                </div>
              </div>
            </div>
            <button type="button" onClick={addLine} className={`${buttonClass.quiet} mt-3`}>
              Add a line
            </button>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-feint pt-4 sm:flex-row sm:items-center sm:justify-end">
            {problem && (
              <p role="alert" className="text-[13.5px] text-ledger-red sm:mr-auto">
                {problem}
              </p>
            )}
            <button type="button" onClick={onDone} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" disabled={isPosting} className={buttonClass.primary}>
              {isPosting ? 'Posting' : 'Post invoice'}
            </button>
          </div>
        </form>
      )}

      <DynamicQuickAddModal
        isOpen={isAddingCustomer}
        onClose={() => {
          setIsAddingCustomer(false);
          queryClient.invalidateQueries({ queryKey: ['customers', currentOrgId] });
        }}
        overrideType="CUSTOMER"
      />
    </div>
  );
}
