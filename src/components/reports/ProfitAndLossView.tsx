import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { downloadCsv } from '../../utils/exportCsv';
import { useAppStore } from '../../store';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { StatementPage, StatementSection, StatementLine, StatementSubtotal, StatementResult } from '../ledger/Statement';
import { Dialog } from '../ledger/Dialog';
import { RunningLedger } from '../ledger/RunningLedger';
import { EmptyNote, SkeletonRows, LoadProblem } from '../ledger/Page';

export function ProfitAndLossView({ onBack }: { onBack: () => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const [dateRange, setDateRange] = useState('This Year-to-date');
  const [drillDownAccount, setDrillDownAccount] = useState<string | null>(null);

  const report = useQuery({
    queryKey: ['reports_pl', currentOrgId, dateRange],
    queryFn: async () => {
      const res = await fetch(`/api/reports/pnl?dateRange=${encodeURIComponent(dateRange)}`, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch P&L');
      return res.json();
    },
  });

  const ledger = useQuery({
    queryKey: ['reports_ledger', currentOrgId, drillDownAccount],
    enabled: !!drillDownAccount,
    queryFn: async () => {
      const res = await fetch(`/api/reports/ledger?accountName=${encodeURIComponent(drillDownAccount!)}`, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch ledger lines');
      return res.json();
    },
  });

  const data = report.data;
  const income = data?.income || [];
  const costOfSales = data?.costOfSales || [];
  const expenses = data?.expenses || [];
  const totalIncome = income.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const totalCostOfSales = costOfSales.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const grossProfit = totalIncome - totalCostOfSales;
  const totalExpenses = expenses.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const netProfit = grossProfit - totalExpenses;

  const handleExportPDF = () => {
    if (!data) return;
    FinancialPDFEngine.exportFinancialStatement(
      {
        title: 'Profit & Loss Statement',
        subtitle: 'Statement of Comprehensive Income',
        period: dateRange,
        companyName: activeCompany?.legalName || activeCompany?.name,
        kraPin: activeCompany?.taxId,
        currency: 'KES',
        filename: `profit_and_loss_${format(new Date(), 'yyyyMMdd')}.pdf`,
      },
      [
        {
          title: '1. OPERATING REVENUE',
          headers: ['Revenue Category / Account', 'Amount (KES)'],
          rows: [...income.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]), ['Total Operating Revenue', FinancialPDFEngine.formatKES(totalIncome)]],
        },
        {
          title: '2. COST OF SALES & DIRECT EXPENSES',
          headers: ['Cost of Sales Account', 'Amount (KES)'],
          rows: [
            ...costOfSales.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Total Cost of Sales', FinancialPDFEngine.formatKES(totalCostOfSales)],
            ['GROSS OPERATING PROFIT', FinancialPDFEngine.formatKES(grossProfit)],
          ],
        },
        {
          title: '3. OPERATING EXPENSES (OPEX)',
          headers: ['Expense Category', 'Amount (KES)'],
          rows: [
            ...expenses.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Total Operating Expenses', FinancialPDFEngine.formatKES(totalExpenses)],
            ['NET PROFIT FOR THE PERIOD', FinancialPDFEngine.formatKES(netProfit)],
          ],
        },
      ],
    );
  };

  const handleExportCsv = () => {
    if (!data) return;
    const rows: (string | number)[][] = [['Account', 'Total (KES)'], ['Income', '']];
    income.forEach((i: any) => rows.push(['  ' + i.name, i.amountCents / 100]));
    rows.push(['Total Income', totalIncome / 100], ['Cost of Sales', '']);
    costOfSales.forEach((i: any) => rows.push(['  ' + i.name, i.amountCents / 100]));
    rows.push(['Total Cost of Sales', totalCostOfSales / 100], ['Gross Profit', grossProfit / 100], ['Expenses', '']);
    expenses.forEach((i: any) => rows.push(['  ' + i.name, i.amountCents / 100]));
    rows.push(['Total Expenses', totalExpenses / 100], ['Net Profit', netProfit / 100]);
    downloadCsv('profit_and_loss.csv', rows);
  };

  const isEmpty = !report.isLoading && income.length + costOfSales.length + expenses.length === 0;

  return (
    <StatementPage
      title="Profit and loss"
      period={dateRange}
      onBack={onBack}
      loading={report.isLoading}
      problem={report.isError ? { what: 'the profit and loss statement', path: '/api/reports/pnl', onRetry: () => report.refetch() } : null}
      onCsv={handleExportCsv}
      onPdf={handleExportPDF}
      controls={
        <label>
          <span className="sr-only">Period</span>
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} className="h-9 px-2.5 text-[13.5px] border border-field rounded-sm bg-paper-100 text-ink-900">
            <option>This Month</option>
            <option>This Quarter</option>
            <option>This Year-to-date</option>
            <option>Last Year</option>
          </select>
        </label>
      }
    >
      {isEmpty ? (
        <EmptyNote>Nothing is posted to income, cost of sales or expense accounts in this period. Choose another period, or post sales and bills first.</EmptyNote>
      ) : (
        <>
          <StatementSection title="Income">
            {income.map((item: any) => (
              <StatementLine key={item.name} label={item.name} cents={item.amountCents} onOpen={() => setDrillDownAccount(item.name)} />
            ))}
            <StatementSubtotal label="Total income" cents={totalIncome} />
          </StatementSection>

          <StatementSection title="Cost of sales">
            {costOfSales.map((item: any) => (
              <StatementLine key={item.name} label={item.name} cents={item.amountCents} onOpen={() => setDrillDownAccount(item.name)} />
            ))}
            <StatementSubtotal label="Total cost of sales" cents={totalCostOfSales} />
          </StatementSection>

          <StatementSubtotal label="Gross profit" cents={grossProfit} />

          <StatementSection title="Expenses">
            {expenses.map((item: any) => (
              <StatementLine key={item.name} label={item.name} cents={item.amountCents} onOpen={() => setDrillDownAccount(item.name)} />
            ))}
            <StatementSubtotal label="Total expenses" cents={totalExpenses} />
          </StatementSection>

          <StatementResult label={netProfit < 0 ? 'Net loss for the period' : 'Net profit for the period'} cents={netProfit} />
        </>
      )}

      <Dialog
        open={!!drillDownAccount}
        onClose={() => setDrillDownAccount(null)}
        title={drillDownAccount || ''}
        note="Every line posted to this account, oldest first, with balances brought and carried forward."
        width="xl"
      >
        {ledger.isError ? (
          <LoadProblem what="this account" path="/api/reports/ledger" onRetry={() => ledger.refetch()} />
        ) : ledger.isLoading ? (
          <SkeletonRows label="Loading ledger lines" />
        ) : !ledger.data?.lines?.length ? (
          <EmptyNote>Nothing is posted to this account yet.</EmptyNote>
        ) : (
          <RunningLedger lines={ledger.data.lines} currency={activeCompany?.baseCurrency || 'KES'} accountLabel={drillDownAccount || ''} />
        )}
      </Dialog>
    </StatementPage>
  );
}
