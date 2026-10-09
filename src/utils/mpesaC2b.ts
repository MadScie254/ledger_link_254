/**
 * Safaricom's C2B confirmation: what the Daraja callback body holds and how
 * it becomes an M-Pesa receipt. Field names follow the published Daraja
 * samples; docs/mpesa-c2b-fields.md records what was checked and what is
 * still to be confirmed in the sandbox.
 */

export interface C2bReceipt {
  transId: string;
  /** ISO 8601 with the Nairobi offset, from TransTime (yyyyMMddHHmmss, East Africa Time). */
  transTime: string;
  amountCents: number;
  billRefNumber: string | null;
  /** Kept as sent; Safaricom masks it, so it is never used for matching. */
  msisdn: string | null;
  firstName: string | null;
  shortcode: string | null;
  transactionType: string | null;
}

/** The acknowledgement Daraja expects from the validation and confirmation URLs. */
export const C2B_ACCEPTED = { ResultCode: '0', ResultDesc: 'Accepted' } as const;
export const C2B_REJECTED = { ResultCode: 'C2B00016', ResultDesc: 'Rejected' } as const;

/** A callback token: 32 random bytes as lower-case hex. */
export const CALLBACK_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** The largest callback body read; real ones are well under 1 KB. */
export const C2B_MAX_BODY_BYTES = 16 * 1024;

/** 20261004081522 (Nairobi time) as 2026-10-04T08:15:22+03:00, or null when it is not a real time. */
export function darajaTimeToIso(value: unknown): string | null {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+03:00`;
}

/** "150.00", "150" or 150 as 15000 cents; null for anything that is not a positive shilling amount. */
export function amountToCents(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

const text = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/[\u0000-\u001f]/g, '').trim();
  return cleaned ? cleaned.slice(0, max) : null;
};

/** The receipt in a confirmation body, or why it cannot be read. */
export function parseC2bConfirmation(body: unknown):
  | { ok: true; receipt: C2bReceipt }
  | { ok: false; reason: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'The body is not a JSON object.' };
  const fields = body as Record<string, unknown>;
  const transId = String(fields.TransID ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,30}$/.test(transId)) return { ok: false, reason: 'TransID is missing or not an M-Pesa code.' };
  const transTime = darajaTimeToIso(fields.TransTime);
  if (!transTime) return { ok: false, reason: 'TransTime is missing or not yyyyMMddHHmmss.' };
  const amountCents = amountToCents(fields.TransAmount);
  if (amountCents === null) return { ok: false, reason: 'TransAmount is missing or not a positive amount.' };
  const names = [fields.FirstName, fields.MiddleName, fields.LastName].map((value) => text(value, 40)).filter(Boolean);
  return {
    ok: true,
    receipt: {
      transId,
      transTime,
      amountCents,
      billRefNumber: text(fields.BillRefNumber, 100),
      msisdn: text(fields.MSISDN, 100),
      firstName: names.length ? names.join(' ').slice(0, 100) : null,
      shortcode: text(fields.BusinessShortCode, 20),
      transactionType: text(fields.TransactionType, 40),
    },
  };
}

/** Compares two strings without returning early, so the time taken does not say how much matched. */
export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

/**
 * The URLs registered with Safaricom. Daraja refuses URLs containing words
 * such as M-Pesa or Safaricom, so the registered path says "giving"; the
 * Worker also answers on /api/public/mpesa/c2b/... for the same token.
 */
export function callbackUrls(origin: string, token: string) {
  const base = `${origin.replace(/\/+$/, '')}/api/public/giving/c2b/${token}`;
  return { confirmationUrl: `${base}/confirmation`, validationUrl: `${base}/validation` };
}

const FORBIDDEN_URL_WORDS = ['m-pesa', 'mpesa', 'safaricom', 'exec', 'exe', 'cmd', 'sql', 'query'];

/** Words in a URL that Daraja's Register URL refuses, per its published guidance. */
export function forbiddenUrlWords(url: string): string[] {
  const lower = url.toLowerCase();
  const found = FORBIDDEN_URL_WORDS.filter((word) => lower.includes(word));
  return found.filter((word) => !(word === 'exe' && found.includes('exec')) && !(word === 'mpesa' && found.includes('m-pesa')));
}
