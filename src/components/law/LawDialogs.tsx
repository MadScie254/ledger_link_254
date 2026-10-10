import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest, newIdempotencyKey } from '../../utils/apiRequest';
import { addDaysIso, todayIn } from '../../utils/dates';
import { centsFromAmountText } from '../../utils/salesOrders';
import { zonedLocalToIso } from '../../utils/lawDates';
import { Amount, figureText } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';
import {
  EVENT_TYPES, matterLabel, refreshLaw, shortDate, useLawOrg, useMatters, useOfficeAccounts, type Matter,
} from './lawData';

type Done = (message: string) => void;

/** Posts once per opening of a dialog: the key is kept until it succeeds. */
function useLawPost<T = any>(onDone: Done) {
  const queryClient = useQueryClient();
  const { orgId } = useLawOrg();
  const [key, setKey] = useState(newIdempotencyKey);
  const mutation = useMutation({
    mutationFn: async ({ path, body, method = 'POST' }: { path: string; body: Record<string, unknown>; method?: 'POST' | 'PATCH'; message: string }) =>
      apiRequest<T>(path, { method, body: method === 'POST' ? { ...body, idempotencyKey: key } : body }),
    onSuccess: (_result, variables) => {
      refreshLaw(queryClient, orgId);
      setKey(newIdempotencyKey());
      onDone(variables.message);
    },
  });
  return mutation;
}

function Footer({ onClose, busy, label, form }: { onClose: () => void; busy: boolean; label: string; form: string }) {
  return (
    <>
      <button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
      <button type="submit" form={form} className={buttonClass.primary} disabled={busy}>{busy ? 'Posting' : label}</button>
    </>
  );
}

function Problem({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="text-[13px] text-ledger-red">{error instanceof Error ? error.message : String(error)}</p>;
}

/** A matter chosen in the dialog when the screen did not open one. */
function MatterPicker({ value, onChange, openOnly = true }: { value: string; onChange: (id: string) => void; openOnly?: boolean }) {
  const matters = useMatters();
  const choices = (matters.data?.matters || []).filter((matter) => !openOnly || matter.status !== 'CLOSED');
  return (
    <Field label="Matter">
      <select required value={value} onChange={(event) => onChange(event.target.value)} name="matterId">
        <option value="">Choose the matter</option>
        {choices.map((matter) => <option key={matter.id} value={matter.id}>{matterLabel(matter)}</option>)}
      </select>
    </Field>
  );
}

function useToday() {
  const { timeZone } = useLawOrg();
  return todayIn(timeZone);
}

// ---------------------------------------------------------------------------
// Client money
// ---------------------------------------------------------------------------

const RECEIPT_METHODS = ['BANK', 'M-PESA', 'CHEQUE', 'CASH'];

export function ClientReceiptDialog({ matter, onClose, onDone }: { matter?: Matter | null; onClose: () => void; onDone: Done }) {
  const today = useToday();
  const [matterId, setMatterId] = useState(matter?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState('BANK');
  const [reference, setReference] = useState('');
  const [problem, setProblem] = useState('');
  const post = useLawPost(onDone);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const cents = centsFromAmountText(amount);
    if (!cents) return setProblem('Enter the amount received, in shillings.');
    setProblem('');
    post.mutate({
      path: '/api/client-account/receipts',
      body: { matterId, amountCents: cents, receiptDate: date, method, reference: reference.trim() },
      message: `${figureText(cents)} received into the client account.`,
    });
  };
  return (
    <Dialog open onClose={onClose} title="Receive client money" note="Money held for a client: posted to the client bank account (1060) and client money held (2200), never to income."
      footer={<Footer onClose={onClose} busy={post.isPending} label="Record receipt" form="client-receipt" />}>
      <form id="client-receipt" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {!matter && <div className="sm:col-span-2"><MatterPicker value={matterId} onChange={setMatterId} /></div>}
        <Field label="Amount received"><input name="amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Date"><input type="date" name="receiptDate" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="How it came in">
          <select value={method} onChange={(e) => setMethod(e.target.value)} name="method">
            {RECEIPT_METHODS.map((m) => <option key={m} value={m}>{m === 'M-PESA' ? 'M-Pesa' : m.charAt(0) + m.slice(1).toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label="Reference" hint="The bank or M-Pesa reference, or the cheque number."><input name="reference" required value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Problem error={problem || post.error} /></div>
      </form>
    </Dialog>
  );
}

export function ClientPaymentDialog({ matter, heldCents, onClose, onDone }: { matter: Matter; heldCents?: number; onClose: () => void; onDone: Done }) {
  const { currency } = useLawOrg();
  const today = useToday();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [payee, setPayee] = useState('');
  const [purpose, setPurpose] = useState('');
  const [asDisbursement, setAsDisbursement] = useState(false);
  const [problem, setProblem] = useState('');
  const post = useLawPost(onDone);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const cents = centsFromAmountText(amount);
    if (!cents) return setProblem('Enter the amount paid, in shillings.');
    setProblem('');
    post.mutate({
      path: '/api/client-account/payments',
      body: { matterId: matter.id, amountCents: cents, paymentDate: date, payee: payee.trim(), purpose: purpose.trim(), asDisbursement },
      message: `${figureText(cents)} paid to ${payee.trim()} from ${matter.matter_number}'s client money.`,
    });
  };
  return (
    <Dialog open onClose={onClose} title="Pay out of client money"
      note={heldCents === undefined ? undefined : <>Held for this matter: <Amount cents={heldCents} currency={currency} tone="ink" size="sm" />. A payment may not take it below nil.</>}
      footer={<Footer onClose={onClose} busy={post.isPending} label="Record payment" form="client-payment" />}>
      <form id="client-payment" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount paid"><input name="amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Date"><input type="date" name="paymentDate" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Paid to"><input name="payee" required value={payee} onChange={(e) => setPayee(e.target.value)} /></Field>
        <Field label="Purpose"><input name="purpose" required value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
        <label className="sm:col-span-2 flex items-center gap-2 text-[13.5px] text-ink-900">
          <input type="checkbox" name="asDisbursement" checked={asDisbursement} onChange={(e) => setAsDisbursement(e.target.checked)} />
          A disbursement on the matter, such as court fees, listed with its other costs
        </label>
        <div className="sm:col-span-2"><Problem error={problem || post.error} /></div>
      </form>
    </Dialog>
  );
}

export function ClientTransferDialog({ matter, heldCents, onClose, onDone }: { matter: Matter; heldCents?: number; onClose: () => void; onDone: Done }) {
  const { orgId, currency } = useLawOrg();
  const today = useToday();
  const accounts = useOfficeAccounts();
  const feeNotes = useQuery({
    queryKey: ['fee-notes', orgId, matter.id],
    queryFn: () => apiRequest<{ feeNotes: any[] }>(`/api/fee-notes?matterId=${matter.id}`),
  });
  const owing = (feeNotes.data?.feeNotes || []).filter((note) => Number(note.amount_due_cents) > 0 && ['SENT', 'PARTIALLY_PAID'].includes(note.status));
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState('');
  const [problem, setProblem] = useState('');
  const post = useLawPost(onDone);
  useEffect(() => {
    if (!accountId && accounts.office[0]) setAccountId(accounts.office[0].id);
  }, [accountId, accounts.office]);
  const chosen = owing.find((note) => note.id === invoiceId);
  useEffect(() => {
    if (!chosen) return;
    const most = Math.min(Number(chosen.amount_due_cents), heldCents ?? Number(chosen.amount_due_cents));
    if (most > 0) setAmount((most / 100).toFixed(2));
  }, [chosen, heldCents]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const cents = centsFromAmountText(amount);
    if (!cents) return setProblem('Enter the amount to transfer, in shillings.');
    setProblem('');
    post.mutate({
      path: '/api/client-account/transfers',
      body: { matterId: matter.id, invoiceId, amountCents: cents, transferDate: date, officeAccountId: accountId },
      message: `${figureText(cents)} transferred from client money to settle ${chosen?.invoice_number || 'the fee note'}.`,
    });
  };
  return (
    <Dialog open onClose={onClose} title="Transfer to office against a fee note"
      note={<>Client money moves to office only to settle a fee note already delivered. Held for this matter: {heldCents === undefined ? 'loading' : <Amount cents={heldCents} currency={currency} tone="ink" size="sm" />}.</>}
      footer={<Footer onClose={onClose} busy={post.isPending} label="Transfer" form="client-transfer" />}>
      {feeNotes.isSuccess && owing.length === 0 ? (
        <p className="text-[13.5px] text-graphite-600">No fee note on this matter has anything owing. Raise a fee note first; client money can then settle it.</p>
      ) : (
        <form id="client-transfer" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Fee note">
              <select required name="invoiceId" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                <option value="">Choose the fee note</option>
                {owing.map((note) => <option key={note.id} value={note.id}>{note.invoice_number} · {shortDate(note.date)} · {figureText(Number(note.amount_due_cents))} owing</option>)}
              </select>
            </Field>
          </div>
          <Field label="Amount"><input name="amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Date"><input type="date" name="transferDate" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="Into office account">
              <select required name="officeAccountId" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.office.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="sm:col-span-2"><Problem error={problem || post.error} /></div>
        </form>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Disbursements, time and court dates
// ---------------------------------------------------------------------------

export function OfficeDisbursementDialog({ matter, onClose, onDone }: { matter?: Matter | null; onClose: () => void; onDone: Done }) {
  const today = useToday();
  const accounts = useOfficeAccounts();
  const [matterId, setMatterId] = useState(matter?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [problem, setProblem] = useState('');
  const post = useLawPost(onDone);
  useEffect(() => {
    if (!accountId && accounts.office[0]) setAccountId(accounts.office[0].id);
  }, [accountId, accounts.office]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const cents = centsFromAmountText(amount);
    if (!cents) return setProblem('Enter the amount paid, in shillings.');
    setProblem('');
    post.mutate({
      path: '/api/disbursements',
      body: { matterId, amountCents: cents, incurredOn: date, description: description.trim(), paidFromAccountId: accountId, receiptReference: reference.trim() || undefined },
      message: `${figureText(cents)} disbursement recorded; it waits on the next fee note.`,
    });
  };
  return (
    <Dialog open onClose={onClose} title="Record an office disbursement" note="A cost the firm paid for the client, such as search or filing fees: recoverable (1180) until billed on a fee note."
      footer={<Footer onClose={onClose} busy={post.isPending} label="Record disbursement" form="office-disbursement" />}>
      <form id="office-disbursement" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {!matter && <div className="sm:col-span-2"><MatterPicker value={matterId} onChange={setMatterId} /></div>}
        <div className="sm:col-span-2"><Field label="What it was for"><input name="description" required value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
        <Field label="Amount"><input name="amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Date paid"><input type="date" name="incurredOn" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Paid from">
          <select required name="paidFromAccountId" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.office.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
          </select>
        </Field>
        <Field label="Receipt reference" hint="Optional"><input name="receiptReference" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Problem error={problem || post.error} /></div>
      </form>
    </Dialog>
  );
}

export function LogTimeDialog({ matter, onClose, onDone }: { matter?: Matter | null; onClose: () => void; onDone: Done }) {
  const { currency } = useLawOrg();
  const today = useToday();
  const matters = useMatters();
  const [matterId, setMatterId] = useState(matter?.id || '');
  const chosen = matter || (matters.data?.matters || []).find((m) => m.id === matterId);
  const [date, setDate] = useState(today);
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(true);
  const [rate, setRate] = useState('');
  const [problem, setProblem] = useState('');
  const post = useLawPost(onDone);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const hoursValue = Number(hours);
    if (!Number.isFinite(hoursValue) || hoursValue <= 0 || hoursValue > 24) return setProblem('Enter the hours worked, more than 0 and at most 24.');
    const rateCents = rate.trim() ? centsFromAmountText(rate) : undefined;
    if (rate.trim() && rateCents == null) return setProblem('Enter the hourly rate in shillings, or leave it for the matter rate.');
    setProblem('');
    post.mutate({
      path: '/api/time-entries',
      body: { matterId: chosen?.id || matterId, entryDate: date, hours: hoursValue, description: description.trim() || undefined, billable, ...(rateCents != null ? { rateCents } : {}) },
      message: `${hoursValue} ${hoursValue === 1 ? 'hour' : 'hours'} recorded${billable ? ', waiting to be billed' : ', not billable'}.`,
    });
  };
  return (
    <Dialog open onClose={onClose} title="Record time"
      footer={<Footer onClose={onClose} busy={post.isPending} label="Record time" form="log-time" />}>
      <form id="log-time" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {!matter && <div className="sm:col-span-2"><MatterPicker value={matterId} onChange={setMatterId} /></div>}
        <Field label="Date"><input type="date" name="entryDate" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Hours" hint="Decimal hours: 1.5 is an hour and a half."><input name="hours" inputMode="decimal" required value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Work done"><input name="description" value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
        <label className="flex items-center gap-2 text-[13.5px] text-ink-900">
          <input type="checkbox" name="billable" checked={billable} onChange={(e) => setBillable(e.target.checked)} /> Billable
        </label>
        <Field label="Hourly rate" hint={chosen?.default_rate_cents != null ? `Leave blank for the matter rate, ${currency} ${figureText(Number(chosen.default_rate_cents))}.` : 'This matter has no rate; enter one for billable time.'}>
          <input name="rateCents" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <div className="sm:col-span-2"><Problem error={problem || post.error} /></div>
      </form>
    </Dialog>
  );
}

export function CourtEventDialog({ matter, onClose, onDone }: { matter?: Matter | null; onClose: () => void; onDone: Done }) {
  const { timeZone } = useLawOrg();
  const [matterId, setMatterId] = useState(matter?.id || '');
  const [eventType, setEventType] = useState('HEARING');
  const [when, setWhen] = useState('');
  const [court, setCourt] = useState(matter?.court || '');
  const [courtroom, setCourtroom] = useState('');
  const [officer, setOfficer] = useState(matter?.judicial_officer || '');
  const [problem, setProblem] = useState('');
  const post = useLawPost(onDone);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    let startsAt = '';
    try { startsAt = zonedLocalToIso(when, timeZone); } catch { return setProblem('Enter the date and time.'); }
    setProblem('');
    post.mutate({
      path: '/api/court-events',
      body: { matterId, eventType, startsAt, court: court.trim() || undefined, courtroom: courtroom.trim() || undefined, judicialOfficer: officer.trim() || undefined },
      message: `${EVENT_TYPES[eventType].en} set for ${when.slice(8, 10)}/${when.slice(5, 7)}/${when.slice(0, 4)} at ${when.slice(11, 16)}.`,
    });
  };
  return (
    <Dialog open onClose={onClose} title="Add a court date"
      footer={<Footer onClose={onClose} busy={post.isPending} label="Add to the diary" form="court-event" />}>
      <form id="court-event" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {!matter && <div className="sm:col-span-2"><MatterPicker value={matterId} onChange={setMatterId} /></div>}
        <Field label="What">
          <select name="eventType" value={eventType} onChange={(e) => setEventType(e.target.value)}>
            {Object.entries(EVENT_TYPES).map(([id, name]) => <option key={id} value={id}>{name.en}</option>)}
          </select>
        </Field>
        <Field label="Date and time" hint={`On the firm's clock (${timeZone}).`}><input type="datetime-local" name="startsAt" required value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="Court"><input name="court" value={court} onChange={(e) => setCourt(e.target.value)} /></Field>
        <Field label="Courtroom" hint="Optional"><input name="courtroom" value={courtroom} onChange={(e) => setCourtroom(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Judicial officer" hint="Optional"><input name="judicialOfficer" value={officer} onChange={(e) => setOfficer(e.target.value)} /></Field></div>
        <div className="sm:col-span-2"><Problem error={problem || post.error} /></div>
      </form>
    </Dialog>
  );
}

/** What happened at a court date, and when the matter is next in court. */
export function CourtOutcomeDialog({ event, onClose, onDone }: { event: any; onClose: () => void; onDone: Done }) {
  const { orgId, timeZone } = useLawOrg();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'DONE' | 'ADJOURNED' | 'CANCELLED'>('ADJOURNED');
  const [outcome, setOutcome] = useState('');
  const [next, setNext] = useState<'date' | 'none'>('date');
  const [nextType, setNextType] = useState('MENTION');
  const [nextWhen, setNextWhen] = useState('');
  const [problem, setProblem] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      if (status === 'CANCELLED') {
        await apiRequest(`/api/court-events/${event.id}`, { method: 'PATCH', body: { status } });
        return 'Court date cancelled.';
      }
      if (!outcome.trim()) throw new Error('Write what happened.');
      if (next === 'none') {
        await apiRequest(`/api/court-events/${event.id}`, { method: 'PATCH', body: { status, outcome: outcome.trim(), noFurtherDate: true } });
        return 'Outcome recorded, with no further court date.';
      }
      let startsAt = '';
      try { startsAt = zonedLocalToIso(nextWhen, timeZone); } catch { throw new Error('Enter the next date and time, or choose no further date.'); }
      const created = await apiRequest<{ id: string }>('/api/court-events', {
        body: { matterId: event.matter_id, eventType: nextType, startsAt, court: event.court || undefined, courtroom: event.courtroom || undefined, judicialOfficer: event.judicial_officer || undefined },
      });
      await apiRequest(`/api/court-events/${event.id}`, { method: 'PATCH', body: { status, outcome: outcome.trim(), nextEventId: created.id } });
      return `Outcome recorded; next in court ${nextWhen.slice(8, 10)}/${nextWhen.slice(5, 7)}/${nextWhen.slice(0, 4)} at ${nextWhen.slice(11, 16)}.`;
    },
    onSuccess: (message) => { refreshLaw(queryClient, orgId); onDone(message); },
    onError: (err: Error) => setProblem(err.message),
  });
  return (
    <Dialog open onClose={onClose} title="Record the outcome" note={`${event.matters?.matter_number || ''} ${event.matters?.title || ''}`}
      footer={<><button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="court-outcome" className={buttonClass.primary} disabled={save.isPending}>{save.isPending ? 'Saving' : 'Save outcome'}</button></>}>
      <form id="court-outcome" onSubmit={(e) => { e.preventDefault(); setProblem(''); save.mutate(); }} className="grid gap-4 sm:grid-cols-2">
        <Field label="It was">
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="ADJOURNED">Adjourned</option>
            <option value="DONE">Heard</option>
            <option value="CANCELLED">Cancelled, did not sit</option>
          </select>
        </Field>
        {status !== 'CANCELLED' && (
          <>
            <div className="sm:col-span-2"><Field label="What happened"><textarea name="outcome" rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} /></Field></div>
            <fieldset className="sm:col-span-2 space-y-2 text-[13.5px] text-ink-900">
              <legend className="text-[13px] font-semibold">Next in court</legend>
              <label className="flex items-center gap-2"><input type="radio" name="next" checked={next === 'date'} onChange={() => setNext('date')} /> On a new date</label>
              <label className="flex items-center gap-2"><input type="radio" name="next" checked={next === 'none'} onChange={() => setNext('none')} /> No further date</label>
            </fieldset>
            {next === 'date' && (
              <>
                <Field label="Next for">
                  <select name="nextType" value={nextType} onChange={(e) => setNextType(e.target.value)}>
                    {Object.entries(EVENT_TYPES).map(([id, name]) => <option key={id} value={id}>{name.en}</option>)}
                  </select>
                </Field>
                <Field label="Next date and time"><input type="datetime-local" name="nextStartsAt" value={nextWhen} onChange={(e) => setNextWhen(e.target.value)} /></Field>
              </>
            )}
          </>
        )}
        <div className="sm:col-span-2">{problem && <p role="alert" className="text-[13px] text-ledger-red">{problem}</p>}</div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Fee notes
// ---------------------------------------------------------------------------

/** A fee note made from a matter's unbilled time and office disbursements. */
export function FeeNoteBuilderDialog({ matter, onClose, onDone }: { matter: Matter; onClose: () => void; onDone: Done }) {
  const { orgId, currency } = useLawOrg();
  const { activeCompany } = useAppStore();
  const vatRegistered = Boolean(activeCompany?.vatRegistered);
  const today = useToday();
  const unbilled = useQuery({
    queryKey: ['unbilled', orgId, matter.id],
    queryFn: () => apiRequest<{ timeEntries: any[]; disbursements: any[] }>(`/api/matters/${matter.id}/unbilled`),
  });
  const [timeIds, setTimeIds] = useState<string[] | null>(null);
  const [disbursementIds, setDisbursementIds] = useState<string[] | null>(null);
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDaysIso(today, 14));
  const [vatRate, setVatRate] = useState(vatRegistered ? '16' : '0');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState('');
  const post = useLawPost<{ id: string }>(onDone);
  // The narrative of services, drafted by Cloudflare Workers AI from the work chosen below.
  const narrative = useMutation({
    mutationFn: () => apiRequest<{ text: string }>('/api/ai/fee-note-narrative', {
      body: { matterId: matter.id, timeEntryIds: chosenTime, disbursementIds: chosenCosts },
      fallback: 'No narrative came back. Try again.',
    }),
    onSuccess: (result) => setNotes(result.text),
  });
  const time = unbilled.data?.timeEntries || [];
  const costs = unbilled.data?.disbursements || [];
  const chosenTime = timeIds ?? time.map((entry) => entry.id);
  const chosenCosts = disbursementIds ?? costs.map((entry) => entry.id);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const totals = useMemo(() => {
    const fees = time.filter((entry) => chosenTime.includes(entry.id)).reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    const disbursed = costs.filter((entry) => chosenCosts.includes(entry.id)).reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    const rate = Number(vatRate) || 0;
    const vat = time.filter((entry) => chosenTime.includes(entry.id)).reduce((sum, entry) => sum + Math.round(Number(entry.amount_cents || 0) * rate / 100), 0);
    return { fees, disbursed, vat, total: fees + disbursed + vat };
  }, [time, costs, chosenTime, chosenCosts, vatRate]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (chosenTime.length + chosenCosts.length === 0) return setProblem('Choose the time or disbursements to bill.');
    setProblem('');
    post.mutate({
      path: '/api/fee-notes',
      body: { matterId: matter.id, issueDate, dueDate, timeEntryIds: chosenTime, disbursementIds: chosenCosts, vatRatePercent: Number(vatRate) || 0, notes: notes.trim() || undefined },
      message: `Fee note raised on ${matter.matter_number} for ${currency} ${figureText(totals.total)}.`,
    });
  };
  return (
    <Dialog open onClose={onClose} width="lg" title="Raise a fee note" note={`${matterLabel(matter)}. Professional fees and disbursements are listed apart; VAT is charged on fees only.`}
      footer={<Footer onClose={onClose} busy={post.isPending} label="Raise fee note" form="fee-note" />}>
      {unbilled.isLoading ? <p role="status" className="text-[13px] text-graphite-600">Gathering unbilled work</p>
        : time.length + costs.length === 0 ? <p className="text-[13.5px] text-graphite-600">Nothing on this matter is waiting to be billed. Record billable time or an office disbursement first.</p>
          : (
            <form id="fee-note" onSubmit={submit} className="space-y-4">
              {time.length > 0 && (
                <fieldset>
                  <legend className="ll-printed text-[11px] text-graphite-600">Professional fees</legend>
                  <ul className="mt-1">
                    {time.map((entry) => (
                      <li key={entry.id} className="flex items-baseline justify-between gap-3 border-b border-feint py-1.5 text-[13.5px]">
                        <label className="flex items-baseline gap-2">
                          <input type="checkbox" checked={chosenTime.includes(entry.id)} onChange={() => setTimeIds(toggle(chosenTime, entry.id))} aria-label={`Bill time of ${shortDate(entry.entry_date)}`} />
                          <span>{shortDate(entry.entry_date)} · {Number(entry.hours)} h · {entry.description || 'Professional time'}</span>
                        </label>
                        <Amount cents={Number(entry.amount_cents || 0)} currency={currency} size="sm" />
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
              {costs.length > 0 && (
                <fieldset>
                  <legend className="ll-printed text-[11px] text-graphite-600">Disbursements</legend>
                  <ul className="mt-1">
                    {costs.map((entry) => (
                      <li key={entry.id} className="flex items-baseline justify-between gap-3 border-b border-feint py-1.5 text-[13.5px]">
                        <label className="flex items-baseline gap-2">
                          <input type="checkbox" checked={chosenCosts.includes(entry.id)} onChange={() => setDisbursementIds(toggle(chosenCosts, entry.id))} aria-label={`Bill disbursement ${entry.description}`} />
                          <span>{shortDate(entry.incurred_on)} · {entry.description}</span>
                        </label>
                        <Amount cents={Number(entry.amount_cents)} currency={currency} size="sm" />
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Date"><input type="date" name="issueDate" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
                <Field label="Due"><input type="date" name="dueDate" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
                <Field label="VAT on fees, %" hint={vatRegistered ? undefined : 'The firm is not VAT registered (Settings).'}>
                  <input name="vatRatePercent" inputMode="decimal" value={vatRate} disabled={!vatRegistered} onChange={(e) => setVatRate(e.target.value)} />
                </Field>
              </div>
              <Field label="Notes on the fee note" hint={narrative.isSuccess ? 'Drafted by Cloudflare Workers AI from the chosen work. Read it and change anything before raising the fee note.' : 'Optional'}>
                <textarea name="notes" rows={notes.length > 160 ? 6 : 2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} aria-busy={narrative.isPending} />
              </Field>
              {activeCompany?.aiEnabled && (
                <div className="-mt-2 flex flex-wrap items-baseline gap-3">
                  <button type="button" onClick={() => narrative.mutate()} disabled={narrative.isPending || chosenTime.length + chosenCosts.length === 0} className={buttonClass.quiet}>
                    {narrative.isPending ? 'Drafting the narrative' : notes.trim() ? 'Draft the narrative again' : 'Draft the narrative from the chosen work'}
                  </button>
                  {narrative.isError && <span role="alert" className="text-[12.5px] text-ledger-red">{(narrative.error as Error).message}</span>}
                </div>
              )}
              <dl className="ml-auto max-w-xs text-[13.5px]">
                <div className="flex justify-between border-b border-feint py-1"><dt>Professional fees</dt><dd><Amount cents={totals.fees} currency={currency} tone="ink" size="sm" /></dd></div>
                <div className="flex justify-between border-b border-feint py-1"><dt>Disbursements</dt><dd><Amount cents={totals.disbursed} currency={currency} tone="ink" size="sm" /></dd></div>
                <div className="flex justify-between border-b border-feint py-1"><dt>VAT</dt><dd><Amount cents={totals.vat} currency={currency} tone="ink" size="sm" /></dd></div>
                <div className="ll-total flex justify-between py-1 font-semibold"><dt>Total</dt><dd><Amount cents={totals.total} currency={currency} tone="ink" size="sm" /></dd></div>
              </dl>
              <Problem error={problem || post.error} />
            </form>
          )}
    </Dialog>
  );
}

/** Money received on a fee note, with the 5% withholding tax the client keeps back on fees. */
export function FeeNotePaymentDialog({ feeNote, onClose, onDone }: { feeNote: any; onClose: () => void; onDone: Done }) {
  const { orgId, currency } = useLawOrg();
  const today = useToday();
  const accounts = useOfficeAccounts();
  const detail = useQuery({
    queryKey: ['fee-note', orgId, feeNote.id],
    queryFn: () => apiRequest<{ feeNote: any }>(`/api/fee-notes/${feeNote.id}`),
  });
  const fees = (detail.data?.feeNote?.lines || []).filter((line: any) => line.line_kind === 'PROFIT_COST')
    .reduce((sum: number, line: any) => sum + Number(line.amount_cents || 0), 0);
  const maxWht = Math.floor(fees * 0.05);
  const due = Number(feeNote.amount_due_cents) || 0;
  const [cash, setCash] = useState((due / 100).toFixed(2));
  const [wht, setWht] = useState('');
  const [certificate, setCertificate] = useState('');
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState('');
  const [problem, setProblem] = useState('');
  const post = useLawPost(onDone);
  useEffect(() => {
    if (!accountId && accounts.office[0]) setAccountId(accounts.office[0].id);
  }, [accountId, accounts.office]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const cashCents = cash.trim() ? centsFromAmountText(cash) : 0;
    const whtCents = wht.trim() ? centsFromAmountText(wht) : 0;
    if (cashCents == null || whtCents == null) return setProblem('Enter amounts in shillings.');
    if (cashCents + whtCents <= 0) return setProblem('Enter the money received or the tax withheld.');
    if (cashCents + whtCents > due) return setProblem(`Together they come to more than the ${currency} ${figureText(due)} owing.`);
    setProblem('');
    post.mutate({
      path: `/api/fee-notes/${feeNote.id}/payments`,
      body: { cashCents, whtCents, whtCertificateNumber: certificate.trim() || undefined, paymentDate: date, depositAccountId: accountId },
      message: `Payment recorded on ${feeNote.invoice_number}${whtCents ? `, with ${figureText(whtCents)} withheld` : ''}.`,
    });
  };
  return (
    <Dialog open onClose={onClose} title={`Receive payment on ${feeNote.invoice_number}`}
      note={<>Owing: <Amount cents={due} currency={currency} tone="ink" size="sm" />. A client that withholds tax keeps back up to 5% of professional fees ({currency} {figureText(maxWht)} here) and gives a certificate.</>}
      footer={<Footer onClose={onClose} busy={post.isPending} label="Record payment" form="fee-note-payment" />}>
      <form id="fee-note-payment" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Money received"><input name="cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} /></Field>
        <Field label="Withholding tax kept back" hint="Optional"><input name="wht" inputMode="decimal" value={wht} onChange={(e) => setWht(e.target.value)} /></Field>
        <Field label="Withholding certificate number" hint="Needed when tax was withheld."><input name="whtCertificateNumber" value={certificate} onChange={(e) => setCertificate(e.target.value)} /></Field>
        <Field label="Date"><input type="date" name="paymentDate" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="sm:col-span-2">
          <Field label="Into office account">
            <select required name="depositAccountId" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.office.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="sm:col-span-2"><Problem error={problem || post.error} /></div>
      </form>
    </Dialog>
  );
}

export function EtimsNumberDialog({ feeNote, onClose, onDone }: { feeNote: any; onClose: () => void; onDone: Done }) {
  const [number, setNumber] = useState(feeNote.etims_invoice_number || '');
  const queryClient = useQueryClient();
  const { orgId } = useLawOrg();
  const save = useMutation({
    mutationFn: () => apiRequest(`/api/fee-notes/${feeNote.id}/etims`, { body: { number: number.trim() } }),
    onSuccess: () => { refreshLaw(queryClient, orgId); onDone(`eTIMS number recorded on ${feeNote.invoice_number}.`); },
  });
  return (
    <Dialog open onClose={onClose} title="Record the eTIMS invoice number" note="Issue the invoice on KRA eTIMS, then record the control unit invoice number here so it prints on the fee note."
      footer={<><button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="etims-number" className={buttonClass.primary} disabled={save.isPending || !number.trim()}>{save.isPending ? 'Saving' : 'Save number'}</button></>}>
      <form id="etims-number" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Control unit invoice number"><input name="etimsNumber" required value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        <div className="mt-3"><Problem error={save.error} /></div>
      </form>
    </Dialog>
  );
}
