/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { lazy, Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "./components/layout/AppLayout";
import { useAppStore } from "./store";
import { TenantProvider } from "./context/TenantContext";
import { UndoToast } from "./components/layout/UndoToast";
import { LockScreen } from "./components/layout/LockScreen";
import { fetchExchangeRates } from "./utils/currency";
import { AuthProvider } from "./context/AuthProvider";
import { useAuth } from "./context/AuthProvider";
import type { OrganizationData } from "./store";

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

const viewFallback = (
  <div className="flex min-h-64 items-center justify-center" role="status">
    <p className="ll-printed text-[12px] text-graphite-600">Opening this ledger</p>
  </div>
);

export default function App() {
  return (
    <AuthProvider>
      <LedgerApp />
    </AuthProvider>
  );
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
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-paper-100 text-ink-900" role="status">
        <p className="ll-printed text-[12px] text-graphite-600">Opening the books</p>
      </div>
    );
  }

  if (organizations && organizations.length === 0) {
    return (
      <>
        <TenantProvider>
          <AppLayout><Suspense fallback={viewFallback}><SettingsView /></Suspense></AppLayout>
        </TenantProvider>
        <UndoToast />
      </>
    );
  }

  return (
    <>
      <TenantProvider>
        <AppLayout><Suspense fallback={viewFallback}>{renderContent()}</Suspense></AppLayout>
      </TenantProvider>
      <UndoToast />
    </>
  );
}
