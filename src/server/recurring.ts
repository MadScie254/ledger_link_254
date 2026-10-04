import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';

export type RecurringKind = 'INVOICE' | 'BILL';
export type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

function one(value: any) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function mapTemplate(row: any) {
  return {
    id: row.id,
    kind: row.kind as RecurringKind,
    name: row.name,
    customerId: row.customer_id,
    vendorId: row.vendor_id,
    partyName: one(row.customer)?.display_name ?? one(row.vendor)?.display_name ?? null,
    sourceDocumentId: row.source_document_id,
    totalCents: Number(row.total_cents) || 0,
    lineCount: Array.isArray(row.lines) ? row.lines.length : 0,
    firstLine: Array.isArray(row.lines) && row.lines[0] ? String(row.lines[0].description || '') : '',
    frequency: row.frequency as Frequency,
    intervalCount: Number(row.interval_count) || 1,
    startDate: row.start_date,
    endDate: row.end_date,
    maxOccurrences: row.max_occurrences == null ? null : Number(row.max_occurrences),
    daysUntilDue: Number(row.days_until_due) || 0,
    occurrences: Number(row.occurrences) || 0,
    nextRunDate: row.next_run_date,
    status: row.status as 'ACTIVE' | 'PAUSED' | 'ENDED',
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    classId: row.class_id ?? null,
    locationId: row.location_id ?? null,
    runs: ((row.recurring_runs || []) as any[])
      .map((run) => ({ occurrence: run.occurrence, date: run.run_date, documentId: run.document_id, documentNumber: run.document_number }))
      .sort((a, b) => b.occurrence - a.occurrence)
      .slice(0, 6),
  };
}

export interface ScheduleInput {
  name?: string;
  frequency: Frequency;
  intervalCount: number;
  startDate: string;
  endDate?: string;
  maxOccurrences?: number;
  daysUntilDue: number;
}

/**
 * Invoices and bills that repeat on a schedule. Templates are copied from a
 * posted document; each occurrence is posted by public.run_recurring_template,
 * by hand or from the Worker's daily schedule (public.run_due_recurring).
 */
export class RecurringService {
  static async list(orgId: string, kind?: RecurringKind) {
    const supabase = getSupabase();
    const rows = await fetchAllRows<any>((from, to) => {
      let request = supabase
        .from('recurring_templates')
        .select('*, recurring_runs(occurrence, run_date, document_id, document_number), customer:customers(display_name), vendor:vendors(display_name)')
        .eq('org_id', orgId);
      if (kind) request = request.eq('kind', kind);
      return request.order('created_at', { ascending: false }).order('id').range(from, to);
    });
    return rows.map(mapTemplate);
  }

  static async save(input: ScheduleInput & {
    orgId: string; id?: string; sourceDocumentId?: string; kind?: RecurringKind; actor: string;
  }) {
    const { data, error } = await getSupabase().rpc('save_recurring_template', {
      p_org_id: input.orgId,
      p_template_id: input.id || null,
      p_source_document_id: input.sourceDocumentId || null,
      p_kind: input.kind || null,
      p_name: input.name?.trim() || null,
      p_frequency: input.frequency,
      p_interval_count: input.intervalCount,
      p_start_date: input.startDate,
      p_end_date: input.endDate || null,
      p_max_occurrences: input.maxOccurrences ?? null,
      p_days_until_due: input.daysUntilDue,
      p_actor: input.actor,
    });
    if (error) throw error;
    return data as { id: string; name: string; nextRunDate: string | null };
  }

  static async setStatus(orgId: string, id: string, status: 'ACTIVE' | 'PAUSED' | 'ENDED', actor: string) {
    const { data, error } = await getSupabase().rpc('set_recurring_status', {
      p_org_id: orgId, p_template_id: id, p_status: status, p_actor: actor,
    });
    if (error) throw error;
    return data as { status: string; nextRunDate: string | null };
  }

  /** Posts the next occurrence now, dated the given day. */
  static async runNow(orgId: string, id: string, documentDate: string, actor: string) {
    const { data, error } = await getSupabase().rpc('run_recurring_template', {
      p_org_id: orgId, p_template_id: id, p_document_date: documentDate, p_actor: actor,
    });
    if (error) throw error;
    return data as { documentId: string; documentNumber: string; documentDate: string; nextRunDate: string | null };
  }

  /** Everything due today or earlier, for every organization. Called by the daily schedule. */
  static async runDue() {
    const { data, error } = await getSupabase().rpc('run_due_recurring');
    if (error) throw error;
    return data as { posted: number; failed: number };
  }
}
