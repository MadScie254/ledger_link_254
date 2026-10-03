import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { Dialog, Field } from '../ledger/Dialog';
import { PageHeading, SkeletonRows, EmptyNote, LoadProblem, buttonClass } from '../ledger/Page';
import { useConfirm } from '../../hooks/useConfirm';
import { apiRequest } from '../../utils/apiRequest';
import { format } from 'date-fns';

type AssignableRole = 'admin' | 'member' | 'accountant';
type Role = 'owner' | AssignableRole;

interface TeamMember {
  id: string;
  userId: string;
  email: string;
  role: Role;
  status: string;
  isYou: boolean;
}

interface PendingInvitation {
  id: string;
  email: string;
  role: AssignableRole;
  invitedAt: string;
}

const ROLE_NOTE: Record<Role, string> = {
  owner: 'Holds the organization and posts to the books',
  admin: 'Posts to the books, invites members, changes roles and settings',
  accountant: 'Posts to the books, like an admin, but cannot change settings, roles or the team. Can belong to other organizations too',
  member: 'Can read the books; posting needs an owner or admin',
};

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  accountant: 'Accountant',
  member: 'Member',
};

export function TeamView() {
  const { currentOrgId, setActiveView, activeCompany, setCurrentOrgId } = useAppStore();
  const queryClient = useQueryClient();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AssignableRole>('member');
  const [formError, setFormError] = useState('');
  const [rowError, setRowError] = useState('');
  const [notice, setNotice] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  const team = useQuery({
    queryKey: ['team', currentOrgId],
    queryFn: () => apiRequest<{ members: TeamMember[]; invitations: PendingInvitation[] }>('/api/team', { fallback: 'Failed to fetch team' }),
  });
  const refreshTeam = () => queryClient.invalidateQueries({ queryKey: ['team', currentOrgId] });
  const rowFailed = (err: Error) => { setNotice(''); setRowError(err.message); };
  const rowDone = (message: string) => { setRowError(''); setNotice(message); refreshTeam(); };

  const inviteMutation = useMutation({
    mutationFn: () => apiRequest<{ emailed: boolean }>('/api/team', {
      body: { email: inviteEmail.trim(), role: inviteRole },
      fallback: 'The invitation could not be sent.',
    }),
    onSuccess: (result) => {
      rowDone(result.emailed
        ? `Invitation sent to ${inviteEmail.trim()}. They join once they create an account and accept.`
        : `Invitation recorded for ${inviteEmail.trim()}. They join once they accept it, signed in with that address.`);
      closeInvite();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: AssignableRole }) =>
      apiRequest(`/api/team/${id}`, { method: 'PATCH', body: { role }, fallback: 'The role could not be changed.' }),
    onSuccess: () => rowDone('Role changed.'),
    onError: rowFailed,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/team/${id}`, { method: 'DELETE', fallback: 'The member could not be removed.' }),
    onSuccess: () => rowDone('Member removed.'),
    onError: rowFailed,
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/team/invitations/${id}`, { method: 'DELETE', fallback: 'The invitation could not be withdrawn.' }),
    onSuccess: () => rowDone('Invitation withdrawn.'),
    onError: rowFailed,
  });

  const transferMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/team/${id}/transfer-ownership`, { method: 'POST', fallback: 'Ownership could not be transferred.' }),
    onSuccess: () => rowDone('Ownership transferred. You are now an admin.'),
    onError: rowFailed,
  });

  const leaveMutation = useMutation({
    mutationFn: () => apiRequest('/api/membership/leave', { method: 'POST', fallback: 'You could not leave this organization.' }),
    onSuccess: () => {
      setCurrentOrgId('');
      queryClient.invalidateQueries();
      setActiveView('Home / Dashboard');
    },
    onError: rowFailed,
  });

  function closeInvite() {
    setIsInviteOpen(false);
    setInviteEmail('');
    setInviteRole('member');
    setFormError('');
  }

  const members: TeamMember[] = team.data?.members || [];
  const invitations: PendingInvitation[] = team.data?.invitations || [];
  // Only an owner or admin can invite, change a role, or remove someone, and
  // only the owner can change or remove an admin.
  const myRole = members.find((m) => m.isYou)?.role;
  const isOwner = myRole === 'owner';
  const canManageTeam = isOwner || myRole === 'admin';
  const canManage = (m: TeamMember) => canManageTeam && !m.isYou && m.role !== 'owner' && (isOwner || m.role !== 'admin');

  const roleControl = (m: TeamMember) => {
    if (!canManage(m)) {
      return <span className={`text-[13.5px] text-ink-900 ${m.role === 'owner' ? 'font-semibold' : ''}`}>{ROLE_LABEL[m.role]}</span>;
    }
    return (
      <select
        aria-label={`Role for ${m.email}`}
        value={m.role}
        onChange={(e) => roleMutation.mutate({ id: m.id, role: e.target.value as AssignableRole })}
        disabled={roleMutation.isPending}
        className="h-8 border px-2 text-[13px]"
      >
        {isOwner && <option value="admin">Admin</option>}
        <option value="accountant">Accountant</option>
        <option value="member">Member</option>
      </select>
    );
  };

  const rowActions = (m: TeamMember) => {
    const actions = [];
    if (isOwner && !m.isYou) {
      actions.push(
        <button
          key="transfer"
          type="button"
          className={buttonClass.quiet}
          onClick={() => confirm(
            {
              title: 'Transfer ownership',
              message: `Make ${m.email} the owner of ${activeCompany?.name || 'this organization'}? You become an admin, and only the new owner can transfer it back.`,
              confirmText: 'Transfer ownership',
              isDestructive: true,
            },
            () => transferMutation.mutate(m.id),
          )}
        >
          Make owner
        </button>,
      );
    }
    if (canManage(m)) {
      actions.push(
        <button
          key="remove"
          type="button"
          className={buttonClass.quiet}
          onClick={() => confirm(
            {
              title: 'Remove team member',
              message: `Remove ${m.email} from this organization? They lose access to its books straight away.`,
              confirmText: 'Remove',
              isDestructive: true,
            },
            () => removeMutation.mutate(m.id),
          )}
        >
          Remove
        </button>,
      );
    }
    if (m.isYou && !isOwner) {
      actions.push(
        <button
          key="leave"
          type="button"
          className={buttonClass.quiet}
          onClick={() => confirm(
            {
              title: 'Leave this organization',
              message: `Leave ${activeCompany?.name || 'this organization'}? You lose access to its books until someone invites you again.`,
              confirmText: 'Leave',
              isDestructive: true,
            },
            () => leaveMutation.mutate(),
          )}
        >
          Leave
        </button>,
      );
    }
    return actions.length ? <div className="flex flex-wrap gap-3 sm:justify-end">{actions}</div> : null;
  };

  return (
    <div className="max-w-4xl space-y-5 pb-16">
      <PageHeading
        tourId="team-overview"
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
          canManageTeam ? (
            <button type="button" onClick={() => setIsInviteOpen(true)} className={buttonClass.primary}>
              Invite a member
            </button>
          ) : undefined
        }
      />

      {rowError && (
        <p role="alert" className="text-[13.5px] text-ledger-red">
          {rowError}
        </p>
      )}
      {notice && !rowError && (
        <p role="status" className="text-[13.5px] text-ink-900">
          {notice}
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
            <li key={m.id} className="grid grid-cols-1 gap-2 border-b border-feint py-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem] sm:items-center sm:gap-4">
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
              <div className="sm:text-right">{rowActions(m)}</div>
            </li>
          ))}
        </ul>
      )}

      {canManageTeam && invitations.length > 0 && (
        <section aria-labelledby="pending-invitations" className="space-y-2">
          <h2 id="pending-invitations" className="ll-heading text-[17px] text-ink-900">Waiting to accept</h2>
          <ul className="border-t border-feint-strong">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="grid grid-cols-1 gap-2 border-b border-feint py-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] text-ink-900">{invitation.email}</p>
                  <p className="mt-0.5 text-[12.5px] text-graphite-600">
                    Invited {invitation.invitedAt ? format(new Date(invitation.invitedAt), 'dd/MM/yyyy') : ''}
                  </p>
                </div>
                <div className="text-[13.5px] text-ink-900">{ROLE_LABEL[invitation.role]}</div>
                <div className="sm:text-right">
                  {(isOwner || invitation.role !== 'admin') && (
                    <button
                      type="button"
                      className={buttonClass.quiet}
                      disabled={revokeMutation.isPending}
                      onClick={() => revokeMutation.mutate(invitation.id)}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        open={isInviteOpen}
        onClose={closeInvite}
        title="Invite a member"
        note="Nobody joins without agreeing to. They see the invitation when they sign in with this address, and join when they accept it. A new address is also emailed a link to create an account."
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
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as AssignableRole)}>
              <option value="member">Member</option>
              <option value="accountant">Accountant</option>
              {isOwner && <option value="admin">Admin</option>}
            </select>
          </Field>
        </form>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
