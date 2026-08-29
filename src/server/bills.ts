import { getSupabase } from './supabase';
import { LedgerService } from './ledger';
import { AccountService } from './accounts';

export interface BillInput {
  orgId: string;
  vendorId: string;
  vendorName?: string;
  billDate: string;
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

export class BillService {
  static async getBills(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bills')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      orgId: row.org_id,
      billNumber: row.bill_number,
      vendorId: row.vendor_id,
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

  static async createBill(input: BillInput) {
    const supabase = getSupabase();
    const currency = (input.currency || 'KES').toUpperCase();
    const exchangeRate = input.exchangeRate && input.exchangeRate > 0 ? input.exchangeRate : 1;
    
    // 1. Find Accounts Payable account (Code 2000)
    const apAccount = await AccountService.getAccountByCode(input.orgId, '2000');
    if (!apAccount) {
      throw new Error('A/P account (2000) not found. Please import the standard chart of accounts.');
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

    // 3. Prepare Ledger Lines (Credit A/P in base currency equivalent, Debit Expense/COGS)
    const journalLines = [
      {
        accountId: apAccount.id,
        debit: 0,
        credit: totalCents,
        description: currency !== 'KES' ? `Bill A/P (${currency} ${(totalForeignCents / 100).toFixed(2)} @ ${exchangeRate})` : undefined,
        entityType: 'VENDOR' as const,
        entityId: input.vendorId,
      }
    ];

    for (const line of input.lines) {
      const lineAmountCents = line.amountCents || Math.round((line.foreignAmountCents || 0) / exchangeRate);
      journalLines.push({
        accountId: line.accountId,
        debit: lineAmountCents,
        credit: 0,
        description: line.description,
        entityType: 'VENDOR' as const,
        entityId: input.vendorId,
      });
    }

    const billNo = `BILL-${Math.floor(1000 + Math.random() * 9000)}`;

    // 4. Save Bill Record (we save it first to get the ID for the ledger)
    const { data: bill, error: billError } = await supabase
      .from('bills')
      .insert({
        org_id: input.orgId,
        vendor_id: input.vendorId,
        bill_number: billNo,
        date: input.billDate,
        due_date: input.dueDate,
        subtotal_cents: totalCents,
        tax_cents: 0,
        total_cents: totalCents,
        amount_due_cents: totalCents,
        status: 'OPEN',
        currency: currency,
        notes: null,
        created_by: input.createdBy || null
      })
      .select('id')
      .single();
      
    if (billError) throw billError;
    const billRefId = bill.id;

    // 5. Post to Ledger Core (Asserts double-entry integrity)
    await LedgerService.postJournalEntry({
      orgId: input.orgId,
      entryDate: input.billDate,
      memo: `Bill ${billNo}${currency !== 'KES' ? ` [${currency}]` : ''}`,
      sourceType: 'BILL',
      sourceId: billRefId,
      referenceNo: billNo,
      createdBy: input.createdBy,
      lines: journalLines
    });

    return billRefId;
  }
}
