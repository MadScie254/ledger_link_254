import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import { downloadCsv } from '../../utils/exportCsv';
import { useAppStore } from '../../store';
import { PageHeading, buttonClass } from '../ledger/Page';
import { RunningLedger } from '../ledger/RunningLedger';
import { Mark } from '../ledger/Mark';

export function GeneralLedgerView({ onBack, initialAccountName = '' }: { onBack: () => void; initialAccountName?: string }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const currency = activeCompany?.baseCurrency || 'KES';
  const [selectedAccountName, setSelectedAccountName] = useState(initialAccountName);

  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('GET /api/accounts');
      return res.json();
    },
  });
  const accounts = accountsData?.accounts || [];
  const selectedAccount = accounts.find((a: any) => a.name === selectedAccountName);

  const { data: linesData, isLoading, isError, refetch } = useQuery({
    queryKey: ['reports_general_ledger', currentOrgId, selectedAccountName],
    queryFn: async () => {
      const res = await fetch(`/api/reports/ledger?accountName=${encodeURIComponent(selectedAccountName)}`, {
        headers: { 'x-org-id': currentOrgId },
      });
      if (!res.ok) throw new Error(`GET /api/reports/ledger answered ${res.status}`);
      return res.json();
    },
    enabled: !!selectedAccountName,
  });
  const lines = linesData?.lines || [];

  const handleExportCsv = () => {
    const chronological = [...lines].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let balance = 0;
    const rows = chronological.map((l: any) => {
      balance += Number(l.debit || 0) - Number(l.credit || 0);
      return [l.date, l.sourceType, l.memo || '', Number(l.debit || 0) / 100, Number(l.credit || 0) / 100, balance / 100];
    });
    downloadCsv(
      `general_ledger_${selectedAccountName.replace(/\s+/g, '_')}.csv`,
      [[`Date`, 'Source', 'Particulars', `Debit (${currency})`, `Credit (${currency})`, `Balance (${currency})`], ...rows],
    );
  };

  const accountLabel = selectedAccount ? `${selectedAccount.code} ${selectedAccount.name}` : selectedAccountName;

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className={buttonClass.quiet}>
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Reports
      </button>

      <PageHeading
        title="General ledger"
        note={<>Every line posted to one account, oldest first · Figures in {currency}</>}
        actions={
          lines.length > 0 && (
            <button type="button" onClick={handleExportCsv} className={buttonClass.secondary}>
              <Download className="w-4 h-4" aria-hidden="true" /> Export CSV
            </button>
          )
        }
      />

      <label className="block max-w-sm">
        <span className="text-[13px] font-semibold text-ink-900">Account</span>
        <select
          value={selectedAccountName}
          onChange={(e) => setSelectedAccountName(e.target.value)}
          className="mt-1.5 block w-full h-10 px-3 text-[14px] border border-field rounded-sm bg-paper-100 text-ink-900"
        >
          <option value="">Choose an account</option>
          {accounts.map((a: any) => (
            <option key={a.id} value={a.name}>
              {a.code} · {a.name}
            </option>
          ))}
        </select>
      </label>

      {!selectedAccountName ? (
        <p className="py-6 max-w-xl text-[14px] text-graphite-600">
          Choose an account to open its ledger. Every line posted to it is listed oldest first, with the balance brought forward at the head of the page and carried forward at its foot as you scroll.
        </p>
      ) : isError ? (
        <p role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <Mark kind="circled" />
          <span className="text-ink-900">Could not load this ledger.</span>
          <span className="text-graphite-600">GET /api/reports/ledger did not complete.</span>
          <button type="button" onClick={() => refetch()} className={buttonClass.quiet}>Try again</button>
        </p>
      ) : isLoading ? (
        <div aria-busy="true" aria-label="Loading ledger lines" className="border-y border-feint-strong">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 border-b border-feint flex items-center gap-6">
              <div className="h-3 w-20 bg-paper-200" />
              <div className="h-3 flex-1 bg-paper-200" />
              <div className="h-3 w-24 bg-paper-200" />
              <div className="h-3 w-24 bg-paper-200" />
            </div>
          ))}
        </div>
      ) : lines.length === 0 ? (
        <p className="py-6 text-[14px] text-graphite-600">Nothing is posted to {accountLabel} yet. Its lines appear here once an entry uses it.</p>
      ) : (
        <RunningLedger lines={lines} currency={currency} accountLabel={accountLabel} />
      )}
    </div>
  );
}
