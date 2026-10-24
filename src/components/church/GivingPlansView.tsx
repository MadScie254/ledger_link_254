import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { monthRange } from '../../utils/churchReports';
import { centsFromAmountText } from '../../utils/salesOrders';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { EmptyNote, LoadProblem, SkeletonRows, buttonClass } from '../ledger/Page';
import { memberLabel, refreshChurch, say, useChurchOrg, useFunds, useMembers } from './churchData';
import { text } from '../../utils/language';

const COPY = {
  month: say('Month'), newPlan: say('Add monthly plan'), member: say('Member'), fund: say('Fund'),
  expected: say('Monthly intention'), received: say('Posted giving'), status: say('Status'),
  starts: say('First month'), ends: say('Last month'), stop: say('Stop after this month'),
  save: say('Save plan'), cancel: say('Cancel'),
  empty: say('No giving plans are active in this month.'),
  note: say('A plan records an intention. It does not collect or post money.'),
  invalid: say('Enter an amount greater than zero, with up to two decimal places.'),
  chooseMember: say('Choose a member'), chooseFund: say('Choose a fund'),
  unavailableMember: say('Member unavailable'), unavailableFund: say('Fund unavailable'),
  actions: say('Actions'), saved: say('Monthly giving plan saved.'), stopped: say('Giving plan stopped.'),
};
const STATUS: Record<string, string> = {
  PLANNED: text(say('Planned')), DUE: text(say('Due')), PARTIAL: text(say('Part received')),
  MISSED: text(say('Missed')), MET: text(say('Met')),
};

interface Plan {
  id: string; member: { member_number: string; first_name: string; last_name: string | null };
  fund: { code: string; name: string }; monthlyCents: number; receivedCents: number;
  startsOn: string; endsOn: string | null; status: string;
}

export function GivingPlansView() {
  const { orgId, currency, canPost, today } = useChurchOrg();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const query = useQuery({ queryKey: ['church-giving-plans', orgId, month],
    queryFn: () => apiRequest<{ plans: Plan[] }>(`/api/church/giving-plans?month=${month}`, { fallback: 'Giving plans could not be loaded.' }) });
  const stop = useMutation({ mutationFn: ({ id, endsOn }: { id: string; endsOn: string }) =>
    apiRequest(`/api/church/giving-plans/${id}/stop`, { body: { endsOn } }),
  onSuccess: () => { refreshChurch(queryClient, orgId); setNotice(text(COPY.stopped)); },
  onError: (cause) => setNotice(cause instanceof Error ? cause.message : text(say('Giving plan could not be stopped.'))) });
  const lastDay = monthRange(month)?.to ?? '';
  return <section className="space-y-4" aria-label="Monthly giving plans">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <Field label={text(COPY.month)}><input type="month" name="plan-month" value={month}
        onChange={(event) => setMonth(event.target.value || today.slice(0, 7))} /></Field>
      {canPost && <button type="button" className={buttonClass.primary} onClick={() => setOpen(true)}>{text(COPY.newPlan)}</button>}
    </div>
    <p className="text-[13px] text-text-2">{text(COPY.note)}</p>
    {notice && <p role="status" className="text-[13px]">{notice}</p>}
    {query.isError ? <LoadProblem what="giving plans" path="/api/church/giving-plans" onRetry={() => query.refetch()} />
      : query.isLoading || !query.data ? <SkeletonRows label="Loading giving plans" rows={4} />
        : query.data.plans.length === 0 ? <EmptyNote>{text(COPY.empty)}</EmptyNote>
          : <div className="overflow-x-auto rounded-xl border border-border bg-surface"><table className="w-full min-w-[580px] text-[13.5px]">
            <caption className="sr-only">Giving plans for {month}</caption>
            <thead className="bg-surface-2 text-[12px] text-text-2"><tr>
              <th scope="col" className="px-3 py-2 text-left">{text(COPY.member)}</th>
              <th scope="col" className="px-3 py-2 text-left">{text(COPY.fund)}</th>
              <th scope="col" className="px-3 py-2 text-right">{text(COPY.expected)}</th>
              <th scope="col" className="px-3 py-2 text-right">{text(COPY.received)}</th>
              <th scope="col" className="px-3 py-2 text-left">{text(COPY.status)}</th>
              <th scope="col" className="px-3 py-2 text-right">{text(COPY.actions)}</th>
            </tr></thead><tbody>{query.data.plans.map((plan) => <tr key={plan.id} className="border-t border-border">
              <td className="px-3 py-2">{plan.member ? memberLabel(plan.member) : text(COPY.unavailableMember)}</td>
              <td className="px-3 py-2">{plan.fund?.name || text(COPY.unavailableFund)}</td>
              <td className="px-3 py-2 text-right"><Amount cents={plan.monthlyCents} currency={currency} /></td>
              <td className="px-3 py-2 text-right"><Amount cents={plan.receivedCents} currency={currency} /></td>
              <td className="px-3 py-2">{STATUS[plan.status] || plan.status}</td>
              <td className="px-3 py-2 text-right">{canPost && !plan.endsOn && lastDay >= plan.startsOn &&
                <button type="button" className={buttonClass.quiet} disabled={stop.isPending}
                  onClick={() => stop.mutate({ id: plan.id, endsOn: lastDay })}>{text(COPY.stop)}</button>}</td>
            </tr>)}</tbody></table></div>}
    {open && <PlanDialog month={month} onClose={() => setOpen(false)} onDone={(message) => {
      setOpen(false); refreshChurch(queryClient, orgId); setNotice(message);
    }} />}
  </section>;
}

function PlanDialog({ month, onClose, onDone }: { month: string; onClose: () => void; onDone: (message: string) => void }) {
  const { currency } = useChurchOrg();
  const members = useMembers();
  const funds = useFunds();
  const [form, setForm] = useState({ memberId: '', fundId: '', amount: '', startsOn: `${month}-01` });
  const [error, setError] = useState('');
  const save = useMutation({ mutationFn: (body: object) => apiRequest('/api/church/giving-plans', { body }),
    onSuccess: () => onDone(text(COPY.saved)),
    onError: (cause) => setError(cause instanceof Error ? cause.message : text(say('Giving plan could not be saved.'))) });
  return <Dialog open onClose={onClose} title={text(COPY.newPlan)} note={text(COPY.note)}
    footer={<><button type="button" className={buttonClass.secondary} onClick={onClose}>{text(COPY.cancel)}</button>
      <button type="submit" form="giving-plan-form" className={buttonClass.primary} disabled={save.isPending}>{text(COPY.save)}</button></>}>
    <form id="giving-plan-form" className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); const monthlyCents = centsFromAmountText(form.amount);
      if (!monthlyCents) { setError(text(COPY.invalid)); return; }
      setError(''); save.mutate({ memberId: form.memberId, fundId: form.fundId, monthlyCents, startsOn: form.startsOn });
    }}>
      <Field label={text(COPY.member)}><select required name="plan-member" value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value })}>
        <option value="">{text(COPY.chooseMember)}</option>{(members.data?.members || []).map((member) =>
          <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></Field>
      <Field label={text(COPY.fund)}><select required name="plan-fund" value={form.fundId} onChange={(event) => setForm({ ...form, fundId: event.target.value })}>
        <option value="">{text(COPY.chooseFund)}</option>{(funds.data?.funds || []).filter((fund) => fund.is_active).map((fund) =>
          <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select></Field>
      <Field label={`${text(COPY.expected)} (${currency})`}><input required inputMode="decimal" name="plan-amount" value={form.amount}
        onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field>
      <Field label={text(COPY.starts)}><input required type="month" name="plan-start" value={form.startsOn.slice(0, 7)}
        onChange={(event) => setForm({ ...form, startsOn: `${event.target.value}-01` })} /></Field>
      {error && <p role="alert" className="text-[13px] text-negative">{error}</p>}
    </form>
  </Dialog>;
}
