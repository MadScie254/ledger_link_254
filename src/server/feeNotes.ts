import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { UserError } from './errors';

export class FeeNoteService {
  static async list(orgId: string, matterId?: string) {
    const supabase = getSupabase();
    return fetchAllRows<any>((from, to) => {
      let query = supabase.from('invoices').select('*').eq('org_id', orgId)
        .not('matter_id', 'is', null).order('date', { ascending: false })
        .order('id').range(from, to);
      if (matterId) query = query.eq('matter_id', matterId);
      return query;
    });
  }

  static async get(orgId: string, invoiceId: string) {
    const supabase = getSupabase();
    const [invoice, lines] = await Promise.all([
      supabase.from('invoices').select('*').eq('org_id', orgId)
        .eq('id', invoiceId).not('matter_id', 'is', null).maybeSingle(),
      supabase.from('invoice_lines').select('*').eq('org_id', orgId)
        .eq('invoice_id', invoiceId).order('id'),
    ]);
    if (invoice.error) throw invoice.error;
    if (lines.error) throw lines.error;
    if (!invoice.data) throw new UserError('Fee note not found.', 404);
    return { ...invoice.data, lines: lines.data ?? [] };
  }

  static async create(orgId: string, actor: string, input: {
    matterId: string; issueDate: string; dueDate: string;
    timeEntryIds: string[]; disbursementIds: string[];
    vatRatePercent: number; notes?: string; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('create_fee_note_from_unbilled', {
      p_org_id: orgId,p_matter_id: input.matterId,p_issue_date: input.issueDate,
      p_due_date: input.dueDate,p_time_entry_ids: input.timeEntryIds,
      p_disbursement_ids: input.disbursementIds,
      p_vat_rate_percent: input.vatRatePercent,p_notes: input.notes ?? null,
      p_idempotency_key: input.idempotencyKey,p_created_by: actor,
    });
    if (error) throw error;
    return data as string;
  }

  static async payment(orgId: string, actor: string, invoiceId: string, input: {
    cashCents: number; whtCents: number; whtCertificateNumber?: string;
    paymentDate: string; depositAccountId: string; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('receive_fee_note_payment', {
      p_org_id: orgId,p_invoice_id: invoiceId,p_cash_cents: input.cashCents,
      p_wht_cents: input.whtCents,
      p_wht_certificate_number: input.whtCertificateNumber ?? null,
      p_payment_date: input.paymentDate,p_deposit_account_id: input.depositAccountId,
      p_idempotency_key: input.idempotencyKey,p_created_by: actor,
    });
    if (error) throw error;
    return data as string;
  }

  static async recordEtims(orgId: string, actor: string, invoiceId: string, number: string) {
    const { error } = await getSupabase().rpc('record_fee_note_etims', {
      p_org_id: orgId,p_invoice_id: invoiceId,p_etims_invoice_number: number,
      p_created_by: actor,
    });
    if (error) throw error;
  }
}
