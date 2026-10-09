import { useQuery } from '@tanstack/react-query';
import type { PlanSnapshot } from '../../server/plans';
import { EmptyNote } from '../ledger/Page';

const unavailable = { en: 'Plan details could not be loaded. Try opening this tab again.', sw: 'TODO-SW' };
const missing = { en: 'No plan is assigned to these books.', sw: 'TODO-SW' };

const dateLabel = (value: string) => new Intl.DateTimeFormat('en-KE', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi',
}).format(new Date(value));

export function PlanPanel({ orgId }: { orgId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['plan', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const response = await fetch('/api/plan', { headers: { 'x-org-id': orgId } });
      if (!response.ok) throw new Error('Plan details could not be loaded.');
      return response.json() as Promise<{ subscription: PlanSnapshot | null }>;
    },
  });
  if (isLoading) return <p role="status" className="text-[13px] text-graphite-600">Opening plan details</p>;
  if (isError) return <EmptyNote>{unavailable.en}</EmptyNote>;
  const subscription = data?.subscription;
  if (!subscription) return <EmptyNote>{missing.en}</EmptyNote>;

  const { plan } = subscription;
  const reservedUsers = subscription.activeUsers + subscription.pendingInvitations;
  return <section aria-labelledby="plan-heading" className="max-w-3xl border-t-2 border-ink-900 pt-5">
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <p className="ll-printed text-[11px] text-graphite-600">Current plan</p>
        <h2 id="plan-heading" className="mt-1 ll-heading text-[24px] text-ink-900">{plan.name}</h2>
      </div>
      <p className="border border-feint-strong px-3 py-1 text-[12px] font-semibold text-ink-900">
        {subscription.status === 'TRIAL' ? 'Trial' : subscription.status === 'ACTIVE' ? 'Active'
          : subscription.status === 'PAST_DUE' ? 'Past due'
            : subscription.status === 'CANCELLED' ? 'Cancelled' : 'Not set'}
      </p>
    </div>
    <dl className="mt-6 grid gap-5 border-y border-feint py-5 sm:grid-cols-2">
      {subscription.trialEndsAt && <div>
        <dt className="ll-printed text-[11px] text-graphite-600">Trial ends</dt>
        <dd className="mt-1 text-[14px] text-ink-900">{dateLabel(subscription.trialEndsAt)}</dd>
      </div>}
      {subscription.currentPeriodEnd && <div>
        <dt className="ll-printed text-[11px] text-graphite-600">Current period ends</dt>
        <dd className="mt-1 text-[14px] text-ink-900">{dateLabel(subscription.currentPeriodEnd)}</dd>
      </div>}
      <div>
        <dt className="ll-printed text-[11px] text-graphite-600">Team users</dt>
        <dd className="mt-1 text-[14px] text-ink-900">
          {plan.maxUsers === null ? 'No plan limit' : `${reservedUsers} of ${plan.maxUsers} seats reserved`}
          {subscription.pendingInvitations > 0 && `, including ${subscription.pendingInvitations} pending invitations`}
        </dd>
      </div>
      {plan.edition === 'church' && <div>
        <dt className="ll-printed text-[11px] text-graphite-600">Member records</dt>
        <dd className="mt-1 text-[14px] text-ink-900">
          {plan.maxMembers === null ? 'No plan limit' : `Up to ${plan.maxMembers.toLocaleString('en-KE')}`}
          <span className="block text-[12px] text-graphite-600">Counts visitors, adherents and members; transferred, deceased and inactive records do not.</span>
        </dd>
      </div>}
    </dl>
    <p className="mt-4 text-[12px] text-graphite-600">No payment is collected in the app.</p>
  </section>;
}
