import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import type { SalesOrderLineInput } from './salesOrders';
import type { ExpenseLineInput } from './cashTransactions';

export type CreditKind = 'CUSTOMER' | 'SUPPLIER';

function one(value: any) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function mapCredit(row: any) {
  const invoice = one(row.invoice);
  const bill = one(row.bill);
  return {
    id: row.id,
    kind: row.kind as CreditKind,
    number: row.number,
    date: row.credit_date,
    customerId: row.customer_id,
    vendorId: row.vendor_id,
    partyName: one(row.customer)?.display_name ?? one(row.vendor)?.display_name ?? null,
    invoiceId: row.invoice_id,
    invoiceNumber: invoice?.invoice_number ?? null,
    billId: row.bill_id,
    billNumber: bill?.bill_number ?? null,
    reference: row.reference,
    memo: row.memo,
    currency: row.currency,
    subtotalCents: Number(row.subtotal_cents) || 0,
    taxCents: Number(row.tax_cents) || 0,
    totalCents: Number(row.total_cents) || 0,
    remainingCents: Number(row.remaining_cents) || 0,
    status: row.status as 'OPEN' | 'CLOSED' | 'VOID',
    journalEntryId: row.journal_entry_id,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    createdAt: row.created_at,
    lines: ((row.credit_note_lines || []) as any[])
      .map((line) => ({
        position: line.line_position,
        description: line.description,
        accountId: line.account_id,
        inventoryItemId: line.inventory_item_id,
        quantity: line.quantity == null ? null : Number(line.quantity),
        unitPriceCents: line.unit_price_cents == null ? null : Number(line.unit_price_cents),
        taxRate: line.tax_rate == null ? null : Number(line.tax_rate),
        amountCents: Number(line.amount_cents) || 0,
        taxCents: Number(line.tax_cents) || 0,
      }))
      .sort((a, b) => a.position - b.position),
    uses: ((row.credit_applications || []) as any[])
      .map((use) => {
        const usedInvoice = one(use.used_invoice);
        const usedBill = one(use.used_bill);
        const account = one(use.money_account);
        return {
          id: use.id,
          kind: use.kind as 'APPLY' | 'REFUND',
          number: use.number,
          date: use.applied_date,
          amountCents: Number(use.amount_cents) || 0,
          documentId: use.invoice_id ?? use.bill_id ?? null,
          documentNumber: usedInvoice?.invoice_number ?? usedBill?.bill_number ?? null,
          moneyAccountName: account ? `${account.code} ${account.name}` : null,
          reference: use.reference,
          reversedAt: use.reversed_at,
          reversalReason: use.reversal_reason,
          createdAt: use.created_at,
        };
      })
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
  };
}

type Issued = { id: string; number: string; totalCents: number; appliedCents: number; journalEntryId: string };

/**
 * Credit notes to customers and credits from suppliers, and each use of
 * one: applied to an invoice or bill, or refunded. Every change runs in one
 * Postgres function with its journal entry, stock movements and audit row.
 */
export class CreditNoteService {
  static async list(orgId: string, filter: { kind?: CreditKind; customerId?: string; vendorId?: string } = {}) {
    const supabase = getSupabase();
    const rows = await fetchAllRows<any>((from, to) => {
      let request = supabase
        .from('credit_notes')
        .select(`
          *,
          credit_note_lines(*),
          credit_applications(*,
            used_invoice:invoices!credit_applications_invoice_fkey(invoice_number),
            used_bill:bills!credit_applications_bill_fkey(bill_number),
            money_account:accounts!credit_applications_money_account_fkey(code, name)),
          customer:customers(display_name),
          vendor:vendors(display_name),
          invoice:invoices!credit_notes_org_invoice_fkey(invoice_number),
          bill:bills!credit_notes_org_bill_fkey(bill_number)
        `)
        .eq('org_id', orgId);
      if (filter.kind) request = request.eq('kind', filter.kind);
      if (filter.customerId) request = request.eq('customer_id', filter.customerId);
      if (filter.vendorId) request = request.eq('vendor_id', filter.vendorId);
      return request.order('credit_date', { ascending: false }).order('id').range(from, to);
    });
    return rows.map(mapCredit);
  }

  static async issueCustomerCredit(input: {
    orgId: string; customerId: string; invoiceId?: string; date: string; memo?: string;
    lines: SalesOrderLineInput[]; actor: string; idempotencyKey: string;
  }): Promise<Issued> {
    const { data, error } = await getSupabase().rpc('issue_credit_note', {
      p_org_id: input.orgId,
      p_customer_id: input.customerId,
      p_invoice_id: input.invoiceId || null,
      p_credit_date: input.date,
      p_memo: input.memo?.trim() || null,
      p_lines: input.lines.map((line) => ({
        description: line.description.trim(),
        accountId: line.accountId,
        inventoryItemId: line.inventoryItemId || null,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        taxRate: line.taxRate ?? 0,
      })),
      p_actor: input.actor,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as Issued;
  }

  static async recordSupplierCredit(input: {
    orgId: string; vendorId: string; billId?: string; date: string; reference?: string; memo?: string;
    lines: ExpenseLineInput[]; actor: string; idempotencyKey: string;
  }): Promise<Issued> {
    const { data, error } = await getSupabase().rpc('record_supplier_credit', {
      p_org_id: input.orgId,
      p_vendor_id: input.vendorId,
      p_bill_id: input.billId || null,
      p_credit_date: input.date,
      p_reference: input.reference?.trim() || null,
      p_memo: input.memo?.trim() || null,
      p_lines: input.lines.map((line) => ({
        description: line.description.trim(),
        accountId: line.accountId,
        amountCents: Math.trunc(line.amountCents),
        taxCents: Math.trunc(line.taxCents || 0),
        inventoryItemId: line.inventoryItemId || null,
        quantity: line.quantity ?? null,
      })),
      p_actor: input.actor,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as Issued;
  }

  static async apply(input: {
    orgId: string; creditId: string; documentId: string; amountCents: number; date: string; actor: string; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('apply_credit', {
      p_org_id: input.orgId,
      p_credit_note_id: input.creditId,
      p_document_id: input.documentId,
      p_amount_cents: Math.trunc(input.amountCents),
      p_applied_date: input.date,
      p_actor: input.actor,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as { applicationId: string; remainingCents: number; documentNumber?: string; amountDueCents?: number; status?: string };
  }

  static async refund(input: {
    orgId: string; creditId: string; amountCents: number; date: string; moneyAccountId: string;
    reference?: string; actor: string; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('refund_credit', {
      p_org_id: input.orgId,
      p_credit_note_id: input.creditId,
      p_amount_cents: Math.trunc(input.amountCents),
      p_refund_date: input.date,
      p_money_account_id: input.moneyAccountId,
      p_reference: input.reference?.trim() || null,
      p_actor: input.actor,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as { applicationId: string; number: string; journalEntryId: string; remainingCents: number };
  }

  static async reverseUse(orgId: string, useId: string, reversalDate: string | undefined, reason: string, actor: string) {
    const { data, error } = await getSupabase().rpc('reverse_credit_application', {
      p_org_id: orgId,
      p_application_id: useId,
      p_reversal_date: reversalDate || null,
      p_reason: reason,
      p_actor: actor,
    });
    if (error) throw error;
    return data as { applicationId: string; remainingCents: number; reversalJournalEntryId: string | null; documentNumber: string | null };
  }

  static async void(orgId: string, id: string, voidDate: string, reason: string, actor: string) {
    const { data, error } = await getSupabase().rpc('void_credit_note', {
      p_org_id: orgId,
      p_credit_note_id: id,
      p_void_date: voidDate,
      p_reason: reason,
      p_actor: actor,
    });
    if (error) throw error;
    return data as { number: string; reversalJournalEntryId: string };
  }
}
