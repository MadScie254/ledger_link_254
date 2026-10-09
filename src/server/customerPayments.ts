import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';

function one(value: any) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function mapPayment(row: any) {
  const account = one(row.deposit_account);
  const credit = one(row.credit_notes);
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    customerName: one(row.customer)?.display_name ?? null,
    date: row.payment_date,
    depositAccountId: row.deposit_account_id,
    depositAccountName: account ? `${account.code} ${account.name}` : null,
    amountCents: Number(row.amount_cents) || 0,
    appliedCents: Number(row.applied_cents) || 0,
    creditCents: (Number(row.amount_cents) || 0) - (Number(row.applied_cents) || 0),
    reference: row.reference,
    memo: row.memo,
    status: row.status as 'POSTED' | 'REVERSED',
    reversedAt: row.reversed_at,
    reversalReason: row.reversal_reason,
    journalEntryId: row.journal_entry_id,
    createdAt: row.created_at,
    invoices: ((row.invoice_payments || []) as any[])
      .map((share) => ({
        invoiceId: share.invoice_id,
        invoiceNumber: one(share.invoice)?.invoice_number ?? null,
        amountCents: Number(share.amount_cents) || 0,
      }))
      .sort((a, b) => String(a.invoiceNumber).localeCompare(String(b.invoiceNumber))),
    credit: credit
      ? { id: credit.id, number: credit.number, remainingCents: Number(credit.remaining_cents) || 0, status: credit.status }
      : null,
  };
}

/**
 * Payments from customers that settle several invoices at once
 * (20261009000600_customer_payments.sql): one deposit, one entry, shared
 * across the invoices oldest due first unless told otherwise, the rest kept
 * as the customer's credit.
 */
export class CustomerPaymentService {
  static async list(orgId: string, filter: { customerId?: string } = {}) {
    const supabase = getSupabase();
    const rows = await fetchAllRows<any>((from, to) => {
      let request = supabase
        .from('customer_payments')
        .select(`
          *,
          customer:customers(display_name),
          deposit_account:accounts!customer_payments_org_account_fkey(code, name),
          invoice_payments!invoice_payments_customer_payment_fkey(invoice_id, amount_cents,
            invoice:invoices!invoice_payments_org_invoice_fkey(invoice_number)),
          credit_notes!credit_notes_customer_payment_fkey(id, number, remaining_cents, status)
        `)
        .eq('org_id', orgId);
      if (filter.customerId) request = request.eq('customer_id', filter.customerId);
      return request.order('payment_date', { ascending: false }).order('id').range(from, to);
    });
    return rows.map(mapPayment);
  }

  static async receive(input: {
    orgId: string; customerId: string; paymentDate: string; depositAccountId: string; amountCents: number;
    allocations?: Array<{ invoiceId: string; amountCents: number }> | null; reference?: string; memo?: string;
    actor: string; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('receive_customer_payment', {
      p_org_id: input.orgId,
      p_customer_id: input.customerId,
      p_payment_date: input.paymentDate,
      p_deposit_account_id: input.depositAccountId,
      p_amount_cents: Math.trunc(input.amountCents),
      p_allocations: input.allocations == null
        ? null
        : input.allocations.map((share) => ({ invoiceId: share.invoiceId, amountCents: Math.trunc(share.amountCents) })),
      p_reference: input.reference?.trim() || null,
      p_memo: input.memo?.trim() || null,
      p_actor: input.actor,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as {
      id: string; number: string; amountCents: number; appliedCents: number; creditCents: number;
      creditNoteId: string | null; journalEntryId: string;
      invoices?: Array<{ invoiceId: string; invoiceNumber: string; amountCents: number; amountDueCents: number; status: string }>;
    };
  }

  static async reverse(orgId: string, id: string, reversalDate: string, reason: string, actor: string) {
    const { data, error } = await getSupabase().rpc('reverse_customer_payment', {
      p_org_id: orgId,
      p_payment_id: id,
      p_reversal_date: reversalDate,
      p_reason: reason,
      p_actor: actor,
    });
    if (error) throw error;
    return data as { number: string; reversalJournalEntryId: string };
  }
}
