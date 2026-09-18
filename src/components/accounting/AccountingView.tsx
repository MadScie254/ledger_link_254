import React from 'react';
import { X } from 'lucide-react';
import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { format } from 'date-fns';
import { BudgetPlanner } from './BudgetPlanner';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { Dialog, Field } from '../ledger/Dialog';
import { PageHeading, IndexTabs, buttonClass } from '../ledger/Page';
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
  const [jeIdempotencyKey, setJeIdempotencyKey] = useState(() => crypto.randomUUID());
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null);

  const queryClient = useQueryClient();
  const { currentOrgId, activeCompany } = useAppStore();

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
          setImportNote({ ok: true, text: `${data.success} accounts imported${data.failed ? `, ${data.failed} skipped` : ''}.` });
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
          setImportNote({ ok: false, text: 'The file could not be imported. Check it has Code, Name and Type columns.' });
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
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
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
      closeJE();
    }
  });

  function closeJE() {
    setIsAddingJE(false);
    setJeLines([{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }]);
    setJeMemo('');
    setJeIdempotencyKey(crypto.randomUUID());
    addJeMutation.reset();
  }

  const setJeLine = (index: number, patch: Partial<{ accountId: string; debit: number; credit: number }>) =>
    setJeLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

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
      idempotencyKey: jeIdempotencyKey,
      lines: formattedLines
    });
  };

  // Compared in cents so floating-point sums such as 0.1 + 0.2 still balance.
  const debitCents = jeLines.reduce((acc, l) => acc + Math.round((l.debit || 0) * 100), 0);
  const creditCents = jeLines.reduce((acc, l) => acc + Math.round((l.credit || 0) * 100), 0);
  const isBalanced = debitCents > 0 && debitCents === creditCents;

  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const typeName = (type: string) => (type ? type.charAt(0) + type.slice(1).toLowerCase() : '');
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
  const sortedEntries = [...entries].sort((a: any, b: any) => String(b.entryDate).localeCompare(String(a.entryDate)));
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
          { id: 'Journal Entries', name: 'Journal entries', count: entries.length },
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
                <option value="EXPENSE">Expenses</option>
              </select>
            </label>
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
                        </span>
                        <span className="shrink-0">{balanceWithSide(acc)}</span>
                      </span>
                      <span className="mt-0.5 block text-[12px] text-graphite-600">{typeName(acc.type)}</span>
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
                      <th scope="col" className="text-right">Balance, {baseCurrency}</th>
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
                        <td className="pr-4 text-ink-900">{acc.name}</td>
                        <td className="pr-4 text-graphite-600">{typeName(acc.type)}</td>
                        <td className="text-right whitespace-nowrap">{balanceWithSide(acc)}</td>
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
                <span className="font-semibold text-ink-900">Total of {sortedEntries.length} entries</span>
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
                    <th scope="row" colSpan={4} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">Total of {sortedEntries.length} entries</th>
                    <td className="ll-total py-2 text-right whitespace-nowrap"><Amount cents={entriesTotal} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
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
        title="Post a journal entry"
        note="Debits must equal credits before it can be posted."
        footer={
          <>
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
        <form id="je-form" onSubmit={handlePostJE} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <Field label="Date">
              <input required type="date" value={jeDate} onChange={(e) => setJeDate(e.target.value)} />
            </Field>
            <Field label="Particulars" hint="Why this entry is being made by hand">
              <input required type="text" value={jeMemo} onChange={(e) => setJeMemo(e.target.value)} />
            </Field>
          </div>

          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[34rem] text-[13.5px]">
              <caption className="sr-only">Journal lines in {baseCurrency}</caption>
              <thead>
                <tr>
                  <th scope="col" className="pr-3 text-left">Account</th>
                  <th scope="col" className="w-36 pr-3 text-right">Debit</th>
                  <th scope="col" className="w-36 pr-3 text-right">Credit</th>
                  <th scope="col" className="w-8"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {jeLines.map((line, index) => (
                  <tr key={index}>
                    <td className="pr-3">
                      <select aria-label={`Line ${index + 1} account`} required value={line.accountId} onChange={(e) => setJeLine(index, { accountId: e.target.value })} className="h-9 w-full border px-2">
                        <option value="">Choose an account</option>
                        {accounts.map((acc: any) => (
                          <option key={acc.id} value={acc.id}>{acc.code} · {acc.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="pr-3">
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
                    <td className="pr-3">
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
                    <td>
                      {jeLines.length > 2 && (
                        <button type="button" onClick={() => setJeLines(jeLines.filter((_, i) => i !== index))} aria-label={`Remove line ${index + 1}`} className="p-1 text-graphite-600 hover:text-ledger-red">
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="ll-total py-2 pr-3 text-left font-semibold text-ink-900">
                    Totals
                  </th>
                  <td className="ll-total py-2 pr-3 text-right font-semibold"><Amount cents={debitCents} currency={baseCurrency} tone="ink" /></td>
                  <td className="ll-total py-2 pr-3 text-right font-semibold"><Amount cents={creditCents} currency={baseCurrency} tone="ink" /></td>
                  <td className="ll-total" />
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
        </form>
      </Dialog>

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
