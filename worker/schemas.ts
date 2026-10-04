import { z } from 'zod';
import { isCalendarDate, isTimeZone } from '../src/utils/dates';

/**
 * Request body schemas for every write route. Unknown fields are stripped
 * (forms send a few display-only fields), so a body can never set a column
 * the route does not name.
 */

export const uuid = z.string().uuid();

/**
 * A real calendar date written YYYY-MM-DD; 2026-02-30 and "1" are refused.
 * A full ISO timestamp keeps its date part, so screens loaded before dates
 * were sent plain still post.
 */
export const isoDate = z.preprocess(
  (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value.trim()) ? value.trim().slice(0, 10) : value),
  z.string().trim().refine(isCalendarDate, 'Use a real date in YYYY-MM-DD form.'),
);

export const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a three-letter ISO code.');

/** Whole cents, from zero up, small enough to add up safely. */
export const cents = z.number().int('Amounts are whole cents.').min(0).max(Number.MAX_SAFE_INTEGER / 1000);
export const positiveCents = cents.refine((value) => value > 0, 'The amount must be greater than zero.');

const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

/** Optional text up to max characters; blank becomes absent. */
export const text = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
/** Required text, 1 to max characters. */
export const requiredText = (max: number, label: string) =>
  z.string({ required_error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max);

export const email = z.preprocess(blankToUndefined, z.string().trim().toLowerCase().email('Enter a valid email address.').max(320).optional());
export const optionalUuid = z.preprocess((value) => (value === '' || value === null ? undefined : value), uuid.optional());
export const reason = requiredText(500, 'A reason');
export const idempotencyKey = uuid;

/**
 * The schema for editing a record: every field optional, and every field
 * but the named required ones may be sent as null to clear it.
 */
function forUpdate<T extends z.ZodRawShape>(shape: T, required: Array<keyof T>) {
  const fields: Record<string, z.ZodTypeAny> = {};
  for (const [key, schema] of Object.entries(shape)) {
    fields[key] = required.includes(key as keyof T) ? schema.optional() : schema.optional().nullable();
  }
  return z.object(fields);
}

// --- Customers and suppliers -------------------------------------------------

const partyFields = {
  legalName: text(200),
  contactPerson: text(200),
  email,
  phone: text(40),
  kraPin: text(20),
  paymentTerms: text(40),
  currency: currency.optional(),
  city: text(100),
  postalCode: text(20),
  country: text(100),
  notes: text(4000),
};

export const customerSchema = z.object({
  displayName: requiredText(200, 'A display name'),
  customerType: text(40),
  creditLimitCents: cents.optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  priceTier: text(40),
  billingAddress: text(500),
  shippingAddress: text(500),
  isActive: z.boolean().optional(),
  ...partyFields,
});
export const customerUpdateSchema = forUpdate(customerSchema.shape, ['displayName', 'isActive', 'currency', 'creditLimitCents', 'discountPercent']);

export const vendorSchema = z.object({
  displayName: requiredText(200, 'A display name'),
  vendorType: text(40),
  vatNumber: text(40),
  category: text(100),
  paymentMethod: text(40),
  bankName: text(100),
  bankAccountNo: text(60),
  bankBranch: text(100),
  mpesaNumber: text(20),
  defaultAccountId: optionalUuid,
  billingAddress: text(500),
  address: text(500),
  isActive: z.boolean().optional(),
  ...partyFields,
});
export const vendorUpdateSchema = forUpdate(vendorSchema.shape, ['displayName', 'isActive', 'currency']);

// --- Stock items, projects, time ----------------------------------------------

const itemFields = {
  name: requiredText(200, 'A name'),
  itemType: text(60),
  sku: text(60),
  barcode: text(60),
  category: text(100),
  unitOfMeasure: text(30),
  description: text(2000),
  priceCents: cents.optional(),
  costCents: cents.optional(),
  taxRate: z.number().min(0).max(100).optional(),
  incomeAccountId: optionalUuid,
  expenseAccountId: optionalUuid,
  reorderPoint: z.number().int().min(0).max(1_000_000_000).optional(),
  targetStock: z.number().int().min(0).max(1_000_000_000).optional(),
  preferredVendorId: optionalUuid,
  location: text(200),
  notes: text(4000),
};
export const itemSchema = z.object({
  ...itemFields,
  quantityOnHand: z.number().int().min(0).max(1_000_000_000).optional(),
});
// The stock count is not editable: it changes through adjustments and orders.
export const itemUpdateSchema = forUpdate(itemFields, ['name', 'itemType', 'priceCents', 'costCents', 'reorderPoint']).extend({
  status: z.enum(['Active', 'Inactive']).optional(),
});
export const stockAdjustmentSchema = z.object({
  countedQuantity: z.number().int().min(0).max(1_000_000_000),
  reason,
  idempotencyKey,
});

export const projectSchema = z.object({
  name: requiredText(200, 'A project name'),
  customerId: optionalUuid,
  budgetCents: cents.optional(),
});
export const projectUpdateSchema = z.object({
  name: requiredText(200, 'A project name').optional(),
  projectCode: text(40),
  customerId: optionalUuid.nullable(),
  status: z.enum(['Planned', 'Active', 'On Hold', 'Completed', 'Cancelled']).optional(),
  startDate: isoDate.optional().nullable(),
  endDate: isoDate.optional().nullable(),
  budgetCents: cents.optional(),
});
export const timeEntrySchema = z.object({
  projectId: uuid,
  entryDate: isoDate,
  hours: z.number().gt(0).max(24),
  description: text(1000),
});

// --- Employees -----------------------------------------------------------------

const employeeFields = {
  firstName: requiredText(100, 'A first name'),
  middleName: text(100),
  lastName: requiredText(100, 'A last name'),
  email,
  phone: text(40),
  department: text(100),
  jobTitle: text(100),
  hireDate: isoDate.optional(),
  baseSalaryCents: cents.optional(),
  housingAllowanceCents: cents.optional(),
  transportAllowanceCents: cents.optional(),
  kraPin: text(20),
  nssfNumber: text(30),
  shifNumber: text(30),
  nationalId: text(30),
  employmentType: text(40),
  mpesaNumber: text(20),
  bankName: text(100),
  bankAccountNo: text(60),
};
export const employeeSchema = z.object(employeeFields);
export const employeeUpdateSchema = forUpdate(employeeFields, ['firstName', 'lastName', 'hireDate', 'baseSalaryCents', 'housingAllowanceCents', 'transportAllowanceCents']);
export const payrollRunSchema = z.object({
  period: requiredText(40, 'The payroll period'),
  payDate: isoDate,
  idempotencyKey: uuid.optional(),
});

// --- Accounts and budgets ---------------------------------------------------------

export const accountTypeSchema = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COGS', 'EXPENSE']);
export const accountSchema = z.object({
  code: requiredText(20, 'An account code').regex(/^[A-Za-z0-9.-]+$/, 'Use letters, digits, dots or dashes in the code.'),
  name: requiredText(200, 'An account name'),
  type: accountTypeSchema,
  subtype: text(60),
  parentId: optionalUuid.nullable(),
  currency: currency.optional(),
  isBankAccount: z.boolean().optional(),
  description: text(1000),
});
export const accountUpdateSchema = z.object({
  name: requiredText(200, 'An account name').optional(),
  subtype: text(60).nullable(),
  description: text(1000).nullable(),
  isActive: z.boolean().optional(),
  isBankAccount: z.boolean().optional(),
});
export const bulkAccountsSchema = z.object({
  accounts: z.array(z.object({
    code: z.string().trim().max(20),
    name: z.string().trim().max(200),
    type: z.string(),
    subtype: z.string().trim().max(60).optional(),
    currency: z.string().trim().max(3).optional(),
  })).min(1).max(500),
});
export const undoBulkSchema = z.object({ batchId: uuid });

export const budgetSchema = z.object({
  accountId: uuid,
  period: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']),
  limitCents: cents,
});
export const budgetUpdateSchema = z.object({ limitCents: cents });

// --- Team and organizations ---------------------------------------------------------

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  role: z.enum(['admin', 'member', 'accountant']),
});
export const roleSchema = z.object({ role: z.enum(['admin', 'member', 'accountant']) });

const organizationFields = {
  name: requiredText(200, 'An organization name'),
  legalName: text(200),
  baseCurrency: currency.optional(),
  country: text(100),
  taxId: text(30),
  fiscalYearStart: z.enum(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']).optional(),
  industry: text(100),
  businessType: z.enum(['retail', 'services', 'hospitality', 'construction', 'logistics', 'nonprofit', 'general']).optional().nullable(),
  themeAccent: z.enum(['oxblood', 'forest', 'navy', 'plum', 'slate']).optional(),
  address: text(500),
  city: text(100),
  phone: text(40),
  email,
  website: text(200),
};
export const organizationCreateSchema = z.object({
  ...organizationFields,
  creationKey: uuid.optional(),
});
export const organizationUpdateSchema = z.object(organizationFields).partial().extend({
  booksClosedThrough: isoDate.nullable().optional(),
  approvalThresholdCents: cents.nullable().optional(),
  aiEnabled: z.boolean().optional(),
  timeZone: z.string().trim().max(64).refine(isTimeZone, 'Choose a known time zone, such as Africa/Nairobi.').optional(),
});

// --- Banking -------------------------------------------------------------------------

export const connectionRequestSchema = z.object({
  institutionName: requiredText(200, 'The bank or provider name'),
  contactEmail: email,
  notes: text(2000),
});

// --- AI ---------------------------------------------------------------------------------

/** About 5 MB of image once decoded from base64. */
export const MAX_RECEIPT_BASE64_LENGTH = 7_000_000;
export const receiptScanSchema = z.object({
  image: z.string().min(100).max(MAX_RECEIPT_BASE64_LENGTH, 'The photo is too large; use one under 5 MB.').optional(),
  imageBase64: z.string().min(100).max(MAX_RECEIPT_BASE64_LENGTH, 'The photo is too large; use one under 5 MB.').optional(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']).default('image/jpeg'),
}).refine((body) => Boolean(body.image || body.imageBase64), 'A photo of the receipt is required.');
export const askSchema = z.object({ question: requiredText(500, 'A question') });

// --- Reversals -----------------------------------------------------------------------------

export const reversalSchema = z.object({
  reversalDate: isoDate,
  reason,
});

// --- Invoices and bills ------------------------------------------------------------------

const documentLineSchema = z.object({
  description: requiredText(500, 'A line description'),
  accountId: uuid,
  amountCents: cents,
  foreignAmountCents: positiveCents.optional(),
  taxCents: cents.default(0),
  /** A stock item on the line, and how many. */
  inventoryItemId: optionalUuid,
  quantity: z.number().positive().max(1_000_000_000).optional(),
}).refine((line) => line.amountCents > 0 || (line.foreignAmountCents || 0) > 0, {
  message: 'Each line needs a base or foreign-currency amount.',
});
const documentBaseSchema = z.object({
  dueDate: isoDate,
  currency: currency.default('KES'),
  exchangeRate: z.number().positive().finite().default(1),
  notes: text(4000),
  idempotencyKey,
  lines: z.array(documentLineSchema).min(1).max(200),
});
export const createInvoiceSchema = documentBaseSchema.extend({
  customerId: uuid,
  issueDate: isoDate,
}).refine((doc) => doc.dueDate >= doc.issueDate, { message: 'The due date cannot be before the issue date.' });
export const createBillSchema = documentBaseSchema.extend({
  vendorId: uuid,
  billDate: isoDate,
  supplierReference: text(100),
}).refine((doc) => doc.dueDate >= doc.billDate, { message: 'The due date cannot be before the bill date.' });
export const invoiceUpdateSchema = z.object({
  dueDate: isoDate.optional(),
  notes: z.string().trim().max(4000).optional(),
});
export const billUpdateSchema = invoiceUpdateSchema.extend({
  supplierReference: z.string().trim().max(100).optional(),
});
export const invoicePaymentSchema = z.object({
  amountCents: positiveCents,
  paymentDate: isoDate,
  depositAccountId: uuid,
  idempotencyKey,
});
export const billPaymentSchema = z.object({
  amountCents: positiveCents,
  paymentDate: isoDate,
  sourceAccountId: uuid,
  idempotencyKey,
});
export const batchBillPaymentSchema = z.object({
  payments: z.array(billPaymentSchema.extend({ billId: uuid })).min(1).max(40),
});

// --- Bulk -----------------------------------------------------------------------------------

export const bulkDeleteSchema = z.object({
  entityType: z.enum(['INVOICES', 'BILLS', 'CUSTOMERS', 'VENDORS', 'INVENTORY', 'EMPLOYEES']),
  ids: z.array(uuid).min(1).max(40),
});
export const bulkStatusUpdateSchema = z.object({
  entityType: z.enum(['CUSTOMERS', 'VENDORS', 'INVENTORY', 'EMPLOYEES']),
  ids: z.array(uuid).min(1).max(100),
  status: z.preprocess((value) => (typeof value === 'string' ? value.trim().toUpperCase() : value), z.enum(['ACTIVE', 'INACTIVE'])),
});

// --- Journals ---------------------------------------------------------------------------------

const journalLineSchema = z.object({
  accountId: uuid,
  debit: cents,
  credit: cents,
  description: text(500),
}).refine((line) => (line.debit > 0) !== (line.credit > 0), {
  message: 'Each journal line must have exactly one non-zero side.',
});
export const journalEntrySchema = z.object({
  entryDate: isoDate,
  memo: z.string().trim().max(1000).optional().transform((value) => value || 'Manual journal entry'),
  sourceType: z.enum(['MANUAL', 'ADJUSTMENT']).default('MANUAL'),
  referenceNo: text(100),
  idempotencyKey: uuid.optional(),
  lines: z.array(journalLineSchema).min(2).max(500),
}).superRefine((entry, context) => {
  const debit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = entry.lines.reduce((sum, line) => sum + line.credit, 0);
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit <= 0 || debit !== credit) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Journal debits and credits must be equal, positive whole cents.' });
  }
});

// --- Banking matches ------------------------------------------------------------------------------

export const bankMatchSchema = z.object({
  transactionId: uuid,
  targetAccountId: uuid.optional(),
  existingJournalEntryId: uuid.optional(),
  invoiceId: uuid.optional(),
  billId: uuid.optional(),
}).refine(
  (body) => [body.targetAccountId, body.existingJournalEntryId, body.invoiceId, body.billId].filter(Boolean).length === 1,
  { message: 'Choose exactly one of an account, a posted entry, an invoice or a bill to match this line to.' },
);
export const autoReconcileSchema = z.object({ minConfidence: z.number().min(0).max(100).optional() });
export const bankRuleSchema = z.object({
  matchText: requiredText(200, 'The text to match'),
  targetAccountId: uuid,
});

// --- Sales orders ------------------------------------------------------------------------------------

const decimals = (value: number) => {
  const textValue = String(value);
  return /e/i.test(textValue) ? Infinity : (textValue.split('.')[1] || '').length;
};
const salesOrderLineSchema = z.object({
  description: requiredText(500, 'A line description'),
  accountId: uuid,
  inventoryItemId: uuid.optional(),
  quantity: z.number().positive().max(1_000_000_000)
    .refine((value) => decimals(value) <= 3, 'Use at most three decimals for a quantity.'),
  unitPriceCents: cents,
  taxRate: z.number().min(0).max(100)
    .refine((value) => decimals(value) <= 2, 'Use at most two decimals for a VAT rate.')
    .default(0),
});
export const createSalesOrderSchema = z.object({
  customerId: uuid,
  orderDate: isoDate,
  promisedDate: isoDate.optional(),
  notes: text(4000),
  idempotencyKey,
  lines: z.array(salesOrderLineSchema).min(1).max(200),
}).refine((order) => !order.promisedDate || order.promisedDate >= order.orderDate, {
  message: 'The promised date cannot be before the order date.',
});
export const salesOrderStatusSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  reason: text(500),
});
export const invoiceSalesOrderSchema = z.object({
  issueDate: isoDate,
  dueDate: isoDate,
}).refine((body) => body.dueDate >= body.issueDate, {
  message: 'The due date cannot be before the issue date.',
});

// --- Onboarding --------------------------------------------------------------------------------------

export const onboardingSchema = z.object({
  status: z.enum(['NOT_ASKED', 'IN_PROGRESS', 'SKIPPED', 'COMPLETED']),
  step: z.number().int().min(0).max(50),
});

export const currencyRefreshSchema = z.object({ base: currency.default('KES') });

// --- Estimates -------------------------------------------------------------------------

export const estimateSchema = z.object({
  customerId: uuid,
  estimateDate: isoDate,
  expiryDate: isoDate.optional(),
  notes: text(4000),
  idempotencyKey: idempotencyKey.optional(),
  lines: z.array(salesOrderLineSchema).min(1).max(200),
}).refine((estimate) => !estimate.expiryDate || estimate.expiryDate >= estimate.estimateDate, {
  message: 'An estimate cannot expire before its date.',
});
export const estimateStatusSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED']),
  reason: text(500),
});
export const convertEstimateSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('INVOICE'), date: isoDate, dueDate: isoDate }),
  z.object({ target: z.literal('SALES_ORDER'), date: isoDate }),
]).refine((body) => body.target !== 'INVOICE' || body.dueDate >= body.date, {
  message: 'The due date cannot be before the issue date.',
});

// --- Sales receipts, expenses and transfers -----------------------------------

const partyChoice = {
  payeeName: text(200),
  reference: text(100),
  memo: text(4000),
  idempotencyKey,
};
export const salesReceiptSchema = z.object({
  customerId: optionalUuid,
  date: isoDate,
  depositAccountId: uuid,
  lines: z.array(salesOrderLineSchema).min(1).max(200),
  ...partyChoice,
});
export const expenseSchema = z.object({
  vendorId: optionalUuid,
  date: isoDate,
  paidFromAccountId: uuid,
  lines: z.array(z.object({
    description: requiredText(500, 'A line description'),
    accountId: uuid,
    amountCents: positiveCents,
    taxCents: cents.default(0),
    inventoryItemId: optionalUuid,
    quantity: z.number().positive().max(1_000_000_000).optional(),
  })).min(1).max(200),
  ...partyChoice,
});
export const transferSchema = z.object({
  date: isoDate,
  fromAccountId: uuid,
  toAccountId: uuid,
  amountCents: positiveCents,
  memo: text(4000),
  idempotencyKey,
}).refine((transfer) => transfer.fromAccountId !== transfer.toAccountId, { message: 'Choose two different accounts to transfer between.' });
export const voidSchema = z.object({ voidDate: isoDate, reason });

// --- Credit notes, supplier credits and refunds ------------------------------

const purchaseLineSchema = z.object({
  description: requiredText(500, 'A line description'),
  accountId: uuid,
  amountCents: positiveCents,
  taxCents: cents.default(0),
  inventoryItemId: optionalUuid,
  quantity: z.number().positive().max(1_000_000_000).optional(),
});
export const customerCreditSchema = z.object({
  customerId: uuid,
  invoiceId: optionalUuid,
  date: isoDate,
  memo: text(4000),
  idempotencyKey,
  lines: z.array(salesOrderLineSchema).min(1).max(200),
});
export const supplierCreditSchema = z.object({
  vendorId: uuid,
  billId: optionalUuid,
  date: isoDate,
  reference: text(100),
  memo: text(4000),
  idempotencyKey,
  lines: z.array(purchaseLineSchema).min(1).max(200),
});
export const applyCreditSchema = z.object({
  documentId: uuid,
  amountCents: positiveCents,
  date: isoDate,
  idempotencyKey,
});
export const refundCreditSchema = z.object({
  amountCents: positiveCents,
  date: isoDate,
  moneyAccountId: uuid,
  reference: text(100),
  idempotencyKey,
});
export const reverseCreditUseSchema = z.object({
  reversalDate: isoDate.optional(),
  reason,
});

// --- Purchase orders -------------------------------------------------------------

const purchaseOrderLineSchema = z.object({
  description: requiredText(500, 'A line description'),
  accountId: uuid,
  inventoryItemId: optionalUuid,
  quantity: z.number().positive().max(1_000_000_000)
    .refine((value) => decimals(value) <= 3, 'Use at most three decimals for a quantity.'),
  unitCostCents: cents,
  taxRate: z.number().min(0).max(100)
    .refine((value) => decimals(value) <= 2, 'Use at most two decimals for a VAT rate.')
    .default(0),
});
export const purchaseOrderSchema = z.object({
  vendorId: uuid,
  orderDate: isoDate,
  expectedDate: isoDate.optional(),
  memo: text(4000),
  idempotencyKey: idempotencyKey.optional(),
  lines: z.array(purchaseOrderLineSchema).min(1).max(200),
}).refine((order) => !order.expectedDate || order.expectedDate >= order.orderDate, {
  message: 'The expected date cannot be before the order date.',
});
export const purchaseOrderStatusSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']),
  reason: text(500),
});
export const billPurchaseOrderSchema = z.object({
  billDate: isoDate,
  dueDate: isoDate,
  supplierReference: text(100),
  quantities: z.array(z.object({
    position: z.number().int().positive(),
    quantity: z.number().min(0).max(1_000_000_000),
  })).max(200).optional(),
  idempotencyKey,
}).refine((body) => body.dueDate >= body.billDate, { message: 'The due date cannot be before the bill date.' });
