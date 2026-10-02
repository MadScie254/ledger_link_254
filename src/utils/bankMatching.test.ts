import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTO_ACCEPT_CONFIDENCE,
  normalizeReference,
  suggestBankMatches,
  type BankEntry,
  type BankLine,
  type BankRule,
  type OpenDocument,
} from './bankMatching.ts';

const line = (id: string, direction: 'IN' | 'OUT', amountCents: number, description: string, date = '2026-09-10'): BankLine =>
  ({ id, direction, amountCents, description, date });
const invoice = (id: string, number: string, amountDueCents: number, partyName = 'Acme Traders'): OpenDocument =>
  ({ id, number, partyName, amountDueCents });
const entry = (journalEntryId: string, netBankCents: number, entryDate = '2026-09-09', memo = 'Payment received'): BankEntry =>
  ({ journalEntryId, netBankCents, entryDate, memo });

const none = { lines: [], rules: [], openInvoices: [], openBills: [], bankEntries: [] };

test('a line already posted to the bank links to that entry instead of posting again', () => {
  const [match] = suggestBankMatches({
    ...none,
    lines: [line('t1', 'IN', 50_000, 'MPESA ACME INV-2026-00007')],
    // The payment was recorded on the Sales page, so the invoice is no longer open.
    bankEntries: [entry('je-pay', 50_000)],
  });

  assert.equal(match.matchType, 'ENTRY');
  assert.equal(match.journalEntryId, 'je-pay');
  assert.ok(match.confidence >= AUTO_ACCEPT_CONFIDENCE);
});

test('an entry in the wrong direction or far from the line date is not suggested', () => {
  const matches = suggestBankMatches({
    ...none,
    lines: [line('t1', 'IN', 50_000, 'DEPOSIT')],
    bankEntries: [entry('je-out', -50_000), entry('je-old', 50_000, '2026-05-01')],
  });

  assert.deepEqual(matches, []);
});

test('two lines of the same amount never claim the same entry', () => {
  const matches = suggestBankMatches({
    ...none,
    lines: [line('t1', 'OUT', 30_000, 'SALARY A', '2026-09-28'), line('t2', 'OUT', 30_000, 'SALARY B', '2026-09-28')],
    bankEntries: [entry('je-1', -30_000, '2026-09-28')],
  });

  assert.equal(matches.filter((m) => m.journalEntryId === 'je-1').length, 1);
});

test('an invoice quoted by number and paid in full is a strong match', () => {
  const [match] = suggestBankMatches({
    ...none,
    lines: [line('t1', 'IN', 80_000, 'MPESA PAYBILL inv 2026 00042 ACME')],
    openInvoices: [invoice('i42', 'INV-2026-00042', 80_000), invoice('i43', 'INV-2026-00043', 80_000, 'Other Ltd')],
  });

  assert.equal(match.matchType, 'INVOICE');
  assert.equal(match.entityId, 'i42');
  assert.equal(match.confidence, 97);
});

test('a part payment quoting the invoice is suggested, an overpayment is not', () => {
  const matches = suggestBankMatches({
    ...none,
    lines: [line('part', 'IN', 30_000, 'INV-2026-00042'), line('over', 'IN', 90_000, 'INV-2026-00043')],
    openInvoices: [invoice('i42', 'INV-2026-00042', 80_000), invoice('i43', 'INV-2026-00043', 80_000)],
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].transactionId, 'part');
  assert.equal(matches[0].confidence, 88);
  assert.ok(matches[0].confidence >= AUTO_ACCEPT_CONFIDENCE);
});

test('an exact amount without a reference needs a person when it is the only match, and is skipped when it is not', () => {
  const unique = suggestBankMatches({
    ...none,
    lines: [line('t1', 'IN', 12_345, 'BANK TRANSFER')],
    openInvoices: [invoice('i1', 'INV-1', 12_345), invoice('i2', 'INV-2', 99_000)],
  });
  assert.equal(unique[0].entityId, 'i1');
  assert.ok(unique[0].confidence < AUTO_ACCEPT_CONFIDENCE);

  const ambiguous = suggestBankMatches({
    ...none,
    lines: [line('t1', 'IN', 12_345, 'BANK TRANSFER')],
    openInvoices: [invoice('i1', 'INV-1', 12_345), invoice('i2', 'INV-2', 12_345)],
  });
  assert.deepEqual(ambiguous, []);
});

test('an invoice is never suggested for more than it still owes across several lines', () => {
  const matches = suggestBankMatches({
    ...none,
    lines: [line('a', 'IN', 60_000, 'INV-2026-00042 first'), line('b', 'IN', 60_000, 'INV-2026-00042 second')],
    openInvoices: [invoice('i42', 'INV-2026-00042', 100_000)],
  });

  assert.equal(matches.filter((m) => m.entityId === 'i42').length, 1);
});

test('money out matches open bills, never invoices', () => {
  const matches = suggestBankMatches({
    ...none,
    lines: [line('t1', 'OUT', 40_000, 'PAYMENT BILL-2026-00003')],
    openInvoices: [invoice('i1', 'BILL-2026-00003', 40_000)],
    openBills: [{ id: 'b3', number: 'BILL-2026-00003', partyName: 'Kenya Power', amountDueCents: 40_000 }],
  });

  assert.equal(matches[0].matchType, 'BILL');
  assert.equal(matches[0].entityId, 'b3');
  assert.equal(matches[0].suggestedAccountCode, '2000');
});

test('a company rule wins over a keyword guess, and a rule to receivables or payables is ignored', () => {
  const rules: BankRule[] = [
    { matchText: 'acme', targetAccountId: 'ar', targetAccountCode: '1100', targetAccountName: 'Accounts receivable' },
    { matchText: 'safaricom', targetAccountId: 'acc-6300', targetAccountCode: '6300', targetAccountName: 'Telephone' },
  ];
  const matches = suggestBankMatches({
    ...none,
    rules,
    lines: [line('t1', 'OUT', 5_000, 'SAFARICOM POSTPAY'), line('t2', 'IN', 7_000, 'ACME DEPOSIT')],
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].transactionId, 't1');
  assert.equal(matches[0].suggestedAccountCode, '6300');
  assert.ok(matches[0].confidence >= AUTO_ACCEPT_CONFIDENCE);
});

test('keyword guesses are never strong enough to post without a person', () => {
  const matches = suggestBankMatches({
    ...none,
    lines: [
      line('fuel', 'OUT', 9_000, 'SHELL KAREN'),
      // "TOTAL" in a description used to be read as fuel at 95%.
      line('total', 'OUT', 9_000, 'MONTHLY TOTAL CHARGES'),
      line('mpesa', 'IN', 9_000, 'M-PESA C2B 254700000000'),
    ],
  });

  assert.deepEqual(matches.map((m) => m.transactionId), ['fuel']);
  assert.ok(matches[0].confidence < AUTO_ACCEPT_CONFIDENCE);
});

test('references compare letters and digits only', () => {
  assert.equal(normalizeReference(' inv-2026/0042 '), 'INV20260042');
  assert.equal(normalizeReference(null), '');
});
