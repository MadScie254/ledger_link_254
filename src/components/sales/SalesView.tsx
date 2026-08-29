import React, { useState } from 'react';
import { formatCurrency, formatCurrencyFromFloat, SUPPORTED_CURRENCIES } from '../../utils/currency';
import { useRenderTracker } from '../../utils/monitoring';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Download, Trash, Tag, Globe } from 'lucide-react';
import { ConfirmModal } from '../layout/ConfirmModal';
import { RecurringInvoices } from './RecurringInvoices';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { BulkActionBar } from '../common/BulkActionBar';
import { useAppStore } from '../../store';

export function SalesView() {
  useRenderTracker("SalesView");
  const { currentOrgId, activeCompany, exchangeRates } = useAppStore();
  const [isBuilding, setIsBuilding] = useState(false);
  const [activeTab, setActiveTab] = useState<'Invoices' | 'Recurring'>('Invoices');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [invoiceCurrency, setInvoiceCurrency] = useState('KES');
  const [invoiceExchangeRate, setInvoiceExchangeRate] = useState('1');

  const queryClient = useQueryClient();

  const handleCurrencyChange = (curr: string) => {
    setInvoiceCurrency(curr);
    if (curr === (activeCompany?.baseCurrency || 'KES')) {
      setInvoiceExchangeRate('1');
    } else {
      const rate = exchangeRates[curr] || 1;
      setInvoiceExchangeRate(rate.toString());
    }
  };

  const { data: invoicesData, isLoading: loadingInvoices } = useQuery({
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
      if (!res.ok) throw new Error('Failed to fetch');
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

  // Bulk Status Update Invoices
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[], status: string }) => {
      const res = await fetch('/api/bulk/status-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ entityType: 'INVOICES', ids, status })
      });
      if (!res.ok) throw new Error('Failed to update status');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', currentOrgId] });
      setSelectedIds([]);
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

  const handleCreateMockCustomer = async () => {
    await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-org-id': 'default-org-id' },
      body: JSON.stringify({ displayName: 'Acme Corp', email: 'billing@acme.com' })
    });
    queryClient.invalidateQueries({ queryKey: ['customers'] });
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const amountStr = formData.get('amount') as string;
    const amountCents = Math.round(parseFloat(amountStr || '0') * 100);
    const curr = (formData.get('currency') as string) || (activeCompany?.baseCurrency || 'KES');
    const rate = parseFloat((formData.get('exchangeRate') as string) || '1');

    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({
          customerId: formData.get('customerId'),
          issueDate: new Date().toISOString(),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          currency: curr,
          exchangeRate: rate,
          lines: [{
            description: formData.get('description'),
            accountId: formData.get('accountId'),
            amountCents
          }]
        })
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to create invoice');
        return;
      }
      setIsBuilding(false);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } catch (err) {
      console.error(err);
      alert('Error creating invoice');
    }
  };

  if (isBuilding) {
    const hasCustomers = customersData?.customers?.length > 0;
    const incomeAccounts = accountsData?.accounts?.filter((a: any) => a.type === 'INCOME') || [];

    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-serif text-ink-900">New Invoice</h1>
          <button 
            onClick={() => setIsBuilding(false)}
            className="text-slate-500 hover:text-ink-900 text-sm font-medium"
          >
            Cancel
          </button>
        </div>
        <div className="ledger-divider mb-6"></div>

        {!hasCustomers ? (
          <div className="bg-paper-100 p-8 border border-ink-900/10 rounded-sm text-center">
            <p className="text-slate-500 mb-4">You need a customer to create an invoice.</p>
            <button 
              onClick={handleCreateMockCustomer}
              className="bg-ink-900 text-white  px-4 py-2 rounded-sm text-sm font-medium"
            >
              Add Sample Customer
            </button>
          </div>
        ) : (
          <form onSubmit={handleCreateInvoice} className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Customer *</label>
                <select name="customerId" required className="w-full border border-ink-900/20 rounded-sm p-2 text-xs focus:ring-1 focus:ring-focus-blue-500 outline-none bg-paper-100">
                  {customersData?.customers?.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.displayName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Invoice Currency</label>
                <select 
                  name="currency" 
                  value={invoiceCurrency} 
                  onChange={(e) => handleCurrencyChange(e.target.value)}
                  className="w-full border border-ink-900/20 rounded-sm p-2 text-xs focus:ring-1 focus:ring-focus-blue-500 outline-none bg-paper-100"
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.flag} {c.code} - {c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Exchange Rate (vs {activeCompany?.baseCurrency || 'KES'})</label>
                <input 
                  type="number" 
                  step="any"
                  name="exchangeRate" 
                  value={invoiceExchangeRate}
                  onChange={(e) => setInvoiceExchangeRate(e.target.value)}
                  className="w-full border border-ink-900/20 rounded-sm p-2 text-xs focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono bg-paper-100"
                />
              </div>
            </div>

            <div className="border border-ink-900/10 rounded-sm overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-paper-100  border-b border-ink-900/10 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold w-1/2">Description</th>
                    <th className="px-4 py-3 font-semibold">Income Account</th>
                    <th className="px-4 py-3 font-semibold text-right">Amount ({invoiceCurrency})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-900/5">
                  <tr className="bg-paper-100">
                    <td className="p-2">
                      <input name="description" required placeholder="Consulting services / export..." className="w-full border border-ink-900/20 rounded-sm p-2 outline-none focus:ring-1 focus:ring-focus-blue-500 text-xs" />
                    </td>
                    <td className="p-2">
                      <select name="accountId" required className="w-full border border-ink-900/20 rounded-sm p-2 outline-none focus:ring-1 focus:ring-focus-blue-500 text-xs bg-paper-100">
                        {incomeAccounts.map((a: any) => (
                          <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 text-right">
                      <input name="amount" required type="number" step="0.01" min="0.01" placeholder="0.00" className="w-full text-right border border-ink-900/20 rounded-sm p-2 outline-none focus:ring-1 focus:ring-focus-blue-500 tabular-currency text-xs" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-4 border-t border-ink-900/10">
              <button type="submit" className="bg-brass-500 text-ink-900 px-6 py-2 rounded-sm text-sm font-bold shadow-sm hover:bg-brass-500/90 transition-colors">
                Save & Post to Ledger
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Sales & Invoicing</h1>
        {activeTab === 'Invoices' && (
          <div className="flex space-x-2">
            <button 
              onClick={handleExportCSV}
              className="bg-paper-100 border border-ink-900/20 text-ink-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors flex items-center"
            >
              <Download className="h-4 w-4 mr-2" /> Export
            </button>
            <button 
              onClick={() => setIsBuilding(true)}
              className="bg-ink-900 text-white  px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
            >
              Create Invoice
            </button>
          </div>
)}
      </div>
      
      <div className="flex space-x-6 mb-6">
        <button
          onClick={() => setActiveTab('Invoices')}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
            activeTab === 'Invoices'
              ? 'border-brass-500 text-ink-900'
              : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-ink-900/20'
          }`}
        >
          One-Time Invoices
        </button>
        <button
          onClick={() => setActiveTab('Recurring')}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
            activeTab === 'Recurring'
              ? 'border-brass-500 text-ink-900'
              : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-ink-900/20'
          }`}
        >
          Recurring Invoices
        </button>
      </div>

      <div className="ledger-divider mb-6"></div>

      {activeTab === 'Recurring' ? (
        <RecurringInvoices />
      ) : (


      <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
        {loadingInvoices ? (
          <div className="p-16 text-center text-slate-500">Loading invoices...</div>
        ) : invoicesData?.invoices?.length === 0 ? (
          <div className="p-16 text-center text-slate-500">
            <p className="mb-4">No invoices exist yet.</p>
          </div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" className="rounded border-ink-900/20 text-focus-blue-500 focus:ring-focus-blue-500" onChange={handleSelectAll} checked={selectedIds.length > 0 && invoicesData?.invoices?.length === selectedIds.length} />
                </th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Invoice No</th>
                <th className="px-4 py-3 font-semibold">Customer ID</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">eTIMS Status</th>
                <th className="px-4 py-3 font-semibold text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {invoicesData?.invoices?.map((inv: any) => (
                <tr 
                  key={inv.id} 
                  onClick={() => setSelectedInvoice(inv)}
                  className="hover:bg-paper-50 dark:hover:bg-ink-900/40 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 w-8" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="rounded border-ink-900/20 text-focus-blue-500 focus:ring-focus-blue-500" checked={selectedIds.includes(inv.id)} onChange={() => handleSelectOne(inv.id)} />
                  </td>
                  <td className="px-4 py-3 tabular-currency text-ink-900">
                    {format(new Date(inv.issueDate), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink-900">{inv.invoiceNo}</td>
                  <td className="px-4 py-3 text-slate-500">{inv.customerId.substring(0, 8)}...</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-ledger-green-700/10 text-ledger-green-700">
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {inv.etimsStatus === 'SUCCESS' ? (
                      <a href={inv.etimsQrCodeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-focus-blue-500/10 text-focus-blue-500 hover:bg-focus-blue-500/20 transition-colors">
                        ✓ {inv.etimsControlCode}
                      </a>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-currency text-right text-ink-900 font-medium">
                    {inv.currency && inv.currency !== (activeCompany?.baseCurrency || 'KES') ? (
                      <div>
                        <span className="font-bold block">{inv.currency} {((inv.foreignAmountCents || inv.totalCents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        <span className="text-[10px] text-slate-400 font-normal">({formatCurrency(inv.totalCents)})</span>
                      </div>
                    ) : (
                      formatCurrency(inv.totalCents)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
        statusOptions={[
          { label: 'Mark Paid', value: 'PAID' },
          { label: 'Mark Sent', value: 'SENT' },
          { label: 'Mark Draft', value: 'DRAFT' }
        ]}
        onStatusUpdate={(status) => bulkStatusMutation.mutate({ ids: selectedIds, status })}
        onExport={handleExportCSV}
        isLoading={bulkDeleteMutation.isPending || bulkStatusMutation.isPending}
      />

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
