import { getSupabase } from './supabase';

export interface BillLineInput {
  description: string;
  accountId: string;
  amountCents: number;
  foreignAmountCents?: number;
  taxCents?: number;
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
  if (!vendor) throw new Error('The selected vendor does not belong to this organization.');
  if (accountsError) throw accountsError;

  const activeAccountIds = new Set((accounts || []).filter((account: any) => account.is_active !== false).map((account: any) => account.id));
  const missingAccount = accountIds.find((accountId) => !activeAccountIds.has(accountId));
  if (missingAccount) throw new Error('One or more bill accounts do not belong to this organization or are inactive.');
}

async function assertPaymentAccount(orgId: string, accountId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('accounts')
    .select('id, type, is_active')
    .eq('org_id', orgId)
    .eq('id', accountId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.is_active === false || data.type !== 'ASSET') {
    throw new Error('The payment account must be an active asset account in this organization.');
  }
}

export class BillService {
  static async getBills(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bills')
      .select('*, bill_lines(*), bill_payments(*)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(mapBill);
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
    if (!bill) throw new Error('Bill not found in this organization.');
    if (bill.status === 'VOID') throw new Error('A void bill cannot be paid.');
    if (input.amountCents > Number(bill.amount_due_cents)) throw new Error('Payment cannot exceed the bill amount due.');

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

  static async recordBatchPayment(
    orgId: string,
    payments: BillBatchPaymentInput[],
    paidBy: string,
  ): Promise<{ paid: number; failed: number; errors: Array<{ index: number; message: string }> }> {
    let paid = 0;
    const errors: Array<{ index: number; message: string }> = [];

    for (const [index, payment] of payments.entries()) {
      try {
        const { billId, ...paymentInput } = payment;
        await this.recordPayment(orgId, billId, { ...paymentInput, createdBy: paidBy });
        paid += 1;
      } catch (err) {
        errors.push({ index, message: err instanceof Error ? err.message : 'Payment failed.' });
      }
    }

    return { paid, failed: errors.length, errors };
  }

  static async voidBill(orgId: string, billId: string, voidedBy: string) {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('void_bill_with_reversal', {
      p_org_id: orgId,
      p_bill_id: billId,
      p_void_date: new Date().toISOString().slice(0, 10),
      p_created_by: voidedBy,
    });
    if (error) throw error;
  }

  static async updateBill(orgId: string, id: string, input: { dueDate?: string; notes?: string; status?: never }) {
    const supabase = getSupabase();
    if ((input as any).status !== undefined) {
      throw new Error('Bill status must be changed through a dedicated payment or void workflow.');
    }

    const updateData: Record<string, unknown> = {};
    if (input.dueDate !== undefined) updateData.due_date = input.dueDate;
    if (input.notes !== undefined) updateData.notes = input.notes.trim() || null;

    if (Object.keys(updateData).length > 0) {
      const { data, error } = await supabase
        .from('bills')
        .update(updateData)
        .eq('id', id)
        .eq('org_id', orgId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Bill not found in this organization.');
    }
  }
}
