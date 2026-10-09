import { create } from 'zustand';
import type { BusinessType } from './utils/businessTypes';
import type { Edition } from './utils/editions';
import { applyThemeAccent, type ThemeAccent } from './utils/themeAccents';

const THEME_STORAGE_KEY = 'll-theme';

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable (private mode, blocked storage) — fall through
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeClass(theme: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export interface OrganizationData {
  id: string;
  name: string;
  legalName?: string;
  baseCurrency: string;
  country: string;
  taxId?: string;
  fiscalYearStart?: string;
  industry?: string;
  businessType?: BusinessType | null;
  edition?: Edition;
  themeAccent?: ThemeAccent | null;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  /** How to pay, printed on invoices. */
  paymentDetails?: string | null;
  /** A short line at the foot of every printed document. */
  documentFooter?: string | null;
  /** Registered for VAT with KRA. */
  vatRegistered?: boolean;
  isDefault?: boolean;
  isDemo?: boolean;
  /** No entry may be dated on or before this day (YYYY-MM-DD). */
  booksClosedThrough?: string | null;
  /** Bills at or over this amount need an owner's or admin's approval before payment. */
  approvalThresholdCents?: number | null;
  /** Whether receipts and figures may be sent to Google Gemini. */
  aiEnabled?: boolean;
  timeZone?: string;
  /** The signed-in person's role in this organization. */
  role?: 'owner' | 'admin' | 'accountant' | 'member';
}

export type CreateIntent =
  | 'invoice' | 'payment' | 'estimate' | 'salesReceipt' | 'creditNote'
  | 'bill' | 'payBills' | 'expense' | 'purchaseOrder' | 'supplierCredit'
  | 'payrollRun' | 'employee' | 'timeEntry' | 'transfer' | 'journalEntry'
  | 'stockCount' | 'importStatement'
  // Mizani
  | 'matter' | 'courtDate' | 'lawTime' | 'clientReceipt' | 'disbursement'
  // Kundi
  | 'gift' | 'cashCount' | 'member' | 'mpesaStatement';

interface AppState {
  displayCurrency: string;
  setDisplayCurrency: (c: string) => void;
  exchangeRates: Record<string, number>;
  setExchangeRates: (rates: Record<string, number>) => void;
  rateMetadata: { source: string; lastUpdated: string } | null;
  setRateMetadata: (meta: { source: string; lastUpdated: string } | null) => void;
  activeView: string;
  setActiveView: (view: string) => void;
  currentOrgId: string;
  setCurrentOrgId: (orgId: string) => void;
  organizations: OrganizationData[];
  setOrganizations: (orgs: OrganizationData[]) => void;
  activeCompany: OrganizationData | null;
  setActiveCompany: (company: OrganizationData | null) => void;
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (isOpen: boolean) => void;
  isMobileSidebarOpen: boolean;
  setMobileSidebarOpen: (isOpen: boolean) => void;
  isNewMenuOpen: boolean;
  setNewMenuOpen: (isOpen: boolean) => void;
  createIntent: CreateIntent | null;
  setCreateIntent: (intent: CreateIntent | null) => void;
  
  // Undo Stack
  undoStack: Array<{ id: string, message: string, revertEndpoint: string, data: any }>;
  pushUndoAction: (action: { id: string, message: string, revertEndpoint: string, data: any }) => void;
  popUndoAction: () => void;
  isLocked: boolean;
  setLocked: (locked: boolean) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}

export const useAppStore = create<AppState>((set) => ({
  displayCurrency: 'KES',
  setDisplayCurrency: (c) => set({ displayCurrency: c }),
  exchangeRates: { KES: 1, USD: 0.00775, EUR: 0.00714, GBP: 0.00602, UGX: 28.65, TZS: 19.85 },
  setExchangeRates: (rates) => set({ exchangeRates: rates }),
  rateMetadata: { source: 'Open Exchange Rate API (Live Market Feed)', lastUpdated: new Date().toLocaleTimeString() },
  setRateMetadata: (meta) => set({ rateMetadata: meta }),
  activeView: 'Home / Dashboard',
  setActiveView: (view) => set({ activeView: view }),
  currentOrgId: '',
  setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
  // No hardcoded demo organizations here — a fresh account genuinely has
  // zero organizations until it creates one. Showing fake "Acme Corp Ltd."/
  // "Apex Holdings" data by default masked that, making a brand-new
  // account with zero real memberships look like it already had 2
  // companies set up (and every query fired with the fake org id
  // 'default-org-id', which isn't a valid UUID and made every org-scoped
  // API call fail).
  organizations: [],
  setOrganizations: (orgs) => set({ organizations: orgs }),
  activeCompany: null,
  setActiveCompany: (company) => {
    applyThemeAccent(company?.themeAccent);
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-edition', company?.edition || 'business');
    set({
      activeCompany: company,
      currentOrgId: company?.id || '',
      displayCurrency: company?.baseCurrency || 'KES'
    });
  },
  isCommandPaletteOpen: false,
  setCommandPaletteOpen: (isOpen) => set({ isCommandPaletteOpen: isOpen }),
  isMobileSidebarOpen: false,
  setMobileSidebarOpen: (isOpen) => set({ isMobileSidebarOpen: isOpen }),
  isNewMenuOpen: false,
  setNewMenuOpen: (isOpen) => set({ isNewMenuOpen: isOpen }),
  createIntent: null,
  setCreateIntent: (intent) => set({ createIntent: intent }),
  
  undoStack: [],
  pushUndoAction: (action) => set((state) => ({ undoStack: [...state.undoStack, action] })),
  popUndoAction: () => set((state) => ({ undoStack: state.undoStack.slice(0, -1) })),
  isLocked: false,
  setLocked: (locked) => set({ isLocked: locked }),
  theme: (() => {
    const initial = getInitialTheme();
    if (typeof window !== 'undefined') applyThemeClass(initial);
    return initial;
  })(),
  setTheme: (theme) => {
    applyThemeClass(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore write failures, theme just won't persist this session
    }
    set({ theme });
  }
}));
