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

/** Kundi church views, rendered by src/components/church. */
export const CHURCH_VIEWS = [
  'Church / Members', 'Church / Households', 'Church / Giving', 'Church / Funds', 'Church / Cash count',
  "Church / Treasurer's report", 'Church / Fund balances',
] as const;
export type ChurchView = (typeof CHURCH_VIEWS)[number];

/**
 * Pilot sections are registered here with an honest unavailable view until
 * they are built. Every edition section is built now; the mechanism stays
 * for the next one.
 */
export const PLANNED_EDITION_VIEWS: Record<string, string> = {};

export type PlannedEditionView = string;
export const KNOWN_VIEWS = [...BUSINESS_VIEWS, ...LAW_VIEWS, ...CHURCH_VIEWS, ...Object.keys(PLANNED_EDITION_VIEWS)] as const;
export const PLANNED_SECTION_COPY = {
  en: 'This section is not available yet. The team is building it for the edition pilot.',
  sw: 'TODO-SW',
} as const;

export function isPlannedEditionView(view: string): view is PlannedEditionView {
  return Object.prototype.hasOwnProperty.call(PLANNED_EDITION_VIEWS, view);
}
