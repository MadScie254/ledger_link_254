import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';

export class DisbursementService {
  static async list(orgId: string, matterId?: string) {
    const supabase = getSupabase();
    return fetchAllRows<any>((from, to) => {
      let query = supabase.from('disbursements').select('*').eq('org_id', orgId)
        .order('incurred_on', { ascending: false }).order('id').range(from, to);
      if (matterId) query = query.eq('matter_id', matterId);
      return query;
    });
  }

  static async recordOffice(orgId: string, actor: string, input: {
    matterId: string; amountCents: number; incurredOn: string; description: string;
    paidFromAccountId: string; receiptReference?: string; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('record_office_disbursement', {
      p_org_id: orgId,p_matter_id: input.matterId,p_amount_cents: input.amountCents,
      p_incurred_on: input.incurredOn,p_description: input.description,
      p_paid_from_account_id: input.paidFromAccountId,
      p_receipt_reference: input.receiptReference ?? null,
      p_idempotency_key: input.idempotencyKey,p_created_by: actor,
    });
    if (error) throw error;
    return data as string;
  }
}
