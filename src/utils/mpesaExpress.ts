/**
 * M-Pesa Express (Daraja's STK push), the parts that need no network: the
 * customer's number as Daraja takes it, the timestamp and password Daraja
 * checks, the request body, and Safaricom's result as it comes back. Field
 * names follow the published Daraja samples; docs/mpesa-c2b-fields.md says
 * what is still to be checked in the sandbox.
 */

/** 0712 345 678, +254 712 345 678 or 712345678 as 254712345678; null for anything else. */
export function normalizeKenyanPhone(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;
  const local = digits.startsWith('254') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
  return /^[17]\d{8}$/.test(local) ? `254${local}` : null;
}

/** 254712345678 as 0712 *** 678, for showing who was asked without the whole number. */
export function maskPhone(phone: string): string {
  return /^254\d{9}$/.test(phone) ? `0${phone.slice(3, 6)} *** ${phone.slice(-3)}` : 'number hidden';
}

/** yyyyMMddHHmmss in Nairobi time, as Daraja's Timestamp field takes it. */
export function darajaTimestamp(at: Date): string {
  const nairobi = new Date(at.getTime() + 3 * 60 * 60 * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${nairobi.getUTCFullYear()}${two(nairobi.getUTCMonth() + 1)}${two(nairobi.getUTCDate())}`
    + `${two(nairobi.getUTCHours())}${two(nairobi.getUTCMinutes())}${two(nairobi.getUTCSeconds())}`;
}

/** Base64 of shortcode, passkey and timestamp, which Daraja checks on each push. */
export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return btoa(`${shortcode}${passkey}${timestamp}`);
}

export interface StkPushInput {
  shortcode: string;
  passkey: string;
  timestamp: string;
  /** Whole shillings, in cents. */
  amountCents: number;
  phone: string;
  callbackUrl: string;
  /** The invoice's number in letters and digits, at most 12. */
  accountReference: string;
}

/**
 * The body of a paybill STK push (CustomerPayBillOnline). The shortcode,
 * amount and numbers go as JSON numbers, as in Daraja's published sample.
 */
export function stkPushBody(input: StkPushInput) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 100 || input.amountCents % 100 !== 0) {
    throw new Error('M-Pesa takes whole shillings, at least 1.');
  }
  if (!/^[A-Z0-9]{1,12}$/.test(input.accountReference)) throw new Error('The account reference is 1 to 12 letters and digits.');
  if (!/^[0-9]{5,10}$/.test(input.shortcode)) throw new Error('The paybill number is 5 to 10 digits.');
  if (!/^254[17]\d{8}$/.test(input.phone)) throw new Error('The customer\'s number is not a Safaricom number.');
  return {
    BusinessShortCode: Number(input.shortcode),
    Password: stkPassword(input.shortcode, input.passkey, input.timestamp),
    Timestamp: input.timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: input.amountCents / 100,
    PartyA: Number(input.phone),
    PartyB: Number(input.shortcode),
    PhoneNumber: Number(input.phone),
    CallBackURL: input.callbackUrl,
    AccountReference: input.accountReference,
    // Daraja allows 13 characters here.
    TransactionDesc: 'Invoice',
  };
}

/** Where Safaricom sends one request's result. Daraja refuses URLs naming M-Pesa or Safaricom. */
export function stkCallbackUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/api/public/payments/stk/${token}`;
}

/** The answer a result URL gives Safaricom. */
export const STK_ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' } as const;

export interface StkResult {
  checkoutRequestId: string;
  merchantRequestId: string | null;
  /** 0 is paid; 1032 cancelled on the phone; 1037 the phone could not be reached; others are refusals. */
  resultCode: string;
  resultDesc: string | null;
  /** Present only when paid. */
  payment: { transId: string; transTime: string; amountCents: number; msisdn: string | null } | null;
}

const item = (items: unknown, name: string): unknown => {
  if (!Array.isArray(items)) return undefined;
  const found = items.find((entry: any) => entry && typeof entry === 'object' && entry.Name === name) as any;
  return found?.Value;
};

/** 20261004081522 (Nairobi time) as 2026-10-04T08:15:22+03:00, or null. */
function resultTime(value: unknown): string | null {
  const match = String(value ?? '').trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || check.getUTCMonth() !== month - 1 || hour > 23 || minute > 59 || second > 59) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+03:00`;
}

/** Safaricom's STK result body, or why it cannot be read. */
export function parseStkCallback(body: unknown): { ok: true; result: StkResult } | { ok: false; reason: string } {
  const callback = (body as any)?.Body?.stkCallback;
  if (!callback || typeof callback !== 'object') return { ok: false, reason: 'The body has no Body.stkCallback.' };
  const checkoutRequestId = String(callback.CheckoutRequestID ?? '').trim();
  if (!checkoutRequestId || checkoutRequestId.length > 100) return { ok: false, reason: 'CheckoutRequestID is missing.' };
  if (callback.ResultCode === undefined || callback.ResultCode === null || String(callback.ResultCode).trim() === '') {
    return { ok: false, reason: 'ResultCode is missing.' };
  }
  const resultCode = String(callback.ResultCode).trim().slice(0, 20);
  const resultDesc = callback.ResultDesc ? String(callback.ResultDesc).slice(0, 300) : null;
  const merchantRequestId = callback.MerchantRequestID ? String(callback.MerchantRequestID).slice(0, 100) : null;
  if (resultCode !== '0') {
    return { ok: true, result: { checkoutRequestId, merchantRequestId, resultCode, resultDesc, payment: null } };
  }
  const items = callback.CallbackMetadata?.Item;
  const transId = String(item(items, 'MpesaReceiptNumber') ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,30}$/.test(transId)) return { ok: false, reason: 'MpesaReceiptNumber is missing from a paid result.' };
  const amount = Number(item(items, 'Amount'));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'Amount is missing from a paid result.' };
  const transTime = resultTime(item(items, 'TransactionDate'));
  if (!transTime) return { ok: false, reason: 'TransactionDate is missing from a paid result.' };
  const phone = item(items, 'PhoneNumber');
  return {
    ok: true,
    result: {
      checkoutRequestId, merchantRequestId, resultCode, resultDesc,
      payment: {
        transId, transTime, amountCents: Math.round(amount * 100),
        msisdn: phone === undefined || phone === null ? null : String(phone).slice(0, 100),
      },
    },
  };
}
