import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { downloadCsv } from '../../utils/exportCsv';
import { useAppStore } from '../../store';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { StatementPage, StatementSection, StatementLine, StatementSubtotal, StatementResult, useStatementFigures } from '../ledger/Statement';
import { Mark } from '../ledger/Mark';
import { Amount } from '../ledger/Amount';

export function BalanceSheetView({ onBack }: { onBack: () => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const { currency, shown } = useStatementFigures();
  const [asOfDate, setAsOfDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const report = useQuery({
    queryKey: ['reports_balance_sheet', currentOrgId, asOfDate],
    queryFn: async () => {
      const res = await fetch(`/api/reports/balance-sheet?asOfDate=${encodeURIComponent(asOfDate)}`, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch Balance Sheet');
      return res.json();
    },
  });

  const data = report.data;
  const currentAssets = data?.currentAssets || [];
  const nonCurrentAssets = data?.nonCurrentAssets || [];
  const currentLiabilities = data?.currentLiabilities || [];
  const equity = data?.equity || [];

  const sum = (lines: any[]) => lines.reduce((acc: number, val: any) => acc + val.amountCents, 0);
  const totalCurrentAssets = sum(currentAssets);
  const totalNonCurrentAssets = sum(nonCurrentAssets);
  const totalAssets = totalCurrentAssets + totalNonCurrentAssets;
  const totalLiabilities = sum(currentLiabilities);
  const totalEquity = sum(equity);
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  const difference = totalAssets - totalLiabilitiesAndEquity;
  const asAt = format(new Date(asOfDate), 'd MMMM yyyy');

  const handleExportPDF = () => {
    FinancialPDFEngine.exportFinancialStatement(
      {
        title: 'Balance Sheet Statement',
        subtitle: 'Statement of Financial Position',
        period: `As at ${asAt}`,
        companyName: activeCompany?.legalName || activeCompany?.name,
        kraPin: activeCompany?.taxId,
        currency: 'KES',
        filename: `balance_sheet_${format(new Date(), 'yyyyMMdd')}.pdf`,
      },
      [
        {
          title: '1. ASSETS',
          headers: ['Asset Category / Account', 'Amount (KES)'],
          rows: [
            ...currentAssets.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Total Current Assets', FinancialPDFEngine.formatKES(totalCurrentAssets)],
            ...nonCurrentAssets.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['TOTAL ASSETS', FinancialPDFEngine.formatKES(totalAssets)],
          ],
        },
        {
          title: '2. LIABILITIES & SHAREHOLDERS EQUITY',
          headers: ['Liability & Equity Category', 'Amount (KES)'],
          rows: [
            ...currentLiabilities.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Total Current Liabilities', FinancialPDFEngine.formatKES(totalLiabilities)],
            ...equity.map((i: any) => [`  ${i.name}`, FinancialPDFEngine.formatKES(i.amountCents)]),
            ['Total Equity', FinancialPDFEngine.formatKES(totalEquity)],
            ['TOTAL LIABILITIES & EQUITY', FinancialPDFEngine.formatKES(totalLiabilitiesAndEquity)],
          ],
        },
      ],
    );
  };

  const handleExportCsv = () => {
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
      ['TOTAL LIABILITIES & EQUITY', totalLiabilitiesAndEquity / 100],
    ];
    downloadCsv('balance_sheet.csv', rows);
  };

  return (
    <StatementPage
      title="Balance sheet"
      period={`As at ${asAt}`}
      onBack={onBack}
      loading={report.isLoading}
      problem={report.isError ? { what: 'the balance sheet', path: '/api/reports/balance-sheet', onRetry: () => report.refetch() } : null}
      onCsv={handleExportCsv}
      onPdf={handleExportPDF}
      controls={
        <label>
          <span className="sr-only">As at</span>
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="h-9 px-2.5 text-[13.5px] border border-field rounded-sm bg-paper-100 text-ink-900" />
        </label>
      }
    >
      <p className="mb-2 text-[13px]">
        {Math.round(difference) === 0 ? (
          <Mark kind="tick" label="Assets equal liabilities and equity." />
        ) : (
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5 text-ledger-red">
            <Mark kind="circled" className="self-center" />
            <span>Out of balance by</span>
            <Amount cents={shown(Math.abs(difference))} currency={currency} tone="ink" />
          </span>
        )}
      </p>

      <StatementSection title="Current assets">
        {currentAssets.map((item: any) => (
          <StatementLine key={item.name} label={item.name} cents={item.amountCents} />
        ))}
        <StatementSubtotal label="Total current assets" cents={totalCurrentAssets} />
      </StatementSection>

      <StatementSection title="Non-current assets">
        {nonCurrentAssets.length === 0 ? (
          <StatementLine label="None recorded" cents={0} muted />
        ) : (
          nonCurrentAssets.map((item: any) => <StatementLine key={item.name} label={item.name} cents={item.amountCents} />)
        )}
      </StatementSection>

      <StatementResult label="Total assets" cents={totalAssets} />

      <StatementSection title="Current liabilities">
        {currentLiabilities.map((item: any) => (
          <StatementLine key={item.name} label={item.name} cents={item.amountCents} />
        ))}
        <StatementSubtotal label="Total liabilities" cents={totalLiabilities} />
      </StatementSection>

      <StatementSection title="Equity">
        {equity.map((item: any) => (
          <StatementLine key={item.name} label={item.name} cents={item.amountCents} />
        ))}
        <StatementSubtotal label="Total equity" cents={totalEquity} />
      </StatementSection>

      <StatementResult label="Total liabilities and equity" cents={totalLiabilitiesAndEquity} />
    </StatementPage>
  );
}
