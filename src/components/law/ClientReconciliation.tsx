import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { LedgerRow, buttonClass } from '../ledger/Page';

interface Reconciliation {
  asOf: string;
  hasClientBankAccount: boolean;
  bankReconciliationId: string | null;
  statementBalanceCents: number | null;
  unclearedReceiptsCents: number;
  unpresentedPaymentsCents: number;
  adjustedStatementCents: number | null;
  cashBookCents: number;
  clientHeldCents: number;
  matterLedgersCents: number;
  untaggedHeldCents: number;
  agrees: boolean;
  signed: null | { agrees: boolean; note: string | null; signedAt: string };
}

/**
 * The client account reconciliation on a date: the bank's statement, the
 * client cash book and the matter ledgers side by side, signed once by an
 * owner or admin. The statement comes from a completed reconciliation of
 * the client bank account (1060) to that date, in Banking.
 */
export function ClientReconciliation({ orgId, asOf, dateLabel, currency, canSign }: {
  orgId: string;
  asOf: string;
  dateLabel: string;
  currency: string;
  canSign: boolean;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const reconciliation = useQuery({
    queryKey: ['client-balances', orgId, 'reconciliation', asOf],
    queryFn: () => apiRequest<Reconciliation>(`/api/client-account/reconciliation?asOf=${asOf}`, { fallback: 'The reconciliation could not be read.' }),
  });
  const sign = useMutation({
    mutationFn: () => apiRequest<Reconciliation>('/api/client-account/reconciliation', {
      body: { asOf, note: note.trim() || null }, fallback: 'The reconciliation could not be signed.',
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(['client-balances', orgId, 'reconciliation', asOf], data);
      setNote('');
    },
  });

  const r = reconciliation.data;
  if (!r) return null;
  return (
    <section aria-label="Client account reconciliation to the bank statement" className="max-w-xl">
      <h2 className="mt-2 text-[14.5px] font-semibold text-ink-900">Reconciliation to the bank statement</h2>
      {!r.hasClientBankAccount ? (
        <p className="py-2 text-[13.5px] text-graphite-600">There is no client bank account (1060) in the chart.</p>
      ) : !r.bankReconciliationId ? (
        <p className="py-2 text-[13.5px] text-graphite-600">
          Reconcile the client bank account (1060) to its statement for {dateLabel} in Banking. The statement, the client cash book
          and the matter ledgers then appear here, ready to sign.
        </p>
      ) : (
        <>
          <LedgerRow label={`Bank statement, ${dateLabel}`}><Amount cents={r.statementBalanceCents ?? 0} currency={currency} tone="ink" /></LedgerRow>
          <LedgerRow label="Add receipts not yet on the statement"><Amount cents={r.unclearedReceiptsCents} currency={currency} /></LedgerRow>
          <LedgerRow label="Less payments not yet presented"><Amount cents={-r.unpresentedPaymentsCents} currency={currency} /></LedgerRow>
          <LedgerRow label="Statement, adjusted" strong><Amount cents={r.adjustedStatementCents ?? 0} currency={currency} tone="ink" /></LedgerRow>
          <LedgerRow label="Client cash book (1060)"><Amount cents={r.cashBookCents} currency={currency} tone="ink" /></LedgerRow>
          <LedgerRow label="Client money held (2200)"><Amount cents={r.clientHeldCents} currency={currency} tone="ink" /></LedgerRow>
          <LedgerRow label="The matter ledgers" strong><Amount cents={r.matterLedgersCents} currency={currency} tone="ink" /></LedgerRow>
          <div className="space-y-2 py-2 text-[13px]">
            {r.agrees
              ? <Mark kind="tick" label="The bank statement, the client cash book and the matter ledgers agree." />
              : <Mark kind="circled" label="They do not agree. Find the difference before signing, or explain it." />}
            {r.signed ? (
              <p className="text-ink-900">
                Signed on {new Date(r.signed.signedAt).toLocaleString('en-KE', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.
                {r.signed.note ? <span className="block text-graphite-600">Explanation: {r.signed.note}</span> : null}
              </p>
            ) : canSign ? (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); sign.mutate(); }}>
                <label className="block">
                  <span className="block text-[13px] font-semibold text-ink-900">{r.agrees ? 'Note (optional)' : 'Explain the difference'}</span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2}
                    required={!r.agrees} className="mt-1 w-full border px-2 py-1.5 text-[13.5px]" />
                </label>
                {sign.isError && <p role="alert" className="text-ledger-red">{(sign.error as Error).message}</p>}
                <button type="submit" disabled={sign.isPending || (!r.agrees && !note.trim())} className={buttonClass.primary}>
                  {sign.isPending ? 'Signing' : `Sign the reconciliation for ${dateLabel}`}
                </button>
              </form>
            ) : (
              <p className="text-graphite-600">Not signed yet. An owner or admin signs it.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
