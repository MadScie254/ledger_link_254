import { getSupabase } from './supabase';

export interface AuditLogInput {
  orgId: string;
  userId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  resourceType: 'ACCOUNT' | 'JOURNAL_ENTRY' | 'BANK_TRANSACTION' | 'BILL' | 'INVOICE' | 'USER_ROLE' | 'TEAM_MEMBER';
  resourceId: string;
  details: any;
}

function toRow(input: AuditLogInput) {
  return {
    org_id: input.orgId,
    user_id: input.userId,
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    details: input.details,
  };
}

export class AuditService {
  /**
   * Writes audit rows after the change they describe has already been saved,
   * so a failure here must not report the change itself as failed. It is
   * logged to the Worker log instead of disappearing.
   */
  static async logEvents(inputs: AuditLogInput[]) {
    if (inputs.length === 0) return;
    const supabase = getSupabase();
    const { error } = await supabase.from('audit_logs').insert(inputs.map(toRow));
    if (error) {
      console.error('[Audit] Failed to write audit rows:', error.message, inputs.map((i) => `${i.action} ${i.resourceType} ${i.resourceId}`));
    }
  }

  static async logEvent(input: AuditLogInput) {
    await this.logEvents([input]);
  }

  static async getLogs(orgId: string, maxResults = 50) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('org_id', orgId)
      .order('timestamp', { ascending: false })
      .limit(maxResults);
      
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: row.details,
      timestamp: row.timestamp
    }));
  }
}
