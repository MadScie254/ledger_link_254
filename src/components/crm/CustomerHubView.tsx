import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { BulkActionBar } from '../common/BulkActionBar';
import { Amount } from '../ledger/Amount';
import { PageHeading, IndexTabs, PageNote, SkeletonRows, EmptyNote, LoadProblem, buttonClass } from '../ledger/Page';

type Tab = 'Customers' | 'Balances';

export function CustomerHubView() {
  const [activeTab, setActiveTab] = useState<Tab>('Customers');
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);

  const { currentOrgId, activeCompany } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const queryClient = useQueryClient();

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

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ entityType: 'CUSTOMERS', ids }),
      });
      if (!res.ok) throw new Error('Failed to bulk delete');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', currentOrgId] });
      setSelectedCustomerIds([]);
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const res = await fetch('/api/bulk/status-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ entityType: 'CUSTOMERS', ids, status }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', currentOrgId] });
      setSelectedCustomerIds([]);
    },
  });

  const isAllSelected = customers.length > 0 && selectedCustomerIds.length === customers.length;
  const isIndeterminate = selectedCustomerIds.length > 0 && selectedCustomerIds.length < customers.length;
  const toggleOne = (id: string) =>
    setSelectedCustomerIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  const standing = (c: any) => (c.status === 'INACTIVE' ? 'Inactive' : 'Active');

  return (
    <div className="pb-16 space-y-5">
      <PageHeading
        title="Customers"
        note={<>Who the business sells to and what each one owes · Figures in {baseCurrency}</>}
        actions={
          <button type="button" onClick={() => setIsAddingCustomer(true)} className={buttonClass.primary}>
            Add customer
          </button>
        }
      />

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

          <ul className="sm:hidden" aria-label={`Customers, figures in ${baseCurrency}`}>
            {customers.map((c) => (
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
              </li>
            ))}
          </ul>

          <div className="hidden sm:block relative overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <caption className="sr-only">Customers, figures in {baseCurrency}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-8 pr-2 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all customers"
                      checked={isAllSelected}
                      ref={(input) => {
                        if (input) input.indeterminate = isIndeterminate;
                      }}
                      onChange={(e) => setSelectedCustomerIds(e.target.checked ? customers.map((c) => c.id) : [])}
                      className="h-4 w-4"
                    />
                  </th>
                  <th scope="col" className="pr-4 text-left">Customer</th>
                  <th scope="col" className="pr-4 text-left">KRA PIN</th>
                  <th scope="col" className="pr-4 text-left">Email</th>
                  <th scope="col" className="pr-4 text-left">Standing</th>
                  <th scope="col" className="pr-4 text-right">Invoiced to date</th>
                  <th scope="col" className="text-right">Owes, {baseCurrency}</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} onClick={() => setSelectedCustomer(c)} className="cursor-pointer">
                    <td className="w-8 pr-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.displayName}`}
                        checked={selectedCustomerIds.includes(c.id)}
                        onChange={() => toggleOne(c.id)}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="pr-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCustomer(c);
                        }}
                        className="text-left text-ink-900 hover:underline underline-offset-[3px]"
                      >
                        {c.displayName}
                      </button>
                    </td>
                    <td className="pr-4 whitespace-nowrap text-graphite-600">{c.kraPin || '–'}</td>
                    <td className="pr-4 text-graphite-600">{c.email || '–'}</td>
                    <td className="pr-4 text-graphite-600">{standing(c)}</td>
                    <td className="pr-4 text-right whitespace-nowrap">
                      <Amount cents={invoicedByCustomer.get(c.id) || 0} currency={baseCurrency} tone="ink" />
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <Amount cents={c.balance || 0} currency={baseCurrency} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={6} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">
                    Owed by {customers.length} customers
                  </th>
                  <td className="ll-total py-2 text-right whitespace-nowrap">
                    <Amount cents={totalOwed} currency={baseCurrency} tone="ink" className="font-semibold" />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
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
          if (window.confirm(`Delete ${selectedCustomerIds.length} customer(s)? This cannot be undone.`)) {
            bulkDeleteMutation.mutate(selectedCustomerIds);
          }
        }}
        statusOptions={[
          { label: 'Mark active', value: 'ACTIVE' },
          { label: 'Mark inactive', value: 'INACTIVE' },
        ]}
        onStatusUpdate={(status) => bulkStatusMutation.mutate({ ids: selectedCustomerIds, status })}
        isLoading={bulkDeleteMutation.isPending || bulkStatusMutation.isPending}
      />

      <DynamicQuickAddModal isOpen={isAddingCustomer} onClose={() => setIsAddingCustomer(false)} overrideType="CUSTOMER" />

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
