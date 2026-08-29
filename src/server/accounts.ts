import { getSupabase } from './supabase';
import { AuditService } from './audit';

export interface AccountInput {
  orgId: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'COGS' | 'EXPENSE';
  subtype?: string;
  parentId?: string;
  createdBy?: string;
}

export class AccountService {
  static async createAccount(input: AccountInput): Promise<string> {
    const supabase = getSupabase();
    
    // Check if code already exists for this org
    const { data: existing, error: searchError } = await supabase
      .from('accounts')
      .select('id')
      .eq('org_id', input.orgId)
      .eq('code', input.code)
      .limit(1);
      
    if (searchError) throw searchError;
      
    if (existing && existing.length > 0) {
      throw new Error(`Account code ${input.code} already exists.`);
    }

    const { data: newAccount, error: insertError } = await supabase
      .from('accounts')
      .insert({
        org_id: input.orgId,
        code: input.code,
        name: input.name,
        type: input.type,
        subtype: input.subtype || null,
        parent_id: input.parentId || null,
        is_active: true
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    if (input.createdBy) {
      await AuditService.logEvent({
        orgId: input.orgId,
        userId: input.createdBy,
        action: 'CREATE',
        resourceType: 'ACCOUNT',
        resourceId: newAccount.id,
        details: { code: input.code, name: input.name, type: input.type }
      });
    }

    return newAccount.id;
  }

  static async getAccountByCode(orgId: string, code: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('org_id', orgId)
      .eq('code', code)
      .limit(1)
      .single();
      
    if (error && error.code !== 'PGRST116') return null; // PGRST116 is "no rows returned"
    return data;
  }

  static async bulkCreateAccounts(orgId: string, accounts: Omit<AccountInput, 'orgId'>[], userId?: string): Promise<{ success: number, failed: number, accountIds: string[] }> {
    let success = 0;
    let failed = 0;
    const accountIds: string[] = [];
    for (const acc of accounts) {
      try {
        const id = await this.createAccount({ ...acc, orgId, createdBy: userId });
        accountIds.push(id);
        success++;
      } catch (err) {
        failed++;
      }
    }
    return { success, failed, accountIds };
  }
  
  static async bulkDeleteAccounts(orgId: string, accountIds: string[], userId?: string) {
    const supabase = getSupabase();
    
    const { error } = await supabase
      .from('accounts')
      .delete()
      .eq('org_id', orgId)
      .in('id', accountIds);
      
    if (error) throw error;

    if (userId) {
      for (const id of accountIds) {
        await AuditService.logEvent({
          orgId,
          userId,
          action: 'DELETE',
          resourceType: 'ACCOUNT',
          resourceId: id,
          details: { message: 'Undo bulk operation' }
        });
      }
    }
  }

  static async getAccounts(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('org_id', orgId)
      .order('code');
      
    if (error) throw error;
    
    // Convert snake_case to camelCase for the frontend
    return (data || []).map(row => ({
      id: row.id,
      orgId: row.org_id,
      code: row.code,
      name: row.name,
      type: row.type,
      subtype: row.subtype,
      parentId: row.parent_id,
      isActive: row.is_active,
      createdAt: row.created_at
    }));
  }
}
