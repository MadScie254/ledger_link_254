import { useQuery, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import type { LocalizedLabel } from '../../utils/editions';

/** Copy for the law screens, English now and Swahili to follow. */
export const say = (en: string): LocalizedLabel => ({ en, sw: 'TODO-SW' });

export const MATTER_TYPES: Record<string, LocalizedLabel> = {
  LITIGATION: say('Litigation'), CONVEYANCING: say('Conveyancing'), CORPORATE: say('Corporate'),
  PROBATE: say('Probate and succession'), EMPLOYMENT: say('Employment'), ADVISORY: say('Advisory'), OTHER: say('Other'),
};
export const MATTER_STATUS: Record<string, LocalizedLabel> = { OPEN: say('Open'), ON_HOLD: say('On hold'), CLOSED: say('Closed') };
export const BILLING_METHODS: Record<string, LocalizedLabel> = {
  HOURLY: say('Hourly'), FIXED: say('Fixed fee'), SCALE: say('Advocates Remuneration Order scale'), RETAINER: say('Retainer'),
};
export const PARTY_ROLES: Record<string, LocalizedLabel> = {
  CLIENT: say('Client'), OPPOSING_PARTY: say('Opposing party'), OPPOSING_ADVOCATE: say('Opposing advocate'),
  WITNESS: say('Witness'), INTERESTED_PARTY: say('Interested party'), OTHER: say('Other'),
};
export const EVENT_TYPES: Record<string, LocalizedLabel> = {
  HEARING: say('Hearing'), MENTION: say('Mention'), RULING: say('Ruling'), JUDGMENT: say('Judgment'),
  FILING_DEADLINE: say('Filing deadline'), OTHER: say('Other'),
};
export const EVENT_STATUS: Record<string, LocalizedLabel> = {
  SCHEDULED: say('Scheduled'), DONE: say('Done'), ADJOURNED: say('Adjourned'), CANCELLED: say('Cancelled'),
};

export interface Matter {
  id: string;
  matter_number: string;
  title: string;
  client_id: string;
  matter_type: string;
  stage: string | null;
  status: 'OPEN' | 'ON_HOLD' | 'CLOSED';
  responsible_user_id: string | null;
  court: string | null;
  court_station: string | null;
  case_number: string | null;
  judicial_officer: string | null;
  billing_method: string | null;
  default_rate_cents: number | null;
  fixed_fee_cents: number | null;
  opened_on: string;
  closed_on: string | null;
  notes: string | null;
  practice_area: string | null;
  customers?: { display_name: string } | null;
}

export const clientName = (matter: Pick<Matter, 'customers'> | null | undefined) => matter?.customers?.display_name || 'Client not found';
export const matterLabel = (matter: Pick<Matter, 'matter_number' | 'title'>) => `${matter.matter_number} · ${matter.title}`;

/** 2026-10-15 as 15/10/2026. */
export const shortDate = (iso: string | null | undefined) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
};

/** A matter another screen asked the Matters page to open. */
export const useMatterFocus = create<{ matterId: string | null; focus: (matterId: string | null) => void }>((set) => ({
  matterId: null,
  focus: (matterId) => set({ matterId }),
}));

export function useLawOrg() {
  const { currentOrgId, activeCompany } = useAppStore();
  return {
    orgId: currentOrgId,
    currency: activeCompany?.baseCurrency || 'KES',
    timeZone: activeCompany?.timeZone || 'Africa/Nairobi',
    canPost: activeCompany?.role !== 'member',
  };
}

export function useMatters() {
  const { orgId } = useLawOrg();
  return useQuery({
    queryKey: ['matters', orgId],
    queryFn: () => apiRequest<{ matters: Matter[] }>('/api/matters', { fallback: 'The matters could not be loaded.' }),
  });
}

export function useCustomers() {
  const { orgId } = useLawOrg();
  return useQuery({
    queryKey: ['customers', orgId],
    queryFn: () => apiRequest<{ customers: any[] }>('/api/customers', { fallback: 'The clients could not be loaded.' }),
  });
}

export function useTeamMembers() {
  const { orgId } = useLawOrg();
  return useQuery({
    queryKey: ['team', orgId],
    queryFn: () => apiRequest<{ members: Array<{ userId: string; email: string; role: string }> }>('/api/team', { fallback: 'The team could not be loaded.' }),
  });
}

/** Office bank, cash and M-Pesa accounts: every money account but the client account (1060). */
export function useOfficeAccounts() {
  const { orgId } = useLawOrg();
  const query = useQuery({
    queryKey: ['accounts', orgId],
    queryFn: () => apiRequest<{ accounts: any[] }>('/api/accounts', { fallback: 'The accounts could not be loaded.' }),
  });
  const office = (query.data?.accounts || []).filter((account) => account.isBankAccount && account.isActive !== false && account.code !== '1060');
  return { ...query, office, all: query.data?.accounts || [] };
}

/** Everything a law posting can change, refreshed together. */
export function refreshLaw(queryClient: QueryClient, orgId: string) {
  for (const key of ['matters', 'matter', 'court-events', 'client-balances', 'client-entries', 'disbursements',
    'fee-notes', 'fee-note', 'unbilled', 'matter-time', 'matter-parties', 'accounts', 'journal-entries', 'dashboard-metrics', 'invoices']) {
    queryClient.invalidateQueries({ queryKey: [key, orgId] });
  }
}
