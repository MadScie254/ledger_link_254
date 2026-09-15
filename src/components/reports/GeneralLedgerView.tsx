import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { formatCurrency } from '../../utils/currency';
import { ArrowLeft, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

export function GeneralLedgerView({ onBack }: { onBack: () => void }) {
  const { currentOrgId } = useAppStore();
  const [selectedAccountName, setSelectedAccountName] = useState('');

  const { data: accountsData } = useQuery({
    queryKey: ['accounts', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/accounts', { headers: { 'x-org-id': currentOrgId } });
      return res.json();
    }
  });

  const accounts = accountsData?.accounts || [];

  const { data: linesData, isLoading } = useQuery({
    queryKey: ['reports_general_ledger', currentOrgId, selectedAccountName],
    queryFn: async () => {
      const res = await fetch(`/api/reports/ledger?accountName=${encodeURIComponent(selectedAccountName)}`, {
        headers: { 'x-org-id': currentOrgId }
      });
      if (!res.ok) throw new Error('Failed to fetch ledger lines');
      return res.json();
    },
    enabled: !!selectedAccountName
  });

  const lines = linesData?.lines || [];
  const chronological = [...lines].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let runningBalance = 0;
  const linesWithBalance = chronological.map((line: any) => {
    runningBalance += (line.debit || 0) - (line.credit || 0);
    return { ...line, runningBalance };
  });

  const handleExportExcel = () => {
    const excelRows = [
      ['Date', 'Source', 'Memo', 'Debit (KES)', 'Credit (KES)', 'Running Balance (KES)'],
      ...linesWithBalance.map((l: any) => [
        l.date, l.sourceType, l.memo || '', (l.debit || 0) / 100, (l.credit || 0) / 100, l.runningBalance / 100
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(excelRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'General Ledger');
    XLSX.writeFile(wb, `general_ledger_${selectedAccountName.replace(/\s+/g, '_')}.xlsx`);
  };

  return (
    <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm">
      <div className="p-6 border-b border-ink-900/10 flex items-center justify-between bg-paper-50">
        <div>
          <button onClick={onBack} className="text-sm font-medium text-focus-blue-500 hover:text-ink-900 mb-2 inline-flex items-center">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Reports
          </button>
          <h2 className="text-xl font-serif text-ink-900">General Ledger</h2>
          <p className="text-sm text-slate-500">Every posted transaction for a selected account.</p>
        </div>
        {lines.length > 0 && (
          <button onClick={handleExportExcel} className="bg-sidebar-bg text-sidebar-ink px-4 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors inline-flex items-center">
            <Download className="w-4 h-4 mr-1.5" /> Export Excel
          </button>
        )}
      </div>

      <div className="p-8">
        <div className="mb-6 max-w-sm">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Select Account</label>
          <select
            value={selectedAccountName}
            onChange={(e) => setSelectedAccountName(e.target.value)}
            className="w-full bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
          >
            <option value="">Choose an account...</option>
            {accounts.map((a: any) => (
              <option key={a.id} value={a.name}>{a.code} - {a.name}</option>
            ))}
          </select>
        </div>

        {!selectedAccountName ? (
          <div className="text-center text-slate-500 py-12">Select an account above to view its full transaction history.</div>
        ) : isLoading ? (
          <div className="text-center text-slate-500 py-12">Loading ledger lines...</div>
        ) : lines.length === 0 ? (
          <div className="text-center text-slate-500 py-12">No transactions posted to this account yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b-2 border-ink-900/20 text-xs uppercase text-slate-600 bg-paper-100">
              <tr>
                <th className="py-3 px-4 text-left">Date</th>
                <th className="py-3 px-4 text-left">Source</th>
                <th className="py-3 px-4 text-left">Memo</th>
                <th className="py-3 px-4 text-right">Debit</th>
                <th className="py-3 px-4 text-right">Credit</th>
                <th className="py-3 px-4 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {linesWithBalance.map((line: any) => (
                <tr key={line.id} className="hover:bg-paper-50 transition-colors">
                  <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">{format(new Date(line.date), 'MMM d, yyyy')}</td>
                  <td className="py-2.5 px-4">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-ink-900/5 text-slate-600">{line.sourceType}</span>
                  </td>
                  <td className="py-2.5 px-4 text-ink-900">{line.memo || '-'}</td>
                  <td className="py-2.5 px-4 text-right tabular-currency text-ink-900">{line.debit ? formatCurrency(line.debit) : '-'}</td>
                  <td className="py-2.5 px-4 text-right tabular-currency text-ink-900">{line.credit ? formatCurrency(line.credit) : '-'}</td>
                  <td className="py-2.5 px-4 text-right tabular-currency font-medium text-ink-900">{formatCurrency(line.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
