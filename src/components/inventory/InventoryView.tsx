import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { BulkActionBar } from '../common/BulkActionBar';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { PageHeading, IndexTabs, SkeletonRows, EmptyNote, LoadProblem, buttonClass } from '../ledger/Page';
import { useConfirm } from '../../hooks/useConfirm';
import { inParts } from '../../utils/apiRequest';
import { StockCountDialog } from './StockCountDialog';
import { ImportRecordsDialog } from '../common/ImportRecordsDialog';

type Tab = 'Items' | 'Reorder';

export function InventoryView() {
  const [activeTab, setActiveTab] = useState<Tab>('Items');
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [countingItem, setCountingItem] = useState<any | null>(null);
  const [notice, setNotice] = useState('');

  const { currentOrgId, activeCompany } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();

  const inventory = useQuery({
    queryKey: ['inventory', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/inventory', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch inventory');
      return res.json();
    },
  });

  // The API names these unitPriceCents and costPriceCents; older rows used priceCents and costCents.
  const items: any[] = (inventory.data?.items || []).map((item: any) => ({
    ...item,
    priceCents: item.unitPriceCents ?? item.priceCents ?? 0,
    costCents: item.costPriceCents ?? item.costCents ?? 0,
  }));
  // Services are not counted.
  const isStocked = (item: any) => item.type !== 'Digital Service' && item.type !== 'Service';
  const isLow = (item: any) => isStocked(item) && item.status !== 'Inactive' && item.quantityOnHand <= item.reorderPoint;
  const lowItems = items.filter(isLow);
  const stockValue = items.reduce((sum, item) => sum + (item.costCents || 0) * (item.quantityOnHand || 0), 0);

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      let deleted = 0;
      for (const part of inParts(ids)) {
        const res = await fetch('/api/bulk/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
          body: JSON.stringify({ entityType: 'INVENTORY', ids: part }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${deleted ? `${deleted} deleted. ` : ''}${body.error || 'Failed to delete items'}`);
        deleted += body.count || 0;
      }
      return { count: deleted };
    },
    onSuccess: (result) => {
      setNotice(`${result.count} stock ${result.count === 1 ? 'item' : 'items'} deleted.`);
      setSelectedItemIds([]);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inventory', currentOrgId] }),
  });

  const isAllSelected = items.length > 0 && selectedItemIds.length === items.length;
  const toggleOne = (id: string) => setSelectedItemIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  const quantity = (item: any) => (
    <span className="ll-figure text-ink-900">
      {item.quantityOnHand}
      <span className="ml-1 text-[12px] text-graphite-600">{item.unitOfMeasure || 'units'}</span>
    </span>
  );

  return (
    <div className="space-y-5 pb-16">
      <PageHeading
        tourId="inventory-overview"
        title="Inventory"
        note={<>Stock on hand, at cost and at selling price · Figures in {baseCurrency}</>}
        actions={
          <>
            <button type="button" onClick={() => setIsImporting(true)} className={buttonClass.secondary}>
              Import from a spreadsheet
            </button>
            <button type="button" onClick={() => setIsAddingItem(true)} className={buttonClass.primary}>
              Add stock item
            </button>
          </>
        }
      />
      <ImportRecordsDialog target="items" open={isImporting} onClose={() => setIsImporting(false)} onDone={setNotice} />

      {notice && <p role="status" className="text-[13.5px] text-ink-900">{notice}</p>}
      {bulkDeleteMutation.isError && (
        <p role="alert" className="text-[13.5px] text-ledger-red">
          {bulkDeleteMutation.error.message} Items used on orders or invoices stay; mark them inactive instead.
        </p>
      )}

      <IndexTabs
        label="Inventory"
        active={activeTab}
        onChange={(id) => {
          setActiveTab(id as Tab);
          setSelectedItemIds([]);
        }}
        tabs={[
          { id: 'Items', name: 'Stock items', count: items.length },
          { id: 'Reorder', name: 'Below reorder point', count: lowItems.length },
        ]}
      />

      {inventory.isError ? (
        <LoadProblem what="stock items" path="/api/inventory" onRetry={() => inventory.refetch()} />
      ) : inventory.isLoading ? (
        <SkeletonRows label="Loading stock items" />
      ) : items.length === 0 ? (
        <EmptyNote
          action={
            <button type="button" onClick={() => setIsAddingItem(true)} className={buttonClass.quiet}>
              Add the first stock item
            </button>
          }
        >
          No stock items yet. Each item is listed here with its cost, selling price and quantity on hand, flagged when it falls to its reorder point.
        </EmptyNote>
      ) : activeTab === 'Items' ? (
        <>
          <ul className="sm:hidden" aria-label={`Stock items, figures in ${baseCurrency}`}>
            {items.map((item) => (
              <li key={item.id} className="border-b border-feint">
                <button type="button" onClick={() => setSelectedItem(item)} className="w-full py-3 text-left">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[14.5px] text-ink-900">{item.name}</span>
                    {quantity(item)}
                  </span>
                  <span className="mt-1 flex items-baseline justify-between gap-3 text-[12.5px] text-graphite-600">
                    <span>{item.sku || 'No SKU'}</span>
                    <span>
                      Sells at <Amount cents={item.priceCents || 0} currency={baseCurrency} size="xs" tone="ink" />
                    </span>
                  </span>
                  {isLow(item) && <span className="mt-1.5 block"><Mark kind="query" label={`At or below reorder point of ${item.reorderPoint}`} /></span>}
                </button>
                {isStocked(item) && (
                  <button type="button" onClick={() => setCountingItem(item)} className={`${buttonClass.quiet} mb-3`}>
                    Count {item.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="hidden sm:block relative overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <caption className="sr-only">Stock items, figures in {baseCurrency}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-8 pr-2 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all stock items"
                      checked={isAllSelected}
                      onChange={(e) => setSelectedItemIds(e.target.checked ? items.map((i) => i.id) : [])}
                      className="h-4 w-4"
                    />
                  </th>
                  <th scope="col" className="pr-4 text-left">Item</th>
                  <th scope="col" className="pr-4 text-left">SKU</th>
                  <th scope="col" className="pr-4 text-right">Cost</th>
                  <th scope="col" className="pr-4 text-right">Price</th>
                  <th scope="col" className="pr-4 text-right">On hand</th>
                  <th scope="col" className="pr-4 text-left">Standing</th>
                  <th scope="col" className="w-14"><span className="sr-only">Count</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} onClick={() => setSelectedItem(item)} className="cursor-pointer">
                    <td className="w-8 pr-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.name}`}
                        checked={selectedItemIds.includes(item.id)}
                        onChange={() => toggleOne(item.id)}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="pr-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItem(item);
                        }}
                        className="text-left text-ink-900 hover:underline underline-offset-[3px]"
                      >
                        {item.name}
                      </button>
                    </td>
                    <td className="pr-4 whitespace-nowrap text-graphite-600">{item.sku || '–'}</td>
                    <td className="pr-4 text-right whitespace-nowrap"><Amount cents={item.costCents || 0} currency={baseCurrency} /></td>
                    <td className="pr-4 text-right whitespace-nowrap"><Amount cents={item.priceCents || 0} currency={baseCurrency} /></td>
                    <td className="pr-4 text-right whitespace-nowrap">{quantity(item)}</td>
                    <td className="pr-4 whitespace-nowrap">
                      {item.status === 'Inactive' ? (
                        <span className="text-[12px] text-graphite-600">Inactive</span>
                      ) : !isStocked(item) ? (
                        <span className="text-[12px] text-graphite-600">Service</span>
                      ) : isLow(item) ? (
                        <Mark kind="query" label="Reorder" />
                      ) : (
                        <span className="text-[12px] text-graphite-600">In stock</span>
                      )}
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      {isStocked(item) && (
                        <button type="button" onClick={() => setCountingItem(item)} aria-label={`Count ${item.name}`} className={buttonClass.quiet}>
                          Count
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={6} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">
                    Stock at cost, {items.length} items
                  </th>
                  <td colSpan={2} className="ll-total py-2 text-left whitespace-nowrap font-semibold">
                    <Amount cents={stockValue} currency={baseCurrency} tone="ink" />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : lowItems.length === 0 ? (
        <p className="py-6 text-[14px]">
          <Mark kind="tick" label="Every item is above its reorder point." />
        </p>
      ) : (
        <ul className="border-t border-feint-strong">
          {lowItems.map((item) => (
            <li key={item.id} className="border-b border-feint">
              <button type="button" onClick={() => setSelectedItem(item)} className="flex w-full items-baseline justify-between gap-4 py-3 text-left">
                <span className="min-w-0">
                  <span className="block text-[14.5px] text-ink-900">{item.name}</span>
                  <span className="mt-0.5 block text-[12.5px] text-graphite-600">Reorder at {item.reorderPoint} {item.unitOfMeasure || 'units'}</span>
                </span>
                <span className="shrink-0 text-right">
                  {quantity(item)}
                  <span className="mt-0.5 block"><Mark kind="query" label="Reorder" /></span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {activeTab === 'Items' && (
        <BulkActionBar
          selectedCount={selectedItemIds.length}
          totalCount={items.length}
          entityName="items"
          onClearSelection={() => setSelectedItemIds([])}
          onDelete={() => {
            confirm(
              { title: 'Delete stock items', message: `Delete ${selectedItemIds.length} stock item(s)? This cannot be undone. Items used on orders or invoices are refused.`, confirmText: 'Delete', isDestructive: true },
              () => bulkDeleteMutation.mutate(selectedItemIds)
            );
          }}
          isLoading={bulkDeleteMutation.isPending}
        />
      )}

      <DynamicQuickAddModal isOpen={isAddingItem} onClose={() => setIsAddingItem(false)} overrideType="ITEM" />

      <StockCountDialog item={countingItem} orgId={currentOrgId} onClose={() => setCountingItem(null)} onDone={setNotice} />

      <EntityDrillDownModal isOpen={!!selectedItem} onClose={() => setSelectedItem(null)} entityType="ITEM" entityId={selectedItem?.id || null} initialData={selectedItem} />

      {confirmDialog}
    </div>
  );
}
