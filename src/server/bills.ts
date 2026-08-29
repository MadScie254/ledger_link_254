import { getDb } from './db';
import { LedgerService } from './ledger';
import { AccountService } from './accounts';
import { collection, doc, setDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';

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
    const db = getDb();
    const billsRef = collection(db, 'organizations', orgId, 'bills');
    const q = query(billsRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  static async createBill(input: BillInput) {
    const db = getDb();
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

    const billsRef = collection(db, 'organizations', input.orgId, 'bills');
    const billRef = doc(billsRef);
    const billNo = `BILL-${Math.floor(1000 + Math.random() * 9000)}`;

    // 4. Post to Ledger Core (Asserts double-entry integrity)
    const journalEntryId = await LedgerService.postJournalEntry({
      orgId: input.orgId,
      entryDate: input.billDate,
      memo: `Bill ${billNo}${currency !== 'KES' ? ` [${currency}]` : ''}`,
      sourceType: 'BILL',
      sourceId: billRef.id,
      referenceNo: billNo,
      createdBy: input.createdBy,
      lines: journalLines
    });

    // 5. Save Bill Record
    await setDoc(billRef, {
      vendorId: input.vendorId,
      vendorName: input.vendorName || null,
      billNo,
      billDate: input.billDate,
      dueDate: input.dueDate,
      status: 'OPEN',
      currency,
      exchangeRate,
      foreignAmountCents: totalForeignCents || totalCents,
      totalCents,
      journalEntryId,
      createdAt: serverTimestamp()
    });

    return billRef.id;
  }
}
