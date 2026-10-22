import { getSupabase } from './supabase';

/**
 * M-Pesa payments to a business's paybill or till (public.mpesa_payments).
 * Each is kept once per M-Pesa transaction as a statement line on the
 * business's M-Pesa money account; it settles an invoice only when the
 * account number the customer typed is that open invoice's number. The
 * rules live in public.receive_mpesa_payment and public.settle_mpesa_payment.
 */

export interface PaymentInput {
  transId: string;
  /** ISO 8601 with its offset. */
  transTime: string;
  amountCents: number;
  billRefNumber: string | null;
  msisdn: string | null;
  payerName: string | null;
  shortcode: string | null;
  transactionType: string | null;
  raw: unknown;
}

export interface KeptPayment {
  id: string;
  transId: string;
  bankTransactionId: string;
  inserted: boolean;
  outcome: 'WAITING' | 'SETTLED';
}

export type SettleOutcome =
  | { id: string; outcome: 'SETTLED'; invoiceId: string; invoiceNumber?: string; journalEntryId: string }
  | { id: string; outcome: 'WAITING'; note: string };

export interface MpesaPaymentRow {
  id: string;
  transId: string;
  transTime: string;
  amountCents: number;
  accountNumber: string | null;
  payerName: string | null;
  source: 'C2B_CALLBACK' | 'STK_CALLBACK';
  outcome: 'WAITING' | 'SETTLED';
  note: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  journalEntryId: string | null;
  bankTransactionId: string;
}

export class MpesaPaymentService {
  /** Keeps a payment Safaricom reported; a repeat returns the payment already kept. */
  static async keep(orgId: string, source: 'C2B_CALLBACK' | 'STK_CALLBACK', payment: PaymentInput): Promise<KeptPayment> {
    const { data, error } = await getSupabase().rpc('receive_mpesa_payment', {
      p_org_id: orgId, p_source: source, p_payment: payment,
    });
    if (error) throw error;
    return {
      id: data.id, transId: data.transId, bankTransactionId: data.bankTransactionId,
      inserted: Boolean(data.inserted), outcome: data.outcome,
    };
  }

  /**
   * Settles the invoice the payment's account number names, in the name of
   * actor (the organization's integration actor, or the person asking).
   * With no actor, or no single open invoice that fits, it waits in Banking
   * and the reason is kept on the payment.
   */
  static async settle(orgId: string, paymentId: string, actor: string | null): Promise<SettleOutcome> {
    const { data, error } = await getSupabase().rpc('settle_mpesa_payment', {
      p_org_id: orgId, p_payment_id: paymentId, p_actor: actor,
    });
    if (error) throw error;
    return data.outcome === 'SETTLED'
      ? { id: data.id, outcome: 'SETTLED', invoiceId: data.invoiceId, invoiceNumber: data.invoiceNumber, journalEntryId: data.journalEntryId }
      : { id: data.id, outcome: 'WAITING', note: String(data.note ?? '') };
  }

  /** The latest payments, newest first, with the invoice each settled. */
  static async recent(orgId: string, limit = 50): Promise<MpesaPaymentRow[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('mpesa_payments')
      .select('id, trans_id, trans_time, amount_cents, bill_ref_number, payer_name, source, outcome, outcome_note, invoice_id, journal_entry_id, bank_transaction_id')
      .eq('org_id', orgId).order('trans_time', { ascending: false }).order('id').limit(Math.min(Math.max(limit, 1), 200));
    if (error) throw error;
    const rows = data ?? [];
    const invoiceIds = [...new Set(rows.map((row: any) => row.invoice_id).filter(Boolean))];
    const numbers = new Map<string, string>();
    if (invoiceIds.length) {
      const { data: invoices, error: invoiceError } = await supabase.from('invoices')
        .select('id, invoice_number').eq('org_id', orgId).in('id', invoiceIds);
      if (invoiceError) throw invoiceError;
      for (const invoice of invoices ?? []) numbers.set(invoice.id, invoice.invoice_number);
    }
    return rows.map((row: any) => ({
      id: row.id,
      transId: row.trans_id,
      transTime: row.trans_time,
      amountCents: Number(row.amount_cents),
      accountNumber: row.bill_ref_number ?? null,
      payerName: row.payer_name ?? null,
      source: row.source,
      outcome: row.outcome,
      note: row.outcome_note ?? null,
      invoiceId: row.invoice_id ?? null,
      invoiceNumber: row.invoice_id ? numbers.get(row.invoice_id) ?? null : null,
      journalEntryId: row.journal_entry_id ?? null,
      bankTransactionId: row.bank_transaction_id,
    }));
  }
}
