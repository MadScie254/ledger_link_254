import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { useEntityForm, EntityType } from '../../hooks/useEntityForm';
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
  FileSpreadsheet,
  RotateCcw,
  Sparkles,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';

interface DynamicQuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  overrideType?: EntityType;
  onSuccess?: () => void;
}

/**
 * Maps the app's active view to the most relevant entity creation type
 */
export function getContextualEntityType(activeView: string): EntityType {
  switch (activeView) {
    case 'Sales':
      return 'CUSTOMER';
    case 'Customer Hub':
      return 'CUSTOMER';
    case 'Expenses & Bills':
      return 'VENDOR';
    case 'Inventory':
      return 'ITEM';
    case 'Payroll':
      return 'EMPLOYEE';
    case 'Accounting':
      return 'ACCOUNT';
    case 'Banking':
      return 'ACCOUNT';
    default:
      return 'ITEM';
  }
}

export function DynamicQuickAddModal({
  isOpen,
  onClose,
  overrideType,
  onSuccess
}: DynamicQuickAddModalProps) {
  const { activeView, currentOrgId } = useAppStore();
  const queryClient = useQueryClient();

  // Context-aware default selection
  const contextualDefault = overrideType || getContextualEntityType(activeView);
  const [selectedType, setSelectedType] = useState<EntityType>(contextualDefault);
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'financial' | 'tax' | 'contact' | 'address'>('general');
  const [serverError, setServerError] = useState<string | null>(null);

  // Sync selected type when modal opens or view changes
  useEffect(() => {
    if (isOpen) {
      setSelectedType(overrideType || getContextualEntityType(activeView));
      setActiveSubTab('general');
      setServerError(null);
    }
  }, [isOpen, overrideType, activeView]);

  // Use unified form state management with isDirty and validations
  const {
    values,
    setFieldValue,
    handleInputChange,
    handleBlur,
    errors,
    isDirty,
    dirtyFields,
    hasRecoveredDraft,
    validateAll,
    resetForm,
    discardDraft
  } = useEntityForm(selectedType, undefined, {
    autoSaveDraft: true,
    storageKeyPrefix: 'quickadd'
  });

  // Queries for relations
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

  const accounts = accountsData?.accounts || [];
  const vendors = vendorsData?.vendors || [];
  const incomeAccounts = accounts.filter((a: any) => a.type === 'INCOME');
  const expenseAccounts = accounts.filter((a: any) => a.type === 'EXPENSE' || a.type === 'COGS');

  // Mutation
  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      let endpoint = '';
      switch (selectedType) {
        case 'ITEM': endpoint = '/api/inventory'; break;
        case 'VENDOR': endpoint = '/api/vendors'; break;
        case 'CUSTOMER': endpoint = '/api/customers'; break;
        case 'EMPLOYEE': endpoint = '/api/employees'; break;
        case 'ACCOUNT': endpoint = '/api/accounts'; break;
        case 'BILL': endpoint = '/api/bills'; break;
        case 'INVOICE': endpoint = '/api/invoices'; break;
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
      queryClient.invalidateQueries({ queryKey: ['inventory', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['vendors', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['customers', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['employees', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['bills', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['invoices', currentOrgId] });
      resetForm();
      setServerError(null);
      if (onSuccess) onSuccess();
      onClose();
    },
    onError: (err: any) => {
      setServerError(err.message || 'An error occurred during submission.');
    }
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const isValid = validateAll();
    if (!isValid) return;

    if (selectedType === 'ITEM') {
      const price = parseFloat(values.price || '0');
      const cost = parseFloat(values.cost || '0');
      createMutation.mutate({
        name: values.name,
        itemType: values.itemType || 'Physical Product',
        sku: values.sku,
        barcode: values.barcode,
        category: values.category,
        unitOfMeasure: values.unitOfMeasure || 'Units',
        description: values.description,
        priceCents: Math.round(price * 100),
        costCents: Math.round(cost * 100),
        taxRate: Number(values.taxRate || 16),
        incomeAccountId: values.incomeAccountId,
        expenseAccountId: values.expenseAccountId,
        quantityOnHand: parseInt(values.quantityOnHand || '0', 10),
        reorderPoint: parseInt(values.reorderPoint || '5', 10),
        targetStock: parseInt(values.targetStock || '20', 10),
        preferredVendorId: values.preferredVendorId,
        location: values.location,
        notes: values.notes
      });
    } else if (selectedType === 'VENDOR') {
      createMutation.mutate({
        displayName: values.displayName,
        legalName: values.legalName,
        vendorType: values.vendorType || 'Direct Supplier',
        contactPerson: values.contactPerson,
        email: values.email,
        phone: values.phone,
        kraPin: values.kraPin,
        vatNumber: values.vatNumber,
        category: values.category,
        paymentTerms: values.paymentTerms,
        currency: values.currency || 'KES',
        defaultAccountId: values.defaultAccountId,
        paymentMethod: values.paymentMethod,
        bankName: values.bankName,
        bankAccountNo: values.bankAccountNo,
        bankBranch: values.bankBranch,
        mpesaNumber: values.mpesaNumber,
        address: values.address,
        city: values.city,
        postalCode: values.postalCode,
        country: values.country || 'Kenya',
        notes: values.notes
      });
    } else if (selectedType === 'CUSTOMER') {
      const creditLimit = parseFloat(values.creditLimit || '0');
      const discount = parseFloat(values.discountPercent || '0');
      createMutation.mutate({
        displayName: values.displayName,
        legalName: values.legalName,
        customerType: values.customerType || 'Corporate',
        contactPerson: values.contactPerson,
        email: values.email,
        phone: values.phone,
        kraPin: values.kraPin,
        paymentTerms: values.paymentTerms,
        creditLimitCents: Math.round(creditLimit * 100),
        discountPercent: discount,
        priceTier: values.priceTier || 'Standard',
        currency: values.currency || 'KES',
        billingAddress: values.billingAddress,
        shippingAddress: values.shippingAddress,
        city: values.city,
        postalCode: values.postalCode,
        country: values.country || 'Kenya',
        notes: values.notes
      });
    } else if (selectedType === 'EMPLOYEE') {
      const salary = parseFloat(values.baseSalary || '0');
      const housing = parseFloat(values.housingAllowance || '0');
      const transport = parseFloat(values.transportAllowance || '0');
      createMutation.mutate({
        firstName: values.firstName,
        middleName: values.middleName,
        lastName: values.lastName,
        nationalId: values.nationalId,
        email: values.email,
        phone: values.phone,
        jobTitle: values.jobTitle,
        department: values.department,
        employmentType: values.employmentType,
        hireDate: values.hireDate,
        kraPin: values.kraPin,
        nssfNumber: values.nssfNumber,
        shifNumber: values.shifNumber,
        baseSalaryCents: Math.round(salary * 100),
        housingAllowanceCents: Math.round(housing * 100),
        transportAllowanceCents: Math.round(transport * 100),
        bankName: values.bankName,
        bankAccountNo: values.bankAccountNo,
        mpesaNumber: values.mpesaNumber
      });
    } else if (selectedType === 'ACCOUNT') {
      createMutation.mutate({
        code: values.code,
        name: values.name,
        type: values.type,
        subtype: values.subtype,
        parentId: values.parentId || null,
        description: values.description
      });
    }
  };

  // Profit Margin Calculation for Item form
  const numPrice = parseFloat(values.price || '0');
  const numCost = parseFloat(values.cost || '0');
  const unitProfit = numPrice - numCost;
  const marginPct = numPrice > 0 ? ((unitProfit / numPrice) * 100).toFixed(1) : '0.0';

  return (
    <div className="fixed inset-0 bg-ink-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-paper-100 rounded-sm shadow-2xl border border-ink-900/10 w-full max-w-3xl my-8 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Dynamic Context Header */}
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
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-serif text-ink-900 font-medium">
                  New {selectedType === 'ITEM' ? 'Inventory Item' : selectedType === 'VENDOR' ? 'Vendor / Supplier' : selectedType === 'CUSTOMER' ? 'Customer Profile' : selectedType === 'EMPLOYEE' ? 'Employee Record' : 'Chart of Account'}
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-medium bg-brass-500/15 text-brass-700 dark:text-brass-400 rounded-xs flex items-center space-x-1">
                  <Sparkles className="h-3 w-3" />
                  <span>Context: {activeView}</span>
                </span>
                {isDirty && (
                  <span className="px-1.5 py-0.5 text-[9px] font-mono bg-amber-500/15 text-amber-700 rounded">
                    Unsaved Draft
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Context-aware creation with automated ledger linking and KRA compliance checks.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Quick Entity Type Switcher */}
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value as EntityType);
                setActiveSubTab('general');
                setServerError(null);
              }}
              className="text-xs font-medium border border-ink-900/20 rounded-sm px-2.5 py-1.5 bg-paper-100 text-ink-900 focus:outline-none focus:ring-1 focus:ring-focus-blue-500"
            >
              <option value="ITEM">Inventory Item</option>
              <option value="VENDOR">Vendor / Supplier</option>
              <option value="CUSTOMER">Customer / Client</option>
              <option value="EMPLOYEE">Employee / Staff</option>
              <option value="ACCOUNT">Chart of Account</option>
            </select>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-ink-900 rounded-sm transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Draft Notice if Restored */}
        {hasRecoveredDraft && isDirty && (
          <div className="px-6 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-500/20 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300">
            <span className="flex items-center">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-amber-600" />
              Restored your saved {selectedType.toLowerCase()} draft from earlier.
            </span>
            <button
              type="button"
              onClick={discardDraft}
              className="text-[11px] underline hover:text-amber-900 font-medium"
            >
              Discard Draft
            </button>
          </div>
        )}

        {/* Sub Tabs */}
        <div className="flex items-center space-x-1 px-6 pt-2.5 border-b border-ink-900/10 bg-paper-100/30 text-xs font-medium overflow-x-auto">
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
              {selectedType === 'ITEM' ? 'Pricing & Valuation' : selectedType === 'EMPLOYEE' ? 'Salary & Deductions' : 'Financial & Terms'}
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

        {/* Server or Form-level Errors */}
        {serverError && (
          <div className="mx-6 mt-4 p-3 bg-rust-700/10 border border-rust-700/20 text-rust-700 text-xs rounded-sm flex items-center space-x-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{serverError}</span>
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
                        value={values.name || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        placeholder="e.g., Enterprise Server Rack 42U"
                        className={`w-full bg-paper-100 border ${errors.name ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none`}
                      />
                      {errors.name && <p className="text-[11px] text-rust-700 mt-1">{errors.name}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Item Classification *
                      </label>
                      <select
                        name="itemType"
                        value={values.itemType || 'Physical Product'}
                        onChange={handleInputChange}
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
                        value={values.sku || ''}
                        onChange={handleInputChange}
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
                        value={values.barcode || ''}
                        onChange={handleInputChange}
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
                        value={values.category || ''}
                        onChange={handleInputChange}
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
                        value={values.unitOfMeasure || 'Units'}
                        onChange={handleInputChange}
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
                        value={values.location || ''}
                        onChange={handleInputChange}
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
                        value={values.preferredVendorId || ''}
                        onChange={handleInputChange}
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
                      value={values.description || ''}
                      onChange={handleInputChange}
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
                        value={values.price || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full bg-paper-100 border ${errors.price ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency`}
                      />
                      {errors.price && <p className="text-[11px] text-rust-700 mt-1">{errors.price}</p>}
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
                        value={values.cost || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full bg-paper-100 border ${errors.cost ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency`}
                      />
                      {errors.cost && <p className="text-[11px] text-rust-700 mt-1">{errors.cost}</p>}
                    </div>
                  </div>

                  {/* Profit Margin Preview Card */}
                  <div className="p-3.5 bg-paper-50  border border-ink-900/10 rounded-sm flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-500">Gross Margin Estimate: </span>
                      <span className="font-semibold text-ink-900 ml-1 font-mono">{marginPct}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Gross Profit per unit: </span>
                      <span className={`font-semibold ml-1 ${unitProfit >= 0 ? 'text-ledger-green-700' : 'text-rust-700'}`}>
                        {formatCurrency(Math.round(unitProfit * 100))}
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
                        value={values.incomeAccountId || ''}
                        onChange={handleInputChange}
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
                        value={values.expenseAccountId || ''}
                        onChange={handleInputChange}
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
                        value={values.quantityOnHand || '0'}
                        onChange={handleInputChange}
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
                        value={values.reorderPoint || '5'}
                        onChange={handleInputChange}
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
                        value={values.targetStock || '20'}
                        onChange={handleInputChange}
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
                        value={values.taxRate || '16'}
                        onChange={handleInputChange}
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
                        value={values.notes || ''}
                        onChange={handleInputChange}
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
                        value={values.displayName || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        placeholder="e.g., Safaricom Business Ltd"
                        className={`w-full bg-paper-100 border ${errors.displayName ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none`}
                      />
                      {errors.displayName && <p className="text-[11px] text-rust-700 mt-1">{errors.displayName}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Legal Registered Entity Name
                      </label>
                      <input
                        name="legalName"
                        value={values.legalName || ''}
                        onChange={handleInputChange}
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
                        value={values.category || 'Direct Supplier'}
                        onChange={handleInputChange}
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
                        value={values.contactPerson || ''}
                        onChange={handleInputChange}
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
                        value={values.email || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        placeholder="accounts@vendor.co.ke"
                        className={`w-full bg-paper-100 border ${errors.email ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none`}
                      />
                      {errors.email && <p className="text-[11px] text-rust-700 mt-1">{errors.email}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Phone Number
                      </label>
                      <input
                        name="phone"
                        value={values.phone || ''}
                        onChange={handleInputChange}
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
                        value={values.mpesaNumber || ''}
                        onChange={handleInputChange}
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
                        value={values.paymentTerms || 'Net 30'}
                        onChange={handleInputChange}
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
                        value={values.currency || 'KES'}
                        onChange={handleInputChange}
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
                        value={values.defaultAccountId || ''}
                        onChange={handleInputChange}
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
                          value={values.bankName || ''}
                          onChange={handleInputChange}
                          placeholder="e.g., Standard Chartered"
                          className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-2.5 py-1.5 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Branch</label>
                        <input
                          name="bankBranch"
                          value={values.bankBranch || ''}
                          onChange={handleInputChange}
                          placeholder="e.g., Westlands"
                          className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-2.5 py-1.5 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Account Number</label>
                        <input
                          name="bankAccountNo"
                          value={values.bankAccountNo || ''}
                          onChange={handleInputChange}
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
                        value={values.kraPin || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        placeholder="P051234567Z"
                        className={`w-full bg-paper-100 border ${errors.kraPin ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono uppercase`}
                      />
                      {errors.kraPin && <p className="text-[11px] text-rust-700 mt-1">{errors.kraPin}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        VAT Registration Number
                      </label>
                      <input
                        name="vatNumber"
                        value={values.vatNumber || ''}
                        onChange={handleInputChange}
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
                      value={values.address || ''}
                      onChange={handleInputChange}
                      placeholder="e.g., 5th Floor, Delta Corner Tower A, Chiromo Rd"
                      className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">City</label>
                      <input
                        name="city"
                        value={values.city || 'Nairobi'}
                        onChange={handleInputChange}
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Postal Code</label>
                      <input
                        name="postalCode"
                        value={values.postalCode || '00100'}
                        onChange={handleInputChange}
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Country</label>
                      <input
                        name="country"
                        value={values.country || 'Kenya'}
                        onChange={handleInputChange}
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
                        Customer / Client Name *
                      </label>
                      <input
                        required
                        name="displayName"
                        value={values.displayName || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        placeholder="e.g., Apex Holdings Kenya"
                        className={`w-full bg-paper-100 border ${errors.displayName ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none`}
                      />
                      {errors.displayName && <p className="text-[11px] text-rust-700 mt-1">{errors.displayName}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Legal Business Name
                      </label>
                      <input
                        name="legalName"
                        value={values.legalName || ''}
                        onChange={handleInputChange}
                        placeholder="e.g., Apex Holdings Limited"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Account Type
                      </label>
                      <select
                        name="customerType"
                        value={values.customerType || 'Corporate'}
                        onChange={handleInputChange}
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="Corporate">Corporate / Enterprise</option>
                        <option value="SME">SME / Small Business</option>
                        <option value="Individual">Individual Consumer</option>
                        <option value="Government">Government / NGO</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Contact Person
                      </label>
                      <input
                        name="contactPerson"
                        value={values.contactPerson || ''}
                        onChange={handleInputChange}
                        placeholder="e.g., Alex Kimani"
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
                        value={values.email || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        placeholder="billing@apexholdings.co.ke"
                        className={`w-full bg-paper-100 border ${errors.email ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none`}
                      />
                      {errors.email && <p className="text-[11px] text-rust-700 mt-1">{errors.email}</p>}
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'financial' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Credit Limit (KES)
                      </label>
                      <input
                        name="creditLimit"
                        type="number"
                        step="0.01"
                        min="0"
                        value={values.creditLimit || '0'}
                        onChange={handleInputChange}
                        placeholder="0.00 (0 for unlimited)"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Standard Payment Terms
                      </label>
                      <select
                        name="paymentTerms"
                        value={values.paymentTerms || 'Net 30'}
                        onChange={handleInputChange}
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
                        Default Discount %
                      </label>
                      <input
                        name="discountPercent"
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={values.discountPercent || '0'}
                        onChange={handleInputChange}
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
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
                        KRA PIN Number
                      </label>
                      <input
                        name="kraPin"
                        value={values.kraPin || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        placeholder="A012345678Z"
                        className={`w-full bg-paper-100 border ${errors.kraPin ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono uppercase`}
                      />
                      {errors.kraPin && <p className="text-[11px] text-rust-700 mt-1">{errors.kraPin}</p>}
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
                      value={values.billingAddress || ''}
                      onChange={handleInputChange}
                      placeholder="e.g., Riverside Green Square, Building B"
                      className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* ========================================================================= */}
          {/* 4. EMPLOYEE / STAFF FORM                                                  */}
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
                        value={values.firstName || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        placeholder="e.g., Kevin"
                        className={`w-full bg-paper-100 border ${errors.firstName ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none`}
                      />
                      {errors.firstName && <p className="text-[11px] text-rust-700 mt-1">{errors.firstName}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Middle Name
                      </label>
                      <input
                        name="middleName"
                        value={values.middleName || ''}
                        onChange={handleInputChange}
                        placeholder="e.g., Omondi"
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
                        value={values.lastName || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        placeholder="e.g., Mwangi"
                        className={`w-full bg-paper-100 border ${errors.lastName ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none`}
                      />
                      {errors.lastName && <p className="text-[11px] text-rust-700 mt-1">{errors.lastName}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        National ID / Passport No.
                      </label>
                      <input
                        name="nationalId"
                        value={values.nationalId || ''}
                        onChange={handleInputChange}
                        placeholder="e.g., 28941029"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Job Title
                      </label>
                      <input
                        name="jobTitle"
                        value={values.jobTitle || ''}
                        onChange={handleInputChange}
                        placeholder="e.g., Financial Accountant"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Department
                      </label>
                      <select
                        name="department"
                        value={values.department || 'Finance & Accounting'}
                        onChange={handleInputChange}
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="Finance & Accounting">Finance & Accounting</option>
                        <option value="Engineering & IT">Engineering & IT</option>
                        <option value="Sales & Business Dev">Sales & Business Dev</option>
                        <option value="Operations & Logistics">Operations & Logistics</option>
                        <option value="Human Resources">Human Resources</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'financial' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Base Monthly Salary (KES) *
                      </label>
                      <input
                        required
                        name="baseSalary"
                        type="number"
                        step="0.01"
                        min="0"
                        value={values.baseSalary || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        placeholder="0.00"
                        className={`w-full bg-paper-100 border ${errors.baseSalary ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency`}
                      />
                      {errors.baseSalary && <p className="text-[11px] text-rust-700 mt-1">{errors.baseSalary}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Housing Allowance (KES)
                      </label>
                      <input
                        name="housingAllowance"
                        type="number"
                        step="0.01"
                        min="0"
                        value={values.housingAllowance || '0'}
                        onChange={handleInputChange}
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
                        step="0.01"
                        min="0"
                        value={values.transportAllowance || '0'}
                        onChange={handleInputChange}
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none tabular-currency"
                      />
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
                        name="kraPin"
                        value={values.kraPin || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        placeholder="A012345678Z"
                        className={`w-full bg-paper-100 border ${errors.kraPin ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono uppercase`}
                      />
                      {errors.kraPin && <p className="text-[11px] text-rust-700 mt-1">{errors.kraPin}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        NSSF Member Number
                      </label>
                      <input
                        name="nssfNumber"
                        value={values.nssfNumber || ''}
                        onChange={handleInputChange}
                        placeholder="e.g., 00192841"
                        className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        SHIF / NHIF Number
                      </label>
                      <input
                        name="shifNumber"
                        value={values.shifNumber || ''}
                        onChange={handleInputChange}
                        placeholder="e.g., 8839210"
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Account Code (GL Number) *
                  </label>
                  <input
                    required
                    name="code"
                    value={values.code || ''}
                    onChange={handleInputChange}
                    onBlur={handleBlur}
                    placeholder="e.g. 5210"
                    className={`w-full bg-paper-100 border ${errors.code ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none font-mono`}
                  />
                  {errors.code && <p className="text-[11px] text-rust-700 mt-1">{errors.code}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Account Name *
                  </label>
                  <input
                    required
                    name="name"
                    value={values.name || ''}
                    onChange={handleInputChange}
                    onBlur={handleBlur}
                    placeholder="e.g., Software & Cloud Subscriptions"
                    className={`w-full bg-paper-100 border ${errors.name ? 'border-rust-700' : 'border-ink-900/20'} text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none`}
                  />
                  {errors.name && <p className="text-[11px] text-rust-700 mt-1">{errors.name}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Classification Category *
                  </label>
                  <select
                    name="type"
                    value={values.type || 'EXPENSE'}
                    onChange={handleInputChange}
                    className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                  >
                    <option value="ASSET">ASSET (Debit Normal)</option>
                    <option value="LIABILITY">LIABILITY (Credit Normal)</option>
                    <option value="EQUITY">EQUITY (Credit Normal)</option>
                    <option value="INCOME">INCOME (Credit Normal)</option>
                    <option value="EXPENSE">EXPENSE (Debit Normal)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Subtype Classification
                  </label>
                  <input
                    name="subtype"
                    value={values.subtype || ''}
                    onChange={handleInputChange}
                    placeholder="e.g., Operating Expense / Current Asset"
                    className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Description / Purpose
                </label>
                <textarea
                  name="description"
                  rows={3}
                  value={values.description || ''}
                  onChange={handleInputChange}
                  placeholder="Internal audit and financial accounting guidelines for this ledger code..."
                  className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none resize-none"
                />
              </div>
            </div>
          )}

          {/* Footer Controls */}
          <div className="flex justify-between items-center pt-5 border-t border-ink-900/10 mt-6">
            <div className="text-xs text-slate-400">
              {isDirty ? (
                <span className="text-amber-700 dark:text-amber-400 font-medium">● Form has unsaved edits (Draft auto-saved)</span>
              ) : (
                <span>All changes saved</span>
              )}
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-ink-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-ink-900 text-white  px-5 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors disabled:opacity-50 flex items-center space-x-2"
              >
                <span>{createMutation.isPending ? 'Saving Record...' : `Create ${selectedType.charAt(0) + selectedType.slice(1).toLowerCase()}`}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
