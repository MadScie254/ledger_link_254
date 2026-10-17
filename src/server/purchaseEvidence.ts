import { getSupabase } from './supabase';

export interface PurchaseEvidenceInput {
  etimsInvoiceNumber?: string;
  etimsInvoiceDate?: string;
  etimsExemptionReason?: string;
}

export class PurchaseEvidenceService {
  static async set(orgId: string, kind: 'BILL' | 'EXPENSE', id: string, actor: string, input: PurchaseEvidenceInput) {
    const { error } = await getSupabase().rpc('set_purchase_etims_evidence', {
      p_org_id: orgId,
      p_kind: kind,
      p_record_id: id,
      p_actor: actor,
      p_etims_invoice_number: input.etimsInvoiceNumber?.trim() || null,
      p_etims_invoice_date: input.etimsInvoiceDate || null,
      p_etims_exemption_reason: input.etimsExemptionReason?.trim() || null,
    });
    if (error) throw error;
  }
}
