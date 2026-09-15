import React from 'react';
import { formatCurrency } from '../../utils/currency';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { Plus, Edit2, Trash2, PieChart, X } from 'lucide-react';

interface Budget {
  id: string;
  accountId: string;
  categoryName: string;
  accountCode?: string;
  period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  limitCents: number;
  spentCents: number;
}

export function BudgetPlanner() {
  const { currentOrgId } = useAppStore();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [editLimit, setEditLimit] = useState('');
  const [newBudget, setNewBudget] = useState({ categoryId: '', amount: '', period: 'MONTHLY' as Budget['period'] });
  const [formError, setFormError] = useState('');

  const { data: budgetsData, isLoading: budgetsLoading } = useQuery({
    queryKey: ['budgets', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/budgets', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch budgets');
      return res.json();
    }
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', { headers: { 'x-org-id': currentOrgId } });
      return res.json();
    }
  });

  const budgets: Budget[] = budgetsData?.budgets || [];
  const expenses = accountsData?.accounts?.filter((a: any) => a.type === 'EXPENSE') || [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({
          accountId: newBudget.categoryId,
          period: newBudget.period,
          limitCents: Math.round(parseFloat(newBudget.amount || '0') * 100)
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create budget');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets', currentOrgId] });
      setIsAdding(false);
      setNewBudget({ categoryId: '', amount: '', period: 'MONTHLY' });
      setFormError('');
    },
    onError: (err: any) => setFormError(err.message)
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, limitCents }: { id: string; limitCents: number }) => {
      const res = await fetch(`/api/budgets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ limitCents })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update budget');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets', currentOrgId] });
      setEditingBudget(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/budgets/${id}`, { method: 'DELETE', headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to delete budget');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budgets', currentOrgId] })
  });

  const handleAddBudget = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    createMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-4">
        <div className="flex items-center space-x-3">
          <div className="bg-focus-blue-500/10 p-2 rounded-full">
            <PieChart className="h-6 w-6 text-focus-blue-500" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-ink-900">Monthly Budget Planner</h3>
            <p className="text-sm text-slate-500">Track and manage your spending limits by category.</p>
          </div>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="bg-sidebar-bg text-sidebar-ink px-4 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors flex items-center"
        >
          <Plus className="h-4 w-4 mr-2" /> New Budget
        </button>
      </div>

      {budgetsLoading ? (
        <div className="p-16 text-center text-slate-500 bg-paper-100 border border-ink-900/10 rounded-sm">Loading budgets...</div>
      ) : budgets.length === 0 ? (
        <div className="p-16 text-center text-slate-500 bg-paper-100 border border-ink-900/10 rounded-sm">
          No budgets set yet. Create one to start tracking spending against a limit.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {budgets.map(budget => {
            const percent = budget.limitCents > 0 ? Math.min((budget.spentCents / budget.limitCents) * 100, 100) : 0;
            const isOver = budget.spentCents > budget.limitCents;

            return (
              <div key={budget.id} className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-5 flex flex-col relative overflow-hidden">
                <div className="flex justify-between items-start mb-4">
                  <h4 className="font-medium text-ink-900">{budget.categoryName}</h4>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => {
                        setEditingBudget(budget);
                        setEditLimit((budget.limitCents / 100).toString());
                      }}
                      className="text-slate-400 hover:text-ink-900"
                      title="Edit limit"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete the budget for ${budget.categoryName}?`)) {
                          deleteMutation.mutate(budget.id);
                        }
                      }}
                      className="text-slate-400 hover:text-rust-700"
                      title="Delete budget"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-auto">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-600">Spent: <span className="font-medium text-ink-900">{formatCurrency(budget.spentCents)}</span></span>
                    <span className="text-slate-600">Limit: <span className="font-medium text-ink-900">{formatCurrency(budget.limitCents)}</span></span>
                  </div>

                  <div className="h-2 w-full bg-paper-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${isOver ? 'bg-rust-700' : percent > 80 ? 'bg-brass-500' : 'bg-focus-blue-500'}`}
                      style={{ width: `${percent}%` }}
                    ></div>
                  </div>

                  <div className="mt-2 text-xs text-right">
                    {isOver ? (
                      <span className="text-rust-700 font-medium">{formatCurrency(budget.spentCents - budget.limitCents)} over budget</span>
                    ) : (
                      <span className="text-slate-500">{formatCurrency(budget.limitCents - budget.spentCents)} remaining</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isAdding && (
        <div className="fixed inset-0 bg-ink-900/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-paper-100 rounded-sm shadow-xl border border-ink-900/10 w-full max-w-md p-6">
            <h3 className="text-xl font-serif text-ink-900 mb-4">Create New Budget</h3>

            {formError && (
              <div className="mb-4 p-2.5 bg-rust-700/10 border border-rust-700/20 text-rust-700 text-xs rounded-sm">
                {formError}
              </div>
            )}

            <form onSubmit={handleAddBudget} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-900 mb-1">Expense Category</label>
                <select
                  required
                  value={newBudget.categoryId}
                  onChange={(e) => setNewBudget({ ...newBudget, categoryId: e.target.value })}
                  className="w-full border border-ink-900/20 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink-900 bg-paper-100"
                >
                  <option value="">Select an expense account...</option>
                  {expenses.map((acc: any) => (
                    <option key={acc.id} value={acc.id}>{acc.code} - {acc.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-900 mb-1">Period</label>
                <select
                  value={newBudget.period}
                  onChange={(e) => setNewBudget({ ...newBudget, period: e.target.value as Budget['period'] })}
                  className="w-full border border-ink-900/20 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink-900 bg-paper-100"
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-900 mb-1">Spending Limit (KES)</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={newBudget.amount}
                  onChange={(e) => setNewBudget({ ...newBudget, amount: e.target.value })}
                  className="w-full border border-ink-900/20 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink-900 bg-paper-100"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-ink-900/10">
                <button
                  type="button"
                  onClick={() => { setIsAdding(false); setFormError(''); }}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-ink-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="bg-sidebar-bg text-sidebar-ink px-4 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Saving...' : 'Save Budget'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingBudget && (
        <div className="fixed inset-0 bg-ink-900/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-paper-100 rounded-sm shadow-xl border border-ink-900/10 w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-serif text-ink-900">Edit Budget Limit</h3>
              <button onClick={() => setEditingBudget(null)} className="text-slate-400 hover:text-ink-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateMutation.mutate({ id: editingBudget.id, limitCents: Math.round(parseFloat(editLimit || '0') * 100) });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-ink-900 mb-1">{editingBudget.categoryName} — New Limit (KES)</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={editLimit}
                  onChange={(e) => setEditLimit(e.target.value)}
                  className="w-full border border-ink-900/20 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink-900 bg-paper-100"
                  autoFocus
                />
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={() => setEditingBudget(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-ink-900">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="bg-sidebar-bg text-sidebar-ink px-4 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors disabled:opacity-50"
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
