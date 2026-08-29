import { useAppStore } from '../store';
import { useMonitoringStore } from './monitoring';

export async function fetchWithTenant(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const orgId = useAppStore.getState().currentOrgId || 'default-org-id';
  
  const headers = new Headers(init?.headers);
  if (!headers.has('x-org-id')) {
    headers.set('x-org-id', orgId);
  }

  const url = typeof input === 'string' ? input : input.toString();
  const start = performance.now();
  
  try {
    const response = await fetch(input, {
      ...init,
      headers
    });
    const duration = performance.now() - start;
    
    // Only log if we are in browser (not SSR)
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        useMonitoringStore.getState().recordApiCall(url, duration, response.status);
      }, 0);
    }
    
    return response;
  } catch (err) {
    const duration = performance.now() - start;
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        useMonitoringStore.getState().recordApiCall(url, duration, 0);
      }, 0);
    }
    throw err;
  }
}
