import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { partyBalances } from './partyBalances';
import { UserError } from './errors';

export interface CustomerInput {
  displayName?: string;
  legalName?: string;
  customerType?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  kraPin?: string;
  paymentTerms?: string;
  creditLimitCents?: number;
  currency?: string;
  discountPercent?: number;
  priceTier?: string;
  billingAddress?: string;
  shippingAddress?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  notes?: string;
  isActive?: boolean;
}

const COLUMNS: Record<keyof CustomerInput, string> = {
  displayName: 'display_name',
  legalName: 'legal_name',
  customerType: 'customer_type',
  contactPerson: 'contact_person',
  email: 'email',
  phone: 'phone',
  kraPin: 'kra_pin',
  paymentTerms: 'payment_terms',
  creditLimitCents: 'credit_limit_cents',
  currency: 'currency',
  discountPercent: 'discount_percent',
  priceTier: 'price_tier',
  billingAddress: 'billing_address',
  shippingAddress: 'shipping_address',
  city: 'city',
  postalCode: 'postal_code',
  country: 'country',
  notes: 'notes',
  isActive: 'is_active',
};

export function mapCustomer(row: any, balance?: { openCents: number; overdueCents: number; openDocuments: number }) {
  return {
    id: row.id,
    orgId: row.org_id,
    displayName: row.display_name,
    legalName: row.legal_name,
    customerType: row.customer_type,
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
    kraPin: row.kra_pin,
    paymentTerms: row.payment_terms,
    creditLimitCents: row.credit_limit_cents,
    currency: row.currency,
    discountPercent: row.discount_percent,
    priceTier: row.price_tier,
    billingAddress: row.billing_address,
    shippingAddress: row.shipping_address,
    city: row.city,
    postalCode: row.postal_code,
    country: row.country,
    notes: row.notes,
    isActive: row.is_active !== false,
    // Owed now, from the open invoices.
    balance: balance?.openCents ?? 0,
    overdueCents: balance?.overdueCents ?? 0,
    openInvoices: balance?.openDocuments ?? 0,
    createdAt: row.created_at,
  };
}

export class CustomerService {
  static async getCustomers(orgId: string) {
    const supabase = getSupabase();
    const [data, balances] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase
        .from('customers')
        .select('*')
        .eq('org_id', orgId)
        .order('display_name')
        .order('id')
        .range(from, to)),
      partyBalances(orgId, 'CUSTOMER'),
    ]);
    return data.map((row) => mapCustomer(row, balances.get(row.id)));
  }

  static async createCustomer(orgId: string, input: CustomerInput) {
    const supabase = getSupabase();
    if (!input.displayName?.trim()) throw new UserError('A display name is required.');
    const { data, error } = await supabase
      .from('customers')
      .insert({
        org_id: orgId,
        display_name: input.displayName,
        legal_name: input.legalName || input.displayName,
        customer_type: input.customerType || 'Corporate',
        contact_person: input.contactPerson || null,
        email: input.email || null,
        phone: input.phone || null,
        kra_pin: input.kraPin || null,
        payment_terms: input.paymentTerms || 'Net 30',
        credit_limit_cents: input.creditLimitCents || 0,
        currency: input.currency || 'KES',
        discount_percent: input.discountPercent || 0,
        price_tier: input.priceTier || 'Standard',
        billing_address: input.billingAddress || null,
        shipping_address: input.shippingAddress || null,
        city: input.city || null,
        postal_code: input.postalCode || null,
        country: input.country || 'Kenya',
        notes: input.notes || null,
        balance: 0,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  static async updateCustomer(orgId: string, id: string, input: CustomerInput) {
    const supabase = getSupabase();
    const updateData: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(COLUMNS) as Array<[keyof CustomerInput, string]>) {
      if (input[key] !== undefined) updateData[column] = input[key];
    }
    if (Object.keys(updateData).length === 0) return;
    const { data, error } = await supabase
      .from('customers')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('Customer not found in this organization.', 404);
  }
}
