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

  static async updateVendor(orgId: string, id: string, input: any) {
    const supabase = getSupabase();
    
    // Map input camelCase to snake_case
    const updateData: any = {};
    if (input.displayName !== undefined) updateData.display_name = input.displayName;
    if (input.legalName !== undefined) updateData.legal_name = input.legalName;
    if (input.vendorType !== undefined) updateData.vendor_type = input.vendorType;
    if (input.contactPerson !== undefined) updateData.contact_person = input.contactPerson;
    if (input.email !== undefined) updateData.email = input.email;
    if (input.phone !== undefined) updateData.phone = input.phone;
    if (input.kraPin !== undefined) updateData.kra_pin = input.kraPin;
    if (input.paymentTerms !== undefined) updateData.payment_terms = input.paymentTerms;
    if (input.currency !== undefined) updateData.currency = input.currency;
    if (input.billingAddress !== undefined) updateData.billing_address = input.billingAddress;
    if (input.city !== undefined) updateData.city = input.city;
    if (input.postalCode !== undefined) updateData.postal_code = input.postalCode;
    if (input.country !== undefined) updateData.country = input.country;
    if (input.notes !== undefined) updateData.notes = input.notes;

    const { error } = await supabase
      .from('vendors')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId);
      
    if (error) throw error;
  }
}
