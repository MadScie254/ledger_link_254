import { useCallback, useEffect, useState } from 'react';
import { normalizeKenyanPhone } from '../../utils/mpesaExpress';
import { printedMoney, printedQuantity, printFileName, type PrintDocument } from '../../utils/printDocument';

interface PublicInvoice {
  document: PrintDocument;
  status: string;
  amountDueCents: number;
  currency: string;
  pay: { paybill: string | null; accountNumber: string; canRequestPayment: boolean };
}

type RequestState =
  | { stage: 'idle' }
  | { stage: 'sending' }
  | { stage: 'waiting'; id: string; message: string | null; until: number }
  | { stage: 'paid' }
  | { stage: 'failed'; message: string };

/** How long the page keeps checking on a request before saying so. */
const WATCH_MS = 3 * 60 * 1000;

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data && typeof data.error === 'string' && data.error) || fallback);
  return data as T;
}

/**
 * The page a customer opens from a shared invoice link, outside sign-in:
 * the invoice as printed, a PDF to save, and how to pay it by M-Pesa.
 */
export function PublicInvoicePage({ token }: { token: string }) {
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loadProblem, setLoadProblem] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [request, setRequest] = useState<RequestState>({ stage: 'idle' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await readJson<PublicInvoice>(await fetch(`/api/public/invoices/${token}`), 'This invoice could not be opened.');
      setInvoice(data);
      setAmount((current) => current || (data.amountDueCents >= 100 ? String(Math.floor(data.amountDueCents / 100)) : ''));
      document.title = `${data.document.title} ${data.document.number} · ${data.document.company.name}`;
    } catch (err) {
      setLoadProblem((err as Error).message);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // While a request waits on the customer's phone, check on it.
  useEffect(() => {
    if (request.stage !== 'waiting') return;
    const timer = window.setInterval(async () => {
      if (Date.now() > request.until) {
        window.clearInterval(timer);
        setRequest({ stage: 'failed', message: 'No answer came from the phone yet. If you paid, the invoice will show as paid shortly; otherwise try again.' });
        return;
      }
      try {
        const status = await readJson<{ status: string; message: string | null }>(
          await fetch(`/api/public/invoices/${token}/mpesa/${request.id}`), 'The payment could not be checked.');
        if (status.status === 'PAID') {
          window.clearInterval(timer);
          setRequest({ stage: 'paid' });
          void load();
        } else if (status.status === 'FAILED') {
          window.clearInterval(timer);
          setRequest({ stage: 'failed', message: status.message || 'The payment did not go through.' });
        }
      } catch {
        // A missed check is tried again on the next tick.
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [request, token, load]);

  if (loadProblem) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-ink-900">
        <h1 className="text-[22px] font-semibold">Invoice not available</h1>
        <p className="mt-3 text-[15px] leading-relaxed">{loadProblem}</p>
      </main>
    );
  }
  if (!invoice) {
    return <main className="mx-auto max-w-xl px-4 py-16 text-[15px] text-graphite-600" role="status">Opening the invoice</main>;
  }

  const doc = invoice.document;
  const due = invoice.amountDueCents;
  const wholeDue = Math.floor(due / 100);
  const normalizedPhone = normalizeKenyanPhone(phone);
  const amountCents = Math.round(Number(amount || 0)) * 100;
  const amountValid = Number.isInteger(Number(amount)) && amountCents >= 100 && amountCents <= due;

  const ask = async () => {
    if (!normalizedPhone || !amountValid) return;
    setRequest({ stage: 'sending' });
    try {
      const result = await readJson<{ id: string; status: string; message: string | null }>(await fetch(`/api/public/invoices/${token}/mpesa`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, amountCents }),
      }), 'The request could not be sent.');
      if (result.status === 'FAILED') setRequest({ stage: 'failed', message: result.message || 'Safaricom did not send the request.' });
      else setRequest({ stage: 'waiting', id: result.id, message: result.message, until: Date.now() + WATCH_MS });
    } catch (err) {
      setRequest({ stage: 'failed', message: (err as Error).message });
    }
  };

  const savePdf = async () => {
    setSaving(true);
    try {
      const { buildDocumentPdf } = await import('../../utils/documentPdf');
      buildDocumentPdf(doc).save(printFileName(doc));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-8 text-ink-900">
      <div className="h-1.5 w-full" style={{ background: doc.accent }} aria-hidden="true" />
      <header className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[18px] font-semibold">{doc.company.name}</p>
          {[doc.company.address, doc.company.city].filter(Boolean).length > 0 && (
            <p className="text-[13px] text-graphite-600">{[doc.company.address, doc.company.city].filter(Boolean).join(', ')}</p>
          )}
          {doc.company.taxId && <p className="text-[13px] text-graphite-600">KRA PIN {doc.company.taxId}</p>}
        </div>
        <div className="text-right">
          <h1 className="text-[20px] font-semibold">{doc.title} {doc.number}</h1>
          {doc.stamp && <p className="mt-1 text-[13px] font-semibold uppercase tracking-wide" style={{ color: doc.accent }}>{doc.stamp.toLowerCase()}</p>}
        </div>
      </header>

      <section className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="Details">
        {doc.party && (
          <div>
            <p className="text-[12px] uppercase tracking-wide text-graphite-600">{doc.partyLabel}</p>
            <p className="mt-1 text-[14.5px]">{doc.party.name}</p>
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13.5px] sm:justify-self-end">
          {doc.facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-graphite-600">{fact.label}</dt>
              <dd className="text-right">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <caption className="sr-only">Lines, in {doc.currency}</caption>
          <thead>
            <tr className="border-b border-feint-strong text-left text-graphite-600">
              <th scope="col" className="py-2 pr-4 font-normal">Description</th>
              <th scope="col" className="py-2 pr-4 text-right font-normal">Qty</th>
              <th scope="col" className="py-2 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((line, index) => (
              <tr key={index} className="border-b border-feint">
                <td className="py-2 pr-4">{line.description}</td>
                <td className="py-2 pr-4 text-right ll-figure">{printedQuantity(line.quantity)}</td>
                <td className="py-2 text-right ll-figure">{printedMoney(line.amountCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {doc.totals.map((total) => (
              <tr key={total.label}>
                <th scope="row" colSpan={2} className={`py-1.5 pr-4 text-right ${total.emphasis ? 'font-semibold' : 'font-normal text-graphite-600'}`}>{total.label}</th>
                <td className={`py-1.5 text-right ll-figure ${total.emphasis ? 'font-semibold' : ''}`}>{printedMoney(total.cents)}</td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      <section className="mt-8 border-t-2 border-ink-900 pt-5" aria-label="Payment">
        {due > 0 ? (
          <p className="text-[15px]">Amount due <span className="ml-2 text-[22px] font-semibold ll-figure">{invoice.currency} {printedMoney(due)}</span></p>
        ) : (
          <p className="text-[16px] font-semibold">Paid in full. Thank you.</p>
        )}

        {due > 0 && invoice.pay.canRequestPayment && (
          <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
            <h2 className="text-[16px] font-semibold">Pay with M-Pesa</h2>
            <p className="text-[13.5px] text-graphite-600">Enter your Safaricom number. Your phone will ask for your M-Pesa PIN; the invoice shows as paid once Safaricom confirms it.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="block text-[13px] font-semibold">Safaricom number</span>
                <input type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="0712 345 678" className="mt-1.5 h-11 w-full border px-3 text-[15px]" />
              </label>
              <label className="block">
                <span className="block text-[13px] font-semibold">Amount ({invoice.currency}, whole shillings)</span>
                <input type="number" inputMode="numeric" min={1} max={wholeDue} step={1} required value={amount}
                  onChange={(e) => setAmount(e.target.value)} className="mt-1.5 h-11 w-full border px-3 text-[15px]" />
              </label>
            </div>
            {phone && !normalizedPhone && <p className="text-[13px] text-ledger-red">That is not a Safaricom number. Use the form 0712 345 678.</p>}
            {amount && !amountValid && <p className="text-[13px] text-ledger-red">Enter whole shillings from 1 to {wholeDue.toLocaleString('en-KE')}.</p>}
            <button type="submit" disabled={!normalizedPhone || !amountValid || request.stage === 'sending' || request.stage === 'waiting'}
              className="h-11 px-5 text-[15px] font-semibold text-white disabled:opacity-60" style={{ background: doc.accent }}>
              {request.stage === 'sending' ? 'Sending' : request.stage === 'waiting' ? 'Waiting for your phone' : 'Send payment request'}
            </button>
            <p role="status" className="text-[14px]">
              {request.stage === 'waiting' && (request.message || 'Check your phone and enter your M-Pesa PIN.')}
              {request.stage === 'paid' && 'Payment received. Thank you.'}
            </p>
            {request.stage === 'failed' && <p role="alert" className="text-[14px] text-ledger-red">{request.message}</p>}
          </form>
        )}

        {due > 0 && invoice.pay.paybill && (
          <div className="mt-6">
            <h2 className="text-[16px] font-semibold">{invoice.pay.canRequestPayment ? 'Or pay from the M-Pesa menu' : 'Pay from the M-Pesa menu'}</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14.5px]">
              <dt className="text-graphite-600">Paybill</dt><dd className="ll-figure font-semibold">{invoice.pay.paybill}</dd>
              <dt className="text-graphite-600">Account number</dt><dd className="ll-figure font-semibold">{invoice.pay.accountNumber}</dd>
              <dt className="text-graphite-600">Amount</dt><dd className="ll-figure">{printedMoney(due)}</dd>
            </dl>
          </div>
        )}

        {due > 0 && !invoice.pay.paybill && !invoice.pay.canRequestPayment && doc.paymentDetails && (
          <div className="mt-6">
            <h2 className="text-[16px] font-semibold">How to pay</h2>
            <p className="mt-2 whitespace-pre-wrap text-[14px]">{doc.paymentDetails}</p>
          </div>
        )}

        <button type="button" onClick={() => void savePdf()} disabled={saving}
          className="mt-6 h-11 border border-ink-900 px-5 text-[14.5px] font-semibold">
          {saving ? 'Preparing the PDF' : 'Save as PDF'}
        </button>
      </section>

      {doc.notes && <p className="mt-8 whitespace-pre-wrap text-[13.5px] text-graphite-600">{doc.notes}</p>}
      <p className="mt-10 text-[12px] text-graphite-600">Sent with Ledger Link</p>
    </main>
  );
}
