import { create } from 'zustand';

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
  activeView: 'Dashboard',
  setActiveView: (view) => set({ activeView: view }),
  currentOrgId: 'default-org-id',
  setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
  organizations: [
    {
      id: 'default-org-id',
      name: 'Acme Corp Ltd.',
      legalName: 'Acme Global Corporation Kenya Ltd',
      baseCurrency: 'KES',
      country: 'Kenya',
      taxId: 'P051234567Z',
      fiscalYearStart: 'January',
      industry: 'Technology & Logistics',
      address: 'Riverside Square, 4th Floor',
      city: 'Nairobi',
      phone: '+254 700 123 456',
      email: 'finance@acmecorp.co.ke',
      isDefault: true,
      isDemo: true
    },
    {
      id: 'org-apex-holdings',
      name: 'Apex Holdings East Africa',
      legalName: 'Apex Regional Holdings Ltd',
      baseCurrency: 'USD',
      country: 'United States / Regional',
      taxId: 'US-987654321',
      fiscalYearStart: 'January',
      industry: 'Investment & Consulting',
      address: '100 Financial District Blvd',
      city: 'Delaware / Nairobi',
      phone: '+1 (555) 349-2000',
      email: 'treasury@apexholdings.com',
      isDefault: false
    }
  ],
  setOrganizations: (orgs) => set({ organizations: orgs }),
  activeCompany: {
    id: 'default-org-id',
    name: 'Acme Corp Ltd.',
    legalName: 'Acme Global Corporation Kenya Ltd',
    baseCurrency: 'KES',
    country: 'Kenya',
    taxId: 'P051234567Z',
    fiscalYearStart: 'January',
    industry: 'Technology & Logistics',
    address: 'Riverside Square, 4th Floor',
    city: 'Nairobi',
    phone: '+254 700 123 456',
    email: 'finance@acmecorp.co.ke',
    isDefault: true,
    isDemo: true
  },
  setActiveCompany: (company) => set({ 
    activeCompany: company, 
    currentOrgId: company?.id || 'default-org-id',
    displayCurrency: company?.baseCurrency || 'KES'
  }),
  isCommandPaletteOpen: false,
  setCommandPaletteOpen: (isOpen) => set({ isCommandPaletteOpen: isOpen }),
  
  undoStack: [],
  pushUndoAction: (action) => set((state) => ({ undoStack: [...state.undoStack, action] })),
  popUndoAction: () => set((state) => ({ undoStack: state.undoStack.slice(0, -1) })),
  isLocked: false,
  setLocked: (locked) => set({ isLocked: locked }),
  theme: 'light',
  setTheme: (theme) => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    set({ theme });
  }
}));
