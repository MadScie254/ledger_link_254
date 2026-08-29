import { getDb } from './db';
import { JournalEntryInput, JournalLineInput, LedgerEngineError } from './types';
import { runTransaction, collection, doc, serverTimestamp, getDocs, query, orderBy } from 'firebase/firestore';
import { AuditService } from './audit';

/**
 * The Sacred Ledger Core
 * This service handles all double-entry posting logic.
 * The UI layer must NEVER write directly to the journal_entries or journal_lines tables.
 */
export class LedgerService {
  /**
   * Validates and posts a Journal Entry within a single Firestore transaction.
   * Ensures that SUM(debit) == SUM(credit) before posting.
   */
  static async postJournalEntry(input: JournalEntryInput): Promise<string> {
    const db = getDb();
    
    // 1. Validation: Ensure lines exist
    if (!input.lines || input.lines.length < 2) {
      throw new LedgerEngineError('A journal entry must have at least two lines.');
    }

    // 2. Validation: SUM(debit) == SUM(credit)
    let totalDebit = 0;
    let totalCredit = 0;
    
    for (const line of input.lines) {
      // Must be positive integers/decimals. We work in cents to avoid float issues.
      if (line.debit < 0 || line.credit < 0) {
        throw new LedgerEngineError('Debits and credits must be non-negative.');
      }
      if (line.debit > 0 && line.credit > 0) {
        throw new LedgerEngineError('A single line cannot have both a debit and a credit.');
      }
      if (line.debit === 0 && line.credit === 0) {
        throw new LedgerEngineError('A line must have either a debit or a credit.');
      }
      
      totalDebit += line.debit;
      totalCredit += line.credit;
    }

    // Strict equality check for double-entry accounting
    if (totalDebit !== totalCredit) {
      throw new LedgerEngineError(`Journal entry unbalanced: Debits (${totalDebit}) do not equal Credits (${totalCredit}).`);
    }

    // 3. Post to Database via Transaction
    let entryId = '';
    await runTransaction(db, async (transaction) => {
      const entriesRef = collection(db, 'organizations', input.orgId, 'journal_entries');
      const entryRef = doc(entriesRef);
      
      const timestamp = serverTimestamp();
      
      const entryData = {
        entryDate: input.entryDate,
        memo: input.memo || null,
        sourceType: input.sourceType,
        sourceId: input.sourceId || null,
        referenceNo: input.referenceNo || null,
        createdBy: input.createdBy,
        postedAt: timestamp,
      };

      transaction.set(entryRef, entryData);

      // Create line documents
      for (const line of input.lines) {
        const linesRef = collection(entryRef, 'lines');
        const lineRef = doc(linesRef);
        transaction.set(lineRef, {
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          description: line.description || null,
          entityType: line.entityType || null,
          entityId: line.entityId || null,
        });
      }

      entryId = entryRef.id;
    });

    if (input.createdBy) {
      await AuditService.logEvent({
        orgId: input.orgId,
        userId: input.createdBy,
        action: 'CREATE',
        resourceType: 'JOURNAL_ENTRY',
        resourceId: entryId,
        details: { memo: input.memo, amount: totalDebit, sourceType: input.sourceType }
      });
    }

    return entryId;
  }

  static async getJournalEntries(orgId: string) {
    const db = getDb();
    const entriesRef = collection(db, 'organizations', orgId, 'journal_entries');
    const q = query(entriesRef, orderBy('postedAt', 'desc'));
    const snapshot = await getDocs(q);
    
    // In a real app we'd load lines too, but let's keep it simple for listing
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}
