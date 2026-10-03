import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';
import { apiRequest } from '../../utils/apiRequest';

export interface EditableAccount {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype?: string | null;
  description?: string | null;
  isActive: boolean;
  isBankAccount: boolean;
  isSystem: boolean;
}

/** Receivables and recoverable VAT can never take or pay out money. */
const NEVER_MONEY_CODES = new Set(['1100', '1150']);

/**
 * Renames an account, notes what it is for, marks it as holding money, or
 * switches it off. The code and type are fixed: its history is posted under
 * them. An account that is switched off keeps its history and balance, and
 * stops appearing where new entries are chosen.
 */
export function AccountEditDialog({ account, orgId, onClose }: { account: EditableAccount | null; orgId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [subtype, setSubtype] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isBankAccount, setIsBankAccount] = useState(false);

  const save = useMutation({
    mutationFn: () => apiRequest(`/api/accounts/${account!.id}`, {
      method: 'PATCH',
      body: {
        name: name.trim(),
        subtype: subtype.trim() || null,
        description: description.trim() || null,
        isActive,
        isBankAccount,
      },
      fallback: 'The account could not be saved.',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts', orgId] });
      onClose();
    },
  });

  useEffect(() => {
    if (!account) return;
    save.reset();
    setName(account.name);
    setSubtype(account.subtype || '');
    setDescription(account.description || '');
    setIsActive(account.isActive);
    setIsBankAccount(account.isBankAccount);
  }, [account]);

  const canHoldMoney = account?.type === 'ASSET' && !NEVER_MONEY_CODES.has(account.code);

  return (
    <Dialog
      open={!!account}
      onClose={onClose}
      title={account ? `Account ${account.code}` : 'Account'}
      note="The code and type stay as they are: this account's history is posted under them."
      footer={
        <>
          {save.isError && (
            <p role="alert" className="mr-auto text-[13px] text-ledger-red">{save.error.message}</p>
          )}
          <button type="button" onClick={onClose} className={buttonClass.secondary}>Cancel</button>
          <button type="submit" form="account-edit-form" disabled={save.isPending || !name.trim()} className={buttonClass.primary}>
            {save.isPending ? 'Saving' : 'Save account'}
          </button>
        </>
      }
    >
      <form
        id="account-edit-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Account name">
          <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Subtype" hint="Optional grouping, such as Current asset or Utilities">
          <input maxLength={60} value={subtype} onChange={(e) => setSubtype(e.target.value)} />
        </Field>
        <Field label="What it is for">
          <textarea rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} className="resize-none" />
        </Field>
        {canHoldMoney && (
          <label className="flex items-start gap-2 text-[13.5px] text-ink-900">
            <input type="checkbox" checked={isBankAccount} onChange={(e) => setIsBankAccount(e.target.checked)} className="mt-0.5" />
            <span>
              A bank, cash or M-Pesa account
              <span className="block text-[12.5px] text-graphite-600">Payments are received into and paid out of these accounts only.</span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-2 text-[13.5px] text-ink-900">
          <input
            type="checkbox"
            checked={isActive}
            disabled={account?.isSystem}
            onChange={(e) => setIsActive(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Active
            <span className="block text-[12.5px] text-graphite-600">
              {account?.isSystem
                ? 'Invoices, bills, payments or payroll post to this account, so it stays active.'
                : 'An inactive account keeps its history and balance, and is no longer offered for new entries.'}
            </span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}
