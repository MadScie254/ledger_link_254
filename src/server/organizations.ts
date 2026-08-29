import { getDb } from './db';
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { AccountService } from './accounts';

export interface Organization {
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
  createdAt?: any;
  updatedAt?: any;
}

const DEFAULT_ORGANIZATIONS: Omit<Organization, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'default-org-id',
    name: 'Acme Corp Ltd.',
    legalName: 'Acme Global Corporation Kenya Ltd',
    baseCurrency: 'KES',
    country: 'Kenya',
    taxId: 'P051234567Z',
    fiscalYearStart: 'January',
    industry: 'Technology & Logistics',
    address: 'Riverside Square, 4th Floor, Riverside Drive',
    city: 'Nairobi',
    phone: '+254 700 123 456',
    email: 'finance@acmecorp.co.ke',
    website: 'https://acmecorp.co.ke',
    isDefault: true,
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
    address: '100 Financial District Blvd, Suite 2200',
    city: 'Delaware / Nairobi',
    phone: '+1 (555) 349-2000',
    email: 'treasury@apexholdings.com',
    website: 'https://apexholdings.com',
    isDefault: false,
  }
];

export class OrganizationService {
  static async getOrganizations(): Promise<Organization[]> {
    const db = getDb();
    const orgsRef = collection(db, 'system_organizations');
    const snapshot = await getDocs(orgsRef);

    if (snapshot.empty) {
      // Seed default initial organizations
      for (const org of DEFAULT_ORGANIZATIONS) {
        const docRef = doc(db, 'system_organizations', org.id);
        await setDoc(docRef, {
          ...org,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        // Seed default chart of accounts for this organization
        await this.seedDefaultAccounts(org.id);
      }
      return DEFAULT_ORGANIZATIONS.map(o => ({ ...o }));
    }

    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Organization));
  }

  static async getOrganization(orgId: string): Promise<Organization | null> {
    const db = getDb();
    const docRef = doc(db, 'system_organizations', orgId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      // Fallback search in default orgs if not migrated
      const found = DEFAULT_ORGANIZATIONS.find(o => o.id === orgId);
      if (found) return found as Organization;
      return null;
    }
    return { id: snap.id, ...snap.data() } as Organization;
  }

  static async createOrganization(data: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const db = getDb();
    const orgsRef = collection(db, 'system_organizations');
    const newDocRef = doc(orgsRef);
    const orgId = newDocRef.id;

    const orgData: Organization = {
      id: orgId,
      name: data.name,
      legalName: data.legalName || data.name,
      baseCurrency: data.baseCurrency || 'KES',
      country: data.country || 'Kenya',
      taxId: data.taxId || '',
      fiscalYearStart: data.fiscalYearStart || 'January',
      industry: data.industry || 'General Business',
      address: data.address || '',
      city: data.city || '',
      phone: data.phone || '',
      email: data.email || '',
      website: data.website || '',
      isDefault: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(newDocRef, orgData);

    // Initialize Standard Chart of Accounts with Multi-Currency & FX Gain/Loss accounts
    await this.seedDefaultAccounts(orgId);

    return orgId;
  }

  static async updateOrganization(orgId: string, data: Partial<Organization>): Promise<void> {
    const db = getDb();
    const docRef = doc(db, 'system_organizations', orgId);
    await updateDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp()
    });
  }

  static async seedDefaultAccounts(orgId: string): Promise<void> {
    const standardAccounts = [
      { code: '1000', name: 'Cash equivalents (Operating Account)', type: 'ASSET' as const },
      { code: '1010', name: 'USD Bank Account (Foreign Holding)', type: 'ASSET' as const },
      { code: '1020', name: 'EUR Bank Account (Foreign Holding)', type: 'ASSET' as const },
      { code: '1050', name: 'M-Pesa Business Till / Paybill', type: 'ASSET' as const },
      { code: '1100', name: 'Accounts Receivable (A/R)', type: 'ASSET' as const },
      { code: '1200', name: 'Inventory Asset', type: 'ASSET' as const },
      { code: '2000', name: 'Accounts Payable (A/P)', type: 'LIABILITY' as const },
      { code: '2100', name: 'VAT & Tax Payable', type: 'LIABILITY' as const },
      { code: '3000', name: "Owner's Equity / Share Capital", type: 'EQUITY' as const },
      { code: '3100', name: 'Retained Earnings', type: 'EQUITY' as const },
      { code: '4000', name: 'Sales Revenue & Billing', type: 'INCOME' as const },
      { code: '4100', name: 'Consulting & Service Income', type: 'INCOME' as const },
      { code: '5000', name: 'Cost of Goods Sold (COGS)', type: 'COGS' as const },
      { code: '6000', name: 'Operating Expenses', type: 'EXPENSE' as const },
      { code: '6100', name: 'Salaries & Payroll Expense', type: 'EXPENSE' as const },
      { code: '6200', name: 'Office Rent & Utilities', type: 'EXPENSE' as const },
      { code: '8000', name: 'Unrealized FX Gain / Loss', type: 'INCOME' as const },
      { code: '8100', name: 'Realized FX Gain / Loss', type: 'INCOME' as const },
    ];

    for (const acc of standardAccounts) {
      try {
        await AccountService.createAccount({ ...acc, orgId });
      } catch (e) {
        // Account may already exist
      }
    }
  }
}
