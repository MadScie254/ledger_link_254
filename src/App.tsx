/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "./components/layout/AppLayout";
import { useAppStore } from "./store";
import { SalesView } from "./components/sales/SalesView";
import { BankingView } from "./components/banking/BankingView";
import { ReportsView } from "./components/reports/ReportsView";
import { ExpensesView } from "./components/expenses/ExpensesView";
import { PayrollView } from "./components/payroll/PayrollView";
import { InventoryView } from "./components/inventory/InventoryView";
import { TaxView } from "./components/tax/TaxView";
import { ProjectsView } from "./components/projects/ProjectsView";
import { CustomerHubView } from "./components/crm/CustomerHubView";
import { AccountingView } from "./components/accounting/AccountingView";
import { DashboardView } from "./components/dashboard/DashboardView";
import { BusinessFeedView } from "./components/feed/BusinessFeedView";
import { TeamView } from "./components/team/TeamView";
import { AppsView } from "./components/apps/AppsView";
import { AuditLogView } from "./components/audit/AuditLogView";
import { SystemHealthView } from "./components/health/SystemHealthView";
import { SettingsView } from "./components/settings/SettingsView";
import { TenantProvider } from "./context/TenantContext";
import { UndoToast } from "./components/layout/UndoToast";
import { LockScreen } from "./components/layout/LockScreen";
import { fetchExchangeRates } from "./utils/currency";
import { AuthProvider } from "./context/AuthProvider";
import { useAuth } from "./context/AuthProvider";
import type { OrganizationData } from "./store";
import { navigate, usePathname } from "./router";
import { MarketingShell } from "./marketing/MarketingShell";
import { LandingPage } from "./marketing/LandingPage";
import { PricingPage } from "./marketing/PricingPage";
import { WhyKenyaPage } from "./marketing/WhyKenyaPage";
import { ForAccountantsPage } from "./marketing/ForAccountantsPage";
import { SecurityPage } from "./marketing/SecurityPage";
import { ContactPage } from "./marketing/ContactPage";

const MARKETING_ROUTES: Record<string, ComponentType> = {
  "/": LandingPage,
  "/pricing": PricingPage,
  "/why-kenya": WhyKenyaPage,
  "/for-accountants": ForAccountantsPage,
  "/security": SecurityPage,
  "/contact": ContactPage,
};

export default function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  );
}

/**
 * AuthProvider does not render children until the session has resolved, so
 * `session` here is always settled — there is no loading state to guard.
 */
function Routes() {
  const pathname = usePathname();
  const { session } = useAuth();

  const isMarketing = pathname in MARKETING_ROUTES;
  const isAuthPath = pathname === "/login" || pathname === "/signup";
  const isAppPath = pathname === "/app" || pathname.startsWith("/app/");

  // Redirects are effects, not render-time side effects: navigate() dispatches
  // an event that sets state on anything listening, which React forbids during
  // a render pass.
  useEffect(() => {
    if (isAuthPath && session) {
      navigate("/app", { replace: true });
    } else if (isAppPath && !session) {
      navigate("/login", { replace: true });
    } else if (!isMarketing && !isAuthPath && !isAppPath) {
      navigate(session ? "/app" : "/", { replace: true });
    }
  }, [pathname, session, isMarketing, isAuthPath, isAppPath]);

  if (isMarketing) {
    const MarketingPage = MARKETING_ROUTES[pathname];
    return (
      <MarketingShell>
        <MarketingPage />
      </MarketingShell>
    );
  }

  if (isAuthPath) {
    if (session) return null; // Redirecting to /app.
    // Keyed on the path so moving between /login and /signup remounts the form.
    // Without it React keeps the same instance and `initialMode`, which only
    // seeds useState, is ignored on the second visit.
    return <LockScreen key={pathname} initialMode={pathname === "/signup" ? "signUp" : "signIn"} />;
  }

  if (isAppPath) {
    if (!session) return null; // Redirecting to /login.
    return <LedgerApp />;
  }

  return null; // Unknown path, redirecting.
}

function LedgerApp() {
  const { session, signOut } = useAuth();
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

  useEffect(() => {
    if (!organizations?.length) return;

    setOrganizations(organizations);
    const selectedOrganization = organizations.find((organization) => organization.id === currentOrgId) || organizations[0];
    setCurrentOrgId(selectedOrganization.id);
    setActiveCompany(selectedOrganization);
    setDisplayCurrency(selectedOrganization.baseCurrency);
  }, [organizations, currentOrgId, setActiveCompany, setCurrentOrgId, setDisplayCurrency, setOrganizations]);

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
    if (activeView === "Home / Dashboard") return <DashboardView />;
    if (activeView === "Business Feed") return <BusinessFeedView />;
    if (activeView === "Team") return <TeamView />;
    if (activeView === "Apps / Integrations") return <AppsView />;
    if (activeView === "Sales") return <SalesView />;
    if (activeView === "Banking") return <BankingView />;
    if (activeView === "Reports") return <ReportsView />;
    if (activeView === "Expenses & Bills") return <ExpensesView />;
    if (activeView === "Payroll") return <PayrollView />;
    if (activeView === "Inventory") return <InventoryView />;
    if (activeView === "Tax") return <TaxView />;
    if (activeView === "Projects") return <ProjectsView />;
    if (activeView === "Customer Hub") return <CustomerHubView />;
    if (activeView === "Accounting") return <AccountingView />;
    if (activeView === "Audit Logs") return <AuditLogView />;
    if (activeView === "System Health") return <SystemHealthView />;
    if (activeView === "Settings") return <SettingsView />;
    // Default catch-all
    return <DashboardView />;
  };

  if (!session || isLocked) {
    return <LockScreen />;
  }

  if (organizationsLoading) {
    return <div className="fixed inset-0 bg-sidebar-bg z-[100] flex items-center justify-center text-sidebar-ink">Loading organizations...</div>;
  }

  if (organizations && organizations.length === 0) {
    return (
      <>
        <TenantProvider>
          <AppLayout><SettingsView /></AppLayout>
        </TenantProvider>
        <UndoToast />
      </>
    );
  }

  return (
    <>
      <TenantProvider>
        <AppLayout>{renderContent()}</AppLayout>
      </TenantProvider>
      <UndoToast />
    </>
  );
}
