/** View keys that App.tsx renders. These are stable store values, not display labels. */
export const BUSINESS_VIEWS = [
  'Home / Dashboard', 'Banking', 'Sales', 'Customer Hub', 'Expenses & Bills',
  'Accounting', 'Reports', 'Tax', 'Payroll', 'Inventory', 'Projects',
  'Business Feed', 'Team', 'Apps / Integrations', 'Audit Logs',
  'Documentation', 'Settings', 'System Health',
] as const;
export type BusinessView = (typeof BUSINESS_VIEWS)[number];

/** Mizani law views, rendered by src/components/law. */
export const LAW_VIEWS = [
  'Law / Matters', 'Law / Court diary', 'Law / Time', 'Law / Fee notes', 'Law / Client account', 'Law / Disbursements',
] as const;
export type LawView = (typeof LAW_VIEWS)[number];

/** Pilot sections are registered with an honest unavailable view until built. */
export const PLANNED_EDITION_VIEWS = {
  'Church / Members': 'Members',
  'Church / Households': 'Households',
  'Church / Giving': 'Giving',
  'Church / Funds': 'Funds',
  'Church / Cash count': 'Cash count',
  "Church / Treasurer's report": "Treasurer's report",
  'Church / Fund balances': 'Fund balances',
} as const;

export type PlannedEditionView = keyof typeof PLANNED_EDITION_VIEWS;
export const KNOWN_VIEWS = [...BUSINESS_VIEWS, ...LAW_VIEWS, ...Object.keys(PLANNED_EDITION_VIEWS) as PlannedEditionView[]] as const;
export const PLANNED_SECTION_COPY = {
  en: 'This section is not available yet. The team is building it for the edition pilot.',
  sw: 'TODO-SW',
} as const;

export function isPlannedEditionView(view: string): view is PlannedEditionView {
  return Object.prototype.hasOwnProperty.call(PLANNED_EDITION_VIEWS, view);
}
