import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { Dialog, Field } from '../ledger/Dialog';
import { PageHeading, SkeletonRows, EmptyNote, LoadProblem, buttonClass } from '../ledger/Page';

interface TeamMember {
  id: string;
  userId: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  status: string;
  isYou: boolean;
}

const ROLE_NOTE: Record<TeamMember['role'], string> = {
  owner: 'Holds the organization and posts to the books',
  admin: 'Posts to the books, invites members, changes roles and settings',
  member: 'Can read the books; posting needs an owner or admin',
};

export function TeamView() {
  const { currentOrgId, setActiveView } = useAppStore();
  const queryClient = useQueryClient();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [formError, setFormError] = useState('');
  const [rowError, setRowError] = useState('');

  const team = useQuery({
    queryKey: ['team', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/team', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch team');
      return res.json();
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'The invitation could not be sent.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', currentOrgId] });
      closeInvite();
    },
    onError: (err: any) => setFormError(err.message),
  });

  const roleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: 'admin' | 'member' }) => {
      const res = await fetch(`/api/team/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'The role could not be changed.');
      }
      return res.json();
    },
    onSuccess: () => {
      setRowError('');
      queryClient.invalidateQueries({ queryKey: ['team', currentOrgId] });
    },
    onError: (err: any) => setRowError(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/team/${id}`, { method: 'DELETE', headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'The member could not be removed.');
      }
      return res.json();
    },
    onSuccess: () => {
      setRowError('');
      queryClient.invalidateQueries({ queryKey: ['team', currentOrgId] });
    },
    onError: (err: any) => setRowError(err.message),
  });

  function closeInvite() {
    setIsInviteOpen(false);
    setInviteEmail('');
    setInviteRole('member');
    setFormError('');
  }

  const members: TeamMember[] = team.data?.members || [];

  const roleControl = (m: TeamMember) =>
    m.role === 'owner' ? (
      <span className="text-[13.5px] font-semibold text-ink-900">Owner</span>
    ) : (
      <select
        aria-label={`Role for ${m.email}`}
        value={m.role}
        onChange={(e) => roleMutation.mutate({ id: m.id, role: e.target.value as 'admin' | 'member' })}
        disabled={roleMutation.isPending || m.isYou}
        className="h-8 border px-2 text-[13px]"
      >
        <option value="admin">Admin</option>
        <option value="member">Member</option>
      </select>
    );

  const removeControl = (m: TeamMember) =>
    m.role !== 'owner' && !m.isYou ? (
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Remove ${m.email} from this organization? They lose access to its books straight away.`)) {
            removeMutation.mutate(m.id);
          }
        }}
        className={`${buttonClass.quiet} text-ledger-red`}
      >
        Remove
      </button>
    ) : null;

  return (
    <div className="max-w-4xl space-y-5 pb-16">
      <PageHeading
        title="Team"
        note={
          <>
            Who can open these books, and what they may change. Every change here is recorded in the{' '}
            <button type="button" onClick={() => setActiveView('Audit Logs')} className={buttonClass.quiet}>
              audit log
            </button>
            .
          </>
        }
        actions={
          <button type="button" onClick={() => setIsInviteOpen(true)} className={buttonClass.primary}>
            Invite a member
          </button>
        }
      />

      {rowError && (
        <p role="alert" className="text-[13.5px] text-ledger-red">
          {rowError}
        </p>
      )}

      {team.isError ? (
        <LoadProblem what="the team" path="/api/team" onRetry={() => team.refetch()} />
      ) : team.isLoading ? (
        <SkeletonRows label="Loading the team" rows={3} />
      ) : members.length === 0 ? (
        <EmptyNote>No members are listed for this organization.</EmptyNote>
      ) : (
        <ul className="border-t border-feint-strong">
          {members.map((m) => (
            <li key={m.id} className="grid grid-cols-1 gap-2 border-b border-feint py-3 sm:grid-cols-[minmax(0,1fr)_10rem_5rem] sm:items-center sm:gap-4">
              <div className="min-w-0">
                <p className="truncate text-[14.5px] text-ink-900">
                  {m.email}
                  {m.isYou && <span className="ml-2 text-[12.5px] text-graphite-600">you</span>}
                </p>
                <p className="mt-0.5 text-[12.5px] text-graphite-600">
                  {ROLE_NOTE[m.role]}
                  {m.status && m.status.toLowerCase() !== 'active' ? ` · ${m.status}` : ''}
                </p>
              </div>
              <div>{roleControl(m)}</div>
              <div className="sm:text-right">{removeControl(m)}</div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={isInviteOpen}
        onClose={closeInvite}
        title="Invite a member"
        note="A new address receives an email invitation. Someone who already uses Ledger Link is added straight away."
        footer={
          <>
            <button type="button" onClick={closeInvite} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" form="invite-form" disabled={inviteMutation.isPending} className={buttonClass.primary}>
              {inviteMutation.isPending ? 'Sending' : 'Send invitation'}
            </button>
          </>
        }
      >
        <form
          id="invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError('');
            inviteMutation.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Email address" error={formError || undefined}>
            <input type="email" required autoComplete="off" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          </Field>
          <Field label="Role" hint={ROLE_NOTE[inviteRole]}>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
