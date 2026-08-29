import { getDb } from './db';
import { LedgerService } from './ledger';
import { AccountService } from './accounts';
import { InvoiceService } from './invoices';
import { BillService } from './bills';
import { collection, doc, setDoc, getDocs, getDoc, query, where, orderBy, updateDoc, serverTimestamp } from 'firebase/firestore';

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
    const db = getDb();
    const txRef = collection(db, 'organizations', orgId, 'bank_transactions');
    const q = query(txRef, orderBy('date', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  static async syncMockTransactions(orgId: string) {
    const db = getDb();
    const txRef = collection(db, 'organizations', orgId, 'bank_transactions');
    
    // Check if we already have transactions to avoid spamming
    const existing = await getDocs(query(txRef, orderBy('date', 'desc')));
    if (!existing.empty && existing.docs.length >= 6) {
      return { count: 0, message: 'Already synced recently.' };
    }

    const mocks = [
      { date: new Date().toISOString(), description: 'SAFARICOM M-PESA PAYBILL 555123', amountCents: 1500000, direction: 'IN', status: 'UNREVIEWED', aiCategoryCode: '4000', aiCategoryName: 'Sales Revenue' },
      { date: new Date(Date.now() - 3600000 * 4).toISOString(), description: 'INV-1045 ACME CORP WIRE TRF', amountCents: 8500000, direction: 'IN', status: 'UNREVIEWED', aiCategoryCode: '1100', aiCategoryName: 'Accounts Receivable' },
      { date: new Date(Date.now() - 86400000).toISOString(), description: 'SHELL PETROL STATION NAIROBI', amountCents: 450000, direction: 'OUT', status: 'UNREVIEWED', aiCategoryCode: '6000', aiCategoryName: 'Operating Expenses' },
      { date: new Date(Date.now() - 86400000 * 2).toISOString(), description: 'BILL-201 SAFARICOM FIBER INTERNET', amountCents: 1200000, direction: 'OUT', status: 'UNREVIEWED', aiCategoryCode: '2000', aiCategoryName: 'Accounts Payable' },
      { date: new Date(Date.now() - 86400000 * 3).toISOString(), description: 'KRA E-TIMS VAT MONTHLY SETTLEMENT', amountCents: 1250000, direction: 'OUT', status: 'UNREVIEWED', aiCategoryCode: '2000', aiCategoryName: 'Statutory Liabilities' },
      { date: new Date(Date.now() - 86400000 * 4).toISOString(), description: 'STAFF PAYROLL DISBURSEMENT AUG-26', amountCents: 14500000, direction: 'OUT', status: 'UNREVIEWED', aiCategoryCode: '6000', aiCategoryName: 'Payroll Expenses' },
    ];

    let count = 0;
    for (const tx of mocks) {
      const newDoc = doc(txRef);
      await setDoc(newDoc, {
        ...tx,
        createdAt: serverTimestamp()
      });
      count++;
    }

    return { count, message: `Synced ${count} new transactions.` };
  }

  static async getAIMatches(orgId: string): Promise<AIMatchCandidate[]> {
    const transactions = await this.getTransactions(orgId);
    const unreviewed = transactions.filter((t: any) => t.status !== 'MATCHED');

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

      if (isIncoming) {
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
    const db = getDb();
    const txRef = doc(db, 'organizations', orgId, 'bank_transactions', transactionId);
    const txSnap = await getDoc(txRef);
    
    if (!txSnap.exists()) throw new Error('Transaction not found');
    const tx = txSnap.data();

    if (tx.status === 'MATCHED') throw new Error('Transaction is already matched');

    let finalJournalEntryId = existingJournalEntryId;

    if (!finalJournalEntryId) {
      if (!targetAccountId) throw new Error('Must provide either targetAccountId or existingJournalEntryId');
      
      // Get the bank account (Code 1000)
      const bankAccount = await AccountService.getAccountByCode(orgId, '1000');
      if (!bankAccount) throw new Error('Bank account (1000) not found in Chart of Accounts.');

      // Prepare ledger lines
      const lines = [];
      if (tx.direction === 'IN') {
        lines.push({ accountId: bankAccount.id, debit: tx.amountCents, credit: 0, description: tx.description });
        lines.push({ accountId: targetAccountId, debit: 0, credit: tx.amountCents, description: tx.description });
      } else {
        lines.push({ accountId: targetAccountId, debit: tx.amountCents, credit: 0, description: tx.description });
        lines.push({ accountId: bankAccount.id, debit: 0, credit: tx.amountCents, description: tx.description });
      }

      // Post to ledger
      finalJournalEntryId = await LedgerService.postJournalEntry({
        orgId,
        entryDate: tx.date,
        memo: `Bank Match: ${tx.description}`,
        sourceType: 'BANK',
        sourceId: transactionId,
        createdBy: userId,
        lines
      });
    }

    // Mark as matched
    await updateDoc(txRef, {
      status: 'MATCHED',
      matchedJournalEntryId: finalJournalEntryId,
      updatedAt: serverTimestamp()
    });

    return finalJournalEntryId;
  }
}

