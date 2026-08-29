import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { format } from 'date-fns';

export function TeamView() {
  const { currentOrgId } = useAppStore();

  const { data: auditData, isLoading: logsLoading } = useQuery({
    queryKey: ['audit-logs', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/audit', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch audit logs');
      return res.json();
    }
  });

  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ['team', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/team', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch team');
      return res.json();
    }
  });

  const logs = auditData?.logs || [];
  const members = teamData?.members || [];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Team & Permissions</h1>
        <button className="bg-ink-900 text-white  px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">
          Invite Member
        </button>
      </div>
      <div className="ledger-divider mb-6"></div>

      <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-900/5">
            {teamLoading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Loading team...</td></tr>
            ) : members.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No additional team members found.</td></tr>
            ) : (
              members.map((m: any) => (
                <tr key={m.id} className="hover:bg-paper-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink-900">{m.name}</div>
                    <div className="text-slate-500 text-xs">{m.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${m.role === 'Admin' ? 'bg-ink-900 text-white ' : 'bg-paper-100 text-slate-700 border border-ink-900/10'}`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ledger-green-700 font-medium text-xs">{m.status || 'Active'}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-focus-blue-500 hover:underline">Edit</button>
                  </td>
                </tr>
              ))
            )}
            
            {/* Owner Row */}
            <tr className="hover:bg-paper-50 transition-colors bg-paper-50">
              <td className="px-4 py-3">
                <div className="font-medium text-ink-900">Daniel Einstein (You)</div>
                <div className="text-slate-500 text-xs">danieleinstein1998@gmail.com</div>
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-ink-900 text-white ">
                  Owner / Super Admin
                </span>
              </td>
              <td className="px-4 py-3 text-ledger-green-700 font-medium text-xs">Active</td>
              <td className="px-4 py-3 text-right">-</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-8 bg-paper-50 border border-ink-900/10 rounded-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-medium text-ink-900 mb-1">Audit Log</h3>
            <p className="text-sm text-slate-500">Enterprise audit trailing is enabled. All structural ledger modifications are permanently recorded.</p>
          </div>
          <button className="text-sm font-medium text-focus-blue-500 border border-focus-blue-500/30 px-4 py-2 rounded-sm hover:bg-paper-100 transition-colors">
            Export Audit Trail (CSV)
          </button>
        </div>

        <div className="bg-paper-100 border border-ink-900/10 rounded-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Timestamp</th>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Resource</th>
                <th className="px-4 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {logsLoading ? (
                <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-500">Loading audit logs...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-500">No events logged yet.</td></tr>
              ) : (
                logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-paper-50">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                      {log.timestamp ? format(new Date(log.timestamp.seconds * 1000), 'MMM d, yyyy HH:mm:ss') : 'Just now'}
                    </td>
                    <td className="px-4 py-3 font-medium">{log.userId}</td>
                    <td className="px-4 py-3">
                      <span className="bg-paper-100 text-ink-900 px-2 py-0.5 rounded text-xs">{log.action}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{log.resourceType}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate">
                      {JSON.stringify(log.details)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
