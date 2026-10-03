import type { Context } from 'hono';
import { getSupabase } from '../src/server/supabase';
import { UserError } from '../src/server/errors';
import { publicError, isRawDatabaseError } from '../src/server/publicMessage';

export { UserError, publicError };

/** Logs what is needed to diagnose a failure without the row values a database error can carry. */
export function logError(label: string, err: unknown) {
  const code = err && typeof err === 'object' && typeof (err as any).code === 'string' ? (err as any).code : '';
  const name = err instanceof Error ? err.name : typeof err;
  const raw = err && typeof err === 'object' && typeof (err as any).message === 'string' ? (err as any).message : '';
  const message = isRawDatabaseError(err) ? '(database constraint message withheld)' : raw.slice(0, 300);
  console.error(`[API] ${label}:`, name, code || '-', message);
}

export function respondError(c: Context, err: unknown) {
  const { status, message } = publicError(err);
  logError(status >= 500 ? 'Server error' : 'Request refused', err);
  return c.json({ error: message }, status);
}

/** The request body as JSON, or {} when it is missing or not JSON. */
export const bodyOf = (c: Context): Promise<any> => c.req.json().catch(() => ({}));

/**
 * Counts this call against each limit and refuses with 429 once any is
 * exceeded. Limits are fixed windows kept in Postgres
 * (public.consume_rate_limit), so they hold across Worker instances.
 */
export async function enforceRateLimits(limits: Array<{ key: string; limit: number; windowSeconds: number }>, message: string) {
  const supabase = getSupabase();
  for (const { key, limit, windowSeconds } of limits) {
    const { data, error } = await supabase.rpc('consume_rate_limit', {
      p_bucket: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    if (data === false) throw new UserError(message, 429);
  }
}

export const HOUR = 3600;
export const DAY = 86400;
