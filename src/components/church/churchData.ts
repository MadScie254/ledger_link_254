import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import type { LocalizedLabel } from '../../utils/editions';

/** Copy for the church screens, English now and Swahili to follow. */
export const say = (en: string): LocalizedLabel => ({ en, sw: 'TODO-SW' });

export const MEMBER_STATUS: Record<string, LocalizedLabel> = {
  VISITOR: say('Visitor'), ADHERENT: say('Adherent'), MEMBER: say('Member'), BAPTISED_MEMBER: say('Baptised member'),
  TRANSFERRED: say('Transferred'), DECEASED: say('Deceased'), INACTIVE: say('Inactive'),
};
export const GIFT_METHODS: Record<string, LocalizedLabel> = {
  MPESA: say('M-Pesa'), CASH: say('Cash'), BANK: say('Bank'), CHEQUE: say('Cheque'),
};
export const COUNT_STATUS: Record<string, LocalizedLabel> = {
  AWAITING_SECOND_COUNT: say('Waiting for the second count'), COUNTED: say('Counted, not banked'), BANKED: say('Banked'),
};
export const RULE_TYPES: Record<string, LocalizedLabel> = {
  MEMBER_NUMBER: say('Reference is a member number'), PREFIX: say('Reference starts with'), EXACT: say('Reference is exactly'),
};

export interface Fund {
  id: string;
  code: string;
  name: string;
  restricted: boolean;
  is_active: boolean;
  income_account_id: string;
  accounts?: { code: string; name: string } | null;
}

export interface Member {
  id: string;
  member_number: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  household_id: string | null;
  status: string;
  date_of_birth: string | null;
  joined_on: string | null;
  consent_given_at: string | null;
  consent_method: string | null;
  notes: string | null;
  households?: { name: string } | null;
}

export const memberName = (member: Pick<Member, 'first_name' | 'last_name'> | null | undefined) =>
  member ? [member.first_name, member.last_name].filter(Boolean).join(' ') : '';
export const memberLabel = (member: Pick<Member, 'member_number' | 'first_name' | 'last_name'>) =>
  `${member.member_number} · ${memberName(member)}`;

/** 2026-10-15 as 15/10/2026. */
export const shortDate = (iso: string | null | undefined) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
};

export function useChurchOrg() {
  const { currentOrgId, activeCompany } = useAppStore();
  const role = activeCompany?.role;
  return {
    orgId: currentOrgId,
    currency: activeCompany?.baseCurrency || 'KES',
    timeZone: activeCompany?.timeZone || 'Africa/Nairobi',
    today: todayIn(activeCompany?.timeZone || 'Africa/Nairobi'),
    canPost: role !== 'member',
    isAdmin: role === 'owner' || role === 'admin',
    companyName: activeCompany?.legalName || activeCompany?.name || 'The church',
    kraPin: activeCompany?.taxId || undefined,
  };
}

export function useFunds() {
  const { orgId } = useChurchOrg();
  return useQuery({
    queryKey: ['funds', orgId],
    queryFn: () => apiRequest<{ funds: Fund[] }>('/api/funds', { fallback: 'The funds could not be loaded.' }),
  });
}

export function useMembers(filters: { search?: string; status?: string; householdId?: string } = {}) {
  const { orgId } = useChurchOrg();
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as Array<[string, string]>);
  return useQuery({
    queryKey: ['members', orgId, params.toString()],
    queryFn: () => apiRequest<{ members: Member[] }>(`/api/members${params.toString() ? `?${params}` : ''}`, { fallback: 'The register could not be loaded.' }),
  });
}

export function useHouseholds() {
  const { orgId } = useChurchOrg();
  return useQuery({
    queryKey: ['households', orgId],
    queryFn: () => apiRequest<{ households: Array<{ id: string; name: string; address: string | null; phone: string | null; memberCount: number }> }>('/api/households', { fallback: 'The households could not be loaded.' }),
  });
}

/** The church's money accounts: bank, cash on hand and M-Pesa. */
export function useMoneyAccounts() {
  const { orgId } = useChurchOrg();
  const query = useQuery({
    queryKey: ['accounts', orgId],
    queryFn: () => apiRequest<{ accounts: any[] }>('/api/accounts', { fallback: 'The accounts could not be loaded.' }),
  });
  const all = query.data?.accounts || [];
  return {
    ...query,
    all,
    banks: all.filter((account) => account.isBankAccount && account.isActive !== false && !['1040', '1050'].includes(account.code)),
    income: all.filter((account) => account.type === 'INCOME' && account.isActive !== false),
  };
}

export function refreshChurch(queryClient: QueryClient, orgId: string) {
  for (const key of ['members', 'member', 'households', 'funds', 'giving-rules', 'giving-queue', 'giving-day', 'collections',
    'treasurer-report', 'fund-balances', 'church-dashboard', 'accounts', 'journal-entries', 'dashboard-metrics']) {
    queryClient.invalidateQueries({ queryKey: [key, orgId] });
  }
}
