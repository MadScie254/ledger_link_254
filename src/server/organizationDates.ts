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

/**
 * The moment report periods are counted from: noon UTC on the
 * organization's own today, so "this month" or "year to date" ends on the
 * day it is where the business is, not the day it is in UTC.
 */
export async function organizationNow(orgId: string): Promise<Date> {
  return new Date(`${await organizationToday(orgId)}T12:00:00Z`);
}
