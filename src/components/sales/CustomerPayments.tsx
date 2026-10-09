import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest, newIdempotencyKey } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import { centsFromAmountText } from '../../utils/salesOrders';
import { oldestDueFirst, shareOldestFirst } from '../../utils/customerPayments';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { EmptyNote, LoadProblem, SkeletonRows, buttonClass } from '../ledger/Page';

const printed = (iso: string | null | undefined) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
};

function refreshSales(queryClient: ReturnType<typeof useQueryClient>, orgId: string) {
  for (const key of ['invoices', 'customer-payments', 'credit-notes', 'customers', 'accounts', 'journal-entries', 'dashboard-metrics']) {
    queryClient.invalidateQueries({ queryKey: [key, orgId] });
  }
}

/**
 * One payment from a customer across several of their invoices: banked
 * once, shared oldest due first unless amounts are chosen, the rest kept as
 * the customer's credit. Invoices in another currency are paid on their own.
 */
export function CustomerPaymentDialog({ invoices, customers, accounts, baseCurrency, onClose, onDone }: {
  invoices: any[]; customers: any[]; accounts: any[]; baseCurrency: string; onClose: () => void; onDone: (message: string) => void;
}) {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const deposit = accounts.filter((account) => account.isBankAccount && account.isActive !== false
    && (!account.currency || String(account.currency).toUpperCase() === baseCurrency.toUpperCase()));
  const open = invoices.filter((invoice) => !['PAID', 'VOID', 'DRAFT'].includes(invoice.status) && invoice.amountDueCents > 0
    && String(invoice.currency || baseCurrency).toUpperCase() === baseCurrency.toUpperCase());
  const owing = customers.filter((customer) => open.some((invoice) => invoice.customerId === customer.id));
  const [customerId, setCustomerId] = useState(owing[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIn(activeCompany?.timeZone));
  const [depositAccountId, setDepositAccountId] = useState(deposit[0]?.id || '');
  const [reference, setReference] = useState('');
  const [choose, setChoose] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [key, setKey] = useState(newIdempotencyKey);
  const theirs = useMemo(() => oldestDueFirst(open.filter((invoice) => invoice.customerId === customerId)
    .map((invoice) => ({ ...invoice, dueDate: invoice.dueDate || null }))), [open, customerId]);
  const cents = centsFromAmountText(amount) || 0;
  const auto = shareOldestFirst(theirs, cents, date);
  const manual = theirs.map((invoice) => ({ invoiceId: invoice.id, amountCents: centsFromAmountText(chosen[invoice.id] || '') || 0 }))
    .filter((share) => share.amountCents > 0);
  const manualTotal = manual.reduce((sum, share) => sum + share.amountCents, 0);
  const creditCents = choose ? cents - manualTotal : auto.creditCents;
  const post = useMutation({
    mutationFn: () => apiRequest<{ number: string; appliedCents: number; creditCents: number; invoices: any[] }>('/api/customer-payments', {
      body: {
        customerId, paymentDate: date, depositAccountId, amountCents: cents, reference: reference || undefined,
        allocations: choose ? manual : null, idempotencyKey: key,
      },
      fallback: 'The payment was not posted.',
    }),
    onSuccess: (result) => {
      refreshSales(queryClient, currentOrgId);
      setKey(newIdempotencyKey());
      const kes = (value: number) => `${baseCurrency} ${(value / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
      onDone(`Payment ${result.number} posted: ${kes(result.appliedCents)} to ${result.invoices.length} ${result.invoices.length === 1 ? 'invoice' : 'invoices'}`
        + `${result.creditCents ? `, ${kes(result.creditCents)} kept as credit` : ''}.`);
    },
  });
  const problem = choose && manualTotal > cents ? 'The invoices are given more than was received.' : '';
  return (
    <Dialog open onClose={onClose} title="Receive a payment" width="lg"
      note="One deposit from a customer, shared across their invoices. What the invoices do not take is kept as the customer's credit."
      footer={(
        <>
          <button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" form="customer-payment-form" className={buttonClass.primary}
            disabled={post.isPending || !cents || !customerId || !depositAccountId || Boolean(problem)}>
            {post.isPending ? 'Posting' : 'Post payment'}
          </button>
        </>
      )}>
      <form id="customer-payment-form" className="space-y-4" onSubmit={(event) => { event.preventDefault(); post.mutate(); }}>
        {owing.length === 0 && <p className="text-[13px] text-graphite-600">No customer has an invoice in {baseCurrency} waiting for payment. A payment can still be kept as credit.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer">
            <select required value={customerId} onChange={(e) => { setCustomerId(e.target.value); setChosen({}); }} name="customerId">
              <option value="">Choose the customer</option>
              {(owing.length ? owing : customers).map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName || customer.display_name}</option>)}
            </select>
          </Field>
          <Field label={`Amount received (${baseCurrency})`}>
            <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} name="amount" />
          </Field>
          <Field label="Date received"><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} name="paymentDate" /></Field>
          <Field label="Deposit account">
            <select required value={depositAccountId} onChange={(e) => setDepositAccountId(e.target.value)} name="depositAccountId">
              {deposit.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2"><Field label="Reference" hint="Optional: the bank or M-Pesa reference."><input maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} name="reference" /></Field></div>
        </div>
        {theirs.length > 0 && (
          <div>
            <label className="flex items-center gap-2 text-[13.5px]">
              <input type="checkbox" checked={choose} onChange={(e) => setChoose(e.target.checked)} name="choose" />
              Choose how much goes to each invoice (otherwise oldest due first)
            </label>
            <table className="mt-2 w-full text-[13.5px]">
              <caption className="sr-only">Open invoices</caption>
              <thead><tr><th scope="col" className="text-left">Invoice</th><th scope="col" className="text-left">Due</th><th scope="col" className="text-right">Owing</th><th scope="col" className="text-right">This payment</th></tr></thead>
              <tbody>
                {theirs.map((invoice) => {
                  const share = auto.shares.find((item) => item.invoiceId === invoice.id)?.amountCents || 0;
                  return (
                    <tr key={invoice.id}>
                      <td className="py-1.5 ll-figure">{invoice.invoiceNo}</td>
                      <td className="py-1.5">{printed(invoice.dueDate)}</td>
                      <td className="py-1.5 text-right"><Amount cents={invoice.amountDueCents} currency={baseCurrency} /></td>
                      <td className="py-1.5 text-right">
                        {choose
                          ? <input aria-label={`Amount for ${invoice.invoiceNo}`} inputMode="decimal" className="h-8 w-28 border px-2 text-right" name={`share-${invoice.invoiceNo}`}
                            value={chosen[invoice.id] || ''} onChange={(e) => setChosen({ ...chosen, [invoice.id]: e.target.value })} />
                          : <Amount cents={share} currency={baseCurrency} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {cents > 0 && creditCents > 0 && !problem && <p className="text-[13px] text-ink-900"><Amount cents={creditCents} currency={baseCurrency} /> is kept as the customer's credit, to apply to a later invoice or refund.</p>}
        {problem && <p role="alert" className="text-[13px] text-ledger-red">{problem}</p>}
        {post.error && <p role="alert" className="text-[13px] text-ledger-red">{(post.error as Error).message}</p>}
      </form>
    </Dialog>
  );
}

/** Payments received across invoices, newest first, each reversible whole. */
export function CustomerPaymentsPanel({ baseCurrency, onReceive }: { baseCurrency: string; onReceive: () => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const canPost = activeCompany?.role !== 'member';
  const [reversing, setReversing] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [reversalDate, setReversalDate] = useState(todayIn(activeCompany?.timeZone));
  const [notice, setNotice] = useState('');
  const payments = useQuery({
    queryKey: ['customer-payments', currentOrgId],
    queryFn: () => apiRequest<{ payments: any[] }>('/api/customer-payments', { fallback: 'The payments could not be loaded.' }),
  });
  const reverse = useMutation({
    mutationFn: () => apiRequest<{ number: string }>(`/api/customer-payments/${reversing.id}/reverse`, { body: { reversalDate, reason }, fallback: 'The payment was not reversed.' }),
    onSuccess: (result) => {
      refreshSales(queryClient, currentOrgId);
      setNotice(`Payment ${result.number} reversed. Its invoices are owed again.`);
      setReversing(null); setReason('');
    },
  });
  if (payments.isError) return <LoadProblem what="payments" path="/api/customer-payments" onRetry={() => payments.refetch()} />;
  if (payments.isLoading) return <SkeletonRows label="Loading payments" />;
  const list = payments.data?.payments || [];
  return (
    <div className="space-y-3">
      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}
      {list.length === 0 ? (
        <EmptyNote action={canPost && <button type="button" className={buttonClass.quiet} onClick={onReceive}>Receive a payment</button>}>
          No payment across invoices yet. When a customer pays several invoices with one deposit, receive it here.
        </EmptyNote>
      ) : (
        <table className="w-full text-[13.5px]">
          <caption className="sr-only">Payments received across invoices</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-3 text-left">Payment</th>
              <th scope="col" className="pr-3 text-left">Customer</th>
              <th scope="col" className="hidden pr-3 text-left md:table-cell">Invoices</th>
              <th scope="col" className="pr-3 text-right">Received</th>
              <th scope="col" className="text-left"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.map((payment) => (
              <tr key={payment.id} className={`align-top ${payment.status === 'REVERSED' ? 'text-graphite-600' : ''}`}>
                <td className="py-2 pr-3"><span className="ll-figure">{payment.number}</span><span className="block text-[12px] text-graphite-600">{printed(payment.date)}{payment.reference ? ` · ${payment.reference}` : ''}</span></td>
                <td className="py-2 pr-3">{payment.customerName}</td>
                <td className="hidden py-2 pr-3 md:table-cell">
                  {payment.invoices.map((share: any) => `${share.invoiceNumber}`).join(', ') || 'None'}
                  {payment.creditCents > 0 && <span className="block text-[12px] text-graphite-600">Kept as credit: <Amount cents={payment.creditCents} currency={baseCurrency} /></span>}
                </td>
                <td className="py-2 pr-3 text-right"><Amount cents={payment.amountCents} currency={baseCurrency} /></td>
                <td className="py-2">
                  {payment.status === 'REVERSED'
                    ? <span className="text-[12.5px]">Reversed{payment.reversalReason ? `: ${payment.reversalReason}` : ''}</span>
                    : canPost && <button type="button" className={buttonClass.quiet} onClick={() => { setReversing(payment); reverse.reset(); }}>Reverse</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {reversing && (
        <Dialog open onClose={() => setReversing(null)} title={`Reverse ${reversing.number}`}
          note="A dated entry undoes the whole payment: its invoices are owed again and any credit it left is withdrawn."
          footer={(
            <>
              <button type="button" className={buttonClass.secondary} onClick={() => setReversing(null)}>Cancel</button>
              <button type="submit" form="reverse-payment-form" className={buttonClass.primary} disabled={reverse.isPending || reason.trim().length < 3}>{reverse.isPending ? 'Posting' : 'Reverse payment'}</button>
            </>
          )}>
          <form id="reverse-payment-form" className="space-y-4" onSubmit={(event) => { event.preventDefault(); reverse.mutate(); }}>
            <Field label="Reversal date"><input type="date" required value={reversalDate} onChange={(e) => setReversalDate(e.target.value)} name="reversalDate" /></Field>
            <Field label="Why"><input required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} name="reason" /></Field>
            {reverse.error && <p role="alert" className="text-[13px] text-ledger-red">{(reverse.error as Error).message}</p>}
          </form>
        </Dialog>
      )}
    </div>
  );
}
