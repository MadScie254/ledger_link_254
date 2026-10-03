import { Fragment, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { Mark } from '../ledger/Mark';
import { EmptyNote, LoadProblem, PageNote, SkeletonRows, buttonClass } from '../ledger/Page';
import { useConfirm } from '../../hooks/useConfirm';
import { OrderBuilder } from './OrderBuilder';
import {
  cancelBlockedByInvoice,
  nextStatuses,
  SALES_ORDER_STATUS_LABELS,
  stockEffects,
  type SalesOrderStatus,
} from '../../utils/salesOrders';

type Filter = 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ALL';
type Target = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

const FILTERS: { id: Filter; name: string }[] = [
  { id: 'ACTIVE', name: 'Open and in progress' },
  { id: 'COMPLETED', name: 'Completed' },
  { id: 'CANCELLED', name: 'Cancelled' },
  { id: 'ALL', name: 'All orders' },
];

const shortDate = (value: string | null | undefined) => (value ? format(parseISO(value), 'dd/MM/yyyy') : '');

async function readJson(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || fallback);
  return body;
}

function describeStock(changes: Array<{ name: string; quantity: number }>, verb: 'reduced' | 'put back') {
  if (!changes?.length) return '';
  const parts = changes.map((change) => `${Math.abs(change.quantity)} × ${change.name}`);
  return ` Stock ${verb === 'reduced' ? 'counted out' : 'put back'}: ${parts.join('; ')}.`;
}

/**
 * Customer orders on the Sales page. An order is recorded, worked on, then
 * completed or cancelled; completing it counts stocked items out. The invoice
 * is raised separately and is what posts to the books.
 */
export function OrdersPanel({
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
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [cancelling, setCancelling] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [invoicing, setInvoicing] = useState<any | null>(null);
  const [issueDate, setIssueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'));

  const ordersQuery = useQuery({
    queryKey: ['sales-orders', orgId],
    queryFn: async () => readJson(await fetch('/api/sales-orders', { headers: { 'x-org-id': orgId } }), 'Failed to fetch orders'),
  });
  const itemsQuery = useQuery({
    queryKey: ['inventory', orgId],
    queryFn: async () => readJson(await fetch('/api/inventory', { headers: { 'x-org-id': orgId } }), 'Failed to fetch stock items'),
  });

  const orders: any[] = ordersQuery.data?.orders || [];
  const items: any[] = (itemsQuery.data?.items || []).filter((item: any) => (item.status || 'Active') === 'Active');
  const incomeAccounts = accounts.filter((account: any) => account.type === 'INCOME' && account.isActive !== false);
  const today = format(new Date(), 'yyyy-MM-dd');

  const shown = orders.filter((order) => {
    if (filter === 'ACTIVE') return order.status === 'OPEN' || order.status === 'IN_PROGRESS';
    if (filter === 'ALL') return true;
    return order.status === filter;
  });
  const shownTotal = shown.reduce((sum, order) => sum + (order.totalCents || 0), 0);
  const activeCount = orders.filter((order) => order.status === 'OPEN' || order.status === 'IN_PROGRESS').length;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sales-orders', orgId] });

  const statusMutation = useMutation({
    mutationFn: async ({ order, status, reason }: { order: any; status: Target; reason?: string }) =>
      readJson(await fetch(`/api/sales-orders/${order.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ status, reason }),
      }), `Order ${order.orderNumber} could not be updated.`),
    onSuccess: (result: any, { order, status }) => {
      const reopened = order.status === 'COMPLETED' && status === 'IN_PROGRESS';
      const sentence = status === 'COMPLETED'
        ? `Order ${order.orderNumber} completed.${describeStock(result?.stockChanges, 'reduced')}`
        : status === 'CANCELLED'
          ? `Order ${order.orderNumber} cancelled.`
          : reopened
            ? `Order ${order.orderNumber} reopened.${describeStock(result?.stockChanges, 'put back')}`
            : `Order ${order.orderNumber} in progress.`;
      setNotice(sentence);
      setProblem('');
      setCancelling(null);
    },
    onError: (err: Error) => {
      setProblem(err.message);
      setNotice('');
    },
    onSettled: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['inventory', orgId] });
    },
  });

  const invoiceMutation = useMutation({
    mutationFn: async (order: any) =>
      readJson(await fetch(`/api/sales-orders/${order.id}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ issueDate, dueDate }),
      }), `Order ${order.orderNumber} could not be invoiced.`),
    onSuccess: (result: any, order: any) => {
      setNotice(`Invoice ${result.invoiceNumber} raised from order ${order.orderNumber}. Journal entry posted.`);
      setProblem('');
      setInvoicing(null);
      for (const key of ['invoices', 'accounts', 'journal-entries', 'dashboard-metrics', 'customers']) {
        queryClient.invalidateQueries({ queryKey: [key, orgId] });
      }
    },
    onError: (err: Error) => setProblem(err.message),
    onSettled: refresh,
  });

  const busy = statusMutation.isPending || invoiceMutation.isPending;

  const stockSummary = (order: any) => stockEffects(order.lines.map((line: any) => ({
    itemId: line.inventoryItemId,
    itemName: line.itemName,
    itemType: line.itemType,
    quantity: line.quantity,
    quantityOnHand: line.quantityOnHand,
  })));

  const completeOrder = (order: any) => {
    const effects = stockSummary(order);
    const below = effects.filter((effect) => effect.after < 0);
    const message = effects.length === 0
      ? `Mark order ${order.orderNumber} completed? It has no stocked items, so no stock count changes.`
      : `Mark order ${order.orderNumber} completed? Stock goes out: ${effects.map((e) => `${e.quantity} × ${e.name} (leaves ${e.after})`).join('; ')}.`
        + (below.length ? ` ${below.map((e) => e.name).join(' and ')} will go below zero.` : '')
        + ' No cost-of-goods entry is posted.';
    confirm({ title: 'Complete order', message, confirmText: 'Mark completed' }, () =>
      statusMutation.mutate({ order, status: 'COMPLETED' }));
  };

  const reopenOrder = (order: any) => {
    const effects = stockSummary(order);
    const message = `Reopen order ${order.orderNumber}? It goes back to in progress`
      + (effects.length ? ` and its stock is put back: ${effects.map((e) => `${e.quantity} × ${e.name}`).join('; ')}.` : '.');
    confirm({ title: 'Reopen order', message, confirmText: 'Reopen' }, () =>
      statusMutation.mutate({ order, status: 'IN_PROGRESS' }));
  };

  const startCancel = (order: any) => {
    if (cancelBlockedByInvoice(order.invoiceStatus)) {
      setProblem(`Order ${order.orderNumber} has invoice ${order.invoiceNumber}. Void the invoice first, then cancel the order.`);
      setNotice('');
      return;
    }
    setCancelReason('');
    setCancelling(order);
  };

  const startInvoice = (order: any) => {
    setIssueDate(format(new Date(), 'yyyy-MM-dd'));
    setDueDate(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
    setProblem('');
    setInvoicing(order);
  };

  const standing = (order: any) => {
    const label = SALES_ORDER_STATUS_LABELS[order.status as SalesOrderStatus] || order.status;
    if (order.status === 'COMPLETED') return <Mark kind="tick" label={label} />;
    return <span className="text-[12.5px] text-ink-900">{label}</span>;
  };

  const promised = (order: any) => {
    if (!order.promisedDate) return <span className="text-graphite-500">–</span>;
    const late = order.promisedDate < today && (order.status === 'OPEN' || order.status === 'IN_PROGRESS');
    return late
      ? <Mark kind="circled" label={`${shortDate(order.promisedDate)}, past`} />
      : <span>{shortDate(order.promisedDate)}</span>;
  };

  const actions = (order: any) => {
    const next = nextStatuses(order.status as SalesOrderStatus);
    // An order whose invoice was voided can be invoiced again.
    const canInvoice = (!order.invoiceId || order.invoiceStatus === 'VOID') && order.status !== 'CANCELLED';
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {order.status === 'OPEN' && next.includes('IN_PROGRESS') && (
          <button type="button" disabled={busy} onClick={() => statusMutation.mutate({ order, status: 'IN_PROGRESS' })} className={buttonClass.quiet}>Start</button>
        )}
        {next.includes('COMPLETED') && (
          <button type="button" disabled={busy} onClick={() => completeOrder(order)} className={buttonClass.quiet}>Mark completed</button>
        )}
        {order.status === 'COMPLETED' && (
          <button type="button" disabled={busy} onClick={() => reopenOrder(order)} className={buttonClass.quiet}>Reopen</button>
        )}
        {canInvoice && (
          <button type="button" disabled={busy} onClick={() => startInvoice(order)} className={buttonClass.quiet}>Invoice</button>
        )}
        {next.includes('CANCELLED') && (
          <button type="button" disabled={busy} onClick={() => startCancel(order)} className={buttonClass.quiet}>Cancel</button>
        )}
      </span>
    );
  };

  const invoiceCell = (order: any) => {
    if (!order.invoiceNumber) return <span className="text-graphite-500">Not invoiced</span>;
    return <span>{order.invoiceNumber}{order.invoiceStatus === 'VOID' ? ', void' : ''}</span>;
  };

  const lineDetail = (order: any) => (
    <div className="py-2 pl-3 border-l-2 border-feint-strong">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Lines of order {order.orderNumber}, figures in {baseCurrency}</caption>
        <thead>
          <tr>
            <th scope="col" className="pr-4 text-left">Item</th>
            <th scope="col" className="pr-4 text-right">Qty</th>
            <th scope="col" className="pr-4 text-right">Unit price</th>
            <th scope="col" className="pr-4 text-right">VAT</th>
            <th scope="col" className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line: any) => (
            <tr key={line.id}>
              <td className="pr-4">
                {line.description}
                {line.inventoryItemId && line.itemType && !/service/i.test(line.itemType) && (
                  <span className="block text-[12px] text-graphite-600">Stock item · {line.quantityOnHand ?? 0} on hand now</span>
                )}
              </td>
              <td className="pr-4 text-right tabular-currency">{line.quantity}</td>
              <td className="pr-4 text-right"><Amount cents={line.unitPriceCents} currency={baseCurrency} size="sm" /></td>
              <td className="pr-4 text-right"><Amount cents={line.taxCents} currency={baseCurrency} size="sm" /></td>
              <td className="text-right"><Amount cents={line.amountCents + line.taxCents} currency={baseCurrency} size="sm" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {order.notes && <p className="mt-2 text-[12.5px] text-graphite-600 whitespace-pre-line">{order.notes}</p>}
      {order.cancelReason && <p className="mt-2 text-[12.5px] text-graphite-600">Cancelled: {order.cancelReason}</p>}
    </div>
  );

  return (
    <div>
      {notice && (
        <p role="status" className="py-2.5 text-[13.5px] text-ink-900 border-b border-feint">{notice}</p>
      )}
      {problem && (
        <p role="alert" className="py-2.5 text-[13.5px] text-ledger-red border-b border-feint">{problem}</p>
      )}

      {ordersQuery.isLoading ? (
        <SkeletonRows label="Loading orders" />
      ) : ordersQuery.isError ? (
        <LoadProblem what="orders" path="/api/sales-orders" onRetry={() => ordersQuery.refetch()} />
      ) : orders.length === 0 ? (
        <EmptyNote action={<button type="button" onClick={() => onCreatingChange(true)} className={buttonClass.quiet}>Record the first order</button>}>
          No orders yet. Each order a customer places is listed here until it is completed or cancelled. Completing an order counts its stock items out; invoicing it posts the sale to the books.
        </EmptyNote>
      ) : (
        <>
          <PageNote>
            <span>{activeCount} open or in progress</span>
            <label className="inline-flex items-center gap-2">
              <span>Show</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="h-8 border px-2 text-[13px] text-ink-900">
                {FILTERS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
          </PageNote>

          {shown.length === 0 ? (
            <p className="py-6 text-[14px] text-graphite-600">No orders in this view. Choose another under Show.</p>
          ) : (
            <>
              {/* On a phone each order is a ruled entry: who and how much, then its number, dates, standing and actions. */}
              <ul className="sm:hidden" aria-label={`Orders, figures in ${baseCurrency}`}>
                {shown.map((order) => (
                  <li key={order.id} className="border-b border-feint py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <button
                        type="button"
                        aria-expanded={expandedId === order.id}
                        onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                        className="min-w-0 truncate text-left text-[14.5px] text-ink-900 hover:underline underline-offset-[3px]"
                      >
                        {order.customerName || 'Customer not found'}
                      </button>
                      <Amount cents={order.totalCents} currency={baseCurrency} className="shrink-0" />
                    </div>
                    <div className="mt-1 text-[12.5px] text-graphite-600">
                      <span>{order.orderNumber} · ordered {shortDate(order.orderDate)}</span>
                      {order.promisedDate && <span className="mt-0.5 flex items-center gap-x-1.5">Promised {promised(order)}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                      {standing(order)}
                      <span className="text-[12px] text-graphite-600">{invoiceCell(order)}</span>
                    </div>
                    <div className="mt-1.5">{actions(order)}</div>
                    {expandedId === order.id && <div className="mt-2">{lineDetail(order)}</div>}
                  </li>
                ))}
                <li className="ll-total mt-px flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
                  <span className="font-semibold text-ink-900">Total of {shown.length} {shown.length === 1 ? 'order' : 'orders'}</span>
                  <Amount cents={shownTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
                </li>
              </ul>

              <div className="hidden sm:block relative overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <caption className="sr-only">Orders, figures in {baseCurrency}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="pr-4 text-left">Order</th>
                      <th scope="col" className="pr-4 text-left">Customer</th>
                      <th scope="col" className="pr-4 text-left">Ordered</th>
                      <th scope="col" className="pr-4 text-left">Promised</th>
                      <th scope="col" className="pr-4 text-left">Standing</th>
                      <th scope="col" className="pr-4 text-left">Invoice</th>
                      <th scope="col" className="text-right">{baseCurrency}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((order) => (
                      <Fragment key={order.id}>
                        <tr>
                          <td className="pr-4 whitespace-nowrap">
                            <button
                              type="button"
                              aria-expanded={expandedId === order.id}
                              onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                              className="text-left text-ink-900 hover:underline underline-offset-[3px]"
                            >
                              {order.orderNumber}
                            </button>
                          </td>
                          <td className="pr-4">{order.customerName || 'Customer not found'}</td>
                          <td className="pr-4 whitespace-nowrap text-graphite-600">{shortDate(order.orderDate)}</td>
                          <td className="pr-4 whitespace-nowrap text-graphite-600">{promised(order)}</td>
                          <td className="pr-4">
                            <div className="flex flex-col items-start gap-1">
                              {standing(order)}
                              {actions(order)}
                            </div>
                          </td>
                          <td className="pr-4 whitespace-nowrap text-[12.5px] text-graphite-600">{invoiceCell(order)}</td>
                          <td className="text-right whitespace-nowrap"><Amount cents={order.totalCents} currency={baseCurrency} /></td>
                        </tr>
                        {expandedId === order.id && (
                          <tr>
                            <td colSpan={7}>{lineDetail(order)}</td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                <div className="ll-total mt-px flex items-baseline justify-between gap-4 py-2 text-[13.5px]">
                  <span className="font-semibold text-ink-900">Total of {shown.length} {shown.length === 1 ? 'order' : 'orders'}</span>
                  <Amount cents={shownTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
                </div>
              </div>
            </>
          )}
        </>
      )}

      {isCreating && (
        <OrderBuilder
          orgId={orgId}
          baseCurrency={baseCurrency}
          customers={customers}
          incomeAccounts={incomeAccounts}
          items={items}
          onClose={() => onCreatingChange(false)}
          onRecorded={(order) => {
            onCreatingChange(false);
            setNotice(`Order ${order.orderNumber} recorded.`);
            setProblem('');
            setFilter('ACTIVE');
            refresh();
          }}
        />
      )}

      <Dialog
        open={!!cancelling}
        onClose={() => { if (!statusMutation.isPending) setCancelling(null); }}
        title="Cancel order"
        note={cancelling ? `${cancelling.orderNumber} · ${cancelling.customerName || 'Customer'}` : undefined}
        footer={
          <>
            <button type="button" onClick={() => setCancelling(null)} disabled={statusMutation.isPending} className={buttonClass.secondary}>Keep the order</button>
            <button
              type="button"
              disabled={statusMutation.isPending || !cancelReason.trim()}
              onClick={() => cancelling && statusMutation.mutate({ order: cancelling, status: 'CANCELLED', reason: cancelReason.trim() })}
              className={buttonClass.primary}
            >
              {statusMutation.isPending ? 'Cancelling' : 'Cancel order'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Reason" hint="Kept in the audit log with the order.">
            <textarea rows={2} maxLength={500} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </Field>
          <p className="text-[12.5px] text-graphite-600">A cancelled order cannot be reopened. Stock counts are not changed, because only completing an order counts stock out.</p>
        </div>
      </Dialog>

      <Dialog
        open={!!invoicing}
        onClose={() => { if (!invoiceMutation.isPending) setInvoicing(null); }}
        title="Invoice this order"
        note={invoicing ? `${invoicing.orderNumber} · ${invoicing.customerName || 'Customer'}` : undefined}
        footer={
          <>
            <button type="button" onClick={() => setInvoicing(null)} disabled={invoiceMutation.isPending} className={buttonClass.secondary}>Cancel</button>
            <button
              type="button"
              disabled={invoiceMutation.isPending || !issueDate || !dueDate || dueDate < issueDate}
              onClick={() => invoicing && invoiceMutation.mutate(invoicing)}
              className={buttonClass.primary}
            >
              {invoiceMutation.isPending ? 'Posting' : 'Raise invoice'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="ll-total flex items-baseline justify-between py-2 text-[13.5px]">
            <span className="font-semibold text-ink-900">Order total</span>
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
          {problem && invoicing && <p role="alert" className="text-[13px] text-ledger-red">{problem}</p>}
          <p className="text-[12.5px] text-graphite-600">
            This raises one invoice with the order's lines and posts it to the books: accounts receivable and sales, plus output VAT where charged. The order keeps its standing. An order is invoiced once; a repeated click does not raise a second invoice.
          </p>
        </div>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
