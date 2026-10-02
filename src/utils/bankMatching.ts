/**
 * Suggests what each unmatched bank statement line should be matched to.
 *
 * Order of preference, because it is the order that keeps the books right:
 *
 * 1. ENTRY: an entry already posted that moved the bank account by the same
 *    amount in the same direction, such as a payment recorded on the Sales
 *    page or a payroll run. Linking it posts nothing new, so the money is not
 *    counted twice.
 * 2. ACCOUNT from a rule the company wrote itself.
 * 3. INVOICE or BILL: an open document the line settles, found by its number
 *    in the line's description or by its exact amount due. Accepting it records
 *    a payment against the document, so receivables and payables stay in step
 *    with the ledger.
 * 4. ACCOUNT from a keyword in the description. These are guesses: they are
 *    scored below the auto-accept threshold, so they are never posted without
 *    a person choosing them.
 *
 * Every target is claimed once: two lines of the same amount never both get
 * the same entry, and an invoice is never suggested for more than it still owes.
 */

export const AUTO_ACCEPT_CONFIDENCE = 85;

/** Receivables and payables move only through documents and their payments. */
export const CONTROL_ACCOUNT_CODES = new Set(['1100', '2000']);

const ENTRY_DATE_WINDOW_DAYS = 45;
const ENTRY_CLOSE_DAYS = 7;

export type BankMatchType = 'ENTRY' | 'INVOICE' | 'BILL' | 'ACCOUNT';

export interface BankLine {
  id: string;
  date: string;
  description: string | null;
  amountCents: number;
  direction: 'IN' | 'OUT';
}

export interface BankRule {
  matchText: string;
  targetAccountId: string;
  targetAccountCode: string;
  targetAccountName: string;
}

export interface OpenDocument {
  id: string;
  number: string | null;
  partyName: string | null;
  amountDueCents: number;
}

/** A posted entry's net movement on the bank account: positive in, negative out. */
export interface BankEntry {
  journalEntryId: string;
  entryDate: string;
  memo: string | null;
  netBankCents: number;
}

export interface BankMatchSuggestion {
  transactionId: string;
  matchType: BankMatchType;
  confidence: number;
  reason: string;
  /** The invoice or bill to pay, for INVOICE and BILL. */
  entityId?: string;
  entityName?: string;
  entityReference?: string;
  /** The entry to link, for ENTRY. */
  journalEntryId?: string;
  /** The account to post to, for ACCOUNT; for documents, the control account they settle. */
  suggestedAccountId?: string;
  suggestedAccountCode?: string;
  suggestedAccountName?: string;
}

interface KeywordGuess {
  words: string[];
  direction: 'IN' | 'OUT';
  accountCode: string;
  accountName: string;
  label: string;
}

// Codes from the standard chart seeded for every company
// (src/server/organizations.ts). The server resolves each code against the
// company's own chart and drops the guess if the account does not exist.
const KEYWORD_GUESSES: KeywordGuess[] = [
  { words: ['SAFARICOM', 'AIRTIME', 'FIBER', 'FIBRE', 'INTERNET'], direction: 'OUT', accountCode: '6200', accountName: 'Office Rent & Utilities', label: 'telephone or internet' },
  { words: ['KPLC', 'KENYA POWER', 'WATER'], direction: 'OUT', accountCode: '6200', accountName: 'Office Rent & Utilities', label: 'utilities' },
  { words: ['RENT'], direction: 'OUT', accountCode: '6200', accountName: 'Office Rent & Utilities', label: 'rent' },
  { words: ['SHELL', 'TOTALENERGIES', 'RUBIS', 'PETROL', 'FUEL', 'DIESEL'], direction: 'OUT', accountCode: '6000', accountName: 'Operating Expenses', label: 'fuel' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Upper-case letters and digits only, so "INV-2026-0042" matches "inv 2026 0042". */
export function normalizeReference(value: string | null | undefined): string {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a.slice(0, 10));
  const tb = Date.parse(b.slice(0, 10));
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY;
  return Math.abs(ta - tb) / DAY_MS;
}

function containsWord(haystack: string, needle: string): boolean {
  return new RegExp(`(^|[^A-Z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9]|$)`).test(haystack);
}

function entryCandidates(line: BankLine, entries: BankEntry[]): BankMatchSuggestion[] {
  const signed = line.direction === 'IN' ? line.amountCents : -line.amountCents;
  const sameAmount = entries
    .filter((entry) => entry.netBankCents === signed && daysBetween(entry.entryDate, line.date) <= ENTRY_DATE_WINDOW_DAYS)
    .sort((a, b) => daysBetween(a.entryDate, line.date) - daysBetween(b.entryDate, line.date));
  if (sameAmount.length === 0) return [];

  const close = sameAmount.filter((entry) => daysBetween(entry.entryDate, line.date) <= ENTRY_CLOSE_DAYS);
  return sameAmount.map((entry) => {
    const isOnlyCloseOne = close.length === 1 && close[0] === entry;
    return {
      transactionId: line.id,
      matchType: 'ENTRY' as const,
      confidence: isOnlyCloseOne ? 95 : 70,
      journalEntryId: entry.journalEntryId,
      entityName: entry.memo || 'Posted entry',
      reason: isOnlyCloseOne
        ? `An entry already posted moved the bank account by this amount on ${entry.entryDate.slice(0, 10)}. Linking it posts nothing new.`
        : `An entry already posted on ${entry.entryDate.slice(0, 10)} moved the bank account by this amount; other entries did too, so check it is the right one.`,
    };
  });
}

function ruleCandidates(line: BankLine, description: string, rules: BankRule[]): BankMatchSuggestion[] {
  const rule = rules.find((r) =>
    r.matchText.trim() !== '' &&
    !CONTROL_ACCOUNT_CODES.has(r.targetAccountCode) &&
    description.includes(r.matchText.trim().toUpperCase()),
  );
  if (!rule) return [];
  return [{
    transactionId: line.id,
    matchType: 'ACCOUNT',
    confidence: 90,
    suggestedAccountId: rule.targetAccountId,
    suggestedAccountCode: rule.targetAccountCode,
    suggestedAccountName: rule.targetAccountName,
    entityName: rule.targetAccountName,
    reason: `Your rule: lines containing "${rule.matchText.trim()}" go to ${rule.targetAccountCode}.`,
  }];
}

function documentCandidates(
  line: BankLine,
  description: string,
  documents: OpenDocument[],
  remainingDue: Map<string, number>,
  kind: 'INVOICE' | 'BILL',
): BankMatchSuggestion[] {
  const compactDescription = normalizeReference(description);
  const open = documents.filter((doc) => (remainingDue.get(doc.id) ?? doc.amountDueCents) >= line.amountCents);
  const exactAmount = open.filter((doc) => (remainingDue.get(doc.id) ?? doc.amountDueCents) === line.amountCents);
  const suggestions: BankMatchSuggestion[] = [];

  for (const doc of open) {
    const due = remainingDue.get(doc.id) ?? doc.amountDueCents;
    const reference = normalizeReference(doc.number);
    const hasReference = reference.length >= 4 && compactDescription.includes(reference);
    const name = (doc.partyName || '').trim().toUpperCase();
    const hasName = name.length >= 3 && containsWord(description, name);
    const isExact = due === line.amountCents;
    const isOnlyExact = isExact && exactAmount.length === 1;

    let confidence = 0;
    let why = '';
    if (hasReference && isExact) {
      confidence = 97;
      why = `The line quotes ${doc.number} and pays exactly what it still owes.`;
    } else if (hasReference) {
      confidence = 88;
      why = `The line quotes ${doc.number}; it pays part of what it still owes.`;
    } else if (isOnlyExact && hasName) {
      confidence = 90;
      why = `Only ${doc.number} still owes exactly this amount, and the line names ${doc.partyName}.`;
    } else if (isOnlyExact) {
      confidence = 80;
      why = `Only ${doc.number} still owes exactly this amount. The line does not quote its number, so check it.`;
    } else if (hasName && isExact) {
      confidence = 60;
      why = `${doc.partyName} is named and ${doc.number} owes this amount, but other ${kind === 'INVOICE' ? 'invoices' : 'bills'} do too.`;
    }
    if (confidence === 0) continue;

    suggestions.push({
      transactionId: line.id,
      matchType: kind,
      confidence,
      entityId: doc.id,
      entityName: doc.partyName || (kind === 'INVOICE' ? 'Customer invoice' : 'Supplier bill'),
      entityReference: doc.number || undefined,
      suggestedAccountCode: kind === 'INVOICE' ? '1100' : '2000',
      suggestedAccountName: kind === 'INVOICE' ? 'Accounts receivable' : 'Accounts payable',
      reason: why,
    });
  }
  return suggestions;
}

function keywordCandidates(line: BankLine, description: string): BankMatchSuggestion[] {
  const guess = KEYWORD_GUESSES.find((g) => g.direction === line.direction && g.words.some((word) => containsWord(description, word)));
  if (!guess) return [];
  return [{
    transactionId: line.id,
    matchType: 'ACCOUNT',
    confidence: 50,
    suggestedAccountCode: guess.accountCode,
    suggestedAccountName: guess.accountName,
    entityName: guess.accountName,
    reason: `The description looks like ${guess.label}. This is a guess from the wording; check it before accepting.`,
  }];
}

export function suggestBankMatches(input: {
  lines: BankLine[];
  rules: BankRule[];
  openInvoices: OpenDocument[];
  openBills: OpenDocument[];
  bankEntries: BankEntry[];
}): BankMatchSuggestion[] {
  const remainingDue = new Map<string, number>();
  for (const doc of [...input.openInvoices, ...input.openBills]) remainingDue.set(doc.id, doc.amountDueCents);

  // Every possible pairing, best first; then each line takes its best pairing
  // whose target is still free.
  const all: BankMatchSuggestion[] = [];
  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents <= 0) continue;
    const description = (line.description || '').toUpperCase();
    all.push(
      ...entryCandidates(line, input.bankEntries),
      ...ruleCandidates(line, description, input.rules),
      ...(line.direction === 'IN'
        ? documentCandidates(line, description, input.openInvoices, remainingDue, 'INVOICE')
        : documentCandidates(line, description, input.openBills, remainingDue, 'BILL')),
      ...keywordCandidates(line, description),
    );
  }

  const typeOrder: Record<BankMatchType, number> = { ENTRY: 0, INVOICE: 1, BILL: 1, ACCOUNT: 2 };
  all.sort((a, b) => b.confidence - a.confidence || typeOrder[a.matchType] - typeOrder[b.matchType]);

  const lineAmount = new Map(input.lines.map((line) => [line.id, line.amountCents]));
  const chosen = new Map<string, BankMatchSuggestion>();
  const claimedEntries = new Set<string>();

  for (const suggestion of all) {
    if (chosen.has(suggestion.transactionId)) continue;
    if (suggestion.journalEntryId) {
      if (claimedEntries.has(suggestion.journalEntryId)) continue;
      claimedEntries.add(suggestion.journalEntryId);
    }
    if (suggestion.entityId) {
      const amount = lineAmount.get(suggestion.transactionId) ?? 0;
      const due = remainingDue.get(suggestion.entityId) ?? 0;
      if (due < amount) continue;
      remainingDue.set(suggestion.entityId, due - amount);
    }
    chosen.set(suggestion.transactionId, suggestion);
  }

  return [...chosen.values()].sort((a, b) => b.confidence - a.confidence);
}
