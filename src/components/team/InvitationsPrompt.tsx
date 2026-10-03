import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { buttonClass } from '../ledger/Page';

interface MyInvitation {
  id: string;
  orgId: string;
  organizationName: string;
  role: 'admin' | 'member' | 'accountant';
  invitedByEmail: string | null;
}

const ROLE_LABEL = { admin: 'an admin', member: 'a member', accountant: 'the accountant' } as const;

/**
 * Invitations waiting for the signed-in person, shown above every page until
 * they accept or decline each one. Nobody is added to an organization
 * without this step.
 */
export function InvitationsPrompt() {
  const queryClient = useQueryClient();
  const { setCurrentOrgId } = useAppStore();
  const [error, setError] = useState('');

  const invitations = useQuery({
    queryKey: ['my-invitations'],
    queryFn: () => apiRequest<{ invitations: MyInvitation[] }>('/api/invitations').then((body) => body.invitations),
    staleTime: 60_000,
  });

  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      apiRequest<{ orgId: string; accepted: boolean }>(`/api/invitations/${id}/${accept ? 'accept' : 'decline'}`, {
        method: 'POST',
        fallback: 'That invitation could not be answered.',
      }),
    onSuccess: async (result) => {
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['my-invitations'] });
      if (result.accepted) {
        await queryClient.invalidateQueries({ queryKey: ['organizations'] });
        setCurrentOrgId(result.orgId);
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  const pending = invitations.data || [];
  if (pending.length === 0) return null;

  return (
    <section aria-label="Invitations" className="mb-5 space-y-2 border border-field bg-paper-100 p-3">
      {pending.map((invitation) => (
        <div key={invitation.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13.5px] text-ink-900">
            {invitation.invitedByEmail || 'Someone'} invited you to join <strong>{invitation.organizationName}</strong> as {ROLE_LABEL[invitation.role]}.
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={respond.isPending}
              onClick={() => respond.mutate({ id: invitation.id, accept: false })}
            >
              Decline
            </button>
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={respond.isPending}
              onClick={() => respond.mutate({ id: invitation.id, accept: true })}
            >
              Accept and open
            </button>
          </div>
        </div>
      ))}
      {error && <p role="alert" className="text-[13px] text-ledger-red">{error}</p>}
    </section>
  );
}
