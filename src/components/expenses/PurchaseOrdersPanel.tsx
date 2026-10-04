import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest, newIdempotencyKey } from '../../utils/apiRequest';
import { addDaysIso, todayIn } from '../../utils/dates';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { EmptyNote, LoadProblem, SkeletonRows, buttonClass } from '../ledger/Page';
import { SalesDocumentBuilder, type SalesDocumentDraft } from '../sales/SalesDocumentBuilder';
import { AttachmentsButton } from '../common/AttachmentsPanel';

type Filter = 'OPEN' | 'BILLED' | 'CLOSED' | 'ALL';
const FILTERS: { id: Filter; name: string }[] = [
  { id: 'OPEN', name: 'Open' },
  { id: 'BILLED', name: 'Billed' },
  { id: 'CLOSED', name: 'Closed and cancelled' },
  { id: 'ALL', name: 'All orders' },
];

const shortDate = (value: string | null | undefined) => (value ? format(parseISO(value), 'dd/MM/yyyy') : '');
const quantityText = (value: number) => String(Number(value.toFixed(3)));

const standing = (po: any) => {
  if (po.status === 'OPEN') return po.partlyBilled ? 'Part billed' : 'Open';
  if (po.status === 'BILLED') return 'Billed';
  if (po.status === 'CLOSED') return `Closed${po.closeReason ? `: ${po.closeReason}` : ''}`;
  return `Cancelled${po.closeReason ? `: ${po.closeReason}` : ''}`;
};

/**
 * Orders placed with suppliers. An order posts nothing until it is billed,
 * in full or for what has arrived; the bill posts and counts stock in.
 */
export function PurchaseOrdersPanel({ isCreating, onCreatingChange }: { isCreating: boolean; onCreatingChange: (open: boolean) => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const currency = activeCompany?.baseCurrency || 'KES';
  const canPost = activeCompany?.role !== 'member';
  const today = todayIn(activeCompany?.timeZone);
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [editing, setEditing] = useState<SalesDocumentDraft | null>(null);
  const [billing, setBilling] = useState<any | null>(null);
  const [billDate, setBillDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDaysIso(today, 30));
  const [supplierReference, setSupplierReference] = useState('');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [closing, setClosing] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const list = useQuery({
    queryKey: ['purchase-orders', currentOrgId],
    queryFn: () => apiRequest<{ purchaseOrders: any[] }>('/api/purchase-orders', { fallback: 'Failed to fetch purchase orders' }),
  });
  const builderOpen = isCreating || Boolean(editing);
  const vendors = useQuery({ queryKey: ['vendors', currentOrgId], queryFn: () => apiRequest('/api/vendors') });
  const accounts = useQuery({ queryKey: ['accounts', currentOrgId], queryFn: () => apiRequest('/api/accounts') });
  const inventory = useQuery({ queryKey: ['inventory', currentOrgId], queryFn: () => apiRequest('/api/inventory'), enabled: builderOpen });
  const purchaseAccounts: any[] = (accounts.data?.accounts || []).filter((a: any) =>
    a.isActive !== false && ['EXPENSE', 'COGS', 'ASSET'].includes(a.type) && !a.isBankAccount && !['1100', '1150'].includes(a.code));

  const refresh = () => {
    for (const key of ['purchase-orders', 'bills', 'vendors', 'accounts', 'inventory', 'journal-entries', 'dashboard-metrics']) {
      queryClient.invalidateQueries({ queryKey: [key, currentOrgId] });
    }
  };

  const bill = useMutation({
    mutationFn: () => apiRequest<{ billNumber: string; status: string }>(`/api/purchase-orders/${billing.id}/bill`, {
      body: {
        billDate,
        dueDate,
        supplierReference: supplierReference.trim() || undefined,
        quantities: billing.lines
          .filter((line: any) => line.quantity > line.quantityBilled)
          .map((line: any) => ({ position: line.position, quantity: Number(quantities[line.position] || 0) })),
        idempotencyKey,
      },
      fallback: 'The bill could not be made from this order.',
    }),
    onSuccess: (result) => {
      setNotice(`Bill ${result.billNumber} posted from ${billing.number}. ${result.status === 'BILLED' ? 'Everything on the order is now billed.' : 'The rest stays on the order.'}`);
      setBilling(null);
      refresh();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const setStatus = useMutation({
    mutationFn: ({ po, status }: { po: any; status: 'OPEN' | 'CLOSED' }) => apiRequest<{ number: string; status: string }>(`/api/purchase-orders/${po.id}/status`, {
      body: { status, reason: status === 'CLOSED' ? reason.trim() : undefined },
      fallback: 'The order could not be changed.',
    }),
    onSuccess: (result) => {
      setNotice(result.status === 'OPEN' ? `${result.number} reopened.` : `${result.number} ${result.status === 'CANCELLED' ? 'cancelled' : 'closed with the rest unbilled'}.`);
      setClosing(null);
      refresh();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const openBilling = (po: any) => {
    setProblem('');
    setNotice('');
    setIdempotencyKey(newIdempotencyKey());
    setBillDate(today < po.orderDate ? po.orderDate : today);
    setDueDate(addDaysIso(today < po.orderDate ? po.orderDate : today, 30));
    setSupplierReference('');
    setQuantities(Object.fromEntries(po.lines.map((line: any) => [line.position, quantityText(line.quantity - line.quantityBilled)])));
    setBilling(po);
  };

  const orders = list.data?.purchaseOrders || [];
  const shown = orders.filter((po) => filter === 'ALL'
    || (filter === 'CLOSED' ? ['CLOSED', 'CANCELLED'].includes(po.status) : po.status === filter));
  const shownTotal = shown.reduce((sum, po) => sum + po.totalCents, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" role="group" aria-label="Show orders">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
            className={filter === option.id ? 'font-semibold text-ink-900 underline underline-offset-4' : 'text-graphite-600 hover:text-ink-900'}
          >
            {option.name}
          </button>
        ))}
      </div>
      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}
      {list.isError ? (
        <LoadProblem what="purchase orders" path="/api/purchase-orders" onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <SkeletonRows label="Loading purchase orders" />
      ) : shown.length === 0 ? (
        <EmptyNote action={canPost && orders.length === 0 ? <button type="button" onClick={() => onCreatingChange(true)} className={buttonClass.quiet}>Write the first purchase order</button> : undefined}>
          {orders.length === 0
            ? 'No purchase orders yet. An order to a supplier is kept here until the goods and the bill arrive; billing it posts the bill and counts stock in.'
            : 'No orders to show here.'}
        </EmptyNote>
      ) : (
        <ul className="border-t border-feint-strong" aria-label={`Purchase orders, figures in ${currency}`}>
          {shown.map((po) => (
            <li key={po.id} className="border-b border-feint py-2.5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className={`text-[14px] ${po.status === 'CANCELLED' ? 'text-graphite-600 line-through' : 'text-ink-900'}`}>
                    <span className="ll-figure mr-2 text-graphite-600">{po.number}</span>
                    {po.vendorName || 'Supplier'}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-graphite-600">
                    {shortDate(po.orderDate)}{po.expectedDate ? ` · expected ${shortDate(po.expectedDate)}` : ''} · {standing(po)}
                  </p>
                </div>
                <Amount cents={po.totalCents} currency={currency} tone="ink" />
              </div>
              <ul className="mt-1.5 space-y-0.5 pl-4 text-[12.5px] text-graphite-600" aria-label={`Lines on ${po.number}`}>
                {po.lines.map((line: any) => (
                  <li key={line.id}>
                    {line.description} · {quantityText(line.quantityBilled)} of {quantityText(line.quantity)} billed
                  </li>
                ))}
                {po.bills.map((b: any) => (
                  <li key={b.id} className={b.status === 'VOID' ? 'line-through' : 'text-ink-900'}>
                    Bill {b.billNumber}, {shortDate(b.date)}{b.status === 'VOID' ? ', void' : ''}
                  </li>
                ))}
              </ul>
              <div className="mt-1.5 flex flex-wrap justify-end gap-x-3">
                <AttachmentsButton recordType="PURCHASE_ORDER" recordId={po.id} title={po.number} />
              </div>
              {canPost && (
                <div className="mt-1.5 flex flex-wrap justify-end gap-x-3">
                  {po.status === 'OPEN' && !po.partlyBilled && (
                    <button
                      type="button"
                      className={buttonClass.quiet}
                      onClick={() => setEditing({
                        id: po.id,
                        customerId: po.vendorId,
                        date: po.orderDate,
                        secondDate: po.expectedDate,
                        notes: po.memo,
                        lines: po.lines.map((line: any) => ({
                          inventoryItemId: line.inventoryItemId, description: line.description, quantity: line.quantity,
                          unitPriceCents: line.unitCostCents, taxRate: line.taxRate, accountId: line.accountId,
                        })),
                      })}
                    >
                      Edit
                    </button>
                  )}
                  {po.status === 'OPEN' && (
                    <>
                      <button type="button" className={buttonClass.quiet} onClick={() => openBilling(po)}>Make a bill</button>
                      <button type="button" className={buttonClass.quiet} onClick={() => { setProblem(''); setNotice(''); setReason(''); setClosing(po); }}>Close</button>
                    </>
                  )}
                  {['CLOSED', 'CANCELLED'].includes(po.status) && po.lines.some((line: any) => line.quantityBilled < line.quantity) && (
                    <button type="button" className={buttonClass.quiet} disabled={setStatus.isPending} onClick={() => { setNotice(''); setStatus.mutate({ po, status: 'OPEN' }); }}>Reopen</button>
                  )}
                </div>
              )}
            </li>
          ))}
          <li className="ll-total flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
            <span className="font-semibold text-ink-900">{shown.length} {shown.length === 1 ? 'order' : 'orders'}</span>
            <Amount cents={shownTotal} currency={currency} tone="ink" className="font-semibold" />
          </li>
        </ul>
      )}

      <Dialog
        open={!!billing}
        onClose={() => { if (!bill.isPending) setBilling(null); }}
        width="lg"
        title={`Bill ${billing?.number || ''}`}
        note="The bill posts the purchase and what is owed to the supplier, and counts stock items in. Bill less than is left if only part has arrived."
        footer={
          <>
            {problem && <p role="alert" className="mr-auto text-[13px] text-ledger-red">{problem}</p>}
            <button type="button" onClick={() => setBilling(null)} disabled={bill.isPending} className={buttonClass.secondary}>Cancel</button>
            <button type="button" onClick={() => { setProblem(''); bill.mutate(); }} disabled={bill.isPending || !billDate || !dueDate} className={buttonClass.primary}>
              {bill.isPending ? 'Posting' : 'Post bill'}
            </button>
          </>
        }
      >
        {billing && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Bill date">
                <input type="date" min={billing.orderDate} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
              </Field>
              <Field label="Due">
                <input type="date" min={billDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field label="Supplier's invoice number" hint="Optional">
                <input maxLength={100} value={supplierReference} onChange={(e) => setSupplierReference(e.target.value)} />
              </Field>
            </div>
            <ol className="border-t border-feint-strong">
              {billing.lines.filter((line: any) => line.quantity > line.quantityBilled).map((line: any) => (
                <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-3 border-b border-feint py-2">
                  <div className="text-[13.5px] text-ink-900">
                    {line.description}
                    <span className="block text-[12.5px] text-graphite-600">{quantityText(line.quantity - line.quantityBilled)} left of {quantityText(line.quantity)}</span>
                  </div>
                  <label className="block">
                    <span className="block text-[12.5px] text-graphite-600">To bill</span>
                    <input
                      aria-label={`Quantity to bill, ${line.description}`}
                      inputMode="decimal"
                      value={quantities[line.position] ?? ''}
                      onChange={(e) => setQuantities((prev) => ({ ...prev, [line.position]: e.target.value }))}
                      className="mt-1 h-9 w-full border px-2 text-right tabular-currency text-[13.5px]"
                    />
                  </label>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!closing}
        onClose={() => { if (!setStatus.isPending) setClosing(null); }}
        title={`Close ${closing?.number || ''}`}
        note={closing?.partlyBilled ? 'What is left unbilled is no longer expected. The bills already made stay as they are.' : 'Nothing has been billed from this order, so it is cancelled.'}
        footer={
          <>
            {problem && <p role="alert" className="mr-auto text-[13px] text-ledger-red">{problem}</p>}
            <button type="button" onClick={() => setClosing(null)} className={buttonClass.secondary}>Keep it open</button>
            <button type="button" disabled={setStatus.isPending || !reason.trim()} onClick={() => { setProblem(''); setStatus.mutate({ po: closing, status: 'CLOSED' }); }} className={buttonClass.primary}>
              {setStatus.isPending ? 'Closing' : 'Close order'}
            </button>
          </>
        }
      >
        <Field label="Reason" hint="For example, the supplier is out of stock">
          <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>

      {builderOpen && (
        <SalesDocumentBuilder
          kind="purchase"
          orgId={currentOrgId}
          baseCurrency={currency}
          customers={(vendors.data?.vendors || []).filter((v: any) => v.isActive !== false || v.id === editing?.customerId)}
          incomeAccounts={purchaseAccounts}
          items={(inventory.data?.items || []).filter((item: any) => (item.status || 'Active') === 'Active')}
          initial={editing}
          onClose={() => { setEditing(null); onCreatingChange(false); }}
          onRecorded={(saved: any) => {
            setNotice(`${saved.number} ${editing ? 'saved' : 'written'}. Nothing posts until it is billed.`);
            setEditing(null);
            onCreatingChange(false);
            setFilter('OPEN');
            refresh();
          }}
        />
      )}
    </div>
  );
}
