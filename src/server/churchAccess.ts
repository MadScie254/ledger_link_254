import { getSupabase } from './supabase';
import { UserError } from './errors';

export async function assertChurchEdition(orgId: string): Promise<void> {
  const { data, error } = await getSupabase().from('organizations')
    .select('edition').eq('id', orgId).maybeSingle();
  if (error) throw error;
  if (data?.edition !== 'church') {
    throw new UserError('This action is available in Kundi church organizations.', 403);
  }
}
