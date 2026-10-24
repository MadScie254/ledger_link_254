import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { useCreateIntent } from '../../hooks/useCreateIntent';
import { MEMBER_STATUSES } from '../../utils/memberImport';
import { givingStatement } from '../../utils/memberGiving';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { Amount, figureText } from '../ledger/Amount';
import { EmptyNote, LoadProblem, PageHeading, SkeletonRows, buttonClass } from '../ledger/Page';
import { GiftDialog, HouseholdDialog, ImportMembersDialog, MemberDialog } from './ChurchDialogs';
import {
  GIFT_METHODS, MEMBER_STATUS, memberName, say, shortDate, useChurchOrg, useHouseholds, useMembers, type Member,
} from './churchData';
import { text } from '../../utils/language';

const COPY = {
  members: say('Members'),
  addMember: say('Add a member'),
  importCsv: say('Import from CSV'),
  noMembers: say('No members in the register yet. Add the first, or import the register from a CSV file.'),
  noMatch: say('No member matches that search.'),
  households: say('Households'),
  addHousehold: say('Add a household'),
  noHouseholds: say('No households yet. A household groups members who live together.'),
  noGiving: say('No giving recorded for this member yet.'),
  statement: say('Giving statement'),
  receipt: say('Giving receipt'),
  downloadStatement: say('Download statement PDF'),
  downloadReceipt: say('Download receipt PDF'),
  from: say('From'),
  to: say('To'),
  postedGifts: say('Posted gifts'),
  periodTotal: say('Giving in this period'),
  postedGift: say('Posted gift'),
  giftId: say('Gift ID'),
  journalEntry: say('Journal entry'),
  allTime: say('All time'),
  receiptColumn: say('Receipt'),
  invalidPeriod: say('The period starts after it ends.'),
  noGivingInPeriod: say('No giving in this period.'),
};

/** A member another screen asked the Members page to open. */
export const useMemberFocus = create<{ memberId: string | null; focus: (memberId: string | null) => void }>((set) => ({
  memberId: null,
  focus: (memberId) => set({ memberId }),
}));

function Notice({ message }: { message: string }) {
  return message ? <p role="status" className="text-[13.5px] text-ink-900">{message}</p> : null;
}

export function MembersView() {
  const { canPost } = useChurchOrg();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [dialog, setDialog] = useState<'add' | 'import' | null>(null);
  const [notice, setNotice] = useState('');
  const focus = useMemberFocus();
  useCreateIntent({ member: () => setDialog('add') }, canPost);
  const members = useMembers({ search: search.trim().length >= 2 ? search.trim() : undefined, status: status || undefined });
  const list = members.data?.members || [];
  const done = (message: string) => { setDialog(null); setNotice(message); };

  if (focus.memberId) return <MemberRecord memberId={focus.memberId} onBack={() => focus.focus(null)} />;

  return (
    <div className="space-y-5">
      <PageHeading title={text(COPY.members)} note="The church register. A member's number is also their M-Pesa account reference."
        actions={canPost && (
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setDialog('import')}>{text(COPY.importCsv)}</button>
            <button type="button" className={buttonClass.primary} onClick={() => setDialog('add')}>{text(COPY.addMember)}</button>
          </>
        )} />
      <Notice message={notice} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[13px]">
          <span className="block font-semibold text-ink-900">Search</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, number or phone"
            className="mt-1 h-9 w-64 border px-3 text-[14px]" name="search" />
        </label>
        <label className="text-[13px]">
          <span className="block font-semibold text-ink-900">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 h-9 border px-2 text-[14px]" name="status">
            <option value="">Every status</option>
            {MEMBER_STATUSES.map((value) => <option key={value} value={value}>{text(MEMBER_STATUS[value])}</option>)}
          </select>
        </label>
      </div>
      {members.isError ? <LoadProblem what="the register" path="/api/members" onRetry={() => members.refetch()} />
        : members.isLoading ? <SkeletonRows label="Loading the register" />
          : list.length === 0 ? (
            <EmptyNote action={canPost && !search && !status && <button type="button" className={buttonClass.quiet} onClick={() => setDialog('add')}>{text(COPY.addMember)}</button>}>
              {search || status ? text(COPY.noMatch) : text(COPY.noMembers)}
            </EmptyNote>
          ) : (
            <>
              <p className="text-[12.5px] text-graphite-600">{list.length} {list.length === 1 ? 'member' : 'members'}</p>
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">Members</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pr-4 text-left">Number</th>
                    <th scope="col" className="pr-4 text-left">Name</th>
                    <th scope="col" className="hidden pr-4 text-left sm:table-cell">Household</th>
                    <th scope="col" className="pr-4 text-left">Status</th>
                    <th scope="col" className="hidden text-left md:table-cell">Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((member) => (
                    <tr key={member.id}>
                      <td className="py-2 pr-4 ll-figure">{member.member_number}</td>
                      <td className="py-2 pr-4">
                        <button type="button" className={buttonClass.quiet} onClick={() => focus.focus(member.id)}>{memberName(member)}</button>
                      </td>
                      <td className="hidden py-2 pr-4 sm:table-cell">{member.households?.name || ''}</td>
                      <td className="py-2 pr-4">{text(MEMBER_STATUS[member.status])}</td>
                      <td className="hidden py-2 md:table-cell text-graphite-600">{member.phone || member.email ? 'Kept, with consent' : 'None kept'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
      {dialog === 'add' && <MemberDialog onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'import' && <ImportMembersDialog onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

export function MemberRecord({ memberId, onBack }: { memberId: string; onBack: () => void }) {
  const { orgId, currency, canPost, companyName, kraPin, today } = useChurchOrg();
  const [dialog, setDialog] = useState<'edit' | 'gift' | null>(null);
  const [notice, setNotice] = useState('');
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const record = useQuery({
    queryKey: ['member', orgId, memberId],
    queryFn: () => apiRequest<{ member: Member; giving: any[]; givingTotalCents: number }>(`/api/members/${memberId}`, { fallback: 'The member could not be loaded.' }),
  });
  const done = (message: string) => { setDialog(null); setNotice(message); };
  if (record.isError) return <LoadProblem what="the member" path={`/api/members/${memberId}`} onRetry={() => record.refetch()} />;
  if (record.isLoading || !record.data) return <SkeletonRows label="Loading the member" />;
  const { member, giving, givingTotalCents } = record.data;
  const validPeriod = from <= to;
  const statement = validPeriod ? givingStatement(giving, from, to) : { gifts: [], totalCents: 0 };
  const downloadStatement = () => FinancialPDFEngine.exportFinancialStatement(
    { title: text(COPY.statement), subtitle: memberName(member), period: `${shortDate(from)} to ${shortDate(to)}`,
      companyName, kraPin, currency, filename: `giving-statement-${member.member_number}-${from}-${to}.pdf` },
    [
      { title: text(COPY.postedGifts), headers: ['Received', 'Fund', 'How', 'Reference', currency],
        rows: statement.gifts.map((gift: any) => [shortDate(gift.received_on), gift.funds?.name || '',
          text(GIFT_METHODS[gift.method]) || gift.method, gift.reference || '', figureText(Number(gift.amount_cents))]) },
      { title: 'Total', headers: ['', currency], rows: [[text(COPY.periodTotal), figureText(statement.totalCents)]] },
    ],
  );
  const downloadReceipt = (gift: any) => FinancialPDFEngine.exportFinancialStatement(
    { title: text(COPY.receipt), subtitle: memberName(member), period: shortDate(gift.received_on),
      companyName, kraPin, currency, filename: `giving-receipt-${gift.id}.pdf` },
    [{ title: text(COPY.postedGift), headers: ['Detail', 'Value'], rows: [
      ['Member', `${member.member_number} · ${memberName(member)}`],
      ['Fund', gift.funds?.name || ''], ['Method', text(GIFT_METHODS[gift.method]) || gift.method],
      ['Reference', gift.reference || 'Not recorded'], [text(COPY.giftId), gift.id],
      [text(COPY.journalEntry), gift.journal_entry_id], ['Amount', `${currency} ${figureText(Number(gift.amount_cents))}`],
    ] }],
  );
  return (
    <div className="space-y-5">
      <button type="button" className={buttonClass.quiet} onClick={onBack}>All members</button>
      <PageHeading title={memberName(member)} note={`Member ${member.member_number} · ${text(MEMBER_STATUS[member.status])}`}
        actions={canPost && (
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setDialog('edit')}>Edit details</button>
            <button type="button" className={buttonClass.primary} onClick={() => setDialog('gift')}>Record a gift</button>
          </>
        )} />
      <Notice message={notice} />
      <dl className="grid gap-x-6 gap-y-3 border-b border-feint-strong pb-4 text-[13.5px] sm:grid-cols-3">
        {[
          ['Household', member.households?.name || 'None'],
          ['Joined', shortDate(member.joined_on) || 'Not recorded'],
          ['Date of birth', shortDate(member.date_of_birth) || 'Not recorded'],
          ['Phone', member.phone || 'Not kept'],
          ['Email', member.email || 'Not kept'],
          ['Consent to contact', member.consent_method ? `${member.consent_method}, ${shortDate(member.consent_given_at)}` : 'Not given'],
        ].map(([label, value]) => (
          <div key={label}><dt className="ll-printed text-[10.5px] text-graphite-600">{label}</dt><dd className="mt-0.5 text-ink-900">{value}</dd></div>
        ))}
      </dl>
      {member.notes && <p className="max-w-2xl text-[13.5px] text-ink-900">{member.notes}</p>}
      <section aria-labelledby="member-giving">
        <div className="flex items-baseline justify-between border-b border-feint-strong pb-1">
          <h2 id="member-giving" className="ll-heading text-[17px] text-ink-900">Giving</h2>
          <span className="text-[13px] text-graphite-600">{text(COPY.allTime)} <Amount cents={givingTotalCents} currency={currency} /></span>
        </div>
        <div className="my-3 flex flex-wrap items-end gap-3 no-print">
          <label className="text-[12.5px]">{text(COPY.from)}<input type="date" name="statement-from" value={from} onChange={(event) => setFrom(event.target.value || from)} className="mt-1 block h-9 rounded-lg border border-border px-2" /></label>
          <label className="text-[12.5px]">{text(COPY.to)}<input type="date" name="statement-to" value={to} onChange={(event) => setTo(event.target.value || to)} className="mt-1 block h-9 rounded-lg border border-border px-2" /></label>
          {canPost && <button type="button" className={buttonClass.secondary} onClick={downloadStatement} disabled={!validPeriod || !statement.gifts.length}>{text(COPY.downloadStatement)}</button>}
          <span className="text-[13px]">{text(COPY.statement)}: <Amount cents={statement.totalCents} currency={currency} /></span>
        </div>
        {!validPeriod && <p role="alert" className="text-[13px] text-negative">{text(COPY.invalidPeriod)}</p>}
        {statement.gifts.length === 0 ? <p className="py-3 text-[13.5px] text-graphite-600">{giving.length ? text(COPY.noGivingInPeriod) : text(COPY.noGiving)}</p> : (
          <table className="w-full text-[13.5px]">
            <caption className="sr-only">Giving by this member</caption>
            <thead><tr><th scope="col" className="text-left">Received</th><th scope="col" className="text-left">Fund</th><th scope="col" className="text-left">How</th><th scope="col" className="text-right">Amount</th><th scope="col" className="text-right no-print">{text(COPY.receiptColumn)}</th></tr></thead>
            <tbody>
              {statement.gifts.map((gift) => (
                <tr key={gift.id}>
                  <td className="py-1.5 ll-figure">{shortDate(gift.received_on)}</td>
                  <td className="py-1.5">{gift.funds?.name}</td>
                  <td className="py-1.5">{text(GIFT_METHODS[gift.method])}{gift.reference ? ` · ${gift.reference}` : ''}</td>
                  <td className="py-1.5 text-right"><Amount cents={Number(gift.amount_cents)} currency={currency} /></td>
                  <td className="py-1.5 text-right no-print">{canPost && <button type="button" className={buttonClass.quiet} onClick={() => downloadReceipt(gift)} aria-label={`${text(COPY.downloadReceipt)} for ${shortDate(gift.received_on)}`}>{text(COPY.downloadReceipt)}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {dialog === 'edit' && <MemberDialog member={member} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'gift' && <GiftDialog memberId={member.id} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

export function HouseholdsView() {
  const { canPost } = useChurchOrg();
  const households = useHouseholds();
  const focus = useMemberFocus();
  const setActiveView = useAppStore((state) => state.setActiveView);
  const [household, setHousehold] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const members = useMembers({ householdId: household || undefined });
  const list = households.data?.households || [];
  return (
    <div className="space-y-5">
      <PageHeading title={text(COPY.households)} note="Members who live together."
        actions={canPost && <button type="button" className={buttonClass.primary} onClick={() => setAdding(true)}>{text(COPY.addHousehold)}</button>} />
      <Notice message={notice} />
      {households.isError ? <LoadProblem what="the households" path="/api/households" onRetry={() => households.refetch()} />
        : households.isLoading ? <SkeletonRows label="Loading households" />
          : list.length === 0 ? <EmptyNote>{text(COPY.noHouseholds)}</EmptyNote> : (
            <div className="grid gap-6 lg:grid-cols-2">
              <ul className="border-t border-feint-strong">
                {list.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-3 border-b border-feint py-2 text-[13.5px]">
                    <button type="button" className={buttonClass.quiet} onClick={() => setHousehold(item.id)} aria-pressed={household === item.id}>{item.name}</button>
                    <span className="text-graphite-600">{item.memberCount} {item.memberCount === 1 ? 'member' : 'members'}</span>
                  </li>
                ))}
              </ul>
              {household && (
                <section aria-label="Members of the household">
                  <h2 className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">{list.find((item) => item.id === household)?.name}</h2>
                  <ul>
                    {(members.data?.members || []).map((member) => (
                      <li key={member.id} className="border-b border-feint py-2 text-[13.5px]">
                        <span className="ll-figure mr-2">{member.member_number}</span>
                        {memberName(member)} <span className="text-graphite-600">· {text(MEMBER_STATUS[member.status])}</span>
                        <button type="button" className={`${buttonClass.quiet} ml-2`} onClick={() => { focus.focus(member.id); setActiveView('Church / Members'); }}>Open</button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
      {adding && <HouseholdDialog onClose={() => setAdding(false)} onDone={(message) => { setAdding(false); setNotice(message); }} />}
    </div>
  );
}
