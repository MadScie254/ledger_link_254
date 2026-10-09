import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { useCreateIntent } from '../../hooks/useCreateIntent';
import { MEMBER_STATUSES } from '../../utils/memberImport';
import { Amount } from '../ledger/Amount';
import { EmptyNote, LoadProblem, PageHeading, SkeletonRows, buttonClass } from '../ledger/Page';
import { GiftDialog, HouseholdDialog, ImportMembersDialog, MemberDialog } from './ChurchDialogs';
import {
  GIFT_METHODS, MEMBER_STATUS, memberName, say, shortDate, useChurchOrg, useHouseholds, useMembers, type Member,
} from './churchData';

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
      <PageHeading title={COPY.members.en} note="The church register. A member's number is also their M-Pesa account reference."
        actions={canPost && (
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setDialog('import')}>{COPY.importCsv.en}</button>
            <button type="button" className={buttonClass.primary} onClick={() => setDialog('add')}>{COPY.addMember.en}</button>
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
            {MEMBER_STATUSES.map((value) => <option key={value} value={value}>{MEMBER_STATUS[value].en}</option>)}
          </select>
        </label>
      </div>
      {members.isError ? <LoadProblem what="the register" path="/api/members" onRetry={() => members.refetch()} />
        : members.isLoading ? <SkeletonRows label="Loading the register" />
          : list.length === 0 ? (
            <EmptyNote action={canPost && !search && !status && <button type="button" className={buttonClass.quiet} onClick={() => setDialog('add')}>{COPY.addMember.en}</button>}>
              {search || status ? COPY.noMatch.en : COPY.noMembers.en}
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
                      <td className="py-2 pr-4">{MEMBER_STATUS[member.status]?.en}</td>
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
  const { orgId, currency, canPost } = useChurchOrg();
  const [dialog, setDialog] = useState<'edit' | 'gift' | null>(null);
  const [notice, setNotice] = useState('');
  const record = useQuery({
    queryKey: ['member', orgId, memberId],
    queryFn: () => apiRequest<{ member: Member; giving: any[]; givingTotalCents: number }>(`/api/members/${memberId}`, { fallback: 'The member could not be loaded.' }),
  });
  const done = (message: string) => { setDialog(null); setNotice(message); };
  if (record.isError) return <LoadProblem what="the member" path={`/api/members/${memberId}`} onRetry={() => record.refetch()} />;
  if (record.isLoading || !record.data) return <SkeletonRows label="Loading the member" />;
  const { member, giving, givingTotalCents } = record.data;
  return (
    <div className="space-y-5">
      <button type="button" className={buttonClass.quiet} onClick={onBack}>All members</button>
      <PageHeading title={memberName(member)} note={`Member ${member.member_number} · ${MEMBER_STATUS[member.status]?.en}`}
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
          <span className="text-[13px] text-graphite-600">Total <Amount cents={givingTotalCents} currency={currency} /></span>
        </div>
        {giving.length === 0 ? <p className="py-3 text-[13.5px] text-graphite-600">{COPY.noGiving.en}</p> : (
          <table className="w-full text-[13.5px]">
            <caption className="sr-only">Giving by this member</caption>
            <thead><tr><th scope="col" className="text-left">Received</th><th scope="col" className="text-left">Fund</th><th scope="col" className="text-left">How</th><th scope="col" className="text-right">Amount</th></tr></thead>
            <tbody>
              {giving.map((gift) => (
                <tr key={gift.id}>
                  <td className="py-1.5 ll-figure">{shortDate(gift.received_on)}</td>
                  <td className="py-1.5">{gift.funds?.name}</td>
                  <td className="py-1.5">{GIFT_METHODS[gift.method]?.en}{gift.reference ? ` · ${gift.reference}` : ''}</td>
                  <td className="py-1.5 text-right"><Amount cents={Number(gift.amount_cents)} currency={currency} /></td>
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
      <PageHeading title={COPY.households.en} note="Members who live together."
        actions={canPost && <button type="button" className={buttonClass.primary} onClick={() => setAdding(true)}>{COPY.addHousehold.en}</button>} />
      <Notice message={notice} />
      {households.isError ? <LoadProblem what="the households" path="/api/households" onRetry={() => households.refetch()} />
        : households.isLoading ? <SkeletonRows label="Loading households" />
          : list.length === 0 ? <EmptyNote>{COPY.noHouseholds.en}</EmptyNote> : (
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
                        {memberName(member)} <span className="text-graphite-600">· {MEMBER_STATUS[member.status]?.en}</span>
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
