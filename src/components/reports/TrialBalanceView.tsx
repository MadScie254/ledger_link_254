import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { downloadCsv } from '../../utils/exportCsv';
import { useAppStore } from '../../store';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { StatementPage, useStatementFigures } from '../ledger/Statement';
import { Mark } from '../ledger/Mark';
import { Amount } from '../ledger/Amount';
import { EmptyNote } from '../ledger/Page';

export function TrialBalanceView({ onBack }: { onBack: () => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const { currency, shown } = useStatementFigures();

  const report = useQuery({
    queryKey: ['reports_trial_balance', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/reports/trial-balance', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch Trial Balance');
      return res.json();
    },
  });

  const rows = report.data?.rows || [];
  const totalDebit = rows.reduce((acc: number, val: any) => acc + (val.debitCents || 0), 0);
  const totalCredit = rows.reduce((acc: number, val: any) => acc + (val.creditCents || 0), 0);
  const isBalanced = totalDebit === totalCredit;
  const today = format(new Date(), 'd MMMM yyyy');
  const typeName = (type: string) => (type ? type.charAt(0) + type.slice(1).toLowerCase() : '');

  const handleExportPDF = () => {
    FinancialPDFEngine.exportFinancialStatement(
      {
        title: 'Trial Balance Report',
        subtitle: 'General Ledger Account Balance Verification',
        period: `As at ${today}`,
        companyName: activeCompany?.legalName || activeCompany?.name,
        kraPin: activeCompany?.taxId,
        currency: 'KES',
        filename: `trial_balance_${format(new Date(), 'yyyyMMdd')}.pdf`,
      },
      [
        {
          headers: ['Account Code', 'Account Description', 'Type', 'Debit (KES)', 'Credit (KES)'],
          rows: [
            ...rows.map((r: any) => [r.code, r.name, r.type, r.debitCents ? FinancialPDFEngine.formatKES(r.debitCents) : '-', r.creditCents ? FinancialPDFEngine.formatKES(r.creditCents) : '-']),
            ['', 'TOTALS & EQUALITY CHECK', isBalanced ? 'BALANCED' : 'UNBALANCED', FinancialPDFEngine.formatKES(totalDebit), FinancialPDFEngine.formatKES(totalCredit)],
          ],
          columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 22 }, 3: { halign: 'right', fontStyle: 'bold' }, 4: { halign: 'right', fontStyle: 'bold' } },
        },
      ],
    );
  };

  const handleExportCsv = () => {
    const excelRows = [
      ['Account Code', 'Account Name', 'Type', 'Debit (KES)', 'Credit (KES)'],
      ...rows.map((r: any) => [r.code, r.name, r.type, (r.debitCents || 0) / 100, (r.creditCents || 0) / 100]),
      ['', 'TOTALS', isBalanced ? 'BALANCED' : 'UNBALANCED', totalDebit / 100, totalCredit / 100],
    ];
    downloadCsv('trial_balance.csv', excelRows);
  };

  const figure = (cents: number) => (cents ? <Amount cents={shown(cents)} currency={currency} tone="ink" /> : <span className="text-graphite-400">–</span>);

  return (
    <StatementPage
      title="Trial balance"
      period={`As at ${today}`}
      onBack={onBack}
      loading={report.isLoading}
      problem={report.isError ? { what: 'the trial balance', path: '/api/reports/trial-balance', onRetry: () => report.refetch() } : null}
      onCsv={handleExportCsv}
      onPdf={handleExportPDF}
    >
      {rows.length === 0 ? (
        <EmptyNote>No account has a balance yet. Every account with postings is listed here with its debit or credit balance, and the two columns must agree.</EmptyNote>
      ) : (
        <>
          <p className="mb-3 text-[13px]">
            {isBalanced ? (
              <Mark kind="tick" label="Debits equal credits." />
            ) : (
              <span className="inline-flex flex-wrap items-baseline gap-x-1.5 text-ledger-red">
                <Mark kind="circled" className="self-center" />
                <span>Debits and credits differ by</span>
                <Amount cents={shown(Math.abs(totalDebit - totalCredit))} currency={currency} tone="ink" />
              </span>
            )}
          </p>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[34rem] text-[13.5px]">
              <caption className="sr-only">Trial balance as at {today}, figures in {currency}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-16 pr-4 text-left">Code</th>
                  <th scope="col" className="pr-4 text-left">Account</th>
                  <th scope="col" className="pr-4 text-left">Type</th>
                  <th scope="col" className="pr-4 text-right">Debit</th>
                  <th scope="col" className="text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.code}>
                    <td className="w-16 pr-4 ll-figure font-semibold text-ink-900">{r.code}</td>
                    <td className="pr-4 text-ink-900">{r.name}</td>
                    <td className="pr-4 text-graphite-600">{typeName(r.type)}</td>
                    <td className="pr-4 text-right whitespace-nowrap">{figure(r.debitCents)}</td>
                    <td className="text-right whitespace-nowrap">{figure(r.creditCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">Totals</th>
                  <td className="ll-total py-2 pr-4 text-right whitespace-nowrap font-semibold"><Amount cents={shown(totalDebit)} currency={currency} tone="ink" /></td>
                  <td className="ll-total py-2 text-right whitespace-nowrap font-semibold"><Amount cents={shown(totalCredit)} currency={currency} tone="ink" /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </StatementPage>
  );
}
