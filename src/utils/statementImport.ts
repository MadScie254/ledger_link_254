/**
 * Reading bank and M-Pesa statements exported as CSV, OFX or QFX into
 * statement lines: a date, particulars, a signed amount in cents (money in
 * is positive) and the bank's own reference where there is one.
 *
 * Nothing here talks to the network; the browser reads the file and sends
 * the lines it found, which the database checks again.
 */

export interface StatementLine {
  date: string; // yyyy-MM-dd
  description: string;
  amountCents: number; // positive in, negative out
  reference?: string;
}

export type DateFormat = 'YMD' | 'DMY' | 'MDY';

export interface CsvMapping {
  date: number;
  description: number;
  /** One signed amount column, or separate money-in and money-out columns. */
  amount?: number;
  moneyIn?: number;
  moneyOut?: number;
  reference?: number;
  dateFormat: DateFormat;
}

/** Splits CSV text into rows, honouring quotes, doubled quotes and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = [',', ';', '\t'].reduce((best, candidate) =>
    countOutsideQuotes(firstLine, candidate) > countOutsideQuotes(firstLine, best) ? candidate : best, ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field); field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((cell) => cell.trim()));
}

function countOutsideQuotes(line: string, delimiter: string) {
  let count = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) count++;
  }
  return count;
}

const HEADER_HINTS: Record<'date' | 'description' | 'amount' | 'moneyIn' | 'moneyOut' | 'reference', RegExp> = {
  date: /^(date|transaction date|txn date|value date|posting date|completion time|trans(action)? time|booking date)$/i,
  description: /^(description|details|narration|narrative|particulars|transaction details|memo|payee|name)$/i,
  amount: /^(amount|transaction amount|amount \(kes\)|value|net amount)$/i,
  moneyIn: /^(paid in|money in|credit|credits|deposit|deposits|cr|credit amount|receipts)$/i,
  moneyOut: /^(withdrawn|withdrawal|withdrawals|money out|debit|debits|dr|debit amount|payments)$/i,
  reference: /^(reference|ref|ref\.? no\.?|receipt no\.?|receipt|transaction id|cheque no\.?|bank reference|fitid)$/i,
};

/**
 * Finds the header row (the first row naming a date column) and guesses
 * which column holds what. Statements often start with a few lines about
 * the account before the table, so the header need not be the first row.
 */
export function detectCsvLayout(rows: string[][]): { headerRow: number; mapping: CsvMapping | null } {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const header = rows[r];
    const find = (key: keyof typeof HEADER_HINTS) => header.findIndex((cell) => HEADER_HINTS[key].test(cell.trim()));
    const date = find('date');
    if (date === -1) continue;
    const description = find('description');
    const amount = find('amount');
    const moneyIn = find('moneyIn');
    const moneyOut = find('moneyOut');
    const reference = find('reference');
    const sample = rows.slice(r + 1, r + 21).map((row) => row[date]).filter(Boolean);
    const mapping: CsvMapping = {
      date,
      description: description === -1 ? Math.max(0, header.findIndex((_, i) => i !== date)) : description,
      dateFormat: guessDateFormat(sample),
      ...(moneyIn !== -1 && moneyOut !== -1 ? { moneyIn, moneyOut } : { amount: amount === -1 ? undefined : amount }),
      ...(reference !== -1 ? { reference } : {}),
    };
    return { headerRow: r, mapping };
  }
  return { headerRow: 0, mapping: null };
}

/** Day-first unless a value can only be month-first; year-first when the year leads. */
export function guessDateFormat(samples: string[]): DateFormat {
  let dayFirstImpossible = false;
  let monthFirstImpossible = false;
  for (const sample of samples) {
    const parts = sample.trim().split(/[\sT]/)[0].split(/[/.-]/).map((part) => Number(part));
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) continue;
    if (String(sample.trim().split(/[/.-]/)[0]).length === 4) return 'YMD';
    if (parts[1] > 12) dayFirstImpossible = true;
    if (parts[0] > 12) monthFirstImpossible = true;
  }
  return dayFirstImpossible && !monthFirstImpossible ? 'MDY' : 'DMY';
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** A statement date as yyyy-MM-dd, or null when it cannot be read. Times after the date are ignored. */
export function parseStatementDate(value: string, format: DateFormat): string | null {
  const text = value.trim();
  if (!text) return null;
  // 2026-09-15, 2026-09-15 14:02:11, 2026-09-15T14:02:11
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[\sT].*)?$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  // 15 Sep 2026, 15-Sep-2026, 15-Sep-26
  match = text.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]+(\d{2,4})(?:\s.*)?$/);
  if (match) {
    const month = MONTHS[match[2].slice(0, 4).toLowerCase()] ?? MONTHS[match[2].slice(0, 3).toLowerCase()];
    return month ? isoDate(fullYear(Number(match[3])), month, Number(match[1])) : null;
  }
  // 15/09/2026, 09/15/2026, 15.09.26
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[\sT].*)?$/);
  if (match) {
    const [first, second, year] = [Number(match[1]), Number(match[2]), fullYear(Number(match[3]))];
    return format === 'MDY' ? isoDate(year, first, second) : isoDate(year, second, first);
  }
  // OFX: 20260915 or 20260915120000[0:GMT]
  match = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return null;
}

function fullYear(year: number) {
  return year < 100 ? 2000 + year : year;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * An amount in cents: 1,250.50, -1250.5, (1,250.50), KES 1,250, 1 250,50,
 * 1250.50 CR or 1250.50 DR. Returns null for an empty or unreadable cell.
 */
export function parseStatementAmount(value: string): number | null {
  let text = value.trim();
  if (!text || text === '-') return null;
  let sign = 1;
  if (/^\(.*\)$/.test(text)) { sign = -1; text = text.slice(1, -1); }
  if (/\bDR\b\.?$/i.test(text)) { sign = -sign; text = text.replace(/\bDR\b\.?$/i, ''); }
  text = text.replace(/\bCR\b\.?$/i, '');
  text = text.replace(/[A-Za-z]{3}\s?|[^\d.,\-\s]/g, '').trim();
  if (text.startsWith('-')) { sign = -sign; text = text.slice(1); }
  if (text.endsWith('-')) { sign = -sign; text = text.slice(0, -1); }
  text = text.replace(/\s/g, '');
  // A comma as the decimal mark: 1.250,50 or 1250,50
  if (/,\d{1,2}$/.test(text) && !/\.\d{1,2}$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isFinite(cents) ? sign * cents : null;
}

/** The statement lines in CSV rows below the header, with a reason for each row skipped. */
export function linesFromCsv(rows: string[][], headerRow: number, mapping: CsvMapping) {
  const lines: StatementLine[] = [];
  const skipped: Array<{ row: number; reason: string }> = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const date = parseStatementDate(row[mapping.date] || '', mapping.dateFormat);
    if (!date) { skipped.push({ row: r + 1, reason: 'no date that can be read' }); continue; }
    let amountCents: number | null = null;
    if (mapping.amount !== undefined) {
      amountCents = parseStatementAmount(row[mapping.amount] || '');
    } else if (mapping.moneyIn !== undefined && mapping.moneyOut !== undefined) {
      const moneyIn = parseStatementAmount(row[mapping.moneyIn] || '');
      const moneyOut = parseStatementAmount(row[mapping.moneyOut] || '');
      amountCents = (moneyIn ? Math.abs(moneyIn) : 0) - (moneyOut ? Math.abs(moneyOut) : 0);
      if (!moneyIn && !moneyOut) amountCents = null;
    }
    if (!amountCents) { skipped.push({ row: r + 1, reason: amountCents === 0 ? 'an amount of nothing' : 'no amount that can be read' }); continue; }
    const description = (row[mapping.description] || '').replace(/\s+/g, ' ').trim().slice(0, 500) || 'Statement line';
    const reference = mapping.reference !== undefined ? (row[mapping.reference] || '').trim().slice(0, 100) : '';
    lines.push({ date, description, amountCents, ...(reference ? { reference } : {}) });
  }
  return { lines, skipped };
}

/** Transactions in an OFX or QFX file (the SGML or XML form). */
export function linesFromOfx(text: string): StatementLine[] {
  const lines: StatementLine[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const block of blocks) {
    const body = block.split(/<\/STMTTRN>/i)[0];
    const tag = (name: string) => {
      const match = body.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
      return match ? match[1].trim() : '';
    };
    const date = parseStatementDate(tag('DTPOSTED'), 'YMD');
    const amountCents = parseStatementAmount(tag('TRNAMT'));
    if (!date || !amountCents) continue;
    const description = [tag('NAME'), tag('MEMO')].filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 500) || 'Statement line';
    const reference = (tag('FITID') || tag('REFNUM') || tag('CHECKNUM')).slice(0, 100);
    lines.push({ date, description: decodeEntities(description), amountCents, ...(reference ? { reference } : {}) });
  }
  return lines;
}

function decodeEntities(text: string) {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Whether a file looks like OFX or QFX rather than CSV. */
export const isOfx = (text: string) => /<OFX>|OFXHEADER/i.test(text.slice(0, 2000));
