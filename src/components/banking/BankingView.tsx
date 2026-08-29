import { formatCurrency } from '../../utils/currency';
import { useState } from 'react';
import { useRenderTracker } from '../../utils/monitoring';
import { format } from 'date-fns';
import { Filter, Search, Download, Sparkles, CheckCircle2, ArrowRight, CheckCheck, RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';

const tabs = ['Bank transactions', 'AI Match Assistant', 'Rules', 'Reconcile', 'Bank connections'];

export function BankingView() {
  useRenderTracker("BankingView");
  const [activeTab, setActiveTab] = useState('Bank transactions');
  const [filterSearch, setFilterSearch] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterDirection, setFilterDirection] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [matchingTx, setMatchingTx] = useState<any>(null); // Transaction being matched
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const { currentOrgId } = useAppStore();
  const queryClient = useQueryClient();

  // Fetch Accounts (to map AI suggestions to real account IDs)
  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', {
        headers: { 'x-org-id': currentOrgId },
      });
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    }
  });

  // Fetch Transactions
  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['bank_transactions', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/banking/transactions', {
        headers: { 'x-org-id': currentOrgId },
      });
      if (!res.ok) throw new Error('Failed to fetch transactions');
      return res.json();
    }
  });

  // Fetch AI Match Suggestions
  const { data: aiMatchesData, isLoading: aiMatchesLoading, refetch: refetchAIMatches } = useQuery({
    queryKey: ['banking_ai_matches', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/banking/ai-matches', {
        headers: { 'x-org-id': currentOrgId },
      });
      if (!res.ok) throw new Error('Failed to fetch AI matches');
      return res.json();
    }
  });

  const rawTx = txData?.transactions || [];
  const aiMatches = aiMatchesData?.matches || [];
  const aiMatchesMap = new Map<string, any>(aiMatches.map((m: any) => [m.transactionId, m]));

  const filteredTx = rawTx.filter((tx: any) => {
    let matches = true;
    if (filterSearch && !tx.description.toLowerCase().includes(filterSearch.toLowerCase())) matches = false;
    if (filterDate && tx.date.substring(0, 10) !== filterDate) matches = false;
    if (filterDirection !== 'ALL' && tx.direction !== filterDirection) matches = false;
    if (filterStatus !== 'ALL' && tx.status !== filterStatus) matches = false;
    return matches;
  });

  // Fetch Journal Entries (for matching)
  const { data: journalsData } = useQuery({
    queryKey: ['journal-entries', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/journal-entries', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch journals');
      return res.json();
    }
  });

  // Sync Mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/banking/sync', {
        method: 'POST',
        headers: { 'x-org-id': currentOrgId },
      });
      if (!res.ok) throw new Error('Failed to sync bank transactions');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank_transactions', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['banking_ai_matches', currentOrgId] });
    },
  });

  // Match Mutation (Create New or Link Existing)
  const matchMutation = useMutation({
    mutationFn: async (payload: { transactionId: string, targetAccountId?: string, existingJournalEntryId?: string }) => {
      const res = await fetch('/api/banking/match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': currentOrgId
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to match transaction');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank_transactions', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['banking_ai_matches', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
      setMatchingTx(null);
      setSelectedCandidate(null);
    },
  });

  // Auto-Reconcile All Mutation
  const autoReconcileMutation = useMutation({
    mutationFn: async (minConfidence: number = 85) => {
      const res = await fetch('/api/banking/auto-reconcile-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': currentOrgId
        },
        body: JSON.stringify({ minConfidence })
      });
      if (!res.ok) throw new Error('Failed to run auto-reconcile');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank_transactions', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['banking_ai_matches', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
    }
  });

  const handleMatchNew = (tx: any) => {
    const targetAccount = accountsData?.accounts?.find((a: any) => a.code === tx.aiCategoryCode);
    if (!targetAccount) {
      alert(`Account code ${tx.aiCategoryCode} not found in Chart of Accounts.`);
      return;
    }
    matchMutation.mutate({ transactionId: tx.id, targetAccountId: targetAccount.id });
  };

  const handleAcceptAIMatch = (match: any) => {
    const targetAccount = accountsData?.accounts?.find((a: any) => a.code === match.suggestedAccountCode) || accountsData?.accounts?.[0];
    matchMutation.mutate({
      transactionId: match.transactionId,
      targetAccountId: targetAccount?.id
    });
  };

  const handleExportCSV = () => {
    if (!rawTx.length) return;
    const headers = ['Date', 'Description', 'Direction', 'Amount', 'Status'];
    const rows = rawTx.map((tx: any) => [
      format(new Date(tx.date), 'yyyy-MM-dd'),
      `"${tx.description.replace(/"/g, '""')}"`,
      tx.direction,
      (tx.amountCents / 100).toFixed(2),
      tx.status
    ]);
    const csvContent = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transactions.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const highConfidenceCount = aiMatches.filter((m: any) => m.confidence >= 85).length;
  const unreviewedCount = rawTx.filter((t: any) => t.status !== 'MATCHED').length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="mb-2 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-serif text-ink-900">Banking & Reconciliation</h1>
          <p className="text-sm text-slate-500">Automated bank feeds, M-Pesa statements, and AI matching assistant</p>
        </div>
        <div className="flex items-center space-x-3">
          <button 
            onClick={handleExportCSV}
            className="bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 px-3 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors flex items-center"
          >
            <Download className="h-4 w-4 mr-1.5" /> Export CSV
          </button>
          <button 
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors flex items-center disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            {syncMutation.isPending ? 'Syncing...' : 'Sync Feed'}
          </button>
        </div>
      </div>
      <div className="ledger-divider mb-4"></div>

      {/* AI Assistant Banner */}
      {unreviewedCount > 0 && (
        <div className="bg-gradient-to-r from-amber-500/10 via-focus-blue-500/10 to-ledger-green-700/10 border border-amber-500/30 rounded-sm p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded-sm bg-amber-500 text-white dark:text-slate-900 mt-0.5">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-ink-900 text-sm">AI Transaction Matching Assistant Active</h3>
                <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-900 dark:text-amber-300 font-bold rounded-full">
                  {highConfidenceCount} High Confidence Matches
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Analyzed open customer invoices, vendor bills, and payroll entries against live bank lines.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab('AI Match Assistant')}
              className="px-3 py-1.5 text-xs font-semibold text-focus-blue-500 border border-focus-blue-500/30 rounded-sm hover:bg-white dark:bg-[#111827] transition-colors"
            >
              Review Matches ({aiMatches.length})
            </button>
            <button
              onClick={() => autoReconcileMutation.mutate(85)}
              disabled={autoReconcileMutation.isPending || highConfidenceCount === 0}
              className="px-4 py-1.5 text-xs font-bold bg-ink-900 text-white dark:text-slate-900 rounded-sm hover:bg-ink-900/90 transition-colors flex items-center disabled:opacity-50"
            >
              <CheckCheck className="w-4 h-4 mr-1.5" />
              {autoReconcileMutation.isPending ? 'Reconciling...' : `Auto-Reconcile (${highConfidenceCount})`}
            </button>
          </div>
        </div>
      )}

      {/* Sub-navigation */}
      <div className="flex space-x-6 border-b border-ink-900/10 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap flex items-center ${
              activeTab === tab 
                ? 'border-brass-500 text-ink-900' 
                : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-ink-900/20'
            }`}
          >
            {tab === 'AI Match Assistant' && <Sparkles className="w-3.5 h-3.5 mr-1.5 text-amber-500" />}
            {tab}
            {tab === 'Bank transactions' && unreviewedCount > 0 && (
              <span className="ml-2 px-1.5 py-0.2 rounded-full text-[10px] bg-ink-900/10 text-slate-700 font-bold">
                {unreviewedCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'Bank transactions' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
          {/* Filters Bar */}
          <div className="p-4 border-b border-ink-900/10 bg-paper-50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-3 flex-1 min-w-[240px]">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter by description, reference, vendor..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-white dark:bg-[#111827] border border-ink-900/20 rounded-sm focus:outline-none focus:ring-1 focus:ring-focus-blue-500"
                />
              </div>
              <select
                value={filterDirection}
                onChange={(e) => setFilterDirection(e.target.value)}
                className="bg-white dark:bg-[#111827] border border-ink-900/20 text-xs rounded-sm px-2.5 py-2 text-ink-900 outline-none"
              >
                <option value="ALL">All Flows</option>
                <option value="IN">Money In (Credits)</option>
                <option value="OUT">Money Out (Debits)</option>
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-white dark:bg-[#111827] border border-ink-900/20 text-xs rounded-sm px-2.5 py-2 text-ink-900 outline-none"
              >
                <option value="ALL">All Statuses</option>
                <option value="UNMATCHED">Unmatched</option>
                <option value="MATCHED">Matched</option>
              </select>
            </div>
            <div className="text-xs text-slate-500 font-medium">
              Showing {filteredTx.length} of {rawTx.length} transactions
            </div>
          </div>

          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Description</th>
                <th className="px-4 py-3 font-semibold text-right">Spent (KES)</th>
                <th className="px-4 py-3 font-semibold text-right">Received (KES)</th>
                <th className="px-4 py-3 font-semibold">AI Match Suggestion</th>
                <th className="px-4 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {txLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading transactions...</td></tr>
              ) : filteredTx.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No transactions matching criteria.
                  </td>
                </tr>
              ) : (
                filteredTx.map((tx: any) => {
                  const match = aiMatchesMap.get(tx.id);
                  const isMatched = tx.status === 'MATCHED';

                  return (
                    <tr key={tx.id} className="hover:bg-paper-50 transition-colors group">
                      <td className="px-4 py-3 tabular-currency text-ink-900 whitespace-nowrap">
                        {format(new Date(tx.date), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-3 font-medium text-ink-900">
                        <div>{tx.description}</div>
                        {tx.bankReference && (
                          <div className="text-[11px] font-mono text-slate-400">Ref: {tx.bankReference}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-currency text-right text-rust-700 font-medium">
                        {tx.direction === 'OUT' ? formatCurrency(tx.amountCents) : '-'}
                      </td>
                      <td className="px-4 py-3 tabular-currency text-right text-ledger-green-700 font-medium">
                        {tx.direction === 'IN' ? formatCurrency(tx.amountCents) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        {isMatched ? (
                          <span className="inline-flex items-center text-xs text-ledger-green-700 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Reconciled
                          </span>
                        ) : match ? (
                          <div className="flex items-center space-x-2">
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                              match.confidence >= 90 
                                ? 'bg-ledger-green-700/15 text-ledger-green-800 dark:text-ledger-green-300'
                                : match.confidence >= 75
                                ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                                : 'bg-slate-200 text-slate-700'
                            }`}>
                              {match.confidence}% Match
                            </span>
                            <span className="text-xs text-slate-600 truncate max-w-[180px]">
                              {match.matchedEntityNumber || match.suggestedAccountName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">No rule match</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isMatched ? (
                          <span className="text-xs text-slate-400">Locked</span>
                        ) : match && match.confidence >= 80 ? (
                          <button
                            onClick={() => handleAcceptAIMatch(match)}
                            disabled={matchMutation.isPending}
                            className="bg-ledger-green-700 hover:bg-ledger-green-800 text-white dark:text-slate-900 px-3 py-1 text-xs font-semibold rounded-sm transition-colors shadow-sm"
                          >
                            Accept Match
                          </button>
                        ) : (
                          <button 
                            onClick={() => setMatchingTx(tx)}
                            className="text-xs font-bold text-focus-blue-500 hover:text-ink-900 border border-focus-blue-500/30 hover:border-ink-900/50 px-3 py-1 rounded-sm transition-colors"
                          >
                            Review
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Match Assistant Dedicated Tab */}
      {activeTab === 'AI Match Assistant' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#111827] border border-ink-900/10 rounded-sm p-6 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-bold text-ink-900 flex items-center">
                  <Sparkles className="w-5 h-5 mr-2 text-amber-500" />
                  AI Transaction Matching Queue
                </h3>
                <p className="text-sm text-slate-500">
                  Matches discovered across customer invoices, vendor bills, tax withholdings, and chart of accounts.
                </p>
              </div>
              <button
                onClick={() => autoReconcileMutation.mutate(85)}
                disabled={autoReconcileMutation.isPending || highConfidenceCount === 0}
                className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-semibold rounded-sm hover:bg-ink-900/90 transition-colors flex items-center disabled:opacity-50"
              >
                <CheckCheck className="w-4 h-4 mr-2" />
                Auto-Reconcile All High Confidence ({highConfidenceCount})
              </button>
            </div>

            {aiMatchesLoading ? (
              <div className="py-12 text-center text-slate-500">Scanning ledger and open documents...</div>
            ) : aiMatches.length === 0 ? (
              <div className="py-12 text-center text-slate-500">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-ledger-green-700" />
                All pending transactions have been reconciled or have no pending matches.
              </div>
            ) : (
              <div className="space-y-3">
                {aiMatches.map((candidate: any) => (
                  <div 
                    key={candidate.transactionId}
                    className="border border-ink-900/10 rounded-sm p-4 hover:border-amber-500/50 transition-colors bg-paper-50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center space-x-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          candidate.confidence >= 90 
                            ? 'bg-ledger-green-700 text-white dark:text-slate-900' 
                            : 'bg-amber-500 text-white dark:text-slate-900'
                        }`}>
                          {candidate.confidence}% Confidence
                        </span>
                        <span className="text-xs font-mono font-bold text-slate-600 bg-ink-900/5 px-2 py-0.5 rounded">
                          {candidate.matchedType}
                        </span>
                        {candidate.matchedEntityNumber && (
                          <span className="text-xs font-bold text-focus-blue-500">
                            {candidate.matchedEntityNumber}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-4 pt-1">
                        <div>
                          <p className="text-sm font-semibold text-ink-900">{candidate.description}</p>
                          <p className="text-xs text-slate-500">Bank Flow: {candidate.direction} • {candidate.date}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                        <div>
                          <p className="text-sm font-semibold text-ink-900">{candidate.suggestedAccountName}</p>
                          <p className="text-xs text-slate-500">Ledger Code: {candidate.suggestedAccountCode}</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 italic pt-1">
                        AI Reasoning: {candidate.matchReason}
                      </p>
                    </div>

                    <div className="flex items-center space-x-3 self-end md:self-center">
                      <div className="text-right">
                        <p className="text-base font-bold tabular-currency text-ink-900">
                          {formatCurrency(candidate.amountCents)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleAcceptAIMatch(candidate)}
                        disabled={matchMutation.isPending}
                        className="bg-ledger-green-700 hover:bg-ledger-green-800 text-white dark:text-slate-900 px-4 py-2 text-xs font-bold rounded-sm transition-colors"
                      >
                        Accept & Reconcile
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Rules' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto">
           <div className="flex justify-between items-center mb-6">
             <div>
               <h3 className="text-lg font-medium text-ink-900">Auto-Categorization Rules</h3>
               <p className="text-sm text-slate-500">Automatically map recurring bank lines to your ledger accounts.</p>
             </div>
             <button className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">
               Create Rule
             </button>
           </div>
           
           <div className="border border-ink-900/10 rounded-sm divide-y divide-ink-900/5">
             <div className="p-4 flex items-center justify-between hover:bg-paper-50 transition-colors cursor-pointer">
                <div>
                   <p className="font-semibold text-ink-900">Contains "Safaricom"</p>
                   <p className="text-sm text-slate-500">Apply to: <span className="font-medium">Telephone & Internet Expense</span></p>
                </div>
                <span className="text-xs text-ledger-green-700 bg-ledger-green-700/10 px-2 py-1 rounded">Active</span>
             </div>
             <div className="p-4 flex items-center justify-between hover:bg-paper-50 transition-colors cursor-pointer">
                <div>
                   <p className="font-semibold text-ink-900">Contains "KRA"</p>
                   <p className="text-sm text-slate-500">Apply to: <span className="font-medium">Tax Payable / KRA VAT</span></p>
                </div>
                <span className="text-xs text-ledger-green-700 bg-ledger-green-700/10 px-2 py-1 rounded">Active</span>
             </div>
             <div className="p-4 flex items-center justify-between hover:bg-paper-50 transition-colors cursor-pointer">
                <div>
                   <p className="font-semibold text-ink-900">Contains "AWS"</p>
                   <p className="text-sm text-slate-500">Apply to: <span className="font-medium">Software & Subscriptions</span></p>
                </div>
                <span className="text-xs text-ledger-green-700 bg-ledger-green-700/10 px-2 py-1 rounded">Active</span>
             </div>
           </div>
        </div>
      )}

      {activeTab === 'Reconcile' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
           <h3 className="text-xl font-medium text-ink-900 mb-2">Month-End Bank Reconciliation</h3>
           <p className="text-slate-500 mb-6">Verify statement balances against double-entry general ledger journals.</p>
           
           <div className="grid grid-cols-2 gap-6 mb-8">
             <div className="p-6 border border-ink-900/10 bg-paper-50 rounded-sm">
                <p className="text-sm text-slate-500 uppercase tracking-wider mb-2">Statement Balance (M-Pesa + Bank)</p>
                <p className="text-2xl font-serif text-ink-900 tabular-currency">KES 1,245,000.00</p>
             </div>
             <div className="p-6 border border-ink-900/10 bg-paper-50 rounded-sm">
                <p className="text-sm text-slate-500 uppercase tracking-wider mb-2">General Ledger Balance</p>
                <p className="text-2xl font-serif text-ink-900 tabular-currency">KES 1,245,000.00</p>
             </div>
           </div>
           
           <div className="inline-flex items-center space-x-2 text-ledger-green-700 bg-ledger-green-700/10 px-4 py-2 rounded-full mb-6">
              <span className="w-2 h-2 rounded-full bg-ledger-green-700"></span>
              <span className="font-medium">Balanced. Zero Variance.</span>
           </div>
           
           <div>
             <button 
              onClick={() => alert('Official Reconciliation Statement Generated')}
              className="bg-ink-900 text-white dark:text-slate-900 px-6 py-3 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors shadow-sm"
             >
               Publish Reconciliation Report
             </button>
           </div>
        </div>
      )}

      {activeTab === 'Bank connections' && (
        <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto">
           <h3 className="text-lg font-medium text-ink-900 mb-6">Linked Accounts & Gateways</h3>
           
           <div className="space-y-4">
             <div className="flex items-center justify-between p-4 border border-ink-900/10 rounded-sm bg-paper-50">
               <div className="flex items-center space-x-4">
                 <div className="w-10 h-10 rounded-full bg-ledger-green-700/20 flex items-center justify-center font-bold text-ledger-green-700 text-lg">E</div>
                 <div>
                   <p className="font-medium text-ink-900">Equity Bank - Current</p>
                   <p className="text-sm text-slate-500">Account ending in 4512 • Feed active</p>
                 </div>
               </div>
               <span className="text-xs text-ledger-green-700 bg-ledger-green-700/10 px-2 py-1 rounded font-semibold">Live Sync</span>
             </div>
             <div className="flex items-center justify-between p-4 border border-ink-900/10 rounded-sm bg-paper-50">
               <div className="flex items-center space-x-4">
                 <div className="w-10 h-10 rounded-full bg-brass-500/20 flex items-center justify-center font-bold text-brass-700 text-lg">M</div>
                 <div>
                   <p className="font-medium text-ink-900">M-Pesa Business Till</p>
                   <p className="text-sm text-slate-500">Till 555123 • Instant webhooks enabled</p>
                 </div>
               </div>
               <span className="text-xs text-ledger-green-700 bg-ledger-green-700/10 px-2 py-1 rounded font-semibold">Live Sync</span>
             </div>
             
             <button className="w-full mt-4 py-3 border-2 border-dashed border-ink-900/20 rounded-sm text-ink-900 font-medium hover:border-ink-900/50 transition-colors">
               + Connect New Financial Institution / Paybill
             </button>
           </div>
        </div>
      )}

      {/* Match Modal */}
      {matchingTx && (
        <div className="fixed inset-0 bg-ink-900/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111827] rounded-sm shadow-xl border border-ink-900/10 w-full max-w-2xl p-6">
            <h3 className="text-xl font-serif text-ink-900 mb-4">Reconcile Transaction</h3>
            
            <div className="p-4 border border-ink-900/10 bg-paper-50 rounded-sm mb-6 flex justify-between items-center">
              <div>
                <p className="font-medium text-ink-900">{matchingTx.description}</p>
                <p className="text-sm text-slate-500">{format(new Date(matchingTx.date), 'MMM d, yyyy')}</p>
              </div>
              <div className="text-right">
                <p className={`font-medium tabular-currency ${matchingTx.direction === 'IN' ? 'text-ledger-green-700' : 'text-rust-700'}`}>
                  {matchingTx.direction === 'IN' ? '+' : '-'} {formatCurrency(matchingTx.amountCents)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Option 1: Create New */}
              <div className="border border-ink-900/10 rounded-sm p-4">
                <h4 className="font-medium text-ink-900 mb-2">Categorize to Ledger</h4>
                <p className="text-sm text-slate-500 mb-4">AI suggests categorizing this as <strong>{matchingTx.aiCategoryName}</strong>.</p>
                <button 
                  onClick={() => handleMatchNew(matchingTx)}
                  disabled={matchMutation.isPending}
                  className="w-full bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
                >
                  Confirm & Post Entry
                </button>
              </div>
              
              {/* Option 2: Match Existing */}
              <div className="border border-ink-900/10 rounded-sm p-4 h-64 overflow-y-auto">
                <h4 className="font-medium text-ink-900 mb-2">Find Match in Journals</h4>
                {(!journalsData?.entries || journalsData.entries.length === 0) ? (
                  <p className="text-sm text-slate-500">No open journal entries found.</p>
                ) : (
                  <div className="space-y-2 mt-4">
                    {journalsData.entries.slice(0, 6).map((je: any) => (
                      <div 
                        key={je.id} 
                        className="p-3 border border-ink-900/10 rounded-sm bg-white dark:bg-[#111827] hover:border-focus-blue-500 cursor-pointer flex justify-between items-center"
                        onClick={() => matchMutation.mutate({ transactionId: matchingTx.id, existingJournalEntryId: je.id })}
                      >
                        <div>
                           <p className="text-xs font-medium text-ink-900">{je.memo || 'Journal Entry'}</p>
                           <p className="text-xs text-slate-500">{je.entryDate}</p>
                        </div>
                        <span className="text-xs text-focus-blue-500 font-medium">Match</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 text-right">
              <button 
                onClick={() => setMatchingTx(null)}
                className="text-sm text-slate-500 font-medium hover:text-ink-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

