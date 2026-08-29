import { getSupabase } from './supabase';

export class CustomerService {
  static async getCustomers(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('org_id', orgId)
      .order('display_name');
      
    if (error) throw error;
    
    return (data || []).map(row => ({
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
      balance: row.balance,
      createdAt: row.created_at
    }));
  }

  static async createCustomer(orgId: string, input: any) {
    const supabase = getSupabase();
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
        balance: 0
      })
      .select('id')
      .single();
      
    if (error) throw error;
    return data.id;
  }
}
