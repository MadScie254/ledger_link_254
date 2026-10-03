import { getSupabase } from './supabase';

export interface PartyBalance {
  openCents: number;
  overdueCents: number;
  openDocuments: number;
}

/**
 * What each customer or supplier owes, summed from their open invoices or
 * bills (public.party_balances), rather than a stored running total that can
 * drift from the documents.
 */
export async function partyBalances(orgId: string, partyType: 'CUSTOMER' | 'VENDOR'): Promise<Map<string, PartyBalance>> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('party_balances', { p_org_id: orgId });
  if (error) throw error;
  const balances = new Map<string, PartyBalance>();
  for (const row of (data || []) as any[]) {
    if (row.party_type !== partyType) continue;
    balances.set(row.party_id, {
      openCents: Number(row.open_cents) || 0,
      overdueCents: Number(row.overdue_cents) || 0,
      openDocuments: Number(row.open_documents) || 0,
    });
  }
  return balances;
}
