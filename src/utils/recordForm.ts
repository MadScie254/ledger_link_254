/**
 * Turning a customer, supplier, stock item or employee from the API into the
 * record form's fields, and back into only what an edit changed.
 */

type RecordType = 'ITEM' | 'VENDOR' | 'CUSTOMER' | 'EMPLOYEE' | string;

const money = (cents: unknown) => (cents === null || cents === undefined || cents === '' ? '' : (Number(cents) / 100).toFixed(2));
const plain = (value: unknown) => (value === null || value === undefined ? '' : String(value));

/** A record from the API as the form's fields. */
export function formValuesFor(type: RecordType, d: any): Record<string, string> {
  switch (type) {
    case 'ITEM':
      return {
        name: plain(d.name), itemType: plain(d.type || d.itemType || 'Physical Product'), sku: plain(d.sku), barcode: plain(d.barcode),
        category: plain(d.category), unitOfMeasure: plain(d.unitOfMeasure), description: plain(d.description),
        price: money(d.unitPriceCents ?? d.priceCents), cost: money(d.costPriceCents ?? d.costCents), taxRate: plain(d.taxRate ?? 16),
        incomeAccountId: plain(d.incomeAccountId), expenseAccountId: plain(d.cogsAccountId ?? d.expenseAccountId),
        quantityOnHand: plain(d.quantityOnHand ?? 0), reorderPoint: plain(d.reorderPoint ?? 0), targetStock: plain(d.targetStock),
        preferredVendorId: plain(d.preferredVendorId), location: plain(d.location), notes: plain(d.notes),
      };
    case 'VENDOR':
      return {
        displayName: plain(d.displayName), legalName: plain(d.legalName), vendorType: plain(d.vendorType), contactPerson: plain(d.contactPerson),
        email: plain(d.email), phone: plain(d.phone), kraPin: plain(d.kraPin), vatNumber: plain(d.vatNumber), category: plain(d.category),
        paymentTerms: plain(d.paymentTerms), currency: plain(d.currency || 'KES'), defaultAccountId: plain(d.defaultAccountId),
        paymentMethod: plain(d.paymentMethod), bankName: plain(d.bankName), bankAccountNo: plain(d.bankAccountNo), bankBranch: plain(d.bankBranch),
        mpesaNumber: plain(d.mpesaNumber), address: plain(d.billingAddress ?? d.address), city: plain(d.city), postalCode: plain(d.postalCode),
        country: plain(d.country), notes: plain(d.notes),
      };
    case 'CUSTOMER':
      return {
        displayName: plain(d.displayName), legalName: plain(d.legalName), customerType: plain(d.customerType), contactPerson: plain(d.contactPerson),
        email: plain(d.email), phone: plain(d.phone), kraPin: plain(d.kraPin), paymentTerms: plain(d.paymentTerms),
        creditLimit: money(d.creditLimitCents), discountPercent: plain(d.discountPercent), priceTier: plain(d.priceTier),
        currency: plain(d.currency || 'KES'), billingAddress: plain(d.billingAddress), shippingAddress: plain(d.shippingAddress),
        city: plain(d.city), postalCode: plain(d.postalCode), country: plain(d.country), notes: plain(d.notes),
      };
    case 'EMPLOYEE':
      return {
        firstName: plain(d.firstName), middleName: plain(d.middleName), lastName: plain(d.lastName), nationalId: plain(d.nationalId),
        email: plain(d.email), phone: plain(d.phone), jobTitle: plain(d.jobTitle), department: plain(d.department),
        employmentType: plain(d.employmentType), hireDate: plain(d.hireDate).slice(0, 10), kraPin: plain(d.kraPin),
        nssfNumber: plain(d.nssfNumber), shifNumber: plain(d.shifNumber ?? d.nhifNumber), baseSalary: money(d.baseSalaryCents),
        housingAllowance: money(d.housingAllowanceCents), transportAllowance: money(d.transportAllowanceCents),
        bankName: plain(d.bankName), bankAccountNo: plain(d.bankAccountNo ?? d.bankAccount), mpesaNumber: plain(d.mpesaNumber),
      };
    default:
      return {};
  }
}

/**
 * Only what an edit changed, compared with the record as it was. A text
 * field that was emptied is sent as null, so it is cleared.
 */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(value ?? null) === JSON.stringify(before[key] ?? null)) continue;
    changes[key] = value === '' || value === undefined ? null : value;
  }
  return changes;
}
