import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "./components/layout/AppLayout";
import { useAppStore } from "./store";
import { TenantProvider } from "./context/TenantContext";
import { UndoToast } from "./components/layout/UndoToast";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { OfflineBanner } from "./components/layout/OfflineBanner";
import { LockScreen } from "./components/layout/LockScreen";
import { fetchExchangeRates } from "./utils/currency";
import { AuthProvider } from "./context/AuthProvider";
import { useAuth } from "./context/AuthProvider";
import type { OrganizationData } from "./store";
import { OnboardingProvider } from "./components/onboarding/OnboardingProvider";
import { LandingPage } from "./marketing/LandingPage";
import { Mark } from "./components/ledger/Mark";
import { InvitationsPrompt } from "./components/team/InvitationsPrompt";
import { NewPasswordScreen } from "./components/layout/NewPasswordScreen";
import { isPlannedEditionView, type BusinessView, type ChurchView, type LawView } from "./utils/views";
import { PlannedEditionView } from "./components/layout/PlannedEditionView";
import { editionDefinition } from "./utils/editions";
import { BUSINESS_BRAND, usePublicBrand } from "./hooks/usePublicBrand";
export { KNOWN_VIEWS } from "./utils/views";

/** A tab that has already gone past the landing page (signed in, or clicked
 * through) never sees it again this tab, including after a later sign-out:
 * re-entering credentials is the expected next step there, not the pitch. A
 * new tab, or one that never left the landing page, starts on it. */
const VISITED_AUTH_KEY = 'll-visited-auth';
function hasVisitedAuth(): boolean {
  try {
    return sessionStorage.getItem(VISITED_AUTH_KEY) === '1';
  } catch {
    return false;
  }
}
function markVisitedAuth() {
  try {
    sessionStorage.setItem(VISITED_AUTH_KEY, '1');
  } catch {
    // Private mode or blocked storage: the landing page just shows again next reload, which is harmless.
  }
}

/** The organization each person last worked in, so a reload opens the same books. */
const lastOrganizationKey = (userId: string) => `ll-last-org:${userId}`;
function readLastOrganization(userId: string): string | null {
  try {
    return localStorage.getItem(lastOrganizationKey(userId));
  } catch {
    return null;
  }
}
function rememberOrganization(userId: string, orgId: string) {
  try {
    localStorage.setItem(lastOrganizationKey(userId), orgId);
  } catch {
    // Blocked storage: the first organization opens next time instead.
  }
}

const SalesView = lazy(() => import('./components/sales/SalesView').then((module) => ({ default: module.SalesView })));
const BankingView = lazy(() => import('./components/banking/BankingView').then((module) => ({ default: module.BankingView })));
const ReportsView = lazy(() => import('./components/reports/ReportsView').then((module) => ({ default: module.ReportsView })));
const ExpensesView = lazy(() => import('./components/expenses/ExpensesView').then((module) => ({ default: module.ExpensesView })));
const PayrollView = lazy(() => import('./components/payroll/PayrollView').then((module) => ({ default: module.PayrollView })));
const InventoryView = lazy(() => import('./components/inventory/InventoryView').then((module) => ({ default: module.InventoryView })));
const TaxView = lazy(() => import('./components/tax/TaxView').then((module) => ({ default: module.TaxView })));
const ProjectsView = lazy(() => import('./components/projects/ProjectsView').then((module) => ({ default: module.ProjectsView })));
const CustomerHubView = lazy(() => import('./components/crm/CustomerHubView').then((module) => ({ default: module.CustomerHubView })));
const AccountingView = lazy(() => import('./components/accounting/AccountingView').then((module) => ({ default: module.AccountingView })));
const DashboardView = lazy(() => import('./components/dashboard/DashboardView').then((module) => ({ default: module.DashboardView })));
const BusinessFeedView = lazy(() => import('./components/feed/BusinessFeedView').then((module) => ({ default: module.BusinessFeedView })));
const TeamView = lazy(() => import('./components/team/TeamView').then((module) => ({ default: module.TeamView })));
const AppsView = lazy(() => import('./components/apps/AppsView').then((module) => ({ default: module.AppsView })));
const AuditLogView = lazy(() => import('./components/audit/AuditLogView').then((module) => ({ default: module.AuditLogView })));
const SystemHealthView = lazy(() => import('./components/health/SystemHealthView').then((module) => ({ default: module.SystemHealthView })));
const SettingsView = lazy(() => import('./components/settings/SettingsView').then((module) => ({ default: module.SettingsView })));
const DocumentationView = lazy(() => import('./components/documentation/DocumentationView').then((module) => ({ default: module.DocumentationView })));
const lawView = (name: 'MattersView' | 'CourtDiaryView' | 'TimeView' | 'FeeNotesView' | 'ClientAccountView' | 'DisbursementsView' | 'LawHomeView') =>
  lazy(() => import('./components/law/LawViews').then((module) => ({ default: module[name] })));
const LawHomeView = lawView('LawHomeView');
const LAW_RENDERERS: Record<LawView, ComponentType> = {
  'Law / Matters': lawView('MattersView'),
  'Law / Court diary': lawView('CourtDiaryView'),
  'Law / Time': lawView('TimeView'),
  'Law / Fee notes': lawView('FeeNotesView'),
  'Law / Client account': lawView('ClientAccountView'),
  'Law / Disbursements': lawView('DisbursementsView'),
};

const ChurchHomeView = lazy(() => import('./components/church/ChurchReports').then((module) => ({ default: module.ChurchHomeView })));
const CHURCH_RENDERERS: Record<ChurchView, ComponentType> = {
  'Church / Members': lazy(() => import('./components/church/MembersView').then((module) => ({ default: module.MembersView }))),
  'Church / Households': lazy(() => import('./components/church/MembersView').then((module) => ({ default: module.HouseholdsView }))),
  'Church / Giving': lazy(() => import('./components/church/GivingView').then((module) => ({ default: module.GivingView as ComponentType }))),
  'Church / Funds': lazy(() => import('./components/church/FundsView').then((module) => ({ default: module.FundsView }))),
  'Church / Cash count': lazy(() => import('./components/church/GivingView').then((module) => ({ default: module.CashCountView }))),
  "Church / Treasurer's report": lazy(() => import('./components/church/ChurchReports').then((module) => ({ default: module.TreasurerReportView }))),
  'Church / Fund balances': lazy(() => import('./components/church/FundsView').then((module) => ({ default: module.FundBalancesView }))),
};

// Every business view key has a real renderer. Edition pilot keys below show
// an explicit unavailable state until their own feature tasks are complete.
const BUSINESS_RENDERERS: Record<BusinessView, ComponentType> = {
  'Home / Dashboard': DashboardView,
  'Banking': BankingView,
  'Sales': SalesView,
  'Customer Hub': CustomerHubView,
  'Expenses & Bills': ExpensesView,
  'Accounting': AccountingView,
  'Reports': ReportsView,
  'Tax': TaxView,
  'Payroll': PayrollView,
  'Inventory': InventoryView,
  'Projects': ProjectsView,
  'Business Feed': BusinessFeedView,
  'Team': TeamView,
  'Apps / Integrations': AppsView,
  'Audit Logs': AuditLogView,
  'Documentation': DocumentationView,
  'Settings': SettingsView,
  'System Health': SystemHealthView,
};

const viewFallback = (
  <div className="flex min-h-64 items-center justify-center" role="status">
    <p className="ll-printed text-[12px] text-graphite-600">Opening this ledger</p>
  </div>
);

/** Shown once, straight after a confirmation link signs someone in, before the app itself appears. */
function EmailConfirmedScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1800);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      role="status"
      onClick={onDone}
      className="fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center gap-3 bg-paper-100 text-center"
    >
      <Mark kind="tick" draw className="[&_svg]:h-8 [&_svg]:w-8" />
      <p className="ll-heading text-[22px] text-ink-900">Email confirmed</p>
      <p className="max-w-xs text-[13.5px] text-graphite-600">Signed in. Opening the books.</p>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <OnboardingProvider>
        <LedgerApp />
      </OnboardingProvider>
    </AuthProvider>
  );
}

function LedgerApp() {
  const { session, signOut, justConfirmedEmail, dismissEmailConfirmed, isRecoveringPassword } = useAuth();
  const { data: publicBrand } = usePublicBrand();
  const [showLanding, setShowLanding] = useState(() => !hasVisitedAuth());
  const [authMode, setAuthMode] = useState<'signIn' | 'signUp'>('signIn');
  const enterAuth = (mode: 'signIn' | 'signUp') => {
    markVisitedAuth();
    setAuthMode(mode);
    setShowLanding(false);
  };
  const {
    activeView,
    setActiveView,
    isLocked,
    setLocked,
    activeCompany,
    currentOrgId,
    setCurrentOrgId,
    setOrganizations,
    setActiveCompany,
    setDisplayCurrency,
  } = useAppStore();

  const { data: organizations, isLoading: organizationsLoading } = useQuery({
    queryKey: ['organizations'],
    enabled: Boolean(session),
    queryFn: async () => {
      const response = await fetch('/api/organizations');
      if (!response.ok) throw new Error('Failed to load organizations');
      const body = await response.json();
      return body.organizations as OrganizationData[];
    },
  });

  const userId = session?.user.id;
  useEffect(() => {
    if (!organizations?.length) return;

    setOrganizations(organizations);
    const remembered = userId ? readLastOrganization(userId) : null;
    const selectedOrganization = organizations.find((organization) => organization.id === currentOrgId)
      || organizations.find((organization) => organization.id === remembered)
      || organizations[0];
    if (activeCompany?.id !== selectedOrganization.id) {
      setActiveView(editionDefinition(selectedOrganization.edition).defaultView);
    }
    setCurrentOrgId(selectedOrganization.id);
    setActiveCompany(selectedOrganization);
    setDisplayCurrency(selectedOrganization.baseCurrency);
    if (userId) rememberOrganization(userId, selectedOrganization.id);
  }, [organizations, currentOrgId, userId, activeCompany?.id, setActiveView,
    setActiveCompany, setCurrentOrgId, setDisplayCurrency, setOrganizations]);

  // Automated daily exchange rate sync on startup
  useEffect(() => {
    if (!session || !activeCompany) return;
    fetchExchangeRates(activeCompany?.baseCurrency || 'KES').catch(console.error);
  }, [activeCompany?.baseCurrency, session]);

  

  // Auto-logout timer (15 minutes)
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      if (!isLocked) {
        timeoutId = setTimeout(() => {
          setLocked(true);
          void signOut();
        }, 15 * 60 * 1000); // 15 minutes
      }
    };

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(event => {
      document.addEventListener(event, resetTimer);
    });

    resetTimer(); // Initialize timer

    return () => {
      clearTimeout(timeoutId);
      events.forEach(event => {
        document.removeEventListener(event, resetTimer);
      });
    };
  }, [isLocked, setLocked, signOut]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLocked) return;
      
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) {
        return; // Ignore if typing in an input
      }

      switch (e.key) {
        case '1': setActiveView('Home / Dashboard'); break;
        case '2': setActiveView('Sales'); break;
        case '3': setActiveView('Expenses & Bills'); break;
        case '4': setActiveView('Banking'); break;
        case '5': setActiveView('Accounting'); break;
        case '6': setActiveView('Reports'); break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveView, isLocked]);

  const renderContent = () => {
    // A law firm's Home is its practice: court today, unbilled work, client money.
    if (activeView === 'Home / Dashboard' && activeCompany?.edition === 'law') return <LawHomeView />;
    const LawRenderer = activeCompany?.edition === 'law' ? LAW_RENDERERS[activeView as LawView] : undefined;
    if (LawRenderer) return <LawRenderer />;
    // A church's Home is its giving: this Sunday, the month by fund, what waits.
    if (activeView === 'Home / Dashboard' && activeCompany?.edition === 'church') return <ChurchHomeView />;
    const ChurchRenderer = activeCompany?.edition === 'church' ? CHURCH_RENDERERS[activeView as ChurchView] : undefined;
    if (ChurchRenderer) return <ChurchRenderer />;
    const BusinessRenderer = BUSINESS_RENDERERS[activeView as BusinessView];
    if (BusinessRenderer) return <BusinessRenderer />;
    if (isPlannedEditionView(activeView)) return <PlannedEditionView view={activeView} />;
    // Default catch-all
    return <DashboardView />;
  };

  if (session && isRecoveringPassword) {
    return <NewPasswordScreen />;
  }

  if (session && justConfirmedEmail) {
    return <EmailConfirmedScreen onDone={dismissEmailConfirmed} />;
  }

  if (!session || isLocked) {
    // Plain conditional, not AnimatePresence: wrapping this swap in
    // AnimatePresence left the exit animation permanently unresolved, so
    // LockScreen never mounted and "Get started"/"Sign in" did nothing —
    // the entire sign-up funnel was unreachable. A slide transition here
    // is not worth that risk again.
    return showLanding ? (
      <LandingPage brand={publicBrand || BUSINESS_BRAND} onSignIn={() => enterAuth('signIn')} onSignUp={() => enterAuth('signUp')} />
    ) : (
      <LockScreen brand={publicBrand || BUSINESS_BRAND} initialMode={authMode} onBack={() => setShowLanding(true)} />
    );
  }

  if (organizationsLoading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-paper-100 text-ink-900" role="status">
        <p className="ll-printed text-[12px] text-graphite-600">Opening the books</p>
      </div>
    );
  }

  if (organizations && organizations.length === 0) {
    const emptyOrganizationView = activeView === 'Documentation' ? <DocumentationView /> : <SettingsView />;
    return (
      <>
        <TenantProvider>
          <AppLayout>
            <InvitationsPrompt />
            <ErrorBoundary key={activeView}>
              <Suspense fallback={viewFallback}>{emptyOrganizationView}</Suspense>
            </ErrorBoundary>
          </AppLayout>
        </TenantProvider>
        <UndoToast />
        <OfflineBanner />
      </>
    );
  }

  return (
    <>
      <TenantProvider>
        <AppLayout>
          <InvitationsPrompt />
          <ErrorBoundary key={activeView}>
            <Suspense fallback={viewFallback}>{renderContent()}</Suspense>
          </ErrorBoundary>
        </AppLayout>
      </TenantProvider>
      <UndoToast />
      <OfflineBanner />
    </>
  );
}
