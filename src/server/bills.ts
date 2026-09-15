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
  notes?: string;
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
      billDate: row.date,
      dueDate: row.due_date,
      subtotalCents: row.subtotal_cents,
      taxCents: row.tax_cents,
      totalCents: row.total_cents,
      amountDueCents: row.amount_due_cents,
      status: row.status,
      currency: row.currency,
      exchangeRate: row.exchange_rate,
      foreignAmountCents: row.foreign_amount_cents,
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

    const { data: counterData, error: counterError } = await supabase.rpc('increment_and_get', { p_org_id: input.orgId, p_doc_type: 'BILL' });
    if (counterError) throw counterError;
    const billNo = `BILL-${new Date(input.billDate).getFullYear()}-${String(counterData).padStart(4, '0')}`;

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
        notes: input.notes || null,
        created_by: input.createdBy || null
      })
      .select('id')
      .single();
      
    if (billError) throw billError;
    const billRefId = bill.id;

    // 5. Post to Ledger Core (Asserts double-entry integrity)
    try {
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
    } catch (error) {
      const { error: cleanupError } = await supabase
        .from('bills')
        .delete()
        .eq('id', billRefId)
        .eq('org_id', input.orgId);

      if (cleanupError) {
        console.error('Failed to remove bill after ledger posting failed:', cleanupError);
      }
      throw error;
    }

    return billRefId;
  }

  static async voidBill(orgId: string, billId: string, voidedBy: string) {
    const supabase = getSupabase();
    
    // Get bill to void
    const { data: bill, error: billError } = await supabase
      .from('bills')
      .select('*')
      .eq('id', billId)
      .eq('org_id', orgId)
      .single();
      
    if (billError || !bill) {
      throw new Error('Bill not found or already voided');
    }
    
    if (bill.status === 'VOID') {
      return; // Already voided
    }

    // Reverse the journal entries FIRST. Only flip the bill's status once
    // the reversing entry has actually posted, so a failed reversal never
    // leaves the bill marked VOID with the original ledger entry still live.
    const journalEntries = await LedgerService.getJournalEntries(orgId);
    const originalEntry = journalEntries.find(je => je.sourceType === 'BILL' && je.sourceId === billId);

    if (originalEntry) {
      const reversingLines = originalEntry.lines.map(line => ({
        accountId: line.accountId,
        debit: line.credit,
        credit: line.debit,
        description: `VOID: ${line.description || ''}`,
        entityType: line.entityType,
        entityId: line.entityId
      }));

      await LedgerService.postJournalEntry({
        orgId: orgId,
        entryDate: new Date().toISOString().split('T')[0],
        memo: `Void Bill ${bill.bill_number}`,
        sourceType: 'BILL',
        sourceId: billId,
        referenceNo: `VOID-${bill.bill_number}`,
        createdBy: voidedBy,
        lines: reversingLines
      });
    }

    // Update bill status only after the reversal succeeded (or there was no
    // original entry to reverse).
    const { error: updateError } = await supabase
      .from('bills')
      .update({ status: 'VOID' })
      .eq('id', billId);

    if (updateError) throw updateError;
  }

  /**
   * Records a real cash payment against an open bill: posts a Debit A/P
   * (2000) / Credit Cash (1000) journal entry, then marks the bill PAID.
   * Previously "batch bill payment" only flipped the status label via the
   * generic bulk-status-update endpoint with no corresponding ledger entry.
   */
  static async recordPayment(orgId: string, billId: string, paymentDate: string, paidBy: string): Promise<void> {
    const supabase = getSupabase();

    const { data: bill, error: billError } = await supabase
      .from('bills')
      .select('*')
      .eq('id', billId)
      .eq('org_id', orgId)
      .single();

    if (billError || !bill) throw new Error('Bill not found.');
    if (bill.status === 'PAID') return;
    if (bill.status === 'VOID') throw new Error('Cannot pay a voided bill.');
    if (!bill.amount_due_cents || bill.amount_due_cents <= 0) throw new Error('Bill has no amount due.');

    const apAccount = await AccountService.getAccountByCode(orgId, '2000');
    const cashAccount = await AccountService.getAccountByCode(orgId, '1000');
    if (!apAccount || !cashAccount) {
      throw new Error('A/P (2000) or Cash (1000) account not found. Seed the chart of accounts.');
    }

    await LedgerService.postJournalEntry({
      orgId,
      entryDate: paymentDate,
      memo: `Payment for Bill ${bill.bill_number}`,
      sourceType: 'PAYMENT',
      sourceId: billId,
      referenceNo: `PAY-${bill.bill_number}`,
      createdBy: paidBy,
      lines: [
        { accountId: apAccount.id, debit: bill.amount_due_cents, credit: 0, description: `Settle Bill ${bill.bill_number}` },
        { accountId: cashAccount.id, debit: 0, credit: bill.amount_due_cents, description: `Cash paid for Bill ${bill.bill_number}` }
      ]
    });

    const { error: updateError } = await supabase
      .from('bills')
      .update({ status: 'PAID', amount_due_cents: 0 })
      .eq('id', billId)
      .eq('org_id', orgId);

    if (updateError) throw updateError;
  }

  static async recordBatchPayment(orgId: string, billIds: string[], paymentDate: string, paidBy: string): Promise<{ paid: number; failed: number }> {
    let paid = 0;
    let failed = 0;
    for (const billId of billIds) {
      try {
        await this.recordPayment(orgId, billId, paymentDate, paidBy);
        paid++;
      } catch (err) {
        failed++;
      }
    }
    return { paid, failed };
  }

  static async updateBill(orgId: string, id: string, input: any) {
    const supabase = getSupabase();

    if (input.status !== undefined) {
      throw new Error('Bill status must be changed through a dedicated payment or void workflow.');
    }
    
    // Only allow metadata updates
    const updateData: any = {};
    if (input.dueDate !== undefined) updateData.due_date = input.dueDate;
    if (input.notes !== undefined) updateData.notes = input.notes;
    
    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase
        .from('bills')
        .update(updateData)
        .eq('id', id)
        .eq('org_id', orgId);
        
      if (error) throw error;
    }
  }
}
