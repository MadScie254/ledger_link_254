import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { Mark } from '../ledger/Mark';
import { EmptyNote, LoadProblem, SkeletonRows, buttonClass } from '../ledger/Page';

export type CashKind = 'SALES_RECEIPT' | 'EXPENSE' | 'TRANSFER';

const NOUN: Record<CashKind, { one: string; many: string; empty: string }> = {
  SALES_RECEIPT: { one: 'sales receipt', many: 'sales receipts', empty: 'No sales receipts yet. A sale paid on the spot, by cash, card or M-Pesa, is recorded here in one step.' },
  EXPENSE: { one: 'expense', many: 'expenses', empty: 'No expenses yet. A purchase paid on the spot is recorded here, with a photo of the receipt read for you if AI features are on.' },
  TRANSFER: { one: 'transfer', many: 'transfers', empty: 'No transfers yet. Money moved between your bank, cash and M-Pesa accounts is recorded here.' },
};

const shortDate = (value: string | null | undefined) => (value ? format(parseISO(value), 'dd/MM/yyyy') : '');

/**
 * Sales receipts, expenses or transfers, newest first, each voidable with a
 * dated reversing entry and a reason.
 */
export function CashTransactionsPanel({ kind, onCreate, createLabel }: { kind: CashKind; onCreate?: () => void; createLabel?: string }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const currency = activeCompany?.baseCurrency || 'KES';
  const canPost = activeCompany?.role !== 'member';
  const noun = NOUN[kind];
  const [voiding, setVoiding] = useState<any | null>(null);
  const [voidDate, setVoidDate] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');

  const list = useQuery({
    queryKey: ['cash-transactions', currentOrgId, kind],
    queryFn: () => apiRequest<{ transactions: any[] }>(`/api/cash-transactions?kind=${kind}`, { fallback: `Failed to fetch ${noun.many}` }),
  });

  const voidMutation = useMutation({
    mutationFn: () => apiRequest(`/api/cash-transactions/${voiding.id}/void`, {
      body: { voidDate, reason: reason.trim() },
      fallback: `The ${noun.one} could not be voided.`,
    }),
    onSuccess: () => {
      setNotice(`${voiding.number} voided on ${shortDate(voidDate)}. A reversing entry is posted and the original stays on record.`);
      setVoiding(null);
      for (const key of ['cash-transactions', 'accounts', 'journal-entries', 'dashboard-metrics', 'inventory']) {
        queryClient.invalidateQueries({ queryKey: [key, currentOrgId] });
      }
    },
  });

  const transactions = list.data?.transactions || [];
  const posted = transactions.filter((t) => t.status !== 'VOID');
  const postedTotal = posted.reduce((sum, t) => sum + t.totalCents, 0);

  const describe = (t: any) => {
    if (kind === 'TRANSFER') return `${t.moneyAccountName || 'Account'} to ${t.toAccountName || 'account'}`;
    const party = t.partyName || (kind === 'SALES_RECEIPT' ? 'Walk-in' : 'No payee');
    const first = t.lines[0]?.description;
    return `${party}${first ? ` · ${first}${t.lines.length > 1 ? ' and more' : ''}` : ''}`;
  };

  return (
    <div className="space-y-3">
      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}
      {list.isError ? (
        <LoadProblem what={noun.many} path="/api/cash-transactions" onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <SkeletonRows label={`Loading ${noun.many}`} />
      ) : transactions.length === 0 ? (
        <EmptyNote action={onCreate && canPost ? <button type="button" onClick={onCreate} className={buttonClass.quiet}>{createLabel || `Record the first ${noun.one}`}</button> : undefined}>
          {noun.empty}
        </EmptyNote>
      ) : (
        <ul className="border-t border-feint-strong" aria-label={`${noun.many}, figures in ${currency}`}>
          {transactions.map((t) => (
            <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-feint py-2.5">
              <div className="min-w-0">
                <p className={`text-[14px] ${t.status === 'VOID' ? 'text-graphite-600 line-through' : 'text-ink-900'}`}>
                  <span className="ll-figure mr-2 text-graphite-600">{t.number}</span>
                  {describe(t)}
                </p>
                <p className="mt-0.5 text-[12.5px] text-graphite-600">
                  {shortDate(t.date)}
                  {kind !== 'TRANSFER' && t.moneyAccountName ? ` · ${kind === 'SALES_RECEIPT' ? 'into' : 'from'} ${t.moneyAccountName}` : ''}
                  {t.reference ? ` · Ref. ${t.reference}` : ''}
                  {t.status === 'VOID' ? ` · Void${t.voidReason ? `: ${t.voidReason}` : ''}` : ''}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Amount cents={t.totalCents} currency={currency} tone="ink" />
                {t.status !== 'VOID' && canPost && (
                  <button
                    type="button"
                    className={buttonClass.quiet}
                    onClick={() => { voidMutation.reset(); setVoidDate(todayIn(activeCompany?.timeZone)); setReason(''); setNotice(''); setVoiding(t); }}
                  >
                    Void
                  </button>
                )}
              </div>
            </li>
          ))}
          <li className="ll-total flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
            <span className="font-semibold text-ink-900">{posted.length} {posted.length === 1 ? noun.one : noun.many}, not void</span>
            <Amount cents={postedTotal} currency={currency} tone="ink" className="font-semibold" />
          </li>
        </ul>
      )}

      <Dialog
        open={!!voiding}
        onClose={() => setVoiding(null)}
        title={`Void ${voiding?.number || ''}`}
        note={`A reversing entry is posted on the date below${kind !== 'TRANSFER' ? ', stock it moved is moved back,' : ''} and the original stays on record.`}
        footer={
          <>
            {voidMutation.isError && <p role="alert" className="mr-auto text-[13px] text-ledger-red">{voidMutation.error.message}</p>}
            <button type="button" onClick={() => setVoiding(null)} className={buttonClass.secondary}>Keep it</button>
            <button type="button" disabled={voidMutation.isPending || !reason.trim() || !voidDate} onClick={() => voidMutation.mutate()} className={buttonClass.primary}>
              {voidMutation.isPending ? 'Voiding' : 'Void'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label="Void date">
            <input type="date" min={voiding?.date} value={voidDate} onChange={(e) => setVoidDate(e.target.value)} />
          </Field>
          <Field label="Reason" hint="For example, rung up twice">
            <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </Dialog>
      {!list.isLoading && transactions.length > 0 && posted.length === 0 && (
        <p className="text-[13px] text-graphite-600"><Mark kind="tick" label={`Every ${noun.one} listed is void.`} /></p>
      )}
    </div>
  );
}
