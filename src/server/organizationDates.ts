import { getSupabase } from './supabase';
import { todayIn } from '../utils/dates';

/** Today's date in the organization's own time zone (Nairobi unless set otherwise). */
export async function organizationToday(orgId: string): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('organizations')
    .select('time_zone')
    .eq('id', orgId)
    .maybeSingle();
  if (error) throw error;
  return todayIn(data?.time_zone);
}
