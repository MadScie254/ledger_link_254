import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest, newIdempotencyKey } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import { Amount } from '../ledger/Amount';
import { Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

type Run = { id: string; period: string; payDate: string; totalNetCents: number; netPayAccountId: string | null; reversedAt: string | null };
type Payment = { id: string; paymentDate: string; amountCents: number; bankAccountId: string; journalEntryId: string; reversedAt: string | null; reversalReason: string | null };

export function SalaryPayment({ run }: { run: Run }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const client = useQueryClient();
  const [bankAccountId, setBankAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayIn(activeCompany?.timeZone));
  const [paymentKey, setPaymentKey] = useState(newIdempotencyKey);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reversalDate, setReversalDate] = useState(todayIn(activeCompany?.timeZone));
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const { data: paymentsData } = useQuery({
    queryKey: ['salary_payments', currentOrgId, run.id],
    queryFn: () => apiRequest<{ payments: Payment[] }>(`/api/payroll/runs/${run.id}/salary-payments`),
    enabled: Boolean(run.netPayAccountId),
  });
  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: () => apiRequest<{ accounts: { id: string; name: string; code: string; currency: string; isBankAccount: boolean; isActive: boolean }[] }>('/api/accounts'),
    enabled: Boolean(run.netPayAccountId),
  });
  const accounts = (accountsData?.accounts || []).filter((account) => account.isBankAccount && account.isActive && account.currency === (activeCompany?.baseCurrency || 'KES'));
  const activePayment = paymentsData?.payments.find((payment) => !payment.reversedAt);
  const pay = useMutation({
    mutationFn: () => apiRequest<{ id: string; journalEntryId: string }>(`/api/payroll/runs/${run.id}/salary-payments`, {
      body: { bankAccountId, paymentDate, idempotencyKey: paymentKey }, fallback: 'Salary payment could not be posted.',
    }),
    onSuccess: (result) => {
      setNotice(`Salaries for ${run.period} paid. Journal entry ${result.journalEntryId}.`);
      setPaymentKey(newIdempotencyKey());
      client.invalidateQueries({ queryKey: ['salary_payments', currentOrgId, run.id] });
      client.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
      client.invalidateQueries({ queryKey: ['journal-entries', currentOrgId] });
    },
  });
  const reverse = useMutation({
    mutationFn: () => apiRequest(`/api/payroll/runs/${run.id}/salary-payments/${reverseId}/reverse`, {
      body: { reversalDate, reason: reason.trim() }, fallback: 'Salary payment could not be reversed.',
    }),
    onSuccess: () => {
      setNotice(`Salary payment for ${run.period} reversed.`);
      setReverseId(null);
      setReason('');
      client.invalidateQueries({ queryKey: ['salary_payments', currentOrgId, run.id] });
      client.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
      client.invalidateQueries({ queryKey: ['journal-entries', currentOrgId] });
    },
  });

  if (!run.netPayAccountId) return <p className="text-sm text-text-2">This earlier run posted net pay directly to cash. It has no separate salary payment.</p>;
  return <section className="space-y-3 rounded-xl border border-border bg-surface p-4" aria-label="Salary payment">
    <h3 className="text-sm font-semibold text-text">Salary payment</h3>
    <p className="text-sm text-text-2">Net salaries for {run.period}: <Amount cents={run.totalNetCents} currency={activeCompany?.baseCurrency || 'KES'} />. Record the payment on the day the money leaves the account.</p>
    {paymentsData?.payments.map((payment) => <p key={payment.id} className="text-sm text-text-2">
      {payment.paymentDate}: <Amount cents={payment.amountCents} currency={activeCompany?.baseCurrency || 'KES'} /> from {accountsData?.accounts.find((account) => account.id === payment.bankAccountId)?.name || 'bank account'}.
      {payment.reversedAt ? ` Reversed${payment.reversalReason ? `: ${payment.reversalReason}` : ''}.` : ' Posted.'}
      {!payment.reversedAt && activeCompany?.role !== 'member' && <button type="button" className={buttonClass.quiet} onClick={() => { setReverseId(payment.id); setReversalDate(todayIn(activeCompany?.timeZone)); setReason(''); }}>Reverse payment</button>}
    </p>)}
    {!activePayment && !run.reversedAt && activeCompany?.role !== 'member' && <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); pay.mutate(); }}>
      <Field label="Pay from"><select required value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}><option value="">Choose an account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.code} · {account.name}</option>)}</select></Field>
      <Field label="Payment date"><input type="date" required min={run.payDate} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></Field>
      <button type="submit" className={buttonClass.primary} disabled={pay.isPending || !bankAccountId}>{pay.isPending ? 'Posting' : 'Pay salaries'}</button>
    </form>}
    {run.reversedAt && activePayment && <p className="text-sm text-text-2">The pay run was reversed. Reverse this payment separately if the bank payment was also in error.</p>}
    {reverseId && <form className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); reverse.mutate(); }}>
      <Field label="Reversal date"><input type="date" required min={paymentsData?.payments.find((payment) => payment.id === reverseId)?.paymentDate} value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} /></Field>
      <Field label="Reason"><input type="text" required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      <div className="flex gap-2"><button type="button" className={buttonClass.secondary} onClick={() => setReverseId(null)}>Keep payment</button><button type="submit" className={buttonClass.secondary} disabled={reverse.isPending || !reason.trim()}>Reverse payment</button></div>
    </form>}
    {(pay.isError || reverse.isError) && <p role="alert" className="text-sm text-negative">{(pay.error || reverse.error)?.message}</p>}
    {notice && <p role="status" className="text-sm text-text">{notice}</p>}
  </section>;
}
