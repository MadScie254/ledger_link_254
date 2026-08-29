import { getSupabase } from './supabase';
import { AccountService } from './accounts';

export interface Organization {
  id: string;
  name: string;
  legalName?: string;
  baseCurrency: string;
  country: string;
  taxId?: string;
  fiscalYearStart?: string;
  industry?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  isDefault?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export class OrganizationService {
  static async getOrganizations(): Promise<Organization[]> {
    const supabase = getSupabase();
    // We only fetch organizations the user has access to, handled by RLS.
    // However, this is a service-role query, so it fetches all unless we pass a user ID.
    // But wait, the Express routes are calling this. The routes should ideally use a user-scoped client.
    // Since we use the service role, we should filter by memberships if we have the userId.
    // For now, we fetch all orgs (which matches previous behavior without proper auth).
    // In routes.ts, we will enforce access.
    
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('name');

    if (error) throw error;
    
    return (data || []).map(d => ({
      id: d.id,
      name: d.name,
      legalName: d.legal_name,
      baseCurrency: d.base_currency,
      country: d.country,
      taxId: d.tax_id,
      fiscalYearStart: d.fiscal_year_start,
      industry: d.industry,
      address: d.address,
      city: d.city,
      phone: d.phone,
      email: d.email,
      website: d.website,
      isDefault: d.is_default,
      createdAt: d.created_at,
      updatedAt: d.updated_at
    }));
  }

  static async getOrganization(orgId: string): Promise<Organization | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') return null; // No rows
      throw error;
    }
    
    return {
      id: data.id,
      name: data.name,
      legalName: data.legal_name,
      baseCurrency: data.base_currency,
      country: data.country,
      taxId: data.tax_id,
      fiscalYearStart: data.fiscal_year_start,
      industry: data.industry,
      address: data.address,
      city: data.city,
      phone: data.phone,
      email: data.email,
      website: data.website,
      isDefault: data.is_default,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  }

  static async createOrganization(data: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>, ownerId?: string): Promise<string> {
    const supabase = getSupabase();
    
    const { data: newOrg, error } = await supabase
      .from('organizations')
      .insert({
        name: data.name,
        legal_name: data.legalName || data.name,
        base_currency: data.baseCurrency || 'KES',
        country: data.country || 'Kenya',
        tax_id: data.taxId || '',
        fiscal_year_start: data.fiscalYearStart || 'January',
        industry: data.industry || 'General Business',
        address: data.address || '',
        city: data.city || '',
        phone: data.phone || '',
        email: data.email || '',
        website: data.website || '',
        is_default: false
      })
      .select('id')
      .single();

    if (error) throw error;
    const orgId = newOrg.id;

    if (ownerId) {
      await supabase.from('memberships').insert({
        org_id: orgId,
        user_id: ownerId,
        role: 'owner'
      });
    }

    // Initialize Standard Chart of Accounts
    await this.seedDefaultAccounts(orgId);

    return orgId;
  }

  static async updateOrganization(orgId: string, data: Partial<Organization>): Promise<void> {
    const supabase = getSupabase();
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.legalName !== undefined) updateData.legal_name = data.legalName;
    if (data.baseCurrency !== undefined) updateData.base_currency = data.baseCurrency;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.taxId !== undefined) updateData.tax_id = data.taxId;
    if (data.fiscalYearStart !== undefined) updateData.fiscal_year_start = data.fiscalYearStart;
    if (data.industry !== undefined) updateData.industry = data.industry;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.website !== undefined) updateData.website = data.website;

    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase
        .from('organizations')
        .update(updateData)
        .eq('id', orgId);
        
      if (error) throw error;
    }
  }

  static async seedDefaultAccounts(orgId: string): Promise<void> {
    const standardAccounts = [
      { code: '1000', name: 'Cash equivalents (Operating Account)', type: 'ASSET' as const },
      { code: '1010', name: 'USD Bank Account (Foreign Holding)', type: 'ASSET' as const },
      { code: '1020', name: 'EUR Bank Account (Foreign Holding)', type: 'ASSET' as const },
      { code: '1050', name: 'M-Pesa Business Till / Paybill', type: 'ASSET' as const },
      { code: '1100', name: 'Accounts Receivable (A/R)', type: 'ASSET' as const },
      { code: '1200', name: 'Inventory Asset', type: 'ASSET' as const },
      { code: '2000', name: 'Accounts Payable (A/P)', type: 'LIABILITY' as const },
      { code: '2100', name: 'VAT & Tax Payable', type: 'LIABILITY' as const },
      { code: '3000', name: "Owner's Equity / Share Capital", type: 'EQUITY' as const },
      { code: '3100', name: 'Retained Earnings', type: 'EQUITY' as const },
      { code: '4000', name: 'Sales Revenue & Billing', type: 'INCOME' as const },
      { code: '4100', name: 'Consulting & Service Income', type: 'INCOME' as const },
      { code: '5000', name: 'Cost of Goods Sold (COGS)', type: 'COGS' as const },
      { code: '6000', name: 'Operating Expenses', type: 'EXPENSE' as const },
      { code: '6100', name: 'Salaries & Payroll Expense', type: 'EXPENSE' as const },
      { code: '6200', name: 'Office Rent & Utilities', type: 'EXPENSE' as const },
      { code: '8000', name: 'Unrealized FX Gain / Loss', type: 'INCOME' as const },
      { code: '8100', name: 'Realized FX Gain / Loss', type: 'INCOME' as const },
    ];

    for (const acc of standardAccounts) {
      try {
        await AccountService.createAccount({ ...acc, orgId });
      } catch (e) {
        // Account may already exist
      }
    }
  }
}
