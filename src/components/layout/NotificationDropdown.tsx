import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { useMonitoringStore } from '../../utils/monitoring';
import { differenceInCalendarDays, format } from 'date-fns';
import { statutoryDeadlines, dueIn } from '../../utils/statutory';
import { Bell, X } from 'lucide-react';
import { Mark } from '../ledger/Mark';
import { Amount } from '../ledger/Amount';
import { buttonClass } from '../ledger/Page';

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

  // Built only from what the books say; nothing here is scheduled or promised.
  const notifications: AppNotification[] = [];
  const dayMonthYear = (d?: string) => (d ? format(new Date(d), 'dd/MM/yyyy') : '');

  // 1. Invoices past their due date, then one line for the rest still open.
  const invoices = invoicesData?.invoices || [];
  const now = new Date();
  const unpaid = invoices.filter((inv: any) => inv.status !== 'PAID' && inv.status !== 'VOID' && inv.status !== 'DRAFT');
  const overdue = unpaid.filter((inv: any) => inv.dueDate && new Date(inv.dueDate) < now);
  const awaiting = unpaid.filter((inv: any) => !overdue.includes(inv));

  overdue.forEach((inv: any) => {
    notifications.push({
      id: `inv-overdue-${inv.id}`,
      category: 'invoice',
      title: `${inv.invoiceNo || 'An invoice'} is overdue`,
      description: `Was due on ${dayMonthYear(inv.dueDate)}.`,
      timestamp: `${Math.max(1, differenceInCalendarDays(now, new Date(inv.dueDate)))} days late`,
      severity: 'urgent',
      targetView: 'Sales',
      actionLabel: 'Open Sales',
      amountCents: inv.amountDueCents ?? inv.totalCents,
    });
  });

  if (awaiting.length > 0) {
    const total = awaiting.reduce((sum: number, inv: any) => sum + (inv.amountDueCents ?? inv.totalCents ?? 0), 0);
    notifications.push({
      id: `inv-awaiting-${awaiting.length}-${total}`,
      category: 'invoice',
      title: `${awaiting.length} ${awaiting.length === 1 ? 'invoice is' : 'invoices are'} awaiting payment`,
      description: 'Not yet due.',
      timestamp: 'Open',
      severity: 'info',
      targetView: 'Sales',
      actionLabel: 'Open Sales',
      amountCents: total,
    });
  }

  // 2. Statutory deadlines, for organizations with staff on the payroll.
  const employees = employeesData?.employees || [];
  if (employees.length > 0) {
    statutoryDeadlines()
      .filter((d) => d.id !== 'vat')
      .forEach((d) => {
        notifications.push({
          id: `statutory-${d.id}-${format(d.due, 'yyyyMMdd')}`,
          category: 'payroll',
          title: `${d.label} due ${format(d.due, 'EEE d MMM')}`,
          description: d.rule,
          timestamp: dueIn(d.due),
          severity: differenceInCalendarDays(d.due, now) <= 3 ? 'urgent' : 'warning',
          targetView: 'Payroll',
          actionLabel: 'Open Payroll',
        });
      });
  }

  // 3. Slow responses measured in this browser.
  const slowCalls = apiMetrics.filter((m) => m.duration > 250);
  if (slowCalls.length > 0) {
    notifications.push({
      id: `system-slow-${slowCalls.length}`,
      category: 'system',
      title: `${slowCalls.length} slow ${slowCalls.length === 1 ? 'response' : 'responses'} this session`,
      description: `Slowest took ${Math.round(Math.max(...slowCalls.map((m) => m.duration)))} ms.`,
      timestamp: 'This browser',
      severity: 'warning',
      targetView: 'System Health',
      actionLabel: 'Open System health',
    });
  }

  // 4. Stock at or below its reorder point.
  const items = inventoryData?.items || [];
  items
    .filter((i: any) => i.quantityOnHand <= i.reorderPoint)
    .slice(0, 3)
    .forEach((item: any) => {
      notifications.push({
        id: `inventory-low-${item.id}`,
        category: 'inventory',
        title: `${item.name} needs reordering`,
        description: `${item.quantityOnHand} ${item.unitOfMeasure || 'units'} on hand; reorder at ${item.reorderPoint}.`,
        timestamp: 'Reorder point',
        severity: 'urgent',
        targetView: 'Inventory',
        actionLabel: 'Open Inventory',
      });
    });

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

  const markFor = (severity: AppNotification['severity']) =>
    severity === 'urgent' ? <Mark kind="circled" /> : severity === 'success' ? <Mark kind="tick" /> : <Mark kind="query" />;


  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        id="notification-bell-btn"
        data-tour="notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} new` : 'Notifications'}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-graphite-600 hover:text-ink-900"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-[17px] min-w-[17px] items-center justify-center border border-ink-900 bg-paper-100 px-1 text-[10.5px] font-semibold tabular-nums text-ink-900" aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="ll-lift fixed inset-x-3 top-14 z-50 border border-feint-strong border-t-2 border-t-ink-900 bg-paper-100 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[420px]" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between gap-3 border-b border-feint px-4 py-2.5">
            <p className="text-[14px] font-semibold text-ink-900">
              Needs attention
              {unreadCount > 0 && <span className="ml-2 font-normal text-graphite-600">{unreadCount} new</span>}
            </p>
            <div className="flex items-center gap-3">
              {unreadCount > 0 && (
                <button type="button" onClick={handleMarkAllRead} className={buttonClass.quiet}>
                  Mark all read
                </button>
              )}
              <button type="button" onClick={() => setIsOpen(false)} aria-label="Close" className="p-1 text-graphite-600 hover:text-ink-900">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex gap-4 overflow-x-auto border-b border-feint px-4 text-[12.5px]" role="tablist" aria-label="Filter notifications">
            {[
              { id: 'ALL', label: 'All' },
              { id: 'INVOICE', label: 'Sales' },
              { id: 'PAYROLL', label: 'Payroll' },
              { id: 'SYSTEM', label: 'System' },
              { id: 'INVENTORY', label: 'Stock' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeFilter === tab.id}
                onClick={() => setActiveFilter(tab.id as any)}
                className={`-mb-px whitespace-nowrap border-b-2 py-2 ${activeFilter === tab.id ? 'border-oxblood font-semibold text-ink-900' : 'border-transparent text-graphite-600 hover:text-ink-900'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <ul className="max-h-[380px] overflow-y-auto">
            {filteredNotifications.length === 0 ? (
              <li className="px-4 py-8 text-center">
                <p className="text-[14px] text-ink-900">
                  <Mark kind="tick" label="Nothing needs your attention." />
                </p>
              </li>
            ) : (
              filteredNotifications.map((item) => {
                const isRead = readIds.includes(item.id);
                return (
                  <li key={item.id} className="group relative border-b border-feint">
                    <button type="button" onClick={() => handleNavigate(item.targetView, item.id)} className="flex w-full items-start gap-2.5 px-4 py-3 pr-10 text-left hover:bg-paper-200">
                      <span className="mt-0.5">{markFor(item.severity)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className={`text-[13.5px] leading-snug text-ink-900 ${isRead ? '' : 'font-semibold'}`}>
                            {item.title}
                            {!isRead && <span className="sr-only"> (new)</span>}
                          </span>
                          <span className="shrink-0 text-[11.5px] text-graphite-600">{item.timestamp}</span>
                        </span>
                        <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[12.5px] leading-relaxed text-graphite-600">
                          <span className="line-clamp-2">{item.description}</span>
                          {item.amountCents !== undefined && <Amount cents={item.amountCents} size="sm" tone="ink" className="shrink-0" />}
                        </span>
                        <span className="mt-1.5 block text-[12.5px] text-oxblood underline underline-offset-[3px]">
                          {item.actionLabel}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDismiss(item.id, e)}
                      aria-label={`Dismiss ${item.title}`}
                      className="absolute right-2 top-2.5 p-1 text-graphite-600 opacity-100 hover:text-ink-900 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <div className="flex items-center justify-between gap-3 px-4 py-2 text-[12px] text-graphite-600">
            <span>Checked when this panel opens</span>
            <button
              type="button"
              onClick={() => {
                setActiveView('System Health');
                setIsOpen(false);
              }}
              className={buttonClass.quiet}
            >
              System health
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
