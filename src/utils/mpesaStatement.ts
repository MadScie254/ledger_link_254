/**
 * Reading an M-Pesa statement exported from the M-Pesa org portal (CSV),
 * for churches without Daraja access. Gifts are the completed lines with
 * money paid in; Safaricom's charges are the lines with money withdrawn
 * whose details or reason mention a charge. Other money out (withdrawals to
 * the bank, payments) is not giving and is skipped with a reason.
 *
 * Rows come from PapaParse in the browser; nothing here touches the network.
 */
import { guessDateFormat, parseStatementAmount, parseStatementDate, type DateFormat } from './statementImport.ts';

export type MpesaStatementField =
  | 'receipt' | 'completedAt' | 'details' | 'status' | 'paidIn' | 'withdrawn' | 'reasonType' | 'otherParty' | 'accountRef';

export type MpesaStatementMapping = Partial<Record<MpesaStatementField, number>> & { dateFormat?: DateFormat };

export const MPESA_STATEMENT_FIELDS: Array<{ field: MpesaStatementField; label: string; required: boolean }> = [
  { field: 'receipt', label: 'Receipt number', required: true },
  { field: 'completedAt', label: 'Completion time', required: true },
  { field: 'paidIn', label: 'Paid in', required: true },
  { field: 'withdrawn', label: 'Withdrawn', required: false },
  { field: 'accountRef', label: 'Account number (the giver\'s reference)', required: true },
  { field: 'otherParty', label: 'Other party (payer)', required: false },
  { field: 'details', label: 'Details', required: false },
  { field: 'reasonType', label: 'Reason type', required: false },
  { field: 'status', label: 'Transaction status', required: false },
];

const HINTS: Record<MpesaStatementField, RegExp> = {
  receipt: /^(receipt( no\.?| number)?|transaction id|trans(action)? code|mpesa (code|ref))$/i,
  completedAt: /^(completion time|completed( time)?|transaction time|date( and time)?|trans(action)? date)$/i,
  details: /^(details|description|transaction details|narration)$/i,
  status: /^(transaction status|status)$/i,
  paidIn: /^(paid in|money in|credit|amount in|received)$/i,
  withdrawn: /^(withdrawn|money out|debit|amount out|paid out)$/i,
  reasonType: /^(reason type|reason|transaction type|type)$/i,
  otherParty: /^(other party info|other party|payer|sender|customer|name)$/i,
  accountRef: /^(a\/c no\.?|account( no\.?| number| reference)?|bill ?ref( number)?|reference)$/i,
};

/** Finds the header row (it names a receipt column and a paid-in column) and guesses each column. */
export function detectMpesaColumns(rows: string[][]): { headerRow: number; mapping: MpesaStatementMapping | null } {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const header = rows[r].map((cell) => (cell ?? '').trim());
    const find = (field: MpesaStatementField) => header.findIndex((cell) => HINTS[field].test(cell));
    const receipt = find('receipt');
    const paidIn = find('paidIn');
    if (receipt === -1 || paidIn === -1) continue;
    const mapping: MpesaStatementMapping = {};
    for (const { field } of MPESA_STATEMENT_FIELDS) {
      const index = find(field);
      if (index !== -1) mapping[field] = index;
    }
    const sample = rows.slice(r + 1, r + 21).map((row) => row[mapping.completedAt ?? -1] ?? '').filter(Boolean);
    mapping.dateFormat = guessDateFormat(sample);
    return { headerRow: r, mapping };
  }
  return { headerRow: 0, mapping: null };
}

/** The fields a mapping still lacks before the statement can be read. */
export function missingMpesaFields(mapping: MpesaStatementMapping): string[] {
  return MPESA_STATEMENT_FIELDS.filter(({ field, required }) => required && mapping[field] === undefined).map(({ label }) => label);
}

/** "2026-10-04 08:15:22" or "04/10/2026 8:15 AM" (Nairobi time) as ISO with +03:00. */
export function statementTimeToIso(value: string, format: DateFormat): string | null {
  const date = parseStatementDate(value, format);
  if (!date) return null;
  const time = value.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  let hour = time ? Number(time[1]) : 0;
  const minute = time ? Number(time[2]) : 0;
  const second = time && time[3] ? Number(time[3]) : 0;
  if (time?.[4]) {
    const pm = time[4].toUpperCase() === 'PM';
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date}T${pad(hour)}:${pad(minute)}:${pad(second)}+03:00`;
}

/** "254712***678 - JANE WANJIKU" as the masked number and the payer's name. */
export function splitOtherParty(value: string): { msisdn: string | null; name: string | null } {
  const text = (value ?? '').trim();
  if (!text) return { msisdn: null, name: null };
  const match = text.match(/^([0-9*xX ]{6,20})\s*-\s*(.+)$/);
  if (match) return { msisdn: match[1].replace(/\s+/g, ''), name: match[2].trim().slice(0, 100) || null };
  return { msisdn: null, name: text.slice(0, 100) };
}

export interface StatementGift {
  transId: string;
  transTime: string;
  amountCents: number;
  billRefNumber: string | null;
  msisdn: string | null;
  firstName: string | null;
}

export interface StatementCharge {
  transId: string;
  date: string;
  amountCents: number;
}

export interface MpesaStatementRead {
  gifts: StatementGift[];
  charges: StatementCharge[];
  skipped: Array<{ row: number; reason: string }>;
  chargesCents: number;
  /** The last day the statement covers, for the charges entry. */
  periodEnd: string | null;
}

const CHARGE = /charge|fee|commission/i;

export function readMpesaStatement(rows: string[][], headerRow: number, mapping: MpesaStatementMapping): MpesaStatementRead {
  const format = mapping.dateFormat ?? 'DMY';
  const cell = (row: string[], field: MpesaStatementField) =>
    mapping[field] === undefined ? '' : String(row[mapping[field] as number] ?? '').trim();
  const gifts: StatementGift[] = [];
  const charges: StatementCharge[] = [];
  const skipped: Array<{ row: number; reason: string }> = [];
  const seen = new Set<string>();
  let periodEnd: string | null = null;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const line = r + 1;
    if (!row || row.every((value) => !String(value ?? '').trim())) continue;
    const transId = cell(row, 'receipt').toUpperCase();
    if (!/^[A-Z0-9]{6,30}$/.test(transId)) { skipped.push({ row: line, reason: 'no M-Pesa receipt number' }); continue; }
    const transTime = statementTimeToIso(cell(row, 'completedAt'), format);
    if (!transTime) { skipped.push({ row: line, reason: 'no completion time that can be read' }); continue; }
    const status = cell(row, 'status');
    if (status && !/^completed$/i.test(status)) { skipped.push({ row: line, reason: `status ${status}, not completed` }); continue; }
    const paidIn = Math.abs(parseStatementAmount(cell(row, 'paidIn')) ?? 0);
    const withdrawn = Math.abs(parseStatementAmount(cell(row, 'withdrawn')) ?? 0);
    const date = transTime.slice(0, 10);
    if (!periodEnd || date > periodEnd) periodEnd = date;
    const describedAs = `${cell(row, 'details')} ${cell(row, 'reasonType')}`;

    if (paidIn > 0 && withdrawn === 0) {
      if (seen.has(transId)) { skipped.push({ row: line, reason: `receipt ${transId} appears twice` }); continue; }
      seen.add(transId);
      const party = splitOtherParty(cell(row, 'otherParty'));
      gifts.push({
        transId, transTime, amountCents: paidIn,
        billRefNumber: cell(row, 'accountRef').slice(0, 100) || null,
        msisdn: party.msisdn,
        firstName: party.name ? party.name.split(/\s+/)[0] : null,
      });
    } else if (withdrawn > 0 && paidIn === 0 && CHARGE.test(describedAs)) {
      charges.push({ transId, date, amountCents: withdrawn });
    } else if (withdrawn > 0) {
      skipped.push({ row: line, reason: 'money out, not giving' });
    } else {
      skipped.push({ row: line, reason: 'no amount paid in or withdrawn' });
    }
  }
  const chargesCents = charges.reduce((sum, charge) => sum + charge.amountCents, 0);
  return { gifts, charges, skipped, chargesCents, periodEnd };
}
