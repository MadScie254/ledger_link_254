import React, { useEffect, useState } from 'react';
import { useRenderTracker } from '../../utils/monitoring';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Download } from 'lucide-react';
import { InvoiceBuilder } from './InvoiceBuilder';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { PrintButton } from '../common/PrintButton';
import { BulkActionBar } from '../common/BulkActionBar';
import { useAppStore } from '../../store';
import { Amount } from '../ledger/Amount';
import { DataTable, type DataColumn } from '../ledger/DataTable';
import { MoneyBar } from '../ledger/MoneyBar';
import { Dialog, Field } from '../ledger/Dialog';
import { Mark } from '../ledger/Mark';
import { IndexTabs, PageHeading, PageNote, buttonClass } from '../ledger/Page';
import { CustomerPaymentDialog, CustomerPaymentsPanel } from './CustomerPayments';
import { NO_WITHHOLDING, WithheldTaxFields, withheldCents, type Withheld } from '../common/WithheldTax';
import { ForeignSettlementFields, foreignBalanceOf, settlementCents } from '../common/ForeignSettlement';
import { useConfirm } from '../../hooks/useConfirm';
import { downloadCsv } from '../../utils/exportCsv';
import { todayIn } from '../../utils/dates';
import { inParts } from '../../utils/apiRequest';
import { OrdersPanel } from './OrdersPanel';
import { EstimatesPanel } from './EstimatesPanel';
import { SalesDocumentBuilder } from './SalesDocumentBuilder';
import { CashTransactionsPanel } from '../common/CashTransactionsPanel';
import { CreditsPanel } from '../common/CreditsPanel';
import { RecurringPanel } from '../common/RecurringPanel';

type SalesTab = 'Invoices' | 'Payments' | 'Recurring' | 'Receipts' | 'Credits' | 'Estimates' | 'Orders';

export function SalesView() {
  useRenderTracker("SalesView");
  const { currentOrgId, activeCompany, createIntent, setCreateIntent } = useAppStore();
  const [salesTab, setSalesTab] = useState<SalesTab>('Invoices');
  const [actionHint, setActionHint] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isReceivingPayment, setIsReceivingPayment] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState('');
  const [isSellingNow, setIsSellingNow] = useState(false);
  const [isCrediting, setIsCrediting] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [invoiceFilter, setInvoiceFilter] = useState('ALL');
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<any | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentWithheld, setPaymentWithheld] = useState<Withheld>(NO_WITHHOLDING);
  const [paymentForeign, setPaymentForeign] = useState({ foreign: '', rate: '', base: '' });
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [depositAccountId, setDepositAccountId] = useState('');
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState('');
  const [paymentProblem, setPaymentProblem] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    if (!createIntent || !['invoice', 'payment', 'estimate', 'salesReceipt', 'creditNote'].includes(createIntent)) return;
    setActionHint(createIntent === 'payment' ? 'Choose an open invoice to receive a payment.' : '');
    if (createIntent === 'invoice') { setSalesTab('Invoices'); setIsBuilding(true); }
    if (createIntent === 'payment') setSalesTab('Invoices');
    if (createIntent === 'estimate') { setSalesTab('Estimates'); setIsEstimating(true); }
    if (createIntent === 'salesReceipt') { setSalesTab('Receipts'); setIsSellingNow(true); }
    if (createIntent === 'creditNote') { setSalesTab('Credits'); setIsCrediting(true); }
    setCreateIntent(null);
  }, [createIntent, setCreateIntent]);

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

  const { data: inventoryData } = useQuery({
    queryKey: ['inventory', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/inventory');
      if (!res.ok) throw new Error('Failed to fetch stock items');
      return res.json();
    },
    enabled: isSellingNow || isCrediting,
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    }
  });

  // Bulk void invoices, sent in parts the API accepts.
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      let voided = 0;
      const failures: Array<{ message: string }> = [];
      for (const part of inParts(ids)) {
        const res = await fetch('/api/bulk/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
          body: JSON.stringify({ entityType: 'INVOICES', ids: part })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${voided ? `${voided} voided. ` : ''}${body.error || 'The invoices could not be voided.'}`);
        voided += body.count || 0;
        failures.push(...(body.failures || []));
      }
      if (failures.length > 0) {
        throw new Error(`${voided} voided. ${failures.length} could not be voided: ${failures[0]?.message || 'see each invoice'}`);
      }
      return { count: voided };
    },
    onSuccess: () => setSelectedIds([]),
    // Some may have been voided even when others were refused.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['invoices', currentOrgId] }),
  });

  const receivePaymentMutation = useMutation({
    mutationFn: async (payment: {
      invoiceId: string; amountCents: number; paymentDate: string; depositAccountId: string; idempotencyKey: string;
      whtCents?: number; wvatCents?: number; whtCertificate?: string; wvatCertificate?: string; foreignAmountCents?: number;
    }) => {
      const res = await fetch(`/api/invoices/${payment.invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({
          amountCents: payment.amountCents,
          paymentDate: payment.paymentDate,
          depositAccountId: payment.depositAccountId,
          idempotencyKey: payment.idempotencyKey,
          ...(payment.foreignAmountCents ? { foreignAmountCents: payment.foreignAmountCents } : {}),
          ...(payment.whtCents || payment.wvatCents ? {
            whtCents: payment.whtCents, wvatCents: payment.wvatCents,
            whtCertificate: payment.whtCertificate, wvatCertificate: payment.wvatCertificate,
          } : {}),
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

  const handleExportCSV = () => {
    if (!invoicesData?.invoices) return;
    const targetInvoices = selectedIds.length > 0 
      ? invoicesData.invoices.filter((inv: any) => selectedIds.includes(inv.id))
      : invoicesData.invoices;

    const headers = ['Date', 'Invoice No', 'Customer', 'Status', 'Total'];
    const rows = targetInvoices.map((inv: any) => [
      format(new Date(inv.issueDate), 'yyyy-MM-dd'),
      inv.invoiceNo,
      customerName(inv.customerId) || inv.customerId,
      inv.status,
      (inv.totalCents / 100).toFixed(2),
    ]);
    downloadCsv('invoices.csv', [headers, ...rows]);
  };

  if (isBuilding) return <InvoiceBuilder onDone={() => setIsBuilding(false)} />;

  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const invoices: any[] = invoicesData?.invoices || [];
  // Payments land only in money accounts: bank, cash or M-Pesa.
  const depositAccounts: any[] = (accountsData?.accounts || []).filter((account: any) => account.isBankAccount && account.isActive !== false);
  const customerName = (id: string) => customersData?.customers?.find((c: any) => c.id === id)?.displayName;
  const today = todayIn(activeCompany?.timeZone);
  const paidSince = format(new Date(new Date(`${today}T12:00:00Z`).getTime() - 29 * 86400000), 'yyyy-MM-dd');
  const isOpenInvoice = (inv: any) => ['SENT', 'PARTIALLY_PAID', 'PARTIAL', 'OVERDUE'].includes(inv.status) && Number(inv.amountDueCents || 0) > 0;
  const isOverdue = (inv: any) => isOpenInvoice(inv) && !!inv.dueDate && inv.dueDate.slice(0, 10) < today;
  const recentPaid = (inv: any) => (inv.payments || []).reduce((sum: number, payment: any) => !payment.reversedAt && payment.paymentDate >= paidSince && payment.paymentDate <= today ? sum + Number(payment.amountCents || 0) : sum, 0);
  const overdueInvoices = invoices.filter(isOverdue);
  const notDueInvoices = invoices.filter((inv) => isOpenInvoice(inv) && !isOverdue(inv));
  const paidInvoices = invoices.filter((inv) => recentPaid(inv) > 0);
  const shownInvoices = invoiceFilter === 'OVERDUE' ? overdueInvoices : invoiceFilter === 'NOT_DUE' ? notDueInvoices : invoiceFilter === 'PAID_30' ? paidInvoices : invoices;
  const shownInvoiceTotal = shownInvoices.reduce((sum, inv) => sum + (inv.totalCents || 0), 0);
  const overdueCount = overdueInvoices.length;
  const openCount = invoices.filter((inv) => !['PAID', 'DRAFT', 'VOID'].includes(inv.status)).length;

  const openPayment = (invoice: any) => {
    setPaymentInvoice(invoice);
    setPaymentAmount(((invoice.amountDueCents || 0) / 100).toFixed(2));
    setPaymentDate(todayIn(activeCompany?.timeZone));
    setDepositAccountId(depositAccounts[0]?.id || '');
    setPaymentIdempotencyKey(crypto.randomUUID());
    setPaymentProblem('');
    setPaymentWithheld(NO_WITHHOLDING);
    const foreign = foreignBalanceOf(invoice, baseCurrency);
    setPaymentForeign(foreign ? {
      foreign: (foreign.foreignDueCents / 100).toFixed(2),
      rate: (1 / foreign.bookedRate).toFixed(4),
      base: (foreign.baseDueCents / 100).toFixed(2),
    } : { foreign: '', rate: '', base: '' });
  };

  const submitPayment = () => {
    if (!paymentInvoice) return;
    const foreignBalance = foreignBalanceOf(paymentInvoice, baseCurrency);
    if (foreignBalance) {
      const settled = settlementCents(paymentForeign);
      if (settled.problem) { setPaymentProblem(settled.problem); return; }
      if (settled.foreignCents > foreignBalance.foreignDueCents) { setPaymentProblem(`No more than ${paymentInvoice.currency} ${(foreignBalance.foreignDueCents / 100).toFixed(2)} is owing.`); return; }
      if (!depositAccountId) { setPaymentProblem('Choose the account that received the money.'); return; }
      setPaymentProblem('');
      receivePaymentMutation.mutate({
        invoiceId: paymentInvoice.id, amountCents: settled.baseCents, foreignAmountCents: settled.foreignCents,
        paymentDate, depositAccountId, idempotencyKey: paymentIdempotencyKey,
      });
      return;
    }
    const amountCents = Math.round(Number(paymentAmount || 0) * 100);
    const withheld = withheldCents(paymentWithheld);
    if (withheld.problem) {
      setPaymentProblem(withheld.problem);
      return;
    }
    const withheldTotal = withheld.whtCents + withheld.wvatCents;
    if (!Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents + withheldTotal <= 0) {
      setPaymentProblem('Enter a payment amount greater than zero.');
      return;
    }
    if (amountCents + withheldTotal > Number(paymentInvoice.amountDueCents || 0)) {
      setPaymentProblem(withheldTotal ? 'The amount received and the tax withheld come to more than is due.' : 'Payment cannot exceed the amount due.');
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
      ...(withheldTotal ? {
        whtCents: withheld.whtCents, wvatCents: withheld.wvatCents,
        whtCertificate: paymentWithheld.whtCertificate, wvatCertificate: paymentWithheld.wvatCertificate,
      } : {}),
    });
  };

  const standing = (status: string) => {
    switch (status) {
      case 'PAID':
        return <Mark kind="tick" label="Paid" />;
      case 'OVERDUE':
        return <Mark kind="circled" label="Overdue" />;
      case 'SENT':
        return <Mark kind="query" label="Not due" />;
      case 'PARTIAL':
      case 'PARTIALLY_PAID':
        return <Mark kind="query" label="Part paid" />;
      case 'VOID':
        return <Mark kind="query" label="Void" />;
      case 'DRAFT':
        return <span className="text-[12px] text-graphite-600">Draft, not sent</span>;
      default:
        return <span className="text-[12px] text-graphite-600">{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
    }
  };

  const invoiceColumns: DataColumn<any>[] = [
    { id: 'date', label: 'Date', value: (inv) => inv.issueDate || '', render: (inv) => <span className="whitespace-nowrap text-text-2">{format(new Date(inv.issueDate), 'dd/MM/yyyy')}</span> },
    { id: 'invoice', label: 'Invoice', value: (inv) => inv.invoiceNo || '', render: (inv) => <span className="font-medium text-text">{inv.invoiceNo}</span> },
    { id: 'customer', label: 'Customer', value: (inv) => customerName(inv.customerId) || '', render: (inv) => <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedInvoice(inv); }} className="text-left font-medium text-text hover:text-primary-ink">{customerName(inv.customerId) || 'Customer not found'}</button> },
    { id: 'standing', label: 'Standing', value: (inv) => inv.status || '', render: (inv) => standing(isOverdue(inv) ? 'OVERDUE' : inv.status) },
    { id: 'due', label: 'Due', value: (inv) => inv.dueDate || '', render: (inv) => inv.dueDate ? format(new Date(inv.dueDate), 'dd/MM/yyyy') : '–' },
    { id: 'total', label: baseCurrency, value: (inv) => Number(inv.totalCents || 0), render: (inv) => <Amount cents={inv.totalCents || 0} currency={baseCurrency} />, numeric: true },
  ];

  return (
    <div>
      <PageHeading
        title="Sales"
        note={
          salesTab === 'Invoices'
            ? <>{invoices.length} invoices for {activeCompany?.name || 'this organization'} · Figures in {baseCurrency}</>
            : salesTab === 'Payments'
              ? <>Payments that settle several invoices at once · Figures in {baseCurrency}</>
            : salesTab === 'Estimates'
              ? <>Quotes to customers, before they become invoices · Figures in {baseCurrency}</>
              : salesTab === 'Receipts'
                ? <>Sales paid on the spot, by cash, card or M-Pesa · Figures in {baseCurrency}</>
              : salesTab === 'Credits'
                ? <>What is owed back to customers, applied to invoices or refunded · Figures in {baseCurrency}</>
              : salesTab === 'Recurring'
                ? <>Invoices posted again on a schedule · Figures in {baseCurrency}</>
              : <>Orders customers have placed with {activeCompany?.name || 'this organization'} · Figures in {baseCurrency}</>
        }
        actions={
          salesTab === 'Invoices' ? (
            <>
              <button type="button" onClick={handleExportCSV} className={buttonClass.secondary}>
                <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
              </button>
              <button type="button" onClick={() => setIsReceivingPayment(true)} className={buttonClass.secondary}>
                Receive a payment
              </button>
              <button data-tour="new-invoice" type="button" onClick={() => setIsBuilding(true)} className={buttonClass.primary}>
                New invoice
              </button>
            </>
          ) : salesTab === 'Payments' ? (
            <button type="button" onClick={() => setIsReceivingPayment(true)} className={buttonClass.primary}>
              Receive a payment
            </button>
          ) : salesTab === 'Estimates' ? (
            <button type="button" onClick={() => setIsEstimating(true)} className={buttonClass.primary}>
              New estimate
            </button>
          ) : salesTab === 'Receipts' ? (
            <button type="button" onClick={() => setIsSellingNow(true)} className={buttonClass.primary}>
              New sales receipt
            </button>
          ) : salesTab === 'Credits' ? (
            <button type="button" onClick={() => setIsCrediting(true)} className={buttonClass.primary}>
              New credit note
            </button>
          ) : salesTab === 'Recurring' ? (
            <button type="button" onClick={() => setIsScheduling(true)} className={buttonClass.primary}>
              New recurring invoice
            </button>
          ) : (
            <button type="button" onClick={() => setIsOrdering(true)} className={buttonClass.primary}>
              New order
            </button>
          )
        }
      />

      {actionHint && <PageNote>{actionHint}</PageNote>}
      <IndexTabs
        label="Sales"
        active={salesTab}
        onChange={(tab) => {
          setSalesTab(tab);
          setSelectedIds([]);
        }}
        tabs={[
          { id: 'Invoices', name: 'Invoices', count: invoices.length },
          { id: 'Payments', name: 'Payments' },
          { id: 'Recurring', name: 'Recurring' },
          { id: 'Receipts', name: 'Sales receipts' },
          { id: 'Credits', name: 'Credit notes' },
          { id: 'Estimates', name: 'Estimates' },
          { id: 'Orders', name: 'Orders' },
        ]}
      />

      {paymentNotice && <p role="status" className="mt-3 text-[13.5px] text-ink-900">{paymentNotice}</p>}
      {isReceivingPayment && (
        <CustomerPaymentDialog invoices={invoices} customers={(customersData?.customers || []).filter((c: any) => c.isActive !== false)}
          accounts={accountsData?.accounts || []} baseCurrency={baseCurrency}
          onClose={() => setIsReceivingPayment(false)} onDone={(message) => { setIsReceivingPayment(false); setPaymentNotice(message); }} />
      )}
      {salesTab === 'Payments' ? (
        <CustomerPaymentsPanel baseCurrency={baseCurrency} onReceive={() => setIsReceivingPayment(true)} />
      ) : salesTab === 'Receipts' ? (
        <CashTransactionsPanel kind="SALES_RECEIPT" onCreate={() => setIsSellingNow(true)} />
      ) : salesTab === 'Credits' ? (
        <CreditsPanel kind="CUSTOMER" onCreate={() => setIsCrediting(true)} />
      ) : salesTab === 'Recurring' ? (
        <RecurringPanel kind="INVOICE" isCreating={isScheduling} onCreatingChange={setIsScheduling} />
      ) : salesTab === 'Estimates' ? (
        <EstimatesPanel
          orgId={currentOrgId}
          baseCurrency={baseCurrency}
          customers={customersData?.customers || []}
          accounts={accountsData?.accounts || []}
          isCreating={isEstimating}
          onCreatingChange={setIsEstimating}
        />
      ) : salesTab === 'Orders' ? (
        <OrdersPanel
          orgId={currentOrgId}
          baseCurrency={baseCurrency}
          customers={customersData?.customers || []}
          accounts={accountsData?.accounts || []}
          isCreating={isOrdering}
          onCreatingChange={setIsOrdering}
        />
      ) : (
      <>
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
          <p>No invoices yet. Each invoice you issue is listed here with its customer, standing and due date, the total carried to the foot.</p>
          <button type="button" onClick={() => setIsBuilding(true)} className={`${buttonClass.quiet} mt-2`}>Write the first invoice</button>
        </div>
      ) : (
        <>
          <PageNote>
            <span>{openCount} open</span>
            {overdueCount > 0 && <Mark kind="circled" label={`${overdueCount} overdue`} />}
            <span>{invoices.length - openCount} not open</span>
          </PageNote>
          <MoneyBar label="Invoice money" active={invoiceFilter} onChange={setInvoiceFilter} currency={baseCurrency} segments={[
            { id: 'OVERDUE', label: 'Overdue', count: overdueInvoices.length, cents: overdueInvoices.reduce((sum, inv) => sum + Number(inv.amountDueCents || 0), 0), color: 'var(--warning)' },
            { id: 'NOT_DUE', label: 'Not due', count: notDueInvoices.length, cents: notDueInvoices.reduce((sum, inv) => sum + Number(inv.amountDueCents || 0), 0), color: 'var(--chart-expense)' },
            { id: 'PAID_30', label: 'Paid in 30 days', count: paidInvoices.length, cents: paidInvoices.reduce((sum, inv) => sum + recentPaid(inv), 0), color: 'var(--positive)' },
          ]} />
          {/* On a phone each invoice is a ruled entry: who and how much, then its number, date and standing. */}
          <ul className="sm:hidden" aria-label={`Invoices, figures in ${baseCurrency}`}>
            {shownInvoices.length === 0 && <li className="py-6 text-sm text-text-2">No invoices match this filter. Choose All to see every invoice.</li>}
            {shownInvoices.map((inv: any) => (
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
                  <span className="flex flex-wrap items-center gap-2">
                    {standing(isOverdue(inv) ? 'OVERDUE' : inv.status)}
                    {Number(inv.amountDueCents || 0) > 0 && inv.status !== 'VOID' && (
                      <button type="button" onClick={() => openPayment(inv)} className={buttonClass.quiet}>Receive payment</button>
                    )}
                    <PrintButton kind="invoice" id={inv.id} number={inv.invoiceNo} />
                  </span>
                  {inv.dueDate && <span className="text-[12px] text-graphite-600">Due {format(new Date(inv.dueDate), 'dd/MM/yyyy')}</span>}
                </div>
                <label className="mt-1 inline-flex min-h-11 items-center gap-2 text-xs text-text-2"><input type="checkbox" aria-label={`Select invoice ${inv.invoiceNo}`} checked={selectedIds.includes(inv.id)} onChange={() => setSelectedIds((current) => current.includes(inv.id) ? current.filter((id) => id !== inv.id) : [...current, inv.id])} />Select</label>
              </li>
            ))}
            <li className="ll-total mt-px flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
                <span className="font-semibold text-ink-900">Total of {shownInvoices.length} {shownInvoices.length === 1 ? 'invoice' : 'invoices'}</span>
                <Amount cents={shownInvoiceTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
            </li>
          </ul>
          <div className="hidden sm:block">
            <DataTable
              records={shownInvoices}
              columns={invoiceColumns}
              caption={`Invoices, figures in ${baseCurrency}`}
              onOpen={setSelectedInvoice}
              openLabel={(inv) => `Open invoice ${inv.invoiceNo}`}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              selectAllLabel="Select all invoices"
              selectRowLabel={(inv) => `Select invoice ${inv.invoiceNo}`}
              rowActions={(inv) => (
                <>
                  {Number(inv.amountDueCents || 0) > 0 && inv.status !== 'VOID' && (
                    <button type="button" onClick={() => openPayment(inv)} className={buttonClass.quiet}>Receive payment</button>
                  )}
                  <PrintButton kind="invoice" id={inv.id} number={inv.invoiceNo} />
                </>
              )}
            />
            <div className="flex items-baseline justify-between gap-4 px-4 py-3 text-[13px]">
              <span className="font-semibold text-text">Total of {shownInvoices.length} {shownInvoices.length === 1 ? 'invoice' : 'invoices'}</span>
              <Amount cents={shownInvoiceTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
            </div>
          </div>        </>
      )}

      {/* Bulk Action Contextual Toolbar */}
      <BulkActionBar
        selectedCount={selectedIds.length}
        totalCount={invoicesData?.invoices?.length || 0}
        entityName="invoices"
        onClearSelection={() => setSelectedIds([])}
        onDelete={() => {
          confirm(
            { title: 'Void invoices', message: `Void ${selectedIds.length} invoice(s)? Each is reversed in the ledger with an entry dated today. Invoices with payments are refused.`, confirmText: 'Void', isDestructive: true },
            () => bulkDeleteMutation.mutate(selectedIds)
          );
        }}
        onExport={handleExportCSV}
        isLoading={bulkDeleteMutation.isPending}
      />
      {bulkDeleteMutation.error && (
        <p role="alert" className="text-[13.5px] text-ledger-red">{bulkDeleteMutation.error.message}</p>
      )}
      </>
      )}

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
            <span className="font-semibold text-ink-900">
              Amount due{foreignBalanceOf(paymentInvoice, baseCurrency) ? ` (${baseCurrency} at the booked rate)` : ''}
            </span>
            <Amount cents={paymentInvoice?.amountDueCents || 0} currency={baseCurrency} tone="ink" />
          </div>
          {foreignBalanceOf(paymentInvoice, baseCurrency) ? (
            <ForeignSettlementFields value={paymentForeign} onChange={setPaymentForeign} side="invoice"
              balance={foreignBalanceOf(paymentInvoice, baseCurrency)!} currency={paymentInvoice.currency} baseCurrency={baseCurrency} />
          ) : (
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
          )}
          <Field label="Date received">
            <input type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          </Field>
          <Field label="Deposit account" hint={depositAccounts.length === 0 ? 'Mark a bank, cash or M-Pesa account as holding money (Accounting, Edit) before receiving payment.' : undefined}>
            <select required value={depositAccountId} onChange={(event) => setDepositAccountId(event.target.value)}>
              <option value="">Choose an account</option>
              {depositAccounts.map((account: any) => (
                <option key={account.id} value={account.id}>{account.code} · {account.name}</option>
              ))}
            </select>
          </Field>
          {String(paymentInvoice?.currency || baseCurrency).toUpperCase() === baseCurrency.toUpperCase() && (
            <WithheldTaxFields value={paymentWithheld} onChange={setPaymentWithheld} currency={baseCurrency} side="customer" />
          )}
          {paymentProblem && <p role="alert" className="text-[13px] text-ledger-red">{paymentProblem}</p>}
          <p className="text-[12.5px] text-graphite-600">This posts cash or bank against accounts receivable{paymentWithheld.on ? ', and tax withheld to 1170 and 1175 to claim from KRA' : ''}. A smaller amount leaves the invoice part paid.</p>
        </div>
      </Dialog>

      {isSellingNow && (
        <SalesDocumentBuilder
          kind="receipt"
          orgId={currentOrgId}
          baseCurrency={baseCurrency}
          customers={(customersData?.customers || []).filter((c: any) => c.isActive !== false)}
          incomeAccounts={(accountsData?.accounts || []).filter((a: any) => a.type === 'INCOME' && a.isActive !== false)}
          items={(inventoryData?.items || []).filter((item: any) => (item.status || 'Active') === 'Active')}
          moneyAccounts={depositAccounts}
          onClose={() => setIsSellingNow(false)}
          onRecorded={() => {
            setIsSellingNow(false);
            for (const key of ['cash-transactions', 'accounts', 'inventory', 'journal-entries', 'dashboard-metrics']) {
              queryClient.invalidateQueries({ queryKey: [key, currentOrgId] });
            }
          }}
        />
      )}

      {isCrediting && (
        <SalesDocumentBuilder
          kind="credit"
          orgId={currentOrgId}
          baseCurrency={baseCurrency}
          customers={(customersData?.customers || []).filter((c: any) => c.isActive !== false)}
          incomeAccounts={(accountsData?.accounts || []).filter((a: any) => a.type === 'INCOME' && a.isActive !== false)}
          items={(inventoryData?.items || []).filter((item: any) => (item.status || 'Active') === 'Active')}
          invoices={invoices}
          onClose={() => setIsCrediting(false)}
          onRecorded={() => {
            setIsCrediting(false);
            setSalesTab('Credits');
            for (const key of ['credits', 'invoices', 'customers', 'accounts', 'inventory', 'journal-entries', 'dashboard-metrics']) {
              queryClient.invalidateQueries({ queryKey: [key, currentOrgId] });
            }
          }}
        />
      )}

      {/* Invoice Drill-down Overlay */}
      <EntityDrillDownModal
        isOpen={!!selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        entityType="INVOICE"
        entityId={selectedInvoice?.id || null}
        initialData={selectedInvoice}
      />

      {confirmDialog}
    </div>
  );
}
