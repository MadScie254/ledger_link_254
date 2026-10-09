import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { BulkActionBar } from '../common/BulkActionBar';
import { Amount } from '../ledger/Amount';
import { DataTable, type DataColumn } from '../ledger/DataTable';
import { MoneyBar } from '../ledger/MoneyBar';
import { PageHeading, IndexTabs, PageNote, SkeletonRows, EmptyNote, LoadProblem, buttonClass } from '../ledger/Page';
import { useConfirm } from '../../hooks/useConfirm';
import { inParts } from '../../utils/apiRequest';
import { ImportRecordsDialog } from '../common/ImportRecordsDialog';

type Tab = 'Customers' | 'Balances';

export function CustomerHubView() {
  const [activeTab, setActiveTab] = useState<Tab>('Customers');
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importNotice, setImportNotice] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [customerFilter, setCustomerFilter] = useState('ALL');

  const { currentOrgId, activeCompany } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();

  const customersQuery = useQuery({
    queryKey: ['customers', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/customers', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch customers');
      return res.json();
    },
  });

  const { data: invoicesData } = useQuery({
    queryKey: ['invoices', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/invoices', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch invoices');
      return res.json();
    },
  });

  const customers: any[] = customersQuery.data?.customers || [];
  const invoices: any[] = invoicesData?.invoices || [];

  // Invoiced to date comes from the customer's own invoices, not the open
  // balance: a customer who always pays still has a history worth reading.
  const invoicedByCustomer = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status === 'VOID') continue;
    invoicedByCustomer.set(inv.customerId, (invoicedByCustomer.get(inv.customerId) || 0) + (inv.totalCents || 0));
  }

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const invoicedRecently = new Set(
    invoices.filter((inv) => inv.status !== 'VOID' && inv.issueDate && new Date(inv.issueDate) >= ninetyDaysAgo).map((inv) => inv.customerId),
  );
  const withPin = customers.filter((c) => c.kraPin).length;
  const totalOwed = customers.reduce((sum, c) => sum + (c.balance || 0), 0);
  const byBalance = [...customers].filter((c) => (c.balance || 0) !== 0).sort((a, b) => (b.balance || 0) - (a.balance || 0));
  const owingCustomers = customers.filter((c) => Number(c.balance || 0) > 0);
  const creditCustomers = customers.filter((c) => Number(c.balance || 0) < 0);
  const clearCustomers = customers.filter((c) => Number(c.balance || 0) === 0);
  const shownCustomers = customerFilter === 'OWED' ? owingCustomers : customerFilter === 'CREDIT' ? creditCustomers : customerFilter === 'CLEAR' ? clearCustomers : customers;
  const shownOwed = shownCustomers.reduce((sum, customer) => sum + Number(customer.balance || 0), 0);

  // Sent in parts the API accepts. The database refuses to delete a
  // customer with invoices or orders; mark those inactive instead.
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      let deleted = 0;
      for (const part of inParts(ids)) {
        const res = await fetch('/api/bulk/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
          body: JSON.stringify({ entityType: 'CUSTOMERS', ids: part }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${deleted ? `${deleted} deleted. ` : ''}${body.error || 'Failed to bulk delete'}`);
        deleted += body.count || 0;
      }
      return { count: deleted };
    },
    onSuccess: () => setSelectedCustomerIds([]),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['customers', currentOrgId] }),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      for (const part of inParts(ids, 100)) {
        const res = await fetch('/api/bulk/status-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
          body: JSON.stringify({ entityType: 'CUSTOMERS', ids: part, status }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Failed to update status');
      }
      return { count: ids.length };
    },
    onSuccess: () => setSelectedCustomerIds([]),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['customers', currentOrgId] }),
  });

  const standing = (c: any) => (c.isActive === false ? 'Inactive' : 'Active');
  const customerColumns: DataColumn<any>[] = [
    { id: 'customer', label: 'Customer', value: (c) => c.displayName || '', render: (c) => <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedCustomer(c); }} className="text-left font-medium text-text hover:text-primary-ink">{c.displayName}</button> },
    { id: 'pin', label: 'KRA PIN', value: (c) => c.kraPin || '', render: (c) => c.kraPin || '–' },
    { id: 'email', label: 'Email', value: (c) => c.email || '', render: (c) => c.email || '–' },
    { id: 'standing', label: 'Standing', value: standing, render: standing },
    { id: 'invoiced', label: 'Invoiced to date', value: (c) => invoicedByCustomer.get(c.id) || 0, render: (c) => <Amount cents={invoicedByCustomer.get(c.id) || 0} currency={baseCurrency} tone="ink" />, numeric: true },
    { id: 'owed', label: `Owes, ${baseCurrency}`, value: (c) => Number(c.balance || 0), render: (c) => <Amount cents={c.balance || 0} currency={baseCurrency} />, numeric: true },
  ];

  return (
    <div className="pb-16 space-y-5">
      <PageHeading
        tourId="customers-overview"
        title="Customers"
        note={<>Who the business sells to and what each one owes · Figures in {baseCurrency}</>}
        actions={
          <>
            <button type="button" onClick={() => setIsImporting(true)} className={buttonClass.secondary}>
              Import from a spreadsheet
            </button>
            <button type="button" onClick={() => setIsAddingCustomer(true)} className={buttonClass.primary}>
              Add customer
            </button>
          </>
        }
      />
      {importNotice && <p role="status" className="text-[13.5px] text-ink-900">{importNotice}</p>}
      <ImportRecordsDialog target="customers" open={isImporting} onClose={() => setIsImporting(false)} onDone={setImportNotice} />

      <IndexTabs
        label="Customers"
        active={activeTab}
        onChange={(id) => setActiveTab(id as Tab)}
        tabs={[
          { id: 'Customers', name: 'Customers', count: customers.length },
          { id: 'Balances', name: 'Balances owed', count: byBalance.length },
        ]}
      />

      {customersQuery.isError ? (
        <LoadProblem what="customers" path="/api/customers" onRetry={() => customersQuery.refetch()} />
      ) : customersQuery.isLoading ? (
        <SkeletonRows label="Loading customers" />
      ) : customers.length === 0 ? (
        <EmptyNote
          action={
            <button type="button" onClick={() => setIsAddingCustomer(true)} className={buttonClass.quiet}>
              Add the first customer
            </button>
          }
        >
          No customers yet. Each customer is listed here with their KRA PIN, what they have been invoiced and what they still owe.
        </EmptyNote>
      ) : activeTab === 'Customers' ? (
        <div className="-mt-1">
          <PageNote>
            <span>{invoicedRecently.size} invoiced in the last 90 days</span>
            <span>{withPin} of {customers.length} with a KRA PIN on record</span>
          </PageNote>
          <MoneyBar label="Customer balances" active={customerFilter} onChange={setCustomerFilter} currency={baseCurrency} segments={[
            { id: 'OWED', label: 'Owes you', count: owingCustomers.length, cents: owingCustomers.reduce((sum, c) => sum + Number(c.balance || 0), 0), color: 'var(--primary)' },
            { id: 'CREDIT', label: 'Credit balance', count: creditCustomers.length, cents: creditCustomers.reduce((sum, c) => sum + Math.abs(Number(c.balance || 0)), 0), color: 'var(--info)' },
            { id: 'CLEAR', label: 'Clear', count: clearCustomers.length, cents: 0, color: 'var(--chart-expense)' },
          ]} />

          <ul className="sm:hidden" aria-label={`Customers, figures in ${baseCurrency}`}>
            {shownCustomers.length === 0 && <li className="py-6 text-sm text-text-2">No customers match this filter. Choose All to see every customer.</li>}
            {shownCustomers.map((c) => (
              <li key={c.id} className="border-b border-feint">
                <button type="button" onClick={() => setSelectedCustomer(c)} className="w-full py-3 text-left">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[14.5px] text-ink-900">{c.displayName}</span>
                    <Amount cents={c.balance || 0} currency={baseCurrency} className="shrink-0" />
                  </span>
                  <span className="mt-1 block text-[12.5px] text-graphite-600">
                    {[c.kraPin && `PIN ${c.kraPin}`, standing(c)].filter(Boolean).join(' · ')}
                  </span>
                </button>
                <label className="inline-flex min-h-11 items-center gap-2 text-xs text-text-2"><input type="checkbox" aria-label={`Select ${c.displayName}`} checked={selectedCustomerIds.includes(c.id)} onChange={() => setSelectedCustomerIds((current) => current.includes(c.id) ? current.filter((id) => id !== c.id) : [...current, c.id])} />Select</label>
              </li>
            ))}
          </ul>

          <div className="hidden sm:block">
            <DataTable
              records={shownCustomers}
              columns={customerColumns}
              caption={`Customers, figures in ${baseCurrency}`}
              onOpen={setSelectedCustomer}
              openLabel={(customer) => `Open ${customer.displayName}`}
              selectedIds={selectedCustomerIds}
              onSelectionChange={setSelectedCustomerIds}
              selectAllLabel="Select all customers"
              selectRowLabel={(customer) => `Select ${customer.displayName}`}
              rowActions={(customer) => <button type="button" onClick={() => setSelectedCustomer(customer)} className={buttonClass.quiet}>Open</button>}
            />
            <div className="flex items-baseline justify-between gap-4 px-4 py-3 text-[13px]">
              <span className="font-semibold text-text">Net balance for {shownCustomers.length} customers</span>
              <Amount cents={shownOwed} currency={baseCurrency} tone="ink" className="font-semibold" />
            </div>
          </div>        </div>
      ) : byBalance.length === 0 ? (
        <EmptyNote>No customer owes anything. Customers with an open balance are listed here, largest first.</EmptyNote>
      ) : (
        <div>
          {byBalance.map((c) => (
            <div key={c.id} className="flex items-baseline justify-between gap-4 border-b border-feint py-2.5 text-[13.5px]">
              <button type="button" onClick={() => setSelectedCustomer(c)} className="min-w-0 truncate text-left text-ink-900 hover:underline underline-offset-[3px]">
                {c.displayName}
              </button>
              <Amount cents={c.balance || 0} currency={baseCurrency} className="shrink-0" />
            </div>
          ))}
          <div className="ll-total mt-px flex items-baseline justify-between gap-4 py-2 text-[13.5px]">
            <span className="font-semibold text-ink-900">Owed by {byBalance.length} customers</span>
            <Amount cents={totalOwed} currency={baseCurrency} tone="ink" className="font-semibold" />
          </div>
        </div>
      )}

      <BulkActionBar
        selectedCount={selectedCustomerIds.length}
        totalCount={customers.length}
        entityName="customers"
        onClearSelection={() => setSelectedCustomerIds([])}
        onDelete={() => {
          confirm(
            { title: 'Delete customers', message: `Delete ${selectedCustomerIds.length} customer(s)? This cannot be undone.`, confirmText: 'Delete', isDestructive: true },
            () => bulkDeleteMutation.mutate(selectedCustomerIds)
          );
        }}
        statusOptions={[
          { label: 'Mark active', value: 'ACTIVE' },
          { label: 'Mark inactive', value: 'INACTIVE' },
        ]}
        onStatusUpdate={(status) => bulkStatusMutation.mutate({ ids: selectedCustomerIds, status })}
        isLoading={bulkDeleteMutation.isPending || bulkStatusMutation.isPending}
      />
      {(bulkDeleteMutation.error || bulkStatusMutation.error) && (
        <p role="alert" className="text-[13.5px] text-ledger-red">
          {(bulkDeleteMutation.error || bulkStatusMutation.error)!.message}
        </p>
      )}

      <DynamicQuickAddModal isOpen={isAddingCustomer} onClose={() => setIsAddingCustomer(false)} overrideType="CUSTOMER" />

      <EntityDrillDownModal
        isOpen={!!selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        entityType="CUSTOMER"
        entityId={selectedCustomer?.id || null}
        initialData={selectedCustomer}
      />

      {confirmDialog}
    </div>
  );
}
