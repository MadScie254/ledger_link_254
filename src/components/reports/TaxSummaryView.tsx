import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { useAppStore } from '../../store';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { StatementPage, StatementSection, StatementLine, StatementSubtotal, StatementResult } from '../ledger/Statement';
import { Mark } from '../ledger/Mark';

export function TaxSummaryView({ onBack }: { onBack: () => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const [period, setPeriod] = useState('August 2026');

  const report = useQuery({
    queryKey: ['reports_tax_summary', currentOrgId, period],
    queryFn: async () => {
      const res = await fetch(`/api/reports/tax-summary?period=${encodeURIComponent(period)}`, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch Tax Summary');
      return res.json();
    },
  });

  const data = report.data;
  const outputVat = data?.outputVat || { standardRatedSalesCents: 0, vatRatePercent: 16, taxAmountCents: 0 };
  const inputVat = data?.inputVat || { claimablePurchasesCents: 0, vatRatePercent: 16, taxAmountCents: 0 };
  const withholdingTaxVat = data?.withholdingTaxVat || { withholdingRatePercent: 2, withheldAmountCents: 0 };
  const netVatPayableCents = data?.netVatPayableCents ?? outputVat.taxAmountCents - inputVat.taxAmountCents - withholdingTaxVat.withheldAmountCents;
  const etimsVerifiedCount = data?.etimsVerifiedCount ?? 0;
  const etimsPendingCount = data?.etimsPendingCount ?? 0;
  const kraPin = data?.kraPin || activeCompany?.taxId;
  const totalDeductions = inputVat.taxAmountCents + withholdingTaxVat.withheldAmountCents;

  const handleExportPDF = () => {
    FinancialPDFEngine.exportFinancialStatement(
      {
        title: 'KRA VAT & eTIMS Tax Compliance Summary',
        subtitle: 'Kenya Revenue Authority Value Added Tax Return Schedule',
        period,
        companyName: activeCompany?.legalName || activeCompany?.name,
        kraPin: kraPin || 'Not set',
        currency: 'KES',
        filename: `kra_vat_summary_${format(new Date(), 'yyyyMMdd')}.pdf`,
      },
      [
        {
          title: '1. OUTPUT TAX (Sales & Invoicing)',
          headers: ['Tax Bracket / Description', 'Taxable Base (KES)', 'Rate', 'Output VAT (KES)'],
          rows: [
            ['Standard Rated Supplies (16%)', FinancialPDFEngine.formatKES(outputVat.standardRatedSalesCents), '16%', FinancialPDFEngine.formatKES(outputVat.taxAmountCents)],
            ['Zero Rated Supplies (0%)', FinancialPDFEngine.formatKES(0), '0%', FinancialPDFEngine.formatKES(0)],
            ['Exempt Supplies', FinancialPDFEngine.formatKES(0), '0%', FinancialPDFEngine.formatKES(0)],
            ['TOTAL OUTPUT TAX (A)', '', '', FinancialPDFEngine.formatKES(outputVat.taxAmountCents)],
          ],
          columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'right' }, 2: { halign: 'center' }, 3: { halign: 'right', fontStyle: 'bold' } },
        },
        {
          title: '2. INPUT TAX (Purchases & Expenses)',
          headers: ['Tax Bracket / Description', 'Claimable Base (KES)', 'Rate', 'Input VAT (KES)'],
          rows: [
            ['Standard Rated Local Purchases', FinancialPDFEngine.formatKES(inputVat.claimablePurchasesCents), '16%', FinancialPDFEngine.formatKES(inputVat.taxAmountCents)],
            ['Withholding VAT Deductions (2%)', '', '2%', FinancialPDFEngine.formatKES(withholdingTaxVat.withheldAmountCents)],
            ['TOTAL INPUT TAX & DEDUCTIONS (B)', '', '', FinancialPDFEngine.formatKES(totalDeductions)],
          ],
          columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'right' }, 2: { halign: 'center' }, 3: { halign: 'right', fontStyle: 'bold' } },
        },
        {
          title: '3. NET TAX PAYABLE / (REFUND CLAIM)',
          headers: ['Calculation Line', 'Amount (KES)'],
          rows: [
            ['Total Output Tax (A)', FinancialPDFEngine.formatKES(outputVat.taxAmountCents)],
            ['Less: Total Deductible Input Tax (B)', `(${FinancialPDFEngine.formatKES(totalDeductions)})`],
            ['NET VAT PAYABLE TO KRA', FinancialPDFEngine.formatKES(netVatPayableCents)],
          ],
        },
      ],
    );
  };

  const handleExportExcel = () => {
    const excelRows = [
      ['Tax Section', 'Base Amount (KES)', 'Tax Rate', 'Tax Amount (KES)'],
      ['Standard Rated Sales (Output VAT)', outputVat.standardRatedSalesCents / 100, '16%', outputVat.taxAmountCents / 100],
      ['Standard Rated Purchases (Input VAT)', inputVat.claimablePurchasesCents / 100, '16%', inputVat.taxAmountCents / 100],
      ['Withholding VAT (WHVAT 2%)', '', '2%', withholdingTaxVat.withheldAmountCents / 100],
      ['NET VAT PAYABLE TO KRA', '', '', netVatPayableCents / 100],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(excelRows), 'KRA VAT Summary');
    XLSX.writeFile(wb, 'kra_vat_summary.xlsx');
  };

  return (
    <StatementPage
      title="VAT and eTIMS summary"
      period={`${period}${kraPin ? ` · KRA PIN ${kraPin}` : ''}`}
      onBack={onBack}
      loading={report.isLoading}
      problem={report.isError ? { what: 'the tax summary', path: '/api/reports/tax-summary', onRetry: () => report.refetch() } : null}
      onExcel={handleExportExcel}
      onPdf={handleExportPDF}
      controls={
        <label>
          <span className="sr-only">Period</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 px-2.5 text-[13.5px] border border-field rounded-sm bg-paper-100 text-ink-900">
            <option>August 2026</option>
            <option>July 2026</option>
            <option>June 2026</option>
            <option>Q2 2026</option>
            <option>Q1 2026</option>
          </select>
        </label>
      }
    >
      <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-feint pb-3 text-[13px] text-ink-900">
        {etimsVerifiedCount === 0 && etimsPendingCount === 0 ? (
          <Mark kind="query" label="No eTIMS submissions yet. Submitting needs your own OSCU or VSCU device registration with KRA." />
        ) : (
          <>
            <Mark kind="tick" label={`${etimsVerifiedCount} invoices signed by eTIMS`} />
            {etimsPendingCount > 0 && <Mark kind="query" label={`${etimsPendingCount} queued`} />}
          </>
        )}
        {!kraPin && <Mark kind="circled" label="No KRA PIN recorded in Settings" />}
      </p>

      <StatementSection title="Output tax on sales">
        <StatementLine label="Standard-rated sales" cents={outputVat.standardRatedSalesCents} muted />
        <StatementSubtotal label="Output VAT at 16%" cents={outputVat.taxAmountCents} />
      </StatementSection>

      <StatementSection title="Input tax on purchases">
        <StatementLine label="Claimable local purchases" cents={inputVat.claimablePurchasesCents} muted />
        <StatementLine label="Input VAT at 16%" cents={inputVat.taxAmountCents} />
        <StatementLine label="Withholding VAT credit at 2%" cents={withholdingTaxVat.withheldAmountCents} />
        <StatementSubtotal label="Total deductions" cents={totalDeductions} />
      </StatementSection>

      <StatementResult label={netVatPayableCents < 0 ? 'VAT to claim back from KRA' : 'Net VAT due to KRA'} cents={netVatPayableCents} />
      <p className="mt-2 text-[12.5px] text-graphite-600">
        Due by the 20th of the following month. When the 20th falls on a weekend it is due the next working day.
      </p>
    </StatementPage>
  );
}
