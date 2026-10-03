import { useAppStore } from '../store';
import { useMonitoringStore } from './monitoring';
import { supabase } from '../lib/supabase';

let apiFetchInstalled = false;

function isSameOriginApiRequest(input: RequestInfo | URL): boolean {
  if (typeof window === 'undefined') return false;

  const rawUrl = input instanceof Request ? input.url : input.toString();
  const url = new URL(rawUrl, window.location.origin);
  return url.origin === window.location.origin && url.pathname.startsWith('/api/');
}

/**
 * Compatibility bridge for existing API calls. New code should import
 * `fetchWithTenant`; this makes older `fetch('/api/...')` callers carry the
 * same verified session and active organization until they are migrated.
 */
export function installAuthenticatedApiFetch() {
  if (typeof window === 'undefined' || apiFetchInstalled) return;
  apiFetchInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isSameOriginApiRequest(input)) {
      return nativeFetch(input, init);
    }

    const requestHeaders = input instanceof Request ? input.headers : undefined;
    const headers = new Headers(init?.headers || requestHeaders);
    const { currentOrgId } = useAppStore.getState();
    // Supabase keeps the session and refreshes it before it expires; asking
    // it each time means no second copy of the token is kept anywhere.
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (currentOrgId && !headers.has('x-org-id')) {
      headers.set('x-org-id', currentOrgId);
    }
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const url = typeof input === 'string' ? input : input.toString();
    const start = performance.now();

    try {
      const response = await nativeFetch(input, { ...init, headers });
      useMonitoringStore.getState().recordApiCall(url, performance.now() - start, response.status);
      return response;
    } catch (error) {
      useMonitoringStore.getState().recordApiCall(url, performance.now() - start, 0);
      throw error;
    }
  };
}

export async function fetchWithTenant(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}
