import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import { Amount, figureText } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { EmptyNote, LoadProblem, SkeletonRows, buttonClass } from '../ledger/Page';
import { useTrackingCategories } from './TagFields';

export type RecurringKind = 'INVOICE' | 'BILL';
type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
type Ending = 'NEVER' | 'ON_DATE' | 'AFTER';

const UNITS: Record<Frequency, [string, string]> = {
  WEEKLY: ['week', 'weeks'],
  MONTHLY: ['month', 'months'],
  QUARTERLY: ['quarter', 'quarters'],
  YEARLY: ['year', 'years'],
};

const WORDS: Record<RecurringKind, { one: string; many: string; documents: string; path: string; listKey: string; numberOf: (doc: any) => string; party: (doc: any, parties: Map<string, string>) => string; empty: string }> = {
  INVOICE: {
    one: 'recurring invoice',
    many: 'recurring invoices',
    documents: 'invoices',
    path: '/api/invoices',
    listKey: 'invoices',
    numberOf: (doc) => doc.invoiceNumber,
    party: (doc, parties) => parties.get(doc.customerId) || 'Customer',
    empty: 'No recurring invoices yet. Choose an invoice you send every month, such as a retainer or rent, and it is posted again on schedule, dated that day.',
  },
  BILL: {
    one: 'recurring bill',
    many: 'recurring bills',
    documents: 'bills',
    path: '/api/bills',
    listKey: 'bills',
    numberOf: (doc) => doc.billNumber,
    party: (doc, parties) => parties.get(doc.vendorId) || 'Supplier',
    empty: 'No recurring bills yet. Choose a bill that comes every month or quarter, such as rent or a subscription, and it is entered again on schedule.',
  },
};

const shortDate = (value: string | null | undefined) => (value ? format(parseISO(value), 'dd/MM/yyyy') : '');

export function describeSchedule(t: { frequency: Frequency; intervalCount: number; startDate: string; endDate?: string | null; maxOccurrences?: number | null }) {
  const [one, many] = UNITS[t.frequency];
  const every = t.intervalCount === 1 ? `Every ${one}` : `Every ${t.intervalCount} ${many}`;
  const ends = t.maxOccurrences ? `, ${t.maxOccurrences} ${t.maxOccurrences === 1 ? 'time' : 'times'}` : t.endDate ? `, until ${shortDate(t.endDate)}` : '';
  return `${every} from ${shortDate(t.startDate)}${ends}`;
}

/**
 * Invoices or bills that repeat. A schedule is made from a posted document;
 * each time it falls due the document is posted again, dated that day. The
 * daily run posts what is due; one can also be posted now.
 */
export function RecurringPanel({ kind, isCreating, onCreatingChange }: { kind: RecurringKind; isCreating: boolean; onCreatingChange: (open: boolean) => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const currency = activeCompany?.baseCurrency || 'KES';
  const canPost = activeCompany?.role !== 'member';
  const today = todayIn(activeCompany?.timeZone);
  const words = WORDS[kind];

  const [editing, setEditing] = useState<any | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('MONTHLY');
  const [intervalCount, setIntervalCount] = useState('1');
  const [startDate, setStartDate] = useState(today);
  const [ending, setEnding] = useState<Ending>('NEVER');
  const [endDate, setEndDate] = useState('');
  const [maxOccurrences, setMaxOccurrences] = useState('12');
  const [daysUntilDue, setDaysUntilDue] = useState('30');
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');

  const formOpen = isCreating || Boolean(editing);
  const tagNames = new Map((useTrackingCategories().data?.categories || []).map((c) => [c.id, c.name]));
  const list = useQuery({
    queryKey: ['recurring', currentOrgId, kind],
    queryFn: () => apiRequest<{ templates: any[] }>(`/api/recurring?kind=${kind}`, { fallback: `Failed to fetch ${words.many}` }),
  });
  const documents = useQuery({
    queryKey: [words.listKey, currentOrgId],
    queryFn: () => apiRequest<any>(words.path),
    enabled: isCreating,
  });
  const parties = useQuery({
    queryKey: [kind === 'INVOICE' ? 'customers' : 'vendors', currentOrgId],
    queryFn: () => apiRequest<any>(kind === 'INVOICE' ? '/api/customers' : '/api/vendors'),
    enabled: isCreating,
  });
  const partyNames = new Map<string, string>(((parties.data?.customers || parties.data?.vendors || []) as any[]).map((p) => [p.id, p.displayName]));
  const sources: any[] = ((documents.data?.[words.listKey] || []) as any[]).filter((doc) => doc.status !== 'VOID' && doc.currency === currency);

  const refresh = () => {
    for (const key of ['recurring', 'invoices', 'bills', 'customers', 'vendors', 'accounts', 'journal-entries', 'dashboard-metrics']) {
      queryClient.invalidateQueries({ queryKey: [key, currentOrgId] });
    }
  };

  const openForm = (template: any | null) => {
    setProblem('');
    setNotice('');
    setSourceId('');
    setName(template?.name || '');
    setFrequency(template?.frequency || 'MONTHLY');
    setIntervalCount(String(template?.intervalCount || 1));
    setStartDate(template?.startDate || today);
    setEnding(template?.maxOccurrences ? 'AFTER' : template?.endDate ? 'ON_DATE' : 'NEVER');
    setEndDate(template?.endDate || '');
    setMaxOccurrences(String(template?.maxOccurrences || 12));
    setDaysUntilDue(String(template?.daysUntilDue ?? 30));
    setEditing(template);
  };

  const closeForm = () => {
    setEditing(null);
    onCreatingChange(false);
  };

  const save = useMutation({
    mutationFn: () => {
      const schedule = {
        name: name.trim() || undefined,
        frequency,
        intervalCount: Number(intervalCount),
        startDate,
        endDate: ending === 'ON_DATE' ? endDate : undefined,
        maxOccurrences: ending === 'AFTER' ? Number(maxOccurrences) : undefined,
        daysUntilDue: Number(daysUntilDue),
      };
      if (!editing && !sourceId) throw new Error(`Choose the ${kind === 'INVOICE' ? 'invoice' : 'bill'} to repeat.`);
      if (!Number.isInteger(schedule.intervalCount) || schedule.intervalCount < 1 || schedule.intervalCount > 52) throw new Error('Repeat every 1 to 52 periods.');
      if (!Number.isInteger(schedule.daysUntilDue) || schedule.daysUntilDue < 0 || schedule.daysUntilDue > 365) throw new Error('Payment terms are 0 to 365 days.');
      if (ending === 'ON_DATE' && (!endDate || endDate < startDate)) throw new Error('The end date cannot be before the first date.');
      if (ending === 'AFTER' && (!Number.isInteger(schedule.maxOccurrences) || schedule.maxOccurrences! < 1)) throw new Error('Enter how many times, such as 12.');
      return editing
        ? apiRequest<any>(`/api/recurring/${editing.id}`, { method: 'PUT', body: schedule, fallback: 'The schedule could not be saved.' })
        : apiRequest<any>('/api/recurring', { body: { ...schedule, kind, sourceDocumentId: sourceId }, fallback: 'The schedule could not be saved.' });
    },
    onSuccess: (saved) => {
      setNotice(saved.nextRunDate ? `${saved.name} saved. The next one is posted on ${shortDate(saved.nextRunDate)}.` : `${saved.name} saved. The schedule is over.`);
      closeForm();
      refresh();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const act = useMutation({
    mutationFn: ({ template, action }: { template: any; action: 'PAUSED' | 'ACTIVE' | 'ENDED' | 'RUN' }) => action === 'RUN'
      ? apiRequest<any>(`/api/recurring/${template.id}/run`, { body: { documentDate: today }, fallback: 'It could not be posted.' })
        .then((r) => `${r.documentNumber} posted from ${template.name}, dated ${shortDate(r.documentDate)}.${r.nextRunDate ? ` The next one is on ${shortDate(r.nextRunDate)}.` : ' The schedule is over.'}`)
      : apiRequest<any>(`/api/recurring/${template.id}/status`, { body: { status: action }, fallback: 'The schedule could not be changed.' })
        .then(() => `${template.name} ${action === 'PAUSED' ? 'paused' : action === 'ACTIVE' ? 'resumed' : 'ended'}.`),
    onSuccess: (message) => { setNotice(message); setProblem(''); refresh(); },
    onError: (err: Error) => { setNotice(''); setProblem(err.message); },
  });

  // The form opens fresh each time the heading button is pressed.
  useEffect(() => {
    if (isCreating) openForm(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreating]);

  const templates = list.data?.templates || [];

  return (
    <div className="space-y-3">
      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}
      {problem && !formOpen && <p role="alert" className="text-[13.5px] text-ledger-red">{problem}</p>}
      {list.isError ? (
        <LoadProblem what={words.many} path="/api/recurring" onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <SkeletonRows label={`Loading ${words.many}`} />
      ) : templates.length === 0 ? (
        <EmptyNote action={canPost ? <button type="button" onClick={() => onCreatingChange(true)} className={buttonClass.quiet}>Make the first {words.one}</button> : undefined}>
          {words.empty}
        </EmptyNote>
      ) : (
        <ul className="border-t border-feint-strong" aria-label={`${words.many}, figures in ${currency}`}>
          {templates.map((t) => (
            <li key={t.id} className="border-b border-feint py-2.5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className={`text-[14px] ${t.status === 'ENDED' ? 'text-graphite-600' : 'text-ink-900'}`}>
                    {t.name}
                    <span className="text-graphite-600"> · {t.partyName}{t.firstLine ? ` · ${t.firstLine}${t.lineCount > 1 ? ' and more' : ''}` : ''}</span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-graphite-600">
                    {describeSchedule(t)} · due {t.daysUntilDue === 0 ? 'on receipt' : `in ${t.daysUntilDue} days`}
                    {' · '}
                    {t.status === 'ENDED' ? 'Ended' : t.status === 'PAUSED' ? 'Paused' : `Next on ${shortDate(t.nextRunDate)}`}
                    {t.occurrences > 0 ? ` · ${t.occurrences} posted` : ''}
                    {[t.classId, t.locationId].map((id) => (id ? tagNames.get(id) : null)).filter(Boolean).map((tag) => ` · ${tag}`).join('')}
                  </p>
                  {t.lastError && t.status !== 'ENDED' && (
                    <p className="mt-0.5 text-[12.5px] text-ledger-red">The last run did not post: {t.lastError}</p>
                  )}
                  {t.runs.length > 0 && (
                    <p className="mt-0.5 text-[12.5px] text-graphite-600">
                      Latest: {t.runs.map((r: any) => `${r.documentNumber} (${shortDate(r.date)})`).join(', ')}
                    </p>
                  )}
                </div>
                <Amount cents={t.totalCents} currency={currency} tone="ink" />
              </div>
              {canPost && t.status !== 'ENDED' && (
                <div className="mt-1.5 flex flex-wrap justify-end gap-x-3">
                  <button type="button" className={buttonClass.quiet} disabled={act.isPending} onClick={() => act.mutate({ template: t, action: 'RUN' })}>Post the next one now</button>
                  <button type="button" className={buttonClass.quiet} onClick={() => openForm(t)}>Edit schedule</button>
                  {t.status === 'ACTIVE'
                    ? <button type="button" className={buttonClass.quiet} disabled={act.isPending} onClick={() => act.mutate({ template: t, action: 'PAUSED' })}>Pause</button>
                    : <button type="button" className={buttonClass.quiet} disabled={act.isPending} onClick={() => act.mutate({ template: t, action: 'ACTIVE' })}>Resume</button>}
                  <button type="button" className={buttonClass.quiet} disabled={act.isPending} onClick={() => act.mutate({ template: t, action: 'ENDED' })}>End</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={formOpen}
        onClose={() => { if (!save.isPending) closeForm(); }}
        title={editing ? `Schedule for ${editing.name}` : `New ${words.one}`}
        note={editing
          ? 'Changes apply to the documents still to come. Those already posted stay as they are.'
          : `The ${kind === 'INVOICE' ? 'invoice' : 'bill'} you choose is copied: its ${kind === 'INVOICE' ? 'customer' : 'supplier'}, lines and VAT. Each time it is due, a new one is posted, dated that day.`}
        footer={
          <>
            {problem && formOpen && <p role="alert" className="mr-auto text-[13px] text-ledger-red">{problem}</p>}
            <button type="button" onClick={closeForm} disabled={save.isPending} className={buttonClass.secondary}>Cancel</button>
            <button type="button" onClick={() => { setProblem(''); save.mutate(); }} disabled={save.isPending} className={buttonClass.primary}>
              {save.isPending ? 'Saving' : 'Save schedule'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {!editing && (
            <Field label={kind === 'INVOICE' ? 'Repeat this invoice' : 'Repeat this bill'} hint={documents.isLoading ? 'Loading' : sources.length === 0 ? `No ${words.documents} in ${currency} yet.` : undefined}>
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                <option value="">Choose {kind === 'INVOICE' ? 'an invoice' : 'a bill'}</option>
                {sources.map((doc) => (
                  <option key={doc.id} value={doc.id}>{words.numberOf(doc)} · {words.party(doc, partyNames)} · {figureText(doc.totalCents)}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Name" hint={editing ? undefined : 'Optional. Named after the document if left blank.'}>
            <input maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Repeats">
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </Field>
          <Field label={`Every how many ${UNITS[frequency][1]}`}>
            <input type="number" min={1} max={52} inputMode="numeric" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} />
          </Field>
          <Field label="First date" hint={editing?.occurrences ? 'Fixed once one has been posted.' : 'The first one is posted on this day.'}>
            <input type="date" value={startDate} disabled={Boolean(editing?.occurrences)} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Due after, days" hint="0 for due on receipt">
            <input type="number" min={0} max={365} inputMode="numeric" value={daysUntilDue} onChange={(e) => setDaysUntilDue(e.target.value)} />
          </Field>
          <Field label="Ends">
            <select value={ending} onChange={(e) => setEnding(e.target.value as Ending)}>
              <option value="NEVER">Never</option>
              <option value="ON_DATE">On a date</option>
              <option value="AFTER">After a number of times</option>
            </select>
          </Field>
          {ending === 'ON_DATE' && (
            <Field label="Last date">
              <input type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          )}
          {ending === 'AFTER' && (
            <Field label="How many times">
              <input type="number" min={1} max={1000} inputMode="numeric" value={maxOccurrences} onChange={(e) => setMaxOccurrences(e.target.value)} />
            </Field>
          )}
        </div>
      </Dialog>
    </div>
  );
}
