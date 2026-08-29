import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { format } from 'date-fns';

export function AuditLogView() {
  const { currentOrgId } = useAppStore();

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['audit-logs', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/audit', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch audit logs');
      return res.json();
    }
  });

  const logs = auditData?.logs || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-serif text-ink-900">Audit Logs</h1>
          <p className="text-slate-500 mt-1">Immutable chronological record of ledger events.</p>
        </div>
      </div>
      
      <div className="ledger-divider mb-6"></div>

      <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm">
        <div className="p-4 border-b border-ink-900/10 flex gap-4">
          <input 
            type="text" 
            placeholder="Search logs..." 
            className="border border-ink-900/20 px-3 py-1.5 rounded-sm w-64 text-sm focus:outline-none focus:ring-1 focus:ring-ink-900"
          />
          <select className="border border-ink-900/20 px-3 py-1.5 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ink-900 bg-paper-100">
            <option>All Events</option>
            <option>Journal Entries</option>
            <option>Accounts</option>
          </select>
        </div>
        
        <table className="w-full text-sm text-left">
          <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Timestamp</th>
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold">Resource Type</th>
              <th className="px-4 py-3 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-900/5">
            {auditLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading audit logs...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No audit logs found.</td></tr>
            ) : (
              logs.map((log: any) => (
                <tr key={log.id} className="hover:bg-paper-50 transition-colors">
                  <td className="px-4 py-3 text-ink-900 font-medium">
                    {format(new Date(log.timestamp), 'MMM d, yyyy HH:mm')}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{log.userId}</td>
                  <td className="px-4 py-3">
                    <span className="bg-ink-900/5 text-ink-900 px-2 py-0.5 rounded text-xs font-medium">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{log.resourceType}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-xs" title={JSON.stringify(log.details)}>
                    {JSON.stringify(log.details)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
