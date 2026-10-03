import { createClient } from '@supabase/supabase-js';
import { currentActorId } from './requestContext';

const supabaseUrl = process.env.SUPABASE_URL || '';
// Supabase's publishable/secret key format replaces the legacy anon/service
// role JWTs. Keep the legacy name as a migration fallback until it is retired.
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * The privileged Supabase client, used only inside the authenticated Worker
 * API. Requests made on behalf of a signed-in person carry their id in the
 * x-ledger-actor header so database audit rows name them.
 */
export const getSupabase = () => {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) are required.');
  }
  const actorId = currentActorId();
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: actorId ? { headers: { 'x-ledger-actor': actorId } } : undefined,
  });
};
