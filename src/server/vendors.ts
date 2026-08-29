import { getSupabase } from './supabase';

export class VendorService {
  static async getVendors(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('vendors')
      .select('*')
      .eq('org_id', orgId)
      .order('display_name');
      
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      orgId: row.org_id,
      displayName: row.display_name,
      legalName: row.legal_name,
      vendorType: row.vendor_type,
      contactPerson: row.contact_person,
      email: row.email,
      phone: row.phone,
      kraPin: row.kra_pin,
      paymentTerms: row.payment_terms,
      currency: row.currency,
      billingAddress: row.billing_address,
      city: row.city,
      postalCode: row.postal_code,
      country: row.country,
      notes: row.notes,
      balance: row.balance,
      createdAt: row.created_at
    }));
  }

  static async createVendor(orgId: string, input: any) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('vendors')
      .insert({
        org_id: orgId,
        display_name: input.displayName,
        legal_name: input.legalName || input.displayName,
        vendor_type: input.vendorType || 'Supplier',
        contact_person: input.contactPerson || null,
        email: input.email || null,
        phone: input.phone || null,
        kra_pin: input.kraPin || null,
        payment_terms: input.paymentTerms || 'Net 30',
        currency: input.currency || 'KES',
        billing_address: input.billingAddress || null,
        city: input.city || null,
        postal_code: input.postalCode || null,
        country: input.country || 'Kenya',
        notes: input.notes || null,
        balance: 0
      })
      .select('id')
      .single();
      
    if (error) throw error;
    return data.id;
  }
}
