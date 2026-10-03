import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import Papa from 'papaparse';
import { useAppStore } from '../../store';
import { Amount } from '../ledger/Amount';
import { PageHeading, SkeletonRows, EmptyNote, LoadProblem, buttonClass } from '../ledger/Page';
import { apiRequest } from '../../utils/apiRequest';

const RESOURCE_NAMES: Record<string, string> = {
  JOURNAL_ENTRY: 'Journal entry',
  ACCOUNT: 'Account',
  BANK_TRANSACTION: 'Bank line',
  BANK_RULE: 'Bank rule',
  BILL: 'Bill',
  BUDGET: 'Budget',
  CUSTOMER: 'Customer',
  EMPLOYEE: 'Employee',
  INVENTORY_ITEM: 'Stock item',
  INVOICE: 'Invoice',
  ORGANIZATION: 'Company settings',
  PAYROLL_RUN: 'Payroll run',
  PROJECT: 'Project',
  SALES_ORDER: 'Sales order',
  TEAM_MEMBER: 'Team member',
  USER_ROLE: 'Role',
  VENDOR: 'Vendor',
};

const ACTION_NAMES: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Changed',
  DELETE: 'Removed',
  VOID: 'Voided',
  POST: 'Posted',
  PAYMENT: 'Payment recorded on',
  REVERSE: 'Payment reversed on',
  APPROVE: 'Approved',
  ADJUST: 'Stock counted for',
  MATCH: 'Matched',
  UNMATCH: 'Unmatched',
  INVITE: 'Invited',
  REVOKE: 'Withdrew invitation for',
};

const DETAIL_NAMES: Record<string, string> = {
  memo: 'Particulars',
  amountCents: 'Amount',
  totalCents: 'Total',
  email: 'Email',
  role: 'Role',
  name: 'Name',
  display_name: 'Name',
  code: 'Code',
  type: 'Type',
  status: 'Status',
  referenceNo: 'Reference',
  invoiceNumber: 'Invoice',
  billNumber: 'Bill',
  is_active: 'Active',
  is_bank_account: 'Holds money',
  books_closed_through: 'Books closed through',
  approval_threshold_cents: 'Approval limit',
  ai_enabled: 'AI features',
  time_zone: 'Time zone',
};

const readableKey = (key: string) =>
  DETAIL_NAMES[key] || key.replace(/(_cents|Cents)$/, '').replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()).trim();
const isMoneyKey = (key: string) => /(_cents|Cents)$/.test(key);
const isInternalKey = (key: string) => /(^|_)id$|Id$|^org_id$|^created_at$|^updated_at$|^import_batch_id$/.test(key);

type Simple = string | number | boolean;
const isSimple = (v: unknown): v is Simple => ['string', 'number', 'boolean'].includes(typeof v);

/** The simple fields of a details object, in order, without internal ids. */
function detailEntries(details: any): [string, Simple][] {
  if (!details || typeof details !== 'object') return [];
  const source = details.values && typeof details.values === 'object' ? details.values : details;
  return Object.entries(source)
    .filter(([k, v]) => v !== null && v !== undefined && v !== '' && isSimple(v) && !isInternalKey(k))
    .slice(0, 5) as [string, Simple][];
}

/** What an update changed: each field from its old value to its new one. */
function changeEntries(details: any): Array<[string, unknown, unknown]> {
  const changes = details?.changes;
  if (!changes || typeof changes !== 'object') return [];
  return Object.entries(changes)
    .filter(([k]) => !isInternalKey(k))
    .map(([k, v]: [string, any]) => [k, v?.from, v?.to] as [string, unknown, unknown]);
}

/** Plain text of the details, for search and export. */
function describe(details: any): string {
  const changes = changeEntries(details).map(([k, from, to]) => `${readableKey(k)} ${text(from)} to ${text(to)}`);
  const values = detailEntries(details).map(([k, v]) => `${readableKey(k)} ${isMoneyKey(k) ? Number(v) / 100 : v}`);
  return [...changes, ...values].join('; ');
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'blank';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return 'changed';
  return String(value);
}

interface AuditLog {
  id: string;
  userId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: any;
  timestamp: string;
}

export function AuditLogView() {
  const { currentOrgId, activeCompany } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const [searchQuery, setSearchQuery] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');

  // Newest first, 100 at a time; older pages load on request.
  const audit = useInfiniteQuery({
    queryKey: ['audit-logs', currentOrgId, resourceFilter],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '100' });
      if (pageParam) params.set('cursor', pageParam);
      if (resourceFilter) params.set('resourceType', resourceFilter);
      return apiRequest<{ logs: AuditLog[]; nextCursor: string | null }>(`/api/audit?${params}`, { fallback: 'Failed to fetch audit logs' });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  });

  const team = useQuery({
    queryKey: ['team', currentOrgId],
    queryFn: () => apiRequest('/api/team'),
  });

  const who = (log: AuditLog) => {
    if (log.actorEmail) return log.actorEmail;
    if (!log.userId) return 'the system';
    const member = (team.data?.members || []).find((m: any) => m.userId === log.userId);
    return member ? member.email : `a former member (${log.userId.slice(0, 8)})`;
  };

  const allLogs: AuditLog[] = (audit.data?.pages || []).flatMap((page) => page.logs);
  const logs = allLogs.filter((log) => {
    if (!searchQuery) return true;
    const haystack = `${ACTION_NAMES[log.action] || log.action} ${RESOURCE_NAMES[log.resourceType] || log.resourceType} ${who(log)} ${describe(log.details)}`.toLowerCase();
    return haystack.includes(searchQuery.toLowerCase());
  });

  const exportCsv = () => {
    const csv = Papa.unparse(
      logs.map((log) => ({
        Time: log.timestamp || '',
        By: who(log),
        Action: log.action || '',
        Record: log.resourceType || '',
        RecordId: log.resourceId || '',
        Details: describe(log.details),
      })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit_log_${format(new Date(), 'yyyyMMdd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const value = (key: string, v: unknown) =>
    isMoneyKey(key) && v !== null && v !== undefined && v !== ''
      ? <Amount cents={Number(v)} currency={baseCurrency} size="xs" tone="ink" />
      : <span className="text-ink-900">{text(v)}</span>;

  return (
    <div className="space-y-5 pb-16">
      <PageHeading
        tourId="audit-overview"
        title="Audit log"
        note="Every change to the books, records, settings and the team, with who made it, newest first. Entries cannot be edited or removed."
        actions={
          <button type="button" onClick={exportCsv} disabled={!logs.length} className={buttonClass.secondary}>
            Export CSV
          </button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block sm:w-72">
          <span className="block text-[13px] font-semibold text-ink-900">Search the entries shown</span>
          <input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="mt-1.5 h-9 w-full border px-3 text-[14px]" />
        </label>
        <label className="block sm:w-52">
          <span className="block text-[13px] font-semibold text-ink-900">Record</span>
          <select value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)} className="mt-1.5 h-9 w-full border px-2.5 text-[14px]">
            <option value="">All records</option>
            {Object.entries(RESOURCE_NAMES)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([type, name]) => (
                <option key={type} value={type}>{name}</option>
              ))}
          </select>
        </label>
      </div>

      {audit.isError ? (
        <LoadProblem what="the audit log" path="/api/audit" onRetry={() => audit.refetch()} />
      ) : audit.isLoading ? (
        <SkeletonRows label="Loading the audit log" />
      ) : logs.length === 0 ? (
        <EmptyNote>
          {allLogs.length === 0
            ? resourceFilter ? 'Nothing recorded for this kind of record yet.' : 'Nothing has been recorded yet. Changes appear here as they happen.'
            : 'No entries shown match this search. Load older entries to search further back.'}
        </EmptyNote>
      ) : (
        <ol className="border-t border-feint-strong" aria-label="Audit log, newest first">
          {logs.map((log) => {
            const changes = changeEntries(log.details);
            const values = changes.length ? [] : detailEntries(log.details);
            return (
              <li key={log.id} className="grid grid-cols-1 gap-1 border-b border-feint py-2.5 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-4">
                <time dateTime={log.timestamp} className="ll-figure text-[13px] text-graphite-600">
                  {log.timestamp ? format(new Date(log.timestamp), 'dd/MM/yyyy HH:mm') : '–'}
                </time>
                <div className="min-w-0">
                  <p className="text-[14px] text-ink-900">
                    <span className="font-semibold">{ACTION_NAMES[log.action] || log.action}</span> {(RESOURCE_NAMES[log.resourceType] || log.resourceType || 'record').toLowerCase()}
                    <span className="text-graphite-600"> by {who(log)}</span>
                  </p>
                  {changes.length > 0 && (
                    <ul className="mt-0.5 space-y-0.5 text-[12.5px] text-graphite-600">
                      {changes.slice(0, 8).map(([k, from, to]) => (
                        <li key={k} className="flex flex-wrap items-baseline gap-1">
                          {readableKey(k)}: {value(k, from)} <span aria-label="changed to">→</span> {value(k, to)}
                        </li>
                      ))}
                      {changes.length > 8 && <li>and {changes.length - 8} more fields</li>}
                    </ul>
                  )}
                  {values.length > 0 && (
                    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12.5px] text-graphite-600">
                      {values.map(([k, v]) => (
                        <span key={k} className="inline-flex items-baseline gap-1">
                          {readableKey(k)} {value(k, v)}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {audit.hasNextPage && (
        <button type="button" onClick={() => audit.fetchNextPage()} disabled={audit.isFetchingNextPage} className={buttonClass.secondary}>
          {audit.isFetchingNextPage ? 'Loading' : 'Load older entries'}
        </button>
      )}
    </div>
  );
}
