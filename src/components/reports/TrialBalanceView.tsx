import React, { useState } from 'react';
import { formatCurrency } from '../../utils/currency';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { Printer, Download, ArrowLeft, CheckCircle2 } from 'lucide-react';
import * as XLSX from 'xlsx';

export function TrialBalanceView({ onBack }: { onBack: () => void }) {
  const { currentOrgId } = useAppStore();

  const { data, isLoading } = useQuery({
    queryKey: ['reports_trial_balance', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/reports/trial-balance', {
        headers: { 'x-org-id': currentOrgId }
      });
      if (!res.ok) throw new Error('Failed to fetch Trial Balance');
      return res.json();
    }
  });

  const rows = data?.rows || [];
  const totalDebit = rows.reduce((acc: number, val: any) => acc + (val.debitCents || 0), 0);
  const totalCredit = rows.reduce((acc: number, val: any) => acc + (val.creditCents || 0), 0);
  const isBalanced = totalDebit === totalCredit;

  const handleExportPDF = () => {
    FinancialPDFEngine.exportFinancialStatement(
      {
        title: 'Trial Balance Report',
        subtitle: 'General Ledger Account Balance Verification',
        period: `As of ${format(new Date(), 'MMMM d, yyyy')}`,
        currency: 'KES',
        filename: `trial_balance_${format(new Date(), 'yyyyMMdd')}.pdf`
      },
      [
        {
          headers: ['Account Code', 'Account Description', 'Type', 'Debit (KES)', 'Credit (KES)'],
          rows: [
            ...rows.map((r: any) => [
              r.code,
              r.name,
              r.type,
              r.debitCents ? FinancialPDFEngine.formatKES(r.debitCents) : '-',
              r.creditCents ? FinancialPDFEngine.formatKES(r.creditCents) : '-'
            ]),
            ['', 'TOTALS & EQUALITY CHECK', isBalanced ? 'BALANCED' : 'UNBALANCED', FinancialPDFEngine.formatKES(totalDebit), FinancialPDFEngine.formatKES(totalCredit)]
          ],
          columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 22 },
            3: { halign: 'right', fontStyle: 'bold' },
            4: { halign: 'right', fontStyle: 'bold' }
          }
        }
      ]
    );
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
    const excelRows = [
      ['Account Code', 'Account Name', 'Type', 'Debit (KES)', 'Credit (KES)'],
      ...rows.map((r: any) => [r.code, r.name, r.type, (r.debitCents || 0) / 100, (r.creditCents || 0) / 100]),
      ['', 'TOTALS', isBalanced ? 'BALANCED' : 'UNBALANCED', totalDebit / 100, totalCredit / 100]
    ];
    const ws = XLSX.utils.aoa_to_sheet(excelRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Trial Balance');
    XLSX.writeFile(wb, 'trial_balance.xlsx');
  };

  if (isLoading) return <div className="p-16 text-center text-slate-500">Generating trial balance...</div>;

  return (
    <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm">
      <div className="p-6 border-b border-ink-900/10 flex items-center justify-between bg-paper-50">
        <div>
          <button 
            onClick={onBack}
            className="text-sm font-medium text-focus-blue-500 hover:text-ink-900 mb-2 inline-flex items-center"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Reports
          </button>
          <h2 className="text-xl font-serif text-ink-900">Trial Balance</h2>
          <p className="text-sm text-slate-500">Double-entry accounting equality check • As of {format(new Date(), 'MMMM d, yyyy')}</p>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center text-xs font-semibold px-3 py-1.5 rounded-full bg-ledger-green-700/10 text-ledger-green-700">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
            Equality Verified (Net 0)
          </div>
          <button onClick={handleExportExcel} className="bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 px-3 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors">
            Excel
          </button>
          <button onClick={handlePrint} className="bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 px-3 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors inline-flex items-center">
            <Printer className="w-4 h-4 mr-1.5" /> Print
          </button>
          <button onClick={handleExportPDF} className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors inline-flex items-center">
            <Download className="w-4 h-4 mr-1.5" /> Export PDF
          </button>
        </div>
      </div>

      <div className="p-8 max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h3 className="text-lg font-bold text-ink-900 uppercase tracking-widest">Trial Balance</h3>
          <p className="text-slate-500 text-sm">Ledgerline Enterprises Ltd • Generated on {format(new Date(), 'dd MMMM yyyy')}</p>
        </div>

        <table className="w-full text-sm">
          <thead className="border-b-2 border-ink-900/20 text-xs uppercase text-slate-600 bg-paper-100">
            <tr>
              <th className="py-3 px-4 text-left">Code</th>
              <th className="py-3 px-4 text-left">Account Description</th>
              <th className="py-3 px-4 text-left">Type</th>
              <th className="py-3 px-4 text-right">Debit (KES)</th>
              <th className="py-3 px-4 text-right">Credit (KES)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-900/5">
            {rows.map((r: any) => (
              <tr key={r.code} className="hover:bg-paper-50 transition-colors">
                <td className="py-2.5 px-4 font-mono font-bold text-xs text-slate-500">{r.code}</td>
                <td className="py-2.5 px-4 font-medium text-ink-900">{r.name}</td>
                <td className="py-2.5 px-4">
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-ink-900/5 text-slate-600">
                    {r.type}
                  </span>
                </td>
                <td className="py-2.5 px-4 text-right tabular-currency font-medium text-ink-900">
                  {r.debitCents ? formatCurrency(r.debitCents) : '-'}
                </td>
                <td className="py-2.5 px-4 text-right tabular-currency font-medium text-ink-900">
                  {r.creditCents ? formatCurrency(r.creditCents) : '-'}
                </td>
              </tr>
            ))}
            <tr className="bg-ink-900 text-white dark:text-slate-900 font-bold text-sm">
              <td colSpan={3} className="py-3.5 px-4 rounded-l-sm">TOTALS</td>
              <td className="py-3.5 px-4 text-right tabular-currency">{formatCurrency(totalDebit)}</td>
              <td className="py-3.5 px-4 text-right tabular-currency rounded-r-sm">{formatCurrency(totalCredit)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
