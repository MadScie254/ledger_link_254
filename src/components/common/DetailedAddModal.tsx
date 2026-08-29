import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { formatCurrency } from '../../utils/currency';
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
  FileSpreadsheet
} from 'lucide-react';

export type EntityType = 'ITEM' | 'VENDOR' | 'CUSTOMER' | 'EMPLOYEE' | 'ACCOUNT' | 'BILL' | 'INVOICE';

interface DetailedAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: EntityType;
  onSuccess?: () => void;
}

export function DetailedAddModal({ isOpen, onClose, initialType = 'ITEM', onSuccess }: DetailedAddModalProps) {
  const [selectedType, setSelectedType] = useState<EntityType>(initialType);
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'financial' | 'tax' | 'contact' | 'address'>('general');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { currentOrgId } = useAppStore();
  const queryClient = useQueryClient();

  // Queries for dropdown relations
  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { accounts: [] };
      return res.json();
    },
    enabled: isOpen
  });

  const { data: vendorsData } = useQuery({
    queryKey: ['vendors', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/vendors', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { vendors: [] };
      return res.json();
    },
    enabled: isOpen
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/customers', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { customers: [] };
      return res.json();
    },
    enabled: isOpen
  });

  // Dynamic calculations for item margin preview
  const [itemPrice, setItemPrice] = useState<number>(0);
  const [itemCost, setItemCost] = useState<number>(0);

  // Generic mutation handler based on selected entity type
  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      let endpoint = '';
      switch (selectedType) {
        case 'ITEM':
          endpoint = '/api/inventory';
          break;
        case 'VENDOR':
          endpoint = '/api/vendors';
          break;
        case 'CUSTOMER':
          endpoint = '/api/customers';
          break;
        case 'EMPLOYEE':
          endpoint = '/api/employees';
          break;
        case 'ACCOUNT':
          endpoint = '/api/accounts';
          break;
        case 'BILL':
          endpoint = '/api/bills';
          break;
        case 'INVOICE':
          endpoint = '/api/invoices';
          break;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to create ${selectedType.toLowerCase()}`);
      }
      return res.json();
    },
    onSuccess: () => {
      // Invalidate relevant query keys
      queryClient.invalidateQueries({ queryKey: ['inventory', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['vendors', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['customers', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['employees', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['bills', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['invoices', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics', currentOrgId] });
      setErrorMessage(null);
      if (onSuccess) onSuccess();
      onClose();
    },
    onError: (err: any) => {
      setErrorMessage(err.message || 'An error occurred during submission.');
    }
  });

  if (!isOpen) return null;

  const accounts = accountsData?.accounts || [];
  const vendors = vendorsData?.vendors || [];
  const customers = customersData?.customers || [];

  const incomeAccounts = accounts.filter((a: any) => a.type === 'INCOME');
  const expenseAccounts = accounts.filter((a: any) => a.type === 'EXPENSE' || a.type === 'COGS');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    const fd = new FormData(e.currentTarget);

    if (selectedType === 'ITEM') {
      const price = parseFloat(fd.get('price') as string || '0');
      const cost = parseFloat(fd.get('cost') as string || '0');
      createMutation.mutate({
        name: fd.get('name'),
        itemType: fd.get('itemType') || 'Physical Product',
        sku: fd.get('sku'),
        barcode: fd.get('barcode'),
        category: fd.get('category'),
        unitOfMeasure: fd.get('unitOfMeasure') || 'Units',
        description: fd.get('description'),
        priceCents: Math.round(price * 100),
        costCents: Math.round(cost * 100),
        taxRate: Number(fd.get('taxRate') || 16),
        incomeAccountId: fd.get('incomeAccountId'),
        expenseAccountId: fd.get('expenseAccountId'),
        quantityOnHand: parseInt(fd.get('quantityOnHand') as string || '0', 10),
        reorderPoint: parseInt(fd.get('reorderPoint') as string || '5', 10),
        targetStock: parseInt(fd.get('targetStock') as string || '20', 10),
        preferredVendorId: fd.get('preferredVendorId'),
        location: fd.get('location'),
        notes: fd.get('notes')
      });
    } else if (selectedType === 'VENDOR') {
      createMutation.mutate({
        displayName: fd.get('displayName'),
        legalName: fd.get('legalName'),
        vendorType: fd.get('vendorType') || 'Direct Supplier',
        contactPerson: fd.get('contactPerson'),
        email: fd.get('email'),
        phone: fd.get('phone'),
        kraPin: fd.get('kraPin'),
        vatNumber: fd.get('vatNumber'),
        category: fd.get('category'),
        paymentTerms: fd.get('paymentTerms'),
        currency: fd.get('currency') || 'KES',
        defaultAccountId: fd.get('defaultAccountId'),
        paymentMethod: fd.get('paymentMethod'),
        bankName: fd.get('bankName'),
        bankAccountNo: fd.get('bankAccountNo'),
        bankBranch: fd.get('bankBranch'),
        mpesaNumber: fd.get('mpesaNumber'),
        address: fd.get('address'),
        city: fd.get('city'),
        postalCode: fd.get('postalCode'),
        country: fd.get('country') || 'Kenya',
        notes: fd.get('notes')
      });
    } else if (selectedType === 'CUSTOMER') {
      const creditLimit = parseFloat(fd.get('creditLimit') as string || '0');
      const discount = parseFloat(fd.get('discountPercent') as string || '0');
      createMutation.mutate({
        displayName: fd.get('displayName'),
        legalName: fd.get('legalName'),
        customerType: fd.get('customerType') || 'Corporate',
        contactPerson: fd.get('contactPerson'),
        email: fd.get('email'),
        phone: fd.get('phone'),
        kraPin: fd.get('kraPin'),
        paymentTerms: fd.get('paymentTerms'),
        creditLimitCents: Math.round(creditLimit * 100),
        discountPercent: discount,
        priceTier: fd.get('priceTier') || 'Standard',
        currency: fd.get('currency') || 'KES',
        billingAddress: fd.get('billingAddress'),
        shippingAddress: fd.get('shippingAddress'),
        city: fd.get('city'),
        postalCode: fd.get('postalCode'),
        country: fd.get('country') || 'Kenya',
        notes: fd.get('notes')
      });
    } else if (selectedType === 'EMPLOYEE') {
      const salary = parseFloat(fd.get('baseSalary') as string || '0');
      const housing = parseFloat(fd.get('housingAllowance') as string || '0');
      const transport = parseFloat(fd.get('transportAllowance') as string || '0');
      createMutation.mutate({
        firstName: fd.get('firstName'),
        middleName: fd.get('middleName'),
        lastName: fd.get('lastName'),
        nationalId: fd.get('nationalId'),
        email: fd.get('email'),
        phone: fd.get('phone'),
        jobTitle: fd.get('jobTitle'),
        department: fd.get('department'),
        employmentType: fd.get('employmentType'),
        hireDate: fd.get('hireDate'),
        kraPin: fd.get('kraPin'),
        nssfNumber: fd.get('nssfNumber'),
        shifNumber: fd.get('shifNumber'),
        baseSalaryCents: Math.round(salary * 100),
        housingAllowanceCents: Math.round(housing * 100),
        transportAllowanceCents: Math.round(transport * 100),
        bankName: fd.get('bankName'),
        bankAccountNo: fd.get('bankAccountNo'),
        mpesaNumber: fd.get('mpesaNumber')
      });
    } else if (selectedType === 'ACCOUNT') {
      createMutation.mutate({
        code: fd.get('code'),
        name: fd.get('name'),
        type: fd.get('type'),
        subtype: fd.get('subtype'),
        parentId: fd.get('parentId') || null,
        description: fd.get('description')
      });
    }
  };

  const calculateMargin = () => {
    if (itemPrice <= 0) return { profit: 0, marginPct: 0 };
    const profit = itemPrice - itemCost;
    const marginPct = ((profit / itemPrice) * 100).toFixed(1);
    return { profit, marginPct };
  };

  const marginInfo = calculateMargin();

  return (
    <div className="fixed inset-0 bg-ink-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-paper-100 rounded-sm shadow-2xl border border-ink-900/10 w-full max-w-3xl my-8 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header with Entity Type Switcher */}
        <div className="px-6 py-4 border-b border-ink-900/10 bg-paper-50  flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="p-2 bg-ink-900 text-white rounded-xs">
              {selectedType === 'ITEM' && <Package className="h-5 w-5" />}
              {selectedType === 'VENDOR' && <Building2 className="h-5 w-5" />}
              {selectedType === 'CUSTOMER' && <Users className="h-5 w-5" />}
              {selectedType === 'EMPLOYEE' && <UserPlus className="h-5 w-5" />}
              {selectedType === 'ACCOUNT' && <BookOpen className="h-5 w-5" />}
            </span>
            <div>
              <h2 className="text-lg font-serif text-ink-900">
                New {selectedType.charAt(0) + selectedType.slice(1).toLowerCase()} Profile
              </h2>
              <p className="text-xs text-slate-500">
                Comprehensive record creation with statutory, tax, and ledger linking.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Quick Entity Type Dropdown */}
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value as EntityType);
                setActiveSubTab('general');
                setErrorMessage(null);
              }}
              className="text-xs font-medium border border-ink-900/20 rounded-sm px-2.5 py-1.5 bg-paper-100 text-ink-900 focus:outline-none focus:ring-1 focus:ring-focus-blue-500"
            >
              <option value="ITEM">Add Inventory Item</option>
              <option value="VENDOR">Add Vendor / Supplier</option>
              <option value="CUSTOMER">Add Customer / Client</option>
              <option value="EMPLOYEE">Add Employee / Staff</option>
              <option value="ACCOUNT">Add Chart of Account</option>
            </select>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-ink-900 rounded-sm transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="flex items-center space-x-1 px-6 pt-3 border-b border-ink-900/10 bg-paper-100/30 text-xs font-medium overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('general')}
            className={`pb-2.5 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center ${
              activeSubTab === 'general'
                ? 'border-ink-900 text-ink-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-ink-900'
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> General Details
          </button>

          {(selectedType === 'ITEM' || selectedType === 'VENDOR' || selectedType === 'CUSTOMER' || selectedType === 'EMPLOYEE') && (
            <button
              type="button"
              onClick={() => setActiveSubTab('financial')}
              className={`pb-2.5 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center ${
                activeSubTab === 'financial'
                  ? 'border-ink-900 text-ink-900 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-ink-900'
              }`}
            >
              <CreditCard className="h-3.5 w-3.5 mr-1.5" />
              {selectedType === 'ITEM' ? 'Pricing & Valuation' : selectedType === 'EMPLOYEE' ? 'Salary & Compensation' : 'Financial & Terms'}
            </button>
          )}

          {(selectedType === 'VENDOR' || selectedType === 'CUSTOMER' || selectedType === 'EMPLOYEE' || selectedType === 'ITEM') && (
            <button
              type="button"
              onClick={() => setActiveSubTab('tax')}
              className={`pb-2.5 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center ${
                activeSubTab === 'tax'
                  ? 'border-ink-900 text-ink-900 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-ink-900'
              }`}
            >
              <Percent className="h-3.5 w-3.5 mr-1.5" /> Tax & Statutory (KRA)
            </button>
          )}

          {(selectedType === 'VENDOR' || selectedType === 'CUSTOMER') && (
            <button
              type="button"
              onClick={() => setActiveSubTab('address')}
              className={`pb-2.5 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center ${
                activeSubTab === 'address'
                  ? 'border-ink-900 text-ink-900 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-ink-900'
              }`}
            >
              <MapPin className="h-3.5 w-3.5 mr-1.5" /> Address & Location
            </button>
          )}
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 bg-rust-700/10 border border-rust-700/20 text-rust-700 text-xs rounded-sm">
            {errorMessage}
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* ========================================================================= */}
          {/* 1. INVENTORY ITEM FORM                                                    */}
          {/* ========================================================================= */}
          {selectedType === 'ITEM' && (
            <>
              {activeSubTab === 'general' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Item / Product Name *
                      </label>
                      <input
                        required
                        name="name"
                        placeholder="e.g., Enterprise Server Rack 42U"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Item Classification *
                      </label>
                      <select
                        name="itemType"
                        defaultValue="Physical Product"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="Physical Product">Physical Product (Tracked)</option>
                        <option value="Digital Service">Digital Service (Untracked)</option>
                        <option value="Raw Material">Raw Material / Component</option>
                        <option value="Consumable">Office Consumable</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        SKU Code
                      </label>
                      <input
                        name="sku"
                        placeholder="e.g., SRV-42U-001"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Barcode / EAN
                      </label>
                      <input
                        name="barcode"
                        placeholder="e.g., 616110029381"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Category
                      </label>
                      <input
                        name="category"
                        placeholder="e.g., Hardware & IT"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Unit of Measure
                      </label>
                      <select
                        name="unitOfMeasure"
                        defaultValue="Units"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="Units">Units (pcs)</option>
                        <option value="Hours">Hours (hr)</option>
                        <option value="Kilograms">Kilograms (kg)</option>
                        <option value="Meters">Meters (m)</option>
                        <option value="Boxes">Boxes (box)</option>
                        <option value="Liters">Liters (L)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Warehouse Location
                      </label>
                      <input
                        name="location"
                        placeholder="e.g., Warehouse A - Bin 14"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Preferred Vendor
                      </label>
                      <select
                        name="preferredVendorId"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="">None / Unassigned</option>
                        {vendors.map((v: any) => (
                          <option key={v.id} value={v.id}>{v.displayName}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Item Description & Specifications
                    </label>
                    <textarea
                      name="description"
                      rows={3}
                      placeholder="Detailed catalog description visible on client invoices..."
                      className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none resize-none"
                    />
                  </div>
                </div>
              )}

              {activeSubTab === 'financial' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Selling Price (KES) *
                      </label>
                      <input
                        required
                        name="price"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={itemPrice || ''}
                        onChange={(e) => setItemPrice(parseFloat(e.target.value) || 0)}
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Cost Price / Purchase Price (KES) *
                      </label>
                      <input
                        required
                        name="cost"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={itemCost || ''}
                        onChange={(e) => setItemCost(parseFloat(e.target.value) || 0)}
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency"
                      />
                    </div>
                  </div>

                  {/* Profit Margin Preview Card */}
                  <div className="p-3.5 bg-paper-50  border border-ink-900/10 rounded-sm flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-500">Gross Margin Estimate: </span>
                      <span className="font-semibold text-ink-900 ml-1 font-mono">
                        {marginInfo.marginPct}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Gross Profit per unit: </span>
                      <span className={`font-semibold ml-1 ${marginInfo.profit >= 0 ? 'text-ledger-green-700' : 'text-rust-700'}`}>
                        {formatCurrency(Math.round(marginInfo.profit * 100))}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Sales Income Account (Ledger)
                      </label>
                      <select
                        name="incomeAccountId"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="">Default: 4000 - Sales Revenue</option>
                        {incomeAccounts.map((a: any) => (
                          <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        COGS / Expense Account (Ledger)
                      </label>
                      <select
                        name="expenseAccountId"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="">Default: 5000 - Cost of Goods Sold</option>
                        {expenseAccounts.map((a: any) => (
                          <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Opening Quantity
                      </label>
                      <input
                        name="quantityOnHand"
                        type="number"
                        min="0"
                        defaultValue="0"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Reorder Alert Trigger *
                      </label>
                      <input
                        required
                        name="reorderPoint"
                        type="number"
                        min="0"
                        defaultValue="5"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Target Optimal Stock
                      </label>
                      <input
                        name="targetStock"
                        type="number"
                        min="0"
                        defaultValue="25"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'tax' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Applicable VAT Rate
                      </label>
                      <select
                        name="taxRate"
                        defaultValue="16"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="16">16% Standard VAT</option>
                        <option value="8">8% Petroleum / Special Rate</option>
                        <option value="0">0% Zero-Rated Export</option>
                        <option value="-1">Exempt from VAT</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        KRA eTIMS HS / Tariff Code
                      </label>
                      <input
                        name="notes"
                        placeholder="e.g., 8471.50.00"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ========================================================================= */}
          {/* 2. VENDOR / SUPPLIER FORM                                                 */}
          {/* ========================================================================= */}
          {selectedType === 'VENDOR' && (
            <>
              {activeSubTab === 'general' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Company / Trade Name *
                      </label>
                      <input
                        required
                        name="displayName"
                        placeholder="e.g., Safaricom Business Ltd"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Legal Registered Entity Name
                      </label>
                      <input
                        name="legalName"
                        placeholder="e.g., Safaricom PLC"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Vendor Category
                      </label>
                      <select
                        name="category"
                        defaultValue="Utilities & Telecoms"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="Direct Supplier">Direct Inventory Supplier</option>
                        <option value="Professional Services">Professional & Legal Services</option>
                        <option value="Utilities & Telecoms">Utilities & Telecoms</option>
                        <option value="Logistics & Transport">Logistics & Transport</option>
                        <option value="Equipment & Rent">Equipment & Lease</option>
                        <option value="Marketing & Media">Marketing & Media</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Contact Person
                      </label>
                      <input
                        name="contactPerson"
                        placeholder="e.g., Grace Muthoni"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Primary Email
                      </label>
                      <input
                        name="email"
                        type="email"
                        placeholder="accounts@vendor.co.ke"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Phone Number
                      </label>
                      <input
                        name="phone"
                        placeholder="+254 700 000000"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        M-Pesa Till / Paybill Number
                      </label>
                      <input
                        name="mpesaNumber"
                        placeholder="e.g., Paybill 888999 (Acc: 001)"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'financial' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Payment Terms
                      </label>
                      <select
                        name="paymentTerms"
                        defaultValue="Net 30"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="Due on Receipt">Due on Receipt</option>
                        <option value="Net 15">Net 15 Days</option>
                        <option value="Net 30">Net 30 Days</option>
                        <option value="Net 60">Net 60 Days</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Billing Currency
                      </label>
                      <select
                        name="currency"
                        defaultValue="KES"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                      >
                        <option value="KES">KES - Kenyan Shilling</option>
                        <option value="USD">USD - US Dollar</option>
                        <option value="EUR">EUR - Euro</option>
                        <option value="GBP">GBP - British Pound</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Default Expense Account
                      </label>
                      <select
                        name="defaultAccountId"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="">Select Expense Account...</option>
                        {expenseAccounts.map((a: any) => (
                          <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="p-4 bg-paper-50  border border-ink-900/10 rounded-sm space-y-3">
                    <h4 className="text-xs font-semibold text-ink-900 uppercase tracking-wider">
                      Bank Settlement Details
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Bank Name</label>
                        <input
                          name="bankName"
                          placeholder="e.g., Standard Chartered"
                          className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-2.5 py-1.5 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Branch</label>
                        <input
                          name="bankBranch"
                          placeholder="e.g., Westlands"
                          className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-2.5 py-1.5 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Account Number</label>
                        <input
                          name="bankAccountNo"
                          placeholder="010203040500"
                          className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-2.5 py-1.5 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'tax' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        KRA PIN Number *
                      </label>
                      <input
                        name="kraPin"
                        placeholder="P051234567Z"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        VAT Registration Number
                      </label>
                      <input
                        name="vatNumber"
                        placeholder="VAT-0091238"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'address' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Street Address & Building
                    </label>
                    <input
                      name="address"
                      placeholder="e.g., 5th Floor, Delta Corner Tower A, Chiromo Rd"
                      className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">City</label>
                      <input
                        name="city"
                        defaultValue="Nairobi"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Postal Code</label>
                      <input
                        name="postalCode"
                        defaultValue="00100"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Country</label>
                      <input
                        name="country"
                        defaultValue="Kenya"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ========================================================================= */}
          {/* 3. CUSTOMER / CLIENT FORM                                                 */}
          {/* ========================================================================= */}
          {selectedType === 'CUSTOMER' && (
            <>
              {activeSubTab === 'general' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Customer / Company Name *
                      </label>
                      <input
                        required
                        name="displayName"
                        placeholder="e.g., East Africa Breweries Ltd"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Client Category
                      </label>
                      <select
                        name="customerType"
                        defaultValue="Corporate"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="Corporate">Corporate / Enterprise</option>
                        <option value="SME">SME / Business</option>
                        <option value="Individual">Individual / Retail</option>
                        <option value="Government">Government / NGO</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Primary Contact Person
                      </label>
                      <input
                        name="contactPerson"
                        placeholder="e.g., David Kamau"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Billing Email *
                      </label>
                      <input
                        required
                        name="email"
                        type="email"
                        placeholder="invoices@eabl.co.ke"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Phone / SMS Notifications
                      </label>
                      <input
                        name="phone"
                        placeholder="+254 711 000000"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'financial' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Credit Terms
                      </label>
                      <select
                        name="paymentTerms"
                        defaultValue="Net 30"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="Due on Receipt">Due on Receipt</option>
                        <option value="Net 7">Net 7 Days</option>
                        <option value="Net 14">Net 14 Days</option>
                        <option value="Net 30">Net 30 Days</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Credit Limit (KES)
                      </label>
                      <input
                        name="creditLimit"
                        type="number"
                        step="1000"
                        placeholder="500000"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Discount Rate (%)
                      </label>
                      <input
                        name="discountPercent"
                        type="number"
                        step="0.5"
                        min="0"
                        max="100"
                        defaultValue="0"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'tax' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Customer KRA PIN (eTIMS)
                      </label>
                      <input
                        name="kraPin"
                        placeholder="P059998881A"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Price Tier
                      </label>
                      <select
                        name="priceTier"
                        defaultValue="Standard"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="Standard">Standard Retail</option>
                        <option value="Wholesale">Wholesale Tier</option>
                        <option value="VIP">VIP Key Account</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'address' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Billing Address
                    </label>
                    <input
                      name="billingAddress"
                      placeholder="P.O Box 30161 - 00100, Nairobi"
                      className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Physical / Delivery Address
                    </label>
                    <input
                      name="shippingAddress"
                      placeholder="Ruaraka Industrial Complex, Outer Ring Rd, Nairobi"
                      className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* ========================================================================= */}
          {/* 4. EMPLOYEE / PAYROLL FORM                                                */}
          {/* ========================================================================= */}
          {selectedType === 'EMPLOYEE' && (
            <>
              {activeSubTab === 'general' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        First Name *
                      </label>
                      <input
                        required
                        name="firstName"
                        placeholder="e.g., Samuel"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Middle Name
                      </label>
                      <input
                        name="middleName"
                        placeholder="e.g., Ochieng"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Last Name *
                      </label>
                      <input
                        required
                        name="lastName"
                        placeholder="e.g., Otieno"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Job Title *
                      </label>
                      <input
                        required
                        name="jobTitle"
                        placeholder="e.g., Senior Accountant"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Department
                      </label>
                      <select
                        name="department"
                        defaultValue="Finance"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="Finance">Finance & Accounting</option>
                        <option value="Engineering">Engineering & IT</option>
                        <option value="Operations">Operations & Logistics</option>
                        <option value="Sales">Sales & Marketing</option>
                        <option value="HR">Human Resources</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Employment Type
                      </label>
                      <select
                        name="employmentType"
                        defaultValue="Full-time"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="Full-time">Full-time Permanent</option>
                        <option value="Contract">Fixed Term Contract</option>
                        <option value="Part-time">Part-time</option>
                        <option value="Intern">Intern / Trainee</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        National ID / Passport No *
                      </label>
                      <input
                        required
                        name="nationalId"
                        placeholder="31234567"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Work Email
                      </label>
                      <input
                        name="email"
                        type="email"
                        placeholder="samuel.o@company.com"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Date of Hire
                      </label>
                      <input
                        name="hireDate"
                        type="date"
                        defaultValue={new Date().toISOString().substring(0, 10)}
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'financial' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Gross Base Salary (KES) *
                      </label>
                      <input
                        required
                        name="baseSalary"
                        type="number"
                        step="100"
                        min="0"
                        placeholder="120000"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Housing Allowance (KES)
                      </label>
                      <input
                        name="housingAllowance"
                        type="number"
                        step="100"
                        min="0"
                        defaultValue="0"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Transport Allowance (KES)
                      </label>
                      <input
                        name="transportAllowance"
                        type="number"
                        step="100"
                        min="0"
                        defaultValue="0"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency"
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-paper-50  border border-ink-900/10 rounded-sm space-y-3">
                    <h4 className="text-xs font-semibold text-ink-900 uppercase tracking-wider">
                      Salary Disbursement Channel
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Bank Name</label>
                        <input
                          name="bankName"
                          placeholder="e.g., KCB Bank"
                          className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-2.5 py-1.5 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Account No.</label>
                        <input
                          name="bankAccountNo"
                          placeholder="1102938475"
                          className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-2.5 py-1.5 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">M-Pesa Number</label>
                        <input
                          name="mpesaNumber"
                          placeholder="+254 7..."
                          className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-2.5 py-1.5 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'tax' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        KRA PIN Number *
                      </label>
                      <input
                        required
                        name="kraPin"
                        placeholder="A012345678X"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        NSSF Membership No.
                      </label>
                      <input
                        name="nssfNumber"
                        placeholder="NSSF-0091283"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        SHIF / NHIF Number
                      </label>
                      <input
                        name="shifNumber"
                        placeholder="SHIF-883921"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ========================================================================= */}
          {/* 5. CHART OF ACCOUNTS FORM                                                 */}
          {/* ========================================================================= */}
          {selectedType === 'ACCOUNT' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Account Classification *
                  </label>
                  <select
                    required
                    name="type"
                    defaultValue="EXPENSE"
                    className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                  >
                    <option value="ASSET">Asset (1000s)</option>
                    <option value="LIABILITY">Liability (2000s)</option>
                    <option value="EQUITY">Equity (3000s)</option>
                    <option value="INCOME">Income / Revenue (4000s)</option>
                    <option value="COGS">Cost of Goods Sold (5000s)</option>
                    <option value="EXPENSE">Operating Expense (6000s)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Account Code *
                  </label>
                  <input
                    required
                    name="code"
                    placeholder="e.g., 6150"
                    className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Account Name *
                  </label>
                  <input
                    required
                    name="name"
                    placeholder="e.g., Cloud & Hosting Infrastructure"
                    className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Account Subtype
                  </label>
                  <input
                    name="subtype"
                    placeholder="e.g., Technology Software & SaaS"
                    className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Parent Account (Optional)
                  </label>
                  <select
                    name="parentId"
                    className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                  >
                    <option value="">None (Top-level Account)</option>
                    {accounts.map((a: any) => (
                      <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Description & Usage Guidelines
                </label>
                <textarea
                  name="description"
                  rows={3}
                  placeholder="Notes on which expenses or journal lines post into this ledger code..."
                  className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none resize-none"
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-5 border-t border-ink-900/10">
            <div className="text-xs text-slate-400">
              * Required fields for database and ledger synchronization
            </div>
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-ink-900 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-ink-900 text-white  px-5 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors disabled:opacity-50 flex items-center shadow-xs"
              >
                {createMutation.isPending ? 'Saving Record...' : `Create ${selectedType.charAt(0) + selectedType.slice(1).toLowerCase()}`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
