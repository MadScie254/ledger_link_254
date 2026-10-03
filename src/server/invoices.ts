import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { EtimsService } from './etims';
import { UserError } from './errors';
import { organizationToday } from './organizationDates';

export interface InvoiceLineInput {
  description: string;
  accountId: string;
  amountCents: number;
  foreignAmountCents?: number;
  taxCents?: number;
}

export interface InvoiceInput {
  orgId: string;
  customerId: string;
  customerName?: string;
  issueDate: string;
  dueDate: string;
  currency?: string;
  exchangeRate?: number;
  notes?: string;
  lines: InvoiceLineInput[];
  idempotencyKey: string;
  createdBy: string;
}

export interface InvoicePaymentInput {
  amountCents: number;
  paymentDate: string;
  depositAccountId: string;
  idempotencyKey: string;
  createdBy: string;
}

function mapInvoiceLine(row: any) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    description: row.description,
    accountId: row.account_id,
    amountCents: Number(row.amount_cents) || 0,
    foreignAmountCents: row.foreign_amount_cents == null ? null : Number(row.foreign_amount_cents),
    taxCents: Number(row.tax_cents) || 0,
    foreignTaxCents: Number(row.foreign_tax_cents) || 0,
    createdAt: row.created_at,
  };
}

function mapInvoicePayment(row: any) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
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

function mapInvoice(row: any) {
  return {
    id: row.id,
    orgId: row.org_id,
    invoiceNumber: row.invoice_number,
    invoiceNo: row.invoice_number,
    customerId: row.customer_id,
    date: row.date,
    issueDate: row.date,
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
    lines: (row.invoice_lines || []).map(mapInvoiceLine),
    payments: (row.invoice_payments || []).map(mapInvoicePayment),
  };
}

async function assertInvoiceRelations(orgId: string, customerId: string, lines: InvoiceLineInput[]) {
  const supabase = getSupabase();
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const [{ data: customer, error: customerError }, { data: accounts, error: accountsError }] = await Promise.all([
    supabase.from('customers').select('id').eq('org_id', orgId).eq('id', customerId).maybeSingle(),
    supabase.from('accounts').select('id, is_active').eq('org_id', orgId).in('id', accountIds),
  ]);

  if (customerError) throw customerError;
  if (!customer) throw new UserError('The selected customer does not belong to this organization.');
  if (accountsError) throw accountsError;

  const activeAccountIds = new Set((accounts || []).filter((account: any) => account.is_active !== false).map((account: any) => account.id));
  const missingAccount = accountIds.find((accountId) => !activeAccountIds.has(accountId));
  if (missingAccount) throw new UserError('One or more invoice accounts do not belong to this organization or are inactive.');
}

async function assertDepositAccount(orgId: string, accountId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('accounts')
    .select('id, type, is_active, is_bank_account')
    .eq('org_id', orgId)
    .eq('id', accountId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.is_active === false || data.type !== 'ASSET' || !data.is_bank_account) {
    throw new UserError('Payments are deposited to an active bank, cash or M-Pesa account in this organization.');
  }
}

export class InvoiceService {
  static async getInvoices(orgId: string) {
    const supabase = getSupabase();
    const data = await fetchAllRows<any>((from, to) => supabase
      .from('invoices')
      .select('*, invoice_lines(*), invoice_payments(*)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to));

    return data.map(mapInvoice);
  }

  static async getInvoice(orgId: string, invoiceId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('invoices')
      .select('*, invoice_lines(*), invoice_payments(*)')
      .eq('org_id', orgId)
      .eq('id', invoiceId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('Invoice not found in this organization.', 404);
    return mapInvoice(data);
  }

  static async createInvoice(input: InvoiceInput): Promise<string> {
    await assertInvoiceRelations(input.orgId, input.customerId, input.lines);

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
    const { data, error } = await supabase.rpc('create_invoice_with_journal', {
      p_org_id: input.orgId,
      p_customer_id: input.customerId,
      p_issue_date: input.issueDate,
      p_due_date: input.dueDate,
      p_currency: currency,
      p_exchange_rate: exchangeRate,
      p_notes: input.notes?.trim() || null,
      p_created_by: input.createdBy,
      p_idempotency_key: input.idempotencyKey,
      p_lines: lines,
    });

    if (error) throw error;
    if (typeof data !== 'string') throw new Error('Invoice creation did not return an invoice ID.');

    // eTIMS remains a separately queued integration; failure must not unwind a
    // successfully committed financial transaction.
    try {
      await EtimsService.submitInvoice(input.orgId, data, { currency, exchangeRate, lines });
    } catch (err) {
      console.warn('eTIMS submission could not be queued:', err);
    }

    return data;
  }

  static async receivePayment(orgId: string, invoiceId: string, input: InvoicePaymentInput) {
    const supabase = getSupabase();
    const [invoiceResult] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, status, amount_due_cents')
        .eq('org_id', orgId)
        .eq('id', invoiceId)
        .maybeSingle(),
      assertDepositAccount(orgId, input.depositAccountId),
    ]);

    if (invoiceResult.error) throw invoiceResult.error;
    const invoice = invoiceResult.data;
    if (!invoice) throw new UserError('Invoice not found in this organization.', 404);
    if (invoice.status === 'VOID') throw new UserError('A void invoice cannot receive a payment.');
    if (input.amountCents > Number(invoice.amount_due_cents)) throw new UserError('Payment cannot exceed the invoice amount due.');

    const { data, error } = await supabase.rpc('receive_invoice_payment', {
      p_org_id: orgId,
      p_invoice_id: invoiceId,
      p_amount_cents: Math.trunc(input.amountCents),
      p_payment_date: input.paymentDate,
      p_deposit_account_id: input.depositAccountId,
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

  static async voidInvoice(orgId: string, invoiceId: string, voidedBy: string, voidDate?: string) {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('void_invoice_with_reversal', {
      p_org_id: orgId,
      p_invoice_id: invoiceId,
      p_void_date: voidDate || await organizationToday(orgId),
      p_created_by: voidedBy,
    });
    if (error) throw error;
  }

  /**
   * Reverses one payment: a reversing entry is posted, the invoice's amount
   * due is restored and a statement line matched to the payment is opened
   * again (public.reverse_invoice_payment).
   */
  static async reversePayment(orgId: string, invoiceId: string, paymentId: string, reversalDate: string, reason: string, actor: string) {
    const supabase = getSupabase();
    const { data: payment, error: paymentError } = await supabase
      .from('invoice_payments')
      .select('id')
      .eq('org_id', orgId)
      .eq('invoice_id', invoiceId)
      .eq('id', paymentId)
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) throw new UserError('That payment is not on this invoice.', 404);
    const { data, error } = await supabase.rpc('reverse_invoice_payment', {
      p_org_id: orgId,
      p_payment_id: paymentId,
      p_reversal_date: reversalDate,
      p_reason: reason,
      p_actor: actor,
    });
    if (error) throw error;
    return data as { reversalJournalEntryId: string; amountDueCents: number; status: string };
  }

  static async updateInvoice(orgId: string, id: string, input: { dueDate?: string; notes?: string; status?: never }) {
    const supabase = getSupabase();
    if ((input as any).status !== undefined) {
      throw new UserError('Invoice status must be changed through a dedicated payment or void workflow.');
    }
    if (input.dueDate !== undefined) {
      const { data: current, error: currentError } = await supabase
        .from('invoices')
        .select('status')
        .eq('org_id', orgId)
        .eq('id', id)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) throw new UserError('Invoice not found in this organization.', 404);
      if (current.status === 'VOID' || current.status === 'PAID') {
        throw new UserError(`A ${current.status === 'VOID' ? 'void' : 'paid'} invoice's due date no longer changes.`);
      }
    }

    const updateData: Record<string, unknown> = {};
    if (input.dueDate !== undefined) updateData.due_date = input.dueDate;
    if (input.notes !== undefined) updateData.notes = input.notes.trim() || null;

    if (Object.keys(updateData).length > 0) {
      const { data, error } = await supabase
        .from('invoices')
        .update(updateData)
        .eq('id', id)
        .eq('org_id', orgId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new UserError('Invoice not found in this organization.', 404);
    }
  }
}
