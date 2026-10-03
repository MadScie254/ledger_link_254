import { getSupabase } from './supabase';
import { UserError } from './errors';
import { extraAccountsFor, type BusinessType } from '../utils/businessTypes';
import type { ThemeAccent } from '../utils/themeAccents';

export interface Organization {
  id: string;
  name: string;
  legalName?: string;
  baseCurrency: string;
  country: string;
  taxId?: string;
  fiscalYearStart?: string;
  industry?: string;
  businessType?: BusinessType | null;
  themeAccent?: ThemeAccent;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  isDefault?: boolean;
  isDemo?: boolean;
  booksClosedThrough?: string | null;
  approvalThresholdCents?: number | null;
  aiEnabled?: boolean;
  timeZone?: string;
  createdAt?: any;
  updatedAt?: any;
}

export type OrganizationCreateInput = Omit<Organization, 'id' | 'createdAt' | 'updatedAt' | 'isDemo' | 'isDefault'> & {
  creationKey?: string;
};

export type OrganizationUpdateInput = Partial<Omit<Organization, 'id' | 'createdAt' | 'updatedAt' | 'isDemo' | 'isDefault'>>;

/** The standard chart every organization starts with. Codes 1000-1099 hold money. */
export const STANDARD_ACCOUNTS = [
  { code: '1000', name: 'Cash equivalents (Operating Account)', type: 'ASSET' as const },
  { code: '1010', name: 'USD Bank Account (Foreign Holding)', type: 'ASSET' as const, currency: 'USD' },
  { code: '1020', name: 'EUR Bank Account (Foreign Holding)', type: 'ASSET' as const, currency: 'EUR' },
  { code: '1050', name: 'M-Pesa Business Till / Paybill', type: 'ASSET' as const },
  { code: '1100', name: 'Accounts Receivable (A/R)', type: 'ASSET' as const },
  { code: '1150', name: 'Recoverable VAT / Input Tax', type: 'ASSET' as const },
  { code: '1200', name: 'Inventory Asset', type: 'ASSET' as const },
  { code: '2000', name: 'Accounts Payable (A/P)', type: 'LIABILITY' as const },
  { code: '2100', name: 'Output VAT Payable', type: 'LIABILITY' as const },
  { code: '2110', name: 'PAYE Payable', type: 'LIABILITY' as const },
  { code: '2120', name: 'NSSF Payable', type: 'LIABILITY' as const },
  { code: '2130', name: 'SHA Payable', type: 'LIABILITY' as const },
  { code: '2140', name: 'Affordable Housing Levy Payable', type: 'LIABILITY' as const },
  { code: '3000', name: "Owner's Equity / Share Capital", type: 'EQUITY' as const },
  { code: '3100', name: 'Retained Earnings', type: 'EQUITY' as const },
  { code: '4000', name: 'Sales Revenue & Billing', type: 'INCOME' as const },
  { code: '4100', name: 'Consulting & Service Income', type: 'INCOME' as const },
  { code: '5000', name: 'Cost of Goods Sold (COGS)', type: 'COGS' as const },
  { code: '6000', name: 'Operating Expenses', type: 'EXPENSE' as const },
  { code: '6100', name: 'Salaries & Payroll Expense', type: 'EXPENSE' as const },
  { code: '6110', name: 'Employer Payroll Contributions', type: 'EXPENSE' as const },
  { code: '6200', name: 'Office Rent & Utilities', type: 'EXPENSE' as const },
  { code: '8000', name: 'Unrealized FX Gain / Loss', type: 'INCOME' as const },
  { code: '8100', name: 'Realized FX Gain / Loss', type: 'INCOME' as const },
];

/** Money accounts (bank, cash, M-Pesa) are 1000-1099 in the standard numbering. */
export function isMoneyAccountCode(code: string): boolean {
  return /^10\d\d$/.test(code);
}

/** The chart for a new organization: the standard accounts plus its business type's. */
export function chartFor(businessType: BusinessType | null | undefined, baseCurrency: string) {
  return [...STANDARD_ACCOUNTS, ...extraAccountsFor(businessType)].map((account) => ({
    code: account.code,
    name: account.name,
    type: account.type,
    currency: ('currency' in account && account.currency) || baseCurrency,
    isBankAccount: account.type === 'ASSET' && isMoneyAccountCode(account.code),
  }));
}

function mapOrganization(d: any): Organization {
  return {
    id: d.id,
    name: d.name,
    legalName: d.legal_name,
    baseCurrency: d.base_currency,
    country: d.country,
    taxId: d.tax_id,
    fiscalYearStart: d.fiscal_year_start,
    industry: d.industry,
    businessType: d.business_type,
    themeAccent: d.theme_accent,
    address: d.address,
    city: d.city,
    phone: d.phone,
    email: d.email,
    website: d.website,
    isDefault: d.is_default,
    isDemo: d.is_demo,
    booksClosedThrough: d.books_closed_through ?? null,
    approvalThresholdCents: d.approval_threshold_cents == null ? null : Number(d.approval_threshold_cents),
    aiEnabled: Boolean(d.ai_enabled),
    timeZone: d.time_zone,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

export class OrganizationService {
  static async getOrganizations(userId: string): Promise<Organization[]> {
    const supabase = getSupabase();

    const { data: memberships, error: membershipsError } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', userId);

    if (membershipsError) throw membershipsError;

    const organizationIds = (memberships || []).map((membership) => membership.org_id);
    if (organizationIds.length === 0) return [];

    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .in('id', organizationIds)
      .order('name');

    if (error) throw error;
    return (data || []).map(mapOrganization);
  }

  static async getOrganization(orgId: string): Promise<Organization | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapOrganization(data) : null;
  }

  /**
   * The organization, its owner and its chart of accounts, in one
   * transaction (public.create_organization). A retry with the same
   * creation key returns the same organization.
   */
  static async createOrganization(data: OrganizationCreateInput, ownerId: string): Promise<string> {
    const supabase = getSupabase();
    const baseCurrency = String(data.baseCurrency || 'KES').trim().toUpperCase();
    const { data: orgId, error } = await supabase.rpc('create_organization', {
      p_owner: ownerId,
      p_organization: {
        name: data.name,
        legalName: data.legalName,
        baseCurrency,
        country: data.country,
        taxId: data.taxId,
        fiscalYearStart: data.fiscalYearStart,
        industry: data.industry,
        businessType: data.businessType || null,
        themeAccent: data.themeAccent,
        address: data.address,
        city: data.city,
        phone: data.phone,
        email: data.email,
        website: data.website,
      },
      p_accounts: chartFor(data.businessType || null, baseCurrency),
      p_creation_key: data.creationKey || null,
    });
    if (error) throw error;
    return orgId as string;
  }

  static async updateOrganization(orgId: string, data: OrganizationUpdateInput): Promise<void> {
    const supabase = getSupabase();
    const columns: Record<keyof OrganizationUpdateInput, string> = {
      name: 'name',
      legalName: 'legal_name',
      baseCurrency: 'base_currency',
      country: 'country',
      taxId: 'tax_id',
      fiscalYearStart: 'fiscal_year_start',
      industry: 'industry',
      businessType: 'business_type',
      themeAccent: 'theme_accent',
      address: 'address',
      city: 'city',
      phone: 'phone',
      email: 'email',
      website: 'website',
      booksClosedThrough: 'books_closed_through',
      approvalThresholdCents: 'approval_threshold_cents',
      aiEnabled: 'ai_enabled',
      timeZone: 'time_zone',
    };
    const updateData: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(columns) as Array<[keyof OrganizationUpdateInput, string]>) {
      if (data[key] !== undefined) updateData[column] = data[key];
    }
    if (data.baseCurrency !== undefined) {
      const baseCurrency = String(data.baseCurrency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(baseCurrency)) throw new UserError('Base currency must be a three-letter ISO code, such as KES.');
      updateData.base_currency = baseCurrency;
    }

    if (Object.keys(updateData).length > 0) {
      // The database refuses a base-currency change once any entry is
      // posted (organizations_lock_base_currency).
      const { error } = await supabase
        .from('organizations')
        .update(updateData)
        .eq('id', orgId);
      if (error) throw error;
    }

    // Choosing (or changing) a business type adds its accounts; it never
    // removes what the org already has.
    if (data.businessType) await this.seedDefaultAccounts(orgId, data.businessType);
  }

  /** Whether the organization has agreed to send receipts and figures to Google Gemini. */
  static async aiEnabled(orgId: string): Promise<boolean> {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('organizations').select('ai_enabled').eq('id', orgId).maybeSingle();
    if (error) throw error;
    return Boolean(data?.ai_enabled);
  }

  /** Adds any standard (and business-type) accounts the organization is missing. */
  static async seedDefaultAccounts(orgId: string, businessType: BusinessType | null = null): Promise<void> {
    const supabase = getSupabase();
    const { data: organization, error } = await supabase
      .from('organizations')
      .select('base_currency, business_type')
      .eq('id', orgId)
      .single();
    if (error) throw error;
    const baseCurrency = String(organization.base_currency || 'KES').toUpperCase();
    const { data: existingAccounts, error: existingAccountsError } = await supabase
      .from('accounts')
      .select('code')
      .eq('org_id', orgId);
    if (existingAccountsError) throw existingAccountsError;
    const existingCodes = new Set((existingAccounts || []).map((account) => account.code));

    const newAccounts = chartFor(businessType || organization.business_type, baseCurrency)
      .filter((account) => !existingCodes.has(account.code));
    if (newAccounts.length === 0) return;

    const { error: insertError } = await supabase.from('accounts').insert(
      newAccounts.map((account) => ({
        org_id: orgId,
        code: account.code,
        name: account.name,
        type: account.type,
        currency: account.currency,
        is_bank_account: account.isBankAccount,
        is_active: true,
      }))
    );
    if (insertError) throw insertError;
  }
}
