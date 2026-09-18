import { getSupabase } from './supabase';
import { LedgerService } from './ledger';
import { AccountService } from './accounts';
import { InvoiceService } from './invoices';
import { BillService } from './bills';

export interface AIMatchCandidate {
  transactionId: string;
  transaction: any;
  confidence: number; // 0 - 100
  matchType: 'INVOICE' | 'BILL' | 'ACCOUNT' | 'PAYROLL';
  entityId?: string;
  entityName: string;
  entityReference?: string;
  reason: string;
  suggestedAccountCode: string;
  suggestedAccountName: string;
}

export class BankingService {
  static async getTransactions(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bank_transactions')
      .select('*')
      .eq('org_id', orgId)
      .order('date', { ascending: false });
      
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      orgId: row.org_id,
      date: row.date,
      description: row.description,
      amountCents: row.amount_cents,
      direction: row.direction,
      status: row.status,
      aiCategoryCode: row.ai_category_code,
      aiCategoryName: row.ai_category_name,
      createdAt: row.created_at
    }));
  }

  static async syncTransactions(orgId: string) {
    // Bank integration (e.g. Daraja API or OFX upload) is not yet implemented.
    return { count: 0, message: "Bank sync isn't connected yet" };
  }

  static async getRules(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bank_rules')
      .select('id, match_text, target_account_id, accounts!inner(code, name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      matchText: row.match_text,
      targetAccountId: row.target_account_id,
      targetAccountCode: row.accounts?.code,
      targetAccountName: row.accounts?.name
    }));
  }

  static async createRule(orgId: string, matchText: string, targetAccountId: string, createdBy?: string): Promise<string> {
    const supabase = getSupabase();
    if (!matchText?.trim()) throw new Error('Match text is required.');
    if (!targetAccountId) throw new Error('A target account is required.');

    const { data: targetAccount, error: accountError } = await supabase
      .from('accounts')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', targetAccountId)
      .eq('is_active', true)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!targetAccount) throw new Error('The target account is inactive or belongs to another organization.');

    const { data, error } = await supabase
      .from('bank_rules')
      .insert({ org_id: orgId, match_text: matchText.trim(), target_account_id: targetAccountId, created_by: createdBy || null })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  static async deleteRule(orgId: string, id: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase.from('bank_rules').delete().eq('id', id).eq('org_id', orgId);
    if (error) throw error;
  }

  static async requestBankConnection(orgId: string, input: { institutionName: string; contactEmail?: string; notes?: string }, requestedBy?: string): Promise<string> {
    const supabase = getSupabase();
    if (!input.institutionName?.trim()) throw new Error('Institution name is required.');

    const { data, error } = await supabase
      .from('bank_connection_requests')
      .insert({
        org_id: orgId,
        institution_name: input.institutionName.trim(),
        contact_email: input.contactEmail || null,
        notes: input.notes || null,
        requested_by: requestedBy || null
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  static async getConnectionRequests(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('bank_connection_requests')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      institutionName: row.institution_name,
      contactEmail: row.contact_email,
      notes: row.notes,
      status: row.status,
      createdAt: row.created_at
    }));
  }

  static async getReconciliationSummary(orgId: string) {
    const transactions = await this.getTransactions(orgId);
    const statementBalanceCents = transactions.reduce(
      (sum, tx: any) => sum + (tx.direction === 'IN' ? tx.amountCents : -tx.amountCents),
      0
    );

    const bankAccount = await AccountService.getAccountByCode(orgId, '1000');
    let glBalanceCents = 0;
    if (bankAccount) {
      const balances = await AccountService.getAccountBalances(orgId);
      glBalanceCents = balances.get(bankAccount.id) || 0;
    }

    return {
      statementBalanceCents,
      glBalanceCents,
      varianceCents: statementBalanceCents - glBalanceCents,
      transactionCount: transactions.length
    };
  }

  static async getAIMatches(orgId: string): Promise<AIMatchCandidate[]> {
    const transactions = await this.getTransactions(orgId);
    const unreviewed = transactions.filter((t: any) => t.status !== 'MATCHED');
    const rules = await this.getRules(orgId);

    let invoices: any[] = [];
    let bills: any[] = [];
    try {
      invoices = await InvoiceService.getInvoices(orgId);
    } catch (e) {}
    try {
      bills = await BillService.getBills(orgId);
    } catch (e) {}

    const candidates: AIMatchCandidate[] = [];

    for (const tx of unreviewed as any[]) {
      const desc = (tx.description || '').toUpperCase();
      const amount = tx.amountCents;
      const isIncoming = tx.direction === 'IN';

      let bestMatch: AIMatchCandidate | null = null;

      const matchedRule = rules.find(r => desc.includes(r.matchText.toUpperCase()));
      if (matchedRule) {
        bestMatch = {
          transactionId: tx.id,
          transaction: tx,
          confidence: 99,
          matchType: 'ACCOUNT',
          entityName: matchedRule.targetAccountName,
          reason: `Matched your rule: contains "${matchedRule.matchText}"`,
          suggestedAccountCode: matchedRule.targetAccountCode,
          suggestedAccountName: matchedRule.targetAccountName
        };
      } else if (isIncoming) {
        // Try matching open invoices
        const matchedInv = invoices.find(inv => {
          const invTotal = (inv.totalAmount || inv.totalCents || 0);
          const numMatch = inv.invoiceNumber && desc.includes(inv.invoiceNumber.toUpperCase());
          const customerMatch = inv.customerName && desc.includes(inv.customerName.toUpperCase());
          return (invTotal === amount || (invTotal > 0 && Math.abs(invTotal - amount) < 100)) || numMatch || customerMatch;
        });

        if (matchedInv) {
          const isExactAmount = (matchedInv.totalAmount || matchedInv.totalCents) === amount;
          bestMatch = {
            transactionId: tx.id,
            transaction: tx,
            confidence: isExactAmount ? 98 : 88,
            matchType: 'INVOICE',
            entityId: matchedInv.id,
            entityName: matchedInv.customerName || 'Customer Invoice',
            entityReference: matchedInv.invoiceNumber || `INV-${matchedInv.id.slice(0, 6)}`,
            reason: `Exact match for open ${matchedInv.invoiceNumber || 'invoice'} from ${matchedInv.customerName || 'client'}`,
            suggestedAccountCode: '1100',
            suggestedAccountName: 'Accounts Receivable (A/R)'
          };
        } else if (desc.includes('M-PESA') || desc.includes('PAYBILL') || desc.includes('TILL')) {
          bestMatch = {
            transactionId: tx.id,
            transaction: tx,
            confidence: 94,
            matchType: 'ACCOUNT',
            entityName: 'Direct Point of Sale (POS)',
            reason: 'High-confidence retail revenue pattern from M-Pesa Merchant settlement',
            suggestedAccountCode: '4000',
            suggestedAccountName: 'Sales Revenue'
          };
        } else {
          bestMatch = {
            transactionId: tx.id,
            transaction: tx,
            confidence: 76,
            matchType: 'ACCOUNT',
            entityName: 'Customer Transfer / Sales',
            reason: 'Categorized based on incoming funds inflow pattern',
            suggestedAccountCode: '4000',
            suggestedAccountName: 'Sales Revenue'
          };
        }
      } else {
        // Outgoing: match bills or standard operational accounts
        const matchedBill = bills.find(b => {
          const billTotal = (b.totalCents || b.totalAmount || 0);
          const numMatch = b.billNumber && desc.includes(b.billNumber.toUpperCase());
          const vendorMatch = b.vendorName && desc.includes(b.vendorName.toUpperCase());
          return (billTotal === amount || (billTotal > 0 && Math.abs(billTotal - amount) < 100)) || numMatch || vendorMatch;
        });

        if (matchedBill) {
          bestMatch = {
            transactionId: tx.id,
            transaction: tx,
            confidence: 97,
            matchType: 'BILL',
            entityId: matchedBill.id,
            entityName: matchedBill.vendorName || 'Vendor Bill',
            entityReference: matchedBill.billNumber || `BILL-${matchedBill.id.slice(0, 6)}`,
            reason: `Direct settlement match for open bill ${matchedBill.billNumber || ''} (${matchedBill.vendorName || ''})`,
            suggestedAccountCode: '2000',
            suggestedAccountName: 'Accounts Payable (A/P)'
          };
        } else if (desc.includes('SAFARICOM') || desc.includes('FIBER') || desc.includes('INTERNET')) {
          bestMatch = {
            transactionId: tx.id,
            transaction: tx,
            confidence: 92,
            matchType: 'ACCOUNT',
            entityName: 'Safaricom Telecommunications',
            reason: 'Recurring telecommunications & fiber internet expense pattern',
            suggestedAccountCode: '6200',
            suggestedAccountName: 'Utilities & Internet Expense'
          };
        } else if (desc.includes('SHELL') || desc.includes('TOTAL') || desc.includes('PETROL') || desc.includes('FUEL')) {
          bestMatch = {
            transactionId: tx.id,
            transaction: tx,
            confidence: 95,
            matchType: 'ACCOUNT',
            entityName: 'Vehicle & Logistics Fuel',
            reason: 'Fuel and transport operating expense pattern detected',
            suggestedAccountCode: '6000',
            suggestedAccountName: 'Operating Expenses'
          };
        } else if (desc.includes('KRA') || desc.includes('E-TIMS') || desc.includes('VAT') || desc.includes('TAX')) {
          bestMatch = {
            transactionId: tx.id,
            transaction: tx,
            confidence: 96,
            matchType: 'ACCOUNT',
            entityName: 'Kenya Revenue Authority',
            reason: 'Statutory VAT / eTIMS settlement to government revenue collector',
            suggestedAccountCode: '2100',
            suggestedAccountName: 'VAT & Statutory Payables'
          };
        } else if (desc.includes('PAYROLL') || desc.includes('SALARY') || desc.includes('STAFF')) {
          bestMatch = {
            transactionId: tx.id,
            transaction: tx,
            confidence: 93,
            matchType: 'PAYROLL',
            entityName: 'Employee Payroll Disbursement',
            reason: 'Staff payroll disbursement matching monthly compensation ledger',
            suggestedAccountCode: '6000',
            suggestedAccountName: 'Salaries & Staff Expenses'
          };
        } else {
          bestMatch = {
            transactionId: tx.id,
            transaction: tx,
            confidence: 72,
            matchType: 'ACCOUNT',
            entityName: 'Operating Disbursement',
            reason: 'General business operational expenditure',
            suggestedAccountCode: '6000',
            suggestedAccountName: 'Operating Expenses'
          };
        }
      }

      if (bestMatch) {
        candidates.push(bestMatch);
      }
    }

    // Sort by confidence descending
    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  static async autoReconcileAll(orgId: string, minConfidence: number = 85, userId: string) {
    const matches = await this.getAIMatches(orgId);
    const qualifying = matches.filter(m => m.confidence >= minConfidence);

    let reconciledCount = 0;
    for (const match of qualifying) {
      try {
        const targetAccount = await AccountService.getAccountByCode(orgId, match.suggestedAccountCode) 
          || await AccountService.getAccountByCode(orgId, match.transaction.direction === 'IN' ? '4000' : '6000');
        
        if (targetAccount) {
          await this.matchTransaction(orgId, match.transactionId, targetAccount.id, undefined, userId);
          reconciledCount++;
        }
      } catch (err) {
        console.error('Error auto-reconciling match:', err);
      }
    }

    return { count: reconciledCount, totalPending: matches.length };
  }

  static async matchTransaction(orgId: string, transactionId: string, targetAccountId: string | undefined, existingJournalEntryId: string | undefined, userId: string) {
    const supabase = getSupabase();
    
    const { data: tx, error: txError } = await supabase
      .from('bank_transactions')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', transactionId)
      .single();
      
    if (txError) throw new Error('Transaction not found');
    if (tx.status === 'MATCHED') throw new Error('Transaction is already matched');
    if (!Number.isSafeInteger(Number(tx.amount_cents)) || Number(tx.amount_cents) <= 0) {
      throw new Error('Bank transaction amount must be a positive integer number of cents.');
    }

    let finalJournalEntryId = existingJournalEntryId;

    if (finalJournalEntryId) {
      const { data: existingEntry, error: entryError } = await supabase
        .from('journal_entries')
        .select('id')
        .eq('org_id', orgId)
        .eq('id', finalJournalEntryId)
        .maybeSingle();
      if (entryError) throw entryError;
      if (!existingEntry) throw new Error('The selected journal entry belongs to another organization or does not exist.');
    }

    if (!finalJournalEntryId) {
      if (!targetAccountId) throw new Error('Must provide either targetAccountId or existingJournalEntryId');

      const { data: targetAccount, error: accountError } = await supabase
        .from('accounts')
        .select('id')
        .eq('org_id', orgId)
        .eq('id', targetAccountId)
        .eq('is_active', true)
        .maybeSingle();
      if (accountError) throw accountError;
      if (!targetAccount) throw new Error('The target account is inactive or belongs to another organization.');
      
      // Get the bank account (Code 1000)
      const bankAccount = await AccountService.getAccountByCode(orgId, '1000');
      if (!bankAccount) throw new Error('Bank account (1000) not found in Chart of Accounts.');

      // Prepare ledger lines
      const lines = [];
      if (tx.direction === 'IN') {
        lines.push({ accountId: bankAccount.id, debit: tx.amount_cents, credit: 0, description: tx.description });
        lines.push({ accountId: targetAccountId, debit: 0, credit: tx.amount_cents, description: tx.description });
      } else {
        lines.push({ accountId: targetAccountId, debit: tx.amount_cents, credit: 0, description: tx.description });
        lines.push({ accountId: bankAccount.id, debit: 0, credit: tx.amount_cents, description: tx.description });
      }

      // Post to ledger
      finalJournalEntryId = await LedgerService.postJournalEntry({
        orgId,
        entryDate: tx.date,
        memo: `Bank Match: ${tx.description}`,
        sourceType: 'BANK',
        sourceId: transactionId,
        createdBy: userId,
        idempotencyKey: `bank-match:${transactionId}`,
        lines
      });
    }

    // Mark as matched
    const { data: matchedTransaction, error: matchError } = await supabase
      .from('bank_transactions')
      .update({
        status: 'MATCHED',
        matched_journal_entry_id: finalJournalEntryId,
      })
      .eq('org_id', orgId)
      .eq('id', transactionId)
      .neq('status', 'MATCHED')
      .select('id')
      .maybeSingle();
    if (matchError) throw matchError;
    if (!matchedTransaction) throw new Error('Transaction was already matched by another request.');

    return finalJournalEntryId;
  }
}
