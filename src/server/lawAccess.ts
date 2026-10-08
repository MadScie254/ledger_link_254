import { getSupabase } from './supabase';
import { UserError } from './errors';

export async function assertLawEdition(orgId: string): Promise<void> {
  const { data, error } = await getSupabase().from('organizations')
    .select('edition').eq('id', orgId).maybeSingle();
  if (error) throw error;
  if (data?.edition !== 'law') {
    throw new UserError('This action is available in Mizani law organizations.', 403);
  }
}
