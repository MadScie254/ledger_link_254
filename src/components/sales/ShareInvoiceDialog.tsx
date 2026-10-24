import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { normalizeKenyanPhone } from '../../utils/mpesaExpress';
import { shareMessage, whatsAppLink } from '../../utils/invoiceShare';
import { Dialog } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

interface InvoiceLike { id: string; invoiceNo: string; amountDueCents: number; currency?: string | null }

interface ShareLink { url: string; createdAt: string; views: number; lastViewedAt: string | null; created: boolean }

/**
 * A link the customer opens to see the invoice, save it and pay it. The
 * person sends it from their own WhatsApp, messages or email; the link
 * stays the same until it is withdrawn.
 */
export function ShareInvoiceDialog({ invoice, customerName, customerPhone, customerEmail, companyName, currency, onClose }: {
  invoice: InvoiceLike | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  companyName: string;
  currency: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const share = useMutation({
    mutationFn: (id: string) => apiRequest<ShareLink>(`/api/invoices/${id}/share-link`, { method: 'POST', body: {}, fallback: 'The link could not be made.' }),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => apiRequest<{ withdrawn: boolean }>(`/api/invoices/${id}/share-link`, { method: 'DELETE', fallback: 'The link could not be withdrawn.' }),
    onSuccess: () => share.reset(),
  });

  useEffect(() => {
    setCopied(false);
    withdraw.reset();
    if (invoice) share.mutate(invoice.id);
    else share.reset();
  }, [invoice?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = share.data;
  const message = link && invoice ? shareMessage(customerName, companyName, invoice.invoiceNo, invoice.currency || currency, invoice.amountDueCents, link.url) : '';
  const phone = normalizeKenyanPhone(customerPhone);
  const encoded = encodeURIComponent(message);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open={!!invoice} onClose={onClose} title={invoice ? `Share invoice ${invoice.invoiceNo}` : 'Share invoice'}>
      <div className="space-y-4">
        <p className="text-[13.5px] text-graphite-600">
          The customer opens the link to see the invoice, save it as a PDF and pay it by M-Pesa. Send it from your own WhatsApp,
          messages or email; the link stays the same until you withdraw it.
        </p>
        {share.isPending && <p role="status" className="text-[13.5px]">Making the link</p>}
        {share.isError && <p role="alert" className="text-[13.5px] text-ledger-red">{(share.error as Error).message}</p>}
        {withdraw.isSuccess && (
          <p role="status" className="text-[13.5px] text-ink-900">
            The link is withdrawn. Anyone who opens it now sees that it is no longer valid.{' '}
            <button type="button" className={buttonClass.quiet} onClick={() => invoice && share.mutate(invoice.id)}>Make a new link</button>
          </p>
        )}
        {link && !withdraw.isSuccess && (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input readOnly value={link.url} aria-label="Invoice link" onFocus={(e) => e.currentTarget.select()}
                className="h-10 min-w-0 flex-1 border px-3 text-[13px]" />
              <button type="button" onClick={() => void copy()} className={buttonClass.secondary}>{copied ? 'Copied' : 'Copy link'}</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className={buttonClass.primary} target="_blank" rel="noreferrer"
                href={whatsAppLink(phone, message)}>WhatsApp{phone ? '' : ' (choose the chat)'}</a>
              <a className={buttonClass.secondary} href={`sms:${phone ? `+${phone}` : ''}?body=${encoded}`}>Text message</a>
              <a className={buttonClass.secondary}
                href={`mailto:${customerEmail ?? ''}?subject=${encodeURIComponent(`Invoice ${invoice!.invoiceNo} from ${companyName}`)}&body=${encoded}`}>Email</a>
            </div>
            <p className="text-[12.5px] text-graphite-600">
              {link.views === 0 ? 'Not opened yet.' : `Opened ${link.views} ${link.views === 1 ? 'time' : 'times'}${link.lastViewedAt ? `, last on ${new Date(link.lastViewedAt).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.`}
            </p>
            {withdraw.isError && <p role="alert" className="text-[13.5px] text-ledger-red">{(withdraw.error as Error).message}</p>}
            <button type="button" onClick={() => invoice && withdraw.mutate(invoice.id)} disabled={withdraw.isPending} className={buttonClass.quiet}>
              {withdraw.isPending ? 'Withdrawing' : 'Withdraw this link'}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
