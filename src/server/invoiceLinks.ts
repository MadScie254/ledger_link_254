import { getSupabase } from './supabase';
import { UserError } from './errors';
import { newToken } from './daraja';
import { DocumentPrintService } from './documentPrint';
import { MpesaExpressService } from './mpesaExpress';
import type { PrintDocument } from '../utils/printDocument';

/** A token the Worker made: 32 random bytes as hex. */
export const INVOICE_LINK_TOKEN = /^[0-9a-f]{64}$/;

export interface InvoiceLink {
  url: string;
  createdAt: string;
  views: number;
  lastViewedAt: string | null;
  created: boolean;
}

interface OpenedLink {
  orgId: string;
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  amountDueCents: number;
  currency: string;
  paybill: string | null;
  accountNumber: string;
  canRequestPayment: boolean;
  requestActor: string | null;
}

/** What the customer's page shows: the invoice as printed, and how to pay it. */
export interface PublicInvoice {
  document: PrintDocument;
  status: string;
  amountDueCents: number;
  currency: string;
  pay: { paybill: string | null; accountNumber: string; canRequestPayment: boolean };
}

export const invoiceLinkUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, '')}/pay/${token}`;

async function open(token: string, count: boolean): Promise<OpenedLink | null> {
  if (!INVOICE_LINK_TOKEN.test(token)) return null;
  const { data, error } = await getSupabase().rpc('open_invoice_link', { p_token: token, p_count: count });
  if (error) throw error;
  if (!data) return null;
  return { ...(data as OpenedLink), amountDueCents: Number((data as OpenedLink).amountDueCents) };
}

const notFound = () => new UserError('This invoice link is not valid any more. Ask the business for a new one.', 404);

/**
 * Links a customer opens to see an invoice, save it and pay it
 * (public.invoice_share_links). The person shares the link themselves, by
 * WhatsApp, SMS or email; Ledger Link sends nothing.
 */
export class InvoiceLinkService {
  /** The invoice's standing link, or a new one. */
  static async share(orgId: string, invoiceId: string, actor: string, origin: string): Promise<InvoiceLink> {
    const { data, error } = await getSupabase().rpc('share_invoice_link', {
      p_org_id: orgId, p_invoice_id: invoiceId, p_token: newToken(), p_actor: actor,
    });
    if (error) throw error;
    const link = data as { token: string; createdAt: string; views: number; lastViewedAt: string | null; created: boolean };
    return { url: invoiceLinkUrl(origin, link.token), createdAt: link.createdAt, views: Number(link.views),
      lastViewedAt: link.lastViewedAt, created: link.created };
  }

  static async withdraw(orgId: string, invoiceId: string, actor: string): Promise<{ withdrawn: boolean }> {
    const { data, error } = await getSupabase().rpc('withdraw_invoice_link', {
      p_org_id: orgId, p_invoice_id: invoiceId, p_actor: actor,
    });
    if (error) throw error;
    return { withdrawn: Boolean(data) };
  }

  /** The customer's page. Counts as a view. */
  static async view(token: string): Promise<PublicInvoice> {
    const link = await open(token, true);
    if (!link) throw notFound();
    const document = await DocumentPrintService.printModel(link.orgId, 'invoice', link.invoiceId);
    return {
      document, status: link.status, amountDueCents: link.amountDueCents, currency: link.currency,
      pay: { paybill: link.paybill, accountNumber: link.accountNumber, canRequestPayment: link.canRequestPayment },
    };
  }

  /**
   * Asks the customer's phone to pay (M-Pesa Express), in the name of the
   * person the business named to post M-Pesa payments. The amount is whole
   * shillings, no more than is due.
   */
  static async requestPayment(token: string, input: { phone: string; amountCents: number }, origin: string) {
    const link = await open(token, false);
    if (!link) throw notFound();
    if (!link.canRequestPayment || !link.requestActor) {
      throw new UserError('This business does not take payment requests from this page. Pay to the paybill shown instead.', 409);
    }
    const request = await MpesaExpressService.requestPayment(link.orgId, link.invoiceId, input, link.requestActor, origin);
    return { id: request.id, status: request.status, message: request.message };
  }

  /** One request's progress, and the invoice as it now stands. */
  static async requestStatus(token: string, requestId: string) {
    const link = await open(token, false);
    if (!link) throw notFound();
    const { data, error } = await getSupabase().from('mpesa_payment_requests')
      .select('id, status, result_message').eq('org_id', link.orgId).eq('invoice_id', link.invoiceId).eq('id', requestId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('Payment request not found for this invoice.', 404);
    return {
      id: data.id, status: data.status as 'PENDING' | 'SENT' | 'PAID' | 'FAILED', message: data.result_message ?? null,
      invoiceStatus: link.status, amountDueCents: link.amountDueCents,
    };
  }
}
