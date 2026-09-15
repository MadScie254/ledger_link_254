import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { format } from 'date-fns';
import { UserPlus, X, Trash2 } from 'lucide-react';
import Papa from 'papaparse';

interface TeamMember {
  id: string;
  userId: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  status: string;
  isYou: boolean;
}

export function TeamView() {
  const { currentOrgId } = useAppStore();
  const queryClient = useQueryClient();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [formError, setFormError] = useState('');

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

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to invite team member');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', currentOrgId] });
      setIsInviteOpen(false);
      setInviteEmail('');
      setInviteRole('member');
      setFormError('');
    },
    onError: (err: any) => setFormError(err.message)
  });

  const roleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: 'admin' | 'member' }) => {
      const res = await fetch(`/api/team/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ role })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update role');
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team', currentOrgId] })
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/team/${id}`, {
        method: 'DELETE',
        headers: { 'x-org-id': currentOrgId }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to remove team member');
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team', currentOrgId] })
  });

  const members: TeamMember[] = teamData?.members || [];
  const logs = auditData?.logs || [];

  const handleExportAuditCSV = () => {
    if (!logs.length) return;
    const csv = Papa.unparse(logs.map((log: any) => ({
      Timestamp: log.timestamp || '',
      User: log.userId || '',
      Action: log.action || '',
      Resource: log.resourceType || '',
      Details: JSON.stringify(log.details || {})
    })));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `audit_trail_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Team & Permissions</h1>
        <button
          onClick={() => setIsInviteOpen(true)}
          className="bg-sidebar-bg text-sidebar-ink px-4 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors flex items-center space-x-1.5"
        >
          <UserPlus className="w-4 h-4" />
          <span>Invite Member</span>
        </button>
      </div>
      <div className="ledger-divider mb-6"></div>

      {isInviteOpen && (
        <div className="fixed inset-0 bg-ink-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-paper-100 rounded-sm shadow-2xl border border-ink-900/10 w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-serif text-ink-900 font-medium">Invite Team Member</h2>
              <button onClick={() => setIsInviteOpen(false)} className="text-slate-400 hover:text-ink-900">
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-3 p-2.5 bg-rust-700/10 border border-rust-700/20 text-rust-700 text-xs rounded-sm">
                {formError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setFormError('');
                inviteMutation.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                  className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                >
                  <option value="member">Member (read/write access)</option>
                  <option value="admin">Admin (full organization control)</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={inviteMutation.isPending}
                className="w-full bg-sidebar-bg text-sidebar-ink py-2.5 rounded-sm font-medium hover:bg-sidebar-bg/90 transition-colors disabled:opacity-50"
              >
                {inviteMutation.isPending ? 'Sending invite...' : 'Send Invite'}
              </button>
            </form>
          </div>
        </div>
      )}

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
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No team members found.</td></tr>
            ) : (
              members.map((m) => (
                <tr key={m.id} className="hover:bg-paper-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink-900">{m.email}{m.isYou ? ' (You)' : ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    {m.role === 'owner' ? (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-sidebar-bg text-sidebar-ink">
                        Owner
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) => roleMutation.mutate({ id: m.id, role: e.target.value as 'admin' | 'member' })}
                        disabled={roleMutation.isPending}
                        className="text-xs font-medium bg-paper-100 border border-ink-900/10 rounded px-2 py-1 text-slate-700 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ledger-green-700 font-medium text-xs">{m.status}</td>
                  <td className="px-4 py-3 text-right">
                    {m.role !== 'owner' && !m.isYou && (
                      <button
                        onClick={() => {
                          if (confirm(`Remove ${m.email} from this organization?`)) {
                            removeMutation.mutate(m.id);
                          }
                        }}
                        className="text-rust-700 hover:underline inline-flex items-center space-x-1"
                        title="Remove from organization"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-8 bg-paper-50 border border-ink-900/10 rounded-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-medium text-ink-900 mb-1">Audit Log</h3>
            <p className="text-sm text-slate-500">Enterprise audit trailing is enabled. All structural ledger modifications are permanently recorded.</p>
          </div>
          <button
            onClick={handleExportAuditCSV}
            disabled={!logs.length}
            className="text-sm font-medium text-focus-blue-500 border border-focus-blue-500/30 px-4 py-2 rounded-sm hover:bg-paper-100 transition-colors disabled:opacity-40"
          >
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
                      {log.timestamp ? format(new Date(log.timestamp), 'MMM d, yyyy HH:mm:ss') : 'Just now'}
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
