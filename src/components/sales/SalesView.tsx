import React, { useState } from 'react';
import { useRenderTracker } from '../../utils/monitoring';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Download } from 'lucide-react';
import { ConfirmModal } from '../layout/ConfirmModal';
import { InvoiceBuilder } from './InvoiceBuilder';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { BulkActionBar } from '../common/BulkActionBar';
import { useAppStore } from '../../store';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { Mark } from '../ledger/Mark';
import { PageHeading, PageNote, buttonClass } from '../ledger/Page';

export function SalesView() {
  useRenderTracker("SalesView");
  const { currentOrgId, activeCompany } = useAppStore();
  const [isBuilding, setIsBuilding] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<any | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [depositAccountId, setDepositAccountId] = useState('');
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState('');
  const [paymentProblem, setPaymentProblem] = useState('');

  const queryClient = useQueryClient();

  const { data: invoicesData, isLoading: loadingInvoices, isError: invoicesError, refetch: refetchInvoices } = useQuery({
    queryKey: ['invoices', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/invoices', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    }
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/customers', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    }
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    }
  });

  // Bulk Delete Invoices
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ entityType: 'INVOICES', ids })
      });
      if (!res.ok) throw new Error('Failed to delete invoices');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', currentOrgId] });
      setSelectedIds([]);
    }
  });

  const receivePaymentMutation = useMutation({
    mutationFn: async (payment: { invoiceId: string; amountCents: number; paymentDate: string; depositAccountId: string; idempotencyKey: string }) => {
      const res = await fetch(`/api/invoices/${payment.invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({
          amountCents: payment.amountCents,
          paymentDate: payment.paymentDate,
          depositAccountId: payment.depositAccountId,
          idempotencyKey: payment.idempotencyKey,
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'The payment could not be recorded.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
      setSelectedIds([]);
      setPaymentInvoice(null);
      setPaymentProblem('');
    },
    onError: (error) => {
      setPaymentProblem(error instanceof Error ? error.message : 'The payment could not be recorded.');
    }
  });

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked && invoicesData?.invoices) {
      setSelectedIds(invoicesData.invoices.map((inv: any) => inv.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleExportCSV = () => {
    if (!invoicesData?.invoices) return;
    const targetInvoices = selectedIds.length > 0 
      ? invoicesData.invoices.filter((inv: any) => selectedIds.includes(inv.id))
      : invoicesData.invoices;

    const headers = ['Date', 'Invoice No', 'Customer ID', 'Status', 'Total'];
    const rows = targetInvoices.map((inv: any) => [
      format(new Date(inv.issueDate), 'yyyy-MM-dd'),
      inv.invoiceNo,
      inv.customerId,
      inv.status,
      (inv.totalCents / 100).toFixed(2)
    ]);
    const csvContent = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoices.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (isBuilding) return <InvoiceBuilder onDone={() => setIsBuilding(false)} />;

  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const invoices: any[] = invoicesData?.invoices || [];
  const depositAccounts: any[] = (accountsData?.accounts || []).filter((account: any) => account.type === 'ASSET' && account.isActive !== false);
  const customerName = (id: string) => customersData?.customers?.find((c: any) => c.id === id)?.displayName;
  const invoiceTotal = invoices.reduce((sum, inv) => sum + (inv.totalCents || 0), 0);
  const overdueCount = invoices.filter((inv) => inv.status === 'OVERDUE').length;
  const openCount = invoices.filter((inv) => !['PAID', 'DRAFT', 'VOID'].includes(inv.status)).length;

  const openPayment = (invoice: any) => {
    setPaymentInvoice(invoice);
    setPaymentAmount(((invoice.amountDueCents || 0) / 100).toFixed(2));
    setPaymentDate(format(new Date(), 'yyyy-MM-dd'));
    setDepositAccountId(depositAccounts[0]?.id || '');
    setPaymentIdempotencyKey(crypto.randomUUID());
    setPaymentProblem('');
  };

  const submitPayment = () => {
    if (!paymentInvoice) return;
    const amountCents = Math.round(Number(paymentAmount) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      setPaymentProblem('Enter a payment amount greater than zero.');
      return;
    }
    if (amountCents > Number(paymentInvoice.amountDueCents || 0)) {
      setPaymentProblem('Payment cannot exceed the amount due.');
      return;
    }
    if (!depositAccountId) {
      setPaymentProblem('Choose the account that received the money.');
      return;
    }
    receivePaymentMutation.mutate({
      invoiceId: paymentInvoice.id,
      amountCents,
      paymentDate,
      depositAccountId,
      idempotencyKey: paymentIdempotencyKey,
    });
  };

  const standing = (status: string) => {
    switch (status) {
      case 'PAID':
        return <Mark kind="tick" label="Paid" />;
      case 'OVERDUE':
        return <Mark kind="circled" label="Overdue" />;
      case 'SENT':
        return <Mark kind="query" label="Awaiting payment" />;
      case 'PARTIAL':
      case 'PARTIALLY_PAID':
        return <Mark kind="query" label="Part paid" />;
      case 'VOID':
        return <Mark kind="circled" label="Void" />;
      case 'DRAFT':
        return <span className="text-[12px] text-graphite-600">Draft, not sent</span>;
      default:
        return <span className="text-[12px] text-graphite-600">{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
    }
  };

  return (
    <div>
      <PageHeading
        title="Sales"
        note={<>{invoices.length} invoices for {activeCompany?.name || 'this organization'} · Figures in {baseCurrency}</>}
        actions={
          (
            <>
              <button type="button" onClick={handleExportCSV} className={buttonClass.secondary}>
                <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
              </button>
              <button data-tour="new-invoice" type="button" onClick={() => setIsBuilding(true)} className={buttonClass.primary}>
                New invoice
              </button>
            </>
          )
        }
      />

      {loadingInvoices ? (
        <div aria-busy="true" aria-label="Loading invoices" className="mt-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 border-b border-feint flex items-center gap-6">
              <div className="h-3 w-20 bg-paper-200" />
              <div className="h-3 w-28 bg-paper-200" />
              <div className="h-3 flex-1 bg-paper-200" />
              <div className="h-3 w-24 bg-paper-200" />
            </div>
          ))}
        </div>
      ) : invoicesError ? (
        <p role="alert" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <Mark kind="circled" />
          <span className="text-ink-900">Could not load invoices.</span>
          <span className="text-graphite-600">GET /api/invoices did not complete.</span>
          <button type="button" onClick={() => refetchInvoices()} className={buttonClass.quiet}>Try again</button>
        </p>
      ) : invoices.length === 0 ? (
        <div className="py-8 max-w-xl text-[14px] text-graphite-600">
          <p>No invoices yet. Each invoice you issue is listed here with its customer, standing and eTIMS signature, largest totals carried to the foot.</p>
          <button type="button" onClick={() => setIsBuilding(true)} className={`${buttonClass.quiet} mt-2`}>Write the first invoice</button>
        </div>
      ) : (
        <>
          <PageNote>
            <span>{openCount} open</span>
            {overdueCount > 0 && <Mark kind="circled" label={`${overdueCount} overdue`} />}
            <span>{invoices.length - openCount} paid or draft</span>
          </PageNote>
          {/* On a phone each invoice is a ruled entry: who and how much, then its number, date and standing. */}
          <ul className="sm:hidden" aria-label={`Invoices, figures in ${baseCurrency}`}>
            {invoices.map((inv: any) => (
              <li key={inv.id} className="border-b border-feint py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <button type="button" onClick={() => setSelectedInvoice(inv)} className="min-w-0 truncate text-left text-[14.5px] text-ink-900 hover:underline underline-offset-[3px]">
                    {customerName(inv.customerId) || 'Customer not found'}
                  </button>
                  <Amount cents={inv.totalCents || 0} currency={baseCurrency} className="shrink-0" />
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-[12.5px] text-graphite-600">
                  <span>{inv.invoiceNo} · {format(new Date(inv.issueDate), 'dd/MM/yyyy')}</span>
                  {inv.currency && inv.currency !== baseCurrency && (
                    <span className="shrink-0">
                      {inv.currency} <Amount cents={inv.foreignAmountCents || inv.totalCents} currency={inv.currency} size="xs" tone="ink" />
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    {standing(inv.status)}
                    {Number(inv.amountDueCents || 0) > 0 && inv.status !== 'VOID' && (
                      <button type="button" onClick={() => openPayment(inv)} className={buttonClass.quiet}>Receive payment</button>
                    )}
                  </span>
                  <span className="text-[12px] text-graphite-600">{inv.etimsStatus === 'SUCCESS' ? `eTIMS signed ${inv.etimsControlCode}` : 'eTIMS queued'}</span>
                </div>
              </li>
            ))}
            <li className="ll-total mt-px flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
              <span className="font-semibold text-ink-900">Total of {invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}</span>
              <Amount cents={invoiceTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
            </li>
          </ul>
          <div className="hidden sm:block relative overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <caption className="sr-only">Invoices, figures in {baseCurrency}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-8 pr-2 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all invoices"
                      className="h-4 w-4"
                      onChange={handleSelectAll}
                      checked={selectedIds.length > 0 && invoices.length === selectedIds.length}
                    />
                  </th>
                  <th scope="col" className="pr-4 text-left">Date</th>
                  <th scope="col" className="pr-4 text-left">Invoice</th>
                  <th scope="col" className="pr-4 text-left">Customer</th>
                  <th scope="col" className="pr-4 text-left">Standing</th>
                  <th scope="col" className="pr-4 text-left">eTIMS</th>
                  <th scope="col" className="text-right">{baseCurrency}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv: any) => (
                  <tr key={inv.id} onClick={() => setSelectedInvoice(inv)} className="cursor-pointer">
                    <td className="w-8 pr-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select invoice ${inv.invoiceNo}`}
                        className="h-4 w-4"
                        checked={selectedIds.includes(inv.id)}
                        onChange={() => handleSelectOne(inv.id)}
                      />
                    </td>
                    <td className="pr-4 whitespace-nowrap text-graphite-600">{format(new Date(inv.issueDate), 'dd/MM/yyyy')}</td>
                    <td className="pr-4 whitespace-nowrap text-graphite-600">{inv.invoiceNo}</td>
                    <td className="pr-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedInvoice(inv);
                        }}
                        className="text-left text-ink-900 hover:underline underline-offset-[3px]"
                      >
                        {customerName(inv.customerId) || 'Customer not found'}
                      </button>
                    </td>
                    <td className="pr-4 whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        {standing(inv.status)}
                        {Number(inv.amountDueCents || 0) > 0 && inv.status !== 'VOID' && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openPayment(inv);
                            }}
                            className={buttonClass.quiet}
                          >
                            Receive payment
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="pr-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {inv.etimsStatus === 'SUCCESS' ? (
                        <a href={inv.etimsQrCodeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-ink-900 hover:underline">
                          <Mark kind="tick" /> Signed {inv.etimsControlCode}
                        </a>
                      ) : (
                        <span className="text-[12px] text-graphite-600">Queued</span>
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <Amount cents={inv.totalCents || 0} currency={baseCurrency} />
                      {inv.currency && inv.currency !== baseCurrency && (
                        <span className="block mt-1 text-[11.5px] text-graphite-600">
                          {inv.currency} <Amount cents={inv.foreignAmountCents || inv.totalCents} currency={inv.currency} size="xs" tone="ink" />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ll-total mt-px flex items-baseline justify-between gap-4 py-2 text-[13.5px]">
              <span className="font-semibold text-ink-900">Total of {invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}</span>
              <Amount cents={invoiceTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
            </div>
          </div>
        </>
      )}

      {/* Bulk Action Contextual Toolbar */}
      <BulkActionBar
        selectedCount={selectedIds.length}
        totalCount={invoicesData?.invoices?.length || 0}
        entityName="invoices"
        onClearSelection={() => setSelectedIds([])}
        onDelete={() => {
          if (window.confirm(`Delete ${selectedIds.length} invoice(s)?`)) {
            bulkDeleteMutation.mutate(selectedIds);
          }
        }}
        onExport={handleExportCSV}
        isLoading={bulkDeleteMutation.isPending}
      />

      <Dialog
        open={!!paymentInvoice}
        onClose={() => {
          if (!receivePaymentMutation.isPending) setPaymentInvoice(null);
        }}
        title="Receive payment"
        note={paymentInvoice ? `${paymentInvoice.invoiceNo} · ${customerName(paymentInvoice.customerId) || 'Customer'}` : undefined}
        footer={
          <>
            <button type="button" onClick={() => setPaymentInvoice(null)} disabled={receivePaymentMutation.isPending} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="button" onClick={submitPayment} disabled={receivePaymentMutation.isPending || depositAccounts.length === 0} className={buttonClass.primary}>
              {receivePaymentMutation.isPending ? 'Posting' : 'Post payment'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="ll-total flex items-baseline justify-between py-2 text-[13.5px]">
            <span className="font-semibold text-ink-900">Amount due</span>
            <Amount cents={paymentInvoice?.amountDueCents || 0} currency={baseCurrency} tone="ink" />
          </div>
          <Field label={`Amount received (${baseCurrency})`}>
            <input
              type="number"
              min="0.01"
              max={((paymentInvoice?.amountDueCents || 0) / 100).toFixed(2)}
              step="0.01"
              inputMode="decimal"
              required
              value={paymentAmount}
              onChange={(event) => setPaymentAmount(event.target.value)}
              className="tabular-currency"
            />
          </Field>
          <Field label="Date received">
            <input type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          </Field>
          <Field label="Deposit account" hint={depositAccounts.length === 0 ? 'Add an active bank or cash asset account before receiving payment.' : undefined}>
            <select required value={depositAccountId} onChange={(event) => setDepositAccountId(event.target.value)}>
              <option value="">Choose an account</option>
              {depositAccounts.map((account: any) => (
                <option key={account.id} value={account.id}>{account.code} · {account.name}</option>
              ))}
            </select>
          </Field>
          {paymentProblem && <p role="alert" className="text-[13px] text-ledger-red">{paymentProblem}</p>}
          <p className="text-[12.5px] text-graphite-600">This posts cash or bank against accounts receivable. A smaller amount leaves the invoice part paid.</p>
        </div>
      </Dialog>

      {/* Invoice Drill-down Overlay */}
      <EntityDrillDownModal
        isOpen={!!selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        entityType="INVOICE"
        entityId={selectedInvoice?.id || null}
        initialData={selectedInvoice}
      />
    </div>
  );
}
