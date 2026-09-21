import { create } from 'zustand';

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
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  isDefault?: boolean;
  isDemo?: boolean;
}

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
  setActiveCompany: (company) => set({
    activeCompany: company,
    currentOrgId: company?.id || '',
    displayCurrency: company?.baseCurrency || 'KES'
  }),
  isCommandPaletteOpen: false,
  setCommandPaletteOpen: (isOpen) => set({ isCommandPaletteOpen: isOpen }),
  isMobileSidebarOpen: false,
  setMobileSidebarOpen: (isOpen) => set({ isMobileSidebarOpen: isOpen }),
  
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
