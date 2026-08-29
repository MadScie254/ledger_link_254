import { getSupabase } from './supabase';

export class EtimsService {
  static async submitInvoice(orgId: string, invoiceId: string, invoiceData: any) {
    const supabase = getSupabase();
    
    // Log the submission attempt but note that integration is pending
    const { data, error } = await supabase
      .from('etims_submissions')
      .insert({
        org_id: orgId,
        invoice_id: invoiceId,
        status: 'NOT_CONFIGURED',
      })
      .select('*')
      .single();

    if (error) {
      console.error('Failed to log eTIMS submission', error);
      throw error;
    }

    return {
      success: false,
      status: 'NOT_CONFIGURED',
      submittedAt: data.submitted_at
    };
  }
}
