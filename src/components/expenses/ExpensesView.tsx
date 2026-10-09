import React from 'react';
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ReceiptScanner } from './ReceiptScanner';
import { BillBuilder } from './BillBuilder';
import { CashTransactionsPanel } from '../common/CashTransactionsPanel';
import { CreditsPanel } from '../common/CreditsPanel';
import { PurchaseOrdersPanel } from './PurchaseOrdersPanel';
import { RecurringPanel } from '../common/RecurringPanel';
import { ImportRecordsDialog } from '../common/ImportRecordsDialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { BulkActionBar } from '../common/BulkActionBar';
import { Amount } from '../ledger/Amount';
import { DataTable, type DataColumn } from '../ledger/DataTable';
import { MoneyBar } from '../ledger/MoneyBar';
import { Mark } from '../ledger/Mark';
import { PageHeading, IndexTabs, buttonClass } from '../ledger/Page';
import { Field } from '../ledger/Dialog';
import { useConfirm } from '../../hooks/useConfirm';
import { inParts } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';

const tabs = ['Vendors', 'Bills', 'Recurring bills', 'Purchase orders', 'Expenses', 'Supplier credits', 'Bill payments'];

/** A UUID-shaped key derived from text with SHA-256, the same every time for the same text. */
async function stableUuid(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ExpensesView() {
  const [activeTab, setActiveTab] = useState('Bills');
  const [isCreatingVendor, setIsCreatingVendor] = useState(false);
  const [isCreatingBill, setIsCreatingBill] = useState(false);
  const [isScanningReceipt, setIsScanningReceipt] = useState(false);
  const [isRecordingExpense, setIsRecordingExpense] = useState(false);
  const [isRecordingCredit, setIsRecordingCredit] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isImportingVendors, setIsImportingVendors] = useState(false);
  const [importNotice, setImportNotice] = useState('');
  const [scannedData, setScannedData] = useState<{ vendor: string; amount: number; date: string; receipt?: File } | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<{ type: 'VENDOR' | 'BILL'; id: string; data: any } | null>(null);
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [billFilter, setBillFilter] = useState('ALL');
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [batchPaymentAccountId, setBatchPaymentAccountId] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  const { currentOrgId, activeCompany, createIntent, setCreateIntent } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!createIntent || !['bill', 'payBills', 'expense', 'purchaseOrder', 'supplierCredit'].includes(createIntent)) return;
    if (createIntent === 'bill') { setActiveTab('Bills'); setIsCreatingBill(true); }
    if (createIntent === 'payBills') setActiveTab('Bill payments');
    if (createIntent === 'expense') { setActiveTab('Expenses'); setIsRecordingExpense(true); }
    if (createIntent === 'purchaseOrder') { setActiveTab('Purchase orders'); setIsOrdering(true); }
    if (createIntent === 'supplierCredit') { setActiveTab('Supplier credits'); setIsRecordingCredit(true); }
    setCreateIntent(null);
  }, [createIntent, setCreateIntent]);

  const { data: vendorsData, isLoading: vendorsLoading } = useQuery({
    queryKey: ['vendors', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/vendors', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch vendors');
      return res.json();
    }
  });

  const { data: billsData, isLoading: billsLoading } = useQuery({
    queryKey: ['bills', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/bills', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch bills');
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

  function closeBill() {
    setIsCreatingBill(false);
    setScannedData(null);
  }

  // Bulk void bills, sent in parts the API accepts.
  const bulkDeleteBillsMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      let voided = 0;
      const failures: Array<{ message: string }> = [];
      for (const part of inParts(ids)) {
        const res = await fetch('/api/bulk/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
          body: JSON.stringify({ entityType: 'BILLS', ids: part })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${voided ? `${voided} voided. ` : ''}${body.error || 'The bills could not be voided.'}`);
        voided += body.count || 0;
        failures.push(...(body.failures || []));
      }
      if (failures.length > 0) {
        throw new Error(`${voided} voided. ${failures.length} could not be voided: ${failures[0]?.message || 'see each bill'}`);
      }
      return { count: voided };
    },
    onSuccess: () => setSelectedBillIds([]),
    // Some may have been voided even when others were refused.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['bills', currentOrgId] }),
  });

  const batchPaymentMutation = useMutation({
    mutationFn: async ({ targetBills, sourceAccountId }: { targetBills: any[]; sourceAccountId: string }) => {
      const paymentDate = todayIn(activeCompany?.timeZone);
      // The same bill, amount, day and account always get the same key, so
      // pressing pay again after a dropped connection returns the payment
      // already made instead of paying twice.
      const payments = await Promise.all(targetBills.map(async (bill) => ({
        billId: bill.id,
        amountCents: bill.amountDueCents,
        paymentDate,
        sourceAccountId,
        idempotencyKey: await stableUuid(`bill-batch-pay:${currentOrgId}:${bill.id}:${bill.amountDueCents}:${paymentDate}:${sourceAccountId}`),
      })));
      let paid = 0;
      let failed = 0;
      let firstFailure = '';
      for (const part of inParts(payments)) {
        const res = await fetch('/api/bills/batch-pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
          body: JSON.stringify({ payments: part })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${paid ? `${paid} payment(s) posted. ` : ''}${body.error || 'Failed to record bill payments'}`);
        paid += body.paid || 0;
        failed += body.failed || 0;
        firstFailure ||= body.errors?.[0]?.message || body.failures?.[0]?.message || '';
      }
      if (failed > 0) throw new Error(`${paid} payment(s) posted; ${failed} failed${firstFailure ? `: ${firstFailure}` : ''}. Refresh and review the open bills.`);
      return { paid };
    },
    onSuccess: () => {
      setSelectedBillIds([]);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['bills', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
    },
  });

  // Bulk delete vendors. The database refuses any vendor with bills; mark those inactive instead.
  const bulkDeleteVendorsMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      let deleted = 0;
      for (const part of inParts(ids)) {
        const res = await fetch('/api/bulk/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
          body: JSON.stringify({ entityType: 'VENDORS', ids: part })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${deleted ? `${deleted} deleted. ` : ''}${body.error || 'Failed to delete vendors'}`);
        deleted += body.count || 0;
      }
      return { count: deleted };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors', currentOrgId] });
      setSelectedVendorIds([]);
    }
  });

  const vendors = vendorsData?.vendors || [];
  const bills = billsData?.bills || [];
  // Payments go out of money accounts only: bank, cash or M-Pesa.
  const paymentAccounts = accountsData?.accounts?.filter((a: any) => a.isBankAccount && a.isActive !== false) || [];
  const approvalThreshold = activeCompany?.approvalThresholdCents ?? null;
  const needsApproval = (bill: any) =>
    approvalThreshold != null && bill.status !== 'VOID' && !bill.approvedAt && Number(bill.totalCents || 0) >= approvalThreshold;

  const isAllVendorsSelected = vendors.length > 0 && selectedVendorIds.length === vendors.length;

  const vendorName = (id: string) => vendors.find((v: any) => v.id === id)?.displayName;
  const unpaidBills = bills.filter((b: any) => Number(b.amountDueCents || 0) > 0 && b.status !== 'VOID');
  const awaitingApproval = unpaidBills.filter(needsApproval);
  const openBills = unpaidBills.filter((b: any) => !needsApproval(b));
  const openBillsTotal = openBills.reduce((sum: number, b: any) => sum + (b.amountDueCents || 0), 0);
  const vendorsTotal = vendors.reduce((sum: number, v: any) => sum + (v.balance || 0), 0);
  const today = todayIn(activeCompany?.timeZone);
  const overdueBills = bills.filter((bill: any) => Number(bill.amountDueCents || 0) > 0 && bill.status !== 'VOID' && !!bill.dueDate && bill.dueDate < today);
  const notDueBills = bills.filter((bill: any) => Number(bill.amountDueCents || 0) > 0 && bill.status !== 'VOID' && !overdueBills.includes(bill));
  const paidBills = bills.filter((bill: any) => bill.status === 'PAID');
  const shownBills = billFilter === 'OVERDUE' ? overdueBills : billFilter === 'NOT_DUE' ? notDueBills : billFilter === 'PAID' ? paidBills : bills;
  const shownBillsTotal = shownBills.reduce((sum: number, bill: any) => sum + Number(bill.totalCents || 0), 0);
  const billStanding = (bill: any) => {
    if (bill.status === 'VOID') return <Mark kind="query" label="Void" />;
    if (bill.status === 'PAID') return <Mark kind="tick" label="Paid" />;
    if (needsApproval(bill)) return <Mark kind="query" label="Needs approval" />;
    if (bill.status === 'OVERDUE' || (bill.dueDate && bill.dueDate < today)) return <Mark kind="circled" label="Overdue" />;
    return <Mark kind="query" label={bill.dueDate ? 'Not due' : 'To pay'} />;
  };
  const billColumns: DataColumn<any>[] = [
    { id: 'bill', label: 'Bill', value: (bill) => bill.billNo || '', render: (bill) => <span className="font-medium text-text">{bill.billNo}{bill.supplierReference && <span className="block text-xs font-normal text-text-2">{bill.supplierReference}</span>}</span> },
    { id: 'vendor', label: 'Vendor', value: (bill) => vendorName(bill.vendorId) || '', render: (bill) => <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedEntity({ type: 'BILL', id: bill.id, data: bill }); }} className="text-left font-medium text-text hover:text-primary-ink">{vendorName(bill.vendorId) || 'Vendor not found'}</button> },
    { id: 'dated', label: 'Dated', value: (bill) => bill.billDate || '', render: (bill) => format(new Date(bill.billDate), 'dd/MM/yyyy') },
    { id: 'standing', label: 'Standing', value: (bill) => bill.status || '', render: billStanding },
    { id: 'total', label: baseCurrency, value: (bill) => Number(bill.totalCents || 0), render: (bill) => <Amount cents={bill.totalCents || 0} currency={baseCurrency} />, numeric: true },
  ];
  const skeleton = (label: string) => (
    <div aria-busy="true" aria-label={label} className="mt-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 border-b border-feint flex items-center gap-6">
          <div className="h-3 w-20 bg-paper-200" />
          <div className="h-3 flex-1 bg-paper-200" />
          <div className="h-3 w-24 bg-paper-200" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="pb-16 space-y-5">
      <PageHeading
        tourId="bills-overview"
        title="Bills and expenses"
        note={<>What the business owes its suppliers · Figures in {baseCurrency}</>}
        actions={
          <>
            {activeTab === 'Vendors' && (
              <button type="button" onClick={() => setIsImportingVendors(true)} className={buttonClass.secondary}>
                Import from a spreadsheet
              </button>
            )}
            <button type="button" onClick={() => setIsCreatingVendor(true)} className={buttonClass.secondary}>
              Add vendor
            </button>
            {activeTab === 'Expenses' ? (
              <button type="button" onClick={() => setIsRecordingExpense(true)} className={buttonClass.primary}>
                New expense
              </button>
            ) : activeTab === 'Recurring bills' ? (
              <button type="button" onClick={() => setIsScheduling(true)} className={buttonClass.primary}>
                New recurring bill
              </button>
            ) : activeTab === 'Purchase orders' ? (
              <button type="button" onClick={() => setIsOrdering(true)} className={buttonClass.primary}>
                New purchase order
              </button>
            ) : activeTab === 'Supplier credits' ? (
              <button type="button" onClick={() => setIsRecordingCredit(true)} className={buttonClass.primary}>
                New supplier credit
              </button>
            ) : (
              <button type="button" onClick={() => setIsCreatingBill(true)} className={buttonClass.primary}>
                New bill
              </button>
            )}
          </>
        }
      />

      {importNotice && <p role="status" className="text-[13.5px] text-ink-900">{importNotice}</p>}

      <IndexTabs
        label="Bills and expenses"
        active={activeTab}
        onChange={(tab) => {
          setActiveTab(tab);
          setSelectedBillIds([]);
          setSelectedVendorIds([]);
        }}
        tabs={tabs.map((tab) => ({
          id: tab,
          name: tab,
          count: tab === 'Bills' ? bills.length : tab === 'Vendors' ? vendors.length : undefined,
        }))}
      />

      {activeTab === 'Bills' && (
        billsLoading ? skeleton('Loading bills') : bills.length === 0 ? (
          <div className="py-6 max-w-xl text-[14px] text-graphite-600">
            <p>No bills yet. Each supplier bill is listed here with its due date and standing, the total owed carried to the foot.</p>
            <button type="button" onClick={() => setIsCreatingBill(true)} className={`${buttonClass.quiet} mt-2`}>Enter the first bill</button>
          </div>
        ) : (
          <>
            <MoneyBar label="Bill money" active={billFilter} onChange={setBillFilter} currency={baseCurrency} segments={[
              { id: 'OVERDUE', label: 'Overdue', count: overdueBills.length, cents: overdueBills.reduce((sum: number, bill: any) => sum + Number(bill.amountDueCents || 0), 0), color: 'var(--warning)' },
              { id: 'NOT_DUE', label: 'Not due', count: notDueBills.length, cents: notDueBills.reduce((sum: number, bill: any) => sum + Number(bill.amountDueCents || 0), 0), color: 'var(--chart-expense)' },
              { id: 'PAID', label: 'Paid', count: paidBills.length, cents: paidBills.reduce((sum: number, bill: any) => sum + Number(bill.totalCents || 0), 0), color: 'var(--positive)' },
            ]} />
            <ul className="sm:hidden" aria-label={`Bills, figures in ${baseCurrency}`}>
              {shownBills.length === 0 && <li className="py-6 text-sm text-text-2">No bills match this filter. Choose All to see every bill.</li>}
              {shownBills.map((bill: any) => (
                <li key={bill.id} className="border-b border-feint py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <button type="button" onClick={() => setSelectedEntity({ type: 'BILL', id: bill.id, data: bill })} className="min-w-0 truncate text-left text-[14.5px] text-ink-900 hover:underline underline-offset-[3px]">
                      {vendorName(bill.vendorId) || 'Vendor not found'}
                    </button>
                    <Amount cents={bill.totalCents || 0} currency={baseCurrency} className="shrink-0" />
                  </div>
                  <p className="mt-1 text-[12.5px] text-graphite-600">{bill.billNo}{bill.supplierReference ? ` · ${bill.supplierReference}` : ''} · {format(new Date(bill.billDate), 'dd/MM/yyyy')}</p>
                  <div className="mt-1.5">{billStanding(bill)}</div>
                  <label className="mt-1 inline-flex min-h-11 items-center gap-2 text-xs text-text-2"><input type="checkbox" aria-label={`Select bill ${bill.billNo}`} checked={selectedBillIds.includes(bill.id)} onChange={() => setSelectedBillIds((current) => current.includes(bill.id) ? current.filter((id) => id !== bill.id) : [...current, bill.id])} />Select</label>
                </li>
              ))}
              <li className="ll-total mt-px flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
                <span className="font-semibold text-ink-900">Total of {shownBills.length} bills</span>
                <Amount cents={shownBillsTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
              </li>
            </ul>
            <div className="hidden sm:block">
              <DataTable
                records={shownBills}
                columns={billColumns}
                caption={`Bills, figures in ${baseCurrency}`}
                onOpen={(bill) => setSelectedEntity({ type: 'BILL', id: bill.id, data: bill })}
                openLabel={(bill) => `Open bill ${bill.billNo}`}
                selectedIds={selectedBillIds}
                onSelectionChange={setSelectedBillIds}
                selectAllLabel="Select all bills"
                selectRowLabel={(bill) => `Select bill ${bill.billNo}`}
                rowActions={(bill) => <button type="button" onClick={() => setSelectedEntity({ type: 'BILL', id: bill.id, data: bill })} className={buttonClass.quiet}>Open</button>}
              />
              <div className="flex items-baseline justify-between gap-4 px-4 py-3 text-[13px]">
                <span className="font-semibold text-text">Total of {shownBills.length} bills</span>
                <Amount cents={shownBillsTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
              </div>
            </div>          </>
        )
      )}

      {activeTab === 'Vendors' && (
        vendorsLoading ? skeleton('Loading vendors') : vendors.length === 0 ? (
          <div className="py-6 max-w-xl text-[14px] text-graphite-600">
            <p>No vendors yet. Suppliers are listed here with their KRA PIN and what the business owes each one.</p>
            <button type="button" onClick={() => setIsCreatingVendor(true)} className={`${buttonClass.quiet} mt-2`}>Add the first vendor</button>
          </div>
        ) : (
          <>
            <ul className="sm:hidden" aria-label={`Vendors, figures in ${baseCurrency}`}>
              {vendors.map((vendor: any) => (
                <li key={vendor.id} className="border-b border-feint py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <button type="button" onClick={() => setSelectedEntity({ type: 'VENDOR', id: vendor.id, data: vendor })} className="min-w-0 truncate text-left text-[14.5px] text-ink-900 hover:underline underline-offset-[3px]">
                      {vendor.displayName}
                    </button>
                    <Amount cents={vendor.balance || 0} currency={baseCurrency} className="shrink-0" />
                  </div>
                  <p className="mt-1 text-[12.5px] text-graphite-600">{[vendor.kraPin && `PIN ${vendor.kraPin}`, vendor.email].filter(Boolean).join(' · ') || 'No PIN or email recorded'}</p>
                </li>
              ))}
              <li className="ll-total mt-px flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
                <span className="font-semibold text-ink-900">Owed to {vendors.length} vendors</span>
                <Amount cents={vendorsTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
              </li>
            </ul>
            <div className="hidden sm:block relative overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">Vendors and open balances, figures in {baseCurrency}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-8 pr-2 text-left">
                      <input
                        type="checkbox"
                        aria-label="Select all vendors"
                        checked={isAllVendorsSelected}
                        onChange={(e) => setSelectedVendorIds(e.target.checked ? vendors.map((v: any) => v.id) : [])}
                        className="h-4 w-4"
                      />
                    </th>
                    <th scope="col" className="pr-4 text-left">Vendor</th>
                    <th scope="col" className="pr-4 text-left">KRA PIN</th>
                    <th scope="col" className="pr-4 text-left">Email</th>
                    <th scope="col" className="text-right">Owed, {baseCurrency}</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((vendor: any) => (
                    <tr key={vendor.id} onClick={() => setSelectedEntity({ type: 'VENDOR', id: vendor.id, data: vendor })} className="cursor-pointer">
                      <td className="w-8 pr-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${vendor.displayName}`}
                          checked={selectedVendorIds.includes(vendor.id)}
                          onChange={() =>
                            setSelectedVendorIds((prev) => (prev.includes(vendor.id) ? prev.filter((id) => id !== vendor.id) : [...prev, vendor.id]))
                          }
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="pr-4">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEntity({ type: 'VENDOR', id: vendor.id, data: vendor });
                          }}
                          className="text-left text-ink-900 hover:underline underline-offset-[3px]"
                        >
                          {vendor.displayName}
                        </button>
                      </td>
                      <td className="pr-4 whitespace-nowrap text-graphite-600">{vendor.kraPin || '–'}</td>
                      <td className="pr-4 text-graphite-600">{vendor.email || '–'}</td>
                      <td className="text-right whitespace-nowrap"><Amount cents={vendor.balance || 0} currency={baseCurrency} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={4} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">Owed to {vendors.length} vendors</th>
                    <td className="ll-total py-2 text-right whitespace-nowrap"><Amount cents={vendorsTotal} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )
      )}

      {activeTab === 'Expenses' && (
        <div className="space-y-4">
          <div className="max-w-2xl space-y-2">
            <p className="text-[14px] leading-relaxed text-ink-900">
              A purchase paid on the spot, by cash, card or M-Pesa, is an expense: it posts against the account it was paid from, with nothing left owing. Take a photo of the receipt and the supplier, amount and date are read from it for you to check.
            </p>
            {!activeCompany?.aiEnabled && (
              <p className="text-[13px] text-graphite-600">
                Reading receipts sends the photo to Google Gemini, so it is off until an owner or admin turns on AI features in Settings, Closing and controls.
              </p>
            )}
            <button type="button" onClick={() => setIsScanningReceipt(true)} disabled={!activeCompany?.aiEnabled} className={buttonClass.secondary}>
              Read a receipt
            </button>
          </div>
          <CashTransactionsPanel kind="EXPENSE" onCreate={() => setIsRecordingExpense(true)} />
        </div>
      )}

      {activeTab === 'Recurring bills' && (
        <RecurringPanel kind="BILL" isCreating={isScheduling} onCreatingChange={setIsScheduling} />
      )}

      {activeTab === 'Purchase orders' && (
        <PurchaseOrdersPanel isCreating={isOrdering} onCreatingChange={setIsOrdering} />
      )}

      {activeTab === 'Supplier credits' && (
        <CreditsPanel kind="SUPPLIER" onCreate={() => setIsRecordingCredit(true)} />
      )}

      {activeTab === 'Bill payments' && (
        <div className="max-w-2xl space-y-4">
          <p className="text-[14px] leading-relaxed text-ink-900">
            Once suppliers have been paid outside Ledger Link, record it here. Each open bill is posted as paid: accounts payable is debited and cash credited.
          </p>
          <p className="text-[13px] text-graphite-600">No money moves. Ledger Link is not connected to M-Pesa or a bank.</p>
          {awaitingApproval.length > 0 && (
            <p className="text-[13.5px] text-ink-900">
              {awaitingApproval.length} {awaitingApproval.length === 1 ? 'bill is' : 'bills are'} over the approval limit and waiting for an owner or admin who did not enter {awaitingApproval.length === 1 ? 'it' : 'them'} to approve. Open a bill to approve it.
            </p>
          )}
          {openBills.length === 0 ? (
            <p className="text-[14px]">
              <Mark kind="tick" label={awaitingApproval.length ? 'No other open bills.' : 'No open bills.'} />
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-4 border-y border-feint-strong py-2.5 text-[14px]">
                <span className="text-ink-900">
                  {openBills.length} open {openBills.length === 1 ? 'bill' : 'bills'}
                </span>
                <Amount cents={openBillsTotal} currency={baseCurrency} tone="ink" />
              </div>
              <Field label="Pay from" hint={paymentAccounts.length === 0 ? 'Mark a bank, cash or M-Pesa account as holding money (Accounting, Edit) before posting payments.' : undefined}>
                <select value={batchPaymentAccountId} onChange={(event) => setBatchPaymentAccountId(event.target.value)}>
                  <option value="">Choose an account</option>
                  {paymentAccounts.map((account: any) => (
                    <option key={account.id} value={account.id}>{account.code} · {account.name}</option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                onClick={() => {
                  confirm(
                    {
                      title: 'Post payments',
                      message: `Post payment for ${openBills.length} open bill(s)? This writes entries to the ledger.`,
                      confirmText: 'Post',
                    },
                    () => batchPaymentMutation.mutate({ targetBills: openBills, sourceAccountId: batchPaymentAccountId })
                  );
                }}
                disabled={batchPaymentMutation.isPending || !batchPaymentAccountId}
                className={buttonClass.secondary}
              >
                {batchPaymentMutation.isPending ? 'Posting' : 'Post these payments'}
              </button>
              {batchPaymentMutation.isError && (
                <p role="alert" className="text-[13px] text-ledger-red">
                  {(batchPaymentMutation.error as Error).message}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'Bills' && (
        <BulkActionBar
          selectedCount={selectedBillIds.length}
          totalCount={bills.length}
          entityName="bills"
          onClearSelection={() => setSelectedBillIds([])}
          onDelete={() => {
            confirm(
              { title: 'Void bills', message: `Void ${selectedBillIds.length} bill(s)? Each is reversed in the ledger with an entry dated today. Bills with payments are refused.`, confirmText: 'Void', isDestructive: true },
              () => bulkDeleteBillsMutation.mutate(selectedBillIds)
            );
          }}
          isLoading={bulkDeleteBillsMutation.isPending}
        />
      )}
      {bulkDeleteBillsMutation.error && (
        <p role="alert" className="text-[13.5px] text-ledger-red">{bulkDeleteBillsMutation.error.message}</p>
      )}

      {activeTab === 'Vendors' && (
        <BulkActionBar
          selectedCount={selectedVendorIds.length}
          totalCount={vendors.length}
          entityName="vendors"
          onClearSelection={() => setSelectedVendorIds([])}
          onDelete={() => {
            confirm(
              { title: 'Delete vendors', message: `Delete ${selectedVendorIds.length} vendor(s)?`, confirmText: 'Delete', isDestructive: true },
              () => bulkDeleteVendorsMutation.mutate(selectedVendorIds)
            );
          }}
          isLoading={bulkDeleteVendorsMutation.isPending}
        />
      )}

      <DynamicQuickAddModal isOpen={isCreatingVendor} onClose={() => setIsCreatingVendor(false)} overrideType="VENDOR" />

      {selectedEntity && (
        <EntityDrillDownModal
          isOpen={!!selectedEntity}
          onClose={() => setSelectedEntity(null)}
          entityType={selectedEntity.type}
          entityId={selectedEntity.id}
          initialData={selectedEntity.data}
        />
      )}

      {isScanningReceipt && (
        <ReceiptScanner
          onClose={() => setIsScanningReceipt(false)}
          onScanComplete={(data) => {
            // A receipt is a purchase already paid: it opens as an expense.
            setScannedData(data);
            setIsScanningReceipt(false);
            setIsRecordingExpense(true);
          }}
        />
      )}

      <BillBuilder open={isCreatingBill} onClose={closeBill} />
      <ImportRecordsDialog target="vendors" open={isImportingVendors} onClose={() => setIsImportingVendors(false)} onDone={setImportNotice} />
      <BillBuilder mode="credit" open={isRecordingCredit} onClose={() => setIsRecordingCredit(false)} />
      <BillBuilder
        mode="expense"
        open={isRecordingExpense}
        onClose={() => { setIsRecordingExpense(false); setScannedData(null); }}
        scanned={scannedData}
      />

      {confirmDialog}
    </div>
  );
}
