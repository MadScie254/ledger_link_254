import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { centsFromAmountText } from '../../utils/salesOrders';
import { todayIn } from '../../utils/dates';
import { useCreateIntent } from '../../hooks/useCreateIntent';
import { Amount, figureText } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { Mark } from '../ledger/Mark';
import { EmptyNote, LoadProblem, PageHeading, SkeletonRows, buttonClass } from '../ledger/Page';
import {
  BILLING_METHODS, MATTER_STATUS, MATTER_TYPES, clientName, refreshLaw, say, shortDate,
  useCustomers, useLawOrg, useMatterFocus, useMatters, useTeamMembers, type Matter,
} from './lawData';
import { MatterRecord } from './MatterRecord';

const COPY = {
  title: say('Matters'),
  note: say('Every brief the firm holds: who it is for, where it is in court, and what is owed on it.'),
  empty: say('No matters yet. Open the first one: name the client and the matter, check for conflicts, and set how it is billed.'),
  noMatch: say('No matter matches. Clear the search or the filter.'),
  conflictNote: say('Names already in the books, as clients or as parties to a matter. Check each before taking the brief.'),
};

export function MattersView() {
  const { canPost } = useLawOrg();
  const matters = useMatters();
  const focused = useMatterFocus((state) => state.matterId);
  const focus = useMatterFocus((state) => state.focus);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'OPEN' | 'ON_HOLD' | 'CLOSED' | 'ALL'>('OPEN');
  const [stage, setStage] = useState('');
  const [opening, setOpening] = useState(false);
  useCreateIntent({ matter: () => setOpening(true) }, canPost);
  const [selected, setSelected] = useState<string | null>(focused);
  const [notice, setNotice] = useState('');

  // Another screen (the client account, the diary) asked for this matter.
  useEffect(() => {
    if (!focused) return;
    setSelected(focused);
    focus(null);
  }, [focused, focus]);

  const all = matters.data?.matters || [];
  const stages = useMemo(() => [...new Set(all.map((matter) => matter.stage).filter((value): value is string => Boolean(value)))].sort(), [all]);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((matter) => (status === 'ALL' || matter.status === status)
      && (!stage || matter.stage === stage)
      && (!needle || [matter.matter_number, matter.title, clientName(matter), matter.case_number || ''].some((text) => text.toLowerCase().includes(needle))));
  }, [all, search, status, stage]);

  const current = all.find((matter) => matter.id === selected);
  if (selected && current) {
    return <MatterRecord matter={current} initialNotice={notice} onBack={() => { setSelected(null); setNotice(''); }} />;
  }

  return (
    <div className="space-y-4">
      <PageHeading
        title={COPY.title.en}
        note={COPY.note.en}
        actions={canPost && <button type="button" className={buttonClass.primary} onClick={() => setOpening(true)}>Open a matter</button>}
      />
      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}
      <div className="flex flex-wrap items-center gap-3 border-b border-feint pb-3 text-[13px] text-graphite-600">
        <label className="flex items-center gap-2">
          <span>Search</span>
          <input type="search" aria-label="Search matters" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-56 border px-2 text-[13px] text-ink-900" placeholder="Number, title, client or case" />
        </label>
        <label className="flex items-center gap-2">
          <span>Show</span>
          <select aria-label="Matter status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-8 border px-2 text-[13px] text-ink-900">
            <option value="OPEN">Open</option>
            <option value="ON_HOLD">On hold</option>
            <option value="CLOSED">Closed</option>
            <option value="ALL">All matters</option>
          </select>
        </label>
        {stages.length > 0 && (
          <label className="flex items-center gap-2">
            <span>Stage</span>
            <select aria-label="Matter stage" value={stage} onChange={(e) => setStage(e.target.value)} className="h-8 border px-2 text-[13px] text-ink-900">
              <option value="">Any stage</option>
              {stages.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        )}
        <span>{all.filter((matter) => matter.status === 'OPEN').length} open</span>
      </div>

      {matters.isLoading ? <SkeletonRows label="Loading matters" />
        : matters.isError ? <LoadProblem what="the matters" path="/api/matters" onRetry={() => matters.refetch()} />
          : all.length === 0 ? <EmptyNote action={canPost && <button type="button" className={buttonClass.quiet} onClick={() => setOpening(true)}>Open the first matter</button>}>{COPY.empty.en}</EmptyNote>
            : shown.length === 0 ? <EmptyNote>{COPY.noMatch.en}</EmptyNote>
              : (
                <div className="relative overflow-x-auto">
                  <table className="w-full text-[13.5px]">
                    <caption className="sr-only">Matters</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="pr-4 text-left">Matter</th>
                        <th scope="col" className="pr-4 text-left">Client</th>
                        <th scope="col" className="hidden pr-4 text-left sm:table-cell">Type</th>
                        <th scope="col" className="hidden pr-4 text-left md:table-cell">Court and case</th>
                        <th scope="col" className="pr-4 text-left">Standing</th>
                        <th scope="col" className="hidden text-left sm:table-cell">Opened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((matter) => (
                        <tr key={matter.id}>
                          <td className="pr-4">
                            <button type="button" onClick={() => setSelected(matter.id)} className="text-left text-ink-900 hover:underline underline-offset-[3px]">
                              <span className="ll-figure mr-2 text-graphite-600">{matter.matter_number}</span>{matter.title}
                            </button>
                          </td>
                          <td className="pr-4">{clientName(matter)}</td>
                          <td className="hidden pr-4 text-graphite-600 sm:table-cell">{MATTER_TYPES[matter.matter_type]?.en || matter.matter_type}</td>
                          <td className="hidden pr-4 text-graphite-600 md:table-cell">{[matter.court, matter.case_number].filter(Boolean).join(', ') || '–'}</td>
                          <td className="pr-4"><MatterStanding matter={matter} /></td>
                          <td className="hidden whitespace-nowrap text-graphite-600 sm:table-cell">{shortDate(matter.opened_on)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

      {opening && (
        <OpenMatterDialog
          onClose={() => setOpening(false)}
          onOpened={(id, number) => { setOpening(false); setNotice(`Matter ${number} opened.`); setSelected(id); }}
        />
      )}
    </div>
  );
}

export function MatterStanding({ matter }: { matter: Pick<Matter, 'status' | 'stage'> }) {
  if (matter.status === 'CLOSED') return <span className="text-[12.5px] text-graphite-600">Closed</span>;
  if (matter.status === 'ON_HOLD') return <Mark kind="query" label={matter.stage ? `On hold, ${matter.stage}` : 'On hold'} />;
  return <span className="text-[13px] text-ink-900">{matter.stage || MATTER_STATUS.OPEN.en}</span>;
}

type ConflictHit = { source: string; name: string; matter_id: string | null; matter_number: string | null; score: number };

/** What the conflict search found for each name, shown before a matter is opened. */
function ConflictResults({ results }: { results: Array<{ name: string; matches: ConflictHit[] }> }) {
  return (
    <div className="space-y-2 border-l-2 border-feint-strong pl-3 text-[13px]" aria-live="polite">
      <p className="font-semibold text-ink-900">Conflict check</p>
      {results.map(({ name, matches }) => (
        <div key={name}>
          {matches.length === 0
            ? <Mark kind="tick" label={`No client or party named like “${name}” in the books.`} />
            : (
              <>
                <Mark kind="query" label={`“${name}” is already in the books:`} />
                <ul className="mt-0.5 pl-6 text-graphite-600">
                  {matches.map((hit, index) => (
                    <li key={`${hit.source}-${hit.matter_id}-${index}`}>{hit.name}, {hit.source === 'PARTY' ? 'a party' : 'a client'}{hit.matter_number ? ` on ${hit.matter_number}` : ', no matter yet'}</li>
                  ))}
                </ul>
              </>
            )}
        </div>
      ))}
      <p className="text-graphite-600">{COPY.conflictNote.en}</p>
    </div>
  );
}

function OpenMatterDialog({ onClose, onOpened }: { onClose: () => void; onOpened: (id: string, number: string) => void }) {
  const { orgId, currency, timeZone } = useLawOrg();
  const queryClient = useQueryClient();
  const customers = useCustomers();
  const team = useTeamMembers();
  const [clientId, setClientId] = useState('');
  const [newClient, setNewClient] = useState('');
  const [title, setTitle] = useState('');
  const [matterType, setMatterType] = useState('LITIGATION');
  const [billingMethod, setBillingMethod] = useState('HOURLY');
  const [rate, setRate] = useState('');
  const [fixedFee, setFixedFee] = useState('');
  const [responsible, setResponsible] = useState('');
  const [court, setCourt] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [openedOn, setOpenedOn] = useState(todayIn(timeZone));
  const [opposing, setOpposing] = useState('');
  const [problem, setProblem] = useState('');
  const [conflicts, setConflicts] = useState<{ key: string; results: Array<{ name: string; matches: ConflictHit[] }> } | null>(null);
  const clients = customers.data?.customers || [];
  const chosenClient = clients.find((client) => client.id === clientId);
  const namesToCheck = [clientId === 'NEW' ? newClient : chosenClient?.displayName || chosenClient?.display_name || '', opposing]
    .map((name) => name.trim()).filter((name) => name.length >= 3);
  const checkKey = namesToCheck.join('|');
  const checked = conflicts?.key === checkKey;

  // The conflict search runs before the matter can be opened, on every name given.
  const check = useMutation({
    mutationFn: async () => Promise.all(namesToCheck.map(async (name) => ({
      name,
      matches: (await apiRequest<{ matches: ConflictHit[] }>(`/api/matters/conflict-check?q=${encodeURIComponent(name)}`, { fallback: 'The conflict search did not complete.' })).matches,
    }))),
    onSuccess: (results) => setConflicts({ key: checkKey, results }),
    onError: (err: Error) => setProblem(err.message),
  });

  const open = useMutation({
    mutationFn: async () => {
      const rateCents = rate.trim() ? centsFromAmountText(rate) : undefined;
      const feeCents = fixedFee.trim() ? centsFromAmountText(fixedFee) : undefined;
      if (rateCents === null || feeCents === null) throw new Error('Enter rates and fees in shillings.');
      if (billingMethod === 'HOURLY' && rateCents == null) throw new Error('Enter the hourly rate for an hourly matter.');
      let client = clientId;
      if (client === 'NEW') {
        if (!newClient.trim()) throw new Error('Name the new client.');
        const created = await apiRequest<{ id: string }>('/api/customers', { body: { displayName: newClient.trim() }, fallback: 'The client could not be added.' });
        client = created.id;
      }
      if (!client) throw new Error('Choose the client.');
      const { id } = await apiRequest<{ id: string }>('/api/matters', {
        body: {
          title: title.trim(), clientId: client, matterType, billingMethod, openedOn,
          ...(rateCents != null ? { defaultRateCents: rateCents } : {}),
          ...(feeCents != null ? { fixedFeeCents: feeCents } : {}),
          ...(responsible ? { responsibleUserId: responsible } : {}),
          ...(court.trim() ? { court: court.trim() } : {}),
          ...(caseNumber.trim() ? { caseNumber: caseNumber.trim() } : {}),
        },
        fallback: 'The matter could not be opened.',
      });
      if (opposing.trim()) {
        await apiRequest(`/api/matters/${id}/parties`, { body: { name: opposing.trim(), role: 'OPPOSING_PARTY' } });
      }
      const { matter } = await apiRequest<{ matter: Matter }>(`/api/matters/${id}`);
      return { id, number: matter.matter_number };
    },
    onSuccess: ({ id, number }) => {
      refreshLaw(queryClient, orgId);
      queryClient.invalidateQueries({ queryKey: ['customers', orgId] });
      onOpened(id, number);
    },
    onError: (err: Error) => setProblem(err.message),
  });

  return (
    <Dialog open onClose={onClose} width="lg" title="Open a matter" note="The matter number is given when it is opened. Check the conflict search before taking the brief."
      footer={<><button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
        <button type="submit" form="open-matter" className={buttonClass.primary} disabled={open.isPending || check.isPending}>
          {open.isPending ? 'Opening' : check.isPending ? 'Checking' : checked || namesToCheck.length === 0 ? 'Open matter' : 'Check for conflicts'}
        </button></>}>
      <form id="open-matter" onSubmit={(e) => {
        e.preventDefault();
        setProblem('');
        if (namesToCheck.length > 0 && !checked) check.mutate();
        else open.mutate();
      }} className="grid gap-4 sm:grid-cols-2">
        <Field label="Client">
          <select required name="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Choose the client</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.displayName || client.display_name}</option>)}
            <option value="NEW">A new client</option>
          </select>
        </Field>
        {clientId === 'NEW'
          ? <Field label="New client's name"><input name="newClient" required value={newClient} onChange={(e) => setNewClient(e.target.value)} /></Field>
          : <Field label="Opposing party" hint="Optional; searched for conflicts."><input name="opposingParty" value={opposing} onChange={(e) => setOpposing(e.target.value)} /></Field>}
        <div className="sm:col-span-2"><Field label="Matter title" hint="For example: Otieno v Kamau, land dispute."><input name="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field></div>
        <Field label="Type">
          <select name="matterType" value={matterType} onChange={(e) => setMatterType(e.target.value)}>
            {Object.entries(MATTER_TYPES).map(([id, name]) => <option key={id} value={id}>{name.en}</option>)}
          </select>
        </Field>
        <Field label="Opened on"><input type="date" name="openedOn" required value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} /></Field>
        <Field label="Billed by">
          <select name="billingMethod" value={billingMethod} onChange={(e) => setBillingMethod(e.target.value)}>
            {Object.entries(BILLING_METHODS).map(([id, name]) => <option key={id} value={id}>{name.en}</option>)}
          </select>
        </Field>
        {billingMethod === 'FIXED'
          ? <Field label={`Fixed fee, ${currency}`}><input name="fixedFeeCents" inputMode="decimal" value={fixedFee} onChange={(e) => setFixedFee(e.target.value)} /></Field>
          : <Field label={`Hourly rate, ${currency}`} hint={billingMethod === 'HOURLY' ? undefined : 'Optional; used for any time recorded.'}><input name="defaultRateCents" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>}
        <Field label="Responsible advocate" hint="Their court dates feed their calendar.">
          <select name="responsibleUserId" value={responsible} onChange={(e) => setResponsible(e.target.value)}>
            <option value="">Not yet assigned</option>
            {(team.data?.members || []).map((member) => <option key={member.userId} value={member.userId}>{member.email}</option>)}
          </select>
        </Field>
        <Field label="Court" hint="Optional"><input name="court" value={court} onChange={(e) => setCourt(e.target.value)} /></Field>
        <Field label="Case number" hint="Optional"><input name="caseNumber" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} /></Field>
        {checked && conflicts && conflicts.results.length > 0 && <div className="sm:col-span-2"><ConflictResults results={conflicts.results} /></div>}
        {billingMethod === 'HOURLY' && rate && centsFromAmountText(rate) != null && (
          <p className="sm:col-span-2 text-[12.5px] text-graphite-600">An hour is billed at {currency} {figureText(centsFromAmountText(rate)!)}; <Amount cents={Math.round(centsFromAmountText(rate)! / 2)} currency={currency} size="xs" tone="ink" /> for half an hour.</p>
        )}
        {problem && <p role="alert" className="sm:col-span-2 text-[13px] text-ledger-red">{problem}</p>}
      </form>
    </Dialog>
  );
}
