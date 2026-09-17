import { useState } from 'react';
import { useRenderTracker } from '../../utils/monitoring';
import { format } from 'date-fns';
import { Filter, Search, Download } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { PageHeading, IndexTabs, PageNote, SkeletonRows, EmptyNote, buttonClass } from '../ledger/Page';
import { Dialog, Field } from '../ledger/Dialog';

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
  const [matchProblem, setMatchProblem] = useState('');
  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const [ruleMatchText, setRuleMatchText] = useState('');
  const [ruleAccountId, setRuleAccountId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectInstitution, setConnectInstitution] = useState('');
  const [connectEmail, setConnectEmail] = useState('');
  const { currentOrgId, activeCompany } = useAppStore();
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

  // Fetch Bank Rules
  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: ['banking_rules', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/banking/rules', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch rules');
      return res.json();
    },
    enabled: activeTab === 'Rules'
  });

  const createRuleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/banking/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ matchText: ruleMatchText, targetAccountId: ruleAccountId })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create rule');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banking_rules', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['banking_ai_matches', currentOrgId] });
      setIsCreatingRule(false);
      setRuleMatchText('');
      setRuleAccountId('');
    }
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/banking/rules/${id}`, { method: 'DELETE', headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to delete rule');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banking_rules', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['banking_ai_matches', currentOrgId] });
    }
  });

  // Fetch Reconciliation Summary
  const { data: reconciliationData, isLoading: reconciliationLoading } = useQuery({
    queryKey: ['banking_reconciliation', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/banking/reconciliation', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch reconciliation summary');
      return res.json();
    },
    enabled: activeTab === 'Reconcile'
  });

  // Fetch Bank Connection Requests
  const { data: connectionsData, isLoading: connectionsLoading } = useQuery({
    queryKey: ['banking_connections', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/banking/connection-requests', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch connection requests');
      return res.json();
    },
    enabled: activeTab === 'Bank connections'
  });

  const requestConnectionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/banking/connection-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ institutionName: connectInstitution, contactEmail: connectEmail || undefined })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit request');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banking_connections', currentOrgId] });
      setIsConnecting(false);
      setConnectInstitution('');
      setConnectEmail('');
    }
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'The line could not be matched.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank_transactions', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['banking_ai_matches', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
      setMatchingTx(null);
      setSelectedCandidate(null);
      setMatchProblem('');
    },
    onError: (err: any) => setMatchProblem(err.message),
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

  // Lines matched during this visit get the auditor's tick drawn once, as the
  // pen makes it; lines already matched on load show it at rest.
  const [justMatched, setJustMatched] = useState<Set<string>>(() => new Set());
  const reconcile = (payload: { transactionId: string; targetAccountId?: string; existingJournalEntryId?: string }) => {
    matchMutation.mutate(payload, {
      onSuccess: () => setJustMatched((prev) => new Set(prev).add(payload.transactionId)),
    });
  };

  const handleMatchNew = (tx: any) => {
    const targetAccount = accountsData?.accounts?.find((a: any) => a.code === tx.aiCategoryCode);
    if (!targetAccount) {
      setMatchProblem(`There is no account ${tx.aiCategoryCode} in the chart of accounts. Add it, or match an existing entry.`);
      return;
    }
    reconcile({ transactionId: tx.id, targetAccountId: targetAccount.id });
  };

  const handleAcceptAIMatch = (match: any) => {
    const targetAccount = accountsData?.accounts?.find((a: any) => a.code === match.suggestedAccountCode);
    if (!targetAccount) {
      setMatchProblem(`There is no account ${match.suggestedAccountCode} in the chart of accounts, so ${match.description} was not posted.`);
      return;
    }
    setMatchProblem('');
    reconcile({
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

  const closeMatch = () => {
    setMatchingTx(null);
    setMatchProblem('');
  };
  const candidateEntries = matchingTx
    ? (journalsData?.entries || [])
        .map((je: any) => ({ je, cents: (je.lines || []).reduce((sum: number, l: any) => sum + Number(l.debit || 0), 0) }))
        .sort((x: any, y: any) => Math.abs(x.cents - matchingTx.amountCents) - Math.abs(y.cents - matchingTx.amountCents))
        .slice(0, 8) as { je: any; cents: number }[]
    : [];

  const highConfidenceCount = aiMatches.filter((m: any) => m.confidence >= 85).length;
  const unreviewedCount = rawTx.filter((t: any) => t.status !== 'MATCHED').length;

  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const totalOut = filteredTx.filter((t: any) => t.direction === 'OUT').reduce((s: number, t: any) => s + (t.amountCents || 0), 0);
  const totalIn = filteredTx.filter((t: any) => t.direction === 'IN').reduce((s: number, t: any) => s + (t.amountCents || 0), 0);

  return (
    <div className="space-y-5">
      <PageHeading
        title="Banking"
        note={<>Bank and M-Pesa statement lines, matched to the books · Figures in {baseCurrency}</>}
        actions={
          <>
            <button type="button" onClick={handleExportCSV} className={buttonClass.secondary}>
              <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
            </button>
            {highConfidenceCount > 0 && (
              <button
                type="button"
                onClick={() => autoReconcileMutation.mutate(85)}
                disabled={autoReconcileMutation.isPending}
                className={buttonClass.primary}
              >
                {autoReconcileMutation.isPending ? 'Matching…' : `Accept ${highConfidenceCount} strong ${highConfidenceCount === 1 ? 'match' : 'matches'}`}
              </button>
            )}
          </>
        }
      />

      <IndexTabs
        label="Banking"
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'Bank transactions', name: 'Statement lines', count: rawTx.length },
          { id: 'AI Match Assistant', name: 'Suggested matches', count: aiMatches.length },
          { id: 'Rules', name: 'Rules' },
          { id: 'Reconcile', name: 'Reconcile' },
          { id: 'Bank connections', name: 'Connection requests' },
        ]}
      />

      {activeTab === 'Bank transactions' && (
        <div className="-mt-1">
          {unreviewedCount > 0 && (
            <PageNote>
              <Mark kind="query" label={`${unreviewedCount} ${unreviewedCount === 1 ? 'line is' : 'lines are'} not matched`} />
              <span>
                {aiMatches.length} suggested, {highConfidenceCount} at 85% confidence or more.
              </span>
              <button type="button" onClick={() => setActiveTab('AI Match Assistant')} className={buttonClass.quiet}>
                Review suggestions
              </button>
            </PageNote>
          )}

          <div className="flex flex-wrap items-end gap-3 py-3">
            <label className="flex-1 min-w-[14rem]">
              <span className="sr-only">Find a line</span>
              <span className="relative block">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-graphite-500" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Find by description or reference"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  className="w-full h-9 pl-8 pr-3 text-[13.5px] border"
                />
              </span>
            </label>
            <label>
              <span className="sr-only">Direction</span>
              <select value={filterDirection} onChange={(e) => setFilterDirection(e.target.value)} className="h-9 px-2.5 text-[13.5px] border">
                <option value="ALL">Money in and out</option>
                <option value="IN">Money in</option>
                <option value="OUT">Money out</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Matching</span>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="h-9 px-2.5 text-[13.5px] border">
                <option value="ALL">Matched and not</option>
                <option value="UNMATCHED">Not matched</option>
                <option value="MATCHED">Matched</option>
              </select>
            </label>
            <span className="text-[12.5px] text-graphite-600 pb-2">
              {filteredTx.length} of {rawTx.length} lines
            </span>
          </div>

          {txLoading ? (
            <div aria-busy="true" aria-label="Loading statement lines">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 border-b border-feint flex items-center gap-6">
                  <div className="h-3 w-20 bg-paper-200" />
                  <div className="h-3 flex-1 bg-paper-200" />
                  <div className="h-3 w-24 bg-paper-200" />
                </div>
              ))}
            </div>
          ) : filteredTx.length === 0 ? (
            <p className="py-8 text-[14px] text-graphite-600">
              {rawTx.length === 0
                ? 'No statement lines yet. Lines from bank and M-Pesa statements are listed here to be matched against invoices, bills and payroll.'
                : 'No lines fit these filters. Clear the search or choose money in and out.'}
            </p>
          ) : (
            <>
            {/* On a phone each line is a ruled entry: when and how much, what it was, and whether it is matched. */}
            <ul className="sm:hidden" aria-label={`Statement lines, figures in ${baseCurrency}`}>
              {filteredTx.map((tx: any) => {
                const match = aiMatchesMap.get(tx.id);
                const isMatched = tx.status === 'MATCHED';
                return (
                  <li key={tx.id} className="border-b border-feint py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12.5px] text-graphite-600">{format(new Date(tx.date), 'dd/MM/yyyy')}</span>
                      <span className="flex items-baseline gap-1.5">
                        <span className="ll-printed text-[10.5px] text-graphite-600">{tx.direction === 'OUT' ? 'Out' : 'In'}</span>
                        <Amount cents={tx.amountCents} currency={baseCurrency} size="md" />
                      </span>
                    </div>
                    <p className="mt-1 text-[14px] leading-snug text-ink-900">{tx.description}</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      {isMatched ? (
                        <Mark kind="tick" label="Matched" draw={justMatched.has(tx.id)} />
                      ) : match ? (
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-900">
                          <Mark kind="query" />
                          <span className="truncate">{match.matchedEntityNumber || match.suggestedAccountName}</span>
                          <span className="shrink-0 text-graphite-600">{match.confidence}% likely</span>
                        </span>
                      ) : (
                        <span className="text-[12.5px] text-graphite-600">No suggestion</span>
                      )}
                      {!isMatched &&
                        (match && match.confidence >= 80 ? (
                          <button type="button" onClick={() => handleAcceptAIMatch(match)} disabled={matchMutation.isPending} className={`${buttonClass.quiet} shrink-0 py-1`}>
                            Accept match
                          </button>
                        ) : (
                          <button type="button" onClick={() => setMatchingTx(tx)} className={`${buttonClass.quiet} shrink-0 py-1`}>
                            Match…
                          </button>
                        ))}
                    </div>
                  </li>
                );
              })}
              <li className="ll-total mt-px flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
                <span className="font-semibold text-ink-900">Out</span>
                <Amount cents={totalOut} currency={baseCurrency} tone="ink" className="font-semibold" />
              </li>
              <li className="flex items-baseline justify-between gap-3 border-b-[3px] border-double border-ledger-red py-2 text-[13.5px]">
                <span className="font-semibold text-ink-900">In</span>
                <Amount cents={totalIn} currency={baseCurrency} tone="ink" className="font-semibold" />
              </li>
            </ul>
            <div className="hidden sm:block relative overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">Statement lines, figures in {baseCurrency}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pr-4 text-left">Date</th>
                    <th scope="col" className="pr-4 text-left">Particulars</th>
                    <th scope="col" className="pr-4 text-right">Out, {baseCurrency}</th>
                    <th scope="col" className="pr-4 text-right">In, {baseCurrency}</th>
                    <th scope="col" className="pr-4 text-left">Match</th>
                    <th scope="col" className="text-right"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTx.map((tx: any) => {
                    const match = aiMatchesMap.get(tx.id);
                    const isMatched = tx.status === 'MATCHED';
                    return (
                      <tr key={tx.id}>
                        <td className="pr-4 whitespace-nowrap text-graphite-600">{format(new Date(tx.date), 'dd/MM/yyyy')}</td>
                        <td className="pr-4">
                          <span className="block text-ink-900">{tx.description}</span>
                          {tx.bankReference && <span className="block text-[12px] text-graphite-500">Ref. {tx.bankReference}</span>}
                        </td>
                        <td className="pr-4 text-right whitespace-nowrap">
                          {tx.direction === 'OUT' ? <Amount cents={tx.amountCents} currency={baseCurrency} /> : <span className="text-graphite-400" aria-label="none">–</span>}
                        </td>
                        <td className="pr-4 text-right whitespace-nowrap">
                          {tx.direction === 'IN' ? <Amount cents={tx.amountCents} currency={baseCurrency} /> : <span className="text-graphite-400" aria-label="none">–</span>}
                        </td>
                        <td className="pr-4">
                          {isMatched ? (
                            <Mark kind="tick" label="Matched" draw={justMatched.has(tx.id)} />
                          ) : match ? (
                            <span className="inline-flex flex-wrap items-center gap-x-2 text-[12px] text-ink-900">
                              <Mark kind="query" />
                              <span>{match.matchedEntityNumber || match.suggestedAccountName}</span>
                              <span className="text-graphite-600">{match.confidence}% likely</span>
                            </span>
                          ) : (
                            <span className="text-[12px] text-graphite-600">No suggestion</span>
                          )}
                        </td>
                        <td className="text-right whitespace-nowrap">
                          {isMatched ? null : match && match.confidence >= 80 ? (
                            <button
                              type="button"
                              onClick={() => handleAcceptAIMatch(match)}
                              disabled={matchMutation.isPending}
                              className={buttonClass.quiet}
                            >
                              Accept match
                            </button>
                          ) : (
                            <button type="button" onClick={() => setMatchingTx(tx)} className={buttonClass.quiet}>
                              Match…
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">
                      Total of {filteredTx.length} lines shown
                    </th>
                    <td className="ll-total py-2 pr-4 text-right whitespace-nowrap">
                      <Amount cents={totalOut} currency={baseCurrency} tone="ink" className="font-semibold" />
                    </td>
                    <td className="ll-total py-2 pr-4 text-right whitespace-nowrap">
                      <Amount cents={totalIn} currency={baseCurrency} tone="ink" className="font-semibold" />
                    </td>
                    <td colSpan={2} className="ll-total py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'AI Match Assistant' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <p className="max-w-2xl text-[13.5px] text-graphite-600">
              Unmatched statement lines paired with an open invoice, bill or account, with how likely each pairing is and why. Nothing is posted until you accept it.
            </p>
          </div>

          {matchProblem && (
            <p role="alert" className="text-[13.5px] text-ledger-red">
              {matchProblem}
            </p>
          )}

          {aiMatchesLoading ? (
            <SkeletonRows label="Finding matches" rows={4} />
          ) : aiMatches.length === 0 ? (
            <p className="py-4 text-[14px]">
              <Mark kind="tick" label="Every statement line is matched, or nothing suggests a match." />
            </p>
          ) : (
            <ul className="border-t border-feint-strong">
              {aiMatches.map((match: any) => {
                const line = rawTx.find((t: any) => t.id === match.transactionId) || {};
                const candidate = { ...match, description: line.description ?? match.description, date: line.date ?? match.date, direction: line.direction ?? match.direction, amountCents: line.amountCents ?? match.amountCents ?? 0 };
                return (
                <li key={candidate.transactionId} className="grid grid-cols-1 gap-3 border-b border-feint py-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_8rem] md:items-start md:gap-5">
                  <div className="min-w-0">
                    <p className="ll-printed text-[10.5px] text-graphite-600">Statement line</p>
                    <p className="mt-0.5 text-[14px] text-ink-900">{candidate.description}</p>
                    <p className="mt-0.5 text-[12.5px] text-graphite-600">
                      {candidate.direction === 'IN' ? 'Money in' : 'Money out'}{candidate.date ? ` · ${format(new Date(candidate.date), 'dd/MM/yyyy')}` : ''}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="ll-printed text-[10.5px] text-graphite-600">Posts to</p>
                    <p className="mt-0.5 text-[14px] text-ink-900">
                      <span className="mr-1.5 ll-figure font-semibold">{candidate.suggestedAccountCode}</span>
                      {candidate.suggestedAccountName}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-graphite-600">
                      {candidate.matchedEntityNumber ? `${candidate.matchedEntityNumber} · ` : ''}
                      {candidate.matchReason}
                    </p>
                  </div>
                  <div className="md:text-right">
                    <Amount cents={candidate.amountCents} currency={baseCurrency} tone="ink" />
                    <p className="mt-0.5 text-[12.5px] text-graphite-600">
                      <span className="ll-figure">{candidate.confidence}%</span> likely
                    </p>
                  </div>
                  <div className="md:text-right">
                    <button type="button" onClick={() => handleAcceptAIMatch(candidate)} disabled={matchMutation.isPending} className={buttonClass.secondary}>
                      Accept
                    </button>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'Rules' && (
        <div className="max-w-3xl space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <p className="text-[13.5px] text-graphite-600">A statement line containing the text is suggested for the account. Suggestions still wait for you to accept them.</p>
            <button type="button" onClick={() => setIsCreatingRule(true)} className={`${buttonClass.secondary} shrink-0`}>
              Add a rule
            </button>
          </div>

          {rulesLoading ? (
            <SkeletonRows label="Loading rules" rows={3} />
          ) : !rulesData?.rules?.length ? (
            <EmptyNote>No rules yet. A rule such as lines containing SAFARICOM going to telephone expenses saves matching the same line every month.</EmptyNote>
          ) : (
            <ul className="border-t border-feint-strong">
              {rulesData.rules.map((rule: any) => (
                <li key={rule.id} className="flex flex-col gap-2 border-b border-feint py-3 sm:flex-row sm:items-baseline sm:justify-between">
                  <p className="text-[14px] text-ink-900">
                    Lines containing <span className="ll-figure font-semibold">{rule.matchText}</span>
                    <span className="text-graphite-600"> go to </span>
                    <span className="ll-figure font-semibold">{rule.targetAccountCode}</span> {rule.targetAccountName}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Remove the rule for lines containing ${rule.matchText}?`)) deleteRuleMutation.mutate(rule.id);
                    }}
                    className={`${buttonClass.quiet} shrink-0 text-ledger-red`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'Reconcile' && (
        <div className="max-w-3xl space-y-4">
          <p className="text-[13.5px] text-graphite-600">The imported statement balance against the cash account (1000) in the ledger.</p>
          {reconciliationLoading ? (
            <SkeletonRows label="Working out the balances" rows={3} />
          ) : (
            <>
              <div className="border-t border-feint-strong">
                <div className="flex items-baseline justify-between gap-4 border-b border-feint py-2.5 text-[14px]">
                  <span className="text-ink-900">Statement balance</span>
                  <Amount cents={reconciliationData?.statementBalanceCents || 0} currency={baseCurrency} tone="ink" />
                </div>
                <div className="flex items-baseline justify-between gap-4 border-b border-feint py-2.5 text-[14px]">
                  <span className="text-ink-900">Ledger balance, account 1000</span>
                  <Amount cents={reconciliationData?.glBalanceCents || 0} currency={baseCurrency} tone="ink" />
                </div>
                <div className="ll-total flex items-baseline justify-between gap-4 py-2.5 text-[14px] font-semibold">
                  <span className={reconciliationData?.varianceCents ? 'text-ledger-red' : 'text-ink-900'}>Difference</span>
                  <Amount cents={Math.abs(reconciliationData?.varianceCents || 0)} currency={baseCurrency} tone={reconciliationData?.varianceCents ? 'alert' : 'ink'} />
                </div>
              </div>
              {reconciliationData?.varianceCents === 0 ? (
                <p className="text-[13.5px]"><Mark kind="tick" label="The statement and the ledger agree to the cent." /></p>
              ) : (
                <p className="text-[13.5px] text-ink-900">
                  {(reconciliationData?.varianceCents || 0) > 0 ? 'Lines on the statement are not yet matched in the ledger.' : 'Entries in the ledger are not on the statement.'}{' '}
                  <button type="button" onClick={() => setActiveTab('Bank transactions')} className={buttonClass.quiet}>
                    See the unmatched lines
                  </button>
                </p>
              )}
              <p className="text-[12.5px] text-graphite-600">From {reconciliationData?.transactionCount || 0} imported statement lines.</p>
            </>
          )}
        </div>
      )}

      {activeTab === 'Bank connections' && (
        <div className="max-w-3xl space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <p className="text-[13.5px] text-graphite-600">
              Live bank and M-Pesa feeds need an account with a banking aggregator, which cannot be switched on from inside Ledger Link. A request records which institution you want; it does not connect anything.
            </p>
            <button type="button" onClick={() => setIsConnecting(true)} className={`${buttonClass.secondary} shrink-0`}>
              Request a connection
            </button>
          </div>
          {connectionsLoading ? (
            <SkeletonRows label="Loading requests" rows={2} />
          ) : !connectionsData?.requests?.length ? (
            <EmptyNote>No connections requested.</EmptyNote>
          ) : (
            <ul className="border-t border-feint-strong">
              {connectionsData.requests.map((req: any) => (
                <li key={req.id} className="flex items-baseline justify-between gap-4 border-b border-feint py-3">
                  <span>
                    <span className="block text-[14px] text-ink-900">{req.institutionName}</span>
                    <span className="block text-[12.5px] text-graphite-600">Requested {format(new Date(req.createdAt), 'dd/MM/yyyy')}</span>
                  </span>
                  <Mark kind="query" label={req.status ? req.status.charAt(0) + req.status.slice(1).toLowerCase() : 'Requested'} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog
        open={isCreatingRule}
        onClose={() => setIsCreatingRule(false)}
        title="Add a rule"
        footer={
          <>
            {createRuleMutation.isError && (
              <p role="alert" className="mr-auto text-[13px] text-ledger-red">
                {(createRuleMutation.error as Error).message}
              </p>
            )}
            <button type="button" onClick={() => setIsCreatingRule(false)} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" form="rule-form" disabled={createRuleMutation.isPending} className={buttonClass.primary}>
              {createRuleMutation.isPending ? 'Saving' : 'Save rule'}
            </button>
          </>
        }
      >
        <form
          id="rule-form"
          onSubmit={(e) => {
            e.preventDefault();
            createRuleMutation.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Statement line contains" hint="Not case sensitive, for example SAFARICOM">
            <input required value={ruleMatchText} onChange={(e) => setRuleMatchText(e.target.value)} />
          </Field>
          <Field label="Suggest the account">
            <select required value={ruleAccountId} onChange={(e) => setRuleAccountId(e.target.value)}>
              <option value="">Choose an account</option>
              {(accountsData?.accounts || []).map((a: any) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={isConnecting}
        onClose={() => setIsConnecting(false)}
        title="Request a connection"
        note="This records the request. It does not connect a bank or M-Pesa account."
        footer={
          <>
            {requestConnectionMutation.isError && (
              <p role="alert" className="mr-auto text-[13px] text-ledger-red">
                {(requestConnectionMutation.error as Error).message}
              </p>
            )}
            <button type="button" onClick={() => setIsConnecting(false)} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" form="connect-form" disabled={requestConnectionMutation.isPending} className={buttonClass.primary}>
              {requestConnectionMutation.isPending ? 'Sending' : 'Send request'}
            </button>
          </>
        }
      >
        <form
          id="connect-form"
          onSubmit={(e) => {
            e.preventDefault();
            requestConnectionMutation.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Bank, paybill or till">
            <input required value={connectInstitution} onChange={(e) => setConnectInstitution(e.target.value)} />
          </Field>
          <Field label="Contact email" hint="Optional">
            <input type="email" value={connectEmail} onChange={(e) => setConnectEmail(e.target.value)} />
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={!!matchingTx}
        onClose={closeMatch}
        width="lg"
        title="Match this line"
        footer={
          <button type="button" onClick={closeMatch} className={buttonClass.secondary}>
            Cancel
          </button>
        }
      >
        {matchingTx && (
          <div className="space-y-5">
            <div className="flex items-baseline justify-between gap-4 border-b border-feint-strong pb-3">
              <span className="min-w-0">
                <span className="block text-[14px] text-ink-900">{matchingTx.description}</span>
                <span className="block text-[12.5px] text-graphite-600">
                  {matchingTx.direction === 'IN' ? 'Money in' : 'Money out'} · {format(new Date(matchingTx.date), 'dd/MM/yyyy')}
                </span>
              </span>
              <Amount cents={matchingTx.amountCents} currency={baseCurrency} tone="ink" />
            </div>

            {matchProblem && (
              <p role="alert" className="text-[13.5px] text-ledger-red">
                {matchProblem}
              </p>
            )}

            <section aria-labelledby="match-new">
              <h3 id="match-new" className="text-[14px] font-semibold text-ink-900">Post it to an account</h3>
              {matchingTx.aiCategoryCode ? (
                <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-[13.5px] text-ink-900">
                    Suggested: <span className="ll-figure font-semibold">{matchingTx.aiCategoryCode}</span> {matchingTx.aiCategoryName}
                  </p>
                  <button type="button" onClick={() => handleMatchNew(matchingTx)} disabled={matchMutation.isPending} className={buttonClass.primary}>
                    Post to {matchingTx.aiCategoryCode}
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-[13.5px] text-graphite-600">No account is suggested for this line. Add a rule, or match it to an entry below.</p>
              )}
            </section>

            <section aria-labelledby="match-existing">
              <h3 id="match-existing" className="text-[14px] font-semibold text-ink-900">Or match an entry already posted</h3>
              <p className="mt-0.5 text-[12.5px] text-graphite-600">Closest amounts first.</p>
              {candidateEntries.length === 0 ? (
                <p className="mt-2 text-[13.5px] text-graphite-600">No journal entries yet.</p>
              ) : (
                <ul className="mt-2 max-h-64 overflow-y-auto border-t border-feint-strong">
                  {candidateEntries.map(({ je, cents }) => (
                    <li key={je.id}>
                      <button
                        type="button"
                        onClick={() => reconcile({ transactionId: matchingTx.id, existingJournalEntryId: je.id })}
                        disabled={matchMutation.isPending}
                        className="flex w-full items-baseline justify-between gap-4 border-b border-feint py-2.5 text-left hover:bg-paper-200 disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] text-ink-900">{je.memo || 'Journal entry'}</span>
                          <span className="block text-[12px] text-graphite-600">{je.entryDate ? format(new Date(je.entryDate), 'dd/MM/yyyy') : ''}</span>
                        </span>
                        <span className="flex shrink-0 items-baseline gap-3">
                          <Amount cents={cents} currency={baseCurrency} tone="ink" size="sm" />
                          {cents === matchingTx.amountCents && <Mark kind="tick" label="Same amount" />}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Dialog>
    </div>
  );
}
