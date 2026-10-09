import React from 'react';
import { NO_TAGS, TagFields, tagHeaders, type Tags } from '../common/TagFields';
import { X } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { format } from 'date-fns';
import { BudgetPlanner } from './BudgetPlanner';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { Dialog, Field } from '../ledger/Dialog';
import { Combobox } from '../ledger/Combobox';
import { PageHeading, IndexTabs, buttonClass } from '../ledger/Page';
import { PostedStamp } from '../ledger/PostedStamp';
import { AccountEditDialog, type EditableAccount } from './AccountEditDialog';
import Papa from 'papaparse';

const tabs = ['Chart of Accounts', 'Journal Entries', 'Budgets', 'Settings'];

export function AccountingView() {
  const [activeTab, setActiveTab] = useState('Chart of Accounts');
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any | null>(null);
  const [editingAccount, setEditingAccount] = useState<EditableAccount | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  
  // CoA state
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // JE State
  const [isAddingJE, setIsAddingJE] = useState(false);
  const [justPostedJE, setJustPostedJE] = useState(false);
  const [jeLines, setJeLines] = useState([{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }]);
  const [jeMemo, setJeMemo] = useState('');
  const [jeProblem, setJeProblem] = useState('');
  const [jeDate, setJeDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [jeIdempotencyKey, setJeIdempotencyKey] = useState(() => crypto.randomUUID());
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null);

  const queryClient = useQueryClient();
  const { currentOrgId, activeCompany, createIntent, setCreateIntent } = useAppStore();
  useEffect(() => {
    if (createIntent !== 'journalEntry') return;
    setActiveTab('Journal Entries');
    setIsAddingJE(true);
    setCreateIntent(null);
  }, [createIntent, setCreateIntent]);

  const { data: accountsData, isLoading: isLoadingAccounts } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch accounts');
      return res.json();
    }
  });

  // Newest first, 100 entries a page; older pages load on request.
  const journals = useInfiniteQuery({
    queryKey: ['journal-entries', currentOrgId],
    initialPageParam: '',
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/journal-entries?limit=100${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`);
      if (!res.ok) throw new Error('Failed to fetch journals');
      return res.json() as Promise<{ entries: any[]; nextCursor: string | null }>;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  });
  const isLoadingJournals = journals.isLoading;

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
          
          if (!res.ok) {
            const problem = await res.json().catch(() => ({}));
            throw new Error(problem.error || 'Failed to import accounts');
          }
          const data = await res.json();
          setImportNote({ ok: true, text: `${data.success} accounts imported${data.failed ? `, ${data.failed} skipped` : ''}.` });
          queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
          
          if (data.batchId) {
            useAppStore.getState().pushUndoAction({
              id: data.batchId,
              message: `Imported ${data.success} accounts`,
              revertEndpoint: '/api/accounts/undo-bulk',
              data: { batchId: data.batchId }
            });
          }
        } catch (err) {
          const reason = err instanceof Error && err.message !== 'Failed to import accounts' ? `${err.message} ` : '';
          setImportNote({ ok: false, text: `The file could not be imported. ${reason}Check it has Code, Name and Type columns.` });
        } finally {
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    });
  };

  const [jeTags, setJeTags] = useState<Tags>(NO_TAGS);
  const addJeMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId, ...tagHeaders(jeTags) },
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
      setJustPostedJE(true);
      window.setTimeout(() => {
        setJustPostedJE(false);
        closeJE();
      }, 520);
    }
  });

  function closeJE() {
    setIsAddingJE(false);
    setJeLines([{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }]);
    setJeMemo('');
    setJeProblem('');
    setJeIdempotencyKey(crypto.randomUUID());
    addJeMutation.reset();
  }

  const setJeLine = (index: number, patch: Partial<{ accountId: string; debit: number; credit: number }>) =>
    setJeLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const accounts = accountsData?.accounts || [];
  const entries = (journals.data?.pages || []).flatMap((page) => page.entries);

  const activeAccounts = accounts.filter((acc: any) => acc.isActive !== false);
  const inactiveCount = accounts.length - activeAccounts.length;
  const filteredAccounts = accounts.filter((acc: any) => {
    const matchesSearch = acc.name.toLowerCase().includes(searchQuery.toLowerCase()) || acc.code.includes(searchQuery);
    const matchesType = typeFilter ? acc.type === typeFilter : true;
    const matchesState = showInactive || acc.isActive !== false;
    return matchesSearch && matchesType && matchesState;
  });
  const accountMarks = (acc: any) => (
    <>
      {acc.isBankAccount && <span className="ml-2 text-[11.5px] text-graphite-600">money</span>}
      {acc.isActive === false && <span className="ml-2 text-[11.5px] text-graphite-600">inactive</span>}
    </>
  );

  const handlePostJE = (e: React.FormEvent) => {
    e.preventDefault();
    setJeProblem('');
    const formattedLines = jeLines.map(line => ({
      accountId: line.accountId,
      debit: Math.round(line.debit * 100),
      credit: Math.round(line.credit * 100)
    })).filter(l => l.debit > 0 || l.credit > 0);
    if (formattedLines.some((line) => !line.accountId)) {
      setJeProblem('Choose an account for every line with an amount.');
      return;
    }
    
    addJeMutation.mutate({
      entryDate: jeDate,
      memo: jeMemo,
      sourceType: 'MANUAL',
      idempotencyKey: jeIdempotencyKey,
      lines: formattedLines
    });
  };

  // Compared in cents so floating-point sums such as 0.1 + 0.2 still balance.
  const debitCents = jeLines.reduce((acc, l) => acc + Math.round((l.debit || 0) * 100), 0);
  const creditCents = jeLines.reduce((acc, l) => acc + Math.round((l.credit || 0) * 100), 0);
  const isBalanced = debitCents > 0 && debitCents === creditCents;

  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const typeName = (type: string) => (type ? (type.charAt(0) + type.slice(1).toLowerCase()).replace(/_/g, ' ') : '');
  // Balances arrive signed in each account's normal direction, so the side
  // comes from the type: debit for assets, expenses and cost of sales, credit
  // for liabilities, equity and income, flipped when the balance is negative.
  const balanceWithSide = (acc: any) => {
    const cents = Number(acc.balanceCents || 0);
    if (Math.round(cents) === 0) return <Amount cents={0} currency={baseCurrency} tone="ink" />;
    const normalDebit = ['ASSET', 'EXPENSE', 'COGS'].includes(acc.type);
    const side = (normalDebit ? cents > 0 : cents < 0) ? 'Dr' : 'Cr';
    return (
      <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
        <Amount cents={Math.abs(cents)} currency={baseCurrency} tone="ink" />
        <span className="w-5 text-left text-[11.5px] text-graphite-600" aria-label={side === 'Dr' ? 'debit' : 'credit'}>{side}</span>
      </span>
    );
  };
  const entryAmount = (je: any) => (je.lines || []).reduce((sum: number, line: any) => sum + Number(line.debit || 0), 0);
  // Pages arrive newest entry date first already.
  const sortedEntries = entries;
  const moreEntries = Boolean(journals.hasNextPage);
  const entriesTotal = sortedEntries.reduce((sum: number, je: any) => sum + entryAmount(je), 0);
  const skeleton = (label: string) => (
    <div aria-busy="true" aria-label={label}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-10 border-b border-feint flex items-center gap-6">
          <div className="h-3 w-12 bg-paper-200" />
          <div className="h-3 flex-1 bg-paper-200" />
          <div className="h-3 w-24 bg-paper-200" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeading
        tourId="accounting-overview"
        title="Accounting"
        note={<>The chart of accounts and every posted journal entry · Figures in {baseCurrency}</>}
        actions={
          activeTab === 'Chart of Accounts' ? (
            <button type="button" onClick={() => setIsAddingAccount(true)} className={buttonClass.primary}>Add account</button>
          ) : activeTab === 'Journal Entries' ? (
            <button type="button" onClick={() => setIsAddingJE(true)} className={buttonClass.primary}>Post an entry</button>
          ) : null
        }
      />

      <IndexTabs
        label="Accounting"
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'Chart of Accounts', name: 'Chart of accounts', count: accounts.length },
          { id: 'Journal Entries', name: 'Journal entries' },
          { id: 'Budgets', name: 'Budgets' },
          { id: 'Settings', name: 'Import and export' },
        ]}
      />

      {activeTab === 'Chart of Accounts' && (
        <div>
          <div className="flex flex-wrap items-end gap-3 pb-3">
            <label className="flex-1 min-w-[12rem] max-w-sm">
              <span className="sr-only">Find an account</span>
              <input
                type="search"
                placeholder="Find by code or name"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 px-3 text-[13.5px] border"
              />
            </label>
            <label>
              <span className="sr-only">Account type</span>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 px-2.5 text-[13.5px] border">
                <option value="">All types</option>
                <option value="ASSET">Assets</option>
                <option value="LIABILITY">Liabilities</option>
                <option value="EQUITY">Equity</option>
                <option value="INCOME">Income</option>
                <option value="COGS">Cost of sales</option>
                <option value="EXPENSE">Expenses</option>
              </select>
            </label>
            {inactiveCount > 0 && (
              <label className="flex h-9 items-center gap-2 text-[13px] text-ink-900">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Show {inactiveCount} inactive
              </label>
            )}
          </div>

          {isLoadingAccounts ? (
            skeleton('Loading accounts')
          ) : accounts.length === 0 ? (
            <div className="py-6 max-w-xl text-[14px] text-graphite-600">
              <p>No accounts yet. The chart of accounts lists every account by code, the handle each entry is posted against.</p>
              <button type="button" onClick={handleSeed} className={`${buttonClass.quiet} mt-2`}>Start from the standard Kenyan chart of accounts</button>
            </div>
          ) : filteredAccounts.length === 0 ? (
            <p className="py-6 text-[14px] text-graphite-600">No account fits this search. Clear it or choose all types.</p>
          ) : (
            <>
              <ul className="sm:hidden" aria-label={`Chart of accounts, figures in ${baseCurrency}`}>
                {filteredAccounts.map((acc: any) => (
                  <li key={acc.id} className="border-b border-feint">
                    <button type="button" onClick={() => setSelectedAccount(acc)} className="w-full py-3 text-left">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0">
                          <span className="ll-figure mr-2 font-semibold text-ink-900">{acc.code}</span>
                          <span className="text-[14px] text-ink-900">{acc.name}</span>
                          {accountMarks(acc)}
                        </span>
                        <span className="shrink-0">{balanceWithSide(acc)}</span>
                      </span>
                      <span className="mt-0.5 block text-[12px] text-graphite-600">{typeName(acc.type)}</span>
                    </button>
                    <button type="button" onClick={() => setEditingAccount(acc)} className={`${buttonClass.quiet} mb-3`}>
                      Edit account {acc.code}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="hidden sm:block relative overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <caption className="sr-only">Chart of accounts, figures in {baseCurrency}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="w-20 pr-4 text-left">Code</th>
                      <th scope="col" className="pr-4 text-left">Account</th>
                      <th scope="col" className="pr-4 text-left">Type</th>
                      <th scope="col" className="pr-4 text-right">Balance, {baseCurrency}</th>
                      <th scope="col" className="w-12"><span className="sr-only">Edit</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccounts.map((acc: any) => (
                      <tr key={acc.id} onClick={() => setSelectedAccount(acc)} className="cursor-pointer">
                        <td className="w-20 pr-4">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAccount(acc);
                            }}
                            aria-label={`Open account ${acc.code} ${acc.name}`}
                            className="ll-figure font-semibold text-ink-900 hover:underline underline-offset-[3px]"
                          >
                            {acc.code}
                          </button>
                        </td>
                        <td className="pr-4 text-ink-900">{acc.name}{accountMarks(acc)}</td>
                        <td className="pr-4 text-graphite-600">{typeName(acc.type)}</td>
                        <td className="pr-4 text-right whitespace-nowrap">{balanceWithSide(acc)}</td>
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingAccount(acc);
                            }}
                            aria-label={`Edit account ${acc.code} ${acc.name}`}
                            className={buttonClass.quiet}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'Journal Entries' && (
        isLoadingJournals ? (
          skeleton('Loading journal entries')
        ) : sortedEntries.length === 0 ? (
          <div className="py-6 max-w-xl text-[14px] text-graphite-600">
            <p>No journal entries yet. Every posted entry is listed here newest first, with the total of the entries shown carried to the foot.</p>
            <button type="button" onClick={() => setIsAddingJE(true)} className={`${buttonClass.quiet} mt-2`}>Post the first entry</button>
          </div>
        ) : (
          <>
            <ul className="sm:hidden" aria-label={`Journal entries, figures in ${baseCurrency}`}>
              {sortedEntries.map((je: any) => (
                <li key={je.id} className="border-b border-feint py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-[14px] text-ink-900">{je.memo || 'Journal entry'}</span>
                    <Amount cents={entryAmount(je)} currency={baseCurrency} className="shrink-0" />
                  </div>
                  <p className="mt-1 text-[12.5px] text-graphite-600">
                    {je.entryDate ? format(new Date(je.entryDate), 'dd/MM/yyyy') : '–'} · {je.referenceNo || 'No reference'} · {typeName(je.sourceType)}
                  </p>
                </li>
              ))}
              <li className="ll-total mt-px flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
                <span className="font-semibold text-ink-900">Total of the {sortedEntries.length} {moreEntries ? 'latest ' : ''}entries</span>
                <Amount cents={entriesTotal} currency={baseCurrency} tone="ink" className="font-semibold" />
              </li>
            </ul>
            <div className="hidden sm:block relative overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">Journal entries, newest first, figures in {baseCurrency}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pr-4 text-left">Date</th>
                    <th scope="col" className="pr-4 text-left">Ref.</th>
                    <th scope="col" className="pr-4 text-left">Particulars</th>
                    <th scope="col" className="pr-4 text-left">Source</th>
                    <th scope="col" className="text-right">{baseCurrency}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEntries.map((je: any) => (
                    <tr key={je.id}>
                      <td className="pr-4 whitespace-nowrap text-graphite-600">{je.entryDate ? format(new Date(je.entryDate), 'dd/MM/yyyy') : '–'}</td>
                      <td className="pr-4 whitespace-nowrap text-graphite-600">{je.referenceNo || '–'}</td>
                      <td className="pr-4 text-ink-900">{je.memo || 'Journal entry'}</td>
                      <td className="pr-4 text-graphite-600">{typeName(je.sourceType)}</td>
                      <td className="text-right whitespace-nowrap"><Amount cents={entryAmount(je)} currency={baseCurrency} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={4} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">Total of the {sortedEntries.length} {moreEntries ? 'latest ' : ''}entries</th>
                    <td className="ll-total py-2 text-right whitespace-nowrap"><Amount cents={entriesTotal} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {moreEntries && (
              <button type="button" onClick={() => journals.fetchNextPage()} disabled={journals.isFetchingNextPage} className={`${buttonClass.secondary} mt-3`}>
                {journals.isFetchingNextPage ? 'Loading' : 'Load older entries'}
              </button>
            )}
          </>
        )
      )}

      {activeTab === 'Budgets' && <BudgetPlanner />}

      {activeTab === 'Settings' && (
        <div className="max-w-2xl space-y-4">
          <p className="text-[14px] leading-relaxed text-ink-900">
            Move the chart of accounts in or out as a CSV file with the columns Code, Name, Type and Description. Imported accounts can be undone for a few seconds after the import.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleExportCSV} className={buttonClass.secondary}>
              Export CSV
            </button>
            <label className={`${buttonClass.secondary} cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-oxblood`}>
              Import CSV
              <input type="file" accept=".csv" className="sr-only" ref={fileInputRef} onChange={handleImportCSV} />
            </label>
          </div>
          {importNote && (
            <p role="status" className={`text-[13.5px] ${importNote.ok ? '' : 'text-ledger-red'}`}>
              {importNote.ok ? <Mark kind="tick" label={importNote.text} /> : importNote.text}
            </p>
          )}
        </div>
      )}

      <Dialog
        open={isAddingJE}
        onClose={closeJE}
        width="xl"
        placement="page"
        title="Post a journal entry"
        note="Debits must equal credits before it can be posted."
        footer={
          <>
            {jeProblem && <p role="alert" className="mr-auto text-[13px] text-negative">{jeProblem}</p>}
            {addJeMutation.isError && (
              <p role="alert" className="mr-auto text-[13px] text-ledger-red">
                {addJeMutation.error.message}
              </p>
            )}
            <button type="button" onClick={closeJE} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" form="je-form" disabled={!isBalanced || addJeMutation.isPending} className={buttonClass.primary}>
              {addJeMutation.isPending ? 'Posting' : 'Post entry'}
            </button>
          </>
        }
      >
        <div className="relative">
          {justPostedJE && <PostedStamp />}
          <form id="je-form" onSubmit={handlePostJE} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <Field label="Date">
              <input required type="date" value={jeDate} onChange={(e) => setJeDate(e.target.value)} />
            </Field>
            <Field label="Particulars" hint="Why this entry is being made by hand">
              <input required type="text" value={jeMemo} onChange={(e) => setJeMemo(e.target.value)} />
            </Field>
            <TagFields value={jeTags} onChange={setJeTags} />
          </div>

          <div className="relative">
            <table className="block w-full text-[13.5px] sm:table">
              <caption className="sr-only">Journal lines in {baseCurrency}</caption>
              <thead className="hidden sm:table-header-group">
                <tr>
                  <th scope="col" className="pr-3 text-left">Account</th>
                  <th scope="col" className="w-36 pr-3 text-right">Debit</th>
                  <th scope="col" className="w-36 pr-3 text-right">Credit</th>
                  <th scope="col" className="w-8"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody className="block sm:table-row-group">
                {jeLines.map((line, index) => (
                  <tr key={index} className="grid grid-cols-2 gap-2 border-b border-border py-2 sm:table-row sm:border-0">
                    <td className="col-span-2 block sm:table-cell sm:pr-3">
                      <span className="mb-1 block text-xs text-text-2 sm:hidden">Account</span>
                      <Combobox aria-label={`Line ${index + 1} account`} required value={line.accountId}
                        onChange={(next) => setJeLine(index, { accountId: next })} placeholder="Choose an account"
                        options={activeAccounts.map((acc: any) => ({ value: acc.id, label: `${acc.code} · ${acc.name}` }))} />
                    </td>
                    <td className="block sm:table-cell sm:pr-3">
                      <span className="mb-1 block text-xs text-text-2 sm:hidden">Debit</span>
                      <input
                        aria-label={`Line ${index + 1} debit`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={line.debit || ''}
                        onChange={(e) => {
                          const debit = parseFloat(e.target.value) || 0;
                          setJeLine(index, debit > 0 ? { debit, credit: 0 } : { debit });
                        }}
                        className="h-9 w-full border px-2.5 text-right tabular-currency text-ink-blue"
                      />
                    </td>
                    <td className="block sm:table-cell sm:pr-3">
                      <span className="mb-1 block text-xs text-text-2 sm:hidden">Credit</span>
                      <input
                        aria-label={`Line ${index + 1} credit`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={line.credit || ''}
                        onChange={(e) => {
                          const credit = parseFloat(e.target.value) || 0;
                          setJeLine(index, credit > 0 ? { credit, debit: 0 } : { credit });
                        }}
                        className="h-9 w-full border px-2.5 text-right tabular-currency text-ink-blue"
                      />
                    </td>
                    <td className="col-span-2 block text-right sm:table-cell">
                      {jeLines.length > 2 && (
                        <button type="button" onClick={() => setJeLines(jeLines.filter((_, i) => i !== index))} aria-label={`Remove line ${index + 1}`} className="p-1 text-graphite-600 hover:text-oxblood">
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="block sm:table-footer-group">
                <tr className="grid grid-cols-2 gap-2 sm:table-row">
                  <th scope="row" className="col-span-2 block py-2 text-left font-semibold text-text sm:table-cell sm:pr-3">
                    Totals
                  </th>
                  <td className="block py-2 text-right font-semibold sm:table-cell sm:pr-3"><span className="block text-xs text-text-2 sm:hidden">Debit</span><Amount cents={debitCents} currency={baseCurrency} tone="ink" /></td>
                  <td className="block py-2 text-right font-semibold sm:table-cell sm:pr-3"><span className="block text-xs text-text-2 sm:hidden">Credit</span><Amount cents={creditCents} currency={baseCurrency} tone="ink" /></td>
                  <td className="hidden sm:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => setJeLines([...jeLines, { accountId: '', debit: 0, credit: 0 }])} className={buttonClass.quiet}>
              Add a line
            </button>
            <p className="text-[13px]" aria-live="polite">
              {isBalanced ? (
                <Mark kind="tick" label="Debits equal credits." />
              ) : debitCents + creditCents === 0 ? (
                <span className="text-graphite-600">Enter the amounts.</span>
              ) : (
                <span className="inline-flex items-baseline gap-1.5 text-ledger-red">
                  Out by <Amount cents={Math.abs(debitCents - creditCents)} currency={baseCurrency} tone="ink" />
                </span>
              )}
            </p>
          </div>
          </div>
          <aside className="space-y-4" aria-label="Journal entry review">
            <section className="rounded-xl border border-border bg-surface p-5 shadow-sm" aria-live="polite">
              <h3 className="text-[15px] font-semibold text-text">Totals</h3>
              <dl className="mt-3 space-y-2 text-[13px]">
                <div className="flex justify-between gap-3"><dt>Debits</dt><dd><Amount cents={debitCents} currency={baseCurrency} tone="ink" /></dd></div>
                <div className="flex justify-between gap-3"><dt>Credits</dt><dd><Amount cents={creditCents} currency={baseCurrency} tone="ink" /></dd></div>
                <div className="flex justify-between gap-3 border-t border-border pt-3 font-semibold"><dt>Difference</dt><dd><Amount cents={Math.abs(debitCents - creditCents)} currency={baseCurrency} tone="ink" /></dd></div>
              </dl>
            </section>
            <section className="rounded-xl border border-border bg-surface-2 p-4">
              <h3 className="text-[13px] font-semibold text-text">Entry preview</h3>
              <div className="mt-3 rounded-lg border border-border bg-surface p-5 text-[13px] shadow-sm">
                <p className="font-display text-[18px] font-bold text-text">Journal entry</p>
                <p className="mt-2 text-text-2">{jeDate} · {jeMemo || 'Particulars'}</p>
                <ul className="mt-4 divide-y divide-border">
                  {jeLines.filter((line) => line.accountId || line.debit || line.credit).map((line, index) => (
                    <li key={index} className="flex justify-between gap-2 py-2">
                      <span className="min-w-0 text-text">{activeAccounts.find((account: any) => account.id === line.accountId)?.name || 'Choose an account'}</span>
                      <span className="shrink-0 text-right text-text-2">{line.debit ? 'Dr ' : 'Cr '}<Amount cents={Math.round((line.debit || line.credit) * 100)} currency={baseCurrency} size="xs" tone="ink" /></span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </aside>
          </form>
        </div>
      </Dialog>

      <AccountEditDialog account={editingAccount} orgId={currentOrgId} onClose={() => setEditingAccount(null)} />

      <DynamicQuickAddModal isOpen={isAddingAccount} onClose={() => setIsAddingAccount(false)} overrideType="ACCOUNT" />

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
