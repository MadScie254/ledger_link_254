import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { SkeletonRows, EmptyNote, LoadProblem, buttonClass } from '../ledger/Page';

interface Budget {
  id: string;
  accountId: string;
  categoryName: string;
  accountCode?: string;
  period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  limitCents: number;
  spentCents: number;
}

const PERIOD_NAME: Record<Budget['period'], string> = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', YEARLY: 'Yearly' };

export function BudgetPlanner() {
  const { currentOrgId, activeCompany } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [editLimit, setEditLimit] = useState('');
  const [newBudget, setNewBudget] = useState({ categoryId: '', amount: '', period: 'MONTHLY' as Budget['period'] });
  const [formError, setFormError] = useState('');
  const [rowError, setRowError] = useState('');

  const budgetsQuery = useQuery({
    queryKey: ['budgets', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/budgets', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch budgets');
      return res.json();
    },
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    },
  });

  const budgets: Budget[] = budgetsQuery.data?.budgets || [];
  const expenses = accountsData?.accounts?.filter((a: any) => a.type === 'EXPENSE') || [];
  const totalLimit = budgets.reduce((s, b) => s + b.limitCents, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spentCents, 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ accountId: newBudget.categoryId, period: newBudget.period, limitCents: Math.round(parseFloat(newBudget.amount || '0') * 100) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'The budget could not be saved.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets', currentOrgId] });
      closeAdd();
    },
    onError: (err: any) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, limitCents }: { id: string; limitCents: number }) => {
      const res = await fetch(`/api/budgets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ limitCents }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'The limit could not be changed.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets', currentOrgId] });
      setEditingBudget(null);
      setFormError('');
    },
    onError: (err: any) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/budgets/${id}`, { method: 'DELETE', headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('The budget could not be removed.');
      return res.json();
    },
    onSuccess: () => {
      setRowError('');
      queryClient.invalidateQueries({ queryKey: ['budgets', currentOrgId] });
    },
    onError: (err: any) => setRowError(err.message),
  });

  function closeAdd() {
    setIsAdding(false);
    setNewBudget({ categoryId: '', amount: '', period: 'MONTHLY' });
    setFormError('');
  }

  const handleAddBudget = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    createMutation.mutate();
  };

  const rowActions = (b: Budget) => (
    <span className="inline-flex gap-3">
      <button
        type="button"
        onClick={() => {
          setFormError('');
          setEditingBudget(b);
          setEditLimit((b.limitCents / 100).toString());
        }}
        className={buttonClass.quiet}
      >
        Change limit
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Remove the budget for ${b.categoryName}? Postings to the account are not affected.`)) deleteMutation.mutate(b.id);
        }}
        className={`${buttonClass.quiet} text-ledger-red`}
      >
        Remove
      </button>
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-2xl text-[13.5px] text-graphite-600">
          A spending limit for each expense account. Spent is the account’s balance from all postings to date, not only the current period.
        </p>
        <button type="button" onClick={() => setIsAdding(true)} className={`${buttonClass.secondary} shrink-0`}>
          Set a budget
        </button>
      </div>

      {rowError && (
        <p role="alert" className="text-[13.5px] text-ledger-red">
          {rowError}
        </p>
      )}

      {budgetsQuery.isError ? (
        <LoadProblem what="budgets" path="/api/budgets" onRetry={() => budgetsQuery.refetch()} />
      ) : budgetsQuery.isLoading ? (
        <SkeletonRows label="Loading budgets" rows={4} />
      ) : budgets.length === 0 ? (
        <EmptyNote>No budgets yet. Each expense account with a limit is listed here with what has been spent and what remains.</EmptyNote>
      ) : (
        <>
          <ul className="sm:hidden" aria-label={`Budgets, figures in ${baseCurrency}`}>
            {budgets.map((b) => {
              const remaining = b.limitCents - b.spentCents;
              return (
                <li key={b.id} className="border-b border-feint py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[14.5px] text-ink-900">{b.categoryName}</span>
                    <Amount cents={remaining} currency={baseCurrency} size="sm" tone="result" />
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-3 text-[12.5px] text-graphite-600">
                    <span>
                      {PERIOD_NAME[b.period]} limit <Amount cents={b.limitCents} currency={baseCurrency} size="xs" tone="ink" />
                    </span>
                    <span>{remaining < 0 ? 'over' : 'remaining'}</span>
                  </div>
                  <div className="mt-2">{rowActions(b)}</div>
                </li>
              );
            })}
          </ul>
          <div className="hidden sm:block relative overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <caption className="sr-only">Budgets, figures in {baseCurrency}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-16 pr-4 text-left">Code</th>
                  <th scope="col" className="pr-4 text-left">Account</th>
                  <th scope="col" className="pr-4 text-left">Period</th>
                  <th scope="col" className="pr-4 text-right">Limit</th>
                  <th scope="col" className="pr-4 text-right">Spent</th>
                  <th scope="col" className="pr-4 text-right">Remaining</th>
                  <th scope="col" className="text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => {
                  const remaining = b.limitCents - b.spentCents;
                  return (
                    <tr key={b.id}>
                      <td className="w-16 pr-4 ll-figure font-semibold text-ink-900">{b.accountCode || '–'}</td>
                      <td className="pr-4 text-ink-900">
                        {b.categoryName}
                      </td>
                      <td className="pr-4 text-graphite-600">{PERIOD_NAME[b.period]}</td>
                      <td className="pr-4 text-right whitespace-nowrap"><Amount cents={b.limitCents} currency={baseCurrency} tone="ink" /></td>
                      <td className="pr-4 text-right whitespace-nowrap"><Amount cents={b.spentCents} currency={baseCurrency} tone="ink" /></td>
                      <td className="pr-4 text-right whitespace-nowrap"><Amount cents={remaining} currency={baseCurrency} tone="result" /></td>
                      <td className="text-right whitespace-nowrap">{rowActions(b)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">All budgets</th>
                  <td className="ll-total py-2 pr-4 text-right whitespace-nowrap font-semibold"><Amount cents={totalLimit} currency={baseCurrency} tone="ink" /></td>
                  <td className="ll-total py-2 pr-4 text-right whitespace-nowrap font-semibold"><Amount cents={totalSpent} currency={baseCurrency} tone="ink" /></td>
                  <td className="ll-total py-2 pr-4 text-right whitespace-nowrap font-semibold"><Amount cents={totalLimit - totalSpent} currency={baseCurrency} tone="result" /></td>
                  <td className="ll-total py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <Dialog
        open={isAdding}
        onClose={closeAdd}
        title="Set a budget"
        footer={
          <>
            <button type="button" onClick={closeAdd} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" form="budget-form" disabled={createMutation.isPending} className={buttonClass.primary}>
              {createMutation.isPending ? 'Saving' : 'Save budget'}
            </button>
          </>
        }
      >
        <form id="budget-form" onSubmit={handleAddBudget} className="space-y-4">
          <Field label="Expense account">
            <select required value={newBudget.categoryId} onChange={(e) => setNewBudget({ ...newBudget, categoryId: e.target.value })}>
              <option value="">Choose an account</option>
              {expenses.map((acc: any) => (
                <option key={acc.id} value={acc.id}>{acc.code} · {acc.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Period">
            <select value={newBudget.period} onChange={(e) => setNewBudget({ ...newBudget, period: e.target.value as Budget['period'] })}>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </Field>
          <Field label={`Limit (${baseCurrency})`} error={formError || undefined}>
            <input type="number" required min="0" step="0.01" inputMode="decimal" value={newBudget.amount} onChange={(e) => setNewBudget({ ...newBudget, amount: e.target.value })} className="tabular-currency" />
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={!!editingBudget}
        onClose={() => setEditingBudget(null)}
        title="Change the limit"
        note={editingBudget ? `${editingBudget.categoryName}, ${PERIOD_NAME[editingBudget.period].toLowerCase()}` : undefined}
        width="sm"
        footer={
          <>
            <button type="button" onClick={() => setEditingBudget(null)} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" form="budget-limit-form" disabled={updateMutation.isPending} className={buttonClass.primary}>
              {updateMutation.isPending ? 'Saving' : 'Save limit'}
            </button>
          </>
        }
      >
        <form
          id="budget-limit-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (editingBudget) updateMutation.mutate({ id: editingBudget.id, limitCents: Math.round(parseFloat(editLimit || '0') * 100) });
          }}
        >
          <Field label={`New limit (${baseCurrency})`} error={formError || undefined}>
            <input type="number" required min="0" step="0.01" inputMode="decimal" value={editLimit} onChange={(e) => setEditLimit(e.target.value)} className="tabular-currency" />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
