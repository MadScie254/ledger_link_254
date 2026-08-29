import React, { useState } from 'react';
import { formatCurrency } from '../../utils/currency';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { Printer, Download, ArrowLeft } from 'lucide-react';
import * as XLSX from 'xlsx';

export function BalanceSheetView({ onBack }: { onBack: () => void }) {
  const { currentOrgId } = useAppStore();
  const [asOfDate, setAsOfDate] = useState('2026-08-31');

  const { data, isLoading } = useQuery({
    queryKey: ['reports_balance_sheet', currentOrgId, asOfDate],
    queryFn: async () => {
      const res = await fetch(`/api/reports/balance-sheet?asOfDate=${encodeURIComponent(asOfDate)}`, {
        headers: { 'x-org-id': currentOrgId }
      });
      if (!res.ok) throw new Error('Failed to fetch Balance Sheet');
      return res.json();
    }
  });

  const currentAssets = data?.currentAssets || [];
  const nonCurrentAssets = data?.nonCurrentAssets || [];
  const currentLiabilities = data?.currentLiabilities || [];
  const equity = data?.equity || [];

  const totalCurrentAssets = currentAssets.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const totalNonCurrentAssets = nonCurrentAssets.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const totalAssets = totalCurrentAssets + totalNonCurrentAssets;

  const totalLiabilities = currentLiabilities.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const totalEquity = equity.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

  const handleExportPDF = () => {
    FinancialPDFEngine.exportFinancialStatement(
      {
        title: 'Balance Sheet Statement',
        subtitle: 'Statement of Financial Position',
        period: `As of ${format(new Date(asOfDate), 'MMMM d, yyyy')}`,
        currency: 'KES',
        filename: `balance_sheet_${format(new Date(), 'yyyyMMdd')}.pdf`
      },
      [
        {
          title: '1. ASSETS',
          headers: ['Asset Category / Account', 'Amount (KES)'],
          rows: [
            ...currentAssets.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Total Current Assets', FinancialPDFEngine.formatKES(totalCurrentAssets)],
            ...nonCurrentAssets.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['TOTAL ASSETS', FinancialPDFEngine.formatKES(totalAssets)]
          ]
        },
        {
          title: '2. LIABILITIES & SHAREHOLDERS EQUITY',
          headers: ['Liability & Equity Category', 'Amount (KES)'],
          rows: [
            ...currentLiabilities.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Total Current Liabilities', FinancialPDFEngine.formatKES(totalLiabilities)],
            ...equity.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Total Equity', FinancialPDFEngine.formatKES(totalEquity)],
            ['TOTAL LIABILITIES & EQUITY', FinancialPDFEngine.formatKES(totalLiabilitiesAndEquity)]
          ]
        }
      ]
    );
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
    const rows = [
      ['Account Name', 'Amount (KES)'],
      ['CURRENT ASSETS', ''],
      ...currentAssets.map((i: any) => [i.name, i.amountCents / 100]),
      ['Total Current Assets', totalCurrentAssets / 100],
      ['NON-CURRENT ASSETS', ''],
      ...nonCurrentAssets.map((i: any) => [i.name, i.amountCents / 100]),
      ['TOTAL ASSETS', totalAssets / 100],
      ['CURRENT LIABILITIES', ''],
      ...currentLiabilities.map((i: any) => [i.name, i.amountCents / 100]),
      ['Total Current Liabilities', totalLiabilities / 100],
      ['EQUITY', ''],
      ...equity.map((i: any) => [i.name, i.amountCents / 100]),
      ['Total Equity', totalEquity / 100],
      ['TOTAL LIABILITIES & EQUITY', totalLiabilitiesAndEquity / 100]
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Balance Sheet');
    XLSX.writeFile(wb, 'balance_sheet.xlsx');
  };

  if (isLoading) return <div className="p-16 text-center text-slate-500">Generating balance sheet...</div>;

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
          <h2 className="text-xl font-serif text-ink-900">Balance Sheet</h2>
          <p className="text-sm text-slate-500">Statement of Financial Position • As of {format(new Date(asOfDate), 'MMMM d, yyyy')}</p>
        </div>
        <div className="flex items-center space-x-3">
          <input 
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
          />
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

      <div className="p-8 max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h3 className="text-lg font-bold text-ink-900 uppercase tracking-widest">Balance Sheet</h3>
          <p className="text-slate-500 text-sm">Ledgerline Enterprises Ltd • As of {format(new Date(asOfDate), 'MMMM d, yyyy')}</p>
        </div>

        <table className="w-full text-sm">
          <tbody>
            {/* ASSETS */}
            <tr>
              <td colSpan={2} className="py-3 font-bold text-ink-900 text-base border-b border-ink-900/20">1. ASSETS</td>
            </tr>
            <tr>
              <td colSpan={2} className="pt-3 pb-1 font-semibold text-slate-700 dark:text-slate-300">Current Assets</td>
            </tr>
            {currentAssets.map((item: any) => (
              <tr key={item.name} className="hover:bg-paper-50 transition-colors">
                <td className="py-2 pl-4 text-slate-700 dark:text-slate-300">{item.name}</td>
                <td className="py-2 pr-4 text-right tabular-currency text-ink-900 font-medium">{formatCurrency(item.amountCents)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pl-4 font-semibold text-ink-900 border-t border-ink-900/10">Total Current Assets</td>
              <td className="py-2 pr-4 text-right tabular-currency font-semibold text-ink-900 border-t border-ink-900/10">{formatCurrency(totalCurrentAssets)}</td>
            </tr>

            {/* NON-CURRENT ASSETS */}
            <tr>
              <td colSpan={2} className="pt-4 pb-1 font-semibold text-slate-700 dark:text-slate-300">Non-Current Assets</td>
            </tr>
            {nonCurrentAssets.map((item: any) => (
              <tr key={item.name} className="hover:bg-paper-50 transition-colors">
                <td className="py-2 pl-4 text-slate-700 dark:text-slate-300">{item.name}</td>
                <td className="py-2 pr-4 text-right tabular-currency text-ink-900 font-medium">{formatCurrency(item.amountCents)}</td>
              </tr>
            ))}
            <tr className="bg-paper-100/50">
              <td className="py-3 pl-4 font-bold text-ink-900 border-y border-ink-900/10">TOTAL ASSETS</td>
              <td className="py-3 pr-4 text-right tabular-currency font-bold text-ink-900 border-y border-ink-900/10">{formatCurrency(totalAssets)}</td>
            </tr>

            {/* LIABILITIES */}
            <tr>
              <td colSpan={2} className="pt-8 pb-3 font-bold text-ink-900 text-base border-b border-ink-900/20">2. LIABILITIES & EQUITY</td>
            </tr>
            <tr>
              <td colSpan={2} className="pt-3 pb-1 font-semibold text-slate-700 dark:text-slate-300">Current Liabilities</td>
            </tr>
            {currentLiabilities.map((item: any) => (
              <tr key={item.name} className="hover:bg-paper-50 transition-colors">
                <td className="py-2 pl-4 text-slate-700 dark:text-slate-300">{item.name}</td>
                <td className="py-2 pr-4 text-right tabular-currency text-ink-900 font-medium">{formatCurrency(item.amountCents)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pl-4 font-semibold text-ink-900 border-t border-ink-900/10">Total Current Liabilities</td>
              <td className="py-2 pr-4 text-right tabular-currency font-semibold text-ink-900 border-t border-ink-900/10">{formatCurrency(totalLiabilities)}</td>
            </tr>

            {/* EQUITY */}
            <tr>
              <td colSpan={2} className="pt-4 pb-1 font-semibold text-slate-700 dark:text-slate-300">Equity</td>
            </tr>
            {equity.map((item: any) => (
              <tr key={item.name} className="hover:bg-paper-50 transition-colors">
                <td className="py-2 pl-4 text-slate-700 dark:text-slate-300">{item.name}</td>
                <td className="py-2 pr-4 text-right tabular-currency text-ink-900 font-medium">{formatCurrency(item.amountCents)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pl-4 font-semibold text-ink-900 border-t border-ink-900/10">Total Equity</td>
              <td className="py-2 pr-4 text-right tabular-currency font-semibold text-ink-900 border-t border-ink-900/10">{formatCurrency(totalEquity)}</td>
            </tr>

            {/* TOTAL LIABILITIES & EQUITY */}
            <tr className="bg-ink-900 text-white dark:text-slate-900">
              <td className="py-4 pl-4 font-bold rounded-l-sm">TOTAL LIABILITIES & EQUITY</td>
              <td className="py-4 pr-4 text-right tabular-currency font-bold rounded-r-sm">{formatCurrency(totalLiabilitiesAndEquity)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
