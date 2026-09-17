import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import Papa from 'papaparse';
import { useAppStore } from '../../store';
import { Amount } from '../ledger/Amount';
import { PageHeading, SkeletonRows, EmptyNote, LoadProblem, buttonClass } from '../ledger/Page';

const RESOURCE_NAMES: Record<string, string> = {
  JOURNAL_ENTRY: 'Journal entry',
  ACCOUNT: 'Account',
  BANK_TRANSACTION: 'Bank line',
  BILL: 'Bill',
  INVOICE: 'Invoice',
  USER_ROLE: 'Role',
  TEAM_MEMBER: 'Team member',
};

const ACTION_NAMES: Record<string, string> = { CREATE: 'Created', UPDATE: 'Changed', DELETE: 'Removed', VOID: 'Voided', POST: 'Posted' };

const DETAIL_NAMES: Record<string, string> = {
  memo: 'Particulars',
  amountCents: 'Amount',
  totalCents: 'Total',
  email: 'Email',
  role: 'Role',
  name: 'Name',
  code: 'Code',
  type: 'Type',
  status: 'Status',
  referenceNo: 'Reference',
  invoiceNumber: 'Invoice',
  billNumber: 'Bill',
};

const readableKey = (key: string) =>
  DETAIL_NAMES[key] || key.replace(/Cents$/, '').replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()).trim();

/** The simple fields of a details object, in order, without internal ids. */
function detailEntries(details: any): [string, string | number][] {
  if (!details || typeof details !== 'object') return [];
  return Object.entries(details)
    .filter(([k, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object' && !/id$/i.test(k))
    .slice(0, 4) as [string, string | number][];
}

/** Plain text of the details, for search. */
function describe(details: any): string {
  return detailEntries(details)
    .map(([k, v]) => `${readableKey(k)} ${/Cents$/.test(k) ? Number(v) / 100 : v}`)
    .join(' ');
}

export function AuditLogView() {
  const { currentOrgId, activeCompany } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const [searchQuery, setSearchQuery] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');

  const audit = useQuery({
    queryKey: ['audit-logs', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/audit', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch audit logs');
      return res.json();
    },
  });

  const team = useQuery({
    queryKey: ['team', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/team', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch team');
      return res.json();
    },
  });

  const who = (userId?: string) => {
    if (!userId) return 'System';
    const member = (team.data?.members || []).find((m: any) => m.userId === userId);
    return member ? member.email : `User ${userId.slice(0, 8)}`;
  };

  const allLogs: any[] = audit.data?.logs || [];
  const resourceTypes = Array.from(new Set(allLogs.map((l) => l.resourceType).filter(Boolean)));
  const logs = allLogs.filter((log) => {
    const matchesResource = !resourceFilter || log.resourceType === resourceFilter;
    const haystack = `${log.action} ${RESOURCE_NAMES[log.resourceType] || log.resourceType} ${who(log.userId)} ${describe(log.details)}`.toLowerCase();
    return matchesResource && (!searchQuery || haystack.includes(searchQuery.toLowerCase()));
  });

  const exportCsv = () => {
    const csv = Papa.unparse(
      logs.map((log) => ({
        Time: log.timestamp || '',
        By: who(log.userId),
        Action: log.action || '',
        Record: log.resourceType || '',
        RecordId: log.resourceId || '',
        Details: JSON.stringify(log.details || {}),
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

  return (
    <div className="space-y-5 pb-16">
      <PageHeading
        title="Audit log"
        note="Every change to accounts, entries and the team, in the order it happened. Entries cannot be edited or removed."
        actions={
          <button type="button" onClick={exportCsv} disabled={!logs.length} className={buttonClass.secondary}>
            Export CSV
          </button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block sm:w-72">
          <span className="block text-[13px] font-semibold text-ink-900">Search</span>
          <input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="mt-1.5 h-9 w-full border px-3 text-[14px]" />
        </label>
        <label className="block sm:w-52">
          <span className="block text-[13px] font-semibold text-ink-900">Record</span>
          <select value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)} className="mt-1.5 h-9 w-full border px-2.5 text-[14px]">
            <option value="">All records</option>
            {resourceTypes.map((t) => (
              <option key={t} value={t}>{RESOURCE_NAMES[t] || t}</option>
            ))}
          </select>
        </label>
      </div>

      {audit.isError ? (
        <LoadProblem what="the audit log" path="/api/audit" onRetry={() => audit.refetch()} />
      ) : audit.isLoading ? (
        <SkeletonRows label="Loading the audit log" />
      ) : logs.length === 0 ? (
        <EmptyNote>{allLogs.length === 0 ? 'Nothing has been recorded yet. Changes to accounts, entries and the team appear here as they happen.' : 'No entries match this search.'}</EmptyNote>
      ) : (
        <ol className="border-t border-feint-strong" aria-label="Audit log, newest first">
          {logs.map((log) => (
            <li key={log.id} className="grid grid-cols-1 gap-1 border-b border-feint py-2.5 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-4">
              <time dateTime={log.timestamp} className="ll-figure text-[13px] text-graphite-600">
                {log.timestamp ? format(new Date(log.timestamp), 'dd/MM/yyyy HH:mm') : '–'}
              </time>
              <div className="min-w-0">
                <p className="text-[14px] text-ink-900">
                  <span className="font-semibold">{ACTION_NAMES[log.action] || log.action}</span> {(RESOURCE_NAMES[log.resourceType] || log.resourceType || 'record').toLowerCase()}
                  <span className="text-graphite-600"> by {who(log.userId)}</span>
                </p>
                {detailEntries(log.details).length > 0 && (
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12.5px] text-graphite-600">
                    {detailEntries(log.details).map(([k, v]) => (
                      <span key={k} className="inline-flex items-baseline gap-1">
                        {readableKey(k)}
                        {/Cents$/.test(k) ? <Amount cents={Number(v)} currency={baseCurrency} size="xs" tone="ink" /> : <span className="text-ink-900">{String(v)}</span>}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
