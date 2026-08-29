export interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
  entityType?: 'CUSTOMER' | 'VENDOR' | 'EMPLOYEE' | 'PROJECT';
  entityId?: string;
}

export interface JournalEntryInput {
  orgId: string;
  entryDate: string; // ISO String
  memo?: string;
  sourceType: 'INVOICE' | 'BILL' | 'PAYMENT' | 'BANK' | 'MANUAL' | 'ADJUSTMENT';
  sourceId?: string;
  referenceNo?: string;
  createdBy: string;
  lines: JournalLineInput[];
}

// Error class for Ledger Engine violations
export class LedgerEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerEngineError';
  }
}
