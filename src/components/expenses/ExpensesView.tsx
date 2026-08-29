import React from 'react';
import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';
import { Trash, Tag } from 'lucide-react';
import { ConfirmModal } from '../layout/ConfirmModal';
import { useState } from 'react';
import { format } from 'date-fns';
import { ReceiptScanner } from './ReceiptScanner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { BulkActionBar } from '../common/BulkActionBar';

const tabs = ['Vendors', 'Bills', 'Expenses', 'Purchase orders', 'Bill payments'];

export function ExpensesView() {
  const [activeTab, setActiveTab] = useState('Bills');
  const [isCreatingVendor, setIsCreatingVendor] = useState(false);
  const [isCreatingBill, setIsCreatingBill] = useState(false);
  const [isScanningReceipt, setIsScanningReceipt] = useState(false);
  const [scannedData, setScannedData] = useState<{ vendor: string; amount: number; date: string } | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<{ type: 'VENDOR' | 'BILL'; id: string; data: any } | null>(null);
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  
  const { currentOrgId } = useAppStore();
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
        body: JSON.stringify({ orgId: currentOrgId, ...bill })
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
      setIsCreatingBill(false);
    }
  });

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

  // Bulk Status Bills
  const bulkStatusBillsMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[], status: string }) => {
      const res = await fetch('/api/bulk/status-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ entityType: 'BILLS', ids, status })
      });
      if (!res.ok) throw new Error('Failed to update bills');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills', currentOrgId] });
      setSelectedBillIds([]);
    }
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

  const isAllBillsSelected = bills.length > 0 && selectedBillIds.length === bills.length;
  const isAllVendorsSelected = vendors.length > 0 && selectedVendorIds.length === vendors.length;

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Expenses & Bills</h1>
        <div className="space-x-3">
          <button 
            onClick={() => setIsCreatingVendor(true)}
            className="text-ink-900 bg-white dark:bg-[#111827] border border-ink-900/20 px-4 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors"
          >
            + Add Vendor
          </button>
          <button 
            onClick={() => setIsCreatingBill(true)}
            className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
          >
            Create Bill
          </button>
        </div>
      </div>
      <div className="ledger-divider mb-6"></div>

      {/* Sub-navigation */}
      <div className="flex space-x-6 border-b border-ink-900/10 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              setSelectedBillIds([]);
              setSelectedVendorIds([]);
            }}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === tab 
                ? 'border-brass-500 text-ink-900' 
                : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-ink-900/20'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Bills' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 w-10 text-center">
                  <input 
                    type="checkbox"
                    checked={isAllBillsSelected}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedBillIds(bills.map((b: any) => b.id));
                      else setSelectedBillIds([]);
                    }}
                    className="rounded border-ink-900/20 text-ink-900 focus:ring-focus-blue-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 font-semibold">Bill No.</th>
                <th className="px-4 py-3 font-semibold">Vendor</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Due Date</th>
                <th className="px-4 py-3 font-semibold text-right">Amount</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {billsLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading bills...</td></tr>
              ) : bills.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No bills found. Create one above.</td></tr>
              ) : (
                bills.map((bill: any) => {
                  const vendor = vendors.find((v: any) => v.id === bill.vendorId);
                  const isChecked = selectedBillIds.includes(bill.id);

                  return (
                    <tr 
                      key={bill.id} 
                      onClick={() => setSelectedEntity({ type: 'BILL', id: bill.id, data: bill })}
                      className={`transition-colors cursor-pointer group ${
                        isChecked ? 'bg-focus-blue-500/10 dark:bg-focus-blue-500/20' : 'hover:bg-paper-50 dark:hover:bg-ink-900/40'
                      }`}
                    >
                      <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            setSelectedBillIds(prev => 
                              prev.includes(bill.id) ? prev.filter(id => id !== bill.id) : [...prev, bill.id]
                            );
                          }}
                          className="rounded border-ink-900/20 text-ink-900 focus:ring-focus-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-ink-900">{bill.billNo}</td>
                      <td className="px-4 py-3 text-ink-900">{vendor?.displayName || 'Unknown'}</td>
                      <td className="px-4 py-3 text-slate-500">{format(new Date(bill.billDate), 'MMM d, yyyy')}</td>
                      <td className="px-4 py-3 text-slate-500">{format(new Date(bill.dueDate), 'MMM d, yyyy')}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-ink-900 font-medium">
                        {formatCurrency(bill.totalCents)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          bill.status === 'PAID' ? 'bg-ledger-green-700/10 text-ledger-green-700' : 'bg-rust-700/10 text-rust-700'
                        }`}>
                          {bill.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'Vendors' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 w-10 text-center">
                  <input 
                    type="checkbox"
                    checked={isAllVendorsSelected}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedVendorIds(vendors.map((v: any) => v.id));
                      else setSelectedVendorIds([]);
                    }}
                    className="rounded border-ink-900/20 text-ink-900 focus:ring-focus-blue-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 font-semibold">Vendor Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold text-right">Open Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {vendorsLoading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Loading vendors...</td></tr>
              ) : vendors.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No vendors found.</td></tr>
              ) : (
                vendors.map((vendor: any) => {
                  const isChecked = selectedVendorIds.includes(vendor.id);
                  return (
                    <tr 
                      key={vendor.id} 
                      onClick={() => setSelectedEntity({ type: 'VENDOR', id: vendor.id, data: vendor })}
                      className={`transition-colors cursor-pointer ${
                        isChecked ? 'bg-focus-blue-500/10 dark:bg-focus-blue-500/20' : 'hover:bg-paper-50 dark:hover:bg-ink-900/40'
                      }`}
                    >
                      <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            setSelectedVendorIds(prev => 
                              prev.includes(vendor.id) ? prev.filter(id => id !== vendor.id) : [...prev, vendor.id]
                            );
                          }}
                          className="rounded border-ink-900/20 text-ink-900 focus:ring-focus-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-ink-900">
                        <div>{vendor.displayName}</div>
                        {vendor.kraPin && <div className="text-[10px] text-slate-400 font-mono">PIN: {vendor.kraPin}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{vendor.email || '-'}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-ink-900">
                        {formatCurrency(vendor.balance || 0)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'Expenses' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Direct Expense Logging</h3>
           <p className="text-slate-500 mb-6">Quickly log cash or card expenses that don't require an A/P bill.</p>
           <button 
             onClick={() => setIsCreatingBill(true)}
             className="bg-ink-900 text-white dark:text-slate-900 px-6 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
           >
             + Record Expense
           </button>
        </div>
      )}

      {activeTab === 'Purchase orders' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Purchase Orders</h3>
           <p className="text-slate-500 mb-6">Issue POs to vendors and convert them into bills upon receipt.</p>
           <button 
             onClick={() => setIsCreatingBill(true)}
             className="bg-ink-900 text-white dark:text-slate-900 px-6 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
           >
             + Create Purchase Order
           </button>
        </div>
      )}

      {activeTab === 'Bill payments' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Batch Bill Disbursements</h3>
           <p className="text-slate-500 mb-6">Pay multiple suppliers in a single automated M-Pesa B2B or RTGS run.</p>
           <button 
             onClick={() => alert('Batch Payment Gateway Ready')}
             className="bg-ink-900 text-white dark:text-slate-900 px-6 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
           >
             Schedule Batch Run
           </button>
        </div>
      )}

      {/* Bulk Action Contextual Toolbar for Bills */}
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
          statusOptions={[
            { label: 'Mark Paid', value: 'PAID' },
            { label: 'Mark Pending', value: 'PENDING' }
          ]}
          onStatusUpdate={(status) => bulkStatusBillsMutation.mutate({ ids: selectedBillIds, status })}
          isLoading={bulkDeleteBillsMutation.isPending || bulkStatusBillsMutation.isPending}
        />
      )}

      {/* Bulk Action Contextual Toolbar for Vendors */}
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

      {/* Dynamic Contextual Add Modals */}
      <DynamicQuickAddModal
        isOpen={isCreatingVendor}
        onClose={() => setIsCreatingVendor(false)}
        overrideType="VENDOR"
      />

      <DynamicQuickAddModal
        isOpen={isCreatingBill}
        onClose={() => setIsCreatingBill(false)}
        overrideType="BILL"
      />

      {/* Comprehensive Entity Drill-Down Overlay */}
      {selectedEntity && (
        <EntityDrillDownModal
          isOpen={!!selectedEntity}
          onClose={() => setSelectedEntity(null)}
          entityType={selectedEntity.type}
          entityId={selectedEntity.id}
          initialData={selectedEntity.data}
        />
      )}

      {/* Basic Create Bill Modal */}
      {isCreatingBill && (
        <div className="fixed inset-0 bg-ink-900/20 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-[#111827] rounded-sm shadow-xl border border-ink-900/10 w-full max-w-2xl p-6">
            <h3 className="text-xl font-serif text-ink-900 mb-4">Record New Bill</h3>
            {createBillMutation.isError && (
              <div className="mb-4 p-3 bg-rust-700/10 border border-rust-700/20 text-rust-700 text-sm rounded-sm">
                {createBillMutation.error.message}
              </div>
            )}
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              createBillMutation.mutate({
                vendorId: fd.get('vendorId'),
                billDate: fd.get('billDate'),
                dueDate: fd.get('dueDate'),
                lines: [{
                  description: fd.get('description'),
                  accountId: fd.get('accountId'),
                  amountCents: Math.round(parseFloat(fd.get('amount') as string) * 100)
                }]
              });
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Vendor *</label>
                  <select required name="vendorId" className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none">
                    <option value="">Select a vendor...</option>
                    {vendors.map((v: any) => (
                      <option key={v.id} value={v.id}>{v.displayName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Expense Account *</label>
                  <select required name="accountId" className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none">
                    <option value="">Select expense category...</option>
                    {expenseAccounts.map((a: any) => (
                      <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Bill Date *</label>
                  <input required name="billDate" type="date" defaultValue={scannedData?.date || format(new Date(), 'yyyy-MM-dd')} className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Due Date *</label>
                  <input required name="dueDate" type="date" defaultValue={format(new Date(Date.now() + 30 * 86400000), 'yyyy-MM-dd')} className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-4 items-end">
                <div className="col-span-3">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Description</label>
                  <input name="description" type="text" defaultValue={scannedData?.vendor ? `Receipt from ${scannedData.vendor}` : ''} placeholder="What was this for?" className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none" />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Amount *</label>
                  <input required name="amount" type="number" step="0.01" min="0.01" defaultValue={scannedData?.amount || ''} placeholder="0.00" className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency text-right" />
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-6 border-t border-ink-900/10 mt-6">
                <button type="button" onClick={() => { setIsCreatingBill(false); setScannedData(null); }} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-ink-900">Cancel</button>
                <button type="submit" disabled={createBillMutation.isPending} className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors disabled:opacity-50">
                  {createBillMutation.isPending ? 'Saving...' : 'Save Bill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
