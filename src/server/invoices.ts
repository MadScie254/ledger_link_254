import { getSupabase } from './supabase';
import { LedgerService } from './ledger';
import { AccountService } from './accounts';
import { EtimsService } from './etims';

export interface InvoiceInput {
  orgId: string;
  customerId: string;
  customerName?: string;
  issueDate: string;
  dueDate: string;
  currency?: string;
  exchangeRate?: number;
  foreignAmountCents?: number;
  lines: {
    description: string;
    accountId: string;
    amountCents: number;
    foreignAmountCents?: number;
  }[];
  createdBy: string;
}

export class InvoiceService {
  static async getInvoices(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      orgId: row.org_id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      date: row.date,
      dueDate: row.due_date,
      subtotalCents: row.subtotal_cents,
      taxCents: row.tax_cents,
      totalCents: row.total_cents,
      amountDueCents: row.amount_due_cents,
      status: row.status,
      currency: row.currency,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at
    }));
  }

  static async createInvoice(input: InvoiceInput) {
    const supabase = getSupabase();
    const currency = (input.currency || 'KES').toUpperCase();
    const exchangeRate = input.exchangeRate && input.exchangeRate > 0 ? input.exchangeRate : 1;
    
    // 1. Find Accounts Receivable account (Code 1100)
    const arAccount = await AccountService.getAccountByCode(input.orgId, '1100');
    if (!arAccount) {
      throw new Error('A/R account (1100) not found. Please seed the chart of accounts.');
    }

    // 2. Calculate Total in foreign and base currency
    let totalCents = 0;
    let totalForeignCents = 0;
    for (const line of input.lines) {
      const lineForeign = line.foreignAmountCents || line.amountCents;
      totalForeignCents += lineForeign;
      totalCents += line.amountCents;
    }

    if (totalCents === 0 && totalForeignCents > 0) {
      totalCents = Math.round(totalForeignCents / exchangeRate);
    }

    // 3. Prepare Ledger Lines (Base currency equivalent posted to ledger core)
    const journalLines = [
      {
        accountId: arAccount.id,
        debit: totalCents,
        credit: 0,
        description: currency !== 'KES' ? `Invoice A/R (${currency} ${(totalForeignCents / 100).toFixed(2)} @ ${exchangeRate})` : undefined,
        entityType: 'CUSTOMER' as const,
        entityId: input.customerId,
      }
    ];

    for (const line of input.lines) {
      const lineAmountCents = line.amountCents || Math.round((line.foreignAmountCents || 0) / exchangeRate);
      journalLines.push({
        accountId: line.accountId,
        debit: 0,
        credit: lineAmountCents,
        description: line.description,
        entityType: 'CUSTOMER' as const,
        entityId: input.customerId,
      });
    }

    const invoiceNo = `INV-${Math.floor(1000 + Math.random() * 9000)}`;

    // 4. Save Invoice Record first to get the ID
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        org_id: input.orgId,
        invoice_number: invoiceNo,
        customer_id: input.customerId,
        date: input.issueDate,
        due_date: input.dueDate,
        subtotal_cents: totalCents,
        tax_cents: 0,
        total_cents: totalCents,
        amount_due_cents: totalCents,
        status: 'SENT',
        currency: currency,
        notes: null,
        created_by: input.createdBy || null
      })
      .select('id')
      .single();

    if (invoiceError) throw invoiceError;
    const invoiceRefId = invoice.id;

    // 5. Post to Ledger Core (This asserts double-entry integrity)
    await LedgerService.postJournalEntry({
      orgId: input.orgId,
      entryDate: input.issueDate,
      memo: `Invoice ${invoiceNo}${currency !== 'KES' ? ` [${currency}]` : ''}`,
      sourceType: 'INVOICE',
      sourceId: invoiceRefId,
      referenceNo: invoiceNo,
      createdBy: input.createdBy,
      lines: journalLines
    });

    // 6. Submit to KRA eTIMS (Mock)
    let etimsData = null;
    try {
      etimsData = await EtimsService.submitInvoice(input.orgId, invoiceRefId, {
        invoiceNo,
        totalCents,
        lines: input.lines
      });
    } catch (err: any) {
      console.warn('eTIMS Submission Failed (Continuing with Invoice creation):', err.message);
    }

    // If eTIMS succeeded, we could update the invoice record here with etims status, 
    // but the original code was keeping this simple. Let's just return.

    return invoiceRefId;
  }
}
