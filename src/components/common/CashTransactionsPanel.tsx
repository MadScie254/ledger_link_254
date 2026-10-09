import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import { Amount } from '../ledger/Amount';
import { DataTable, type DataColumn } from '../ledger/DataTable';
import { MoneyBar } from '../ledger/MoneyBar';
import { Dialog, Field } from '../ledger/Dialog';
import { Mark } from '../ledger/Mark';
import { EmptyNote, LoadProblem, SkeletonRows, buttonClass } from '../ledger/Page';
import { AttachmentsButton } from './AttachmentsPanel';
import { PrintButton } from './PrintButton';
import { BulkActionBar } from './BulkActionBar';
import { downloadCsv } from '../../utils/exportCsv';

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
  const [expenseFilter, setExpenseFilter] = useState('ALL');
  const [selectedExpense, setSelectedExpense] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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
  const voidRecords = transactions.filter((t) => t.status === 'VOID');
  const shownExpenses = expenseFilter === 'POSTED' ? posted : expenseFilter === 'VOID' ? voidRecords : transactions;

  const describe = (t: any) => {
    if (kind === 'TRANSFER') return `${t.moneyAccountName || 'Account'} to ${t.toAccountName || 'account'}`;
    const party = t.partyName || (kind === 'SALES_RECEIPT' ? 'Walk-in' : 'No payee');
    const first = t.lines[0]?.description;
    return `${party}${first ? ` · ${first}${t.lines.length > 1 ? ' and more' : ''}` : ''}`;
  };
  const expenseColumns: DataColumn<any>[] = [
    { id: 'date', label: 'Date', value: (t) => t.date || '', render: (t) => shortDate(t.date) },
    { id: 'number', label: 'Expense', value: (t) => t.number || '', render: (t) => <span className="font-medium text-text">{t.number}</span> },
    { id: 'description', label: 'Payee and purpose', value: describe, render: describe },
    { id: 'status', label: 'Standing', value: (t) => t.status || '', render: (t) => <Mark kind={t.status === 'VOID' ? 'query' : 'tick'} label={t.status === 'VOID' ? 'Void' : 'Posted'} /> },
    { id: 'amount', label: currency, value: (t) => Number(t.totalCents || 0), render: (t) => <Amount cents={t.totalCents} currency={currency} tone="ink" />, numeric: true },
  ];
  const openVoid = (record: any) => {
    voidMutation.reset();
    setVoidDate(todayIn(activeCompany?.timeZone));
    setReason('');
    setNotice('');
    setSelectedExpense(null);
    setVoiding(record);
  };
  const exportSelected = () => {
    const selected = transactions.filter((record) => selectedIds.includes(record.id));
    downloadCsv('expenses.csv', [['Date', 'Expense', 'Payee and purpose', 'Status', 'Amount'], ...selected.map((record) => [record.date, record.number, describe(record), record.status, (record.totalCents / 100).toFixed(2)])]);
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
      ) : kind === 'EXPENSE' ? (
        <>
          <MoneyBar label="Expense money" active={expenseFilter} onChange={setExpenseFilter} currency={currency} segments={[
            { id: 'POSTED', label: 'Posted', count: posted.length, cents: postedTotal, color: 'var(--primary)' },
            { id: 'VOID', label: 'Void', count: voidRecords.length, cents: voidRecords.reduce((sum, record) => sum + Number(record.totalCents || 0), 0), color: 'var(--chart-expense)' },
          ]} />
          <DataTable
            records={shownExpenses}
            columns={expenseColumns}
            caption={`Expenses, figures in ${currency}`}
            onOpen={setSelectedExpense}
            openLabel={(record) => `Open expense ${record.number}`}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            selectAllLabel="Select all expenses"
            selectRowLabel={(record) => `Select expense ${record.number}`}
            rowActions={(record) => <>
              <AttachmentsButton recordType="CASH_TRANSACTION" recordId={record.id} title={record.number} />
              {record.status !== 'VOID' && canPost && <button type="button" onClick={() => openVoid(record)} className={buttonClass.quiet}>Void</button>}
            </>}
            mobile={{
              primary: (record) => `${record.number} · ${describe(record)}`,
              secondary: (record) => `${shortDate(record.date)} · ${record.moneyAccountName || 'Account not recorded'}`,
              amount: (record) => <Amount cents={record.totalCents} currency={currency} tone="ink" />,
              status: (record) => <Mark kind={record.status === 'VOID' ? 'query' : 'tick'} label={record.status === 'VOID' ? 'Void' : 'Posted'} />,
            }}
          />
          <div className="flex items-baseline justify-between gap-4 px-4 py-3 text-[13px]"><span className="font-semibold text-text">Posted total of {shownExpenses.length} expenses shown</span><Amount cents={shownExpenses.filter((record) => record.status !== 'VOID').reduce((sum, record) => sum + Number(record.totalCents || 0), 0)} currency={currency} tone="ink" /></div>
          <BulkActionBar selectedCount={selectedIds.length} totalCount={transactions.length} entityName="expenses" onClearSelection={() => setSelectedIds([])} onExport={exportSelected} />
        </>
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
                {kind === 'SALES_RECEIPT' && <PrintButton kind="sales-receipt" id={t.id} number={t.number} />}
                <AttachmentsButton recordType="CASH_TRANSACTION" recordId={t.id} title={t.number} />
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
      <Dialog
        open={kind === 'EXPENSE' && !!selectedExpense}
        onClose={() => setSelectedExpense(null)}
        placement="right"
        title={selectedExpense?.number || 'Expense'}
        note={selectedExpense ? describe(selectedExpense) : undefined}
        footer={<>
          {selectedExpense && <AttachmentsButton recordType="CASH_TRANSACTION" recordId={selectedExpense.id} title={selectedExpense.number} />}
          {selectedExpense?.status !== 'VOID' && selectedExpense && canPost && <button type="button" onClick={() => openVoid(selectedExpense)} className={buttonClass.secondary}>Void</button>}
          <button type="button" onClick={() => setSelectedExpense(null)} className={buttonClass.secondary}>Close</button>
        </>}
      >
        {selectedExpense && <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-surface-2 p-4"><dt className="text-xs text-text-2">Amount paid</dt><dd className="mt-1 font-display text-lg font-bold"><Amount cents={selectedExpense.totalCents} currency={currency} tone="ink" /></dd></div><div className="rounded-xl bg-surface-2 p-4"><dt className="text-xs text-text-2">Standing</dt><dd className="mt-1 text-sm font-semibold text-text">{selectedExpense.status === 'VOID' ? 'Void' : 'Posted'}</dd></div></dl>
          <section><h3 className="mb-3 text-sm font-semibold text-text">Summary</h3><dl className="space-y-2 text-[13px]"><div className="flex justify-between gap-4"><dt className="text-text-2">Payee</dt><dd>{selectedExpense.partyName || 'Not recorded'}</dd></div><div className="flex justify-between gap-4"><dt className="text-text-2">Paid from</dt><dd>{selectedExpense.moneyAccountName || 'Not recorded'}</dd></div><div className="flex justify-between gap-4"><dt className="text-text-2">Reference</dt><dd>{selectedExpense.reference || 'Not recorded'}</dd></div></dl>{selectedExpense.lines?.length > 0 && <ul className="mt-4 divide-y divide-border rounded-lg border border-border px-3">{selectedExpense.lines.map((line: any, index: number) => <li key={line.id || index} className="flex justify-between gap-4 py-2 text-[13px]"><span>{line.description}</span><Amount cents={line.amountCents || 0} currency={currency} size="xs" tone="ink" /></li>)}</ul>}</section>
          <section aria-label="Activity timeline"><h3 className="mb-3 text-sm font-semibold text-text">Activity</h3><ol className="border-l border-border-strong pl-4 text-[13px]"><li className="relative pb-4 before:absolute before:-left-[21px] before:top-1.5 before:size-2.5 before:rounded-full before:bg-primary"><span className="font-medium text-text">Expense dated</span><span className="block text-xs text-text-2">{shortDate(selectedExpense.date)}</span></li>{selectedExpense.createdAt && <li className="relative pb-4 before:absolute before:-left-[21px] before:top-1.5 before:size-2.5 before:rounded-full before:bg-primary"><span className="font-medium text-text">Recorded</span><span className="block text-xs text-text-2">{shortDate(selectedExpense.createdAt)}</span></li>}{selectedExpense.voidedAt && <li className="relative before:absolute before:-left-[21px] before:top-1.5 before:size-2.5 before:rounded-full before:bg-negative"><span className="font-medium text-text">Voided</span><span className="block text-xs text-text-2">{shortDate(selectedExpense.voidedAt)}{selectedExpense.voidReason ? ` · ${selectedExpense.voidReason}` : ''}</span></li>}</ol></section>
        </div>}
      </Dialog>
      {!list.isLoading && transactions.length > 0 && posted.length === 0 && (
        <p className="text-[13px] text-graphite-600"><Mark kind="tick" label={`Every ${noun.one} listed is void.`} /></p>
      )}
    </div>
  );
}
