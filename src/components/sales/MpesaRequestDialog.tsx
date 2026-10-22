import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { normalizeKenyanPhone } from '../../utils/mpesaExpress';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

interface RequestRow {
  id: string;
  phone: string;
  amountCents: number;
  status: 'PENDING' | 'SENT' | 'PAID' | 'FAILED';
  message: string | null;
  createdAt: string;
  completedAt: string | null;
  settlement: { outcome: 'WAITING' | 'SETTLED'; note: string | null; transId: string } | null;
}

interface InvoiceLike {
  id: string;
  invoiceNo: string;
  amountDueCents: number;
}

/** A request is waiting on the customer's phone for at most this long before the page stops checking. */
const WATCH_MS = 3 * 60 * 1000;

/**
 * Asks the customer's phone to pay an invoice (M-Pesa Express). The phone
 * shows the paybill and the invoice's number as the account; when the
 * customer enters their PIN, Safaricom's result settles the invoice in the
 * name of the person who asked. M-Pesa takes whole shillings.
 */
export function MpesaRequestDialog({ invoice, customerName, customerPhone, currency, onClose }: {
  invoice: InvoiceLike | null;
  customerName: string;
  customerPhone: string | null;
  currency: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [problem, setProblem] = useState('');
  const [watchUntil, setWatchUntil] = useState(0);
  const wholeDue = Math.floor((invoice?.amountDueCents || 0) / 100);

  useEffect(() => {
    if (!invoice) return;
    setPhone(customerPhone || '');
    setProblem('');
    setWatchUntil(0);
  }, [invoice?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // What is due changes when a payment lands; the amount follows it.
  useEffect(() => {
    if (invoice) setAmount(wholeDue > 0 ? String(wholeDue) : '');
  }, [invoice?.id, wholeDue]); // eslint-disable-line react-hooks/exhaustive-deps

  const requests = useQuery({
    queryKey: ['mpesa-requests', invoice?.id],
    queryFn: () => apiRequest<{ requests: RequestRow[] }>(`/api/invoices/${invoice!.id}/mpesa-requests`, { fallback: 'The payment requests could not be loaded.' }),
    enabled: Boolean(invoice),
    refetchInterval: (query) => {
      const latest = (query.state.data as { requests: RequestRow[] } | undefined)?.requests[0];
      return latest && (latest.status === 'SENT' || latest.status === 'PENDING') && Date.now() < watchUntil ? 3000 : false;
    },
  });
  const latest = requests.data?.requests[0];

  // When a result arrives, the invoice and the books have changed.
  useEffect(() => {
    if (latest && latest.status === 'PAID') {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['bank_transactions'] });
    }
  }, [latest?.id, latest?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: (body: { phone: string; amountCents: number }) => apiRequest<{ id: string; status: 'SENT' | 'FAILED'; message: string }>(
      `/api/invoices/${invoice!.id}/mpesa-request`, { method: 'POST', body, fallback: 'The payment request was not sent.' }),
    onSuccess: (result) => {
      if (result.status === 'FAILED') setProblem(result.message);
      else setWatchUntil(Date.now() + WATCH_MS);
      queryClient.invalidateQueries({ queryKey: ['mpesa-requests', invoice?.id] });
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const submit = () => {
    setProblem('');
    if (!normalizeKenyanPhone(phone)) {
      setProblem('Enter the customer\'s Safaricom number, such as 0712 345 678.');
      return;
    }
    const shillings = Number(amount);
    if (!Number.isInteger(shillings) || shillings < 1) {
      setProblem('M-Pesa takes whole shillings, at least 1.');
      return;
    }
    if (shillings > wholeDue) {
      setProblem(`Ask for no more than ${wholeDue.toLocaleString('en-KE')}, the whole shillings due.`);
      return;
    }
    send.mutate({ phone, amountCents: shillings * 100 });
  };

  const waiting = latest && (latest.status === 'SENT' || latest.status === 'PENDING');

  return (
    <Dialog
      open={!!invoice}
      onClose={() => { if (!send.isPending) onClose(); }}
      title="Ask for payment by M-Pesa"
      note={invoice ? `${invoice.invoiceNo} · ${customerName}` : undefined}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={send.isPending} className={buttonClass.secondary}>Close</button>
          <button type="button" onClick={submit} disabled={send.isPending || wholeDue < 1 || Boolean(waiting && Date.now() < watchUntil)} className={buttonClass.primary}>
            {send.isPending ? 'Sending' : 'Send to the phone'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="ll-total flex items-baseline justify-between py-2 text-[13.5px]">
          <span className="font-semibold text-ink-900">Amount due</span>
          <Amount cents={invoice?.amountDueCents || 0} currency={currency} tone="ink" />
        </div>
        <Field label="Customer's Safaricom number">
          <input type="tel" inputMode="tel" autoComplete="off" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={`Amount (${currency}, whole shillings)`} hint={(invoice?.amountDueCents || 0) % 100 ? 'M-Pesa takes whole shillings, so the cents stay due.' : undefined}>
          <input type="number" min="1" max={wholeDue} step="1" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-currency" />
        </Field>
        <p className="text-[12.5px] text-graphite-600">
          The customer&apos;s phone shows the paybill with this invoice&apos;s number as the account. Once they enter their PIN, the payment
          lands on the M-Pesa account and settles the invoice.
        </p>
        {wholeDue < 1 && <p className="text-[13px] text-ink-900">Nothing is left to ask for on this invoice.</p>}
        {problem && <p role="alert" className="text-[13px] text-ledger-red">{problem}</p>}
        <div aria-live="polite" className="space-y-1.5 border-t border-feint pt-3">
          {(requests.data?.requests || []).length === 0 && <p className="text-[13px] text-graphite-600">No requests sent for this invoice yet.</p>}
          {(requests.data?.requests || []).map((request) => (
            <p key={request.id} className="text-[13px] text-ink-900">
              {format(new Date(request.createdAt), 'dd/MM/yyyy HH:mm')} · <Amount cents={request.amountCents} currency={currency} size="sm" tone="ink" /> to {request.phone}:{' '}
              {request.status === 'PAID' && request.settlement?.outcome === 'SETTLED' && `paid, receipt ${request.settlement.transId}, invoice settled.`}
              {request.status === 'PAID' && request.settlement?.outcome !== 'SETTLED' && `paid${request.settlement ? `, receipt ${request.settlement.transId}` : ''}. ${request.settlement?.note || 'It waits in Banking.'}`}
              {request.status === 'FAILED' && `not paid. ${request.message || ''}`}
              {(request.status === 'SENT' || request.status === 'PENDING') && (Date.now() < watchUntil
                ? 'waiting for the customer to enter their PIN.'
                : 'no answer from Safaricom yet. A payment that arrives later still settles the invoice.')}
            </p>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
