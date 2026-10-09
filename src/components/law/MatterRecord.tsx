import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { centsFromAmountText } from '../../utils/salesOrders';
import { printedDateTime } from '../../utils/lawDates';
import { Amount, figureText } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { Mark } from '../ledger/Mark';
import { EmptyNote, IndexTabs, LedgerRow, PageHeading, SkeletonRows, buttonClass } from '../ledger/Page';
import { RunningLedger } from '../ledger/RunningLedger';
import { PrintButton } from '../common/PrintButton';
import {
  BILLING_METHODS, EVENT_STATUS, EVENT_TYPES, MATTER_TYPES, PARTY_ROLES, clientName, refreshLaw, say, shortDate,
  useLawOrg, useTeamMembers, type Matter,
} from './lawData';
import {
  ClientPaymentDialog, ClientReceiptDialog, ClientTransferDialog, CourtEventDialog, CourtOutcomeDialog, EtimsNumberDialog,
  FeeNoteBuilderDialog, FeeNotePaymentDialog, LogTimeDialog, OfficeDisbursementDialog,
} from './LawDialogs';
import { MatterStanding } from './MattersView';

type Tab = 'overview' | 'parties' | 'diary' | 'time' | 'disbursements' | 'feeNotes' | 'money';
type Open =
  | { kind: 'edit' } | { kind: 'party' } | { kind: 'time' } | { kind: 'event' } | { kind: 'outcome'; event: any }
  | { kind: 'receipt' } | { kind: 'payment' } | { kind: 'transfer' } | { kind: 'disbursement' } | { kind: 'feeNote' }
  | { kind: 'feePayment'; feeNote: any } | { kind: 'etims'; feeNote: any };

const CLIENT_SOURCE: Record<string, string> = {
  CLIENT_RECEIPT: 'Receipt', CLIENT_PAYMENT: 'Payment', CLIENT_TRANSFER: 'Transfer to office', ADJUSTMENT: 'Reversal',
};

const COPY = {
  noParties: say('No parties recorded besides the client. Add the other side and their advocates so the conflict search can find them.'),
  noTime: say('No time recorded on this matter.'),
  noEvents: say('No court dates on this matter.'),
  noMoney: say('No client money has been received or paid on this matter.'),
  noFeeNotes: say('No fee notes yet. Raise one from unbilled time and disbursements.'),
};

export function MatterRecord({ matter, onBack, initialNotice = '' }: { matter: Matter; onBack: () => void; initialNotice?: string }) {
  const { orgId, currency, timeZone, canPost } = useLawOrg();
  const [tab, setTab] = useState<Tab>('overview');
  const [open, setOpen] = useState<Open | null>(null);
  const [notice, setNotice] = useState(initialNotice);
  const done = (message: string) => { setOpen(null); setNotice(message); };
  const closed = matter.status === 'CLOSED';

  const parties = useQuery({ queryKey: ['matter-parties', orgId, matter.id], queryFn: () => apiRequest<{ parties: any[] }>(`/api/matters/${matter.id}/parties`) });
  const time = useQuery({ queryKey: ['matter-time', orgId, matter.id], queryFn: () => apiRequest<{ entries: any[] }>(`/api/matters/${matter.id}/time`) });
  const events = useQuery({ queryKey: ['court-events', orgId, matter.id], queryFn: () => apiRequest<{ events: any[] }>(`/api/court-events?matterId=${matter.id}`) });
  const ledger = useQuery({ queryKey: ['client-entries', orgId, matter.id], queryFn: () => apiRequest<{ entries: any[] }>(`/api/client-account/entries?matterId=${matter.id}`) });
  const unbilled = useQuery({ queryKey: ['unbilled', orgId, matter.id], queryFn: () => apiRequest<{ timeEntries: any[]; disbursements: any[] }>(`/api/matters/${matter.id}/unbilled`) });
  const feeNotes = useQuery({ queryKey: ['fee-notes', orgId, matter.id], queryFn: () => apiRequest<{ feeNotes: any[] }>(`/api/fee-notes?matterId=${matter.id}`) });
  const disbursements = useQuery({ queryKey: ['disbursements', orgId, matter.id], queryFn: () => apiRequest<{ disbursements: any[] }>(`/api/disbursements?matterId=${matter.id}`) });
  const team = useTeamMembers();

  const entries = ledger.data?.entries || [];
  const heldCents = entries.length ? Number(entries[entries.length - 1].heldCents) : 0;
  const unbilledCents = [...(unbilled.data?.timeEntries || []), ...(unbilled.data?.disbursements || [])]
    .reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
  const owingCents = (feeNotes.data?.feeNotes || []).filter((note) => note.status !== 'VOID')
    .reduce((sum, note) => sum + Number(note.amount_due_cents || 0), 0);
  const responsible = (team.data?.members || []).find((member) => member.userId === matter.responsible_user_id);

  return (
    <div className="space-y-4">
      <button type="button" className={buttonClass.quiet} onClick={onBack}>All matters</button>
      <PageHeading
        title={matter.title}
        note={<><span className="ll-figure">{matter.matter_number}</span> · {clientName(matter)} · {MATTER_TYPES[matter.matter_type]?.en || matter.matter_type} · <MatterStanding matter={matter} /></>}
        actions={canPost && !closed && (
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setOpen({ kind: 'time' })}>Record time</button>
            <button type="button" className={buttonClass.primary} onClick={() => setOpen({ kind: 'feeNote' })}>Raise a fee note</button>
          </>
        )}
      />
      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}

      <dl className="grid grid-cols-2 border-b border-feint-strong sm:grid-cols-3">
        {[
          { label: 'Client money held', cents: heldCents },
          { label: 'Unbilled work', cents: unbilledCents },
          { label: 'Owing on fee notes', cents: owingCents },
        ].map((figure, index) => (
          <div key={figure.label} className={`py-3 ${index > 0 ? 'border-l border-feint pl-4' : ''}`}>
            <dt className="ll-printed text-[10.5px] text-graphite-600">{figure.label}</dt>
            <dd className="mt-1"><Amount cents={figure.cents} currency={currency} size="lg" /></dd>
          </div>
        ))}
      </dl>

      <IndexTabs<Tab>
        label="Matter sections"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', name: 'Overview' },
          { id: 'parties', name: 'Parties', count: parties.data?.parties.length },
          { id: 'diary', name: 'Diary', count: events.data?.events.length },
          { id: 'time', name: 'Time', count: time.data?.entries.length },
          { id: 'disbursements', name: 'Disbursements', count: disbursements.data?.disbursements.length },
          { id: 'feeNotes', name: 'Fee notes', count: feeNotes.data?.feeNotes.length },
          { id: 'money', name: 'Client money' },
        ]}
      />

      {tab === 'overview' && (
        <section className="grid gap-x-10 gap-y-2 md:grid-cols-2">
          <div>
            <LedgerRow label="Client">{clientName(matter)}</LedgerRow>
            <LedgerRow label="Responsible advocate">{responsible?.email || 'Not yet assigned'}</LedgerRow>
            <LedgerRow label="Billed by">{matter.billing_method ? BILLING_METHODS[matter.billing_method]?.en : 'Not set'}</LedgerRow>
            <LedgerRow label="Hourly rate">{matter.default_rate_cents != null ? <Amount cents={Number(matter.default_rate_cents)} currency={currency} tone="ink" size="sm" /> : '–'}</LedgerRow>
            {matter.fixed_fee_cents != null && <LedgerRow label="Fixed fee"><Amount cents={Number(matter.fixed_fee_cents)} currency={currency} tone="ink" size="sm" /></LedgerRow>}
            <LedgerRow label="Opened">{shortDate(matter.opened_on)}</LedgerRow>
            {matter.closed_on && <LedgerRow label="Closed">{shortDate(matter.closed_on)}</LedgerRow>}
          </div>
          <div>
            <LedgerRow label="Stage">{matter.stage || '–'}</LedgerRow>
            <LedgerRow label="Court">{[matter.court, matter.court_station].filter(Boolean).join(', ') || '–'}</LedgerRow>
            <LedgerRow label="Case number">{matter.case_number || '–'}</LedgerRow>
            <LedgerRow label="Judicial officer">{matter.judicial_officer || '–'}</LedgerRow>
            <LedgerRow label="Notes">{matter.notes || '–'}</LedgerRow>
          </div>
          {canPost && <div className="md:col-span-2"><button type="button" className={buttonClass.secondary} onClick={() => setOpen({ kind: 'edit' })}>Edit details</button></div>}
        </section>
      )}

      {tab === 'parties' && (
        <section>
          {canPost && <button type="button" className={buttonClass.secondary} onClick={() => setOpen({ kind: 'party' })}>Add a party</button>}
          {parties.isLoading ? <SkeletonRows label="Loading parties" rows={3} />
            : !(parties.data?.parties.length) ? <EmptyNote>{COPY.noParties.en}</EmptyNote>
              : (
                <ul className="mt-2">
                  {parties.data.parties.map((party) => (
                    <li key={party.id} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-feint py-2 text-[13.5px]">
                      <span className="text-ink-900">{party.name}</span>
                      <span className="text-graphite-600">{PARTY_ROLES[party.role]?.en || party.role}{party.id_or_reg_number ? ` · ${party.id_or_reg_number}` : ''}{party.phone ? ` · ${party.phone}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
        </section>
      )}

      {tab === 'time' && (
        <section>
          {canPost && !closed && <button type="button" className={buttonClass.secondary} onClick={() => setOpen({ kind: 'time' })}>Record time</button>}
          {time.isLoading ? <SkeletonRows label="Loading time" rows={3} />
            : !(time.data?.entries.length) ? <EmptyNote>{COPY.noTime.en}</EmptyNote>
              : (
                <table className="mt-2 w-full text-[13.5px]">
                  <caption className="sr-only">Time on {matter.matter_number}</caption>
                  <thead><tr><th scope="col" className="pr-4 text-left">Date</th><th scope="col" className="pr-4 text-left">Work</th><th scope="col" className="pr-4 text-right">Hours</th><th scope="col" className="pr-4 text-left">Standing</th><th scope="col" className="text-right">{currency}</th></tr></thead>
                  <tbody>
                    {time.data.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="pr-4 whitespace-nowrap text-graphite-600">{shortDate(entry.entry_date)}</td>
                        <td className="pr-4">{entry.description || 'Professional time'}</td>
                        <td className="pr-4 text-right">{Number(entry.hours)}</td>
                        <td className="pr-4 text-[12.5px] text-graphite-600">{!entry.billable ? 'Not billable' : entry.invoice_id ? <Mark kind="tick" label="Billed" /> : 'Unbilled'}</td>
                        <td className="text-right"><Amount cents={Number(entry.amount_cents || 0)} currency={currency} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
        </section>
      )}

      {tab === 'diary' && (
        <section>
          {canPost && !closed && <button type="button" className={buttonClass.secondary} onClick={() => setOpen({ kind: 'event' })}>Add a court date</button>}
          {events.isLoading ? <SkeletonRows label="Loading court dates" rows={3} />
            : !(events.data?.events.length) ? <EmptyNote>{COPY.noEvents.en}</EmptyNote>
              : (
                <ul className="mt-2">
                  {events.data.events.map((event) => (
                    <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-feint py-2 text-[13.5px]">
                      <span>
                        <span className="ll-figure mr-2 text-ink-900">{printedDateTime(event.starts_at, timeZone)}</span>
                        {EVENT_TYPES[event.event_type]?.en || event.event_type}{event.court ? ` · ${event.court}` : ''}{event.courtroom ? `, ${event.courtroom}` : ''}
                        {event.outcome && <span className="block text-[12.5px] text-graphite-600">{event.outcome}</span>}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-[12.5px] text-graphite-600">{EVENT_STATUS[event.status]?.en || event.status}</span>
                        {canPost && event.status === 'SCHEDULED' && <button type="button" className={buttonClass.quiet} onClick={() => setOpen({ kind: 'outcome', event: { ...event, matters: { matter_number: matter.matter_number, title: matter.title } } })}>Record outcome</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
        </section>
      )}

      {tab === 'money' && (
        <section>
          {canPost && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass.secondary} onClick={() => setOpen({ kind: 'receipt' })}>Receive client money</button>
              <button type="button" className={buttonClass.secondary} onClick={() => setOpen({ kind: 'payment' })} disabled={heldCents <= 0}>Pay out</button>
              <button type="button" className={buttonClass.secondary} onClick={() => setOpen({ kind: 'transfer' })} disabled={heldCents <= 0}>Transfer to office</button>
            </div>
          )}
          {ledger.isLoading ? <SkeletonRows label="Loading the client ledger" rows={3} />
            : entries.length === 0 ? <EmptyNote>{COPY.noMoney.en}</EmptyNote>
              : (
                <div className="mt-2">
                  <RunningLedger
                    accountLabel={`Client money held for ${matter.matter_number}`}
                    currency={currency}
                    lines={entries.map((entry) => ({
                      id: entry.id, date: entry.date, sourceType: CLIENT_SOURCE[entry.sourceType] || entry.sourceType,
                      memo: entry.reference && !String(entry.particulars).includes(entry.reference) ? `${entry.particulars} · ${entry.reference}` : entry.particulars,
                      debit: entry.paidCents, credit: entry.receivedCents,
                    }))}
                  />
                  <p className="mt-2 text-[12.5px] text-graphite-600">A Cr balance is money held for the client. Payments may not take it below nil.</p>
                </div>
              )}
        </section>
      )}

      {tab === 'disbursements' && (
        <section className="space-y-3">
          {canPost && !closed && <button type="button" className={buttonClass.secondary} onClick={() => setOpen({ kind: 'disbursement' })}>Record an office disbursement</button>}
          {disbursements.isLoading ? <SkeletonRows label="Loading disbursements" rows={2} />
            : !(disbursements.data?.disbursements.length) ? <EmptyNote>No disbursements on this matter. Court fees paid from client money and costs the firm paid both appear here.</EmptyNote>
              : (
              <ul>
                {disbursements.data!.disbursements.map((cost) => (
                  <li key={cost.id} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-feint py-2 text-[13.5px]">
                    <span>{shortDate(cost.incurred_on)} · {cost.description} <span className="text-[12.5px] text-graphite-600">· {cost.paid_from === 'CLIENT' ? 'paid from client money' : cost.invoice_id ? 'billed' : 'unbilled, paid by the firm'}</span></span>
                    <Amount cents={Number(cost.amount_cents)} currency={currency} />
                  </li>
                ))}
              </ul>
              )}
        </section>
      )}

      {tab === 'feeNotes' && (
        <section className="space-y-3">
          {canPost && !closed && <button type="button" className={buttonClass.secondary} onClick={() => setOpen({ kind: 'feeNote' })}>Raise a fee note</button>}
          <div>
            {feeNotes.isLoading ? <SkeletonRows label="Loading fee notes" rows={2} />
              : !(feeNotes.data?.feeNotes.length) ? <EmptyNote>{COPY.noFeeNotes.en}</EmptyNote>
                : <FeeNoteList notes={feeNotes.data.feeNotes} canPost={canPost} onPay={(note) => setOpen({ kind: 'feePayment', feeNote: note })} onEtims={(note) => setOpen({ kind: 'etims', feeNote: note })} />}
          </div>
        </section>
      )}

      {open?.kind === 'edit' && <EditMatterDialog matter={matter} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'party' && <AddPartyDialog matter={matter} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'time' && <LogTimeDialog matter={matter} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'event' && <CourtEventDialog matter={matter} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'outcome' && <CourtOutcomeDialog event={open.event} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'receipt' && <ClientReceiptDialog matter={matter} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'payment' && <ClientPaymentDialog matter={matter} heldCents={heldCents} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'transfer' && <ClientTransferDialog matter={matter} heldCents={heldCents} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'disbursement' && <OfficeDisbursementDialog matter={matter} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'feeNote' && <FeeNoteBuilderDialog matter={matter} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'feePayment' && <FeeNotePaymentDialog feeNote={open.feeNote} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'etims' && <EtimsNumberDialog feeNote={open.feeNote} onClose={() => setOpen(null)} onDone={done} />}
    </div>
  );
}

export function FeeNoteStanding({ note }: { note: any }) {
  if (note.status === 'VOID') return <Mark kind="circled" label="Void" />;
  if (note.status === 'PAID') return <Mark kind="tick" label="Paid" />;
  if (note.status === 'PARTIALLY_PAID') return <Mark kind="query" label="Part paid" />;
  return <span className="text-[12.5px] text-graphite-600">Delivered</span>;
}

export function FeeNoteList({ notes, canPost, onPay, onEtims, matterOf }: {
  notes: any[]; canPost: boolean; onPay: (note: any) => void; onEtims: (note: any) => void; matterOf?: (note: any) => string;
}) {
  const { currency } = useLawOrg();
  return (
    <ul>
      {notes.map((note) => (
        <li key={note.id} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-feint py-2 text-[13.5px]">
          <span className="min-w-0">
            <span className="ll-figure mr-2 text-ink-900">{note.invoice_number}</span>
            {matterOf && <span className="mr-2">{matterOf(note)}</span>}
            <span className="text-graphite-600">{shortDate(note.date)}{note.due_date ? `, due ${shortDate(note.due_date)}` : ''}</span>
            <span className="block text-[12.5px] text-graphite-600">
              <FeeNoteStanding note={note} />
              {Number(note.amount_due_cents) > 0 && note.status !== 'VOID' && <> · {currency} {figureText(Number(note.amount_due_cents))} owing</>}
              {note.etims_invoice_number ? ` · eTIMS ${note.etims_invoice_number}` : ''}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Amount cents={Number(note.total_cents)} currency={currency} />
            <PrintButton kind="invoice" id={note.id} number={note.invoice_number} />
            {canPost && Number(note.amount_due_cents) > 0 && ['SENT', 'PARTIALLY_PAID'].includes(note.status) && <button type="button" className={buttonClass.quiet} onClick={() => onPay(note)}>Receive payment</button>}
            {canPost && note.status !== 'VOID' && !note.etims_invoice_number && <button type="button" className={buttonClass.quiet} onClick={() => onEtims(note)}>eTIMS number</button>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AddPartyDialog({ matter, onClose, onDone }: { matter: Matter; onClose: () => void; onDone: (message: string) => void }) {
  const { orgId } = useLawOrg();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [role, setRole] = useState('OPPOSING_PARTY');
  const [idNumber, setIdNumber] = useState('');
  const [phone, setPhone] = useState('');
  const save = useMutation({
    mutationFn: () => apiRequest(`/api/matters/${matter.id}/parties`, {
      body: { name: name.trim(), role, ...(idNumber.trim() ? { idOrRegNumber: idNumber.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) },
    }),
    onSuccess: () => { refreshLaw(queryClient, orgId); onDone(`${name.trim()} added to ${matter.matter_number}.`); },
  });
  return (
    <Dialog open onClose={onClose} title="Add a party"
      footer={<><button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="add-party" className={buttonClass.primary} disabled={save.isPending}>{save.isPending ? 'Adding' : 'Add party'}</button></>}>
      <form id="add-party" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><input name="partyName" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Role">
          <select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(PARTY_ROLES).map(([id, label]) => <option key={id} value={id}>{label.en}</option>)}
          </select>
        </Field>
        <Field label="ID or registration number" hint="Optional"><input name="idOrRegNumber" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} /></Field>
        <Field label="Phone" hint="Optional"><input name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        {save.error && <p role="alert" className="sm:col-span-2 text-[13px] text-ledger-red">{save.error.message}</p>}
      </form>
    </Dialog>
  );
}

function EditMatterDialog({ matter, onClose, onDone }: { matter: Matter; onClose: () => void; onDone: (message: string) => void }) {
  const { orgId, currency, timeZone } = useLawOrg();
  const queryClient = useQueryClient();
  const team = useTeamMembers();
  const [title, setTitle] = useState(matter.title);
  const [stage, setStage] = useState(matter.stage || '');
  const [status, setStatus] = useState(matter.status);
  const [responsible, setResponsible] = useState(matter.responsible_user_id || '');
  const [court, setCourt] = useState(matter.court || '');
  const [caseNumber, setCaseNumber] = useState(matter.case_number || '');
  const [officer, setOfficer] = useState(matter.judicial_officer || '');
  const [rate, setRate] = useState(matter.default_rate_cents != null ? (Number(matter.default_rate_cents) / 100).toFixed(2) : '');
  const [notes, setNotes] = useState(matter.notes || '');
  const [problem, setProblem] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const rateCents = rate.trim() ? centsFromAmountText(rate) : null;
      if (rate.trim() && rateCents == null) throw new Error('Enter the hourly rate in shillings.');
      const closing = status === 'CLOSED' && matter.status !== 'CLOSED';
      const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
      return apiRequest(`/api/matters/${matter.id}`, {
        method: 'PATCH',
        body: {
          title: title.trim(), stage: stage.trim() || undefined, status, court: court.trim() || undefined,
          caseNumber: caseNumber.trim() || undefined, judicialOfficer: officer.trim() || undefined, notes: notes.trim() || undefined,
          ...(responsible ? { responsibleUserId: responsible } : {}),
          ...(rateCents != null ? { defaultRateCents: rateCents } : {}),
          ...(closing ? { closedOn: today } : status !== 'CLOSED' && matter.closed_on ? { closedOn: null } : {}),
        },
      });
    },
    onSuccess: () => { refreshLaw(queryClient, orgId); onDone(`${matter.matter_number} saved.`); },
    onError: (err: Error) => setProblem(err.message),
  });
  return (
    <Dialog open onClose={onClose} width="lg" title={`Edit ${matter.matter_number}`} note="The client and the opening date stay as the matter was opened."
      footer={<><button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="edit-matter" className={buttonClass.primary} disabled={save.isPending}>{save.isPending ? 'Saving' : 'Save changes'}</button></>}>
      <form id="edit-matter" onSubmit={(e) => { e.preventDefault(); setProblem(''); save.mutate(); }} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Matter title"><input name="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field></div>
        <Field label="Stage" hint="For example: pleadings, hearing, judgment."><input name="stage" value={stage} onChange={(e) => setStage(e.target.value)} /></Field>
        <Field label="Standing">
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value as Matter['status'])}>
            <option value="OPEN">Open</option><option value="ON_HOLD">On hold</option><option value="CLOSED">Closed</option>
          </select>
        </Field>
        <Field label="Responsible advocate">
          <select name="responsibleUserId" value={responsible} onChange={(e) => setResponsible(e.target.value)}>
            <option value="">Not yet assigned</option>
            {(team.data?.members || []).map((member) => <option key={member.userId} value={member.userId}>{member.email}</option>)}
          </select>
        </Field>
        <Field label={`Hourly rate, ${currency}`}><input name="defaultRateCents" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        <Field label="Court"><input name="court" value={court} onChange={(e) => setCourt(e.target.value)} /></Field>
        <Field label="Case number"><input name="caseNumber" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Judicial officer"><input name="judicialOfficer" value={officer} onChange={(e) => setOfficer(e.target.value)} /></Field></div>
        <div className="sm:col-span-2"><Field label="Notes"><textarea name="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
        {problem && <p role="alert" className="sm:col-span-2 text-[13px] text-ledger-red">{problem}</p>}
      </form>
    </Dialog>
  );
}
