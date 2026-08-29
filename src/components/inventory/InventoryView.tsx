import React, { useState } from 'react';
import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { BulkActionBar } from '../common/BulkActionBar';

const tabs = ['Items', 'Stock adjustments', 'Reorder alerts'];

export function InventoryView() {
  const [activeTab, setActiveTab] = useState('Items');
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  
  const { currentOrgId } = useAppStore();
  const queryClient = useQueryClient();

  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ['inventory', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/inventory', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch inventory');
      return res.json();
    }
  });

  const items = inventoryData?.items || [];

  // Bulk Delete Items
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ entityType: 'ITEMS', ids })
      });
      if (!res.ok) throw new Error('Failed to delete items');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', currentOrgId] });
      setSelectedItemIds([]);
    }
  });

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedItemIds(items.map((i: any) => i.id));
    } else {
      setSelectedItemIds([]);
    }
  };

  const handleToggleOne = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedItemIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const isAllSelected = items.length > 0 && selectedItemIds.length === items.length;

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Inventory</h1>
        {activeTab === 'Items' && (
          <button 
            onClick={() => setIsAddingItem(true)}
            className="bg-ink-900 text-white  px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
          >
            Add Item
          </button>
        )}
      </div>
      <div className="ledger-divider mb-6"></div>

      <div className="flex space-x-6 border-b border-ink-900/10 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              setSelectedItemIds([]);
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

      {activeTab === 'Items' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 w-10 text-center">
                  <input 
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                    className="rounded border-ink-900/20 text-ink-900 focus:ring-focus-blue-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">SKU</th>
                <th className="px-4 py-3 font-semibold text-right">Price</th>
                <th className="px-4 py-3 font-semibold text-right">Cost</th>
                <th className="px-4 py-3 font-semibold text-right">Qty on Hand</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading inventory...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No items found.</td></tr>
              ) : (
                items.map((item: any) => {
                  const isLow = item.quantityOnHand <= item.reorderPoint;
                  const isChecked = selectedItemIds.includes(item.id);

                  return (
                    <tr 
                      key={item.id} 
                      onClick={() => setSelectedItem(item)}
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
                          onChange={(e) => handleToggleOne(item.id, e as any)}
                          className="rounded border-ink-900/20 text-ink-900 focus:ring-focus-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-ink-900">{item.name}</td>
                      <td className="px-4 py-3 text-slate-500 font-mono">{item.sku || '-'}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-ink-900">
                        {formatCurrency(item.priceCents)}
                      </td>
                      <td className="px-4 py-3 tabular-currency text-right text-ink-900">
                        {formatCurrency(item.costCents)}
                      </td>
                      <td className="px-4 py-3 tabular-currency text-right font-medium">
                        {item.quantityOnHand} {item.unitOfMeasure || 'units'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          isLow ? 'bg-rust-700/10 text-rust-700' : 'bg-ledger-green-700/10 text-ledger-green-700'
                        }`}>
                          {isLow ? 'Low Stock' : 'In Stock'}
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

      {activeTab === 'Stock adjustments' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Manual Stock Adjustments</h3>
           <p className="text-slate-500 mb-6">Record breakages, theft, or physical audit discrepancies directly into the ledger.</p>
           <button 
             onClick={() => setIsAddingItem(true)}
             className="bg-ink-900 text-white  px-6 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
           >
             + New Adjustment
           </button>
        </div>
      )}

      {activeTab === 'Reorder alerts' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto">
           <h3 className="text-lg font-medium text-ink-900 mb-4">Low Stock Notifications</h3>
           {items.filter((i: any) => i.quantityOnHand <= i.reorderPoint).length === 0 ? (
             <div className="p-8 border border-ink-900/10 bg-paper-50 rounded-sm text-center text-slate-500">
                All inventory levels are healthy.
             </div>
           ) : (
             <div className="space-y-3">
               {items.filter((i: any) => i.quantityOnHand <= i.reorderPoint).map((item: any) => (
                 <div key={item.id} className="flex justify-between items-center p-4 border border-rust-700/20 bg-rust-700/5 rounded-sm">
                   <div>
                     <p className="font-semibold text-ink-900">{item.name}</p>
                     <p className="text-sm text-rust-700 mt-1">Current Qty: {item.quantityOnHand} (Reorder at: {item.reorderPoint})</p>
                   </div>
                   <button 
                     onClick={() => setSelectedItem(item)}
                     className="text-sm font-medium text-ink-900 bg-paper-100 border border-ink-900/20 px-4 py-2 rounded-sm hover:bg-paper-50"
                   >
                     View Item 360°
                   </button>
                 </div>
               ))}
             </div>
           )}
        </div>
      )}

      {/* Bulk Action Contextual Toolbar */}
      {activeTab === 'Items' && (
        <BulkActionBar
          selectedCount={selectedItemIds.length}
          totalCount={items.length}
          entityName="items"
          onClearSelection={() => setSelectedItemIds([])}
          onDelete={() => {
            if (window.confirm(`Delete ${selectedItemIds.length} inventory item(s)?`)) {
              bulkDeleteMutation.mutate(selectedItemIds);
            }
          }}
          isLoading={bulkDeleteMutation.isPending}
        />
      )}

      {/* Dynamic Contextual Add Item Modal */}
      <DynamicQuickAddModal
        isOpen={isAddingItem}
        onClose={() => setIsAddingItem(false)}
        overrideType="ITEM"
      />

      {/* Comprehensive Entity Drill-Down Overlay */}
      <EntityDrillDownModal
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        entityType="ITEM"
        entityId={selectedItem?.id || null}
        initialData={selectedItem}
      />
    </div>
  );
}
