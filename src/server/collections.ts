import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import type { Counts } from '../utils/cashCount';

export class CollectionsService {
  static async list(orgId: string, filters: { status?: 'AWAITING_SECOND_COUNT' | 'COUNTED' | 'BANKED' } = {}) {
    const supabase = getSupabase();
    return fetchAllRows<any>((from, to) => {
      let query = supabase.from('collections')
        .select('id,collection_number,service_date,service_name,fund_id,denominations,total_cents,counted_by_1,counted_by_2,confirmed_at,status,journal_entry_id,banked_on,bank_account_id,bank_reference,banked_cents,variance_cents,banking_journal_entry_id,created_at,funds(code,name)')
        .eq('org_id', orgId);
      if (filters.status) query = query.eq('status', filters.status);
      return query.order('service_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to);
    });
  }

  /** The first counter saves the count; nothing posts until a second person confirms it. */
  static async start(orgId: string, userId: string, input: {
    serviceDate: string; serviceName: string; counts: Counts; totalCents: number; fundId: string; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('start_collection_count', {
      p_org_id: orgId, p_service_date: input.serviceDate, p_service_name: input.serviceName,
      p_denominations: { counts: input.counts, totalCents: input.totalCents }, p_fund_id: input.fundId,
      p_idempotency_key: input.idempotencyKey, p_created_by: userId,
    });
    if (error) throw error;
    return data as { id: string; number: string; totalCents: number };
  }

  /** The second counter, from their own sign-in, counts again; the cash posts only if the counts agree. */
  static async confirm(orgId: string, userId: string, collectionId: string, input: { counts: Counts; idempotencyKey: string }) {
    const { data, error } = await getSupabase().rpc('confirm_collection_count', {
      p_org_id: orgId, p_collection_id: collectionId, p_denominations: input.counts,
      p_idempotency_key: input.idempotencyKey, p_created_by: userId,
    });
    if (error) throw error;
    return data as { id: string; number: string; journalEntryId: string };
  }

  static async bank(orgId: string, userId: string, collectionId: string, input: {
    bankedCents: number; bankedOn: string; bankAccountId: string; bankReference?: string | null; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('bank_collection', {
      p_org_id: orgId, p_collection_id: collectionId, p_banked_cents: input.bankedCents, p_banked_on: input.bankedOn,
      p_bank_account_id: input.bankAccountId, p_bank_reference: input.bankReference || null,
      p_idempotency_key: input.idempotencyKey, p_created_by: userId,
    });
    if (error) throw error;
    return data as { id: string; varianceCents: number; journalEntryId: string };
  }
}
