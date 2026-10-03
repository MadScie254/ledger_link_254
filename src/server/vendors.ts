import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { partyBalances } from './partyBalances';
import { UserError } from './errors';

export interface VendorInput {
  displayName?: string;
  legalName?: string;
  vendorType?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  kraPin?: string;
  vatNumber?: string;
  category?: string;
  paymentTerms?: string;
  paymentMethod?: string;
  currency?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankBranch?: string;
  mpesaNumber?: string;
  defaultAccountId?: string;
  billingAddress?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  notes?: string;
  isActive?: boolean;
}

const COLUMNS: Record<Exclude<keyof VendorInput, 'address'>, string> = {
  displayName: 'display_name',
  legalName: 'legal_name',
  vendorType: 'vendor_type',
  contactPerson: 'contact_person',
  email: 'email',
  phone: 'phone',
  kraPin: 'kra_pin',
  vatNumber: 'vat_number',
  category: 'category',
  paymentTerms: 'payment_terms',
  paymentMethod: 'payment_method',
  currency: 'currency',
  bankName: 'bank_name',
  bankAccountNo: 'bank_account',
  bankBranch: 'bank_branch',
  mpesaNumber: 'mpesa_number',
  defaultAccountId: 'default_account_id',
  billingAddress: 'billing_address',
  city: 'city',
  postalCode: 'postal_code',
  country: 'country',
  notes: 'notes',
  isActive: 'is_active',
};

function columnsFor(input: VendorInput): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  // The form's "address" is the supplier's billing address.
  const normalized: VendorInput = { ...input, billingAddress: input.billingAddress ?? input.address };
  for (const [key, column] of Object.entries(COLUMNS) as Array<[keyof typeof COLUMNS, string]>) {
    if (normalized[key] !== undefined) values[column] = normalized[key];
  }
  return values;
}

export class VendorService {
  static async getVendors(orgId: string) {
    const supabase = getSupabase();
    const [data, balances] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase
        .from('vendors')
        .select('*')
        .eq('org_id', orgId)
        .order('display_name')
        .order('id')
        .range(from, to)),
      partyBalances(orgId, 'VENDOR'),
    ]);

    return data.map(row => {
      const balance = balances.get(row.id);
      return {
        id: row.id,
        orgId: row.org_id,
        displayName: row.display_name,
        legalName: row.legal_name,
        vendorType: row.vendor_type,
        contactPerson: row.contact_person,
        email: row.email,
        phone: row.phone,
        kraPin: row.kra_pin,
        vatNumber: row.vat_number,
        category: row.category,
        paymentTerms: row.payment_terms,
        paymentMethod: row.payment_method,
        currency: row.currency,
        bankName: row.bank_name,
        bankAccountNo: row.bank_account,
        bankBranch: row.bank_branch,
        mpesaNumber: row.mpesa_number,
        defaultAccountId: row.default_account_id,
        billingAddress: row.billing_address,
        city: row.city,
        postalCode: row.postal_code,
        country: row.country,
        notes: row.notes,
        isActive: row.is_active !== false,
        balance: balance?.openCents ?? 0,
        overdueCents: balance?.overdueCents ?? 0,
        openBills: balance?.openDocuments ?? 0,
        createdAt: row.created_at,
      };
    });
  }

  static async createVendor(orgId: string, input: VendorInput) {
    const supabase = getSupabase();
    if (!input.displayName?.trim()) throw new UserError('A display name is required.');
    const { data, error } = await supabase
      .from('vendors')
      .insert({
        org_id: orgId,
        legal_name: input.legalName || input.displayName,
        vendor_type: input.vendorType || 'Supplier',
        payment_terms: input.paymentTerms || 'Net 30',
        currency: input.currency || 'KES',
        country: input.country || 'Kenya',
        balance: 0,
        ...columnsFor(input),
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  static async updateVendor(orgId: string, id: string, input: VendorInput) {
    const supabase = getSupabase();
    const updateData = columnsFor(input);
    if (Object.keys(updateData).length === 0) return;
    const { data, error } = await supabase
      .from('vendors')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('Supplier not found in this organization.', 404);
  }
}
