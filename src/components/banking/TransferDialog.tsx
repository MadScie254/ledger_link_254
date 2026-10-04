import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest, newIdempotencyKey } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import { centsFromAmountText } from '../../utils/salesOrders';
import { Dialog, Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

/** Money moved between two of the business's own bank, cash or M-Pesa accounts. */
export function TransferDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: (message: string) => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const currency = activeCompany?.baseCurrency || 'KES';
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const [problem, setProblem] = useState('');

  const accounts = useQuery({ queryKey: ['accounts', currentOrgId], queryFn: () => apiRequest('/api/accounts'), enabled: open });
  const moneyAccounts: any[] = (accounts.data?.accounts || []).filter((a: any) => a.isBankAccount && a.isActive !== false);

  useEffect(() => {
    if (!open) return;
    setFromId('');
    setToId('');
    setDate(todayIn(activeCompany?.timeZone));
    setAmount('');
    setMemo('');
    setProblem('');
    setKey(newIdempotencyKey());
  }, [open, activeCompany?.timeZone]);

  const save = useMutation({
    mutationFn: () => apiRequest<{ number: string }>('/api/transfers', {
      body: { date, fromAccountId: fromId, toAccountId: toId, amountCents: centsFromAmountText(amount), memo: memo.trim() || undefined, idempotencyKey: key },
      fallback: 'The transfer could not be posted.',
    }),
    onSuccess: (result) => {
      for (const k of ['cash-transactions', 'accounts', 'journal-entries', 'dashboard-metrics']) queryClient.invalidateQueries({ queryKey: [k, currentOrgId] });
      onDone?.(`Transfer ${result.number} posted.`);
      onClose();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem('');
    const cents = centsFromAmountText(amount);
    if (!fromId || !toId) return setProblem('Choose both accounts.');
    if (fromId === toId) return setProblem('Choose two different accounts.');
    if (cents === null || cents <= 0) return setProblem('Enter the amount, such as 25,000.');
    save.mutate();
  };

  const options = moneyAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>);
  return (
    <Dialog
      open={open}
      onClose={() => { if (!save.isPending) onClose(); }}
      title="Transfer money"
      note="Between the business's own bank, cash and M-Pesa accounts, for example banking the till. One entry posts both sides."
      footer={
        <>
          {problem && <p role="alert" className="mr-auto text-[13px] text-ledger-red">{problem}</p>}
          <button type="button" onClick={onClose} disabled={save.isPending} className={buttonClass.secondary}>Cancel</button>
          <button type="submit" form="transfer-form" disabled={save.isPending} className={buttonClass.primary}>{save.isPending ? 'Posting' : 'Post transfer'}</button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="From" hint={moneyAccounts.length < 2 ? 'Mark at least two accounts as holding money (Accounting, Edit) first.' : undefined}>
          <select name="fromAccountId" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">Choose an account</option>
            {options}
          </select>
        </Field>
        <Field label="To">
          <select name="toAccountId" value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">Choose an account</option>
            {options}
          </select>
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={`Amount (${currency})`}>
          <input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right tabular-currency" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Particulars" hint="Optional">
            <input maxLength={4000} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
