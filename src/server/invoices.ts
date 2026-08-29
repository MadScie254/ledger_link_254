import { getDb } from './db';
import { LedgerService } from './ledger';
import { AccountService } from './accounts';
import { EtimsService } from './etims';
import { collection, doc, setDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';

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
    const db = getDb();
    const invoicesRef = collection(db, 'organizations', orgId, 'invoices');
    const q = query(invoicesRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  static async createInvoice(input: InvoiceInput) {
    const db = getDb();
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

    const invoicesRef = collection(db, 'organizations', input.orgId, 'invoices');
    const invoiceRef = doc(invoicesRef);
    const invoiceNo = `INV-${Math.floor(1000 + Math.random() * 9000)}`;

    // 4. Post to Ledger Core (This asserts double-entry integrity)
    const journalEntryId = await LedgerService.postJournalEntry({
      orgId: input.orgId,
      entryDate: input.issueDate,
      memo: `Invoice ${invoiceNo}${currency !== 'KES' ? ` [${currency}]` : ''}`,
      sourceType: 'INVOICE',
      sourceId: invoiceRef.id,
      referenceNo: invoiceNo,
      createdBy: input.createdBy,
      lines: journalLines
    });

    // 5. Submit to KRA eTIMS (Mock)
    let etimsData = null;
    try {
      etimsData = await EtimsService.submitInvoice(input.orgId, invoiceRef.id, {
        invoiceNo,
        totalCents,
        lines: input.lines
      });
    } catch (err: any) {
      console.warn('eTIMS Submission Failed (Continuing with Invoice creation):', err.message);
    }

    // 6. Save Invoice Record
    await setDoc(invoiceRef, {
      customerId: input.customerId,
      customerName: input.customerName || null,
      invoiceNo,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      status: 'SENT',
      currency,
      exchangeRate,
      foreignAmountCents: totalForeignCents || totalCents,
      totalCents,
      journalEntryId,
      etimsStatus: etimsData ? 'SUCCESS' : 'PENDING',
      etimsControlCode: etimsData?.controlCode || null,
      etimsQrCodeUrl: etimsData?.qrCodeUrl || null,
      createdAt: serverTimestamp()
    });

    return invoiceRef.id;
  }
}
