import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { whatsAppLink } from '../../utils/invoiceShare';
import { Dialog } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

interface GivingLink { url: string; createdAt: string; views: number; created: boolean }

/**
 * The church's giving page link, for the congregation: the paybill, the
 * account number for each fund and the open campaigns, with no member named.
 * Shared from the person's own WhatsApp, or printed in the bulletin.
 */
export function GivingPageDialog({ open, churchName, onClose }: { open: boolean; churchName: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const share = useMutation({
    mutationFn: () => apiRequest<GivingLink>('/api/church/giving-page', { method: 'POST', body: {}, fallback: 'The giving page link could not be made.' }),
  });
  const withdraw = useMutation({
    mutationFn: () => apiRequest<{ withdrawn: boolean }>('/api/church/giving-page', { method: 'DELETE', fallback: 'The link could not be withdrawn.' }),
    onSuccess: () => share.reset(),
  });

  useEffect(() => {
    setCopied(false);
    withdraw.reset();
    if (open) share.mutate();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = share.data;
  const message = link ? `Give to ${churchName} by M-Pesa: the paybill, the account number for each fund and how each campaign stands are here: ${link.url}` : '';

  return (
    <Dialog open={open} onClose={onClose} title="Giving page">
      <div className="space-y-4">
        <p className="text-[13.5px] text-graphite-600">
          A page anyone can open to see the church's paybill, the account number to type for each fund, and how each open campaign
          stands against its goal. It names no member and shows no gift. Share it on WhatsApp or print it in the bulletin.
        </p>
        {share.isPending && <p role="status" className="text-[13.5px]">Making the link</p>}
        {share.isError && <p role="alert" className="text-[13.5px] text-ledger-red">{(share.error as Error).message}</p>}
        {withdraw.isSuccess && (
          <p role="status" className="text-[13.5px]">
            The link is withdrawn.{' '}
            <button type="button" className={buttonClass.quiet} onClick={() => share.mutate()}>Make a new link</button>
          </p>
        )}
        {link && !withdraw.isSuccess && (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input readOnly value={link.url} aria-label="Giving page link" onFocus={(e) => e.currentTarget.select()}
                className="h-10 min-w-0 flex-1 border px-3 text-[13px]" />
              <button type="button" className={buttonClass.secondary} onClick={async () => {
                try { await navigator.clipboard.writeText(link.url); setCopied(true); } catch { setCopied(false); }
              }}>{copied ? 'Copied' : 'Copy link'}</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className={buttonClass.primary} target="_blank" rel="noreferrer" href={whatsAppLink(null, message)}>Share on WhatsApp</a>
              <a className={buttonClass.secondary} target="_blank" rel="noreferrer" href={link.url}>Open the page</a>
            </div>
            <p className="text-[12.5px] text-graphite-600">{link.views === 0 ? 'Not opened yet.' : `Opened ${link.views} ${link.views === 1 ? 'time' : 'times'}.`}</p>
            {withdraw.isError && <p role="alert" className="text-[13.5px] text-ledger-red">{(withdraw.error as Error).message}</p>}
            <button type="button" className={buttonClass.quiet} disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
              {withdraw.isPending ? 'Withdrawing' : 'Withdraw this link'}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
