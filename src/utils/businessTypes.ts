/**
 * What a company's business type changes, in one place: the extra accounts
 * seeded alongside the standard chart of accounts, the order Books-group
 * sidebar sections are shown in, and which onboarding-tour steps this kind of
 * business can skip. Nothing here ever hides a page outright; every section
 * stays reachable, this only changes what is promoted or skipped by default.
 */

export type BusinessType = 'retail' | 'services' | 'hospitality' | 'construction' | 'logistics' | 'nonprofit' | 'general';

export interface BusinessTypeAccount {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'COGS' | 'EXPENSE';
}

export interface BusinessTypeDefinition {
  id: BusinessType;
  /** Short label for the picker. */
  label: string;
  /** One sentence explaining who this is for. */
  description: string;
  /** Extra accounts seeded on top of the standard chart of accounts. Codes must not collide with standardAccounts in organizations.ts (1000-8100 are taken; these start at 1300 and 5500). */
  extraAccounts: BusinessTypeAccount[];
  /** Books-group sidebar views, most relevant first. Any view not listed keeps its place at the end, in the usual order. */
  sidebarPriority: string[];
  /** Tour step ids (from tourSteps.ts) that do not apply to this kind of business and can be skipped. */
  skipTourSteps: string[];
}

export const BUSINESS_TYPES: BusinessTypeDefinition[] = [
  {
    id: 'retail',
    label: 'Retail or trade',
    description: 'You stock goods and sell them on, over a counter or to other businesses.',
    extraAccounts: [
      { code: '1300', name: 'Inventory, work in progress', type: 'ASSET' },
      { code: '5100', name: 'Cost of goods sold, by category', type: 'COGS' },
    ],
    sidebarPriority: ['Inventory', 'Accounting', 'Reports', 'Tax', 'Payroll', 'Projects'],
    skipTourSteps: [],
  },
  {
    id: 'services',
    label: 'Services or consulting',
    description: 'You bill for time or expertise rather than selling physical stock.',
    extraAccounts: [
      { code: '1160', name: 'Work in progress, unbilled', type: 'ASSET' },
      { code: '4200', name: 'Unbilled revenue', type: 'INCOME' },
    ],
    sidebarPriority: ['Projects', 'Accounting', 'Reports', 'Tax', 'Payroll', 'Inventory'],
    skipTourSteps: ['inventory'],
  },
  {
    id: 'hospitality',
    label: 'Hospitality',
    description: 'A hotel, restaurant or similar business with fast-moving stock and shift staff.',
    extraAccounts: [
      { code: '2160', name: 'Tips and service charge payable', type: 'LIABILITY' },
      { code: '1310', name: 'Perishable stock', type: 'ASSET' },
    ],
    sidebarPriority: ['Inventory', 'Payroll', 'Accounting', 'Reports', 'Tax', 'Projects'],
    skipTourSteps: ['projects'],
  },
  {
    id: 'construction',
    label: 'Construction or contracting',
    description: 'You run jobs or contracts and need to track cost against budget per job.',
    extraAccounts: [
      { code: '2170', name: 'Retention payable', type: 'LIABILITY' },
      { code: '1320', name: 'Work in progress, by contract', type: 'ASSET' },
    ],
    sidebarPriority: ['Projects', 'Inventory', 'Accounting', 'Reports', 'Tax', 'Payroll'],
    skipTourSteps: [],
  },
  {
    id: 'logistics',
    label: 'Logistics or transport',
    description: 'You move goods or people and track vehicles, fuel and routes.',
    extraAccounts: [
      { code: '6210', name: 'Fuel and vehicle maintenance', type: 'EXPENSE' },
    ],
    sidebarPriority: ['Accounting', 'Reports', 'Tax', 'Payroll', 'Inventory', 'Projects'],
    skipTourSteps: ['inventory', 'projects'],
  },
  {
    id: 'nonprofit',
    label: 'Nonprofit or NGO',
    description: 'You account for donor funds that are often restricted to a specific use.',
    extraAccounts: [
      { code: '3200', name: 'Restricted funds', type: 'EQUITY' },
      { code: '3300', name: 'Unrestricted funds', type: 'EQUITY' },
    ],
    sidebarPriority: ['Reports', 'Accounting', 'Projects', 'Tax', 'Payroll', 'Inventory'],
    skipTourSteps: ['inventory'],
  },
  {
    id: 'general',
    label: 'Something else',
    description: 'None of the above fits exactly, or you would rather not say yet.',
    extraAccounts: [],
    sidebarPriority: [],
    skipTourSteps: [],
  },
];

const BY_ID = new Map(BUSINESS_TYPES.map((type) => [type.id, type]));

export function businessTypeDefinition(id: BusinessType | null | undefined): BusinessTypeDefinition | null {
  if (!id) return null;
  return BY_ID.get(id) || null;
}

/** Extra accounts to seed for this business type, or none if unset or general. */
export function extraAccountsFor(id: BusinessType | null | undefined): BusinessTypeAccount[] {
  return businessTypeDefinition(id)?.extraAccounts || [];
}

/**
 * Reorders `views` (a Books-group section list) so this business type's
 * priority views lead, in its stated order, keeping everything else in its
 * existing relative order behind them. A view the type doesn't mention never
 * moves and is never removed.
 */
export function reorderByBusinessType<T extends { view: string }>(views: T[], id: BusinessType | null | undefined): T[] {
  const priority = businessTypeDefinition(id)?.sidebarPriority;
  if (!priority || priority.length === 0) return views;
  const rank = new Map(priority.map((view, index) => [view, index]));
  return [...views].sort((a, b) => {
    const ra = rank.has(a.view) ? rank.get(a.view)! : priority.length;
    const rb = rank.has(b.view) ? rank.get(b.view)! : priority.length;
    return ra - rb;
  });
}

export function shouldSkipTourStep(stepId: string, id: BusinessType | null | undefined): boolean {
  return businessTypeDefinition(id)?.skipTourSteps.includes(stepId) || false;
}
