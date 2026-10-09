import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { apiRequest, newIdempotencyKey } from '../../utils/apiRequest';
import { centsFromAmountText } from '../../utils/salesOrders';
import { bankingVariance, countTotalCents, DENOMINATIONS, readCounts } from '../../utils/cashCount';
import {
  detectMemberColumns, MEMBER_FIELDS, MEMBER_STATUSES, missingMemberFields, readMembers, type MemberMapping,
} from '../../utils/memberImport';
import {
  detectMpesaColumns, missingMpesaFields, MPESA_STATEMENT_FIELDS, readMpesaStatement, type MpesaStatementMapping,
} from '../../utils/mpesaStatement';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';
import {
  MEMBER_STATUS, memberLabel, refreshChurch, say, shortDate, useChurchOrg, useFunds, useHouseholds, useMembers,
  useMoneyAccounts, type Member,
} from './churchData';

type Done = (message: string) => void;

const COPY = {
  saveMember: say('Save member'),
  importMembers: say('Import members'),
  saveHousehold: say('Save household'),
  postGift: say('Post the gift'),
  postAssigned: say('Post to this fund'),
  setAside: say('Set aside'),
  upload: say('Upload the statement'),
  saveCount: say('Save the first count'),
  confirmCount: say('Confirm and post'),
  bank: say('Post the banking'),
  saveFund: say('Save fund'),
  saveRule: say('Save rule'),
};

/** Posts once per opening of a dialog: the key is kept until it succeeds. */
function useChurchPost<T = any>(onDone: Done) {
  const queryClient = useQueryClient();
  const { orgId } = useChurchOrg();
  const [key, setKey] = useState(newIdempotencyKey);
  return useMutation({
    mutationFn: async ({ path, body, method = 'POST', keyed = true }: {
      path: string; body: Record<string, unknown>; method?: 'POST' | 'PATCH'; message: string | ((result: T) => string); keyed?: boolean;
    }) => apiRequest<T>(path, { method, body: keyed && method === 'POST' ? { ...body, idempotencyKey: key } : body }),
    onSuccess: (result, variables) => {
      refreshChurch(queryClient, orgId);
      setKey(newIdempotencyKey());
      onDone(typeof variables.message === 'function' ? variables.message(result) : variables.message);
    },
  });
}

function Footer({ onClose, busy, label, form, disabled = false }: { onClose: () => void; busy: boolean; label: string; form: string; disabled?: boolean }) {
  return (
    <>
      <button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
      <button type="submit" form={form} className={buttonClass.primary} disabled={busy || disabled}>{busy ? 'Saving' : label}</button>
    </>
  );
}

function Problem({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="text-[13px] text-ledger-red">{error instanceof Error ? error.message : String(error)}</p>;
}

function FundPicker({ value, onChange, label = 'Fund' }: { value: string; onChange: (id: string) => void; label?: string }) {
  const funds = useFunds();
  return (
    <Field label={label}>
      <select required value={value} onChange={(event) => onChange(event.target.value)} name="fundId">
        <option value="">Choose the fund</option>
        {(funds.data?.funds || []).filter((fund) => fund.is_active || fund.id === value).map((fund) => (
          <option key={fund.id} value={fund.id}>{fund.name}{fund.restricted ? ' (restricted)' : ''}</option>
        ))}
      </select>
    </Field>
  );
}

function MemberPicker({ value, onChange, optional = true }: { value: string; onChange: (id: string) => void; optional?: boolean }) {
  const members = useMembers();
  return (
    <Field label="Member" hint={optional ? 'Leave as "No member" for an anonymous gift.' : undefined}>
      <select value={value} onChange={(event) => onChange(event.target.value)} name="memberId" required={!optional}>
        <option value="">{optional ? 'No member' : 'Choose the member'}</option>
        {(members.data?.members || []).map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}
      </select>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Members and households
// ---------------------------------------------------------------------------

export function MemberDialog({ member, onClose, onDone }: { member?: Member | null; onClose: () => void; onDone: Done }) {
  const households = useHouseholds();
  const [form, setForm] = useState({
    memberNumber: member?.member_number || '', firstName: member?.first_name || '', lastName: member?.last_name || '',
    phone: member?.phone || '', email: member?.email || '', consentMethod: member?.consent_method || '',
    status: member?.status || 'MEMBER', householdId: member?.household_id || '', dateOfBirth: member?.date_of_birth || '',
    joinedOn: member?.joined_on || '', notes: member?.notes || '',
  });
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [field]: event.target.value });
  const post = useChurchPost(onDone);
  const needsConsent = Boolean(form.phone.trim() || form.email.trim());
  return (
    <Dialog open onClose={onClose} title={member ? `Member ${member.member_number}` : 'Add a member'} width="lg"
      note="The member number is also the M-Pesa account reference the member gives."
      footer={<Footer onClose={onClose} busy={post.isPending} label={COPY.saveMember.en} form="member-form" />}>
      <form id="member-form" className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const body = {
          ...form, lastName: form.lastName || null, phone: form.phone || null, email: form.email || null,
          consentMethod: form.consentMethod || null, householdId: form.householdId || null,
          dateOfBirth: form.dateOfBirth || null, joinedOn: form.joinedOn || null, notes: form.notes || null,
        };
        post.mutate(member
          ? { path: `/api/members/${member.id}`, method: 'PATCH', body, message: `Member ${form.memberNumber.toUpperCase()} saved.` }
          : { path: '/api/members', body, keyed: false, message: `Member ${form.memberNumber.toUpperCase()} added to the register.` });
      }}>
        <Field label="Member number"><input required value={form.memberNumber} onChange={set('memberNumber')} maxLength={20} name="memberNumber" /></Field>
        <Field label="Status">
          <select value={form.status} onChange={set('status')} name="status">
            {MEMBER_STATUSES.map((status) => <option key={status} value={status}>{MEMBER_STATUS[status].en}</option>)}
          </select>
        </Field>
        <Field label="First name"><input required value={form.firstName} onChange={set('firstName')} maxLength={100} name="firstName" /></Field>
        <Field label="Last name"><input value={form.lastName} onChange={set('lastName')} maxLength={100} name="lastName" /></Field>
        <Field label="Phone"><input value={form.phone} onChange={set('phone')} maxLength={40} name="phone" inputMode="tel" /></Field>
        <Field label="Email"><input value={form.email} onChange={set('email')} maxLength={320} name="email" type="email" /></Field>
        <div className="sm:col-span-2">
          <Field label="Consent to contact" hint={needsConsent
            ? 'Required with a phone number or email: say how the member agreed, for example "Signed form".'
            : 'Only needed when a phone number or email is kept.'}>
            <input value={form.consentMethod} onChange={set('consentMethod')} maxLength={100} name="consentMethod" required={needsConsent} />
          </Field>
        </div>
        <Field label="Household">
          <select value={form.householdId} onChange={set('householdId')} name="householdId">
            <option value="">No household</option>
            {(households.data?.households || []).map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}
          </select>
        </Field>
        <Field label="Joined on"><input type="date" value={form.joinedOn} onChange={set('joinedOn')} name="joinedOn" /></Field>
        <Field label="Date of birth" hint="Optional."><input type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} name="dateOfBirth" /></Field>
        <div className="sm:col-span-2"><Field label="Notes"><textarea rows={2} value={form.notes} onChange={set('notes')} maxLength={2000} name="notes" /></Field></div>
        <div className="sm:col-span-2"><Problem error={post.error} /></div>
      </form>
    </Dialog>
  );
}

export function HouseholdDialog({ onClose, onDone }: { onClose: () => void; onDone: Done }) {
  const [form, setForm] = useState({ name: '', address: '', phone: '' });
  const post = useChurchPost(onDone);
  return (
    <Dialog open onClose={onClose} title="Add a household" footer={<Footer onClose={onClose} busy={post.isPending} label={COPY.saveHousehold.en} form="household-form" />}>
      <form id="household-form" className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        post.mutate({ path: '/api/households', keyed: false, body: { name: form.name, address: form.address || null, phone: form.phone || null }, message: `Household ${form.name.trim()} added.` });
      }}>
        <Field label="Household name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={200} name="name" /></Field>
        <Field label="Address"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={500} name="address" /></Field>
        <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={40} name="phone" /></Field>
        <Problem error={post.error} />
      </form>
    </Dialog>
  );
}

const MEMBER_MAPPING_KEY = (orgId: string) => `kundi.member-import-mapping.${orgId}`;
const STATEMENT_MAPPING_KEY = (orgId: string) => `kundi.mpesa-statement-mapping.${orgId}`;
const readStored = <T,>(key: string): T | null => {
  try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
};
const store = (key: string, value: unknown) => { try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* not kept */ } };

function parseFile(file: File): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (result) => resolve((result.data as string[][]).map((row) => row.map((cell) => String(cell ?? '').trim()))),
      error: (err) => reject(err),
    });
  });
}

function ColumnSelect({ label, value, header, onChange, required }: { label: string; value: number | undefined; header: string[]; onChange: (index: number | undefined) => void; required: boolean }) {
  return (
    <Field label={required ? label : `${label} (optional)`}>
      <select value={value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}>
        <option value="">{required ? 'Choose the column' : 'Not in this file'}</option>
        {header.map((name, index) => <option key={index} value={index}>{name || `Column ${index + 1}`}</option>)}
      </select>
    </Field>
  );
}

/** Members from a CSV. The columns are matched once and remembered for the next file. */
export function ImportMembersDialog({ onClose, onDone }: { onClose: () => void; onDone: Done }) {
  const { orgId } = useChurchOrg();
  const members = useMembers();
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<MemberMapping>({});
  const [problem, setProblem] = useState('');
  const post = useChurchPost<{ imported: number; householdsCreated: number }>(onDone);
  const existing = useMemo(() => new Set((members.data?.members || []).map((member) => member.member_number.toUpperCase())), [members.data]);
  const header = rows[0] || [];
  const read = useMemo(() => (rows.length > 1 && !missingMemberFields(mapping).length ? readMembers(rows, mapping, existing) : null), [rows, mapping, existing]);

  return (
    <Dialog open onClose={onClose} title="Import members from CSV" width="xl"
      note="One member per row, with a header row. A phone number or email is imported only with a consent column saying how the member agreed."
      footer={<Footer onClose={onClose} busy={post.isPending} label={read ? `${COPY.importMembers.en} (${read.members.length})` : COPY.importMembers.en}
        form="member-import-form" disabled={!read || read.members.length === 0} />}>
      <form id="member-import-form" className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (!read?.members.length) return;
        store(MEMBER_MAPPING_KEY(orgId), mapping);
        post.mutate({
          path: '/api/members/import', keyed: false, body: { members: read.members },
          message: (result) => `${result.imported} members imported${result.householdsCreated ? `, with ${result.householdsCreated} new households` : ''}.`,
        });
      }}>
        <Field label="CSV file">
          <input type="file" accept=".csv,text/csv" name="file" onChange={async (event) => {
            const file = event.target.files?.[0];
            setProblem('');
            if (!file) return;
            try {
              const parsed = await parseFile(file);
              if (parsed.length < 2) { setProblem('The file has no rows below its header.'); return; }
              setRows(parsed);
              const remembered = readStored<MemberMapping>(MEMBER_MAPPING_KEY(orgId));
              const fits = remembered && Object.values(remembered).every((index) => typeof index !== 'number' || index < parsed[0].length);
              setMapping(fits ? remembered : detectMemberColumns(parsed[0]));
            } catch { setProblem('The file could not be read as CSV.'); }
          }} />
        </Field>
        {header.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {MEMBER_FIELDS.map(({ field, label, required }) => (
              <ColumnSelect key={field} label={label} required={required} header={header} value={mapping[field]}
                onChange={(index) => setMapping({ ...mapping, [field]: index })} />
            ))}
          </div>
        )}
        {header.length > 0 && missingMemberFields(mapping).length > 0 && (
          <p className="text-[13px] text-ledger-red">Choose the column for: {missingMemberFields(mapping).join(', ')}.</p>
        )}
        {read && (
          <div className="text-[13px]">
            <p className="text-ink-900">{read.members.length} members ready to import. {read.problems.length ? `${read.problems.length} rows will be left out:` : 'No rows are left out.'}</p>
            {read.problems.length > 0 && (
              <ul className="mt-1 max-h-40 overflow-y-auto border border-feint p-2 text-graphite-600">
                {read.problems.map((item) => <li key={item.row}>Row {item.row}: {item.reason}</li>)}
              </ul>
            )}
          </div>
        )}
        {problem && <p role="alert" className="text-[13px] text-ledger-red">{problem}</p>}
        <Problem error={post.error} />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Giving
// ---------------------------------------------------------------------------

export function GiftDialog({ memberId, onClose, onDone }: { memberId?: string; onClose: () => void; onDone: Done }) {
  const { today, currency } = useChurchOrg();
  const [form, setForm] = useState({ memberId: memberId || '', fundId: '', method: 'BANK', amount: '', receivedOn: today });
  const post = useChurchPost<{ id: string; journalEntryId: string }>(onDone);
  const cents = centsFromAmountText(form.amount);
  return (
    <Dialog open onClose={onClose} title="Record a gift" note="Cash handed in outside a service count, a bank transfer or a cheque. M-Pesa gifts arrive by themselves or from a statement."
      footer={<Footer onClose={onClose} busy={post.isPending} label={COPY.postGift.en} form="gift-form" disabled={!cents} />}>
      <form id="gift-form" className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (!cents) return;
        post.mutate({
          path: '/api/contributions',
          body: { memberId: form.memberId || null, fundId: form.fundId, method: form.method, amountCents: cents, receivedOn: form.receivedOn },
          message: () => `Gift of ${currency} ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })} posted to the fund. The journal entry is in Full books.`,
        });
      }}>
        <MemberPicker value={form.memberId} onChange={(id) => setForm({ ...form, memberId: id })} />
        <FundPicker value={form.fundId} onChange={(id) => setForm({ ...form, fundId: id })} />
        <Field label="How it came">
          <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} name="method">
            <option value="BANK">Bank transfer</option>
            <option value="CHEQUE">Cheque</option>
            <option value="CASH">Cash</option>
          </select>
        </Field>
        <Field label={`Amount (${currency})`}><input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} name="amount" /></Field>
        <Field label="Received on"><input required type="date" value={form.receivedOn} onChange={(e) => setForm({ ...form, receivedOn: e.target.value })} name="receivedOn" /></Field>
        <Problem error={post.error} />
      </form>
    </Dialog>
  );
}

export interface QueueItem {
  id: string;
  transId: string;
  transTime: string;
  amountCents: number;
  billRefNumber: string | null;
  firstName: string | null;
  reason: string;
  suggestedFundId: string | null;
  suggestedMemberId: string | null;
  suggestions: Array<{ memberId: string; memberNumber: string; name: string; why: string }>;
}

export function AssignReceiptDialog({ item, onClose, onDone }: { item: QueueItem; onClose: () => void; onDone: Done }) {
  const { currency } = useChurchOrg();
  const [memberId, setMemberId] = useState(item.suggestedMemberId || item.suggestions[0]?.memberId || '');
  const [fundId, setFundId] = useState(item.suggestedFundId || '');
  const post = useChurchPost(onDone);
  return (
    <Dialog open onClose={onClose} title={`Place M-Pesa receipt ${item.transId}`}
      note={<>Reference {item.billRefNumber ? `"${item.billRefNumber}"` : 'left blank'}{item.firstName ? `, paid by ${item.firstName}` : ''}. <Amount cents={item.amountCents} currency={currency} /></>}
      footer={<Footer onClose={onClose} busy={post.isPending} label={COPY.postAssigned.en} form="assign-form" />}>
      <form id="assign-form" className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        post.mutate({ path: `/api/giving/queue/${item.id}/assign`, keyed: false, body: { memberId: memberId || null, fundId }, message: `M-Pesa receipt ${item.transId} posted as giving.` });
      }}>
        <p className="text-[13px] text-graphite-600">Why it waited: {item.reason}</p>
        {item.suggestions.length > 0 && (
          <ul className="text-[13px]">
            {item.suggestions.map((suggestion) => (
              <li key={suggestion.memberId}>
                <button type="button" className={buttonClass.quiet} onClick={() => setMemberId(suggestion.memberId)}>
                  {suggestion.memberNumber} · {suggestion.name}
                </button>
                <span className="ml-2 text-graphite-600">{suggestion.why}</span>
              </li>
            ))}
          </ul>
        )}
        <MemberPicker value={memberId} onChange={setMemberId} />
        <FundPicker value={fundId} onChange={setFundId} />
        <Problem error={post.error} />
      </form>
    </Dialog>
  );
}

export function SetAsideDialog({ item, onClose, onDone }: { item: QueueItem; onClose: () => void; onDone: Done }) {
  const [reason, setReason] = useState('');
  const post = useChurchPost(onDone);
  return (
    <Dialog open onClose={onClose} title={`Set aside ${item.transId}`} note="For a payment that is not giving: a refund, a test, or money for something else. It can go back to the queue later."
      footer={<Footer onClose={onClose} busy={post.isPending} label={COPY.setAside.en} form="set-aside-form" />}>
      <form id="set-aside-form" className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        post.mutate({ path: `/api/giving/queue/${item.id}/ignore`, keyed: false, body: { reason }, message: `M-Pesa receipt ${item.transId} set aside.` });
      }}>
        <Field label="Why this is not giving"><input required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} name="reason" /></Field>
        <Problem error={post.error} />
      </form>
    </Dialog>
  );
}

/** An M-Pesa statement from the org portal, for churches without Daraja. */
export function StatementUploadDialog({ onClose, onDone }: { onClose: () => void; onDone: Done }) {
  const { orgId, currency } = useChurchOrg();
  const [rows, setRows] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<MpesaStatementMapping>({});
  const [problem, setProblem] = useState('');
  const post = useChurchPost<{ newReceipts: number; alreadyKept: number; posted: any[]; queued: any[]; charges: { charges: number; amountCents: number } }>(onDone);
  const header = rows[headerRow] || [];
  const read = useMemo(() => (rows.length && !missingMpesaFields(mapping).length ? readMpesaStatement(rows, headerRow, mapping) : null), [rows, headerRow, mapping]);
  return (
    <Dialog open onClose={onClose} title="Upload an M-Pesa statement" width="xl"
      note="The statement CSV from the M-Pesa org portal. Each receipt is kept once, however often it is uploaded; Safaricom's charges post to bank and M-Pesa charges (6400)."
      footer={<Footer onClose={onClose} busy={post.isPending} label={COPY.upload.en} form="statement-form" disabled={!read || (read.gifts.length + read.charges.length) === 0} />}>
      <form id="statement-form" className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (!read) return;
        store(STATEMENT_MAPPING_KEY(orgId), mapping);
        post.mutate({
          path: '/api/mpesa/statements', keyed: false, body: { gifts: read.gifts, charges: read.charges },
          message: (result) => `Statement read: ${result.newReceipts} new receipts, ${result.alreadyKept} already kept. ${result.posted.length} posted as giving, ${result.queued.length} waiting in the queue.${result.charges.charges ? ` Charges of ${currency} ${(result.charges.amountCents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })} posted.` : ''}`,
        });
      }}>
        <Field label="Statement file (CSV)">
          <input type="file" accept=".csv,text/csv" name="file" onChange={async (event) => {
            const file = event.target.files?.[0];
            setProblem('');
            if (!file) return;
            try {
              const parsed = await parseFile(file);
              const detected = detectMpesaColumns(parsed);
              setRows(parsed);
              setHeaderRow(detected.headerRow);
              const remembered = readStored<MpesaStatementMapping>(STATEMENT_MAPPING_KEY(orgId));
              setMapping(detected.mapping || remembered || {});
              if (!detected.mapping && !remembered) setProblem('The columns were not recognised. Choose them below.');
            } catch { setProblem('The file could not be read as CSV.'); }
          }} />
        </Field>
        {rows.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {MPESA_STATEMENT_FIELDS.map(({ field, label, required }) => (
              <ColumnSelect key={field} label={label} required={required} header={header} value={mapping[field]}
                onChange={(index) => setMapping({ ...mapping, [field]: index })} />
            ))}
          </div>
        )}
        {rows.length > 0 && missingMpesaFields(mapping).length > 0 && (
          <p className="text-[13px] text-ledger-red">Choose the column for: {missingMpesaFields(mapping).join(', ')}.</p>
        )}
        {read && (
          <div className="text-[13px] text-ink-900">
            <p>{read.gifts.length} payments in, {read.charges.length} charges{read.chargesCents ? ` (${currency} ${(read.chargesCents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })})` : ''}, {read.skipped.length} lines left out{read.periodEnd ? `, to ${shortDate(read.periodEnd)}` : ''}.</p>
            {read.skipped.length > 0 && (
              <ul className="mt-1 max-h-32 overflow-y-auto border border-feint p-2 text-graphite-600">
                {read.skipped.slice(0, 200).map((item) => <li key={item.row}>Row {item.row}: {item.reason}</li>)}
              </ul>
            )}
          </div>
        )}
        {problem && <p role="alert" className="text-[13px] text-ledger-red">{problem}</p>}
        <Problem error={post.error} />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cash count
// ---------------------------------------------------------------------------

function CountSheet({ typed, onChange }: { typed: Record<string, string>; onChange: (typed: Record<string, string>) => void }) {
  const { currency } = useChurchOrg();
  const { counts, problem } = readCounts(typed);
  return (
    <div>
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">Notes and coins counted</caption>
        <thead>
          <tr><th scope="col" className="text-left">Note or coin</th><th scope="col" className="text-left">How many</th><th scope="col" className="text-right">Comes to</th></tr>
        </thead>
        <tbody>
          {DENOMINATIONS.map(({ value, kind }) => (
            <tr key={value}>
              <th scope="row" className="py-1 pr-3 text-left font-normal">{currency} {value.toLocaleString('en-KE')} {kind}</th>
              <td className="py-1 pr-3">
                <input aria-label={`Number of ${currency} ${value} ${kind}s`} name={`count-${value}`} inputMode="numeric" className="h-9 w-24 border px-2"
                  value={typed[String(value)] || ''} onChange={(event) => onChange({ ...typed, [String(value)]: event.target.value })} />
              </td>
              <td className="py-1 text-right"><Amount cents={(counts[String(value)] || 0) * value * 100} currency={currency} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><th scope="row" colSpan={2} className="pt-2 text-left">Total counted</th><td className="pt-2 text-right"><Amount cents={countTotalCents(counts)} currency={currency} tone="ink" /></td></tr>
        </tfoot>
      </table>
      {problem && <p role="alert" className="mt-1 text-[13px] text-ledger-red">{problem}</p>}
    </div>
  );
}

export function StartCountDialog({ onClose, onDone }: { onClose: () => void; onDone: Done }) {
  const { today } = useChurchOrg();
  const funds = useFunds();
  const general = (funds.data?.funds || []).find((fund) => fund.code === 'GENERAL');
  const [form, setForm] = useState({ serviceDate: today, serviceName: 'Main service', fundId: '' });
  const [typed, setTyped] = useState<Record<string, string>>({});
  useEffect(() => { if (!form.fundId && general) setForm((current) => ({ ...current, fundId: general.id })); }, [general, form.fundId]);
  const post = useChurchPost<{ number: string; totalCents: number }>(onDone);
  const { counts, problem } = readCounts(typed);
  const total = countTotalCents(counts);
  return (
    <Dialog open onClose={onClose} title="Start a cash count" width="lg"
      note="The first counter saves the count. A second person confirms it from their own sign-in, and only then does the cash post."
      footer={<Footer onClose={onClose} busy={post.isPending} label={COPY.saveCount.en} form="count-form" disabled={!total || Boolean(problem)} />}>
      <form id="count-form" className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        post.mutate({
          path: '/api/collections', body: { ...form, counts, totalCents: total },
          message: (result) => `Cash count ${result.number} saved. It waits for a second person to count it.`,
        });
      }}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Service date"><input type="date" required value={form.serviceDate} onChange={(e) => setForm({ ...form, serviceDate: e.target.value })} name="serviceDate" /></Field>
          <Field label="Service"><input required maxLength={100} value={form.serviceName} onChange={(e) => setForm({ ...form, serviceName: e.target.value })} name="serviceName" /></Field>
          <FundPicker value={form.fundId} onChange={(id) => setForm({ ...form, fundId: id })} />
        </div>
        <CountSheet typed={typed} onChange={setTyped} />
        <Problem error={post.error} />
      </form>
    </Dialog>
  );
}

export function ConfirmCountDialog({ collection, onClose, onDone }: { collection: any; onClose: () => void; onDone: Done }) {
  const [typed, setTyped] = useState<Record<string, string>>({});
  const post = useChurchPost<{ number: string }>(onDone);
  const { counts, problem } = readCounts(typed);
  return (
    <Dialog open onClose={onClose} title={`Second count of ${collection.collection_number}`} width="lg"
      note={`${collection.service_name}, ${shortDate(collection.service_date)}. Count the cash again yourself; the first count is not shown. It posts only if both counts agree.`}
      footer={<Footer onClose={onClose} busy={post.isPending} label={COPY.confirmCount.en} form="confirm-count-form" disabled={!countTotalCents(counts) || Boolean(problem)} />}>
      <form id="confirm-count-form" className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        post.mutate({ path: `/api/collections/${collection.id}/confirm`, body: { counts }, message: (result) => `Cash count ${result.number} confirmed and posted to cash on hand (1040).` });
      }}>
        <CountSheet typed={typed} onChange={setTyped} />
        <Problem error={post.error} />
      </form>
    </Dialog>
  );
}

export function BankCountDialog({ collection, onClose, onDone }: { collection: any; onClose: () => void; onDone: Done }) {
  const { today, currency } = useChurchOrg();
  const accounts = useMoneyAccounts();
  const [form, setForm] = useState({ amount: (Number(collection.total_cents) / 100).toFixed(2), bankedOn: today, bankAccountId: '', bankReference: '' });
  useEffect(() => {
    if (!form.bankAccountId && accounts.banks[0]) setForm((current) => ({ ...current, bankAccountId: accounts.banks[0].id }));
  }, [accounts.banks, form.bankAccountId]);
  const post = useChurchPost<{ varianceCents: number }>(onDone);
  const cents = centsFromAmountText(form.amount);
  const variance = cents ? bankingVariance(Number(collection.total_cents), cents) : null;
  return (
    <Dialog open onClose={onClose} title={`Bank ${collection.collection_number}`}
      note={<>Counted: <Amount cents={Number(collection.total_cents)} currency={currency} />. Enter what the bank slip shows.</>}
      footer={<Footer onClose={onClose} busy={post.isPending} label={COPY.bank.en} form="bank-count-form" disabled={!cents || !form.bankAccountId} />}>
      <form id="bank-count-form" className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (!cents) return;
        post.mutate({
          path: `/api/collections/${collection.id}/bank`,
          body: { bankedCents: cents, bankedOn: form.bankedOn, bankAccountId: form.bankAccountId, bankReference: form.bankReference || null },
          message: (result) => `${collection.collection_number} banked. ${bankingVariance(Number(collection.total_cents), Number(collection.total_cents) + result.varianceCents).sentence}`,
        });
      }}>
        <Field label={`Amount banked (${currency})`}><input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} name="amount" /></Field>
        <Field label="Banked on"><input required type="date" value={form.bankedOn} onChange={(e) => setForm({ ...form, bankedOn: e.target.value })} name="bankedOn" /></Field>
        <Field label="Bank account">
          <select required value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })} name="bankAccountId">
            {accounts.banks.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
          </select>
        </Field>
        <Field label="Deposit slip reference" hint="Optional."><input maxLength={100} value={form.bankReference} onChange={(e) => setForm({ ...form, bankReference: e.target.value })} name="bankReference" /></Field>
        {variance && <p className={`text-[13px] ${variance.varianceCents ? 'text-ledger-red' : 'text-graphite-600'}`}>{variance.sentence}</p>}
        <Problem error={post.error} />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Funds and giving rules
// ---------------------------------------------------------------------------

export function FundDialog({ fund, onClose, onDone }: { fund?: any; onClose: () => void; onDone: Done }) {
  const accounts = useMoneyAccounts();
  const [form, setForm] = useState({
    code: fund?.code || '', name: fund?.name || '', restricted: Boolean(fund?.restricted), incomeAccountId: fund?.income_account_id || '',
    isActive: fund ? Boolean(fund.is_active) : true,
  });
  const post = useChurchPost(onDone);
  return (
    <Dialog open onClose={onClose} title={fund ? `The ${fund.name}` : 'Add a fund'}
      note="A restricted fund holds money given for one purpose; it is spent only on that purpose."
      footer={<Footer onClose={onClose} busy={post.isPending} label={COPY.saveFund.en} form="fund-form" />}>
      <form id="fund-form" className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        post.mutate(fund
          ? { path: `/api/funds/${fund.id}`, method: 'PATCH', body: { name: form.name, restricted: form.restricted, incomeAccountId: form.incomeAccountId, ...(fund.code === 'GENERAL' ? {} : { isActive: form.isActive }) }, message: `The ${form.name} saved.` }
          : { path: '/api/funds', keyed: false, body: { code: form.code, name: form.name, restricted: form.restricted, incomeAccountId: form.incomeAccountId }, message: `The ${form.name} added.` });
      }}>
        {!fund && <Field label="Code" hint="2 to 20 capital letters, digits or underscores, such as YOUTH."><input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} name="code" maxLength={20} /></Field>}
        <Field label="Name"><input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} name="name" /></Field>
        <Field label="Income account" hint="Where giving to this fund is credited.">
          <select required value={form.incomeAccountId} onChange={(e) => setForm({ ...form, incomeAccountId: e.target.value })} name="incomeAccountId">
            <option value="">Choose the income account</option>
            {accounts.income.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
          </select>
        </Field>
        <label className="flex items-start gap-2 text-[13.5px]">
          <input type="checkbox" className="mt-1" checked={form.restricted} onChange={(e) => setForm({ ...form, restricted: e.target.checked })} name="restricted" />
          <span>Restricted: given for one purpose only</span>
        </label>
        {fund && fund.code !== 'GENERAL' && (
          <label className="flex items-start gap-2 text-[13.5px]">
            <input type="checkbox" className="mt-1" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} name="isActive" />
            <span>Open to new giving</span>
          </label>
        )}
        <Problem error={post.error} />
      </form>
    </Dialog>
  );
}

export function GivingRuleDialog({ onClose, onDone }: { onClose: () => void; onDone: Done }) {
  const accounts = useMoneyAccounts();
  const [form, setForm] = useState({ priority: '50', matchType: 'PREFIX', pattern: '', fundId: '', incomeAccountId: '' });
  const post = useChurchPost(onDone);
  return (
    <Dialog open onClose={onClose} title="Add a giving rule" note="Rules are tried from the lowest priority number up; the first that fits a reference decides the fund."
      footer={<Footer onClose={onClose} busy={post.isPending} label={COPY.saveRule.en} form="rule-form" />}>
      <form id="rule-form" className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        post.mutate({
          path: '/api/giving-rules', keyed: false,
          body: { priority: Number(form.priority), matchType: form.matchType, pattern: form.matchType === 'MEMBER_NUMBER' ? null : form.pattern, fundId: form.fundId, incomeAccountId: form.incomeAccountId || null },
          message: 'Giving rule saved. It applies to receipts from now on.',
        });
      }}>
        <Field label="The reference">
          <select value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value })} name="matchType">
            <option value="PREFIX">Starts with (then an optional member number)</option>
            <option value="EXACT">Is exactly</option>
            <option value="MEMBER_NUMBER">Is a member number</option>
          </select>
        </Field>
        {form.matchType !== 'MEMBER_NUMBER' && <Field label="Text" hint="Letters, digits or hyphens, such as BLD or TITHE."><input required maxLength={20} value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value.toUpperCase() })} name="pattern" /></Field>}
        <FundPicker value={form.fundId} onChange={(id) => setForm({ ...form, fundId: id })} />
        <Field label="Income account" hint="Optional: credit this account instead of the fund's own.">
          <select value={form.incomeAccountId} onChange={(e) => setForm({ ...form, incomeAccountId: e.target.value })} name="incomeAccountId">
            <option value="">The fund's own income account</option>
            {accounts.income.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
          </select>
        </Field>
        <Field label="Priority" hint="0 to 10000; lower is tried first."><input required inputMode="numeric" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} name="priority" /></Field>
        <Problem error={post.error} />
      </form>
    </Dialog>
  );
}
