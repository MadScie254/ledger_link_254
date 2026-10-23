/**
 * Safaricom Daraja, as the Worker calls it: the base address for sandbox or
 * production (overridable so tests can use a stand-in), a time limit on each
 * call, the access token from the app's consumer key and secret, and the
 * callback tokens the URLs carry (only their SHA-256 is stored).
 */

export type DarajaEnvironment = 'SANDBOX' | 'PRODUCTION';

const DARAJA_BASE: Record<DarajaEnvironment, string> = {
  SANDBOX: 'https://sandbox.safaricom.co.ke',
  PRODUCTION: 'https://api.safaricom.co.ke',
};
const DARAJA_TIMEOUT_MS = 15_000;

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
export const sha256 = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
/** 32 random bytes as lower-case hex. */
export const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));

export const darajaBase = (environment: DarajaEnvironment) =>
  (environment === 'SANDBOX' ? process.env.DARAJA_SANDBOX_BASE_URL : process.env.DARAJA_PRODUCTION_BASE_URL)
  || DARAJA_BASE[environment];

export async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DARAJA_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const darajaMessage = (body: any, fallback: string) =>
  String(body?.errorMessage || body?.ResponseDescription || body?.error_description || fallback).slice(0, 300);

export const unreachable = (err: unknown) =>
  `Daraja could not be reached: ${err instanceof Error ? err.message.slice(0, 200) : 'no answer'}`;

/** An access token for the app, or the reason Daraja gave none. */
export async function darajaAccessToken(environment: DarajaEnvironment, consumerKey: string, consumerSecret: string):
  Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  try {
    const basic = btoa(`${consumerKey}:${consumerSecret}`);
    const response = await withTimeout(`${darajaBase(environment)}/oauth/v1/generate?grant_type=client_credentials`, {
      method: 'GET', headers: { Authorization: `Basic ${basic}` },
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok || !body?.access_token) {
      return { ok: false, message: `Daraja did not accept the consumer key and secret: ${darajaMessage(body, `HTTP ${response.status}`)}` };
    }
    return { ok: true, token: String(body.access_token) };
  } catch (err) {
    return { ok: false, message: unreachable(err) };
  }
}
