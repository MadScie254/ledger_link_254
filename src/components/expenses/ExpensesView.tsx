import React from 'react';
import { useState } from 'react';
import { format } from 'date-fns';
import { ReceiptScanner } from './ReceiptScanner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { BulkActionBar } from '../common/BulkActionBar';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { PageHeading, IndexTabs, buttonClass } from '../ledger/Page';
import { Dialog, Field } from '../ledger/Dialog';
import { SUPPORTED_CURRENCIES } from '../../utils/currency';

const tabs = ['Vendors', 'Bills', 'Expenses', 'Bill payments'];

export function ExpensesView() {
  const [activeTab, setActiveTab] = useState('Bills');
  const [isCreatingVendor, setIsCreatingVendor] = useState(false);
  const [isCreatingBill, setIsCreatingBill] = useState(false);
  const [isScanningReceipt, setIsScanningReceipt] = useState(false);
  const [scannedData, setScannedData] = useState<{ vendor: string; amount: number; date: string } | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<{ type: 'VENDOR' | 'BILL'; id: string; data: any } | null>(null);
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [billIdempotencyKey, setBillIdempotencyKey] = useState(() => crypto.randomUUID());
  const [batchPaymentAccountId, setBatchPaymentAccountId] = useState('');
  
  const { currentOrgId, activeCompany, exchangeRates } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const [billCurrency, setBillCurrency] = useState(baseCurrency);
  const [billExchangeRate, setBillExchangeRate] = useState('1');
  const queryClient = useQueryClient();

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

  const createBillMutation = useMutation({
    mutationFn: async (bill: any) => {
      const res = await fetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ ...bill, idempotencyKey: billIdempotencyKey })
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create bill');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
      closeBill();
    }
  });

  function closeBill() {
    setIsCreatingBill(false);
    setScannedData(null);
    createBillMutation.reset();
    setBillIdempotencyKey(crypto.randomUUID());
    setBillCurrency(baseCurrency);
    setBillExchangeRate('1');
  }

  // Bulk Delete Bills
  const bulkDeleteBillsMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ entityType: 'BILLS', ids })
      });
      if (!res.ok) throw new Error('Failed to delete bills');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills', currentOrgId] });
      setSelectedBillIds([]);
    }
  });

  const batchPaymentMutation = useMutation({
    mutationFn: async ({ targetBills, sourceAccountId }: { targetBills: any[]; sourceAccountId: string }) => {
      const paymentDate = format(new Date(), 'yyyy-MM-dd');
      const res = await fetch('/api/bills/batch-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({
          payments: targetBills.map((bill) => ({
            billId: bill.id,
            amountCents: bill.amountDueCents,
            paymentDate,
            sourceAccountId,
            idempotencyKey: crypto.randomUUID(),
          })),
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to record bill payments');
      if (body.failed > 0) throw new Error(`${body.paid} payment(s) posted; ${body.failed} failed. Refresh and review the open bills.`);
      return body;
    },
    onSuccess: () => {
      setSelectedBillIds([]);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['bills', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
    },
  });

  // Bulk Delete Vendors
  const bulkDeleteVendorsMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ entityType: 'VENDORS', ids })
      });
      if (!res.ok) throw new Error('Failed to delete vendors');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors', currentOrgId] });
      setSelectedVendorIds([]);
    }
  });

  const vendors = vendorsData?.vendors || [];
  const bills = billsData?.bills || [];
  const expenseAccounts = accountsData?.accounts?.filter((a: any) => a.type === 'EXPENSE' || a.type === 'COGS') || [];
  const paymentAccounts = accountsData?.accounts?.filter((a: any) => a.type === 'ASSET' && a.isActive !== false) || [];

  const isAllBillsSelected = bills.length > 0 && selectedBillIds.length === bills.length;
  const isAllVendorsSelected = vendors.length > 0 && selectedVendorIds.length === vendors.length;

  const vendorName = (id: string) => vendors.find((v: any) => v.id === id)?.displayName;
  const openBills = bills.filter((b: any) => Number(b.amountDueCents || 0) > 0 && b.status !== 'VOID');
  const openBillsTotal = openBills.reduce((sum: number, b: any) => sum + (b.amountDueCents || 0), 0);
  const scannedVendorId = vendors.find((v: any) => v.displayName === scannedData?.vendor)?.id || '';
  const scannedVendorUnknown = !!scannedData?.vendor && !scannedVendorId;
  const billsTotal = bills.reduce((sum: number, b: any) => sum + (b.totalCents || 0), 0);
  const vendorsTotal = vendors.reduce((sum: number, v: any) => sum + (v.balance || 0), 0);
  const today = new Date();
  const billStanding = (bill: any) => {
    if (bill.status === 'PAID') return <Mark kind="tick" label="Paid" />;
    if (bill.status === 'OVERDUE' || (bill.dueDate && new Date(bill.dueDate) < today)) return <Mark kind="circled" label="Overdue" />;
    return <Mark kind="query" label={bill.dueDate ? `Due ${format(new Date(bill.dueDate), 'dd/MM/yyyy')}` : 'To pay'} />;
  };
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
        title="Bills and expenses"
        note={<>What the business owes its suppliers · Figures in {baseCurrency}</>}
        actions={
          <>
            <button type="button" onClick={() => setIsCreatingVendor(true)} className={buttonClass.secondary}>
              Add vendor
            </button>
            <button type="button" onClick={() => setIsCreatingBill(true)} className={buttonClass.primary}>
              New bill
            </button>
          </>
        }
      />

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
          name: tab === 'Expenses' ? 'Receipts' : tab,
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
            <ul className="sm:hidden" aria-label={`Bills, figures in ${baseCurrency}`}>
              {bills.map((bill: any) => (
                <li key={bill.id} className="border-b border-feint py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <button type="button" onClick={() => setSelectedEntity({ type: 'BILL', id: bill.id, data: bill })} className="min-w-0 truncate text-left text-[14.5px] text-ink-900 hover:underline underline-offset-[3px]">
                      {vendorName(bill.vendorId) || 'Vendor not found'}
                    </button>
                    <Amount cents={bill.totalCents || 0} currency={baseCurrency} className="shrink-0" />
                  </div>
                  <p className="mt-1 text-[12.5px] text-graphite-600">{bill.billNo} · {format(new Date(bill.billDate), 'dd/MM/yyyy')}</p>
                  <div className="mt-1.5">{billStanding(bill)}</div>
                </li>
              ))}
              <li className="ll-total mt-px flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
                <span className="font-semibold text-ink-900">Total of {bills.length} bills</span>
                <Amount cents={billsTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
              </li>
            </ul>
            <div className="hidden sm:block relative overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">Bills, figures in {baseCurrency}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-8 pr-2 text-left">
                      <input
                        type="checkbox"
                        aria-label="Select all bills"
                        checked={isAllBillsSelected}
                        onChange={(e) => setSelectedBillIds(e.target.checked ? bills.map((b: any) => b.id) : [])}
                        className="h-4 w-4"
                      />
                    </th>
                    <th scope="col" className="pr-4 text-left">Bill</th>
                    <th scope="col" className="pr-4 text-left">Vendor</th>
                    <th scope="col" className="pr-4 text-left">Dated</th>
                    <th scope="col" className="pr-4 text-left">Standing</th>
                    <th scope="col" className="text-right">{baseCurrency}</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill: any) => (
                    <tr key={bill.id} onClick={() => setSelectedEntity({ type: 'BILL', id: bill.id, data: bill })} className="cursor-pointer">
                      <td className="w-8 pr-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select bill ${bill.billNo}`}
                          checked={selectedBillIds.includes(bill.id)}
                          onChange={() =>
                            setSelectedBillIds((prev) => (prev.includes(bill.id) ? prev.filter((id) => id !== bill.id) : [...prev, bill.id]))
                          }
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="pr-4 whitespace-nowrap text-graphite-600">{bill.billNo}</td>
                      <td className="pr-4">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEntity({ type: 'BILL', id: bill.id, data: bill });
                          }}
                          className="text-left text-ink-900 hover:underline underline-offset-[3px]"
                        >
                          {vendorName(bill.vendorId) || 'Vendor not found'}
                        </button>
                      </td>
                      <td className="pr-4 whitespace-nowrap text-graphite-600">{format(new Date(bill.billDate), 'dd/MM/yyyy')}</td>
                      <td className="pr-4 whitespace-nowrap">{billStanding(bill)}</td>
                      <td className="text-right whitespace-nowrap"><Amount cents={bill.totalCents || 0} currency={baseCurrency} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={5} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">Total of {bills.length} bills</th>
                    <td className="ll-total py-2 text-right whitespace-nowrap"><Amount cents={billsTotal} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
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
        <div className="max-w-2xl space-y-4">
          <p className="text-[14px] leading-relaxed text-ink-900">
            A cash or card purchase is recorded as a bill from the supplier, then marked paid. Take a photo of the receipt and the supplier, amount and date are read from it for you to check.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => setIsScanningReceipt(true)} className={buttonClass.secondary}>
              Read a receipt
            </button>
            <button type="button" onClick={() => setIsCreatingBill(true)} className={buttonClass.quiet}>
              Enter it by hand
            </button>
          </div>
        </div>
      )}

      {activeTab === 'Bill payments' && (
        <div className="max-w-2xl space-y-4">
          <p className="text-[14px] leading-relaxed text-ink-900">
            Once suppliers have been paid outside Ledger Link, record it here. Each open bill is posted as paid: accounts payable is debited and cash credited.
          </p>
          <p className="text-[13px] text-graphite-600">No money moves. Ledger Link is not connected to M-Pesa or a bank.</p>
          {openBills.length === 0 ? (
            <p className="text-[14px]">
              <Mark kind="tick" label="No open bills." />
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-4 border-y border-feint-strong py-2.5 text-[14px]">
                <span className="text-ink-900">
                  {openBills.length} open {openBills.length === 1 ? 'bill' : 'bills'}
                </span>
                <Amount cents={openBillsTotal} currency={baseCurrency} tone="ink" />
              </div>
              <Field label="Pay from" hint={paymentAccounts.length === 0 ? 'Add an active cash or bank asset account before posting payments.' : undefined}>
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
                  if (window.confirm(`Post payment for ${openBills.length} open bill(s)? This writes entries to the ledger.`)) {
                    batchPaymentMutation.mutate({ targetBills: openBills, sourceAccountId: batchPaymentAccountId });
                  }
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
            if (window.confirm(`Delete ${selectedBillIds.length} bill(s)?`)) {
              bulkDeleteBillsMutation.mutate(selectedBillIds);
            }
          }}
          isLoading={bulkDeleteBillsMutation.isPending}
        />
      )}

      {activeTab === 'Vendors' && (
        <BulkActionBar
          selectedCount={selectedVendorIds.length}
          totalCount={vendors.length}
          entityName="vendors"
          onClearSelection={() => setSelectedVendorIds([])}
          onDelete={() => {
            if (window.confirm(`Delete ${selectedVendorIds.length} vendor(s)?`)) {
              bulkDeleteVendorsMutation.mutate(selectedVendorIds);
            }
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
            setScannedData(data);
            setIsScanningReceipt(false);
            setIsCreatingBill(true);
          }}
        />
      )}

      <Dialog
        open={isCreatingBill}
        onClose={closeBill}
        width="lg"
        title={scannedData ? 'Check the receipt' : 'New bill'}
        note={scannedData ? 'Read from the photo. Correct anything misread before saving.' : 'Saving it posts the expense and the amount owed to the supplier.'}
        footer={
          <>
            {createBillMutation.isError && (
              <p role="alert" className="mr-auto text-[13px] text-ledger-red">
                {createBillMutation.error.message}
              </p>
            )}
            <button type="button" onClick={closeBill} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" form="bill-form" disabled={createBillMutation.isPending} className={buttonClass.primary}>
              {createBillMutation.isPending ? 'Saving' : 'Save bill'}
            </button>
          </>
        }
      >
        <form
          id="bill-form"
          key={scannedData ? `scan-${scannedData.date}-${scannedData.amount}` : 'manual'}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const amountCents = Math.round(parseFloat(fd.get('amount') as string) * 100);
            const taxRate = Number(fd.get('taxRate')) || 0;
            const exchangeRate = Number(billExchangeRate);
            const isForeign = billCurrency !== baseCurrency;
            const baseAmountCents = isForeign ? Math.round(amountCents / exchangeRate) : amountCents;
            createBillMutation.mutate({
              vendorId: fd.get('vendorId'),
              billDate: fd.get('billDate'),
              dueDate: fd.get('dueDate'),
              currency: billCurrency,
              exchangeRate,
              lines: [{
                description: fd.get('description'),
                accountId: fd.get('accountId'),
                amountCents: baseAmountCents,
                foreignAmountCents: isForeign ? amountCents : undefined,
                taxCents: Math.round(baseAmountCents * taxRate / 100),
              }],
            });
          }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <Field label="Supplier" hint={scannedVendorUnknown ? `The receipt names ${scannedData?.vendor}. Add them as a vendor if they are new.` : undefined}>
            <select required name="vendorId" defaultValue={scannedVendorId}>
              <option value="">Choose a vendor</option>
              {vendors.map((v: any) => (
                <option key={v.id} value={v.id}>{v.displayName}</option>
              ))}
            </select>
          </Field>
          <Field label="Expense account">
            <select required name="accountId" defaultValue="">
              <option value="">Choose an account</option>
              {expenseAccounts.map((a: any) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Bill date">
            <input required name="billDate" type="date" defaultValue={scannedData?.date || format(new Date(), 'yyyy-MM-dd')} />
          </Field>
          <Field label="Due">
            <input required name="dueDate" type="date" defaultValue={format(new Date(Date.now() + 30 * 86400000), 'yyyy-MM-dd')} />
          </Field>
          <Field label="Currency">
            <select
              value={billCurrency}
              onChange={(event) => {
                const next = event.target.value;
                setBillCurrency(next);
                setBillExchangeRate(next === baseCurrency ? '1' : String(exchangeRates[next] || 1));
              }}
            >
              {SUPPORTED_CURRENCIES.map((currency) => (
                <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>
              ))}
            </select>
          </Field>
          {billCurrency !== baseCurrency && (
            <Field label={`${billCurrency} per 1 ${baseCurrency}`}>
              <input
                required
                type="number"
                min="0.00000001"
                step="any"
                inputMode="decimal"
                value={billExchangeRate}
                onChange={(event) => setBillExchangeRate(event.target.value)}
                className="text-right tabular-currency"
              />
            </Field>
          )}
          <Field label="Particulars">
            <input required name="description" type="text" defaultValue={scannedData?.vendor ? `Receipt from ${scannedData.vendor}` : ''} />
          </Field>
          <Field label={`Amount (${billCurrency})`}>
            <input required name="amount" type="number" step="0.01" min="0.01" inputMode="decimal" defaultValue={scannedData?.amount || ''} className="text-right tabular-currency text-ink-blue" />
          </Field>
          <Field label="VAT percentage" hint="Enter zero for exempt or non-taxable purchases.">
            <input required name="taxRate" type="number" step="0.01" min="0" max="100" inputMode="decimal" defaultValue="0" className="text-right tabular-currency" />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
