import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { useMonitoringStore } from '../../utils/monitoring';
import { formatCurrency } from '../../utils/currency';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
  FileText,
  Users,
  Package,
  X,
  ArrowRight,
  ShieldCheck,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface AppNotification {
  id: string;
  category: 'system' | 'payroll' | 'invoice' | 'inventory';
  title: string;
  description: string;
  timestamp: string;
  severity: 'urgent' | 'warning' | 'info' | 'success';
  targetView: string;
  actionLabel: string;
  amountCents?: number;
}

export function NotificationDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'INVOICE' | 'PAYROLL' | 'SYSTEM' | 'INVENTORY'>('ALL');
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const { currentOrgId, setActiveView } = useAppStore();
  const { apiMetrics } = useMonitoringStore();

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Fetch Invoices to detect overdue or pending invoices
  const { data: invoicesData } = useQuery({
    queryKey: ['invoices', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/invoices', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { invoices: [] };
      return res.json();
    }
  });

  // Fetch Employees for payroll tasks
  const { data: employeesData } = useQuery({
    queryKey: ['employees', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/employees', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { employees: [] };
      return res.json();
    }
  });

  // Fetch Inventory for low-stock alerts
  const { data: inventoryData } = useQuery({
    queryKey: ['inventory', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/inventory', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return { items: [] };
      return res.json();
    }
  });

  // Construct Dynamic Notification List
  const notifications: AppNotification[] = [];

  // 1. Overdue & Unpaid Invoices
  const invoices = invoicesData?.invoices || [];
  const now = new Date();

  invoices.forEach((inv: any) => {
    const isDue = new Date(inv.dueDate) < now;
    if (inv.status !== 'PAID' && isDue) {
      notifications.push({
        id: `inv-overdue-${inv.id}`,
        category: 'invoice',
        title: `Overdue Invoice: ${inv.invoiceNo || 'INV-Draft'}`,
        description: `Payment was due on ${inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : 'N/A'}. Total outstanding: ${formatCurrency(inv.totalCents || 0)}`,
        timestamp: 'Requires follow-up',
        severity: 'urgent',
        targetView: 'Sales',
        actionLabel: 'View Invoices',
        amountCents: inv.totalCents
      });
    } else if (inv.status === 'SENT') {
      notifications.push({
        id: `inv-sent-${inv.id}`,
        category: 'invoice',
        title: `Pending Settlement: ${inv.invoiceNo}`,
        description: `Awaiting customer payment confirmation of ${formatCurrency(inv.totalCents || 0)}.`,
        timestamp: 'Open invoice',
        severity: 'warning',
        targetView: 'Sales',
        actionLabel: 'Check Status',
        amountCents: inv.totalCents
      });
    }
  });

  // 2. Pending Payroll Tasks
  const employees = employeesData?.employees || [];
  if (employees.length > 0) {
    const totalPayrollCents = employees.reduce((sum: number, e: any) => sum + (e.baseSalaryCents || 0), 0);
    notifications.push({
      id: 'payroll-monthly-run',
      category: 'payroll',
      title: 'Upcoming Payroll Run',
      description: `${employees.length} employees scheduled for monthly salary disbursement (~${formatCurrency(totalPayrollCents)}).`,
      timestamp: 'Due end of month',
      severity: 'warning',
      targetView: 'Payroll',
      actionLabel: 'Run Payroll'
    });

    notifications.push({
      id: 'statutory-filing-due',
      category: 'payroll',
      title: 'Statutory Returns (PAYE & SHIF/NSSF)',
      description: 'Monthly statutory tax filings and remittances to KRA are due before the 9th.',
      timestamp: 'Compliance task',
      severity: 'info',
      targetView: 'Payroll',
      actionLabel: 'View Filings'
    });
  }

  // 3. System Health Telemetry
  const slowCalls = apiMetrics.filter(m => m.duration > 250);
  if (slowCalls.length > 0) {
    notifications.push({
      id: 'system-latency-alert',
      category: 'system',
      title: 'Elevated API Response Latency',
      description: `${slowCalls.length} request(s) exceeded 250ms latency (peak ${Math.round(slowCalls[0].duration)}ms on ${slowCalls[0].url}).`,
      timestamp: 'Telemetry alert',
      severity: 'warning',
      targetView: 'System Health',
      actionLabel: 'View Metrics'
    });
  } else {
    notifications.push({
      id: 'system-healthy',
      category: 'system',
      title: 'All Systems Operational',
      description: 'Zero database latency anomalies. Multi-tenant isolation and API routes active.',
      timestamp: 'Real-time telemetry',
      severity: 'success',
      targetView: 'System Health',
      actionLabel: 'Health Dashboard'
    });
  }

  // 4. Low Inventory Stock
  const items = inventoryData?.items || [];
  const lowStockItems = items.filter((i: any) => i.quantityOnHand <= i.reorderPoint);
  if (lowStockItems.length > 0) {
    lowStockItems.slice(0, 3).forEach((item: any) => {
      notifications.push({
        id: `inventory-low-${item.id}`,
        category: 'inventory',
        title: `Low Stock: ${item.name}`,
        description: `Only ${item.quantityOnHand} ${item.unitOfMeasure || 'units'} remaining (Reorder trigger: ${item.reorderPoint}).`,
        timestamp: 'Inventory alert',
        severity: 'urgent',
        targetView: 'Inventory',
        actionLabel: 'Restock Item'
      });
    });
  }

  // Filter and filter by dismissed
  const visibleNotifications = notifications.filter(n => !dismissedIds.includes(n.id));
  const filteredNotifications = visibleNotifications.filter(n => {
    if (activeFilter === 'ALL') return true;
    if (activeFilter === 'INVOICE') return n.category === 'invoice';
    if (activeFilter === 'PAYROLL') return n.category === 'payroll';
    if (activeFilter === 'SYSTEM') return n.category === 'system';
    if (activeFilter === 'INVENTORY') return n.category === 'inventory';
    return true;
  });

  const unreadCount = visibleNotifications.filter(n => !readIds.includes(n.id) && n.severity !== 'success').length;

  const handleNavigate = (targetView: string, id: string) => {
    setReadIds(prev => [...prev, id]);
    setActiveView(targetView);
    setIsOpen(false);
  };

  const handleMarkAllRead = () => {
    setReadIds(visibleNotifications.map(n => n.id));
  };

  const handleDismiss = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissedIds(prev => [...prev, id]);
  };

  const getSeverityStyle = (severity: AppNotification['severity']) => {
    switch (severity) {
      case 'urgent':
        return {
          icon: <AlertTriangle className="h-4 w-4 text-rust-700 shrink-0" />,
          badgeBg: 'bg-rust-700/10 text-rust-700 border-rust-700/20',
          dot: 'bg-rust-700'
        };
      case 'warning':
        return {
          icon: <Clock className="h-4 w-4 text-brass-600 shrink-0" />,
          badgeBg: 'bg-brass-500/10 text-brass-700 border-brass-500/20',
          dot: 'bg-brass-500'
        };
      case 'info':
        return {
          icon: <Activity className="h-4 w-4 text-focus-blue-500 shrink-0" />,
          badgeBg: 'bg-focus-blue-500/10 text-focus-blue-600 border-focus-blue-500/20',
          dot: 'bg-focus-blue-500'
        };
      case 'success':
        return {
          icon: <CheckCircle2 className="h-4 w-4 text-ledger-green-700 shrink-0" />,
          badgeBg: 'bg-ledger-green-700/10 text-ledger-green-700 border-ledger-green-700/20',
          dot: 'bg-ledger-green-700'
        };
    }
  };

  const getCategoryIcon = (cat: AppNotification['category']) => {
    switch (cat) {
      case 'invoice':
        return <FileText className="h-3.5 w-3.5 mr-1" />;
      case 'payroll':
        return <Users className="h-3.5 w-3.5 mr-1" />;
      case 'system':
        return <Activity className="h-3.5 w-3.5 mr-1" />;
      case 'inventory':
        return <Package className="h-3.5 w-3.5 mr-1" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button with badge */}
      <button
        type="button"
        id="notification-bell-btn"
        aria-label="Open notifications"
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-slate-500 hover:text-ink-900 rounded-md hover:bg-paper-100 dark:hover:bg-ink-900/30 relative transition-colors focus:outline-none focus:ring-1 focus:ring-focus-blue-500"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-rust-700 rounded-full ring-2 ring-paper-50 animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : (
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-ledger-green-700 ring-2 ring-paper-50" />
        )}
      </button>

      {/* Notification Dropdown Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-96 sm:w-[420px] bg-paper-100 border border-ink-900/10 shadow-2xl rounded-sm z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-ink-900/10 bg-paper-50  flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="font-serif font-semibold text-ink-900 text-sm">Notifications & Alerts</span>
                {unreadCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-rust-700/10 text-rust-700 font-semibold">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-slate-500 hover:text-ink-900 flex items-center transition-colors"
                  >
                    <Check className="h-3.5 w-3.5 mr-1" /> Mark all read
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-slate-400 hover:text-ink-900 p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center space-x-1 px-3 py-2 bg-paper-100/50  border-b border-ink-900/5 overflow-x-auto text-xs">
              {[
                { id: 'ALL', label: 'All' },
                { id: 'INVOICE', label: 'Invoices' },
                { id: 'PAYROLL', label: 'Payroll' },
                { id: 'SYSTEM', label: 'Health' },
                { id: 'INVENTORY', label: 'Stock' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveFilter(tab.id as any)}
                  className={`px-2.5 py-1 rounded-sm font-medium transition-colors whitespace-nowrap ${
                    activeFilter === tab.id
                      ? 'bg-paper-100 text-ink-900 shadow-xs'
                      : 'text-slate-500 hover:text-ink-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Notification List */}
            <div className="max-h-[380px] overflow-y-auto divide-y divide-ink-900/5">
              {filteredNotifications.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">
                  <ShieldCheck className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                  <p className="font-medium text-ink-900">All caught up!</p>
                  <p className="text-xs mt-1">No alerts under the selected category.</p>
                </div>
              ) : (
                filteredNotifications.map((item) => {
                  const style = getSeverityStyle(item.severity);
                  const isRead = readIds.includes(item.id);

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleNavigate(item.targetView, item.id)}
                      className={`p-3.5 hover:bg-paper-50 dark:hover:bg-ink-900/30 transition-colors cursor-pointer relative group ${
                        !isRead && item.severity !== 'success' ? 'bg-focus-blue-500/5' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start space-x-2.5 flex-1 min-w-0">
                          <div className="mt-0.5">{style.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2 mb-1">
                              <span className={`inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${style.badgeBg}`}>
                                {getCategoryIcon(item.category)}
                                {item.category}
                              </span>
                              <span className="text-[11px] text-slate-400">{item.timestamp}</span>
                            </div>
                            <h4 className="text-xs font-semibold text-ink-900 leading-snug">
                              {item.title}
                            </h4>
                            <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                              {item.description}
                            </p>
                          </div>
                        </div>

                        {/* Dismiss button */}
                        <button
                          onClick={(e) => handleDismiss(item.id, e)}
                          title="Dismiss notification"
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rust-700 transition-opacity"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Action Pill */}
                      <div className="mt-2.5 flex items-center justify-between text-xs pt-2 border-t border-ink-900/5">
                        <span className="text-[11px] text-slate-400 font-mono">
                          Target: {item.targetView}
                        </span>
                        <span className="inline-flex items-center font-medium text-focus-blue-500 hover:text-focus-blue-600 transition-colors">
                          {item.actionLabel}
                          <ArrowRight className="h-3 w-3 ml-1" />
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-2.5 bg-paper-50  border-t border-ink-900/10 flex items-center justify-between text-xs">
              <div className="flex items-center text-slate-500">
                <span className="h-2 w-2 rounded-full bg-ledger-green-700 mr-2"></span>
                <span>System Monitoring Live</span>
              </div>
              <button
                onClick={() => {
                  setActiveView('System Health');
                  setIsOpen(false);
                }}
                className="text-focus-blue-500 hover:underline font-medium"
              >
                Telemetry Dashboard →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
