import { getSupabase } from './supabase';

export interface AuditLogInput {
  orgId: string;
  userId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  resourceType: 'ACCOUNT' | 'JOURNAL_ENTRY' | 'BANK_TRANSACTION' | 'BILL' | 'INVOICE' | 'USER_ROLE';
  resourceId: string;
  details: any;
}

export class AuditService {
  static async logEvent(input: AuditLogInput) {
    const supabase = getSupabase();
    
    await supabase.from('audit_logs').insert({
      org_id: input.orgId,
      user_id: input.userId,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      details: input.details
    });
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
