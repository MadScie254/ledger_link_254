import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { downloadCsv } from '../../utils/exportCsv';
import { useAppStore } from '../../store';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { StatementPage, StatementSection, StatementLine, StatementSubtotal, StatementResult } from '../ledger/Statement';

export function CashFlowView({ onBack }: { onBack: () => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const [dateRange, setDateRange] = useState('This Year-to-date');

  const report = useQuery({
    queryKey: ['reports_cash_flow', currentOrgId, dateRange],
    queryFn: async () => {
      const res = await fetch(`/api/reports/cash-flow?dateRange=${encodeURIComponent(dateRange)}`, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch Cash Flow');
      return res.json();
    },
  });

  const data = report.data;
  const operating = data?.operating || [];
  const investing = data?.investing || [];
  const financing = data?.financing || [];
  const beginningCashCents = data?.beginningCashCents || 0;
  const sum = (lines: any[]) => lines.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const totalOperating = sum(operating);
  const totalInvesting = sum(investing);
  const totalFinancing = sum(financing);
  const netCashChange = totalOperating + totalInvesting + totalFinancing;
  const endingCashCents = beginningCashCents + netCashChange;

  const handleExportPDF = () => {
    FinancialPDFEngine.exportFinancialStatement(
      {
        title: 'Statement of Cash Flows',
        subtitle: 'Cash Flow from Operating, Investing, and Financing Activities',
        period: dateRange,
        companyName: activeCompany?.legalName || activeCompany?.name,
        kraPin: activeCompany?.taxId,
        currency: 'KES',
        filename: `cash_flow_${format(new Date(), 'yyyyMMdd')}.pdf`,
      },
      [
        {
          title: '1. CASH FLOW FROM OPERATING ACTIVITIES',
          headers: ['Operating Item', 'Amount (KES)'],
          rows: [...operating.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]), ['Net Cash from Operating Activities', FinancialPDFEngine.formatKES(totalOperating)]],
        },
        {
          title: '2. CASH FLOW FROM INVESTING ACTIVITIES',
          headers: ['Investing Item', 'Amount (KES)'],
          rows: [...investing.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]), ['Net Cash from Investing Activities', FinancialPDFEngine.formatKES(totalInvesting)]],
        },
        {
          title: '3. CASH FLOW FROM FINANCING ACTIVITIES',
          headers: ['Financing Item', 'Amount (KES)'],
          rows: [
            ...financing.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Net Cash from Financing Activities', FinancialPDFEngine.formatKES(totalFinancing)],
            ['NET CHANGE IN CASH EQUIVALENTS', FinancialPDFEngine.formatKES(netCashChange)],
            ['Beginning Cash Balance', FinancialPDFEngine.formatKES(beginningCashCents)],
            ['ENDING CASH & BANK BALANCE', FinancialPDFEngine.formatKES(endingCashCents)],
          ],
        },
      ],
    );
  };

  const handleExportCsv = () => {
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
      ['Ending Cash Balance', endingCashCents / 100],
    ];
    downloadCsv('cash_flow.csv', rows);
  };

  const section = (title: string, lines: any[], totalLabel: string, total: number) => (
    <StatementSection title={title}>
      {lines.length === 0 ? <StatementLine label="No movement in this period" cents={0} muted /> : lines.map((item: any) => <StatementLine key={item.name} label={item.name} cents={item.amountCents} />)}
      <StatementSubtotal label={totalLabel} cents={total} />
    </StatementSection>
  );

  return (
    <StatementPage
      title="Cash flow statement"
      period={dateRange}
      onBack={onBack}
      loading={report.isLoading}
      problem={report.isError ? { what: 'the cash flow statement', path: '/api/reports/cash-flow', onRetry: () => report.refetch() } : null}
      onCsv={handleExportCsv}
      onPdf={handleExportPDF}
      controls={
        <label>
          <span className="sr-only">Period</span>
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} className="h-9 px-2.5 text-[13.5px] border border-field rounded-sm bg-paper-100 text-ink-900">
            <option>This Month</option>
            <option>This Quarter</option>
            <option>This Year-to-date</option>
            <option>Last Financial Year</option>
          </select>
        </label>
      }
    >
      {section('Operating activities', operating, 'Net cash from operating activities', totalOperating)}
      {section('Investing activities', investing, 'Net cash from investing activities', totalInvesting)}
      {section('Financing activities', financing, 'Net cash from financing activities', totalFinancing)}

      <div className="mt-7">
        <StatementSubtotal label="Net change in cash" cents={netCashChange} />
        <StatementLine label="Cash at the start of the period" cents={beginningCashCents} muted />
      </div>
      <StatementResult label="Cash at the end of the period" cents={endingCashCents} />
    </StatementPage>
  );
}
