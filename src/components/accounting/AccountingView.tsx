import React from 'react';
import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';
import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { format } from 'date-fns';
import { BudgetPlanner } from './BudgetPlanner';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';

const tabs = ['Chart of Accounts', 'Journal Entries', 'Budgets', 'Settings'];

export function AccountingView() {
  const [activeTab, setActiveTab] = useState('Chart of Accounts');
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any | null>(null);
  
  // CoA state
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // JE State
  const [isAddingJE, setIsAddingJE] = useState(false);
  const [jeLines, setJeLines] = useState([{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }]);
  const [jeMemo, setJeMemo] = useState('');
  const [jeDate, setJeDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const queryClient = useQueryClient();
  const { currentOrgId } = useAppStore();

  const { data: accountsData, isLoading: isLoadingAccounts } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    }
  });

  const { data: journalsData, isLoading: isLoadingJournals } = useQuery({
    queryKey: ['journal-entries', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/journal-entries', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch journals');
      return res.json();
    }
  });

  const handleSeed = async () => {
    await fetch('/api/accounts/seed', {
      method: 'POST',
      headers: { 'x-org-id': currentOrgId }
    });
    queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
  };

  const handleExportCSV = () => {
    if (!accountsData?.accounts) return;
    const csv = Papa.unparse(accountsData.accounts.map((acc: any) => ({
      Code: acc.code,
      Name: acc.name,
      Type: acc.type,
      Description: acc.description || ''
    })));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'chart_of_accounts.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const formattedAccounts = results.data.map((row: any) => ({
            code: row.Code || row.code,
            name: row.Name || row.name,
            type: row.Type || row.type || 'EXPENSE',
            description: row.Description || row.description || ''
          })).filter(a => a.code && a.name);

          const res = await fetch('/api/accounts/bulk', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-org-id': currentOrgId
            },
            body: JSON.stringify({ accounts: formattedAccounts })
          });
          
          if (!res.ok) throw new Error('Failed to import accounts');
          const data = await res.json();
          alert(`Import complete: ${data.success} successful, ${data.failed} failed/skipped.`);
          queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
          
          if (data.accountIds && data.accountIds.length > 0) {
            useAppStore.getState().pushUndoAction({
              id: Math.random().toString(),
              message: `Imported ${data.success} accounts`,
              revertEndpoint: '/api/accounts/undo-bulk',
              data: { accountIds: data.accountIds }
            });
          }
        } catch (err) {
          alert('Error importing accounts.');
          console.error(err);
        } finally {
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    });
  };

  const addJeMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId, 'x-user-id': 'demo-user-id' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to post journal entry');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentOrgId] });
      setIsAddingJE(false);
      setJeLines([{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }]);
      setJeMemo('');
    }
  });

  const accounts = accountsData?.accounts || [];
  const entries = journalsData?.entries || [];

  const filteredAccounts = accounts.filter((acc: any) => {
    const matchesSearch = acc.name.toLowerCase().includes(searchQuery.toLowerCase()) || acc.code.includes(searchQuery);
    const matchesType = typeFilter ? acc.type === typeFilter : true;
    return matchesSearch && matchesType;
  });

  const handlePostJE = (e: React.FormEvent) => {
    e.preventDefault();
    const formattedLines = jeLines.map(line => ({
      accountId: line.accountId,
      debit: Math.round(line.debit * 100),
      credit: Math.round(line.credit * 100)
    })).filter(l => l.debit > 0 || l.credit > 0);
    
    addJeMutation.mutate({
      entryDate: jeDate,
      memo: jeMemo,
      sourceType: 'MANUAL',
      lines: formattedLines
    });
  };

  const totalDebit = jeLines.reduce((acc, l) => acc + (l.debit || 0), 0);
  const totalCredit = jeLines.reduce((acc, l) => acc + (l.credit || 0), 0);
  const isBalanced = totalDebit > 0 && totalDebit === totalCredit;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Accounting Core</h1>
        {activeTab === 'Chart of Accounts' && (
          <button 
            onClick={() => setIsAddingAccount(true)}
            className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
          >
            Add Account
          </button>
        )}
        {activeTab === 'Journal Entries' && (
          <button 
            onClick={() => setIsAddingJE(true)}
            className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
          >
            Post Journal Entry
          </button>
        )}
      </div>
      <div className="ledger-divider mb-6"></div>

      <div className="flex space-x-6 border-b border-ink-900/10 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === tab 
                ? 'border-brass-500 text-ink-900' 
                : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-ink-900/20'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Chart of Accounts' && (
        <div className="space-y-4">
          <div className="flex space-x-4 mb-4">
            <input 
              type="text" 
              placeholder="Search by code or name..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-3 py-2 border border-ink-900/20 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-focus-blue-500 w-64"
            />
            <select 
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 border border-ink-900/20 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-focus-blue-500 bg-white dark:bg-[#111827]"
            >
              <option value="">All Types</option>
              <option value="ASSET">Asset</option>
              <option value="LIABILITY">Liability</option>
              <option value="EQUITY">Equity</option>
              <option value="INCOME">Income</option>
              <option value="EXPENSE">Expense</option>
            </select>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
            {isLoadingAccounts ? (
              <div className="p-16 text-center text-slate-500">Loading accounts...</div>
            ) : accounts.length === 0 ? (
              <div className="p-16 text-center text-slate-500">
                <p className="mb-4">No accounts found in the ledger.</p>
                <button 
                  onClick={handleSeed}
                  className="text-brass-500 font-medium hover:underline cursor-pointer"
                >
                  Import standard chart of accounts
                </button>
              </div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Code</th>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-900/5">
                  {filteredAccounts.map((acc: any) => (
                    <tr 
                      key={acc.id} 
                      onClick={() => setSelectedAccount(acc)}
                      className="hover:bg-paper-50 dark:hover:bg-ink-900/40 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-2 tabular-currency font-medium text-ink-900 font-mono">{acc.code}</td>
                      <td className="px-4 py-2 text-ink-900">{acc.name}</td>
                      <td className="px-4 py-2 text-slate-500">{acc.type}</td>
                      <td className="px-4 py-2 tabular-currency text-right text-ink-900">0.00</td>
                    </tr>
                  ))}
                  {filteredAccounts.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No accounts match your filters.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Journal Entries' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="px-4 py-3 font-semibold">Memo</th>
                  <th className="px-4 py-3 font-semibold text-right">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-900/5">
                {isLoadingJournals ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Loading journals...</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No journal entries found.</td></tr>
                ) : (
                  <AnimatePresence>
                    {entries.map((je: any) => (
                      <motion.tr 
                        key={je.id}
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className="hover:bg-paper-50 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3 text-ink-900">{je.entryDate}</td>
                        <td className="px-4 py-3">
                          <span className="bg-ink-900/5 text-ink-900 px-2 py-0.5 rounded text-xs">{je.sourceType}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{je.memo || '-'}</td>
                        <td className="px-4 py-3 text-right text-slate-500">{je.createdBy}</td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'Budgets' && <BudgetPlanner />}

      {activeTab === 'Settings' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-6">
            <h3 className="text-lg font-medium text-ink-900 mb-4">Data Management</h3>
            <p className="text-sm text-slate-600 mb-6">Import or export your chart of accounts using CSV formatting.</p>
            
            <div className="flex space-x-4">
              <button 
                onClick={handleExportCSV}
                className="bg-paper-100 border border-ink-900/20 text-ink-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors"
              >
                Export CSV
              </button>
              
              <div className="relative">
                <input 
                  type="file" 
                  accept=".csv"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  ref={fileInputRef}
                  onChange={handleImportCSV}
                />
                <button className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">
                  Import CSV
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual JE Modal */}
      {isAddingJE && (
        <div className="fixed inset-0 bg-ink-900/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111827] rounded-sm shadow-xl border border-ink-900/10 w-full max-w-3xl p-6">
            <h3 className="text-xl font-serif text-ink-900 mb-4">Post Manual Journal Entry</h3>
            
            <form onSubmit={handlePostJE} className="space-y-6">
              <div className="flex space-x-4">
                <div className="w-1/3">
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Date</label>
                  <input required type="date" value={jeDate} onChange={e => setJeDate(e.target.value)} className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 outline-none" />
                </div>
                <div className="w-2/3">
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Memo</label>
                  <input required type="text" value={jeMemo} onChange={e => setJeMemo(e.target.value)} placeholder="Reason for manual entry..." className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 outline-none" />
                </div>
              </div>

              <div>
                <table className="w-full text-sm">
                  <thead className="border-b border-ink-900/10">
                    <tr>
                      <th className="text-left font-semibold text-slate-500 pb-2">Account</th>
                      <th className="text-right font-semibold text-slate-500 pb-2 w-32">Debit (KES)</th>
                      <th className="text-right font-semibold text-slate-500 pb-2 w-32">Credit (KES)</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jeLines.map((line, index) => (
                      <tr key={index} className="border-b border-ink-900/5">
                        <td className="py-2 pr-2">
                          <select 
                            required
                            value={line.accountId}
                            onChange={(e) => {
                              const newLines = [...jeLines];
                              newLines[index].accountId = e.target.value;
                              setJeLines(newLines);
                            }}
                            className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 outline-none"
                          >
                            <option value="">Select Account</option>
                            {accounts.map((acc: any) => (
                              <option key={acc.id} value={acc.id}>{acc.code} - {acc.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-2">
                          <input type="number" min="0" step="0.01" value={line.debit || ''} onChange={e => {
                              const newLines = [...jeLines];
                              newLines[index].debit = parseFloat(e.target.value) || 0;
                              if (newLines[index].debit > 0) newLines[index].credit = 0;
                              setJeLines(newLines);
                          }} className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 outline-none text-right tabular-currency" placeholder="0.00" />
                        </td>
                        <td className="py-2 pr-2">
                          <input type="number" min="0" step="0.01" value={line.credit || ''} onChange={e => {
                              const newLines = [...jeLines];
                              newLines[index].credit = parseFloat(e.target.value) || 0;
                              if (newLines[index].credit > 0) newLines[index].debit = 0;
                              setJeLines(newLines);
                          }} className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 outline-none text-right tabular-currency" placeholder="0.00" />
                        </td>
                        <td className="py-2 text-right">
                           <button type="button" onClick={() => {
                             if(jeLines.length > 2) {
                               const newLines = [...jeLines];
                               newLines.splice(index, 1);
                               setJeLines(newLines);
                             }
                           }} className="text-slate-400 hover:text-rust-700 font-bold">&times;</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="py-3">
                        <button type="button" onClick={() => setJeLines([...jeLines, { accountId: '', debit: 0, credit: 0 }])} className="text-sm font-medium text-focus-blue-500 hover:underline">
                          + Add Line
                        </button>
                      </td>
                      <td className="py-3 pr-2 text-right font-medium tabular-currency text-ink-900">{formatCurrencyFromFloat(totalDebit)}</td>
                      <td className="py-3 pr-2 text-right font-medium tabular-currency text-ink-900">{formatCurrencyFromFloat(totalCredit)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {addJeMutation.isError && (
                <div className="p-3 bg-rust-700/10 border border-rust-700/20 text-rust-700 text-sm rounded-sm">
                  {addJeMutation.error.message}
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-6 border-t border-ink-900/10">
                <button type="button" onClick={() => setIsAddingJE(false)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-ink-900">Cancel</button>
                <button type="submit" disabled={!isBalanced || addJeMutation.isPending} className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {addJeMutation.isPending ? 'Posting...' : 'Post Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Dynamic Contextual Add Account Modal */}
      <DynamicQuickAddModal
        isOpen={isAddingAccount}
        onClose={() => setIsAddingAccount(false)}
        overrideType="ACCOUNT"
      />

      {/* Comprehensive Account Drill-Down Overlay */}
      <EntityDrillDownModal
        isOpen={!!selectedAccount}
        onClose={() => setSelectedAccount(null)}
        entityType="ACCOUNT"
        entityId={selectedAccount?.id || null}
        initialData={selectedAccount}
      />
    </div>
  );
}
