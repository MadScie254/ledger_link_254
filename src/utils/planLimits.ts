import type { Edition } from './editions.ts';

export interface PlanLimits {
  id: string;
  edition: Edition;
  name: string;
  maxUsers: number | null;
  maxMembers: number | null;
  isActive: boolean;
}

export type LimitKind = 'users' | 'members';
const ceiling = (plan: PlanLimits, kind: LimitKind) => kind === 'users' ? plan.maxUsers : plan.maxMembers;

export function canAddUser(plan: PlanLimits | null, currentUsers: number): boolean {
  return !plan || plan.maxUsers === null || currentUsers < plan.maxUsers;
}

export function canAddMember(plan: PlanLimits | null, currentMembers: number): boolean {
  return !plan || plan.maxMembers === null || currentMembers < plan.maxMembers;
}

export function nextPlanFor(plan: PlanLimits, plans: PlanLimits[], kind: LimitKind): PlanLimits | null {
  const currentLimit = ceiling(plan, kind);
  if (currentLimit === null) return null;
  return plans.filter((candidate) => candidate.isActive && candidate.edition === plan.edition
    && candidate.id !== plan.id && (ceiling(candidate, kind) ?? Infinity) > currentLimit)
    .sort((a, b) => (ceiling(a, kind) ?? Infinity) - (ceiling(b, kind) ?? Infinity)
      || a.name.localeCompare(b.name))[0] || null;
}

export function limitMessage(plan: PlanLimits, next: PlanLimits | null, kind: LimitKind): string {
  const limit = ceiling(plan, kind);
  if (limit === null) return `${plan.name} has no ${kind} limit.`;
  const current = `The ${plan.name} plan includes ${limit.toLocaleString('en-KE')} ${kind}.`;
  const nextLimit = next ? ceiling(next, kind) : null;
  return next && nextLimit !== null
    ? `${current} Move to ${next.name} for up to ${nextLimit.toLocaleString('en-KE')}.`
    : `${current} This is the highest listed ${kind} limit.`;
}
