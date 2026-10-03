import { getSupabase } from './supabase';
import { UserError } from './errors';

const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The audit log. Rows are written by the database itself: by each posting
 * workflow, and by triggers on customers, suppliers, employees, stock items,
 * accounts, projects, budgets, bank rules, memberships and organization
 * settings, in the same transaction as the change. Nothing here writes rows,
 * and no role can change or delete them.
 */

/** Payroll and employee rows carry pay and bank details: not for the read-only member role. */
const PAYROLL_RESOURCES = ['EMPLOYEE', 'PAYROLL_RUN'];

export interface AuditQuery {
  /** Return rows older than this row (from a previous page's nextCursor). */
  cursor?: { timestamp: string; id: string };
  limit?: number;
  resourceType?: string;
  resourceId?: string;
  includePayroll: boolean;
}

export class AuditService {
  static async getLogs(orgId: string, query: AuditQuery) {
    const supabase = getSupabase();
    const limit = Math.min(Math.max(query.limit || 50, 1), 200);
    let request = supabase
      .from('audit_logs')
      .select('id, user_id, actor_email, action, resource_type, resource_id, details, timestamp')
      .eq('org_id', orgId);
    if (!query.includePayroll) request = request.not('resource_type', 'in', `(${PAYROLL_RESOURCES.join(',')})`);
    if (query.resourceType) request = request.eq('resource_type', query.resourceType);
    if (query.resourceId) request = request.eq('resource_id', query.resourceId);
    if (query.cursor) {
      const { timestamp, id } = query.cursor;
      // Both parts are checked here because they are written into a filter.
      if (!CURSOR_TIMESTAMP.test(timestamp) || !UUID.test(id)) throw new UserError('That page link is not valid.');
      // Keyset paging on (timestamp, id), newest first.
      request = request.or(`timestamp.lt."${timestamp}",and(timestamp.eq."${timestamp}",id.lt.${id})`);
    }
    const { data, error } = await request
      .order('timestamp', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (error) throw error;

    const rows = data || [];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      logs: page.map((row: any) => ({
        id: row.id,
        orgId,
        userId: row.user_id,
        actorEmail: row.actor_email,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        details: row.details,
        timestamp: row.timestamp,
      })),
      nextCursor: rows.length > limit && last ? `${last.timestamp}|${last.id}` : null,
    };
  }
}
