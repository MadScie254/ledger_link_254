import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { centsFromAmountText } from '../../utils/salesOrders';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { EmptyNote, LoadProblem, SkeletonRows, buttonClass } from '../ledger/Page';
import { memberLabel, refreshChurch, say, shortDate, useChurchOrg, useFunds, useMembers } from './churchData';
import { text } from '../../utils/language';

const COPY = {
  addCampaign: say('Add campaign'), addPledge: say('Record pledge'),
  campaignName: say('Campaign name'), fund: say('Fund'), goal: say('Goal'),
  startsOn: say('Starts on'), endsOn: say('Ends on'), saveCampaign: say('Save campaign'),
  member: say('Member'), amount: say('Pledged amount'), pledgedOn: say('Pledged on'),
  dueOn: say('Due on'), note: say('Note'), savePledge: say('Save pledge'),
  postedGiving: say('Posted giving'), pledged: say('Pledged'), received: say('Received'),
  noCampaigns: say('No campaigns yet. Create one for an existing fund.'),
  noPledges: say('No pledges recorded for this campaign.'),
  invalidAmount: say('Enter an amount greater than zero, with up to two decimal places.'),
  cancel: say('Cancel'),
  closeCampaign: say('Close campaign'),
  open: say('Open'), unavailable: say('Member unavailable'), noDueDate: say('No due date'),
  campaignNote: say('A campaign uses one fund. Pledges do not post to the books.'),
  pledgeNote: say('A pledge is a commitment. Only a received gift appears in the books.'),
  chooseFund: say('Choose a fund'), chooseMember: say('Choose a member'),
};

interface Pledge {
  id: string; memberId: string; member: { member_number: string; first_name: string; last_name: string | null };
  pledgedCents: number; receivedCents: number; pledgedOn: string; dueOn: string | null; status: string; note: string | null;
}
interface Campaign {
  id: string; fundId: string; fund: { name: string; code: string; restricted: boolean };
  name: string; goalCents: number; startsOn: string; endsOn: string | null; status: string;
  givenCents: number; pledgedCents: number; pledges: Pledge[];
}

export function CampaignsView() {
  const { orgId, currency, canPost, isAdmin, today } = useChurchOrg();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['church-campaigns', orgId],
    queryFn: () => apiRequest<{ campaigns: Campaign[] }>('/api/church/campaigns', { fallback: 'Campaigns could not be loaded.' }) });
  const [dialog, setDialog] = useState<{ kind: 'campaign' } | { kind: 'pledge'; campaign: Campaign } | null>(null);
  const [notice, setNotice] = useState('');
  const close = useMutation({ mutationFn: (id: string) => apiRequest(`/api/church/campaigns/${id}/close`, { body: { endsOn: today } }),
    onSuccess: () => { refreshChurch(queryClient, orgId); setNotice(text(say('Campaign closed.'))); },
    onError: (cause) => setNotice(cause instanceof Error ? cause.message : text(say('Campaign could not be closed.'))) });
  const done = (message: string) => { setDialog(null); setNotice(message); };
  return <section className="space-y-4" aria-label="Campaigns and pledges">
    <div className="flex justify-end">{isAdmin && <button type="button" className={buttonClass.primary}
      onClick={() => setDialog({ kind: 'campaign' })}>{text(COPY.addCampaign)}</button>}</div>
    {notice && <p role="status" className="text-[13px]">{notice}</p>}
    {query.isError ? <LoadProblem what="campaigns" path="/api/church/campaigns" onRetry={() => query.refetch()} />
      : query.isLoading || !query.data ? <SkeletonRows label="Loading campaigns" rows={4} />
        : query.data.campaigns.length === 0 ? <EmptyNote>{text(COPY.noCampaigns)}</EmptyNote>
          : query.data.campaigns.map((campaign) => <article key={campaign.id} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-semibold text-text">{campaign.name}</h3>
                <p className="text-[12.5px] text-text-2">{campaign.fund?.name} · {shortDate(campaign.startsOn)} to {campaign.endsOn ? shortDate(campaign.endsOn) : text(COPY.open)}</p></div>
              {campaign.status === 'OPEN' && <div className="flex gap-2">
                {canPost && <button type="button" className={buttonClass.secondary}
                  onClick={() => setDialog({ kind: 'pledge', campaign })}>{text(COPY.addPledge)}</button>}
                {isAdmin && <button type="button" className={buttonClass.quiet} disabled={close.isPending}
                  onClick={() => close.mutate(campaign.id)}>{text(COPY.closeCampaign)}</button>}
              </div>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div><dt className="text-[12.5px] text-text-2">{text(COPY.goal)}</dt><dd><Amount cents={campaign.goalCents} currency={currency} /></dd></div>
              <div><dt className="text-[12.5px] text-text-2">{text(COPY.postedGiving)}</dt><dd><Amount cents={campaign.givenCents} currency={currency} /></dd></div>
              <div><dt className="text-[12.5px] text-text-2">{text(COPY.pledged)}</dt><dd><Amount cents={campaign.pledgedCents} currency={currency} /></dd></div>
            </dl>
            <progress className="mt-3 w-full accent-primary" value={Math.min(campaign.givenCents, campaign.goalCents)} max={campaign.goalCents}
              aria-label={`${campaign.name} giving toward goal`} />
            {campaign.pledges.length === 0 ? <p className="mt-3 text-[13px] text-text-2">{text(COPY.noPledges)}</p>
              : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[440px] text-[13px]">
                <caption className="sr-only">{campaign.name} pledges</caption>
                <thead><tr><th scope="col" className="text-left">{text(COPY.member)}</th><th scope="col" className="text-right">{text(COPY.pledged)}</th>
                  <th scope="col" className="text-right">{text(COPY.received)}</th><th scope="col" className="text-left">{text(COPY.dueOn)}</th></tr></thead>
                <tbody>{campaign.pledges.map((pledge) => <tr key={pledge.id} className="border-t border-border">
                  <td className="py-2">{pledge.member ? memberLabel(pledge.member) : text(COPY.unavailable)}</td>
                  <td className="py-2 text-right"><Amount cents={pledge.pledgedCents} currency={currency} /></td>
                  <td className="py-2 text-right"><Amount cents={pledge.receivedCents} currency={currency} /></td>
                  <td className="py-2">{shortDate(pledge.dueOn) || text(COPY.noDueDate)}</td>
                </tr>)}</tbody>
              </table></div>}
          </article>)}
    {dialog?.kind === 'campaign' && <CampaignDialog onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'pledge' && <PledgeDialog campaign={dialog.campaign} onClose={() => setDialog(null)} onDone={done} />}
  </section>;
}

function CampaignDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const { orgId, today, currency } = useChurchOrg();
  const queryClient = useQueryClient();
  const funds = useFunds();
  const [form, setForm] = useState({ name: '', fundId: '', goal: '', startsOn: today, endsOn: '' });
  const [error, setError] = useState('');
  const save = useMutation({ mutationFn: (body: object) => apiRequest('/api/church/campaigns', { body }),
    onSuccess: () => { refreshChurch(queryClient, orgId); onDone(`${text(say('Campaign'))} ${form.name.trim()} ${text(say('saved.'))}`); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : text(say('Campaign could not be saved.'))) });
  return <Dialog open onClose={onClose} title={text(COPY.addCampaign)} note={text(COPY.campaignNote)}
    footer={<><button type="button" className={buttonClass.secondary} onClick={onClose}>{text(COPY.cancel)}</button>
      <button type="submit" form="campaign-form" className={buttonClass.primary} disabled={save.isPending}>{text(COPY.saveCampaign)}</button></>}>
    <form id="campaign-form" className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); const goalCents = centsFromAmountText(form.goal);
      if (!goalCents) { setError(text(COPY.invalidAmount)); return; }
      setError(''); save.mutate({ fundId: form.fundId, name: form.name, goalCents,
        startsOn: form.startsOn, endsOn: form.endsOn || null });
    }}>
      <Field label={text(COPY.campaignName)}><input required name="campaign-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
      <Field label={text(COPY.fund)}><select required name="campaign-fund" value={form.fundId} onChange={(event) => setForm({ ...form, fundId: event.target.value })}>
        <option value="">{text(COPY.chooseFund)}</option>{(funds.data?.funds || []).filter((fund) => fund.is_active).map((fund) =>
          <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select></Field>
      <Field label={`${text(COPY.goal)} (${currency})`}><input required inputMode="decimal" name="campaign-goal" value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label={text(COPY.startsOn)}><input required type="date" name="campaign-start" value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} /></Field>
        <Field label={text(COPY.endsOn)}><input type="date" name="campaign-end" min={form.startsOn} value={form.endsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} /></Field></div>
      {error && <p role="alert" className="text-[13px] text-negative">{error}</p>}
    </form>
  </Dialog>;
}

function PledgeDialog({ campaign, onClose, onDone }: { campaign: Campaign; onClose: () => void; onDone: (message: string) => void }) {
  const { orgId, today, currency } = useChurchOrg();
  const queryClient = useQueryClient();
  const members = useMembers();
  const [form, setForm] = useState({ memberId: '', amount: '', pledgedOn: today, dueOn: '', note: '' });
  const [error, setError] = useState('');
  const save = useMutation({ mutationFn: (body: object) => apiRequest(`/api/church/campaigns/${campaign.id}/pledges`, { body }),
    onSuccess: () => { refreshChurch(queryClient, orgId); onDone(`${text(say('Pledge for'))} ${campaign.name} ${text(say('saved.'))}`); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : text(say('Pledge could not be saved.'))) });
  return <Dialog open onClose={onClose} title={`${text(COPY.addPledge)} · ${campaign.name}`} note={text(COPY.pledgeNote)}
    footer={<><button type="button" className={buttonClass.secondary} onClick={onClose}>{text(COPY.cancel)}</button>
      <button type="submit" form="pledge-form" className={buttonClass.primary} disabled={save.isPending}>{text(COPY.savePledge)}</button></>}>
    <form id="pledge-form" className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); const pledgedCents = centsFromAmountText(form.amount);
      if (!pledgedCents) { setError(text(COPY.invalidAmount)); return; }
      setError(''); save.mutate({ memberId: form.memberId, pledgedCents, pledgedOn: form.pledgedOn,
        dueOn: form.dueOn || null, note: form.note.trim() || null });
    }}>
      <Field label={text(COPY.member)}><select required name="pledge-member" value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value })}>
        <option value="">{text(COPY.chooseMember)}</option>{(members.data?.members || []).map((member) =>
          <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></Field>
      <Field label={`${text(COPY.amount)} (${currency})`}><input required inputMode="decimal" name="pledge-amount" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label={text(COPY.pledgedOn)}><input required type="date" name="pledged-on" min={campaign.startsOn} max={campaign.endsOn || undefined}
        value={form.pledgedOn} onChange={(event) => setForm({ ...form, pledgedOn: event.target.value })} /></Field>
        <Field label={text(COPY.dueOn)}><input type="date" name="pledge-due" min={form.pledgedOn} value={form.dueOn} onChange={(event) => setForm({ ...form, dueOn: event.target.value })} /></Field></div>
      <Field label={text(COPY.note)}><textarea name="pledge-note" maxLength={500} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field>
      {error && <p role="alert" className="text-[13px] text-negative">{error}</p>}
    </form>
  </Dialog>;
}
