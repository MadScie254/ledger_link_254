import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { OrganizationData } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { centsFromAmountText } from '../../utils/salesOrders';
import { DEFAULT_TIME_ZONE, isTimeZone } from '../../utils/dates';
import { Amount } from '../ledger/Amount';
import { Field } from '../ledger/Dialog';
import { Mark } from '../ledger/Mark';
import { buttonClass } from '../ledger/Page';

const COMMON_ZONES = ['Africa/Nairobi', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'Africa/Lagos', 'Africa/Johannesburg', 'Europe/London', 'UTC'];

function knownZones(): string[] {
  try {
    const all = (Intl as any).supportedValuesOf?.('timeZone') as string[] | undefined;
    if (all?.length) return [...new Set([...COMMON_ZONES, ...all])];
  } catch {
    // Older browsers: the common zones are enough.
  }
  return COMMON_ZONES;
}

/**
 * The organization's controls: the closing date, the bill approval limit,
 * its time zone, and whether AI features may send data to Google. Owners and
 * administrators change them; everyone else reads them.
 */
export function ControlsPanel({ company, onSaved }: { company: OrganizationData; onSaved: () => void }) {
  const canChange = company.role === 'owner' || company.role === 'admin';
  const [closedThrough, setClosedThrough] = useState('');
  const [threshold, setThreshold] = useState('');
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState('');
  const zones = useMemo(knownZones, []);

  useEffect(() => {
    setClosedThrough(company.booksClosedThrough || '');
    setThreshold(company.approvalThresholdCents == null ? '' : (company.approvalThresholdCents / 100).toFixed(2));
    setTimeZone(company.timeZone || DEFAULT_TIME_ZONE);
    setAiEnabled(Boolean(company.aiEnabled));
  }, [company]);

  const check = useQuery({
    queryKey: ['control-check', company.id],
    queryFn: () => apiRequest<{
      receivables: { ledgerCents: number; documentsCents: number; differenceCents: number };
      payables: { ledgerCents: number; documentsCents: number; differenceCents: number };
      agrees: boolean;
    }>('/api/reports/control-check'),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest(`/api/organizations/${company.id}`, {
      method: 'PUT',
      body,
      fallback: 'The controls could not be saved.',
    }),
    onSuccess: () => {
      setSaved('Controls saved.');
      onSaved();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem('');
    setSaved('');
    let approvalThresholdCents: number | null = null;
    if (threshold.trim()) {
      approvalThresholdCents = centsFromAmountText(threshold);
      if (approvalThresholdCents === null) {
        setProblem('Enter the approval limit as an amount, such as 50000 or 50,000.00, or leave it blank.');
        return;
      }
    }
    if (!isTimeZone(timeZone)) {
      setProblem('Choose a time zone from the list, such as Africa/Nairobi.');
      return;
    }
    save.mutate({ booksClosedThrough: closedThrough || null, approvalThresholdCents, timeZone, aiEnabled });
  };

  const currency = company.baseCurrency || 'KES';

  return (
    <div className="max-w-3xl space-y-8">
      <form onSubmit={submit} className="space-y-6">
        <section aria-labelledby="closing-heading" className="space-y-2">
          <h2 id="closing-heading" className="ll-heading border-b-2 border-ink-900 pb-1.5 text-[20px] text-ink-900">Closing date</h2>
          <p className="text-[13.5px] text-graphite-600">
            Once a period is filed or reviewed, close it. Nothing can then be posted, voided or reversed on or before this date, by anyone, until an owner or admin moves it.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Books closed through">
              <input type="date" value={closedThrough} disabled={!canChange} onChange={(e) => setClosedThrough(e.target.value)} />
            </Field>
            {closedThrough && canChange && (
              <button type="button" className={`${buttonClass.quiet} mb-2.5`} onClick={() => setClosedThrough('')}>Reopen all periods</button>
            )}
          </div>
          <p className="text-[12.5px] text-graphite-600">
            {company.booksClosedThrough ? `Closed through ${format(new Date(company.booksClosedThrough), 'dd/MM/yyyy')}.` : 'No period is closed.'}
          </p>
        </section>

        <section aria-labelledby="approval-heading" className="space-y-2">
          <h2 id="approval-heading" className="ll-heading border-b-2 border-ink-900 pb-1.5 text-[20px] text-ink-900">Bill approval</h2>
          <p className="text-[13.5px] text-graphite-600">
            A bill of this amount or more is paid only after an owner or admin approves it, and not the person who entered it. Leave blank to pay any bill without approval.
          </p>
          <Field label={`Approval limit (${currency})`}>
            <input
              type="text"
              inputMode="decimal"
              placeholder="No limit"
              value={threshold}
              disabled={!canChange}
              onChange={(e) => setThreshold(e.target.value)}
              className="tabular-currency"
            />
          </Field>
        </section>

        <section aria-labelledby="zone-heading" className="space-y-2">
          <h2 id="zone-heading" className="ll-heading border-b-2 border-ink-900 pb-1.5 text-[20px] text-ink-900">Time zone</h2>
          <p className="text-[13.5px] text-graphite-600">The business day: what “today” means for postings, voids, reversals and overdue invoices.</p>
          <Field label="Time zone">
            <input list="time-zones" value={timeZone} disabled={!canChange} onChange={(e) => setTimeZone(e.target.value)} />
          </Field>
          <datalist id="time-zones">
            {zones.map((zone) => <option key={zone} value={zone} />)}
          </datalist>
        </section>

        <section aria-labelledby="ai-heading" className="space-y-2">
          <h2 id="ai-heading" className="ll-heading border-b-2 border-ink-900 pb-1.5 text-[20px] text-ink-900">AI features</h2>
          <p className="text-[13.5px] text-graphite-600">
            Reading receipts from a photo and answering questions about the books send the photo, or a summary of this company’s figures, to Google Gemini. They stay off until an owner or admin turns them on.
          </p>
          <label className="flex items-start gap-2 text-[13.5px] text-ink-900">
            <input type="checkbox" checked={aiEnabled} disabled={!canChange} onChange={(e) => setAiEnabled(e.target.checked)} className="mt-0.5" />
            <span>Allow AI features for {company.name}</span>
          </label>
        </section>

        {canChange ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={buttonClass.secondary} disabled={save.isPending}>
              {save.isPending ? 'Saving' : 'Save controls'}
            </button>
            {saved && <span role="status"><Mark kind="tick" label={saved} /></span>}
          </div>
        ) : (
          <p className="text-[13px] text-graphite-600">Only an owner or admin changes these.</p>
        )}
        {problem && <p role="alert" className="text-[13px] text-ledger-red">{problem}</p>}
      </form>

      <section aria-labelledby="check-heading" className="space-y-2">
        <h2 id="check-heading" className="ll-heading border-b-2 border-ink-900 pb-1.5 text-[20px] text-ink-900">Control accounts</h2>
        <p className="text-[13.5px] text-graphite-600">Receivables and payables in the ledger, against the open invoices and bills behind them. They agree unless something was posted to them by hand.</p>
        {check.isLoading ? (
          <p className="text-[13px] text-graphite-600" role="status">Checking</p>
        ) : check.isError ? (
          <p className="text-[13px] text-ledger-red">The check could not be run.</p>
        ) : check.data ? (
          <dl className="grid grid-cols-1 gap-2 text-[13.5px] sm:grid-cols-2">
            {([['Receivables (1100)', check.data.receivables], ['Payables (2000)', check.data.payables]] as const).map(([label, row]) => (
              <div key={label} className="border-b border-feint py-2">
                <dt className="text-ink-900">{label}</dt>
                <dd className="mt-1 text-graphite-600">
                  Ledger <Amount cents={row.ledgerCents} currency={currency} tone="ink" /> · Open documents <Amount cents={row.documentsCents} currency={currency} tone="ink" />
                  <span className="mt-1 block">
                    {row.differenceCents === 0 ? <Mark kind="tick" label="Agree" /> : <Mark kind="circled" label="Differ" />}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>
    </div>
  );
}
