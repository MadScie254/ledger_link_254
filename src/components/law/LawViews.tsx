import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { useCreateIntent } from '../../hooks/useCreateIntent';
import { apiRequest } from '../../utils/apiRequest';
import { addDaysIso, todayIn } from '../../utils/dates';
import { printedDateTime, zonedLocalToIso, zonedParts } from '../../utils/lawDates';
import { Amount, figureText } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { EmptyNote, LedgerRow, LoadProblem, PageHeading, SkeletonRows, buttonClass } from '../ledger/Page';
import {
  EVENT_STATUS, EVENT_TYPES, clientName, matterLabel, say, shortDate, useLawOrg, useMatterFocus, useMatters, useTeamMembers, type Matter,
} from './lawData';
import {
  ClientReceiptDialog, CourtEventDialog, CourtOutcomeDialog, EtimsNumberDialog, FeeNoteBuilderDialog,
  FeeNotePaymentDialog, LogTimeDialog, OfficeDisbursementDialog,
} from './LawDialogs';
import { FeeNoteList } from './MatterRecord';
import { MattersView } from './MattersView';

const COPY = {
  diary: say('Court diary'),
  diaryNote: say('Every hearing, mention and deadline across the firm, on the firm\'s clock.'),
  diaryEmpty: say('Nothing in the diary for these weeks. Court dates are added on a matter, or here.'),
  feedNote: say('Subscribe in Google, Outlook or Apple Calendar to see the court dates of matters you are responsible for. Anyone with the link can read those dates; making a new link stops the old one.'),
  account: say('Client account'),
  accountNote: say('Money held for clients, matter by matter. It is never the firm\'s income until a fee note is settled from it.'),
  accountEmpty: say('No client money is held. Receipts into the client account appear here by matter.'),
  feeNotes: say('Fee notes'),
  feeNotesNote: say('Professional fees and disbursements billed to clients, with what is still owing.'),
  feeNotesEmpty: say('No fee notes yet. Open a matter, record its time and disbursements, then raise a fee note from them.'),
  time: say('Time'),
  timeNote: say('Hours worked on each matter, billable at the matter\'s rate until a fee note takes them.'),
  timeChoose: say('Choose a matter to see its time.'),
  disbursements: say('Disbursements'),
  disbursementsNote: say('Costs paid for clients: from the office, recoverable until billed, or from client money.'),
  disbursementsEmpty: say('No disbursements recorded.'),
  home: say('Practice'),
  noMatters: say('No matters open yet. Open the first matter to start the court diary, time and client account.'),
};

function useMatterIndex() {
  const matters = useMatters();
  const byId = useMemo(() => new Map((matters.data?.matters || []).map((matter) => [matter.id, matter])), [matters.data]);
  return { matters, byId, list: matters.data?.matters || [] };
}

function Notice({ message }: { message: string }) {
  return message ? <p role="status" className="text-[13.5px] text-ink-900">{message}</p> : null;
}

// ---------------------------------------------------------------------------

export function CourtDiaryView() {
  const { orgId, timeZone, canPost } = useLawOrg();
  const today = todayIn(timeZone);
  const team = useTeamMembers();
  const [mode, setMode] = useState<'day' | 'week'>('week');
  const [anchor, setAnchor] = useState(today);
  const [advocate, setAdvocate] = useState('');
  const [court, setCourt] = useState('');
  // A week runs Monday to Sunday.
  const weekday = (new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7;
  const from = mode === 'day' ? anchor : addDaysIso(anchor, -weekday);
  const to = mode === 'day' ? anchor : addDaysIso(from, 6);
  const events = useQuery({
    queryKey: ['court-events', orgId, 'diary', from, to],
    queryFn: () => apiRequest<{ events: any[] }>(`/api/court-events?from=${encodeURIComponent(zonedLocalToIso(`${from}T00:00`, timeZone))}&to=${encodeURIComponent(zonedLocalToIso(`${to}T23:59`, timeZone))}`),
  });
  const [adding, setAdding] = useState(false);
  useCreateIntent({ courtDate: () => setAdding(true) }, canPost);
  const [outcome, setOutcome] = useState<any | null>(null);
  const [notice, setNotice] = useState('');
  const [feed, setFeed] = useState('');
  const subscribe = useMutation({
    mutationFn: () => apiRequest<{ path: string }>('/api/court-events/calendar-token', { method: 'POST', fallback: 'The calendar link could not be made.' }),
    onSuccess: (result) => setFeed(`${window.location.origin}${result.path}`),
  });
  const all = events.data?.events || [];
  const courts = useMemo(() => [...new Set(all.map((event) => event.court).filter((value): value is string => Boolean(value)))].sort(), [all]);
  const shown = all.filter((event) => (!advocate || event.matters?.responsible_user_id === advocate) && (!court || event.court === court));
  const byDay = useMemo(() => {
    const days = new Map<string, any[]>();
    for (const event of shown) {
      const day = zonedParts(event.starts_at, timeZone).date;
      days.set(day, [...(days.get(day) || []), event]);
    }
    return [...days.entries()];
  }, [shown, timeZone]);
  const longDate = (day: string) => new Intl.DateTimeFormat('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const step = mode === 'day' ? 1 : 7;

  return (
    <div className="space-y-4">
      <PageHeading title={COPY.diary.en} note={COPY.diaryNote.en}
        actions={canPost && <button type="button" className={buttonClass.primary} onClick={() => setAdding(true)}>Add a court date</button>} />
      <Notice message={notice} />
      <div className="flex flex-wrap items-center gap-3 border-b border-feint pb-3 text-[13px] text-graphite-600">
        <span role="group" aria-label="Diary view" className="flex items-center gap-3">
          {(['day', 'week'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
              className={mode === value ? 'font-semibold text-ink-900 underline underline-offset-[3px]' : buttonClass.quiet}>{value === 'day' ? 'Day' : 'Week'}</button>
          ))}
        </span>
        <span className="flex items-center gap-2">
          <button type="button" className={buttonClass.quiet} onClick={() => setAnchor(addDaysIso(anchor, -step))}>Earlier</button>
          <input type="date" aria-label="Diary date" value={anchor} onChange={(e) => setAnchor(e.target.value || today)} className="h-8 border px-2 text-[13px] text-ink-900" />
          <button type="button" className={buttonClass.quiet} onClick={() => setAnchor(addDaysIso(anchor, step))}>Later</button>
          <button type="button" className={buttonClass.quiet} onClick={() => setAnchor(today)}>Today</button>
        </span>
        <label className="flex items-center gap-2"><span>Advocate</span>
          <select aria-label="Advocate" value={advocate} onChange={(e) => setAdvocate(e.target.value)} className="h-8 border px-2 text-[13px] text-ink-900">
            <option value="">Everyone</option>
            {(team.data?.members || []).map((member) => <option key={member.userId} value={member.userId}>{member.email}</option>)}
          </select></label>
        <label className="flex items-center gap-2"><span>Court</span>
          <select aria-label="Court" value={court} onChange={(e) => setCourt(e.target.value)} className="h-8 border px-2 text-[13px] text-ink-900">
            <option value="">Every court</option>
            {courts.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
      </div>
      <p className="text-[13px] text-graphite-600">{mode === 'day' ? longDate(from) : `${shortDate(from)} to ${shortDate(to)}`}{advocate || court ? ` · ${shown.length} of ${all.length} shown` : ''}</p>

      {events.isLoading ? <SkeletonRows label="Loading the diary" />
        : events.isError ? <LoadProblem what="the diary" path="/api/court-events" onRetry={() => events.refetch()} />
          : byDay.length === 0 ? <EmptyNote>{all.length ? 'Nothing in the diary for this advocate or court on these days.' : COPY.diaryEmpty.en}</EmptyNote>
            : (
              <div className="space-y-4">
                {byDay.map(([day, list]) => (
                  <section key={day} aria-label={longDate(day)}>
                    <h2 className={`ll-printed border-b border-ink-900 pb-1 text-[11px] ${day === today ? 'text-oxblood' : 'text-graphite-600'}`}>
                      {longDate(day)}{day === today ? ' · today' : ''}
                    </h2>
                    <DiaryList events={list} canPost={canPost} onOutcome={setOutcome} />
                  </section>
                ))}
              </div>
            )}

      <section className="border-t border-feint-strong pt-4 text-[13.5px]" aria-labelledby="calendar-feed">
        <h2 id="calendar-feed" className="ll-heading text-[17px] text-ink-900">Your court dates in your calendar</h2>
        <p className="mt-1 max-w-2xl text-graphite-600">{COPY.feedNote.en}</p>
        {feed ? (
          <p className="mt-2 flex flex-wrap items-center gap-3">
            <input readOnly aria-label="Calendar link" value={feed} className="h-9 w-full max-w-xl border px-2 text-[13px]" onFocus={(e) => e.target.select()} />
            <button type="button" className={buttonClass.quiet} onClick={() => navigator.clipboard?.writeText(feed)}>Copy link</button>
          </p>
        ) : (
          <button type="button" className={`${buttonClass.secondary} mt-2`} disabled={subscribe.isPending} onClick={() => subscribe.mutate()}>
            {subscribe.isPending ? 'Making the link' : 'Make my calendar link'}
          </button>
        )}
        {subscribe.isError && <p role="alert" className="mt-1 text-[13px] text-ledger-red">{subscribe.error.message}</p>}
      </section>

      {adding && <CourtEventDialog onClose={() => setAdding(false)} onDone={(message) => { setAdding(false); setNotice(message); }} />}
      {outcome && <CourtOutcomeDialog event={outcome} onClose={() => setOutcome(null)} onDone={(message) => { setOutcome(null); setNotice(message); }} />}
    </div>
  );
}

/** Court dates in time order, each with its matter, court and standing. */
function DiaryList({ events, canPost, onOutcome }: { events: any[]; canPost: boolean; onOutcome: (event: any) => void }) {
  const { timeZone } = useLawOrg();
  const now = new Date().toISOString();
  return (
    <ul>
      {events.map((event) => (
        <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-feint py-2 text-[13.5px]">
          <span className="min-w-0">
            <span className="ll-figure mr-2 text-ink-900">{zonedParts(event.starts_at, timeZone).time}</span>
            <span className="font-semibold text-ink-900">{EVENT_TYPES[event.event_type]?.en || event.event_type}</span>
            {' · '}{event.matters?.matter_number} {event.matters?.title}
            <span className="block text-[12.5px] text-graphite-600">{[event.court, event.courtroom, event.judicial_officer].filter(Boolean).join(', ') || 'Court not recorded'}{event.outcome ? ` · ${event.outcome}` : ''}</span>
          </span>
          <span className="flex items-center gap-3">
            {event.status === 'SCHEDULED' && event.starts_at < now
              ? <Mark kind="query" label="Outcome not recorded" />
              : <span className="text-[12.5px] text-graphite-600">{EVENT_STATUS[event.status]?.en}</span>}
            {canPost && event.status === 'SCHEDULED' && <button type="button" className={buttonClass.quiet} onClick={() => onOutcome(event)}>Record outcome</button>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

export function ClientAccountView() {
  const { orgId, currency, timeZone, canPost } = useLawOrg();
  const today = todayIn(timeZone);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const focus = useMatterFocus((state) => state.focus);
  const [asOf, setAsOf] = useState(today);
  const [receiving, setReceiving] = useState(false);
  useCreateIntent({ clientReceipt: () => setReceiving(true) }, canPost);
  const [notice, setNotice] = useState('');
  const { byId } = useMatterIndex();
  const balances = useQuery({
    queryKey: ['client-balances', orgId, asOf],
    queryFn: () => apiRequest<{ balances: Array<{ matter_id: string; client_id: string; balance_cents: number }> }>(`/api/client-account/balances?asOf=${asOf}`),
  });
  const position = useQuery({
    queryKey: ['client-balances', orgId, 'position', asOf],
    queryFn: () => apiRequest<{ clientBankCents: number; clientHeldCents: number; matterLedgersCents: number; untaggedHeldCents: number }>(`/api/client-account/position?asOf=${asOf}`),
  });
  const held = (balances.data?.balances || []).filter((row) => Number(row.balance_cents) !== 0);
  const total = held.reduce((sum, row) => sum + Number(row.balance_cents), 0);
  // Grouped by client: a client may have several matters.
  const byClient = useMemo(() => {
    const groups = new Map<string, { name: string; rows: typeof held; cents: number }>();
    for (const row of held) {
      const matter = byId.get(row.matter_id);
      const name = matter ? clientName(matter) : 'Client';
      const group = groups.get(row.client_id) || { name, rows: [], cents: 0 };
      group.rows.push(row);
      group.cents += Number(row.balance_cents);
      groups.set(row.client_id, group);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [held, byId]);
  const p = position.data;
  const bankDifference = p ? p.clientBankCents - total : 0;
  const openMatter = (matterId: string) => { focus(matterId); setActiveView('Law / Matters'); };

  return (
    <div className="space-y-4">
      <PageHeading title={COPY.account.en} note={COPY.accountNote.en}
        actions={canPost && <button type="button" className={buttonClass.primary} onClick={() => setReceiving(true)}>Receive client money</button>} />
      <Notice message={notice} />
      <div className="flex flex-wrap items-center gap-3 border-b border-feint pb-3 text-[13px] text-graphite-600">
        <label className="flex items-center gap-2"><span>As at</span>
          <input type="date" aria-label="As at" value={asOf} onChange={(e) => setAsOf(e.target.value || today)} className="h-8 border px-2 text-[13px] text-ink-900" /></label>
      </div>

      {p && (
        <section aria-label="Client account against the client bank account" className="max-w-xl">
          <LedgerRow label="Client bank account (1060)"><Amount cents={p.clientBankCents} currency={currency} tone="ink" /></LedgerRow>
          <LedgerRow label="Held for clients, by matter"><Amount cents={total} currency={currency} tone="ink" /></LedgerRow>
          <LedgerRow label="Difference" strong><Amount cents={bankDifference} currency={currency} tone="result" /></LedgerRow>
          <div className="py-2 text-[13px]">
            {bankDifference === 0 && p.untaggedHeldCents === 0
              ? <Mark kind="tick" label={`On ${shortDate(asOf)} the client bank account holds exactly what the matter ledgers say is owed to clients.`} />
              : (
                <div className="space-y-1">
                  <Mark kind="circled" label="The client bank account and the matter ledgers differ." />
                  {p.untaggedHeldCents !== 0 && <p className="text-graphite-600">{currency} {figureText(p.untaggedHeldCents)} of client money held (2200) is not on any matter's ledger. Find the entry in Full books and reverse it; client money is posted only through receipts, payments and transfers.</p>}
                  {p.clientBankCents !== p.clientHeldCents && <p className="text-graphite-600">The client bank account (1060) and client money held (2200) differ by {currency} {figureText(p.clientBankCents - p.clientHeldCents)}. Every client posting moves both by the same amount, so an entry outside the client-money functions has touched one of them.</p>}
                </div>
              )}
          </div>
        </section>
      )}

      {balances.isLoading ? <SkeletonRows label="Loading client balances" />
        : balances.isError ? <LoadProblem what="client balances" path="/api/client-account/balances" onRetry={() => balances.refetch()} />
          : held.length === 0 ? <EmptyNote>{COPY.accountEmpty.en}</EmptyNote>
            : (
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">Client money held by client and matter as at {shortDate(asOf)}</caption>
                <thead><tr><th scope="col" className="pr-4 text-left">Client and matter</th><th scope="col" className="text-right">Held, {currency}</th></tr></thead>
                <tbody>
                  {byClient.map((group) => (
                    <Fragment key={group.name + group.rows[0].client_id}>
                      <tr><td className="pr-4 pt-3 font-semibold text-ink-900">{group.name}</td><td className="pt-3 text-right"><Amount cents={group.cents} currency={currency} tone="ink" /></td></tr>
                      {group.rows.map((row) => {
                        const matter = byId.get(row.matter_id);
                        return (
                          <tr key={row.matter_id}>
                            <td className="pl-4 pr-4">
                              {matter ? <button type="button" className="text-left text-ink-900 hover:underline underline-offset-[3px]" onClick={() => openMatter(row.matter_id)}>{matterLabel(matter)}</button> : 'Matter'}
                            </td>
                            <td className={`text-right ${Number(row.balance_cents) < 0 ? 'text-ledger-red' : ''}`}><Amount cents={Number(row.balance_cents)} currency={currency} /></td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                  <tr className="ll-total">
                    <td className="pr-4 font-semibold">Held for {held.length} {held.length === 1 ? 'matter' : 'matters'}</td>
                    <td className="text-right font-semibold"><Amount cents={total} currency={currency} tone="ink" /></td>
                  </tr>
                </tbody>
              </table>
            )}
      {receiving && <ClientReceiptDialog onClose={() => setReceiving(false)} onDone={(message) => { setReceiving(false); setNotice(message); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FeeNotesView() {
  const { orgId, currency, canPost } = useLawOrg();
  const { byId, list } = useMatterIndex();
  const notes = useQuery({ queryKey: ['fee-notes', orgId], queryFn: () => apiRequest<{ feeNotes: any[] }>('/api/fee-notes') });
  const [filter, setFilter] = useState<'OWING' | 'ALL'>('OWING');
  const [builderFor, setBuilderFor] = useState<Matter | null>(null);
  const [choose, setChoose] = useState('');
  const [paying, setPaying] = useState<any | null>(null);
  const [etims, setEtims] = useState<any | null>(null);
  const [notice, setNotice] = useState('');
  const all = notes.data?.feeNotes || [];
  const shown = filter === 'ALL' ? all : all.filter((note) => note.status !== 'VOID' && Number(note.amount_due_cents) > 0);
  const owing = all.filter((note) => note.status !== 'VOID').reduce((sum, note) => sum + Number(note.amount_due_cents || 0), 0);
  const done = (message: string) => { setBuilderFor(null); setPaying(null); setEtims(null); setNotice(message); };

  return (
    <div className="space-y-4">
      <PageHeading title={COPY.feeNotes.en} note={COPY.feeNotesNote.en}
        actions={canPost && (
          <span className="flex flex-wrap items-center gap-2">
            <select aria-label="Matter to bill" value={choose} onChange={(e) => setChoose(e.target.value)} className="h-9 border px-2 text-[13.5px]">
              <option value="">Choose a matter to bill</option>
              {list.filter((matter) => matter.status !== 'CLOSED').map((matter) => <option key={matter.id} value={matter.id}>{matterLabel(matter)}</option>)}
            </select>
            <button type="button" className={buttonClass.primary} disabled={!choose} onClick={() => setBuilderFor(byId.get(choose) || null)}>Raise a fee note</button>
          </span>
        )} />
      <Notice message={notice} />
      <div className="flex flex-wrap items-center gap-3 border-b border-feint pb-3 text-[13px] text-graphite-600">
        <label className="flex items-center gap-2"><span>Show</span>
          <select aria-label="Fee notes shown" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="h-8 border px-2 text-[13px] text-ink-900">
            <option value="OWING">With something owing</option><option value="ALL">All fee notes</option>
          </select></label>
        <span>Owing in all: <Amount cents={owing} currency={currency} size="sm" tone="ink" /></span>
      </div>
      {notes.isLoading ? <SkeletonRows label="Loading fee notes" />
        : notes.isError ? <LoadProblem what="fee notes" path="/api/fee-notes" onRetry={() => notes.refetch()} />
          : shown.length === 0 ? <EmptyNote>{all.length ? 'Nothing is owing on any fee note.' : COPY.feeNotesEmpty.en}</EmptyNote>
            : <FeeNoteList notes={shown} canPost={canPost} onPay={setPaying} onEtims={setEtims}
                matterOf={(note) => { const matter = byId.get(note.matter_id); return matter ? `${matter.matter_number} · ${clientName(matter)}` : ''; }} />}
      {builderFor && <FeeNoteBuilderDialog matter={builderFor} onClose={() => setBuilderFor(null)} onDone={done} />}
      {paying && <FeeNotePaymentDialog feeNote={paying} onClose={() => setPaying(null)} onDone={done} />}
      {etims && <EtimsNumberDialog feeNote={etims} onClose={() => setEtims(null)} onDone={done} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function TimeView() {
  const { orgId, currency, canPost } = useLawOrg();
  const { list, byId } = useMatterIndex();
  const [matterId, setMatterId] = useState('');
  const [logging, setLogging] = useState(false);
  useCreateIntent({ lawTime: () => setLogging(true) }, canPost);
  const [notice, setNotice] = useState('');
  const time = useQuery({
    queryKey: ['matter-time', orgId, matterId],
    enabled: Boolean(matterId),
    queryFn: () => apiRequest<{ entries: any[] }>(`/api/matters/${matterId}/time`),
  });
  const entries = time.data?.entries || [];
  const hours = entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  const unbilled = entries.filter((entry) => entry.billable && !entry.invoice_id).reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
  return (
    <div className="space-y-4">
      <PageHeading title={COPY.time.en} note={COPY.timeNote.en}
        actions={canPost && <button type="button" className={buttonClass.primary} onClick={() => setLogging(true)}>Record time</button>} />
      <Notice message={notice} />
      <div className="flex flex-wrap items-center gap-3 border-b border-feint pb-3 text-[13px] text-graphite-600">
        <label className="flex items-center gap-2"><span>Matter</span>
          <select aria-label="Matter" value={matterId} onChange={(e) => setMatterId(e.target.value)} className="h-8 border px-2 text-[13px] text-ink-900">
            <option value="">Choose a matter</option>
            {list.map((matter) => <option key={matter.id} value={matter.id}>{matterLabel(matter)}</option>)}
          </select></label>
        {matterId && time.isSuccess && <span>{Math.round(hours * 100) / 100} hours · unbilled <Amount cents={unbilled} currency={currency} size="sm" tone="ink" /></span>}
      </div>
      {!matterId ? <EmptyNote>{list.length ? COPY.timeChoose.en : COPY.noMatters.en}</EmptyNote>
        : time.isLoading ? <SkeletonRows label="Loading time" />
          : entries.length === 0 ? <EmptyNote>No time recorded on {byId.get(matterId)?.matter_number}.</EmptyNote>
            : (
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">Time</caption>
                <thead><tr><th scope="col" className="pr-4 text-left">Date</th><th scope="col" className="pr-4 text-left">Work</th><th scope="col" className="pr-4 text-right">Hours</th><th scope="col" className="pr-4 text-left">Standing</th><th scope="col" className="text-right">{currency}</th></tr></thead>
                <tbody>
                  {entries.map((entry) => (
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
      {logging && <LogTimeDialog matter={matterId ? byId.get(matterId) : null} onClose={() => setLogging(false)} onDone={(message) => { setLogging(false); setNotice(message); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DisbursementsView() {
  const { orgId, currency, canPost } = useLawOrg();
  const { byId } = useMatterIndex();
  const costs = useQuery({ queryKey: ['disbursements', orgId], queryFn: () => apiRequest<{ disbursements: any[] }>('/api/disbursements') });
  const [recording, setRecording] = useState(false);
  useCreateIntent({ disbursement: () => setRecording(true) }, canPost);
  const [notice, setNotice] = useState('');
  const all = costs.data?.disbursements || [];
  const unbilled = all.filter((cost) => cost.paid_from === 'OFFICE' && !cost.invoice_id).reduce((sum, cost) => sum + Number(cost.amount_cents), 0);
  return (
    <div className="space-y-4">
      <PageHeading title={COPY.disbursements.en} note={COPY.disbursementsNote.en}
        actions={canPost && <button type="button" className={buttonClass.primary} onClick={() => setRecording(true)}>Record an office disbursement</button>} />
      <Notice message={notice} />
      <p className="border-b border-feint pb-3 text-[13px] text-graphite-600">Paid by the firm and not yet billed: <Amount cents={unbilled} currency={currency} size="sm" tone="ink" /></p>
      {costs.isLoading ? <SkeletonRows label="Loading disbursements" />
        : costs.isError ? <LoadProblem what="disbursements" path="/api/disbursements" onRetry={() => costs.refetch()} />
          : all.length === 0 ? <EmptyNote>{COPY.disbursementsEmpty.en}</EmptyNote>
            : (
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">Disbursements</caption>
                <thead><tr><th scope="col" className="pr-4 text-left">Date</th><th scope="col" className="pr-4 text-left">Matter</th><th scope="col" className="pr-4 text-left">What for</th><th scope="col" className="pr-4 text-left">Paid from</th><th scope="col" className="text-right">{currency}</th></tr></thead>
                <tbody>
                  {all.map((cost) => (
                    <tr key={cost.id}>
                      <td className="pr-4 whitespace-nowrap text-graphite-600">{shortDate(cost.incurred_on)}</td>
                      <td className="pr-4">{byId.get(cost.matter_id)?.matter_number || ''}</td>
                      <td className="pr-4">{cost.description}{cost.receipt_reference ? <span className="text-graphite-600"> · {cost.receipt_reference}</span> : null}</td>
                      <td className="pr-4 text-[12.5px] text-graphite-600">{cost.paid_from === 'CLIENT' ? 'Client money' : cost.invoice_id ? <Mark kind="tick" label="Office, billed" /> : 'Office, unbilled'}</td>
                      <td className="text-right"><Amount cents={Number(cost.amount_cents)} currency={currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
      {recording && <OfficeDisbursementDialog onClose={() => setRecording(false)} onDone={(message) => { setRecording(false); setNotice(message); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The law edition's Home: today in court, work not yet billed, what is owed and what is held. */
export function LawHomeView() {
  const { orgId, currency, timeZone, canPost } = useLawOrg();
  const setActiveView = useAppStore((state) => state.setActiveView);
  const today = todayIn(timeZone);
  const { list, matters } = useMatterIndex();
  const [outcome, setOutcome] = useState<any | null>(null);
  const [notice, setNotice] = useState('');
  const events = useQuery({
    queryKey: ['court-events', orgId, 'home', today],
    queryFn: () => apiRequest<{ events: any[] }>(`/api/court-events?from=${encodeURIComponent(zonedLocalToIso(`${today}T00:00`, timeZone))}&to=${encodeURIComponent(zonedLocalToIso(`${addDaysIso(today, 7)}T23:59`, timeZone))}`),
  });
  const balances = useQuery({ queryKey: ['client-balances', orgId, today], queryFn: () => apiRequest<{ balances: any[] }>(`/api/client-account/balances?asOf=${today}`) });
  const notes = useQuery({ queryKey: ['fee-notes', orgId], queryFn: () => apiRequest<{ feeNotes: any[] }>('/api/fee-notes') });
  const wip = useQuery({ queryKey: ['unbilled', orgId, 'all'], queryFn: () => apiRequest<{ timeCents: number; disbursementCents: number; matters: any[] }>('/api/matters/work-in-progress') });
  const heldCents = (balances.data?.balances || []).reduce((sum, row) => sum + Number(row.balance_cents || 0), 0);
  const owing = (notes.data?.feeNotes || []).filter((note) => note.status !== 'VOID' && Number(note.amount_due_cents) > 0);
  const owingCents = owing.reduce((sum, note) => sum + Number(note.amount_due_cents || 0), 0);
  const overdue = owing.filter((note) => note.due_date && note.due_date < today);
  const wipCents = (wip.data?.timeCents || 0) + (wip.data?.disbursementCents || 0);
  const scheduled = (events.data?.events || []).filter((event) => event.status === 'SCHEDULED');
  const todays = scheduled.filter((event) => zonedParts(event.starts_at, timeZone).date === today);
  const later = scheduled.filter((event) => zonedParts(event.starts_at, timeZone).date !== today);
  const date = new Intl.DateTimeFormat('en-KE', { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(new Date());

  return (
    <div className="space-y-5">
      <PageHeading title={date} note={COPY.home.en} />
      <Notice message={notice} />
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="min-w-0 rounded-xl border border-border bg-surface p-5 shadow-sm"><dt className="text-[13px] font-medium text-text-2">Open matters</dt><dd className="mt-3 font-display text-[24px] font-bold leading-7 text-text">{matters.isSuccess ? list.filter((matter) => matter.status === 'OPEN').length : '–'}</dd></div>
        <div className="min-w-0 rounded-xl border border-border bg-surface p-5 shadow-sm"><dt className="text-[13px] font-medium text-text-2">Unbilled work</dt><dd className="mt-3"><Amount cents={wipCents} currency={currency} size="lg" /></dd></div>
        <div className="min-w-0 rounded-xl border border-border bg-surface p-5 shadow-sm"><dt className="text-[13px] font-medium text-text-2">Owing on fee notes</dt><dd className="mt-3"><Amount cents={owingCents} currency={currency} size="lg" /></dd></div>
        <div className="min-w-0 rounded-xl border border-border bg-surface p-5 shadow-sm"><dt className="text-[13px] font-medium text-text-2">Client money held</dt><dd className="mt-3"><Amount cents={heldCents} currency={currency} size="lg" /></dd></div>
      </dl>

      {matters.isSuccess && list.length === 0 ? (
        <EmptyNote action={canPost && <button type="button" className={buttonClass.quiet} onClick={() => setActiveView('Law / Matters')}>Open the first matter</button>}>{COPY.noMatters.en}</EmptyNote>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <section aria-labelledby="home-today">
            <h2 id="home-today" className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">In court today</h2>
            {events.isLoading ? <SkeletonRows label="Loading today's court dates" rows={3} />
              : todays.length === 0 ? <p className="py-3 text-[13.5px] text-graphite-600">Nothing in the diary today.</p>
                : <DiaryList events={todays} canPost={canPost} onOutcome={setOutcome} />}
            {later.length > 0 && (
              <>
                <h3 className="ll-printed mt-4 border-b border-ink-900 pb-1 text-[11px] text-graphite-600">The next seven days</h3>
                <ul>
                  {later.slice(0, 8).map((event) => (
                    <li key={event.id} className="border-b border-feint py-2 text-[13.5px]">
                      <span className="ll-figure mr-2 text-ink-900">{printedDateTime(event.starts_at, timeZone)}</span>
                      {EVENT_TYPES[event.event_type]?.en} · {event.matters?.matter_number} {event.matters?.title}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button type="button" className={`${buttonClass.quiet} mt-2`} onClick={() => setActiveView('Law / Court diary')}>The court diary</button>
          </section>
          <section aria-labelledby="home-owing" className="space-y-4">
            <div>
              <h2 id="home-owing" className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">Fee notes outstanding</h2>
              {notes.isLoading ? <SkeletonRows label="Loading fee notes" rows={3} />
                : owing.length === 0 ? <p className="py-3 text-[13.5px] text-graphite-600"><Mark kind="tick" label="Nothing is owing on any fee note." /></p>
                  : (
                    <ul>
                      {owing.slice(0, 8).map((note) => (
                        <li key={note.id} className="flex items-baseline justify-between gap-3 border-b border-feint py-2 text-[13.5px]">
                          <span><span className="ll-figure mr-2">{note.invoice_number}</span>
                            {note.due_date && note.due_date < today ? <Mark kind="circled" label={`Past due ${shortDate(note.due_date)}`} /> : <span className="text-graphite-600">due {shortDate(note.due_date)}</span>}</span>
                          <Amount cents={Number(note.amount_due_cents)} currency={currency} />
                        </li>
                      ))}
                    </ul>
                  )}
              {overdue.length > 0 && <p className="mt-1 text-[12.5px] text-graphite-600">{overdue.length} past due.</p>}
              <button type="button" className={`${buttonClass.quiet} mt-2`} onClick={() => setActiveView('Law / Fee notes')}>All fee notes</button>
            </div>
            <div>
              <h2 className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">Work in progress</h2>
              {wip.isLoading ? <SkeletonRows label="Loading unbilled work" rows={2} />
                : wipCents === 0 ? <p className="py-3 text-[13.5px] text-graphite-600">No unbilled time or disbursements.</p>
                  : (
                    <>
                      <LedgerRow label="Unbilled time"><Amount cents={wip.data!.timeCents} currency={currency} tone="ink" /></LedgerRow>
                      <LedgerRow label="Disbursements paid by the firm, not yet billed"><Amount cents={wip.data!.disbursementCents} currency={currency} tone="ink" /></LedgerRow>
                    </>
                  )}
            </div>
          </section>
        </div>
      )}
      {outcome && <CourtOutcomeDialog event={outcome} onClose={() => setOutcome(null)} onDone={(message) => { setOutcome(null); setNotice(message); }} />}
    </div>
  );
}

export { MattersView };
