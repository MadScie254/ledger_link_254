import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { useEntityForm, EntityType } from '../../hooks/useEntityForm';
import { formatCurrency } from '../../utils/currency';
import { Dialog } from '../ledger/Dialog';
import { Amount } from '../ledger/Amount';
import { buttonClass } from '../ledger/Page';

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

  const TYPE_NAME: Record<string, string> = { ITEM: 'stock item', VENDOR: 'vendor', CUSTOMER: 'customer', EMPLOYEE: 'employee', ACCOUNT: 'account' };
  const subTabs: { id: typeof activeSubTab; name: string; show: boolean }[] = [
    { id: 'general', name: 'Details', show: true },
    { id: 'financial', name: selectedType === 'ITEM' ? 'Pricing' : selectedType === 'EMPLOYEE' ? 'Pay' : 'Terms', show: ['ITEM', 'VENDOR', 'CUSTOMER', 'EMPLOYEE'].includes(selectedType) },
    { id: 'tax', name: 'Tax and KRA', show: ['ITEM', 'VENDOR', 'CUSTOMER', 'EMPLOYEE'].includes(selectedType) },
    { id: 'address', name: 'Address', show: ['VENDOR', 'CUSTOMER'].includes(selectedType) },
  ];

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      width="xl"
      title={`New ${TYPE_NAME[selectedType] || 'record'}`}
      note={isDirty ? 'Your entries are kept as a draft on this device until you save or discard them.' : undefined}
      footer={
        <>
          {serverError && (
            <p role="alert" className="mr-auto text-[13px] text-ledger-red">
              {serverError}
            </p>
          )}
          <button type="button" onClick={onClose} className={buttonClass.secondary}>
            Cancel
          </button>
          <button type="submit" form="quick-add-form" disabled={createMutation.isPending} className={buttonClass.primary}>
            {createMutation.isPending ? 'Saving' : `Save ${TYPE_NAME[selectedType] || 'record'}`}
          </button>
        </>
      }
    >
      <div className="-mt-1 mb-4 flex flex-col gap-3 border-b border-feint sm:flex-row sm:items-end sm:justify-between">
        <div className="flex gap-4 overflow-x-auto text-[13px]" role="tablist" aria-label="Sections">
          {subTabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeSubTab === t.id}
                onClick={() => setActiveSubTab(t.id)}
                className={`-mb-px whitespace-nowrap border-b-2 py-2 ${activeSubTab === t.id ? 'border-oxblood font-semibold text-ink-900' : 'border-transparent text-graphite-600 hover:text-ink-900'}`}
              >
                {t.name}
              </button>
            ))}
        </div>
        {!overrideType && (
          <label className="mb-2 flex items-center gap-2 text-[12.5px] text-graphite-600">
            Record
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value as EntityType);
                setActiveSubTab('general');
                setServerError(null);
              }}
              className="h-8 border px-2 text-[13px] text-ink-900"
            >
              <option value="ITEM">Stock item</option>
              <option value="VENDOR">Vendor</option>
              <option value="CUSTOMER">Customer</option>
              <option value="EMPLOYEE">Employee</option>
              <option value="ACCOUNT">Account</option>
            </select>
          </label>
        )}
      </div>

      {hasRecoveredDraft && isDirty && (
        <p className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-y border-feint py-2 text-[13px] text-ink-900">
          <span>Your unsaved {TYPE_NAME[selectedType] || 'record'} from earlier has been put back.</span>
          <button type="button" onClick={discardDraft} className={buttonClass.quiet}>
            Discard it
          </button>
        </p>
      )}

        <form id="quick-add-form" onSubmit={handleSubmit} className="space-y-5">
          {/* ========================================================================= */}
          {/* 1. INVENTORY ITEM FORM                                                    */}
          {/* ========================================================================= */}
          {selectedType === 'ITEM' && (
            <>
              {activeSubTab === 'general' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                      <label htmlFor="qa-name-0" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Item name
                      </label>
                      <input
                        required
                        id="qa-name-0" name="name"
                        value={values.name || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.name ? 'border-ledger-red' : ''} h-10 px-3 text-[14px]`}
                      />
                      {errors.name && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.name}</p>}
                    </div>
                    <div>
                      <label htmlFor="qa-itemType-1" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Kind of item
                      </label>
                      <select
                        id="qa-itemType-1" name="itemType"
                        value={values.itemType || 'Physical Product'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      >
                        <option value="Physical Product">Stocked goods</option>
                        <option value="Digital Service">Service, not stocked</option>
                        <option value="Raw Material">Raw material</option>
                        <option value="Consumable">Consumable</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="qa-sku-2" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        SKU
                      </label>
                      <input
                        id="qa-sku-2" name="sku"
                        value={values.sku || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] ll-figure"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-barcode-3" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Barcode
                      </label>
                      <input
                        id="qa-barcode-3" name="barcode"
                        value={values.barcode || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] ll-figure"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-category-4" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Category
                      </label>
                      <input
                        id="qa-category-4" name="category"
                        value={values.category || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="qa-unitOfMeasure-5" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Unit
                      </label>
                      <select
                        id="qa-unitOfMeasure-5" name="unitOfMeasure"
                        value={values.unitOfMeasure || 'Units'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      >
                        <option value="Units">Pieces</option>
                        <option value="Hours">Hours</option>
                        <option value="Kilograms">Kilograms</option>
                        <option value="Meters">Metres</option>
                        <option value="Boxes">Boxes</option>
                        <option value="Liters">Litres</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="qa-location-6" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Where it is kept
                      </label>
                      <input
                        id="qa-location-6" name="location"
                        value={values.location || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-preferredVendorId-7" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Usual supplier
                      </label>
                      <select
                        id="qa-preferredVendorId-7" name="preferredVendorId"
                        value={values.preferredVendorId || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      >
                        <option value="">None</option>
                        {vendors.map((v: any) => (
                          <option key={v.id} value={v.id}>{v.displayName}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="qa-description-8" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                      Description
                    </label>
                    <textarea
                      id="qa-description-8" name="description"
                      rows={3}
                      value={values.description || ''}
                      onChange={handleInputChange}
                      className="w-full border px-3 py-2 text-[14px] resize-none"
                    />
                  </div>
                </div>
              )}

              {activeSubTab === 'financial' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="qa-price-9" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Selling price (KES)
                      </label>
                      <input
                        required
                        id="qa-price-9" name="price"
                        type="number"
                        step="0.01"
                        min="0"
                        value={values.price || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.price ? 'border-ledger-red' : ''} h-10 px-3 text-[14px] text-right tabular-currency text-ink-blue`}
                      />
                      {errors.price && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.price}</p>}
                    </div>
                    <div>
                      <label htmlFor="qa-cost-10" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Cost price (KES)
                      </label>
                      <input
                        required
                        id="qa-cost-10" name="cost"
                        type="number"
                        step="0.01"
                        min="0"
                        value={values.cost || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.cost ? 'border-ledger-red' : ''} h-10 px-3 text-[14px] text-right tabular-currency text-ink-blue`}
                      />
                      {errors.cost && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.cost}</p>}
                    </div>
                  </div>

                  {/* Profit Margin Preview Card */}
                  <div className="ll-margin flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 p-3.5 text-[13px]" aria-live="polite">
                    <p>
                      <span className="text-graphite-600">Gross margin </span>
                      <span className="ll-figure font-semibold text-ink-900">{marginPct}%</span>
                    </p>
                    <p className="inline-flex items-baseline gap-1.5">
                      <span className="text-graphite-600">Profit per unit</span>
                      <Amount cents={Math.round(unitProfit * 100)} tone="result" size="sm" />
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="qa-incomeAccountId-11" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Income account
                      </label>
                      <select
                        id="qa-incomeAccountId-11" name="incomeAccountId"
                        value={values.incomeAccountId || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      >
                        <option value="">Default: 4000 - Sales Revenue</option>
                        {incomeAccounts.map((a: any) => (
                          <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="qa-expenseAccountId-12" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Cost of sales account
                      </label>
                      <select
                        id="qa-expenseAccountId-12" name="expenseAccountId"
                        value={values.expenseAccountId || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      >
                        <option value="">Default: 5000 - Cost of Goods Sold</option>
                        {expenseAccounts.map((a: any) => (
                          <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div>
                      <label htmlFor="qa-quantityOnHand-13" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Opening quantity
                      </label>
                      <input
                        id="qa-quantityOnHand-13" name="quantityOnHand"
                        type="number"
                        min="0"
                        value={values.quantityOnHand || '0'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-reorderPoint-14" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Reorder point
                      </label>
                      <input
                        required
                        id="qa-reorderPoint-14" name="reorderPoint"
                        type="number"
                        min="0"
                        value={values.reorderPoint || '5'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-targetStock-15" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Target stock level
                      </label>
                      <input
                        id="qa-targetStock-15" name="targetStock"
                        type="number"
                        min="0"
                        value={values.targetStock || '20'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'tax' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="qa-taxRate-16" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        VAT rate
                      </label>
                      <select
                        id="qa-taxRate-16" name="taxRate"
                        value={values.taxRate || '16'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      >
                        <option value="16">16%, standard rate</option>
                        <option value="8">8%, petroleum</option>
                        <option value="0">0%, zero-rated</option>
                        <option value="-1">Exempt</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="qa-notes-17" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        eTIMS item code (HS code)
                      </label>
                      <input
                        id="qa-notes-17" name="notes"
                        value={values.notes || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] ll-figure"
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
                      <label htmlFor="qa-displayName-18" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Trading name
                      </label>
                      <input
                        required
                        id="qa-displayName-18" name="displayName"
                        value={values.displayName || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.displayName ? 'border-ledger-red' : ''} h-10 px-3 text-[14px]`}
                      />
                      {errors.displayName && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.displayName}</p>}
                    </div>
                    <div>
                      <label htmlFor="qa-legalName-19" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Registered name
                      </label>
                      <input
                        id="qa-legalName-19" name="legalName"
                        value={values.legalName || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="qa-category-20" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Kind of supplier
                      </label>
                      <select
                        id="qa-category-20" name="category"
                        value={values.category || 'Direct Supplier'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      >
                        <option value="Direct Supplier">Stock supplier</option>
                        <option value="Professional Services">Professional services</option>
                        <option value="Utilities & Telecoms">Utilities & Telecoms</option>
                        <option value="Logistics & Transport">Logistics & Transport</option>
                        <option value="Equipment & Rent">Equipment and leases</option>
                        <option value="Marketing & Media">Marketing & Media</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="qa-contactPerson-21" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Contact person
                      </label>
                      <input
                        id="qa-contactPerson-21" name="contactPerson"
                        value={values.contactPerson || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-email-22" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Email
                      </label>
                      <input
                        id="qa-email-22" name="email"
                        type="email"
                        value={values.email || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.email ? 'border-ledger-red' : ''} h-10 px-3 text-[14px]`}
                      />
                      {errors.email && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.email}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="qa-phone-23" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Phone
                      </label>
                      <input
                        id="qa-phone-23" name="phone"
                        value={values.phone || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-mpesaNumber-24" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        M-Pesa till or paybill
                      </label>
                      <input
                        id="qa-mpesaNumber-24" name="mpesaNumber"
                        value={values.mpesaNumber || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] ll-figure"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'financial' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="qa-paymentTerms-25" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Payment terms
                      </label>
                      <select
                        id="qa-paymentTerms-25" name="paymentTerms"
                        value={values.paymentTerms || 'Net 30'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      >
                        <option value="Due on Receipt">On receipt</option>
                        <option value="Net 15">15 days</option>
                        <option value="Net 30">30 days</option>
                        <option value="Net 60">60 days</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="qa-currency-26" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Currency
                      </label>
                      <select
                        id="qa-currency-26" name="currency"
                        value={values.currency || 'KES'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] ll-figure"
                      >
                        <option value="KES">KES · Kenyan Shilling</option>
                        <option value="USD">USD · US Dollar</option>
                        <option value="EUR">EUR · Euro</option>
                        <option value="GBP">GBP · British Pound</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="qa-defaultAccountId-27" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Usual expense account
                      </label>
                      <select
                        id="qa-defaultAccountId-27" name="defaultAccountId"
                        value={values.defaultAccountId || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      >
                        <option value="">Choose an account</option>
                        {expenseAccounts.map((a: any) => (
                          <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="ll-margin p-4 space-y-3">
                    <h4 className="text-[13.5px] font-semibold text-ink-900">
                      Bank Settlement Details
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label htmlFor="qa-bankName-b0" className="block text-[12.5px] text-graphite-600 mb-1">Bank</label>
                        <input
                          id="qa-bankName-b0" name="bankName"
                          value={values.bankName || ''}
                          onChange={handleInputChange}
                          className="w-full h-9 border px-2.5 text-[13.5px]"
                        />
                      </div>
                      <div>
                        <label htmlFor="qa-bankBranch-b1" className="block text-[12.5px] text-graphite-600 mb-1">Branch</label>
                        <input
                          id="qa-bankBranch-b1" name="bankBranch"
                          value={values.bankBranch || ''}
                          onChange={handleInputChange}
                          className="w-full h-9 border px-2.5 text-[13.5px]"
                        />
                      </div>
                      <div>
                        <label htmlFor="qa-bankAccountNo-b2" className="block text-[12.5px] text-graphite-600 mb-1">Account number</label>
                        <input
                          id="qa-bankAccountNo-b2" name="bankAccountNo"
                          value={values.bankAccountNo || ''}
                          onChange={handleInputChange}
                          className="w-full h-9 border px-2.5 text-[13.5px] ll-figure"
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
                      <label htmlFor="qa-kraPin-28" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        KRA PIN
                      </label>
                      <input
                        id="qa-kraPin-28" name="kraPin"
                        value={values.kraPin || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.kraPin ? 'border-ledger-red' : ''} h-10 px-3 text-[14px] ll-figure uppercase`}
                      />
                      {errors.kraPin && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.kraPin}</p>}
                    </div>
                    <div>
                      <label htmlFor="qa-vatNumber-29" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        VAT number
                      </label>
                      <input
                        id="qa-vatNumber-29" name="vatNumber"
                        value={values.vatNumber || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] ll-figure"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'address' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="qa-address-30" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                      Street and building
                    </label>
                    <input
                      id="qa-address-30" name="address"
                      value={values.address || ''}
                      onChange={handleInputChange}
                      className="w-full h-10 border px-3 text-[14px]"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="qa-city-31" className="block text-[13px] font-semibold text-ink-900 mb-1.5">Town or city</label>
                      <input
                        id="qa-city-31" name="city"
                        value={values.city || 'Nairobi'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-postalCode-32" className="block text-[13px] font-semibold text-ink-900 mb-1.5">Postal code</label>
                      <input
                        id="qa-postalCode-32" name="postalCode"
                        value={values.postalCode || '00100'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-country-33" className="block text-[13px] font-semibold text-ink-900 mb-1.5">Country</label>
                      <input
                        id="qa-country-33" name="country"
                        value={values.country || 'Kenya'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
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
                      <label htmlFor="qa-displayName-34" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Customer name
                      </label>
                      <input
                        required
                        id="qa-displayName-34" name="displayName"
                        value={values.displayName || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.displayName ? 'border-ledger-red' : ''} h-10 px-3 text-[14px]`}
                      />
                      {errors.displayName && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.displayName}</p>}
                    </div>
                    <div>
                      <label htmlFor="qa-legalName-35" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Registered name
                      </label>
                      <input
                        id="qa-legalName-35" name="legalName"
                        value={values.legalName || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="qa-customerType-36" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Kind of customer
                      </label>
                      <select
                        id="qa-customerType-36" name="customerType"
                        value={values.customerType || 'Corporate'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      >
                        <option value="Corporate">Company</option>
                        <option value="SME">Small business</option>
                        <option value="Individual">Individual</option>
                        <option value="Government">Government or NGO</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="qa-contactPerson-37" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Contact person
                      </label>
                      <input
                        id="qa-contactPerson-37" name="contactPerson"
                        value={values.contactPerson || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-email-38" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Email
                      </label>
                      <input
                        id="qa-email-38" name="email"
                        type="email"
                        value={values.email || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.email ? 'border-ledger-red' : ''} h-10 px-3 text-[14px]`}
                      />
                      {errors.email && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.email}</p>}
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'financial' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="qa-creditLimit-39" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Credit limit (KES)
                      </label>
                      <input
                        id="qa-creditLimit-39" name="creditLimit"
                        type="number"
                        step="0.01"
                        min="0"
                        value={values.creditLimit || '0'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] text-right tabular-currency text-ink-blue"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-paymentTerms-40" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Payment terms
                      </label>
                      <select
                        id="qa-paymentTerms-40" name="paymentTerms"
                        value={values.paymentTerms || 'Net 30'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      >
                        <option value="Due on Receipt">On receipt</option>
                        <option value="Net 15">15 days</option>
                        <option value="Net 30">30 days</option>
                        <option value="Net 60">60 days</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="qa-discountPercent-41" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Usual discount (%)
                      </label>
                      <input
                        id="qa-discountPercent-41" name="discountPercent"
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={values.discountPercent || '0'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] ll-figure"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'tax' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="qa-kraPin-42" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        KRA PIN
                      </label>
                      <input
                        id="qa-kraPin-42" name="kraPin"
                        value={values.kraPin || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.kraPin ? 'border-ledger-red' : ''} h-10 px-3 text-[14px] ll-figure uppercase`}
                      />
                      {errors.kraPin && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.kraPin}</p>}
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'address' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="qa-billingAddress-43" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                      Billing address
                    </label>
                    <input
                      id="qa-billingAddress-43" name="billingAddress"
                      value={values.billingAddress || ''}
                      onChange={handleInputChange}
                      className="w-full h-10 border px-3 text-[14px]"
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
                      <label htmlFor="qa-firstName-44" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        First name
                      </label>
                      <input
                        required
                        id="qa-firstName-44" name="firstName"
                        value={values.firstName || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.firstName ? 'border-ledger-red' : ''} h-10 px-3 text-[14px]`}
                      />
                      {errors.firstName && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.firstName}</p>}
                    </div>
                    <div>
                      <label htmlFor="qa-middleName-45" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Middle name
                      </label>
                      <input
                        id="qa-middleName-45" name="middleName"
                        value={values.middleName || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-lastName-46" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Last name
                      </label>
                      <input
                        required
                        id="qa-lastName-46" name="lastName"
                        value={values.lastName || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.lastName ? 'border-ledger-red' : ''} h-10 px-3 text-[14px]`}
                      />
                      {errors.lastName && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.lastName}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="qa-nationalId-47" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        National ID or passport
                      </label>
                      <input
                        id="qa-nationalId-47" name="nationalId"
                        value={values.nationalId || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] ll-figure"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-jobTitle-48" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Job title
                      </label>
                      <input
                        id="qa-jobTitle-48" name="jobTitle"
                        value={values.jobTitle || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-department-49" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Department
                      </label>
                      <select
                        id="qa-department-49" name="department"
                        value={values.department || 'Finance & Accounting'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px]"
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
                      <label htmlFor="qa-baseSalary-50" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Basic monthly salary (KES)
                      </label>
                      <input
                        required
                        id="qa-baseSalary-50" name="baseSalary"
                        type="number"
                        step="0.01"
                        min="0"
                        value={values.baseSalary || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.baseSalary ? 'border-ledger-red' : ''} h-10 px-3 text-[14px] text-right tabular-currency text-ink-blue`}
                      />
                      {errors.baseSalary && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.baseSalary}</p>}
                    </div>
                    <div>
                      <label htmlFor="qa-housingAllowance-51" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Housing allowance (KES)
                      </label>
                      <input
                        id="qa-housingAllowance-51" name="housingAllowance"
                        type="number"
                        step="0.01"
                        min="0"
                        value={values.housingAllowance || '0'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] text-right tabular-currency text-ink-blue"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-transportAllowance-52" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        Transport allowance (KES)
                      </label>
                      <input
                        id="qa-transportAllowance-52" name="transportAllowance"
                        type="number"
                        step="0.01"
                        min="0"
                        value={values.transportAllowance || '0'}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] text-right tabular-currency text-ink-blue"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSubTab === 'tax' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="qa-kraPin-53" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        KRA PIN
                      </label>
                      <input
                        id="qa-kraPin-53" name="kraPin"
                        value={values.kraPin || ''}
                        onChange={handleInputChange}
                        onBlur={handleBlur}
                        className={`w-full border ${errors.kraPin ? 'border-ledger-red' : ''} h-10 px-3 text-[14px] ll-figure uppercase`}
                      />
                      {errors.kraPin && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.kraPin}</p>}
                    </div>
                    <div>
                      <label htmlFor="qa-nssfNumber-54" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        NSSF number
                      </label>
                      <input
                        id="qa-nssfNumber-54" name="nssfNumber"
                        value={values.nssfNumber || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] ll-figure"
                      />
                    </div>
                    <div>
                      <label htmlFor="qa-shifNumber-55" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                        SHIF number
                      </label>
                      <input
                        id="qa-shifNumber-55" name="shifNumber"
                        value={values.shifNumber || ''}
                        onChange={handleInputChange}
                        className="w-full h-10 border px-3 text-[14px] ll-figure"
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
                  <label htmlFor="qa-code-56" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                    Account code
                  </label>
                  <input
                    required
                    id="qa-code-56" name="code"
                    value={values.code || ''}
                    onChange={handleInputChange}
                    onBlur={handleBlur}
                    className={`w-full border ${errors.code ? 'border-ledger-red' : ''} h-10 px-3 text-[14px] ll-figure`}
                  />
                  {errors.code && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.code}</p>}
                </div>
                <div>
                  <label htmlFor="qa-name-57" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                    Account name
                  </label>
                  <input
                    required
                    id="qa-name-57" name="name"
                    value={values.name || ''}
                    onChange={handleInputChange}
                    onBlur={handleBlur}
                    className={`w-full border ${errors.name ? 'border-ledger-red' : ''} h-10 px-3 text-[14px]`}
                  />
                  {errors.name && <p className="mt-1 text-[12.5px] text-ledger-red">{errors.name}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="qa-type-58" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                    Type
                  </label>
                  <select
                    id="qa-type-58" name="type"
                    value={values.type || 'EXPENSE'}
                    onChange={handleInputChange}
                    className="w-full h-10 border px-3 text-[14px]"
                  >
                    <option value="ASSET">Asset</option>
                    <option value="LIABILITY">Liability</option>
                    <option value="EQUITY">Equity</option>
                    <option value="INCOME">Income</option>
                    <option value="EXPENSE">Expense</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="qa-subtype-59" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                    Subtype
                  </label>
                  <input
                    id="qa-subtype-59" name="subtype"
                    value={values.subtype || ''}
                    onChange={handleInputChange}
                    className="w-full h-10 border px-3 text-[14px]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="qa-description-60" className="block text-[13px] font-semibold text-ink-900 mb-1.5">
                  What it is for
                </label>
                <textarea
                  id="qa-description-60" name="description"
                  rows={3}
                  value={values.description || ''}
                  onChange={handleInputChange}
                  className="w-full border px-3 py-2 text-[14px] resize-none"
                />
              </div>
            </div>
          )}

        </form>
    </Dialog>
  );
}
