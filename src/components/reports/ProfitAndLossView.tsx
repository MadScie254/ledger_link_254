import { formatCurrency } from '../../utils/currency';
import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { Printer, Download, ArrowLeft } from 'lucide-react';
import * as XLSX from 'xlsx';

export function ProfitAndLossView({ onBack }: { onBack: () => void }) {
  const { currentOrgId } = useAppStore();
  const [dateRange, setDateRange] = useState('This Year-to-date');
  const [drillDownAccount, setDrillDownAccount] = useState<string | null>(null);

  // We could fetch real aggregated data here. For layout, we structure how it will look.
  const { data, isLoading } = useQuery({
    queryKey: ['reports_pl', currentOrgId, dateRange],
    queryFn: async () => {
      const res = await fetch(`/api/reports/pnl?dateRange=${encodeURIComponent(dateRange)}`, {
        headers: { 'x-org-id': currentOrgId }
      });
      if (!res.ok) throw new Error('Failed to fetch P&L');
      return res.json();
    }
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery({
    queryKey: ['reports_ledger', currentOrgId, drillDownAccount],
    enabled: !!drillDownAccount,
    queryFn: async () => {
      const res = await fetch(`/api/reports/ledger?accountName=${encodeURIComponent(drillDownAccount!)}`, {
        headers: { 'x-org-id': currentOrgId }
      });
      if (!res.ok) throw new Error('Failed to fetch ledger lines');
      return res.json();
    }
  });

  const totalIncome = data?.income.reduce((acc: number, val: any) => acc + val.amountCents, 0) || 0;
  const totalCostOfSales = data?.costOfSales.reduce((acc: number, val: any) => acc + val.amountCents, 0) || 0;
  const grossProfit = totalIncome - totalCostOfSales;
  const totalExpenses = data?.expenses.reduce((acc: number, val: any) => acc + val.amountCents, 0) || 0;
  const netProfit = grossProfit - totalExpenses;

  const handleExportPDF = () => {
    if (!data) return;

    FinancialPDFEngine.exportFinancialStatement(
      {
        title: 'Profit & Loss Statement',
        subtitle: 'Statement of Comprehensive Income',
        period: dateRange,
        currency: 'KES',
        filename: `profit_and_loss_${format(new Date(), 'yyyyMMdd')}.pdf`
      },
      [
        {
          title: '1. OPERATING REVENUE',
          headers: ['Revenue Category / Account', 'Amount (KES)'],
          rows: [
            ...data.income.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Total Operating Revenue', FinancialPDFEngine.formatKES(totalIncome)]
          ]
        },
        {
          title: '2. COST OF SALES & DIRECT EXPENSES',
          headers: ['Cost of Sales Account', 'Amount (KES)'],
          rows: [
            ...data.costOfSales.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Total Cost of Sales', FinancialPDFEngine.formatKES(totalCostOfSales)],
            ['GROSS OPERATING PROFIT', FinancialPDFEngine.formatKES(grossProfit)]
          ]
        },
        {
          title: '3. OPERATING EXPENSES (OPEX)',
          headers: ['Expense Category', 'Amount (KES)'],
          rows: [
            ...data.expenses.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Total Operating Expenses', FinancialPDFEngine.formatKES(totalExpenses)],
            ['NET PROFIT FOR THE PERIOD', FinancialPDFEngine.formatKES(netProfit)]
          ]
        }
      ]
    );
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
    if (!data) return;
    const rows = [];
    rows.push(['Account', 'Total (KES)']);
    rows.push(['Income', '']);
    data.income.forEach((i: any) => rows.push(['  ' + i.name, i.amountCents / 100]));
    rows.push(['Total Income', totalIncome / 100]);
    rows.push(['Cost of Sales', '']);
    data.costOfSales.forEach((i: any) => rows.push(['  ' + i.name, i.amountCents / 100]));
    rows.push(['Total Cost of Sales', totalCostOfSales / 100]);
    rows.push(['Gross Profit', grossProfit / 100]);
    rows.push(['Expenses', '']);
    data.expenses.forEach((i: any) => rows.push(['  ' + i.name, i.amountCents / 100]));
    rows.push(['Total Expenses', totalExpenses / 100]);
    rows.push(['Net Profit', netProfit / 100]);

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Profit and Loss');
    XLSX.writeFile(workbook, 'profit_and_loss.xlsx');
  };

  if (isLoading) return <div className="p-16 text-center text-slate-500">Loading report...</div>;

  return (
    <div className="bg-white dark:bg-[#111827] border border-ink-900/10 shadow-sm rounded-sm relative">
      <div className="p-6 border-b border-ink-900/10 flex items-center justify-between bg-paper-50">
        <div>
          <button 
            onClick={onBack}
            className="text-sm font-medium text-focus-blue-500 hover:text-ink-900 mb-2 inline-flex items-center"
          >
            &larr; Back to Reports
          </button>
          <h2 className="text-xl font-serif text-ink-900">Profit and Loss</h2>
          <p className="text-sm text-slate-500">Company Name • {dateRange}</p>
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
            <option>Last Year</option>
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

      <div className="p-8">
        <div className="max-w-3xl mx-auto">
          {/* Report Header */}
          <div className="text-center mb-10">
            <h3 className="text-lg font-bold text-ink-900 uppercase tracking-widest">Profit & Loss</h3>
            <p className="text-slate-500 text-sm">As of {format(new Date(), 'MMMM d, yyyy')}</p>
          </div>

          <table className="w-full text-sm">
            <tbody>
              {/* INCOME */}
              <tr>
                <td colSpan={2} className="py-3 font-bold text-ink-900 border-b border-ink-900/10">Income</td>
              </tr>
              {data?.income.map((item: any) => (
                <tr 
                  key={item.name} 
                  onClick={() => setDrillDownAccount(item.name)}
                  className="group hover:bg-paper-50 transition-colors cursor-pointer"
                >
                  <td className="py-2 pl-4 text-focus-blue-500 group-hover:underline">{item.name}</td>
                  <td className="py-2 pr-4 text-right tabular-currency text-ink-900">{formatCurrency(item.amountCents)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-3 pl-4 font-semibold text-ink-900 border-t border-ink-900/5">Total Income</td>
                <td className="py-3 pr-4 text-right tabular-currency font-semibold text-ink-900 border-t border-ink-900/5">{formatCurrency(totalIncome)}</td>
              </tr>

              {/* COST OF SALES */}
              <tr>
                <td colSpan={2} className="py-3 font-bold text-ink-900 border-b border-ink-900/10 mt-6 block border-t-0">Cost of Sales</td>
              </tr>
              {data?.costOfSales.map((item: any) => (
                <tr 
                  key={item.name}
                  onClick={() => setDrillDownAccount(item.name)}
                  className="group hover:bg-paper-50 transition-colors cursor-pointer"
                >
                  <td className="py-2 pl-4 text-focus-blue-500 group-hover:underline">{item.name}</td>
                  <td className="py-2 pr-4 text-right tabular-currency text-ink-900">{formatCurrency(item.amountCents)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-3 pl-4 font-semibold text-ink-900 border-t border-ink-900/5">Total Cost of Sales</td>
                <td className="py-3 pr-4 text-right tabular-currency font-semibold text-ink-900 border-t border-ink-900/5">{formatCurrency(totalCostOfSales)}</td>
              </tr>

              {/* GROSS PROFIT */}
              <tr className="bg-paper-100/50">
                <td className="py-4 pl-4 font-bold text-ink-900 border-y border-ink-900/10">Gross Profit</td>
                <td className="py-4 pr-4 text-right tabular-currency font-bold text-ink-900 border-y border-ink-900/10">{formatCurrency(grossProfit)}</td>
              </tr>

              {/* EXPENSES */}
              <tr>
                <td colSpan={2} className="py-3 font-bold text-ink-900 border-b border-ink-900/10 mt-6 block border-t-0">Expenses</td>
              </tr>
              {data?.expenses.map((item: any) => (
                <tr 
                  key={item.name}
                  onClick={() => setDrillDownAccount(item.name)}
                  className="group hover:bg-paper-50 transition-colors cursor-pointer"
                >
                  <td className="py-2 pl-4 text-focus-blue-500 group-hover:underline">{item.name}</td>
                  <td className="py-2 pr-4 text-right tabular-currency text-ink-900">{formatCurrency(item.amountCents)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-3 pl-4 font-semibold text-ink-900 border-t border-ink-900/5">Total Expenses</td>
                <td className="py-3 pr-4 text-right tabular-currency font-semibold text-ink-900 border-t border-ink-900/5">{formatCurrency(totalExpenses)}</td>
              </tr>

              {/* NET PROFIT */}
              <tr className="bg-ink-900 text-white dark:text-slate-900">
                <td className="py-4 pl-4 font-bold rounded-l-sm">Net Profit</td>
                <td className="py-4 pr-4 text-right tabular-currency font-bold rounded-r-sm">{formatCurrency(netProfit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {drillDownAccount && (
        <div className="fixed inset-0 bg-ink-900/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111827] rounded-sm shadow-xl border border-ink-900/10 w-full max-w-4xl p-6">
            <div className="flex justify-between items-center mb-4 border-b border-ink-900/10 pb-4">
              <div>
                <h3 className="text-xl font-serif text-ink-900">General Ledger Details</h3>
                <p className="text-sm text-slate-500">Account: {drillDownAccount}</p>
              </div>
              <button onClick={() => setDrillDownAccount(null)} className="text-slate-400 hover:text-ink-900 font-bold text-xl">
                &times;
              </button>
            </div>
            
            <table className="w-full text-sm text-left mb-6">
              <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="px-4 py-3 font-semibold">Memo</th>
                  <th className="px-4 py-3 font-semibold text-right">Debit</th>
                  <th className="px-4 py-3 font-semibold text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-900/5">
                {ledgerLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading details...</td></tr>
                ) : !ledgerData?.lines || ledgerData.lines.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No journal entries found.</td></tr>
                ) : (
                  ledgerData.lines.map((line: any) => (
                    <tr key={line.id} className="hover:bg-paper-50 transition-colors">
                      <td className="px-4 py-3 text-ink-900">{line.date}</td>
                      <td className="px-4 py-3"><span className="bg-ink-900/5 px-2 py-0.5 rounded text-xs">{line.sourceType}</span></td>
                      <td className="px-4 py-3 text-slate-600">{line.memo || '-'}</td>
                      <td className="px-4 py-3 text-right tabular-currency text-ink-900">{line.debit ? formatCurrency(line.debit) : '-'}</td>
                      <td className="px-4 py-3 text-right tabular-currency text-ink-900">{line.credit ? formatCurrency(line.credit) : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            
            <div className="flex justify-end">
               <button onClick={() => setDrillDownAccount(null)} className="px-4 py-2 bg-ink-900 text-white dark:text-slate-900 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">
                 Close
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
