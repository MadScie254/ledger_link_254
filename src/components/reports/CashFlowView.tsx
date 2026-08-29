import React, { useState } from 'react';
import { formatCurrency } from '../../utils/currency';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { Printer, Download, ArrowLeft } from 'lucide-react';
import * as XLSX from 'xlsx';

export function CashFlowView({ onBack }: { onBack: () => void }) {
  const { currentOrgId } = useAppStore();
  const [dateRange, setDateRange] = useState('This Year-to-date');

  const { data, isLoading } = useQuery({
    queryKey: ['reports_cash_flow', currentOrgId, dateRange],
    queryFn: async () => {
      const res = await fetch(`/api/reports/cash-flow?dateRange=${encodeURIComponent(dateRange)}`, {
        headers: { 'x-org-id': currentOrgId }
      });
      if (!res.ok) throw new Error('Failed to fetch Cash Flow');
      return res.json();
    }
  });

  const operating = data?.operating || [];
  const investing = data?.investing || [];
  const financing = data?.financing || [];
  const beginningCashCents = data?.beginningCashCents || 0;

  const totalOperating = operating.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const totalInvesting = investing.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const totalFinancing = financing.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const netCashChange = totalOperating + totalInvesting + totalFinancing;
  const endingCashCents = beginningCashCents + netCashChange;

  const handleExportPDF = () => {
    FinancialPDFEngine.exportFinancialStatement(
      {
        title: 'Statement of Cash Flows',
        subtitle: 'Cash Flow from Operating, Investing, and Financing Activities',
        period: dateRange,
        currency: 'KES',
        filename: `cash_flow_${format(new Date(), 'yyyyMMdd')}.pdf`
      },
      [
        {
          title: '1. CASH FLOW FROM OPERATING ACTIVITIES',
          headers: ['Operating Item', 'Amount (KES)'],
          rows: [
            ...operating.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Net Cash from Operating Activities', FinancialPDFEngine.formatKES(totalOperating)]
          ]
        },
        {
          title: '2. CASH FLOW FROM INVESTING ACTIVITIES',
          headers: ['Investing Item', 'Amount (KES)'],
          rows: [
            ...investing.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Net Cash from Investing Activities', FinancialPDFEngine.formatKES(totalInvesting)]
          ]
        },
        {
          title: '3. CASH FLOW FROM FINANCING ACTIVITIES',
          headers: ['Financing Item', 'Amount (KES)'],
          rows: [
            ...financing.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Net Cash from Financing Activities', FinancialPDFEngine.formatKES(totalFinancing)],
            ['NET CHANGE IN CASH EQUIVALENTS', FinancialPDFEngine.formatKES(netCashChange)],
            ['Beginning Cash Balance', FinancialPDFEngine.formatKES(beginningCashCents)],
            ['ENDING CASH & BANK BALANCE', FinancialPDFEngine.formatKES(endingCashCents)]
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
      ['Item Description', 'Amount (KES)'],
      ['OPERATING ACTIVITIES', ''],
      ...operating.map((i: any) => [i.name, i.amountCents / 100]),
      ['Net Cash from Operating Activities', totalOperating / 100],
      ['INVESTING ACTIVITIES', ''],
      ...investing.map((i: any) => [i.name, i.amountCents / 100]),
      ['Net Cash from Investing Activities', totalInvesting / 100],
      ['FINANCING ACTIVITIES', ''],
      ...financing.map((i: any) => [i.name, i.amountCents / 100]),
      ['Net Cash from Financing Activities', totalFinancing / 100],
      ['Net Change in Cash', netCashChange / 100],
      ['Beginning Cash Balance', beginningCashCents / 100],
      ['Ending Cash Balance', endingCashCents / 100]
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cash Flow');
    XLSX.writeFile(wb, 'cash_flow.xlsx');
  };

  if (isLoading) return <div className="p-16 text-center text-slate-500">Generating cash flow statement...</div>;

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
          <h2 className="text-xl font-serif text-ink-900">Statement of Cash Flows</h2>
          <p className="text-sm text-slate-500">Operating, Investing & Financing Cashflows • {dateRange}</p>
        </div>
        <div className="flex items-center space-x-3">
          <select 
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
          >
            <option>This Month</option>
            <option>This Quarter</option>
            <option>This Year-to-date</option>
            <option>Last Financial Year</option>
          </select>
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
          <h3 className="text-lg font-bold text-ink-900 uppercase tracking-widest">Statement of Cash Flows</h3>
          <p className="text-slate-500 text-sm">Ledgerline Enterprises Ltd • {dateRange}</p>
        </div>

        <table className="w-full text-sm">
          <tbody>
            {/* OPERATING */}
            <tr>
              <td colSpan={2} className="py-3 font-bold text-ink-900 text-base border-b border-ink-900/20">1. OPERATING ACTIVITIES</td>
            </tr>
            {operating.map((item: any) => (
              <tr key={item.name} className="hover:bg-paper-50 transition-colors">
                <td className="py-2 pl-4 text-slate-700 dark:text-slate-300">{item.name}</td>
                <td className={`py-2 pr-4 text-right tabular-currency font-medium ${item.amountCents < 0 ? 'text-rust-700' : 'text-ink-900'}`}>
                  {formatCurrency(item.amountCents)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-3 pl-4 font-semibold text-ink-900 border-t border-ink-900/10">Net Cash from Operating Activities</td>
              <td className="py-3 pr-4 text-right tabular-currency font-semibold text-ink-900 border-t border-ink-900/10">{formatCurrency(totalOperating)}</td>
            </tr>

            {/* INVESTING */}
            <tr>
              <td colSpan={2} className="pt-6 pb-3 font-bold text-ink-900 text-base border-b border-ink-900/20">2. INVESTING ACTIVITIES</td>
            </tr>
            {investing.map((item: any) => (
              <tr key={item.name} className="hover:bg-paper-50 transition-colors">
                <td className="py-2 pl-4 text-slate-700 dark:text-slate-300">{item.name}</td>
                <td className={`py-2 pr-4 text-right tabular-currency font-medium ${item.amountCents < 0 ? 'text-rust-700' : 'text-ink-900'}`}>
                  {formatCurrency(item.amountCents)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-3 pl-4 font-semibold text-ink-900 border-t border-ink-900/10">Net Cash from Investing Activities</td>
              <td className="py-3 pr-4 text-right tabular-currency font-semibold text-ink-900 border-t border-ink-900/10">{formatCurrency(totalInvesting)}</td>
            </tr>

            {/* FINANCING */}
            <tr>
              <td colSpan={2} className="pt-6 pb-3 font-bold text-ink-900 text-base border-b border-ink-900/20">3. FINANCING ACTIVITIES</td>
            </tr>
            {financing.map((item: any) => (
              <tr key={item.name} className="hover:bg-paper-50 transition-colors">
                <td className="py-2 pl-4 text-slate-700 dark:text-slate-300">{item.name}</td>
                <td className={`py-2 pr-4 text-right tabular-currency font-medium ${item.amountCents < 0 ? 'text-rust-700' : 'text-ink-900'}`}>
                  {formatCurrency(item.amountCents)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-3 pl-4 font-semibold text-ink-900 border-t border-ink-900/10">Net Cash from Financing Activities</td>
              <td className="py-3 pr-4 text-right tabular-currency font-semibold text-ink-900 border-t border-ink-900/10">{formatCurrency(totalFinancing)}</td>
            </tr>

            {/* SUMMARY */}
            <tr className="bg-paper-100/60">
              <td className="py-3 pl-4 font-bold text-ink-900 border-y border-ink-900/10">Net Change in Cash Equivalents</td>
              <td className="py-3 pr-4 text-right tabular-currency font-bold text-ink-900 border-y border-ink-900/10">{formatCurrency(netCashChange)}</td>
            </tr>
            <tr>
              <td className="py-2 pl-4 text-slate-600">Cash balance at beginning of period</td>
              <td className="py-2 pr-4 text-right tabular-currency text-slate-600">{formatCurrency(beginningCashCents)}</td>
            </tr>
            <tr className="bg-ink-900 text-white dark:text-slate-900">
              <td className="py-4 pl-4 font-bold rounded-l-sm">ENDING CASH & BANK BALANCE</td>
              <td className="py-4 pr-4 text-right tabular-currency font-bold rounded-r-sm">{formatCurrency(endingCashCents)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
