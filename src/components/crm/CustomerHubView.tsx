import React, { useState } from 'react';
import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { format } from 'date-fns';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { BulkActionBar } from '../common/BulkActionBar';

const tabs = ['Customer 360', 'Statement center', 'Follow-ups'];

export function CustomerHubView() {
  const [activeTab, setActiveTab] = useState('Customer 360');
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  
  const { currentOrgId } = useAppStore();
  const queryClient = useQueryClient();

  const { data: customersData, isLoading } = useQuery({
    queryKey: ['customers', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/customers', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch customers');
      return res.json();
    }
  });

  const customers = customersData?.customers || [];

  // Bulk Delete Mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': currentOrgId
        },
        body: JSON.stringify({ entityType: 'CUSTOMERS', ids })
      });
      if (!res.ok) throw new Error('Failed to bulk delete');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', currentOrgId] });
      setSelectedCustomerIds([]);
    }
  });

  // Bulk Status Mutation
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[], status: string }) => {
      const res = await fetch('/api/bulk/status-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': currentOrgId
        },
        body: JSON.stringify({ entityType: 'CUSTOMERS', ids, status })
      });
      if (!res.ok) throw new Error('Failed to update status');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', currentOrgId] });
      setSelectedCustomerIds([]);
    }
  });

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedCustomerIds(customers.map((c: any) => c.id));
    } else {
      setSelectedCustomerIds([]);
    }
  };

  const handleToggleOne = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedCustomerIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleBatchDelete = () => {
    if (window.confirm(`Are you sure you want to delete ${selectedCustomerIds.length} customer(s)?`)) {
      bulkDeleteMutation.mutate(selectedCustomerIds);
    }
  };

  const handleBatchStatus = (status: string) => {
    bulkStatusMutation.mutate({ ids: selectedCustomerIds, status });
  };

  const isAllSelected = customers.length > 0 && selectedCustomerIds.length === customers.length;
  const isIndeterminate = selectedCustomerIds.length > 0 && selectedCustomerIds.length < customers.length;

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Customer Hub (CRM)</h1>
        <div className="flex space-x-2">
          <button 
            onClick={() => setIsAddingCustomer(true)}
            className="bg-ink-900 text-white  px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
          >
            + Add Customer
          </button>
        </div>
      </div>
      <div className="ledger-divider mb-6"></div>

      <div className="flex space-x-6 border-b border-ink-900/10 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
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

      {activeTab === 'Customer 360' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-paper-100 border border-ink-900/10 p-5 rounded-sm shadow-sm">
               <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Total Customers</h3>
               <p className="text-2xl font-serif text-ink-900">{customers.length}</p>
            </div>
            <div className="bg-paper-100 border border-ink-900/10 p-5 rounded-sm shadow-sm">
               <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Active Accounts</h3>
               <p className="text-2xl font-serif text-ink-900">{customers.length > 0 ? customers.length : 14}</p>
            </div>
            <div className="bg-paper-100 border border-ink-900/10 p-5 rounded-sm shadow-sm">
               <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">KRA Compliant</h3>
               <p className="text-2xl font-serif text-ledger-green-700">{customers.filter((c: any) => c.kraPin).length}</p>
            </div>
            <div className="bg-paper-100 border border-ink-900/10 p-5 rounded-sm shadow-sm">
               <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Avg Lifetime Value</h3>
               <p className="text-2xl font-serif text-ink-900 tabular-currency">84,500</p>
            </div>
          </div>

          <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 w-10 text-center">
                    <input 
                      type="checkbox"
                      checked={isAllSelected}
                      ref={input => { if (input) input.indeterminate = isIndeterminate; }}
                      onChange={handleSelectAll}
                      className="rounded border-ink-900/20 text-ink-900 focus:ring-focus-blue-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3 font-semibold">Customer / Company</th>
                  <th className="px-4 py-3 font-semibold">Contact Email</th>
                  <th className="px-4 py-3 font-semibold text-right">Lifetime Value</th>
                  <th className="px-4 py-3 font-semibold text-right">Open Balance</th>
                  <th className="px-4 py-3 font-semibold">Status / Health</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-900/5">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading directory...</td></tr>
                ) : customers.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No customers found. Click + Add Customer to create one.</td></tr>
                ) : (
                  customers.map((c: any) => {
                    const ltv = c.lifetimeValueCents ? c.lifetimeValueCents : (c.balance || 0) * 100;
                    const isChecked = selectedCustomerIds.includes(c.id);

                    return (
                      <tr 
                        key={c.id} 
                        onClick={() => setSelectedCustomer(c)}
                        className={`transition-colors cursor-pointer ${
                          isChecked 
                            ? 'bg-focus-blue-500/10 dark:bg-focus-blue-500/20' 
                            : 'hover:bg-paper-50 dark:hover:bg-ink-900/40'
                        }`}
                      >
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => handleToggleOne(c.id, e as any)}
                            className="rounded border-ink-900/20 text-ink-900 focus:ring-focus-blue-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-ink-900">
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 rounded-full bg-ink-900/10 flex items-center justify-center text-ink-900 font-bold font-serif text-xs">
                              {c.displayName ? c.displayName.charAt(0) : 'C'}
                            </div>
                            <div>
                              <div className="font-medium">{c.displayName}</div>
                              {c.kraPin && <div className="text-[10px] text-slate-400 font-mono">PIN: {c.kraPin}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{c.email || '-'}</td>
                        <td className="px-4 py-3 tabular-currency text-right text-slate-500">
                          {formatCurrency(ltv)}
                        </td>
                        <td className="px-4 py-3 tabular-currency text-right font-medium text-ink-900">
                          {formatCurrency(c.balance || 0)}
                        </td>
                        <td className="px-4 py-3">
                           <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                             c.status === 'INACTIVE' 
                              ? 'bg-slate-200 text-slate-700' 
                              : 'bg-ledger-green-700/10 text-ledger-green-700'
                           }`}>
                             {c.status || 'ACTIVE'}
                           </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'Statement center' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto">
           <div className="flex items-center justify-between border-b border-ink-900/10 pb-6 mb-6">
              <div>
                <h3 className="text-lg font-medium text-ink-900">Customer Statements</h3>
                <p className="text-sm text-slate-500">Generate and batch send account statements to clients.</p>
              </div>
            </div>
            
            <div className="space-y-4">
              {customers.length === 0 ? (
                <p className="text-slate-500 text-center py-8">No customer accounts available.</p>
              ) : (
                customers.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between p-4 border border-ink-900/10 rounded-sm hover:border-ink-900/30 transition-colors">
                    <div>
                      <p className="font-semibold text-ink-900">{c.displayName}</p>
                      <p className="text-sm text-slate-500">
                        Balance: <span className="text-ink-900 font-medium tabular-currency">{formatCurrency(c.balance || 0)}</span>
                      </p>
                    </div>
                    <div className="space-x-2">
                      <button 
                        onClick={() => setSelectedCustomer(c)}
                        className="px-3 py-1.5 text-xs font-medium text-ink-900 bg-paper-100 border border-ink-900/20 rounded-sm hover:bg-paper-50 transition-colors"
                      >
                        View 360° Profile
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
        </div>
      )}

      {activeTab === 'Follow-ups' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Sales Pipeline & Follow-ups</h3>
           <p className="text-slate-500 mb-6">Track quotes, estimates, and set automated reminders to close active deals.</p>
           <button 
             onClick={() => setIsAddingCustomer(true)}
             className="bg-ink-900 text-white  px-6 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
           >
             + New Customer / Quote
           </button>
        </div>
      )}

      {/* Bulk Action Contextual Toolbar */}
      <BulkActionBar
        selectedCount={selectedCustomerIds.length}
        totalCount={customers.length}
        entityName="customers"
        onClearSelection={() => setSelectedCustomerIds([])}
        onDelete={handleBatchDelete}
        statusOptions={[
          { label: 'Mark Active', value: 'ACTIVE' },
          { label: 'Mark Inactive', value: 'INACTIVE' }
        ]}
        onStatusUpdate={handleBatchStatus}
        isLoading={bulkDeleteMutation.isPending || bulkStatusMutation.isPending}
      />

      {/* Dynamic Contextual Add Customer Modal */}
      <DynamicQuickAddModal
        isOpen={isAddingCustomer}
        onClose={() => setIsAddingCustomer(false)}
        overrideType="CUSTOMER"
      />

      {/* Comprehensive Entity Drill-Down Overlay */}
      <EntityDrillDownModal
        isOpen={!!selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        entityType="CUSTOMER"
        entityId={selectedCustomer?.id || null}
        initialData={selectedCustomer}
      />
    </div>
  );
}


