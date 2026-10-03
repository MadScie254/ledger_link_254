import { useState } from 'react';
import { format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import { Amount } from '../ledger/Amount';
import { Field } from '../ledger/Dialog';
import { Mark } from '../ledger/Mark';
import { buttonClass } from '../ledger/Page';

interface Payment {
  id: string;
  amountCents: number;
  paymentDate: string;
  accountId: string;
  reversedAt: string | null;
  reversalReason: string | null;
}

const dateText = (value?: string | null) => (value ? format(new Date(value), 'dd/MM/yyyy') : '');

/**
 * The payments recorded against one invoice or bill. A payment recorded in
 * error is reversed, never deleted: a dated entry undoes it in the ledger and
 * the document is owed again. Bills over the approval limit are approved
 * here by an owner or admin who did not enter them.
 */
export function DocumentPayments({ kind, document }: { kind: 'INVOICE' | 'BILL'; document: any }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const currency = activeCompany?.baseCurrency || 'KES';
  const role = activeCompany?.role;
  const canPost = role !== 'member';
  const canApprove = role === 'owner' || role === 'admin';
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [reversalDate, setReversalDate] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');

  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: () => apiRequest('/api/accounts'),
  });
  const accountName = (id: string) => {
    const account = (accountsData?.accounts || []).find((a: any) => a.id === id);
    return account ? `${account.code} · ${account.name}` : '';
  };

  const path = kind === 'INVOICE' ? `/api/invoices/${document.id}` : `/api/bills/${document.id}`;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['drilldown', kind, document.id, currentOrgId] });
    queryClient.invalidateQueries({ queryKey: [kind === 'INVOICE' ? 'invoices' : 'bills', currentOrgId] });
    queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-metrics', currentOrgId] });
  };

  const reverse = useMutation({
    mutationFn: () => apiRequest(`${path}/payments/${reversing!.id}/reverse`, {
      body: { reversalDate, reason: reason.trim() },
      fallback: 'The payment could not be reversed.',
    }),
    onSuccess: () => {
      setNotice(`Payment of ${dateText(reversing!.paymentDate)} reversed on ${dateText(reversalDate)}. The ${kind === 'INVOICE' ? 'invoice' : 'bill'} is owed again.`);
      setReversing(null);
      refresh();
    },
  });

  const approve = useMutation({
    mutationFn: () => apiRequest<{ billNumber: string }>(`/api/bills/${document.id}/approve`, { method: 'POST', fallback: 'The bill could not be approved.' }),
    onSuccess: (result) => {
      setNotice(`Bill ${result.billNumber} approved for payment.`);
      refresh();
    },
  });

  const payments: Payment[] = document.payments || [];
  const threshold = activeCompany?.approvalThresholdCents ?? null;
  const needsApproval = kind === 'BILL' && threshold != null && document.status !== 'VOID'
    && !document.approvedAt && Number(document.totalCents || 0) >= threshold;

  return (
    <section className="md:col-span-2 space-y-3">
      {kind === 'BILL' && (document.approvedAt || needsApproval) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-feint pb-3">
          <p className="text-[13.5px] text-ink-900">
            {document.approvedAt
              ? <Mark kind="tick" label={`Approved for payment on ${dateText(document.approvedAt)}`} />
              : 'Over the approval limit: an owner or admin who did not enter this bill approves it before it is paid.'}
          </p>
          {needsApproval && canApprove && (
            <button type="button" className={buttonClass.secondary} disabled={approve.isPending} onClick={() => approve.mutate()}>
              {approve.isPending ? 'Approving' : 'Approve for payment'}
            </button>
          )}
        </div>
      )}
      {approve.isError && <p role="alert" className="text-[13px] text-ledger-red">{approve.error.message}</p>}

      <h3 className="ll-printed border-b border-ink-900 pb-1 text-[11px] text-graphite-600">Payments</h3>
      {payments.length === 0 ? (
        <p className="text-[13.5px] text-graphite-600">No payments recorded.</p>
      ) : (
        <ul>
          {payments.map((payment) => (
            <li key={payment.id} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-feint py-2 text-[13.5px]">
              <span className="min-w-0">
                <span className={payment.reversedAt ? 'text-graphite-600 line-through' : 'text-ink-900'}>
                  {dateText(payment.paymentDate)} · {accountName(payment.accountId) || 'Account'}
                </span>
                {payment.reversedAt && (
                  <span className="block text-[12.5px] text-graphite-600">
                    Reversed {dateText(payment.reversedAt)}{payment.reversalReason ? `: ${payment.reversalReason}` : ''}
                  </span>
                )}
              </span>
              <span className="flex items-baseline gap-3">
                <Amount cents={payment.amountCents} currency={currency} tone="ink" />
                {!payment.reversedAt && canPost && (
                  <button
                    type="button"
                    className={buttonClass.quiet}
                    onClick={() => {
                      setNotice('');
                      reverse.reset();
                      setReversing(payment);
                      setReversalDate(todayIn(activeCompany?.timeZone));
                      setReason('');
                    }}
                  >
                    Reverse
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {reversing && (
        <form
          className="space-y-3 border border-field p-3"
          onSubmit={(e) => {
            e.preventDefault();
            reverse.mutate();
          }}
        >
          <p className="text-[13.5px] text-ink-900">
            Reverse the payment of <Amount cents={reversing.amountCents} currency={currency} tone="ink" /> dated {dateText(reversing.paymentDate)}? A reversing entry is posted on the date below and the original stays on record.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label="Reversal date">
              <input type="date" required min={reversing.paymentDate} value={reversalDate} onChange={(e) => setReversalDate(e.target.value)} />
            </Field>
            <Field label="Reason" hint="For example, cheque bounced or posted to the wrong invoice">
              <input type="text" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          {reverse.isError && <p role="alert" className="text-[13px] text-ledger-red">{reverse.error.message}</p>}
          <div className="flex gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => setReversing(null)}>Keep the payment</button>
            <button type="submit" className={buttonClass.secondary} disabled={reverse.isPending || !reason.trim()}>
              {reverse.isPending ? 'Reversing' : 'Reverse payment'}
            </button>
          </div>
        </form>
      )}
      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}
    </section>
  );
}
