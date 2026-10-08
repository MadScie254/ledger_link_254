import { getSupabase } from './supabase';
import { UserError } from './errors';
import type { BusinessType } from '../utils/businessTypes';
import { chartFor } from '../utils/accountChart';
export { chartFor, isMoneyAccountCode, STANDARD_ACCOUNTS } from '../utils/accountChart';
import { businessTypeAllowedForEdition, type Edition } from '../utils/editions';
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
  edition?: Edition;
  themeAccent?: ThemeAccent;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  /** How to pay, printed on invoices: bank account, M-Pesa paybill or till. */
  paymentDetails?: string | null;
  /** A short line printed at the foot of every document. */
  documentFooter?: string | null;
  isDefault?: boolean;
  isDemo?: boolean;
  booksClosedThrough?: string | null;
  approvalThresholdCents?: number | null;
  aiEnabled?: boolean;
  timeZone?: string;
  /** The signed-in person's role here, on lists of their own organizations. */
  role?: 'owner' | 'admin' | 'accountant' | 'member';
  createdAt?: any;
  updatedAt?: any;
}

export type OrganizationCreateInput = Omit<Organization, 'id' | 'createdAt' | 'updatedAt' | 'isDemo' | 'isDefault' | 'role'> & {
  creationKey?: string;
};

export type OrganizationUpdateInput = Partial<Omit<Organization, 'id' | 'createdAt' | 'updatedAt' | 'isDemo' | 'isDefault' | 'role' | 'edition'>>;

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
    edition: d.edition || 'business',
    themeAccent: d.theme_accent,
    address: d.address,
    city: d.city,
    phone: d.phone,
    email: d.email,
    website: d.website,
    paymentDetails: d.payment_details ?? null,
    documentFooter: d.document_footer ?? null,
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
      .select('org_id, role')
      .eq('user_id', userId);

    if (membershipsError) throw membershipsError;

    const roles = new Map((memberships || []).map((membership) => [membership.org_id, membership.role]));
    const organizationIds = [...roles.keys()];
    if (organizationIds.length === 0) return [];

    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .in('id', organizationIds)
      .order('name');

    if (error) throw error;
    return (data || []).map((row) => ({ ...mapOrganization(row), role: roles.get(row.id) }));
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
    const edition = data.edition || 'business';
    if (!businessTypeAllowedForEdition(edition, data.businessType)) {
      throw new UserError('The church edition cannot use the nonprofit business type because fund account codes overlap.');
    }
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
        edition,
        themeAccent: data.themeAccent,
        address: data.address,
        city: data.city,
        phone: data.phone,
        email: data.email,
        website: data.website,
      },
      p_accounts: chartFor(data.businessType || null, baseCurrency, edition),
      p_creation_key: data.creationKey || null,
    });
    if (error) throw error;
    return orgId as string;
  }

  static async updateOrganization(orgId: string, data: OrganizationUpdateInput): Promise<void> {
    const supabase = getSupabase();
    if (data.businessType === 'nonprofit' && (await this.getOrganization(orgId))?.edition === 'church') {
      throw new UserError('The church edition cannot use the nonprofit business type because fund account codes overlap.');
    }
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
      paymentDetails: 'payment_details',
      documentFooter: 'document_footer',
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

  /** Adds any standard, business-type and edition accounts the organization is missing. */
  static async seedDefaultAccounts(
    orgId: string, businessType: BusinessType | null = null, edition: Edition | null = null,
  ): Promise<void> {
    const supabase = getSupabase();
    const { data: organization, error } = await supabase
      .from('organizations')
      .select('base_currency, business_type, edition')
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

    const newAccounts = chartFor(businessType || organization.business_type, baseCurrency, edition || organization.edition)
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
