import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { addDaysIso, todayIn } from '../../utils/dates';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { Mark } from '../ledger/Mark';
import { EmptyNote, LoadProblem, SkeletonRows, buttonClass } from '../ledger/Page';
import { useConfirm } from '../../hooks/useConfirm';
import { SalesDocumentBuilder, type SalesDocumentDraft } from './SalesDocumentBuilder';

type Filter = 'OPEN' | 'ACCEPTED' | 'CONVERTED' | 'DECLINED' | 'ALL';
const FILTERS: { id: Filter; name: string }[] = [
  { id: 'OPEN', name: 'Draft and sent' },
  { id: 'ACCEPTED', name: 'Accepted' },
  { id: 'CONVERTED', name: 'Converted' },
  { id: 'DECLINED', name: 'Declined' },
  { id: 'ALL', name: 'All estimates' },
];

const shortDate = (value: string | null | undefined) => (value ? format(parseISO(value), 'dd/MM/yyyy') : '');

/**
 * Quotes on the Sales page. An estimate is drafted, sent, accepted or
 * declined, and converted to an invoice (which posts) or a sales order.
 */
export function EstimatesPanel({
  orgId,
  baseCurrency,
  customers,
  accounts,
  isCreating,
  onCreatingChange,
}: {
  orgId: string;
  baseCurrency: string;
  customers: any[];
  accounts: any[];
  isCreating: boolean;
  onCreatingChange: (open: boolean) => void;
}) {
  const { activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const today = todayIn(activeCompany?.timeZone);
  const canPost = activeCompany?.role !== 'member';
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [editing, setEditing] = useState<SalesDocumentDraft | null>(null);
  const [declining, setDeclining] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [invoicing, setInvoicing] = useState<any | null>(null);
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDaysIso(today, 30));

  const estimatesQuery = useQuery({ queryKey: ['estimates', orgId], queryFn: () => apiRequest('/api/estimates', { fallback: 'Failed to fetch estimates' }) });
  const itemsQuery = useQuery({ queryKey: ['inventory', orgId], queryFn: () => apiRequest('/api/inventory') });

  const estimates: any[] = estimatesQuery.data?.estimates || [];
  const items: any[] = (itemsQuery.data?.items || []).filter((item: any) => (item.status || 'Active') === 'Active');
  const incomeAccounts = accounts.filter((account: any) => account.type === 'INCOME' && account.isActive !== false);
  const isExpired = (e: any) => Boolean(e.expiryDate) && e.expiryDate < today && (e.status === 'DRAFT' || e.status === 'SENT');
  // A converted estimate whose invoice was voided can be converted again.
  const convertible = (e: any) => e.status !== 'DECLINED' && (e.status !== 'CONVERTED' || (e.invoiceId && e.invoiceStatus === 'VOID'));

  const shown = estimates.filter((e) => {
    if (filter === 'OPEN') return e.status === 'DRAFT' || e.status === 'SENT';
    if (filter === 'ALL') return true;
    return e.status === filter;
  });
  const shownTotal = shown.reduce((sum, e) => sum + (e.totalCents || 0), 0);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['estimates', orgId] });
  const done = (message: string) => { setNotice(message); setProblem(''); };
  const failed = (err: Error) => { setProblem(err.message); setNotice(''); };

  const statusMutation = useMutation({
    mutationFn: ({ estimate, status, why }: { estimate: any; status: string; why?: string }) =>
      apiRequest(`/api/estimates/${estimate.id}/status`, { body: { status, reason: why }, fallback: `Estimate ${estimate.estimateNumber} could not be updated.` }),
    onSuccess: (_result, { estimate, status }) => {
      done(`Estimate ${estimate.estimateNumber} marked ${status === 'DRAFT' ? 'draft' : status.toLowerCase()}.`);
      setDeclining(null);
    },
    onError: failed,
    onSettled: refresh,
  });

  const convertMutation = useMutation({
    mutationFn: ({ estimate, target }: { estimate: any; target: 'INVOICE' | 'SALES_ORDER' }) =>
      apiRequest<{ target: string; number: string }>(`/api/estimates/${estimate.id}/convert`, {
        body: target === 'INVOICE' ? { target, date: issueDate, dueDate } : { target, date: today },
        fallback: `Estimate ${estimate.estimateNumber} could not be converted.`,
      }),
    onSuccess: (result, { estimate }) => {
      done(result.target === 'INVOICE'
        ? `Invoice ${result.number} raised from estimate ${estimate.estimateNumber}. Journal entry posted.`
        : `Order ${result.number} recorded from estimate ${estimate.estimateNumber}.`);
      setInvoicing(null);
      for (const key of ['invoices', 'sales-orders', 'accounts', 'journal-entries', 'dashboard-metrics', 'customers']) {
        queryClient.invalidateQueries({ queryKey: [key, orgId] });
      }
    },
    onError: failed,
    onSettled: refresh,
  });

  const busy = statusMutation.isPending || convertMutation.isPending;

  const standing = (e: any) => {
    if (e.status === 'CONVERTED') {
      return e.invoiceNumber
        ? <Mark kind="tick" label={`Invoiced, ${e.invoiceNumber}${e.invoiceStatus === 'VOID' ? ' (void)' : ''}`} />
        : <Mark kind="tick" label={`Ordered, ${e.salesOrderNumber}`} />;
    }
    if (e.status === 'DECLINED') return <Mark kind="circled" label={e.declineReason ? `Declined: ${e.declineReason}` : 'Declined'} />;
    if (isExpired(e)) return <Mark kind="circled" label={`Expired ${shortDate(e.expiryDate)}`} />;
    if (e.status === 'ACCEPTED') return <Mark kind="tick" label="Accepted" />;
    if (e.status === 'SENT') return <Mark kind="query" label={e.expiryDate ? `Sent, valid until ${shortDate(e.expiryDate)}` : 'Sent'} />;
    return <span className="text-[12.5px] text-graphite-600">Draft</span>;
  };

  const actions = (e: any) => {
    if (!canPost) return null;
    const open = e.status !== 'CONVERTED';
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {open && (
          <button type="button" disabled={busy} className={buttonClass.quiet} onClick={() => setEditing({
            id: e.id, customerId: e.customerId, date: e.estimateDate, secondDate: e.expiryDate, notes: e.notes, lines: e.lines,
          })}>Edit</button>
        )}
        {e.status === 'DRAFT' && (
          <button type="button" disabled={busy} className={buttonClass.quiet} onClick={() => statusMutation.mutate({ estimate: e, status: 'SENT' })}>Mark sent</button>
        )}
        {open && e.status !== 'ACCEPTED' && (
          <button type="button" disabled={busy} className={buttonClass.quiet} onClick={() => statusMutation.mutate({ estimate: e, status: 'ACCEPTED' })}>Accepted</button>
        )}
        {open && e.status !== 'DECLINED' && (
          <button type="button" disabled={busy} className={buttonClass.quiet} onClick={() => { setReason(''); setDeclining(e); }}>Declined</button>
        )}
        {convertible(e) && (
          <button type="button" disabled={busy} className={buttonClass.quiet} onClick={() => {
            setIssueDate(today);
            setDueDate(addDaysIso(today, 30));
            setInvoicing(e);
          }}>Invoice</button>
        )}
        {convertible(e) && !e.invoiceId && (
          <button type="button" disabled={busy} className={buttonClass.quiet} onClick={() => confirm(
            { title: 'Make it an order', message: `Record estimate ${e.estimateNumber} as a sales order dated ${shortDate(today)}? The order is invoiced when you choose.`, confirmText: 'Record order' },
            () => convertMutation.mutate({ estimate: e, target: 'SALES_ORDER' }),
          )}>Make an order</button>
        )}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}
      {problem && <p role="alert" className="text-[13.5px] text-ledger-red">{problem}</p>}

      <div className="flex flex-wrap items-center gap-3 border-b border-feint pb-3 text-[13px] text-graphite-600">
        <span>{estimates.filter((e) => e.status === 'DRAFT' || e.status === 'SENT').length} awaiting an answer</span>
        <label className="flex items-center gap-2">
          <span>Show</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="h-8 border px-2 text-[13px] text-ink-900">
            {FILTERS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
      </div>

      {estimatesQuery.isError ? (
        <LoadProblem what="estimates" path="/api/estimates" onRetry={() => estimatesQuery.refetch()} />
      ) : estimatesQuery.isLoading ? (
        <SkeletonRows label="Loading estimates" />
      ) : estimates.length === 0 ? (
        <EmptyNote action={canPost ? <button type="button" onClick={() => onCreatingChange(true)} className={buttonClass.quiet}>Write the first estimate</button> : undefined}>
          No estimates yet. A quote is written here, sent to the customer, and becomes an invoice or an order in one step once accepted.
        </EmptyNote>
      ) : shown.length === 0 ? (
        <p className="py-6 text-[14px] text-graphite-600">No estimates in this view. Choose another under Show.</p>
      ) : (
        <ul className="border-t border-feint-strong" aria-label={`Estimates, figures in ${baseCurrency}`}>
          {shown.map((e) => (
            <li key={e.id} className="grid grid-cols-1 gap-1.5 border-b border-feint py-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:gap-4">
              <div className="min-w-0">
                <p className="text-[14.5px] text-ink-900">
                  <span className="ll-figure mr-2 text-graphite-600">{e.estimateNumber}</span>
                  {e.customerName || 'Customer'}
                </p>
                <p className="mt-0.5 text-[12.5px] text-graphite-600">
                  {shortDate(e.estimateDate)} · {e.lines.length} {e.lines.length === 1 ? 'line' : 'lines'}
                  {e.lines[0] ? ` · ${e.lines[0].description}${e.lines.length > 1 ? ' and more' : ''}` : ''}
                </p>
                <div className="mt-1.5">{standing(e)}</div>
                <div className="mt-1.5">{actions(e)}</div>
              </div>
              <div className="sm:text-right">
                <Amount cents={e.totalCents} currency={baseCurrency} tone="ink" />
              </div>
            </li>
          ))}
          <li className="ll-total flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
            <span className="font-semibold text-ink-900">Total of {shown.length} shown</span>
            <Amount cents={shownTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
          </li>
        </ul>
      )}

      {(isCreating || editing) && (
        <SalesDocumentBuilder
          kind="estimate"
          orgId={orgId}
          baseCurrency={baseCurrency}
          customers={customers}
          incomeAccounts={incomeAccounts}
          items={items}
          initial={editing}
          onClose={() => { onCreatingChange(false); setEditing(null); }}
          onRecorded={(estimate) => {
            done(editing ? `Estimate ${estimate.estimateNumber} saved.` : `Estimate ${estimate.estimateNumber} written. Mark it sent once the customer has it.`);
            onCreatingChange(false);
            setEditing(null);
            refresh();
          }}
        />
      )}

      <Dialog
        open={!!declining}
        onClose={() => setDeclining(null)}
        title="Estimate declined"
        note={declining ? `${declining.estimateNumber} · ${declining.customerName || 'Customer'}` : undefined}
        footer={
          <>
            <button type="button" onClick={() => setDeclining(null)} className={buttonClass.secondary}>Cancel</button>
            <button type="button" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ estimate: declining, status: 'DECLINED', why: reason.trim() || undefined })} className={buttonClass.primary}>
              Mark declined
            </button>
          </>
        }
      >
        <Field label="Why" hint="Optional. Kept with the estimate, for example price or timing.">
          <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={!!invoicing}
        onClose={() => setInvoicing(null)}
        title="Invoice this estimate"
        note={invoicing ? `${invoicing.estimateNumber} · ${invoicing.customerName || 'Customer'}` : undefined}
        footer={
          <>
            <button type="button" onClick={() => setInvoicing(null)} disabled={convertMutation.isPending} className={buttonClass.secondary}>Cancel</button>
            <button
              type="button"
              disabled={convertMutation.isPending || !issueDate || !dueDate || dueDate < issueDate}
              onClick={() => convertMutation.mutate({ estimate: invoicing, target: 'INVOICE' })}
              className={buttonClass.primary}
            >
              {convertMutation.isPending ? 'Posting' : 'Raise invoice'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="ll-total flex items-baseline justify-between py-2 text-[13.5px]">
            <span className="font-semibold text-ink-900">Estimate total</span>
            <Amount cents={invoicing?.totalCents || 0} currency={baseCurrency} tone="ink" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Issue date">
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </Field>
            <Field label="Due date" error={dueDate && issueDate && dueDate < issueDate ? 'The due date cannot be before the issue date.' : undefined}>
              <input type="date" min={issueDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <p className="text-[12.5px] text-graphite-600">The invoice posts receivables, income and VAT exactly as written on the estimate.</p>
        </div>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
