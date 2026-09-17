import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { useAppStore } from '../../store';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { StatementPage, useStatementFigures } from '../ledger/Statement';
import { Mark } from '../ledger/Mark';
import { Amount } from '../ledger/Amount';
import { EmptyNote } from '../ledger/Page';

const BUCKET_LABELS: Record<string, string> = {
  current: 'Not yet due',
  days1to30: '1 to 30 days',
  days31to60: '31 to 60 days',
  days61to90: '61 to 90 days',
  days90plus: 'Over 90 days',
};

interface AgingProps {
  onBack: () => void;
  title: string;
  endpoint: string;
  partyLabel: string;
  queryKey: string;
}

export function AgingReport({ onBack, title, endpoint, partyLabel, queryKey }: AgingProps) {
  const { currentOrgId, activeCompany } = useAppStore();
  const { currency, shown } = useStatementFigures();

  const report = useQuery({
    queryKey: [queryKey, currentOrgId],
    queryFn: async () => {
      const res = await fetch(endpoint, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error(`Failed to fetch ${title}`);
      return res.json();
    },
  });

  const rows = report.data?.rows || [];
  const totals = report.data?.totals || {};
  const today = format(new Date(), 'd MMMM yyyy');

  const handleExportPDF = () => {
    FinancialPDFEngine.exportFinancialStatement(
      {
        title,
        subtitle: 'Open items grouped by days past due',
        period: `As at ${today}`,
        companyName: activeCompany?.legalName || activeCompany?.name,
        kraPin: activeCompany?.taxId,
        currency: 'KES',
        filename: `${queryKey}_${format(new Date(), 'yyyyMMdd')}.pdf`,
      },
      [
        {
          headers: ['Reference', partyLabel, 'Due Date', 'Days Past Due', 'Bucket', 'Amount Due (KES)'],
          rows: rows.map((r: any) => [
            r.referenceNo,
            r.partyName,
            r.dueDate ? format(new Date(r.dueDate), 'dd/MM/yyyy') : '-',
            r.daysPastDue,
            BUCKET_LABELS[r.bucket] || r.bucket,
            FinancialPDFEngine.formatKES(r.amountDueCents),
          ]),
          columnStyles: { 5: { halign: 'right', fontStyle: 'bold' } },
        },
      ],
    );
  };

  const handleExportExcel = () => {
    const excelRows = [
      ['Reference', partyLabel, 'Due Date', 'Days Past Due', 'Bucket', 'Amount Due (KES)'],
      ...rows.map((r: any) => [r.referenceNo, r.partyName, r.dueDate || '', r.daysPastDue, BUCKET_LABELS[r.bucket] || r.bucket, r.amountDueCents / 100]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(excelRows), title.slice(0, 31));
    XLSX.writeFile(wb, `${queryKey}.xlsx`);
  };

  return (
    <StatementPage
      title={title}
      period={`As at ${today}`}
      onBack={onBack}
      loading={report.isLoading}
      problem={report.isError ? { what: title.toLowerCase(), path: endpoint, onRetry: () => report.refetch() } : null}
      onExcel={handleExportExcel}
      onPdf={handleExportPDF}
    >
      {/* The buckets as analysis columns: how much is waiting, and for how long. */}
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-5 border-y border-feint-strong">
        {Object.entries(BUCKET_LABELS).map(([key, label], i) => (
          <div key={key} className={`px-3 py-3 ${i > 0 ? 'sm:border-l' : ''} ${i % 2 === 1 ? 'border-l sm:border-l' : ''} ${i >= 2 ? 'border-t sm:border-t-0' : ''} border-feint-strong`}>
            <p className="ll-printed text-[10.5px] text-graphite-600">{label}</p>
            <p className="mt-1.5">
              <Amount cents={shown(totals[key] || 0)} currency={currency} tone={key === 'current' ? 'ink' : 'figure'} size="md" />
            </p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyNote>Nothing is outstanding. Open items are listed here by how long they have been due.</EmptyNote>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[13.5px]">
            <caption className="sr-only">{title} as at {today}, figures in {currency}</caption>
            <thead>
              <tr>
                <th scope="col" className="pr-4 text-left">Ref.</th>
                <th scope="col" className="pr-4 text-left">{partyLabel}</th>
                <th scope="col" className="pr-4 text-left">Due</th>
                <th scope="col" className="pr-4 text-left">Standing</th>
                <th scope="col" className="text-right">Owed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id}>
                  <td className="pr-4 whitespace-nowrap text-graphite-600">{r.referenceNo}</td>
                  <td className="pr-4 text-ink-900">{r.partyName}</td>
                  <td className="pr-4 whitespace-nowrap text-graphite-600">{r.dueDate ? format(new Date(r.dueDate), 'dd/MM/yyyy') : '–'}</td>
                  <td className="pr-4 whitespace-nowrap">
                    {r.bucket === 'current' ? (
                      <Mark kind="query" label="Not yet due" />
                    ) : (
                      <Mark kind="circled" label={`${r.daysPastDue} days past due`} />
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap"><Amount cents={shown(r.amountDueCents)} currency={currency} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">Total outstanding</th>
                <td className="ll-total py-2 text-right whitespace-nowrap font-semibold">
                  <Amount cents={shown(report.data?.grandTotalCents || 0)} currency={currency} tone="ink" />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </StatementPage>
  );
}

export function ARAgingView({ onBack }: { onBack: () => void }) {
  return <AgingReport onBack={onBack} title="Receivables by age" endpoint="/api/reports/ar-aging" partyLabel="Customer" queryKey="reports_ar_aging" />;
}

export function APAgingView({ onBack }: { onBack: () => void }) {
  return <AgingReport onBack={onBack} title="Payables by age" endpoint="/api/reports/ap-aging" partyLabel="Vendor" queryKey="reports_ap_aging" />;
}
