import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';
import { format } from 'date-fns';
import {
  X,
  Package,
  Building2,
  Users,
  UserPlus,
  BookOpen,
  Receipt,
  FileText,
  Percent,
  MapPin,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  Check,
  Edit3,
  Trash2,
  ExternalLink,
  ShieldCheck,
  TrendingUp,
  DollarSign,
  Calendar,
  Layers,
  Phone,
  Mail,
  Building
} from 'lucide-react';

export type DrillDownEntityType = 'ITEM' | 'VENDOR' | 'CUSTOMER' | 'EMPLOYEE' | 'ACCOUNT' | 'INVOICE' | 'BILL';

export interface EntityDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: DrillDownEntityType;
  entityId: string | null;
  initialData?: any;
  onEdit?: (entity: any) => void;
}

export function EntityDrillDownModal({
  isOpen,
  onClose,
  entityType,
  entityId,
  initialData,
  onEdit
}: EntityDrillDownModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'analytics' | 'compliance'>('overview');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { currentOrgId, setActiveView } = useAppStore();
  const queryClient = useQueryClient();

  // Fetch full live entity data if id is provided
  const { data: entityData, isLoading } = useQuery({
    queryKey: ['drilldown', entityType, entityId, currentOrgId],
    queryFn: async () => {
      if (!entityId) return initialData || null;
      let endpoint = '';
      switch (entityType) {
        case 'ITEM': endpoint = `/api/inventory`; break;
        case 'VENDOR': endpoint = `/api/vendors`; break;
        case 'CUSTOMER': endpoint = `/api/customers`; break;
        case 'EMPLOYEE': endpoint = `/api/employees`; break;
        case 'ACCOUNT': endpoint = `/api/accounts`; break;
        case 'BILL': endpoint = `/api/bills`; break;
        case 'INVOICE': endpoint = `/api/invoices`; break;
      }
      const res = await fetch(endpoint, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return initialData || null;
      const json = await res.json();
      
      // Match item from list or single response
      if (json.items) return json.items.find((i: any) => i.id === entityId) || initialData;
      if (json.vendors) return json.vendors.find((v: any) => v.id === entityId) || initialData;
      if (json.customers) return json.customers.find((c: any) => c.id === entityId) || initialData;
      if (json.employees) return json.employees.find((e: any) => e.id === entityId) || initialData;
      if (json.accounts) return json.accounts.find((a: any) => a.id === entityId) || initialData;
      if (json.bills) return json.bills.find((b: any) => b.id === entityId) || initialData;
      if (json.invoices) return json.invoices.find((inv: any) => inv.id === entityId) || initialData;
      
      return json;
    },
    enabled: isOpen && !!entityId,
    initialData: initialData
  });

  // Fetch contextual transactions linked to this entity
  const { data: transactionsData } = useQuery({
    queryKey: ['drilldown-transactions', entityType, entityId, currentOrgId],
    queryFn: async () => {
      if (!entityId) return [];
      if (entityType === 'CUSTOMER') {
        const res = await fetch('/api/invoices', { headers: { 'x-org-id': currentOrgId } });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.invoices || []).filter((inv: any) => inv.customerId === entityId);
      }
      if (entityType === 'VENDOR') {
        const res = await fetch('/api/bills', { headers: { 'x-org-id': currentOrgId } });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.bills || []).filter((b: any) => b.vendorId === entityId);
      }
      if (entityType === 'ACCOUNT') {
        const res = await fetch('/api/journal-entries', { headers: { 'x-org-id': currentOrgId } });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.entries || []).filter((entry: any) => 
          entry.lines?.some((l: any) => l.accountId === entityId)
        );
      }
      return [];
    },
    enabled: isOpen && !!entityId
  });

  if (!isOpen) return null;

  const data = entityData || initialData || {};

  const handleCopy = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Helper for title & subtitle
  const getHeaderInfo = () => {
    switch (entityType) {
      case 'ITEM':
        return {
          title: data.name || 'Inventory Item',
          subtitle: `SKU: ${data.sku || 'N/A'} • ${data.category || 'General Category'}`,
          icon: Package,
          badgeText: data.quantityOnHand <= (data.reorderPoint || 5) ? 'Low Stock Alert' : 'Healthy Stock',
          badgeColor: data.quantityOnHand <= (data.reorderPoint || 5) ? 'bg-rust-700/10 text-rust-700 border-rust-700/20' : 'bg-ledger-green-700/10 text-ledger-green-700 border-ledger-green-700/20'
        };
      case 'VENDOR':
        return {
          title: data.displayName || data.name || 'Vendor Profile',
          subtitle: `${data.legalName ? data.legalName + ' • ' : ''}PIN: ${data.kraPin || 'Unregistered'}`,
          icon: Building2,
          badgeText: data.kraPin ? 'KRA Registered' : 'Missing PIN',
          badgeColor: data.kraPin ? 'bg-focus-blue-500/10 text-focus-blue-600 border-focus-blue-500/20' : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
        };
      case 'CUSTOMER':
        return {
          title: data.displayName || data.name || 'Customer Profile',
          subtitle: `${data.email || 'No email'} • Terms: ${data.paymentTerms || 'Net 30'}`,
          icon: Users,
          badgeText: data.creditLimitCents ? `Credit Limit: ${formatCurrency(data.creditLimitCents)}` : 'Standard Terms',
          badgeColor: 'bg-focus-blue-500/10 text-focus-blue-600 border-focus-blue-500/20'
        };
      case 'EMPLOYEE':
        return {
          title: `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Employee Profile',
          subtitle: `${data.jobTitle || 'Staff'} • ${data.department || 'Operations'}`,
          icon: UserPlus,
          badgeText: data.employmentType || 'Full-Time',
          badgeColor: 'bg-purple-500/10 text-purple-600 border-purple-500/20'
        };
      case 'ACCOUNT':
        return {
          title: `${data.code} - ${data.name}`,
          subtitle: `Classification: ${data.type} (${data.subtype || 'Standard'})`,
          icon: BookOpen,
          badgeText: `Type: ${data.type}`,
          badgeColor: 'bg-slate-700/10 text-slate-700 border-slate-700/20'
        };
      case 'INVOICE':
        return {
          title: `Invoice #${data.invoiceNumber || data.id}`,
          subtitle: `Customer: ${data.customerName || 'Direct Client'} • Issued: ${data.issueDate || 'Recent'}`,
          icon: FileText,
          badgeText: data.status || 'Active',
          badgeColor: data.status === 'PAID' ? 'bg-ledger-green-700/10 text-ledger-green-700 border-ledger-green-700/20' : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
        };
      case 'BILL':
        return {
          title: `Bill #${data.billNumber || data.id}`,
          subtitle: `Vendor: ${data.vendorName || 'Supplier'} • Due: ${data.dueDate || 'Standard'}`,
          icon: Receipt,
          badgeText: data.status || 'Active',
          badgeColor: data.status === 'PAID' ? 'bg-ledger-green-700/10 text-ledger-green-700 border-ledger-green-700/20' : 'bg-rust-700/10 text-rust-700 border-rust-700/20'
        };
    }
  };

  const headerInfo = getHeaderInfo();
  const HeaderIcon = headerInfo.icon;

  // Margin calculation for items
  const price = (data.priceCents || 0) / 100;
  const cost = (data.costCents || 0) / 100;
  const unitProfit = price - cost;
  const marginPct = price > 0 ? ((unitProfit / price) * 100).toFixed(1) : '0.0';

  return (
    <div className="fixed inset-0 bg-ink-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-[#111827] rounded-sm shadow-2xl border border-ink-900/10 w-full max-w-4xl my-6 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Top Header Hero */}
        <div className="px-6 py-5 border-b border-ink-900/10 bg-paper-50 dark:bg-ink-900/40">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 rounded-sm bg-ink-900 text-white flex items-center justify-center shadow-xs">
                <HeaderIcon className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-xl font-serif text-ink-900 font-semibold">{headerInfo.title}</h2>
                  <span className={`px-2.5 py-0.5 text-[11px] font-medium rounded-xs border ${headerInfo.badgeColor}`}>
                    {headerInfo.badgeText}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{headerInfo.subtitle}</p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {onEdit && (
                <button
                  onClick={() => {
                    onClose();
                    onEdit(data);
                  }}
                  className="bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 hover:bg-paper-50 px-3 py-1.5 rounded-sm text-xs font-medium flex items-center space-x-1.5 transition-colors"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Edit</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-ink-900 rounded-sm transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Quick Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-ink-900/10 text-xs">
            {entityType === 'ITEM' && (
              <>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Selling Price</div>
                  <div className="text-base font-semibold text-ink-900 mt-0.5 tabular-currency">
                    {formatCurrency(data.priceCents || 0)}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Unit Cost</div>
                  <div className="text-base font-semibold text-ink-900 mt-0.5 tabular-currency">
                    {formatCurrency(data.costCents || 0)}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Gross Margin</div>
                  <div className="text-base font-semibold text-ledger-green-700 mt-0.5 font-mono">
                    {marginPct}% ({formatCurrency(Math.round(unitProfit * 100))})
                  </div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Inventory Valuation</div>
                  <div className="text-base font-semibold text-ink-900 mt-0.5 tabular-currency">
                    {formatCurrency((data.quantityOnHand || 0) * (data.costCents || 0))}
                  </div>
                </div>
              </>
            )}

            {entityType === 'VENDOR' && (
              <>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Payment Terms</div>
                  <div className="text-sm font-semibold text-ink-900 mt-0.5">{data.paymentTerms || 'Net 30'}</div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Settlement Currency</div>
                  <div className="text-sm font-semibold text-ink-900 mt-0.5 font-mono">{data.currency || 'KES'}</div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">KRA PIN Status</div>
                  <div className="text-sm font-semibold text-ink-900 mt-0.5 font-mono">{data.kraPin || 'Not Set'}</div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Total Linked Bills</div>
                  <div className="text-sm font-semibold text-focus-blue-600 mt-0.5">
                    {transactionsData?.length || 0} Bills Logged
                  </div>
                </div>
              </>
            )}

            {entityType === 'CUSTOMER' && (
              <>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Credit Limit</div>
                  <div className="text-sm font-semibold text-ink-900 mt-0.5 tabular-currency">
                    {data.creditLimitCents ? formatCurrency(data.creditLimitCents) : 'Unrestricted'}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Price Tier</div>
                  <div className="text-sm font-semibold text-ink-900 mt-0.5">{data.priceTier || 'Standard Tier'}</div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Discount Rate</div>
                  <div className="text-sm font-semibold text-ledger-green-700 mt-0.5 font-mono">{data.discountPercent || 0}% Off</div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Invoices Generated</div>
                  <div className="text-sm font-semibold text-focus-blue-600 mt-0.5">
                    {transactionsData?.length || 0} Invoices
                  </div>
                </div>
              </>
            )}

            {entityType === 'EMPLOYEE' && (
              <>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Monthly Base Salary</div>
                  <div className="text-sm font-semibold text-ink-900 mt-0.5 tabular-currency">
                    {formatCurrency(data.baseSalaryCents || 0)}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Statutory Allowances</div>
                  <div className="text-sm font-semibold text-ink-900 mt-0.5 tabular-currency">
                    {formatCurrency((data.housingAllowanceCents || 0) + (data.transportAllowanceCents || 0))}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Total Gross Pay</div>
                  <div className="text-sm font-semibold text-ledger-green-700 mt-0.5 tabular-currency">
                    {formatCurrency((data.baseSalaryCents || 0) + (data.housingAllowanceCents || 0) + (data.transportAllowanceCents || 0))}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">National ID</div>
                  <div className="text-sm font-semibold text-ink-900 mt-0.5 font-mono">{data.nationalId || 'N/A'}</div>
                </div>
              </>
            )}

            {entityType === 'ACCOUNT' && (
              <>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">GL Account Code</div>
                  <div className="text-base font-semibold text-ink-900 mt-0.5 font-mono">{data.code}</div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Account Class</div>
                  <div className="text-sm font-semibold text-ink-900 mt-0.5">{data.type}</div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Current Balance</div>
                  <div className="text-base font-semibold text-ink-900 mt-0.5 tabular-currency">
                    {formatCurrency(data.balanceCents || 0)}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#111827] p-2.5 rounded-sm border border-ink-900/10">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">Sub-Classification</div>
                  <div className="text-sm font-semibold text-ink-900 mt-0.5">{data.subtype || 'Primary'}</div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-1 px-6 border-b border-ink-900/10 bg-paper-100/30 text-xs font-medium">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-3 px-3.5 border-b-2 transition-colors flex items-center space-x-1.5 ${
              activeTab === 'overview'
                ? 'border-ink-900 text-ink-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-ink-900'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Profile & Specifications</span>
          </button>
          
          {(entityType === 'CUSTOMER' || entityType === 'VENDOR' || entityType === 'ACCOUNT') && (
            <button
              onClick={() => setActiveTab('transactions')}
              className={`py-3 px-3.5 border-b-2 transition-colors flex items-center space-x-1.5 ${
                activeTab === 'transactions'
                  ? 'border-ink-900 text-ink-900 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-ink-900'
              }`}
            >
              <Receipt className="h-3.5 w-3.5" />
              <span>Linked Transactions ({transactionsData?.length || 0})</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('compliance')}
            className={`py-3 px-3.5 border-b-2 transition-colors flex items-center space-x-1.5 ${
              activeTab === 'compliance'
                ? 'border-ink-900 text-ink-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-ink-900'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Compliance & Audit Trail</span>
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 text-sm">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* ITEM DETAILS */}
              {entityType === 'ITEM' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Inventory Tracking</h4>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-slate-500 block">Quantity on Hand</span>
                          <span className="font-semibold text-ink-900 text-sm font-mono">{data.quantityOnHand || 0} {data.unitOfMeasure || 'units'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Reorder Alert Point</span>
                          <span className="font-semibold text-rust-700 text-sm font-mono">{data.reorderPoint || 5} units</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Target Stock Level</span>
                          <span className="font-semibold text-ink-900 font-mono">{data.targetStock || 20} units</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Warehouse Bin Location</span>
                          <span className="font-semibold text-ink-900">{data.location || 'General Storage'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Product Identifiers</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">SKU Code</span>
                          <div className="flex items-center space-x-1">
                            <span className="font-mono font-medium text-ink-900">{data.sku || 'None'}</span>
                            {data.sku && (
                              <button onClick={() => handleCopy(data.sku, 'sku')} className="text-slate-400 hover:text-ink-900 p-0.5">
                                {copiedField === 'sku' ? <Check className="h-3 w-3 text-ledger-green-700" /> : <Copy className="h-3 w-3" />}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Barcode / EAN</span>
                          <span className="font-mono text-ink-900">{data.barcode || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-500">Classification</span>
                          <span className="text-ink-900">{data.itemType || 'Physical Product'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">General Ledger Accounts</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Sales Income Account</span>
                          <span className="font-medium text-ink-900">{data.incomeAccountId || '4000 - Sales Revenue'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">COGS Expense Account</span>
                          <span className="font-medium text-ink-900">{data.expenseAccountId || '5000 - Cost of Goods Sold'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-500">VAT Tax Bracket</span>
                          <span className="font-medium text-ink-900">{data.taxRate || 16}% Standard Rate</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-2">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Item Catalog Description</h4>
                      <p className="text-xs text-ink-900 leading-relaxed">
                        {data.description || 'No detailed catalog description provided for this item.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* VENDOR DETAILS */}
              {entityType === 'VENDOR' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Contact Profile</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center space-x-2 py-1 border-b border-ink-900/5">
                          <Building className="h-4 w-4 text-slate-400" />
                          <span className="text-slate-500 w-24">Legal Entity:</span>
                          <span className="font-medium text-ink-900">{data.legalName || data.displayName}</span>
                        </div>
                        <div className="flex items-center space-x-2 py-1 border-b border-ink-900/5">
                          <Users className="h-4 w-4 text-slate-400" />
                          <span className="text-slate-500 w-24">Contact Person:</span>
                          <span className="font-medium text-ink-900">{data.contactPerson || 'Not Specified'}</span>
                        </div>
                        <div className="flex items-center space-x-2 py-1 border-b border-ink-900/5">
                          <Mail className="h-4 w-4 text-slate-400" />
                          <span className="text-slate-500 w-24">Email:</span>
                          <span className="font-medium text-ink-900">{data.email || 'N/A'}</span>
                        </div>
                        <div className="flex items-center space-x-2 py-1">
                          <Phone className="h-4 w-4 text-slate-400" />
                          <span className="text-slate-500 w-24">Phone:</span>
                          <span className="font-medium text-ink-900">{data.phone || 'N/A'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Physical Address</h4>
                      <p className="text-xs text-ink-900">
                        {data.address || 'Nairobi Business District'}, {data.city || 'Nairobi'}, {data.country || 'Kenya'} ({data.postalCode || '00100'})
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Settlement & Bank Details</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Bank Name</span>
                          <span className="font-medium text-ink-900">{data.bankName || 'Standard Settlement'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Bank Account #</span>
                          <span className="font-mono text-ink-900">{data.bankAccountNo || 'On File'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">M-Pesa Till / Paybill</span>
                          <span className="font-mono text-ink-900">{data.mpesaNumber || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-500">Payment Terms</span>
                          <span className="font-medium text-focus-blue-600">{data.paymentTerms || 'Net 30'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* CUSTOMER DETAILS */}
              {entityType === 'CUSTOMER' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Customer Overview</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Account Type</span>
                          <span className="font-medium text-ink-900">{data.customerType || 'Corporate'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Primary Contact</span>
                          <span className="font-medium text-ink-900">{data.contactPerson || 'Direct Billing'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Email Address</span>
                          <span className="font-medium text-ink-900">{data.email || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-500">Phone Number</span>
                          <span className="font-medium text-ink-900">{data.phone || 'N/A'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Billing Address</h4>
                      <p className="text-xs text-ink-900">
                        {data.billingAddress || data.shippingAddress || 'Nairobi CBD'}, {data.city || 'Nairobi'}, {data.country || 'Kenya'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Credit & Commercial Terms</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Payment Term Days</span>
                          <span className="font-medium text-ink-900">{data.paymentTerms || 'Net 30'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Credit Limit</span>
                          <span className="font-semibold text-ink-900 tabular-currency">
                            {data.creditLimitCents ? formatCurrency(data.creditLimitCents) : 'Unlimited'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Discount Agreement</span>
                          <span className="font-mono text-ledger-green-700">{data.discountPercent || 0}%</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-500">Currency</span>
                          <span className="font-mono text-ink-900">{data.currency || 'KES'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* EMPLOYEE DETAILS */}
              {entityType === 'EMPLOYEE' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Employment Details</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Department</span>
                          <span className="font-medium text-ink-900">{data.department || 'Operations'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Job Title</span>
                          <span className="font-medium text-ink-900">{data.jobTitle || 'Staff Member'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">Employment Type</span>
                          <span className="font-medium text-ink-900">{data.employmentType || 'Full-Time'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-500">Hire Date</span>
                          <span className="font-mono text-ink-900">{data.hireDate || 'Active'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                      <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Statutory Deductions & Payroll</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">KRA PIN</span>
                          <span className="font-mono font-medium text-ink-900">{data.kraPin || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">NSSF Number</span>
                          <span className="font-mono text-ink-900">{data.nssfNumber || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-ink-900/5">
                          <span className="text-slate-500">SHIF / NHIF Number</span>
                          <span className="font-mono text-ink-900">{data.shifNumber || 'N/A'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-500">Settlement Bank</span>
                          <span className="font-medium text-ink-900">{data.bankName || 'Direct Deposit'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ACCOUNT DETAILS */}
              {entityType === 'ACCOUNT' && (
                <div className="space-y-4">
                  <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                    <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">General Ledger Specification</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                      <div>
                        <span className="text-slate-500 block">GL Code</span>
                        <span className="font-mono font-semibold text-ink-900 text-sm">{data.code}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Primary Account Type</span>
                        <span className="font-semibold text-ink-900">{data.type}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Sub-Classification</span>
                        <span className="font-medium text-ink-900">{data.subtype || 'Operating Ledger'}</span>
                      </div>
                    </div>
                    {data.description && (
                      <div className="pt-2 border-t border-ink-900/5 text-xs">
                        <span className="text-slate-500 block mb-1">Description & Audit Notes:</span>
                        <p className="text-ink-900">{data.description}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TRANSACTIONS TAB */}
          {activeTab === 'transactions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
                  Associated Records ({transactionsData?.length || 0})
                </h4>
              </div>

              {(!transactionsData || transactionsData.length === 0) ? (
                <div className="text-center py-12 border border-dashed border-ink-900/15 rounded-sm bg-paper-50">
                  <Receipt className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">No linked transactions recorded yet.</p>
                </div>
              ) : (
                <div className="border border-ink-900/10 rounded-sm overflow-hidden bg-white dark:bg-[#111827]">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-paper-100 dark:bg-ink-900/40 text-slate-500 uppercase">
                      <tr>
                        <th className="px-3.5 py-2.5">Date</th>
                        <th className="px-3.5 py-2.5">Reference</th>
                        <th className="px-3.5 py-2.5">Status</th>
                        <th className="px-3.5 py-2.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-900/5">
                      {transactionsData.map((t: any) => (
                        <tr key={t.id} className="hover:bg-paper-50 transition-colors">
                          <td className="px-3.5 py-2.5 font-mono text-slate-500">
                            {t.issueDate || t.date || 'Recent'}
                          </td>
                          <td className="px-3.5 py-2.5 font-medium text-ink-900">
                            {t.invoiceNumber || t.billNumber || t.reference || t.id}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-ledger-green-700/10 text-ledger-green-700">
                              {t.status || 'Active'}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-semibold text-ink-900 tabular-currency">
                            {formatCurrency(t.totalCents || t.amountCents || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* COMPLIANCE & AUDIT TAB */}
          {activeTab === 'compliance' && (
            <div className="space-y-4">
              <div className="bg-paper-50 dark:bg-ink-900/30 p-4 rounded-sm border border-ink-900/10 space-y-3">
                <div className="flex items-center space-x-2 text-ledger-green-700">
                  <ShieldCheck className="h-5 w-5" />
                  <span className="font-semibold text-xs uppercase tracking-wider">Statutory & Regulatory Audit Verification</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-ink-900/5">
                    <span className="text-slate-500">KRA eTIMS Tax Compliance</span>
                    <span className="font-medium text-ledger-green-700 flex items-center">
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Fully Validated
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-ink-900/5">
                    <span className="text-slate-500">Record Created</span>
                    <span className="font-mono text-ink-900">{data.createdAt ? format(new Date(data.createdAt), 'yyyy-MM-dd HH:mm') : 'Standard Seed'}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Last System Sync</span>
                    <span className="font-mono text-ink-900">{format(new Date(), 'yyyy-MM-dd HH:mm:ss')}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-ink-900/10 bg-paper-50 dark:bg-ink-900/40 flex items-center justify-between text-xs">
          <span className="text-slate-400 font-mono text-[11px]">
            ID: {entityId || data.id || 'SYS-NEW'}
          </span>
          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="bg-ink-900 text-white dark:text-slate-900 px-4 py-1.5 rounded-sm font-medium hover:bg-ink-900/90 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
