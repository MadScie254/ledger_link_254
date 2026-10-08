import { extraAccountsFor, type BusinessType } from './businessTypes.ts';
import { businessTypeAllowedForEdition, editionDefinition, type Edition } from './editions.ts';

/** The standard chart every organization starts with. Codes 1000-1099 hold money. */
export const STANDARD_ACCOUNTS = [
  { code: '1000', name: 'Cash equivalents (Operating Account)', type: 'ASSET' as const },
  { code: '1010', name: 'USD Bank Account (Foreign Holding)', type: 'ASSET' as const, currency: 'USD' },
  { code: '1020', name: 'EUR Bank Account (Foreign Holding)', type: 'ASSET' as const, currency: 'EUR' },
  { code: '1050', name: 'M-Pesa Business Till / Paybill', type: 'ASSET' as const },
  { code: '1100', name: 'Accounts Receivable (A/R)', type: 'ASSET' as const },
  { code: '1150', name: 'Recoverable VAT / Input Tax', type: 'ASSET' as const },
  { code: '1200', name: 'Inventory Asset', type: 'ASSET' as const },
  { code: '2000', name: 'Accounts Payable (A/P)', type: 'LIABILITY' as const },
  { code: '2100', name: 'Output VAT Payable', type: 'LIABILITY' as const },
  { code: '2110', name: 'PAYE Payable', type: 'LIABILITY' as const },
  { code: '2120', name: 'NSSF Payable', type: 'LIABILITY' as const },
  { code: '2130', name: 'SHA Payable', type: 'LIABILITY' as const },
  { code: '2140', name: 'Affordable Housing Levy Payable', type: 'LIABILITY' as const },
  { code: '3000', name: "Owner's Equity / Share Capital", type: 'EQUITY' as const },
  { code: '3100', name: 'Retained Earnings', type: 'EQUITY' as const },
  { code: '4000', name: 'Sales Revenue & Billing', type: 'INCOME' as const },
  { code: '4100', name: 'Consulting & Service Income', type: 'INCOME' as const },
  { code: '5000', name: 'Cost of Goods Sold (COGS)', type: 'COGS' as const },
  { code: '6000', name: 'Operating Expenses', type: 'EXPENSE' as const },
  { code: '6100', name: 'Salaries & Payroll Expense', type: 'EXPENSE' as const },
  { code: '6110', name: 'Employer Payroll Contributions', type: 'EXPENSE' as const },
  { code: '6200', name: 'Office Rent & Utilities', type: 'EXPENSE' as const },
  { code: '8000', name: 'Unrealized FX Gain / Loss', type: 'INCOME' as const },
  { code: '8100', name: 'Realized FX Gain / Loss', type: 'INCOME' as const },
];

export function isMoneyAccountCode(code: string): boolean {
  return /^10\d\d$/.test(code);
}

/** One chart for a new organization: standard, business-type and edition accounts. */
export function chartFor(
  businessType: BusinessType | null | undefined,
  baseCurrency: string,
  edition: Edition | null | undefined = 'business',
) {
  if (!businessTypeAllowedForEdition(edition, businessType)) {
    throw new Error('The church edition cannot use the nonprofit business type because fund account codes overlap.');
  }
  return [...STANDARD_ACCOUNTS, ...extraAccountsFor(businessType), ...editionDefinition(edition).extraAccounts]
    .map((account) => ({
      code: account.code,
      name: account.name,
      type: account.type,
      currency: ('currency' in account && account.currency) || baseCurrency,
      isBankAccount: account.type === 'ASSET' && isMoneyAccountCode(account.code),
    }));
}
