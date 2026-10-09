import { getSupabase } from './supabase';
import { UserError } from './errors';
import { GivingService, type AutoPostResult, type KeptReceipt } from './giving';
import {
  CALLBACK_TOKEN_PATTERN, callbackUrls, constantTimeEqual, forbiddenUrlWords, parseC2bConfirmation,
} from '../utils/mpesaC2b';
import type { StatementCharge, StatementGift } from '../utils/mpesaStatement';

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));

const DARAJA_BASE: Record<'SANDBOX' | 'PRODUCTION', string> = {
  SANDBOX: 'https://sandbox.safaricom.co.ke',
  PRODUCTION: 'https://api.safaricom.co.ke',
};
// Overridable so the register call can be tried against a stand-in.
const darajaBase = (environment: 'SANDBOX' | 'PRODUCTION') =>
  (environment === 'SANDBOX' ? process.env.DARAJA_SANDBOX_BASE_URL : process.env.DARAJA_PRODUCTION_BASE_URL)
  || DARAJA_BASE[environment];
const REGISTER_PATH = '/mpesa/c2b/v1/registerurl';
const DARAJA_TIMEOUT_MS = 15_000;

export interface CallbackTarget {
  orgId: string;
  shortcode: string | null;
  integrationActorId: string | null;
}

export type ConfirmationOutcome =
  | { status: 'unknown-token' }
  | { status: 'unreadable'; reason: string }
  | { status: 'kept'; orgId: string; receipt: KeptReceipt; process: () => Promise<AutoPostResult> };

export interface IntegrationSettingsInput {
  shortcode: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  consumerKey?: string;
  consumerSecret?: string;
  integrationActorId: string | null;
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DARAJA_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const darajaMessage = (body: any, fallback: string) =>
  String(body?.errorMessage || body?.ResponseDescription || body?.error_description || fallback).slice(0, 300);

export class MpesaC2bService {
  /** The church a callback token belongs to, or null. Only the token's SHA-256 is stored. */
  static async target(token: string): Promise<CallbackTarget | null> {
    if (!CALLBACK_TOKEN_PATTERN.test(token)) return null;
    const hash = await sha256(token);
    const { data, error } = await getSupabase().rpc('mpesa_callback_target', { p_token_hash: hash });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !constantTimeEqual(String(row.token_hash ?? ''), hash)) return null;
    return { orgId: row.org_id, shortcode: row.shortcode, integrationActorId: row.integration_actor_id };
  }

  /**
   * A C2B confirmation: the receipt is kept before Safaricom is answered, so
   * nothing is lost if posting fails; matching and posting run afterwards
   * (process), and a receipt they cannot place waits in the queue.
   */
  static async receiveConfirmation(token: string, body: unknown): Promise<ConfirmationOutcome> {
    const target = await MpesaC2bService.target(token);
    if (!target) return { status: 'unknown-token' };
    const parsed = parseC2bConfirmation(body);
    if ('reason' in parsed) return { status: 'unreadable', reason: parsed.reason };
    const { receipt } = parsed;
    const { data, error } = await getSupabase().rpc('ingest_mpesa_receipts', {
      p_org_id: target.orgId,
      p_source: 'C2B_CALLBACK',
      p_receipts: [{
        transId: receipt.transId, transTime: receipt.transTime, amountCents: receipt.amountCents,
        billRefNumber: receipt.billRefNumber, msisdn: receipt.msisdn, firstName: receipt.firstName,
        raw: body,
      }],
      p_created_by: null,
    });
    if (error) throw error;
    const kept = ((data ?? []) as KeptReceipt[])[0];
    if (!kept) throw new Error('The M-Pesa receipt was not kept.');
    return {
      status: 'kept',
      orgId: target.orgId,
      receipt: kept,
      process: () => GivingService.autoPost(target.orgId, target.integrationActorId, [kept], 'MPESA_C2B'),
    };
  }

  /**
   * An uploaded M-Pesa statement: gifts are kept once each and placed by
   * the giving rules in the uploader's name; charges post once each.
   */
  static async uploadStatement(orgId: string, userId: string, input: { gifts: StatementGift[]; charges: StatementCharge[] }) {
    const supabase = getSupabase();
    let kept: KeptReceipt[] = [];
    if (input.gifts.length) {
      const { data, error } = await supabase.rpc('ingest_mpesa_receipts', {
        p_org_id: orgId,
        p_source: 'STATEMENT_UPLOAD',
        p_receipts: input.gifts.map((gift) => ({ ...gift, raw: { source: 'statement' } })),
        p_created_by: userId,
      });
      if (error) throw error;
      kept = (data ?? []) as KeptReceipt[];
    }
    const placed = await GivingService.autoPost(orgId, userId, kept, 'MPESA_STATEMENT');
    let charges = { journalEntryId: null as string | null, charges: 0, amountCents: 0, alreadyRecorded: 0 };
    if (input.charges.length) {
      const { data, error } = await supabase.rpc('record_statement_charges', {
        p_org_id: orgId, p_charges: input.charges, p_created_by: userId,
      });
      if (error) throw error;
      charges = {
        journalEntryId: data?.journalEntryId ?? null, charges: Number(data?.charges) || 0,
        amountCents: Number(data?.amountCents) || 0, alreadyRecorded: Number(data?.alreadyRecorded) || 0,
      };
    }
    return {
      lines: input.gifts.length,
      newReceipts: kept.filter((receipt) => receipt.inserted).length,
      alreadyKept: kept.filter((receipt) => !receipt.inserted).length,
      posted: placed.posted,
      queued: placed.queued,
      charges,
    };
  }

  /** What the Settings page shows. Never the consumer key or secret. */
  static async settings(orgId: string) {
    const supabase = getSupabase();
    const [integration, organization] = await Promise.all([
      supabase.from('org_integrations')
        .select('id,shortcode,environment,status,registered_at,last_error,vault_secret_id,callback_token_hash,updated_at')
        .eq('org_id', orgId).eq('kind', 'MPESA_C2B').maybeSingle(),
      supabase.from('organizations').select('integration_actor_id').eq('id', orgId).maybeSingle(),
    ]);
    if (integration.error) throw integration.error;
    if (organization.error) throw organization.error;
    const row = integration.data;
    return {
      configured: Boolean(row),
      shortcode: row?.shortcode ?? null,
      environment: (row?.environment ?? 'SANDBOX') as 'SANDBOX' | 'PRODUCTION',
      status: (row?.status ?? 'DRAFT') as 'DRAFT' | 'REGISTERED' | 'DISABLED',
      registeredAt: row?.registered_at ?? null,
      lastError: row?.last_error ?? null,
      hasCredentials: Boolean(row?.vault_secret_id),
      hasCallbackUrls: Boolean(row?.callback_token_hash),
      integrationActorId: organization.data?.integration_actor_id ?? null,
    };
  }

  static async saveSettings(orgId: string, userId: string, input: IntegrationSettingsInput) {
    const { data, error } = await getSupabase().rpc('save_mpesa_integration', {
      p_org_id: orgId,
      p_shortcode: input.shortcode,
      p_environment: input.environment,
      p_consumer_key: input.consumerKey || null,
      p_consumer_secret: input.consumerSecret || null,
      p_integration_actor_id: input.integrationActorId,
      p_created_by: userId,
    });
    if (error) throw error;
    return data as { id: string; hasCredentials: boolean };
  }

  /** The origin the callback URLs are built on: PUBLIC_API_ORIGIN when set, else the request's own. */
  static callbackOrigin(requestUrl: string) {
    return (process.env.PUBLIC_API_ORIGIN || new URL(requestUrl).origin).replace(/\/+$/, '');
  }

  /**
   * New callback URLs, shown once, for a church that registers them with
   * Safaricom itself. The URLs carry a fresh token; the old ones stop working.
   */
  static async issueCallbackUrls(orgId: string, userId: string, origin: string) {
    const token = newToken();
    const { error } = await getSupabase().rpc('set_mpesa_callback_token', {
      p_org_id: orgId, p_token_hash: await sha256(token), p_created_by: userId,
    });
    if (error) throw error;
    return callbackUrls(origin, token);
  }

  /**
   * Registers the church's confirmation and validation URLs with Daraja
   * (C2B Register URL), with the consumer key and secret read from Vault
   * here in the Worker. A fresh token goes into the URLs; it replaces the
   * old one only when Safaricom accepts them.
   */
  static async register(orgId: string, userId: string, origin: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('mpesa_integration_credentials', { p_org_id: orgId });
    if (error) throw error;
    const credentials = (Array.isArray(data) ? data[0] : data) as
      { shortcode: string | null; environment: 'SANDBOX' | 'PRODUCTION'; consumer_key: string | null; consumer_secret: string | null } | undefined;
    if (!credentials?.consumer_key || !credentials.consumer_secret) {
      throw new UserError('Save the Daraja consumer key and secret first.', 409);
    }
    if (!credentials.shortcode) throw new UserError('Save the church\'s paybill or till number first.', 409);
    if (credentials.environment === 'PRODUCTION' && !origin.startsWith('https://')) {
      throw new UserError('Safaricom only calls https:// addresses in production. Set PUBLIC_API_ORIGIN to the https address of this app.', 409);
    }
    const token = newToken();
    const urls = callbackUrls(origin, token);
    const refused = forbiddenUrlWords(urls.confirmationUrl);
    if (refused.length) {
      throw new UserError(`Daraja refuses URLs containing ${refused.join(', ')}. Serve the app from an address without ${refused.length === 1 ? 'that word' : 'those words'}.`, 409);
    }
    const base = darajaBase(credentials.environment);

    const fail = async (message: string) => {
      const { error: recordError } = await supabase.rpc('record_mpesa_registration', {
        p_org_id: orgId, p_token_hash: null, p_succeeded: false, p_message: message, p_created_by: userId,
      });
      if (recordError) throw recordError;
      return { registered: false as const, message };
    };

    let accessToken = '';
    try {
      const basic = btoa(`${credentials.consumer_key}:${credentials.consumer_secret}`);
      const response = await withTimeout(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
        method: 'GET', headers: { Authorization: `Basic ${basic}` },
      });
      const body: any = await response.json().catch(() => ({}));
      if (!response.ok || !body?.access_token) {
        return fail(`Daraja did not accept the consumer key and secret: ${darajaMessage(body, `HTTP ${response.status}`)}`);
      }
      accessToken = String(body.access_token);
    } catch (err) {
      return fail(`Daraja could not be reached: ${err instanceof Error ? err.message.slice(0, 200) : 'no answer'}`);
    }

    let answer: any = {};
    try {
      const response = await withTimeout(`${base}${REGISTER_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ShortCode: credentials.shortcode,
          // Complete the payment if the validation URL cannot be reached.
          ResponseType: 'Completed',
          ConfirmationURL: urls.confirmationUrl,
          ValidationURL: urls.validationUrl,
        }),
      });
      answer = await response.json().catch(() => ({}));
      const accepted = response.ok && (String(answer?.ResponseCode ?? '') === '0' || /success/i.test(String(answer?.ResponseDescription ?? '')));
      if (!accepted) return fail(`Safaricom did not register the URLs: ${darajaMessage(answer, `HTTP ${response.status}`)}`);
    } catch (err) {
      return fail(`Daraja could not be reached: ${err instanceof Error ? err.message.slice(0, 200) : 'no answer'}`);
    }

    const message = darajaMessage(answer, 'Registered');
    const { error: recordError } = await supabase.rpc('record_mpesa_registration', {
      p_org_id: orgId, p_token_hash: await sha256(token), p_succeeded: true, p_message: message, p_created_by: userId,
    });
    if (recordError) throw recordError;
    return { registered: true as const, message };
  }
}
