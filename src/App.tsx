/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { fetchWithTenant } from "./utils/api";
import { UndoToast } from "./components/layout/UndoToast";
import { LockScreen } from "./components/layout/LockScreen";
import { fetchExchangeRates } from "./utils/currency";
import { AuthProvider } from "./context/AuthProvider";

export default function App() {
  const queryClient = useQueryClient();
  const { activeView, setActiveView, isLocked, setLocked, activeCompany } = useAppStore();

  // Automated daily exchange rate sync on startup
  useEffect(() => {
    fetchExchangeRates(activeCompany?.baseCurrency || 'KES').catch(console.error);
  }, [activeCompany?.baseCurrency]);

  

  // Auto-logout timer (15 minutes)
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      if (!isLocked) {
        timeoutId = setTimeout(() => {
          setLocked(true);
          sessionStorage.clear();
          localStorage.removeItem("ledgerline-auth");
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
  }, [isLocked, setLocked]);

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

  const { data, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const res = await fetchWithTenant("/api/accounts");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

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

  return (
    <AuthProvider>
      {isLocked && <LockScreen />}
      <TenantProvider>
        <AppLayout>{renderContent()}</AppLayout>
      </TenantProvider>
      <UndoToast />
    </AuthProvider>
  );
}
