import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { UserError } from './errors';
import { publicMessage } from './publicMessage';
import { organizationToday } from './organizationDates';

export interface BillLineInput {
  description: string;
  accountId: string;
  amountCents: number;
  foreignAmountCents?: number;
  taxCents?: number;
  /** A stock item received on this line; the bill counts it in. */
  inventoryItemId?: string;
  quantity?: number;
}

export interface BillInput {
  orgId: string;
  vendorId: string;
  vendorName?: string;
  billDate: string;
  dueDate: string;
  currency?: string;
  exchangeRate?: number;
  notes?: string;
  lines: BillLineInput[];
  idempotencyKey: string;
  createdBy: string;
  /** The supplier's own invoice number; one per supplier. */
  supplierReference?: string;
}

export interface BillPaymentInput {
  amountCents: number;
  paymentDate: string;
  sourceAccountId: string;
  idempotencyKey: string;
  createdBy: string;
}

export interface BillBatchPaymentInput extends Omit<BillPaymentInput, 'createdBy'> {
  billId: string;
}

function mapBillLine(row: any) {
  return {
    id: row.id,
    billId: row.bill_id,
    description: row.description,
    accountId: row.account_id,
    amountCents: Number(row.amount_cents) || 0,
    foreignAmountCents: row.foreign_amount_cents == null ? null : Number(row.foreign_amount_cents),
    taxCents: Number(row.tax_cents) || 0,
    foreignTaxCents: Number(row.foreign_tax_cents) || 0,
    inventoryItemId: row.inventory_item_id ?? null,
    quantity: row.quantity == null ? null : Number(row.quantity),
    createdAt: row.created_at,
  };
}

function mapBillPayment(row: any) {
  return {
    id: row.id,
    billId: row.bill_id,
    amountCents: Number(row.amount_cents) || 0,
    currency: row.currency,
    foreignAmountCents: Number(row.foreign_amount_cents) || 0,
    exchangeRate: Number(row.exchange_rate) || 1,
    paymentDate: row.payment_date,
    accountId: row.account_id,
    journalEntryId: row.journal_entry_id,
    reversedAt: row.reversed_at ?? null,
    reversalReason: row.reversal_reason ?? null,
    createdAt: row.created_at,
  };
}

function mapBill(row: any) {
  return {
    id: row.id,
    orgId: row.org_id,
    billNumber: row.bill_number,
    billNo: row.bill_number,
    vendorId: row.vendor_id,
    date: row.date,
    billDate: row.date,
    dueDate: row.due_date,
    subtotalCents: Number(row.subtotal_cents) || 0,
    taxCents: Number(row.tax_cents) || 0,
    totalCents: Number(row.total_cents) || 0,
    amountDueCents: Number(row.amount_due_cents) || 0,
    supplierReference: row.supplier_reference ?? null,
    purchaseOrderId: row.purchase_order_id ?? null,
    approvedAt: row.approved_at ?? null,
    approvedBy: row.approved_by ?? null,
    status: row.status,
    currency: row.currency,
    exchangeRate: row.exchange_rate == null ? null : Number(row.exchange_rate),
    foreignAmountCents: row.foreign_amount_cents == null ? null : Number(row.foreign_amount_cents),
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lines: (row.bill_lines || []).map(mapBillLine),
    payments: (row.bill_payments || []).map(mapBillPayment),
  };
}

async function assertBillRelations(orgId: string, vendorId: string, lines: BillLineInput[]) {
  const supabase = getSupabase();
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const [{ data: vendor, error: vendorError }, { data: accounts, error: accountsError }] = await Promise.all([
    supabase.from('vendors').select('id').eq('org_id', orgId).eq('id', vendorId).maybeSingle(),
    supabase.from('accounts').select('id, is_active').eq('org_id', orgId).in('id', accountIds),
  ]);

  if (vendorError) throw vendorError;
  if (!vendor) throw new UserError('The selected supplier does not belong to this organization.');
  if (accountsError) throw accountsError;

  const activeAccountIds = new Set((accounts || []).filter((account: any) => account.is_active !== false).map((account: any) => account.id));
  const missingAccount = accountIds.find((accountId) => !activeAccountIds.has(accountId));
  if (missingAccount) throw new UserError('One or more bill accounts do not belong to this organization or are inactive.');
}

async function assertPaymentAccount(orgId: string, accountId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('accounts')
    .select('id, type, is_active, is_bank_account')
    .eq('org_id', orgId)
    .eq('id', accountId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.is_active === false || data.type !== 'ASSET' || !data.is_bank_account) {
    throw new UserError('Bills are paid from an active bank, cash or M-Pesa account in this organization.');
  }
}

export class BillService {
  /** Every bill, newest first, or one supplier's when vendorId is given. */
  static async getBills(orgId: string, filter: { vendorId?: string } = {}) {
    const supabase = getSupabase();
    const data = await fetchAllRows<any>((from, to) => {
      let request = supabase
        .from('bills')
        .select('*, bill_lines(*), bill_payments(*)')
        .eq('org_id', orgId);
      if (filter.vendorId) request = request.eq('vendor_id', filter.vendorId);
      return request
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to);
    });

    return data.map(mapBill);
  }

  static async getBill(orgId: string, billId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bills')
      .select('*, bill_lines(*), bill_payments(*)')
      .eq('org_id', orgId)
      .eq('id', billId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('Bill not found in this organization.', 404);
    return mapBill(data);
  }

  static async createBill(input: BillInput): Promise<string> {
    await assertBillRelations(input.orgId, input.vendorId, input.lines);

    const currency = (input.currency || 'KES').trim().toUpperCase();
    const exchangeRate = input.exchangeRate && input.exchangeRate > 0 ? input.exchangeRate : 1;
    const lines = input.lines.map((line) => ({
      description: line.description.trim(),
      accountId: line.accountId,
      amountCents: Math.trunc(line.amountCents),
      foreignAmountCents: line.foreignAmountCents == null ? null : Math.trunc(line.foreignAmountCents),
      taxCents: Math.trunc(line.taxCents || 0),
      inventoryItemId: line.inventoryItemId || null,
      quantity: line.quantity ?? null,
    }));

    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('create_bill_with_journal', {
      p_org_id: input.orgId,
      p_vendor_id: input.vendorId,
      p_bill_date: input.billDate,
      p_due_date: input.dueDate,
      p_currency: currency,
      p_exchange_rate: exchangeRate,
      p_notes: input.notes?.trim() || null,
      p_created_by: input.createdBy,
      p_idempotency_key: input.idempotencyKey,
      p_lines: lines,
      p_supplier_reference: input.supplierReference?.trim() || null,
    });

    if (error) throw error;
    if (typeof data !== 'string') throw new Error('Bill creation did not return a bill ID.');
    return data;
  }

  static async recordPayment(orgId: string, billId: string, input: BillPaymentInput) {
    const supabase = getSupabase();
    const [billResult] = await Promise.all([
      supabase
        .from('bills')
        .select('id, status, amount_due_cents')
        .eq('org_id', orgId)
        .eq('id', billId)
        .maybeSingle(),
      assertPaymentAccount(orgId, input.sourceAccountId),
    ]);

    if (billResult.error) throw billResult.error;
    const bill = billResult.data;
    if (!bill) throw new UserError('Bill not found in this organization.', 404);
    if (bill.status === 'VOID') throw new UserError('A void bill cannot be paid.');
    if (input.amountCents > Number(bill.amount_due_cents)) throw new UserError('Payment cannot exceed the bill amount due.');

    const { data, error } = await supabase.rpc('pay_bill', {
      p_org_id: orgId,
      p_bill_id: billId,
      p_amount_cents: Math.trunc(input.amountCents),
      p_payment_date: input.paymentDate,
      p_source_account_id: input.sourceAccountId,
      p_idempotency_key: input.idempotencyKey,
      p_created_by: input.createdBy,
    });

    if (error) throw error;
    return data as {
      paymentId: string;
      journalEntryId: string;
      amountDueCents: number;
      status: string;
    };
  }

  /**
   * Pays several bills. The source account is checked once and each payment
   * goes straight to pay_bill, which re-checks the bill, so a payment costs
   * one Worker subrequest instead of three. One failure does not stop the
   * others; each is reported by its position.
   */
  static async recordBatchPayment(
    orgId: string,
    payments: BillBatchPaymentInput[],
    paidBy: string,
  ): Promise<{ paid: number; failed: number; errors: Array<{ index: number; message: string }> }> {
    const supabase = getSupabase();
    const sourceAccounts = [...new Set(payments.map((payment) => payment.sourceAccountId))];
    await Promise.all(sourceAccounts.map((accountId) => assertPaymentAccount(orgId, accountId)));

    let paid = 0;
    const errors: Array<{ index: number; message: string }> = [];

    for (const [index, payment] of payments.entries()) {
      const { error } = await supabase.rpc('pay_bill', {
        p_org_id: orgId,
        p_bill_id: payment.billId,
        p_amount_cents: Math.trunc(payment.amountCents),
        p_payment_date: payment.paymentDate,
        p_source_account_id: payment.sourceAccountId,
        p_idempotency_key: payment.idempotencyKey,
        p_created_by: paidBy,
      });
      if (error) {
        errors.push({ index, message: publicMessage(error) });
      } else {
        paid += 1;
      }
    }

    return { paid, failed: errors.length, errors };
  }

  static async voidBill(orgId: string, billId: string, voidedBy: string, voidDate?: string) {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('void_bill_with_reversal', {
      p_org_id: orgId,
      p_bill_id: billId,
      p_void_date: voidDate || await organizationToday(orgId),
      p_created_by: voidedBy,
    });
    if (error) throw error;
  }

  /** An owner or administrator other than the person who entered the bill approves it for payment. */
  static async approveBill(orgId: string, billId: string, actor: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('approve_bill', { p_org_id: orgId, p_bill_id: billId, p_actor: actor });
    if (error) throw error;
    return data as { billNumber: string; approvedAt: string };
  }

  static async reversePayment(orgId: string, billId: string, paymentId: string, reversalDate: string, reason: string, actor: string) {
    const supabase = getSupabase();
    const { data: payment, error: paymentError } = await supabase
      .from('bill_payments')
      .select('id')
      .eq('org_id', orgId)
      .eq('bill_id', billId)
      .eq('id', paymentId)
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) throw new UserError('That payment is not on this bill.', 404);
    const { data, error } = await supabase.rpc('reverse_bill_payment', {
      p_org_id: orgId,
      p_payment_id: paymentId,
      p_reversal_date: reversalDate,
      p_reason: reason,
      p_actor: actor,
    });
    if (error) throw error;
    return data as { reversalJournalEntryId: string; amountDueCents: number; status: string };
  }

  static async updateBill(orgId: string, id: string, input: { dueDate?: string; notes?: string; supplierReference?: string; status?: never }) {
    const supabase = getSupabase();
    if ((input as any).status !== undefined) {
      throw new UserError('Bill status must be changed through a dedicated payment or void workflow.');
    }
    if (input.dueDate !== undefined) {
      const { data: current, error: currentError } = await supabase
        .from('bills')
        .select('status')
        .eq('org_id', orgId)
        .eq('id', id)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) throw new UserError('Bill not found in this organization.', 404);
      if (current.status === 'VOID' || current.status === 'PAID') {
        throw new UserError(`A ${current.status === 'VOID' ? 'void' : 'paid'} bill's due date no longer changes.`);
      }
    }

    const updateData: Record<string, unknown> = {};
    if (input.dueDate !== undefined) updateData.due_date = input.dueDate;
    if (input.notes !== undefined) updateData.notes = input.notes.trim() || null;
    if (input.supplierReference !== undefined) updateData.supplier_reference = input.supplierReference.trim() || null;

    if (Object.keys(updateData).length > 0) {
      const { data, error } = await supabase
        .from('bills')
        .update(updateData)
        .eq('id', id)
        .eq('org_id', orgId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new UserError('Bill not found in this organization.', 404);
    }
  }
}
