import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { UserError } from './errors';
import { renderLawCalendar, type CalendarEvent } from '../utils/lawCalendar';

type EventInput = { matterId: string; eventType: string; startsAt: string;
  court?: string; courtroom?: string; judicialOfficer?: string };
type EventUpdate = Partial<Omit<EventInput, 'matterId'>> & {
  status?: string; outcome?: string | null; nextEventId?: string | null;
  noFurtherDate?: boolean;
};

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest(
  'SHA-256', new TextEncoder().encode(value),
)));

export class CourtEventService {
  static async list(orgId: string, filters: { from?: string; to?: string; matterId?: string } = {}) {
    const supabase = getSupabase();
    return fetchAllRows<any>((from, to) => {
      let query = supabase.from('court_events')
        .select('*,matters!inner(title,matter_number,responsible_user_id)')
        .eq('org_id', orgId).order('starts_at').order('id').range(from, to);
      if (filters.from) query = query.gte('starts_at', filters.from);
      if (filters.to) query = query.lte('starts_at', filters.to);
      if (filters.matterId) query = query.eq('matter_id', filters.matterId);
      return query;
    });
  }

  static async create(orgId: string, actor: string, input: EventInput) {
    const { data, error } = await getSupabase().from('court_events').insert({
      org_id: orgId, matter_id: input.matterId, event_type: input.eventType,
      starts_at: input.startsAt, court: input.court, courtroom: input.courtroom,
      judicial_officer: input.judicialOfficer, created_by: actor,
    }).select('id').single();
    if (error) throw error;
    return data.id as string;
  }

  static async update(orgId: string, eventId: string, input: EventUpdate) {
    const fields: Record<string, string> = {
      eventType: 'event_type', startsAt: 'starts_at', court: 'court',
      courtroom: 'courtroom', judicialOfficer: 'judicial_officer',
      status: 'status', outcome: 'outcome', nextEventId: 'next_event_id',
      noFurtherDate: 'no_further_date',
    };
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (fields[key]) update[fields[key]] = value;
    }
    if (!Object.keys(update).length) throw new UserError('Choose a court event field to change.');
    const { data, error } = await getSupabase().from('court_events').update(update)
      .eq('org_id', orgId).eq('id', eventId).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('Court event not found.', 404);
  }

  static async rotateCalendarToken(orgId: string, userId: string) {
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256(token);
    const { error } = await getSupabase().from('calendar_tokens').upsert({
      org_id: orgId, user_id: userId, token_hash: tokenHash,
      created_at: new Date().toISOString(),
    }, { onConflict: 'org_id,user_id' });
    if (error) throw error;
    return token;
  }

  static async calendarForToken(token: string) {
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const tokenHash = await sha256(token);
    const supabase = getSupabase();
    const { data: credential, error: credentialError } = await supabase
      .from('calendar_tokens').select('org_id,user_id').eq('token_hash', tokenHash).maybeSingle();
    if (credentialError) throw credentialError;
    if (!credential) return null;
    const events = await fetchAllRows<any>((from, to) => supabase.from('court_events')
      .select('id,event_type,starts_at,court,courtroom,status,matters!inner(title,matter_number,responsible_user_id)')
      .eq('org_id', credential.org_id)
      .eq('matters.responsible_user_id', credential.user_id)
      .neq('status', 'CANCELLED')
      .order('starts_at').order('id').range(from, to));
    const mapped: CalendarEvent[] = events.map((event) => ({
      id: event.id, startsAt: event.starts_at, eventType: event.event_type,
      matterNumber: event.matters.matter_number, matterTitle: event.matters.title,
      court: event.court, courtroom: event.courtroom,
    }));
    return renderLawCalendar(mapped, new Date());
  }
}
