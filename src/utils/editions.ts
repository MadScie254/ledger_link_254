import { businessTypeDefinition, reorderByBusinessType, type BusinessType, type BusinessTypeAccount } from './businessTypes.ts';

export type Edition = 'business' | 'law' | 'church';
export interface LocalizedLabel { en: string; sw: 'TODO-SW' }
export interface SidebarItem {
  view: string;
  name: LocalizedLabel;
  /** Sections still in the pilot backlog are visible as unavailable, never clickable. */
  available?: boolean;
}
export interface SidebarGroup { label: LocalizedLabel; items: SidebarItem[] }
export interface EditionDefinition {
  id: Edition;
  brandName: string;
  poweredBy: boolean;
  hostnames: string[];
  sidebar: SidebarGroup[];
  defaultView: string;
  extraAccounts: BusinessTypeAccount[];
}

const label = (en: string): LocalizedLabel => ({ en, sw: 'TODO-SW' });
const item = (view: string, en: string, available = true): SidebarItem =>
  ({ view, name: label(en), ...(available ? {} : { available: false }) });

/** The existing Sidebar INDEX in its original order and with its original English labels. */
const BUSINESS_SIDEBAR: SidebarGroup[] = [
  { label: label('Money'), items: [
    item('Home / Dashboard', 'Home'), item('Banking', 'Banking'),
    item('Sales', 'Sales'), item('Customer Hub', 'Customers'),
    item('Expenses & Bills', 'Bills and expenses'),
  ] },
  { label: label('Books'), items: [
    item('Accounting', 'Accounting'), item('Reports', 'Reports'),
    item('Tax', 'Tax'), item('Payroll', 'Payroll'),
    item('Inventory', 'Inventory'), item('Projects', 'Projects'),
  ] },
  { label: label('Office'), items: [
    item('Business Feed', 'Business feed'), item('Team', 'Team'),
    item('Apps / Integrations', 'Integrations'), item('Audit Logs', 'Audit log'),
    item('Documentation', 'Documentation'), item('Settings', 'Settings'),
  ] },
];

export const FULL_BOOKS_GROUP: SidebarGroup = {
  label: label('Full books'),
  items: BUSINESS_SIDEBAR[1].items.filter((entry) =>
    ['Accounting', 'Reports', 'Tax', 'Payroll'].includes(entry.view)),
};

export const EDITIONS: EditionDefinition[] = [
  {
    id: 'business', brandName: 'Ledger Link', poweredBy: false, hostnames: [],
    sidebar: BUSINESS_SIDEBAR, defaultView: 'Home / Dashboard', extraAccounts: [],
  },
  {
    id: 'law', brandName: 'Mizani', poweredBy: true, hostnames: [],
    sidebar: [
      { label: label('Practice'), items: [
        item('Home / Dashboard', 'Home'), item('Law / Matters', 'Matters'),
        item('Law / Court diary', 'Court diary'), item('Law / Time', 'Time'),
      ] },
      { label: label('Money'), items: [
        item('Law / Fee notes', 'Fee notes'), item('Law / Client account', 'Client account'),
        item('Law / Disbursements', 'Disbursements'), item('Customer Hub', 'Clients'),
      ] },
      { label: label('Office'), items: [item('Team', 'Team'), item('Settings', 'Settings')] },
    ],
    defaultView: 'Home / Dashboard',
    extraAccounts: [
      { code: '1060', name: 'Client account, bank', type: 'ASSET' },
      { code: '1170', name: 'Withholding tax receivable', type: 'ASSET' },
      { code: '1180', name: 'Disbursements recoverable', type: 'ASSET' },
      { code: '2200', name: 'Client money held', type: 'LIABILITY' },
      { code: '4300', name: 'Legal fees', type: 'INCOME' },
      { code: '4310', name: 'Conveyancing fees', type: 'INCOME' },
    ],
  },
  {
    id: 'church', brandName: 'Kundi', poweredBy: true, hostnames: [],
    sidebar: [
      { label: label('People'), items: [
        item('Home / Dashboard', 'Home'), item('Church / Members', 'Members'),
        item('Church / Households', 'Households'),
      ] },
      { label: label('Money'), items: [
        item('Church / Giving', 'Giving'), item('Church / Funds', 'Funds'),
        item('Church / Cash count', 'Cash count'),
        item('Expenses & Bills', 'Expenses'),
      ] },
      { label: label('Reports'), items: [
        item("Church / Treasurer's report", "Treasurer's report"),
        item('Church / Fund balances', 'Fund balances'),
      ] },
      { label: label('Office'), items: [item('Team', 'Team'), item('Settings', 'Settings')] },
    ],
    defaultView: 'Home / Dashboard',
    extraAccounts: [
      { code: '1040', name: 'Cash on hand, collections', type: 'ASSET' },
      { code: '1330', name: 'Building in progress', type: 'ASSET' },
      { code: '3200', name: 'Restricted funds', type: 'EQUITY' },
      { code: '3300', name: 'General fund', type: 'EQUITY' },
      { code: '4010', name: 'Tithes', type: 'INCOME' },
      { code: '4020', name: 'Offerings', type: 'INCOME' },
      { code: '4030', name: 'Thanksgiving and special offerings', type: 'INCOME' },
      { code: '4040', name: 'Building and project giving', type: 'INCOME' },
      { code: '4050', name: 'Missions giving', type: 'INCOME' },
      { code: '6310', name: 'Ministry and department costs', type: 'EXPENSE' },
      { code: '6320', name: 'Welfare and benevolence', type: 'EXPENSE' },
      { code: '6330', name: 'Missions support', type: 'EXPENSE' },
      { code: '6350', name: 'Denominational remittance', type: 'EXPENSE' },
      { code: '6400', name: 'Bank and M-Pesa charges', type: 'EXPENSE' },
    ],
  },
];

const BY_ID = new Map(EDITIONS.map((edition) => [edition.id, edition]));

export function editionDefinition(
  id: Edition | null | undefined,
  hosts: Partial<Record<Edition, string[]>> = {},
): EditionDefinition {
  const definition = BY_ID.get(id || 'business') || EDITIONS[0];
  return { ...definition, hostnames: hosts[definition.id] || definition.hostnames };
}

/** A church may use code 3200/3300, but cannot also seed nonprofit's 3200/3300. */
export function businessTypeAllowedForEdition(
  edition: Edition | null | undefined,
  businessType: BusinessType | null | undefined,
): boolean {
  const editionCodes = new Set(editionDefinition(edition).extraAccounts.map((account) => account.code));
  return (businessTypeDefinition(businessType)?.extraAccounts || [])
    .every((account) => !editionCodes.has(account.code));
}

export function navigationGroupsFor(
  edition: Edition | null | undefined,
  businessType: BusinessType | null | undefined,
  role: 'owner' | 'admin' | 'accountant' | 'member' | null | undefined,
): SidebarGroup[] {
  const definition = editionDefinition(edition);
  if (definition.id === 'business') {
    return definition.sidebar.map((group) => group.label.en === 'Books'
      ? { ...group, items: reorderByBusinessType(group.items, businessType) }
      : group);
  }
  return role && ['owner', 'admin', 'accountant'].includes(role)
    ? [...definition.sidebar, FULL_BOOKS_GROUP] : definition.sidebar;
}
