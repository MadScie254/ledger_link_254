import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../store';

export type EntityType = 
  | 'ITEM' 
  | 'VENDOR' 
  | 'CUSTOMER' 
  | 'EMPLOYEE' 
  | 'ACCOUNT' 
  | 'BILL' 
  | 'INVOICE' 
  | 'TRANSACTION';

export interface ValidationRule<T = any> {
  validate: (value: any, formValues: T) => boolean;
  message: string;
}

export type EntityValidationRules<T = any> = {
  [K in keyof T]?: ValidationRule<T>[];
};

// Default initial states per entity type
export const defaultEntityValues: Record<EntityType, Record<string, any>> = {
  ITEM: {
    name: '',
    itemType: 'Physical Product',
    sku: '',
    barcode: '',
    category: '',
    unitOfMeasure: 'Units',
    description: '',
    price: '',
    cost: '',
    taxRate: '16',
    incomeAccountId: '',
    expenseAccountId: '',
    quantityOnHand: '0',
    reorderPoint: '5',
    targetStock: '20',
    preferredVendorId: '',
    location: '',
    notes: ''
  },
  VENDOR: {
    displayName: '',
    legalName: '',
    vendorType: 'Direct Supplier',
    contactPerson: '',
    email: '',
    phone: '',
    kraPin: '',
    vatNumber: '',
    category: 'Direct Supplier',
    paymentTerms: 'Net 30',
    currency: 'KES',
    defaultAccountId: '',
    paymentMethod: 'Bank Transfer',
    bankName: '',
    bankAccountNo: '',
    bankBranch: '',
    mpesaNumber: '',
    address: '',
    city: 'Nairobi',
    postalCode: '00100',
    country: 'Kenya',
    notes: ''
  },
  CUSTOMER: {
    displayName: '',
    legalName: '',
    customerType: 'Corporate',
    contactPerson: '',
    email: '',
    phone: '',
    kraPin: '',
    paymentTerms: 'Net 30',
    creditLimit: '0',
    discountPercent: '0',
    priceTier: 'Standard',
    currency: 'KES',
    billingAddress: '',
    shippingAddress: '',
    city: 'Nairobi',
    postalCode: '00100',
    country: 'Kenya',
    notes: ''
  },
  EMPLOYEE: {
    firstName: '',
    middleName: '',
    lastName: '',
    nationalId: '',
    email: '',
    phone: '',
    jobTitle: '',
    department: 'Operations',
    employmentType: 'Full-Time',
    hireDate: new Date().toISOString().split('T')[0],
    kraPin: '',
    nssfNumber: '',
    shifNumber: '',
    baseSalary: '',
    housingAllowance: '0',
    transportAllowance: '0',
    bankName: '',
    bankAccountNo: '',
    mpesaNumber: ''
  },
  ACCOUNT: {
    code: '',
    name: '',
    type: 'EXPENSE',
    subtype: 'Operating Expense',
    parentId: '',
    description: ''
  },
  BILL: {
    vendorId: '',
    billNumber: '',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    currency: 'KES',
    notes: '',
    amount: ''
  },
  INVOICE: {
    customerId: '',
    invoiceNumber: '',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    currency: 'KES',
    notes: '',
    amount: ''
  },
  TRANSACTION: {
    accountId: '',
    type: 'DEBIT',
    amount: '',
    category: 'General',
    reference: '',
    date: new Date().toISOString().split('T')[0],
    description: ''
  }
};

// Kenyan KRA PIN format: Letter + 9 digits + Letter (e.g., A001234567Z or P051234567Z)
const KRA_PIN_REGEX = /^[A-Z][0-9]{9}[A-Z]$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Standard Validation Rules per Entity Type
export const entityValidationRules: Record<EntityType, EntityValidationRules> = {
  ITEM: {
    name: [
      { validate: (v) => !!v && String(v).trim().length >= 2, message: 'Item name is required (min 2 characters)' }
    ],
    price: [
      { validate: (v) => v !== '' && !isNaN(Number(v)) && Number(v) >= 0, message: 'Selling price must be a valid positive number' }
    ],
    cost: [
      { validate: (v) => v === '' || (!isNaN(Number(v)) && Number(v) >= 0), message: 'Cost price must be non-negative' }
    ],
    quantityOnHand: [
      { validate: (v) => v === '' || (!isNaN(Number(v)) && Number(v) >= 0), message: 'Quantity on hand cannot be negative' }
    ],
    reorderPoint: [
      { validate: (v) => v === '' || (!isNaN(Number(v)) && Number(v) >= 0), message: 'Reorder point must be non-negative' }
    ]
  },
  VENDOR: {
    displayName: [
      { validate: (v) => !!v && String(v).trim().length >= 2, message: 'Vendor / Company name is required' }
    ],
    email: [
      { validate: (v) => !v || EMAIL_REGEX.test(String(v)), message: 'Invalid email address format' }
    ],
    kraPin: [
      { validate: (v) => !v || KRA_PIN_REGEX.test(String(v).trim()), message: 'KRA PIN format must be 1 letter, 9 digits, 1 letter (e.g. P051234567Z)' }
    ]
  },
  CUSTOMER: {
    displayName: [
      { validate: (v) => !!v && String(v).trim().length >= 2, message: 'Customer name is required' }
    ],
    email: [
      { validate: (v) => !v || EMAIL_REGEX.test(String(v)), message: 'Invalid email address format' }
    ],
    creditLimit: [
      { validate: (v) => v === '' || (!isNaN(Number(v)) && Number(v) >= 0), message: 'Credit limit must be a positive number' }
    ],
    kraPin: [
      { validate: (v) => !v || KRA_PIN_REGEX.test(String(v).trim()), message: 'KRA PIN format must be 1 letter, 9 digits, 1 letter (e.g. A012345678Z)' }
    ]
  },
  EMPLOYEE: {
    firstName: [
      { validate: (v) => !!v && String(v).trim().length >= 1, message: 'First name is required' }
    ],
    lastName: [
      { validate: (v) => !!v && String(v).trim().length >= 1, message: 'Last name is required' }
    ],
    baseSalary: [
      { validate: (v) => !!v && !isNaN(Number(v)) && Number(v) > 0, message: 'Base monthly salary is required' }
    ],
    email: [
      { validate: (v) => !v || EMAIL_REGEX.test(String(v)), message: 'Invalid email address format' }
    ],
    kraPin: [
      { validate: (v) => !v || KRA_PIN_REGEX.test(String(v).trim()), message: 'Employee KRA PIN must be valid (e.g. A012345678Z)' }
    ]
  },
  ACCOUNT: {
    code: [
      { validate: (v) => !!v && /^\d{3,6}$/.test(String(v).trim()), message: 'Account code must be 3 to 6 digits (e.g. 1000, 4000)' }
    ],
    name: [
      { validate: (v) => !!v && String(v).trim().length >= 2, message: 'Account name is required' }
    ],
    type: [
      { validate: (v) => !!v, message: 'Account type classification is required' }
    ]
  },
  BILL: {
    vendorId: [
      { validate: (v) => !!v, message: 'Please select a vendor' }
    ],
    billNumber: [
      { validate: (v) => !!v && String(v).trim().length > 0, message: 'Bill number is required' }
    ]
  },
  INVOICE: {
    customerId: [
      { validate: (v) => !!v, message: 'Please select a customer' }
    ],
    invoiceNumber: [
      { validate: (v) => !!v && String(v).trim().length > 0, message: 'Invoice number is required' }
    ]
  },
  TRANSACTION: {
    accountId: [
      { validate: (v) => !!v, message: 'Please select an account' }
    ],
    amount: [
      { validate: (v) => !!v && !isNaN(Number(v)) && Number(v) > 0, message: 'Amount must be greater than 0' }
    ]
  }
};

/**
 * Custom Unified Hook for Form Data Management
 * - Tracks form values & changes
 * - Tracks `isDirty` state and individual `dirtyFields`
 * - Performs real-time & on-submit validation per entity type
 * - Persists and recovers drafts in sessionStorage to prevent accidental data loss
 */
export function useEntityForm<T extends Record<string, any>>(
  entityType: EntityType,
  customInitialValues?: Partial<T>,
  options: {
    autoSaveDraft?: boolean;
    storageKeyPrefix?: string;
  } = {}
) {
  const { currentOrgId } = useAppStore();
  const autoSave = options.autoSaveDraft !== false;
  const draftKey = `ledgerline_draft_${options.storageKeyPrefix || ''}_${entityType}_${currentOrgId}`;

  // Initial baseline calculation
  const initialBaseValues = useMemo(() => {
    return {
      ...(defaultEntityValues[entityType] || {}),
      ...(customInitialValues || {})
    } as T;
  }, [entityType, customInitialValues]);

  // Load from draft if available
  const [values, setValues] = useState<T>(() => {
    if (autoSave && typeof window !== 'undefined') {
      try {
        const savedDraft = sessionStorage.getItem(draftKey);
        if (savedDraft) {
          const parsed = JSON.parse(savedDraft);
          return { ...initialBaseValues, ...parsed };
        }
      } catch (e) {
        console.warn('Failed to load form draft', e);
      }
    }
    return initialBaseValues;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [hasRecoveredDraft, setHasRecoveredDraft] = useState<boolean>(() => {
    if (autoSave && typeof window !== 'undefined') {
      return !!sessionStorage.getItem(draftKey);
    }
    return false;
  });

  // Calculate dirty fields and overall isDirty
  const { isDirty, dirtyFields } = useMemo(() => {
    const dirty: Record<string, boolean> = {};
    let isAnyDirty = false;

    Object.keys(values).forEach((key) => {
      const currentVal = values[key];
      const initialVal = (initialBaseValues as any)[key];
      
      const currentNorm = currentVal === undefined || currentVal === null ? '' : String(currentVal).trim();
      const initialNorm = initialVal === undefined || initialVal === null ? '' : String(initialVal).trim();

      if (currentNorm !== initialNorm) {
        dirty[key] = true;
        isAnyDirty = true;
      }
    });

    return { isDirty: isAnyDirty, dirtyFields: dirty };
  }, [values, initialBaseValues]);

  // Auto-save draft on values change if dirty
  useEffect(() => {
    if (!autoSave || typeof window === 'undefined') return;

    if (isDirty) {
      try {
        sessionStorage.setItem(draftKey, JSON.stringify(values));
      } catch (e) {
        console.warn('Failed to save draft to sessionStorage', e);
      }
    } else {
      // If reset to clean, remove draft
      sessionStorage.removeItem(draftKey);
    }
  }, [values, isDirty, autoSave, draftKey]);

  // Field validation function
  const validateField = useCallback((fieldName: string, value: any, allValues?: T): string | null => {
    const rules = entityValidationRules[entityType]?.[fieldName as keyof T];
    if (!rules || rules.length === 0) return null;

    const currentFormValues = allValues || values;
    for (const rule of rules) {
      if (!rule.validate(value, currentFormValues)) {
        return rule.message;
      }
    }
    return null;
  }, [entityType, values]);

  // Validate entire form
  const validateAll = useCallback((valuesToValidate?: T): boolean => {
    const targetValues = valuesToValidate || values;
    const rulesMap = entityValidationRules[entityType] || {};
    const newErrors: Record<string, string> = {};
    let isValid = true;

    Object.keys(rulesMap).forEach((field) => {
      const val = (targetValues as any)[field];
      const errorMsg = validateField(field, val, targetValues);
      if (errorMsg) {
        newErrors[field] = errorMsg;
        isValid = false;
      }
    });

    setErrors(newErrors);
    return isValid;
  }, [entityType, values, validateField]);

  // Field change handler
  const setFieldValue = useCallback((fieldName: string, value: any) => {
    setValues((prev) => {
      const next = { ...prev, [fieldName]: value };
      
      // Auto-validate field if already touched
      if (touchedFields[fieldName]) {
        const err = validateField(fieldName, value, next);
        setErrors((prevErr) => {
          if (err) {
            return { ...prevErr, [fieldName]: err };
          } else {
            const copy = { ...prevErr };
            delete copy[fieldName];
            return copy;
          }
        });
      }
      return next;
    });
  }, [touchedFields, validateField]);

  // Handle standard HTML input changes
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    let finalValue: any = value;
    if (type === 'checkbox') {
      finalValue = (e.target as HTMLInputElement).checked;
    }
    setFieldValue(name, finalValue);
  }, [setFieldValue]);

  // Handle Blur for touched state & validation
  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTouchedFields((prev) => ({ ...prev, [name]: true }));
    const err = validateField(name, value, values);
    setErrors((prev) => {
      if (err) {
        return { ...prev, [name]: err };
      } else {
        const copy = { ...prev };
        delete copy[name];
        return copy;
      }
    });
  }, [validateField, values]);

  // Reset form to clean default
  const resetForm = useCallback((newDefaults?: Partial<T>) => {
    const nextDefaults = {
      ...(defaultEntityValues[entityType] || {}),
      ...(newDefaults || {})
    } as T;
    setValues(nextDefaults);
    setErrors({});
    setTouchedFields({});
    setHasRecoveredDraft(false);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(draftKey);
    }
  }, [entityType, draftKey]);

  // Discard draft explicitly
  const discardDraft = useCallback(() => {
    resetForm(customInitialValues);
  }, [resetForm, customInitialValues]);

  return {
    values,
    setValues,
    setFieldValue,
    handleInputChange,
    handleBlur,
    errors,
    setErrors,
    touchedFields,
    isDirty,
    dirtyFields,
    hasRecoveredDraft,
    validateField,
    validateAll,
    resetForm,
    discardDraft
  };
}
