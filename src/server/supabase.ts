import { createClient } from '@supabase/supabase-js';
import { contextHeaders } from './requestContext';

const supabaseUrl = process.env.SUPABASE_URL || '';
// Supabase's publishable/secret key format replaces the legacy anon/service
// role JWTs. Keep the legacy name as a migration fallback until it is retired.
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * The privileged Supabase client, used only inside the authenticated Worker
 * API. Requests made on behalf of a signed-in person carry their id in the
 * x-ledger-actor header so database audit rows name them, and a posting's
 * class and location in x-ledger-class and x-ledger-location.
 */
export const getSupabase = () => {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) are required.');
  }
  const headers = contextHeaders();
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: Object.keys(headers).length ? { headers } : undefined,
  });
};
