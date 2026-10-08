import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest, newIdempotencyKey } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import { centsFromAmountText } from '../../utils/salesOrders';
import { Amount, figureText } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { EmptyNote, LoadProblem, SkeletonRows, buttonClass } from '../ledger/Page';
import { AttachmentsButton } from './AttachmentsPanel';
import { PrintButton } from './PrintButton';

export type CreditKind = 'CUSTOMER' | 'SUPPLIER';

const WORDS: Record<CreditKind, {
  one: string; many: string; empty: string; party: string; document: string; documents: string;
  documentPath: (partyId: string) => string; listKey: string; numberOf: (doc: any) => string; refundAccount: string;
}> = {
  CUSTOMER: {
    one: 'credit note',
    many: 'credit notes',
    empty: 'No credit notes yet. When a customer returns goods or is owed money back, a credit note lowers what they owe or is refunded to them.',
    party: 'customer',
    document: 'invoice',
    documents: 'invoices',
    documentPath: (partyId) => `/api/invoices?customerId=${partyId}`,
    listKey: 'invoices',
    numberOf: (doc) => doc.invoiceNumber,
    refundAccount: 'Paid from',
  },
  SUPPLIER: {
    one: 'supplier credit',
    many: 'supplier credits',
    empty: 'No supplier credits yet. When goods go back to a supplier or a bill was overcharged, the credit lowers what you owe them or is refunded to you.',
    party: 'supplier',
    document: 'bill',
    documents: 'bills',
    documentPath: (partyId) => `/api/bills?vendorId=${partyId}`,
    listKey: 'bills',
    numberOf: (doc) => doc.billNumber,
    refundAccount: 'Received into',
  },
};

const shortDate = (value: string | null | undefined) => (value ? format(parseISO(value), 'dd/MM/yyyy') : '');

type Action =
  | { type: 'apply'; credit: any }
  | { type: 'refund'; credit: any }
  | { type: 'undo'; credit: any; use: any }
  | { type: 'void'; credit: any };

/**
 * Credit notes to customers, or credits from suppliers, newest first. Each
 * shows what is left to use and every use of it: applied to an invoice or
 * bill, or refunded. A use can be undone with a reason; a credit nothing has
 * used can be voided.
 */
export function CreditsPanel({ kind, onCreate }: { kind: CreditKind; onCreate?: () => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const currency = activeCompany?.baseCurrency || 'KES';
  const canPost = activeCompany?.role !== 'member';
  const words = WORDS[kind];
  const today = todayIn(activeCompany?.timeZone);

  const [action, setAction] = useState<Action | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [moneyAccountId, setMoneyAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');

  const list = useQuery({
    queryKey: ['credits', currentOrgId, kind],
    queryFn: () => apiRequest<{ credits: any[] }>(`/api/credits?kind=${kind}`, { fallback: `Failed to fetch ${words.many}` }),
  });
  const partyId = action?.credit ? (kind === 'CUSTOMER' ? action.credit.customerId : action.credit.vendorId) : '';
  const documents = useQuery({
    queryKey: [words.listKey, currentOrgId, kind === 'CUSTOMER' ? 'customer' : 'vendor', partyId],
    queryFn: () => apiRequest<any>(words.documentPath(partyId)),
    enabled: action?.type === 'apply' && Boolean(partyId),
  });
  const accounts = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: () => apiRequest<any>('/api/accounts'),
    enabled: action?.type === 'refund',
  });
  const openDocuments: any[] = ((documents.data?.[words.listKey] || []) as any[]).filter((doc) =>
    !['PAID', 'VOID'].includes(doc.status) && doc.amountDueCents > 0 && doc.currency === currency);
  const moneyAccounts: any[] = ((accounts.data?.accounts || []) as any[]).filter((a) => a.isBankAccount && a.isActive !== false);

  const open = (next: Action) => {
    setAction(next);
    setProblem('');
    setNotice('');
    setIdempotencyKey(newIdempotencyKey());
    setDocumentId('');
    setReference('');
    setReason('');
    setMoneyAccountId('');
    setDate(today < next.credit.date ? next.credit.date : today);
    setAmount(next.type === 'refund' || next.type === 'apply' ? (next.credit.remainingCents / 100).toFixed(2) : '');
  };

  const chooseDocument = (id: string) => {
    setDocumentId(id);
    const doc = openDocuments.find((d) => d.id === id);
    if (doc && action) setAmount((Math.min(doc.amountDueCents, action.credit.remainingCents) / 100).toFixed(2));
  };

  const refresh = () => {
    for (const key of ['credits', 'invoices', 'bills', 'customers', 'vendors', 'accounts', 'journal-entries', 'dashboard-metrics', 'inventory', 'reports']) {
      queryClient.invalidateQueries({ queryKey: [key, currentOrgId] });
    }
  };

  const run = useMutation({
    mutationFn: async () => {
      if (!action) return null;
      const amountCents = centsFromAmountText(amount);
      if (action.type === 'apply') {
        if (!documentId) throw new Error(`Choose the ${words.document} to apply it to.`);
        if (!amountCents || amountCents <= 0) throw new Error('Enter the amount to apply, such as 1,250.00.');
        const result = await apiRequest<any>(`/api/credits/${action.credit.id}/apply`, {
          body: { documentId, amountCents, date, idempotencyKey },
          fallback: 'The credit could not be applied.',
        });
        return `${figureText(amountCents)} of ${action.credit.number} applied to ${result.documentNumber}. ${figureText(result.amountDueCents ?? 0)} is still due on it.`;
      }
      if (action.type === 'refund') {
        if (!amountCents || amountCents <= 0) throw new Error('Enter the amount refunded, such as 1,250.00.');
        if (!moneyAccountId) throw new Error(`Choose the account the refund was ${kind === 'CUSTOMER' ? 'paid from' : 'received into'}.`);
        const result = await apiRequest<any>(`/api/credits/${action.credit.id}/refund`, {
          body: { amountCents, date, moneyAccountId, reference: reference.trim() || undefined, idempotencyKey },
          fallback: 'The refund could not be posted.',
        });
        return `Refund ${result.number} of ${figureText(amountCents)} posted on ${shortDate(date)}.`;
      }
      if (action.type === 'undo') {
        await apiRequest(`/api/credit-uses/${action.use.id}/reverse`, {
          body: { reason: reason.trim(), reversalDate: action.use.kind === 'REFUND' ? date : undefined },
          fallback: 'That could not be undone.',
        });
        return action.use.kind === 'REFUND'
          ? `Refund ${action.use.number} reversed on ${shortDate(date)}. ${figureText(action.use.amountCents)} is back on ${action.credit.number}.`
          : `${figureText(action.use.amountCents)} taken off ${action.use.documentNumber} and back on ${action.credit.number}.`;
      }
      await apiRequest(`/api/credits/${action.credit.id}/void`, {
        body: { voidDate: date, reason: reason.trim() },
        fallback: `The ${words.one} could not be voided.`,
      });
      return `${action.credit.number} voided on ${shortDate(date)}. A reversing entry is posted and the original stays on record.`;
    },
    onSuccess: (message) => {
      setAction(null);
      if (message) setNotice(message);
      refresh();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const credits = list.data?.credits || [];
  const openTotal = credits.filter((c) => c.status === 'OPEN').reduce((sum, c) => sum + c.remainingCents, 0);

  const title = !action ? '' : action.type === 'apply'
    ? `Apply ${action.credit.number} to ${words.document === 'invoice' ? 'an invoice' : 'a bill'}`
    : action.type === 'refund'
      ? `Refund ${action.credit.number}`
      : action.type === 'undo'
        ? action.use.kind === 'REFUND' ? `Reverse refund ${action.use.number}` : `Take ${action.credit.number} off ${action.use.documentNumber}`
        : `Void ${action.credit.number}`;
  const note = !action ? '' : action.type === 'apply'
    ? `Lowers what is due on the ${words.document}. No money moves and nothing new posts; the ${words.one} already did.`
    : action.type === 'refund'
      ? kind === 'CUSTOMER'
        ? 'Money paid back to the customer. Posts receivables against the account it was paid from.'
        : 'Money the supplier paid back. Posts the account it went into against payables.'
      : action.type === 'undo'
        ? action.use.kind === 'REFUND'
          ? 'A reversing entry is posted on the date below and the amount goes back on the credit.'
          : `The amount goes back on the ${words.document} as due, and back on the credit to use again.`
        : `A reversing entry is posted on the date below${kind === 'CUSTOMER' ? ', stock it took back is counted out again,' : ', stock it sent back is counted in again,'} and the original stays on record.`;
  const submitLabel = !action ? '' : action.type === 'apply' ? 'Apply credit' : action.type === 'refund' ? 'Post refund' : action.type === 'undo' ? 'Undo' : 'Void';
  const needsReason = action?.type === 'undo' || action?.type === 'void';
  const needsDate = action && (action.type !== 'undo' || action.use.kind === 'REFUND');

  return (
    <div className="space-y-3">
      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}
      {list.isError ? (
        <LoadProblem what={words.many} path="/api/credits" onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <SkeletonRows label={`Loading ${words.many}`} />
      ) : credits.length === 0 ? (
        <EmptyNote action={onCreate && canPost ? <button type="button" onClick={onCreate} className={buttonClass.quiet}>Record the first {words.one}</button> : undefined}>
          {words.empty}
        </EmptyNote>
      ) : (
        <ul className="border-t border-feint-strong" aria-label={`${words.many}, figures in ${currency}`}>
          {credits.map((credit) => {
            const activeUses = credit.uses.filter((use: any) => !use.reversedAt);
            return (
              <li key={credit.id} className="border-b border-feint py-2.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <p className={`text-[14px] ${credit.status === 'VOID' ? 'text-graphite-600 line-through' : 'text-ink-900'}`}>
                      <span className="ll-figure mr-2 text-graphite-600">{credit.number}</span>
                      {credit.partyName || `No ${words.party}`}
                      {credit.lines[0]?.description ? ` · ${credit.lines[0].description}${credit.lines.length > 1 ? ' and more' : ''}` : ''}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-graphite-600">
                      {shortDate(credit.date)}
                      {credit.invoiceNumber ? ` · against ${credit.invoiceNumber}` : ''}
                      {credit.billNumber ? ` · against ${credit.billNumber}` : ''}
                      {credit.reference ? ` · Ref. ${credit.reference}` : ''}
                      {credit.status === 'VOID' ? ` · Void${credit.voidReason ? `: ${credit.voidReason}` : ''}` : credit.status === 'CLOSED' ? ' · Used in full' : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <Amount cents={credit.totalCents} currency={currency} tone="ink" />
                    {credit.status === 'OPEN' && (
                      <span className="text-[12.5px] text-graphite-600"><span className="tabular-currency">{figureText(credit.remainingCents)}</span> left to use</span>
                    )}
                  </div>
                </div>
                {credit.uses.length > 0 && (
                  <ul className="mt-1.5 space-y-1 pl-4 text-[12.5px]" aria-label={`Uses of ${credit.number}`}>
                    {credit.uses.map((use: any) => (
                      <li key={use.id} className="flex flex-wrap items-baseline gap-x-2">
                        <span className={use.reversedAt ? 'text-graphite-600 line-through' : 'text-ink-900'}>
                          {use.kind === 'APPLY'
                            ? `Applied to ${use.documentNumber || `a ${words.document}`}`
                            : `Refund ${use.number}${use.moneyAccountName ? `, ${kind === 'CUSTOMER' ? 'from' : 'into'} ${use.moneyAccountName}` : ''}`}
                          {' · '}{shortDate(use.date)} · <span className="tabular-currency">{figureText(use.amountCents)}</span>
                        </span>
                        {use.reversedAt ? (
                          <span className="text-graphite-600">Undone{use.reversalReason ? `: ${use.reversalReason}` : ''}</span>
                        ) : canPost && credit.status !== 'VOID' && (
                          <button type="button" className={buttonClass.quiet} onClick={() => open({ type: 'undo', credit, use })}>Undo</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-1.5 flex flex-wrap justify-end gap-x-3">
                  {kind === 'CUSTOMER' && <PrintButton kind="credit-note" id={credit.id} number={credit.number} />}
                  <AttachmentsButton recordType="CREDIT_NOTE" recordId={credit.id} title={credit.number} />
                </div>
                {canPost && credit.status !== 'VOID' && (
                  <div className="mt-1.5 flex flex-wrap justify-end gap-x-3">
                    {credit.status === 'OPEN' && (
                      <>
                        <button type="button" className={buttonClass.quiet} onClick={() => open({ type: 'apply', credit })}>Apply to {words.document === 'invoice' ? 'an invoice' : 'a bill'}</button>
                        <button type="button" className={buttonClass.quiet} onClick={() => open({ type: 'refund', credit })}>Refund</button>
                      </>
                    )}
                    {activeUses.length === 0 && (
                      <button type="button" className={buttonClass.quiet} onClick={() => open({ type: 'void', credit })}>Void</button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          <li className="ll-total flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
            <span className="font-semibold text-ink-900">Left to use</span>
            <Amount cents={openTotal} currency={currency} tone="ink" className="font-semibold" />
          </li>
        </ul>
      )}

      <Dialog
        open={!!action}
        onClose={() => { if (!run.isPending) setAction(null); }}
        title={title}
        note={note}
        footer={
          <>
            {problem && <p role="alert" className="mr-auto text-[13px] text-ledger-red">{problem}</p>}
            <button type="button" onClick={() => setAction(null)} disabled={run.isPending} className={buttonClass.secondary}>
              {action?.type === 'void' || action?.type === 'undo' ? 'Keep it' : 'Cancel'}
            </button>
            <button
              type="button"
              disabled={run.isPending || (needsReason && !reason.trim()) || (needsDate && !date)}
              onClick={() => { setProblem(''); run.mutate(); }}
              className={buttonClass.primary}
            >
              {run.isPending ? 'Saving' : submitLabel}
            </button>
          </>
        }
      >
        {action && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {action.type === 'apply' && (
              <Field
                label={words.document === 'invoice' ? 'Invoice' : 'Bill'}
                hint={documents.isLoading ? 'Loading' : openDocuments.length === 0 ? `${action.credit.partyName || 'This ' + words.party} has no ${words.documents} with anything due in ${currency}.` : undefined}
              >
                <select value={documentId} onChange={(e) => chooseDocument(e.target.value)}>
                  <option value="">Choose {words.document === 'invoice' ? 'an invoice' : 'a bill'}</option>
                  {openDocuments.map((doc) => (
                    <option key={doc.id} value={doc.id}>{words.numberOf(doc)} · {figureText(doc.amountDueCents)} due</option>
                  ))}
                </select>
              </Field>
            )}
            {action.type === 'refund' && (
              <Field label={words.refundAccount} hint={moneyAccounts.length === 0 && !accounts.isLoading ? 'Mark a bank, cash or M-Pesa account as holding money (Accounting, Edit) first.' : undefined}>
                <select value={moneyAccountId} onChange={(e) => setMoneyAccountId(e.target.value)}>
                  <option value="">Choose an account</option>
                  {moneyAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </select>
              </Field>
            )}
            {(action.type === 'apply' || action.type === 'refund') && (
              <Field label={`Amount, ${currency}`} hint={`${figureText(action.credit.remainingCents)} left on ${action.credit.number}`}>
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right tabular-currency" />
              </Field>
            )}
            {needsDate && (
              <Field label={action.type === 'void' ? 'Void date' : action.type === 'undo' ? 'Reversal date' : 'Date'}>
                <input type="date" min={action.type === 'undo' ? action.use.date : action.credit.date} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            )}
            {action.type === 'refund' && (
              <Field label="Reference" hint="Optional, such as the M-Pesa code">
                <input maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            )}
            {needsReason && (
              <Field label="Reason" hint={action.type === 'void' ? 'For example, issued to the wrong customer' : 'For example, applied to the wrong invoice'}>
                <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
