/**
 * Calls the Worker API and returns its JSON, or throws an Error carrying the
 * API's own sentence (it is written for people) when the call is refused.
 * The session token and organization header are added by the fetch bridge
 * in ./api.
 */
export async function apiRequest<T = any>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; fallback?: string; headers?: Record<string, string> } = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    method: options.method || (hasBody ? 'POST' : 'GET'),
    headers: hasBody || options.headers ? { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data && typeof data.error === 'string' && data.error) || options.fallback || 'That did not go through. Try again.');
  }
  return data as T;
}

/** A fresh key for a posting request, so a retry or double click posts once. */
export const newIdempotencyKey = () => crypto.randomUUID();

/** The most records one bulk request may carry; larger selections are sent in parts. */
export const BULK_LIMIT = 40;

/** Splits a list into parts of at most `size`. */
export function inParts<T>(items: T[], size = BULK_LIMIT): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
}
