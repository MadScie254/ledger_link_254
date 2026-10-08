import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';

export class ClientAccountService {
  static async balances(orgId: string, asOf: string) {
    const { data, error } = await getSupabase().rpc('client_balances', {
      p_org_id: orgId, p_as_of: asOf,
    });
    if (error) throw error;
    return data ?? [];
  }

  static async entries(orgId: string, matterId: string) {
    const supabase = getSupabase();
    return fetchAllRows<any>((from, to) => supabase.from('journal_lines')
      .select('id,debit,credit,description,account_id,journal_entries!inner(entry_date,source_type,reference_no,description),accounts!inner(code,name)')
      .eq('org_id', orgId).eq('entity_type', 'MATTER').eq('entity_id', matterId)
      .in('accounts.code', ['1060', '2200'])
      .order('id').range(from, to));
  }

  static async receipt(orgId: string, actor: string, input: {
    matterId: string; amountCents: number; receiptDate: string;
    method: string; reference: string; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('record_client_receipt', {
      p_org_id: orgId, p_matter_id: input.matterId,
      p_amount_cents: input.amountCents, p_receipt_date: input.receiptDate,
      p_method: input.method, p_reference: input.reference,
      p_idempotency_key: input.idempotencyKey, p_created_by: actor,
    });
    if (error) throw error;
    return data as string;
  }

  static async payment(orgId: string, actor: string, input: {
    matterId: string; amountCents: number; paymentDate: string; payee: string;
    purpose: string; asDisbursement: boolean; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('record_client_payment', {
      p_org_id: orgId, p_matter_id: input.matterId,
      p_amount_cents: input.amountCents, p_payment_date: input.paymentDate,
      p_payee: input.payee, p_purpose: input.purpose,
      p_as_disbursement: input.asDisbursement,
      p_idempotency_key: input.idempotencyKey, p_created_by: actor,
    });
    if (error) throw error;
    return data as string;
  }

  static async transfer(orgId: string, actor: string, input: {
    matterId: string; invoiceId: string; amountCents: number; transferDate: string;
    officeAccountId: string; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('transfer_client_to_office', {
      p_org_id: orgId, p_matter_id: input.matterId,p_invoice_id: input.invoiceId,
      p_amount_cents: input.amountCents,p_transfer_date: input.transferDate,
      p_office_account_id: input.officeAccountId,
      p_idempotency_key: input.idempotencyKey,p_created_by: actor,
    });
    if (error) throw error;
    return data as string;
  }
}
