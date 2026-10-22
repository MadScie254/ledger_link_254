import { getSupabase } from './supabase';
import { UserError } from './errors';
import { darajaAccessToken, darajaBase, darajaMessage, newToken, sha256, unreachable, withTimeout, type DarajaEnvironment } from './daraja';
import { MpesaPaymentService, type SettleOutcome } from './mpesaPayments';
import {
  darajaTimestamp, maskPhone, normalizeKenyanPhone, parseStkCallback, stkCallbackUrl, stkPushBody,
} from '../utils/mpesaExpress';
import { CALLBACK_TOKEN_PATTERN } from '../utils/mpesaC2b';

const STK_PUSH_PATH = '/mpesa/stkpush/v1/processrequest';

export interface PaymentRequestRow {
  id: string;
  phone: string;
  amountCents: number;
  status: 'PENDING' | 'SENT' | 'PAID' | 'FAILED';
  message: string | null;
  createdAt: string;
  completedAt: string | null;
  /** When paid: whether the payment settled the invoice, or why it waits. */
  settlement: { outcome: 'WAITING' | 'SETTLED'; note: string | null; transId: string } | null;
}

export type StkCallbackOutcome =
  | { status: 'unknown-token' }
  | { status: 'unreadable'; reason: string }
  | { status: 'recorded'; requestStatus: 'PAID' | 'FAILED'; process: () => Promise<SettleOutcome | null> };

/**
 * Pay with M-Pesa: an open invoice asks the customer's phone to pay
 * (Daraja's STK push, paybills only). The rules live in
 * public.create_mpesa_payment_request and public.complete_mpesa_payment_request;
 * a paid result settles the invoice through public.settle_mpesa_payment.
 */
export class MpesaExpressService {
  static async savePasskey(orgId: string, userId: string, passkey: string) {
    const { data, error } = await getSupabase().rpc('save_mpesa_express_passkey', {
      p_org_id: orgId, p_passkey: passkey, p_created_by: userId,
    });
    if (error) throw error;
    return data as { id: string; hasExpressPasskey: boolean };
  }

  /**
   * Sends the push. The request is kept first, so a result that comes back
   * always finds it; Daraja's refusal is kept on it with Safaricom's words.
   */
  static async requestPayment(orgId: string, invoiceId: string, input: { phone: string; amountCents: number }, actor: string, origin: string) {
    const phone = normalizeKenyanPhone(input.phone);
    if (!phone) throw new UserError('Enter the customer\'s Safaricom number, such as 0712 345 678.');
    const supabase = getSupabase();
    const { data: credentialRows, error: credentialError } = await supabase.rpc('mpesa_express_credentials', { p_org_id: orgId });
    if (credentialError) throw credentialError;
    const credentials = (Array.isArray(credentialRows) ? credentialRows[0] : credentialRows) as
      { shortcode: string | null; environment: DarajaEnvironment; consumer_key: string | null; consumer_secret: string | null; passkey: string | null } | undefined;
    if (!credentials?.consumer_key || !credentials.consumer_secret || !credentials.passkey || !credentials.shortcode) {
      throw new UserError('An owner or admin saves the Daraja keys and the M-Pesa Express passkey in Settings, Integrations before invoices can ask for payment.', 409);
    }
    if (credentials.environment === 'PRODUCTION' && !origin.startsWith('https://')) {
      throw new UserError('Safaricom only calls https:// addresses in production. Set PUBLIC_API_ORIGIN to the https address of this app.', 409);
    }

    const token = newToken();
    const { data: created, error: createError } = await supabase.rpc('create_mpesa_payment_request', {
      p_org_id: orgId, p_invoice_id: invoiceId, p_phone: phone, p_amount_cents: input.amountCents,
      p_token_hash: await sha256(token), p_actor: actor,
    });
    if (createError) throw createError;
    const request = created as { id: string; accountReference: string; invoiceNumber: string };

    const record = async (accepted: boolean, message: string, checkoutRequestId: string | null = null, merchantRequestId: string | null = null) => {
      const { error } = await supabase.rpc('record_mpesa_payment_request_sent', {
        p_org_id: orgId, p_request_id: request.id, p_accepted: accepted,
        p_checkout_request_id: checkoutRequestId, p_merchant_request_id: merchantRequestId, p_message: message,
      });
      if (error) throw error;
      return { id: request.id, status: accepted ? 'SENT' as const : 'FAILED' as const, message, phone: maskPhone(phone) };
    };

    const access = await darajaAccessToken(credentials.environment, credentials.consumer_key, credentials.consumer_secret);
    if ('message' in access) return record(false, access.message);
    try {
      const response = await withTimeout(`${darajaBase(credentials.environment)}${STK_PUSH_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(stkPushBody({
          shortcode: credentials.shortcode, passkey: credentials.passkey, timestamp: darajaTimestamp(new Date()),
          amountCents: input.amountCents, phone, callbackUrl: stkCallbackUrl(origin, token), accountReference: request.accountReference,
        })),
      });
      const answer: any = await response.json().catch(() => ({}));
      const checkoutRequestId = String(answer?.CheckoutRequestID ?? '').trim();
      if (!response.ok || String(answer?.ResponseCode ?? '') !== '0' || !checkoutRequestId) {
        return record(false, `Safaricom did not send the request: ${darajaMessage(answer, `HTTP ${response.status}`)}`);
      }
      return record(true, String(answer?.CustomerMessage || answer?.ResponseDescription || 'Sent to the customer\'s phone.').slice(0, 300),
        checkoutRequestId, answer?.MerchantRequestID ? String(answer.MerchantRequestID) : null);
    } catch (err) {
      return record(false, unreachable(err));
    }
  }

  /** Whether invoices can ask for payment: Daraja keys and the passkey saved, the link not disabled. */
  static async ready(orgId: string): Promise<boolean> {
    const { data, error } = await getSupabase().from('org_integrations')
      .select('status, vault_secret_id, express_secret_id, shortcode')
      .eq('org_id', orgId).eq('kind', 'MPESA_C2B').maybeSingle();
    if (error) throw error;
    return Boolean(data && data.status !== 'DISABLED' && data.vault_secret_id && data.express_secret_id && data.shortcode);
  }

  /** An invoice's requests, newest first, each with what became of its payment. */
  static async requestsFor(orgId: string, invoiceId: string): Promise<PaymentRequestRow[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('mpesa_payment_requests')
      .select('id, phone, amount_cents, status, result_message, created_at, completed_at, mpesa_payment_id')
      .eq('org_id', orgId).eq('invoice_id', invoiceId).order('created_at', { ascending: false }).order('id').limit(20);
    if (error) throw error;
    const rows = data ?? [];
    const paymentIds = rows.map((row: any) => row.mpesa_payment_id).filter(Boolean);
    const payments = new Map<string, { outcome: 'WAITING' | 'SETTLED'; note: string | null; transId: string }>();
    if (paymentIds.length) {
      const { data: paid, error: paidError } = await supabase.from('mpesa_payments')
        .select('id, outcome, outcome_note, trans_id').eq('org_id', orgId).in('id', paymentIds);
      if (paidError) throw paidError;
      for (const payment of paid ?? []) payments.set(payment.id, { outcome: payment.outcome, note: payment.outcome_note ?? null, transId: payment.trans_id });
    }
    return rows.map((row: any) => ({
      id: row.id, phone: maskPhone(row.phone), amountCents: Number(row.amount_cents), status: row.status,
      message: row.result_message ?? null, createdAt: row.created_at, completedAt: row.completed_at ?? null,
      settlement: row.mpesa_payment_id ? payments.get(row.mpesa_payment_id) ?? null : null,
    }));
  }

  /**
   * Safaricom's result for one request. It is recorded before Safaricom is
   * answered; settling the invoice runs afterwards (process), in the name of
   * the person who asked.
   */
  static async receiveCallback(token: string, body: unknown): Promise<StkCallbackOutcome> {
    if (!CALLBACK_TOKEN_PATTERN.test(token)) return { status: 'unknown-token' };
    const parsed = parseStkCallback(body);
    if ('reason' in parsed) return { status: 'unreadable', reason: parsed.reason };
    const { result } = parsed;
    const { data, error } = await getSupabase().rpc('complete_mpesa_payment_request', {
      p_token_hash: await sha256(token),
      p_checkout_request_id: result.checkoutRequestId,
      p_result_code: result.resultCode,
      p_result_desc: result.resultDesc,
      p_payment: result.payment ? { ...result.payment, raw: body } : null,
    });
    if (error) throw error;
    if (!data) return { status: 'unknown-token' };
    const outcome = data as { orgId: string; status: 'PAID' | 'FAILED'; paymentId: string | null; requestedBy: string | null };
    return {
      status: 'recorded',
      requestStatus: outcome.status,
      process: async () => outcome.status === 'PAID' && outcome.paymentId
        ? MpesaPaymentService.settle(outcome.orgId, outcome.paymentId, outcome.requestedBy)
        : null,
    };
  }
}
