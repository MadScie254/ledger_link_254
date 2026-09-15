import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { formatCurrency } from '../../utils/currency';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { Printer, Download, ArrowLeft } from 'lucide-react';
import * as XLSX from 'xlsx';

const BUCKET_LABELS: Record<string, string> = {
  current: 'Current',
  days1to30: '1-30 Days',
  days31to60: '31-60 Days',
  days61to90: '61-90 Days',
  days90plus: '90+ Days'
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

  const { data, isLoading } = useQuery({
    queryKey: [queryKey, currentOrgId],
    queryFn: async () => {
      const res = await fetch(endpoint, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error(`Failed to fetch ${title}`);
      return res.json();
    }
  });

  const rows = data?.rows || [];
  const totals = data?.totals || {};

  const handleExportPDF = () => {
    FinancialPDFEngine.exportFinancialStatement(
      {
        title,
        subtitle: `Open items grouped by days past due`,
        period: `As of ${format(new Date(), 'MMMM d, yyyy')}`,
        companyName: activeCompany?.legalName || activeCompany?.name,
        kraPin: activeCompany?.taxId,
        currency: 'KES',
        filename: `${queryKey}_${format(new Date(), 'yyyyMMdd')}.pdf`
      },
      [
        {
          headers: ['Reference', partyLabel, 'Due Date', 'Days Past Due', 'Bucket', 'Amount Due (KES)'],
          rows: rows.map((r: any) => [
            r.referenceNo,
            r.partyName,
            r.dueDate ? format(new Date(r.dueDate), 'MMM d, yyyy') : '-',
            r.daysPastDue,
            BUCKET_LABELS[r.bucket] || r.bucket,
            FinancialPDFEngine.formatKES(r.amountDueCents)
          ]),
          columnStyles: {
            5: { halign: 'right', fontStyle: 'bold' }
          }
        }
      ]
    );
  };

  const handleExportExcel = () => {
    const excelRows = [
      ['Reference', partyLabel, 'Due Date', 'Days Past Due', 'Bucket', 'Amount Due (KES)'],
      ...rows.map((r: any) => [r.referenceNo, r.partyName, r.dueDate || '', r.daysPastDue, BUCKET_LABELS[r.bucket] || r.bucket, r.amountDueCents / 100])
    ];
    const ws = XLSX.utils.aoa_to_sheet(excelRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
    XLSX.writeFile(wb, `${queryKey}.xlsx`);
  };

  if (isLoading) return <div className="p-16 text-center text-slate-500">Loading {title}...</div>;

  return (
    <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm">
      <div className="p-6 border-b border-ink-900/10 flex items-center justify-between bg-paper-50">
        <div>
          <button onClick={onBack} className="text-sm font-medium text-focus-blue-500 hover:text-ink-900 mb-2 inline-flex items-center">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Reports
          </button>
          <h2 className="text-xl font-serif text-ink-900">{title}</h2>
          <p className="text-sm text-slate-500">As of {format(new Date(), 'MMMM d, yyyy')}</p>
        </div>
        <div className="flex items-center space-x-3">
          <button onClick={handleExportExcel} className="bg-paper-100 border border-ink-900/20 text-ink-900 px-3 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors">
            Excel
          </button>
          <button onClick={() => window.print()} className="bg-paper-100 border border-ink-900/20 text-ink-900 px-3 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors inline-flex items-center">
            <Printer className="w-4 h-4 mr-1.5" /> Print
          </button>
          <button onClick={handleExportPDF} className="bg-sidebar-bg text-sidebar-ink px-4 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors inline-flex items-center">
            <Download className="w-4 h-4 mr-1.5" /> Export PDF
          </button>
        </div>
      </div>

      <div className="p-8">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {Object.entries(BUCKET_LABELS).map(([key, label]) => (
            <div key={key} className="p-4 border border-ink-900/10 bg-paper-50 rounded-sm text-center">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</p>
              <p className="text-lg font-serif tabular-currency text-ink-900">{formatCurrency(totals[key] || 0)}</p>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="text-center text-slate-500 py-12">No open items — everything is settled.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b-2 border-ink-900/20 text-xs uppercase text-slate-600 bg-paper-100">
              <tr>
                <th className="py-3 px-4 text-left">Reference</th>
                <th className="py-3 px-4 text-left">{partyLabel}</th>
                <th className="py-3 px-4 text-left">Due Date</th>
                <th className="py-3 px-4 text-left">Bucket</th>
                <th className="py-3 px-4 text-right">Amount Due (KES)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-paper-50 transition-colors">
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-500">{r.referenceNo}</td>
                  <td className="py-2.5 px-4 font-medium text-ink-900">{r.partyName}</td>
                  <td className="py-2.5 px-4 text-slate-600">{r.dueDate ? format(new Date(r.dueDate), 'MMM d, yyyy') : '-'}</td>
                  <td className="py-2.5 px-4">
                    <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${r.bucket === 'current' ? 'bg-ledger-green-700/10 text-ledger-green-700' : 'bg-rust-700/10 text-rust-700'}`}>
                      {BUCKET_LABELS[r.bucket] || r.bucket}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-currency font-medium text-ink-900">{formatCurrency(r.amountDueCents)}</td>
                </tr>
              ))}
              <tr className="bg-sidebar-bg text-sidebar-ink font-bold text-sm">
                <td colSpan={4} className="py-3.5 px-4 rounded-l-sm">TOTAL OUTSTANDING</td>
                <td className="py-3.5 px-4 text-right tabular-currency rounded-r-sm">{formatCurrency(data?.grandTotalCents || 0)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function ARAgingView({ onBack }: { onBack: () => void }) {
  return <AgingReport onBack={onBack} title="A/R Aging Summary" endpoint="/api/reports/ar-aging" partyLabel="Customer" queryKey="reports_ar_aging" />;
}

export function APAgingView({ onBack }: { onBack: () => void }) {
  return <AgingReport onBack={onBack} title="A/P Aging Summary" endpoint="/api/reports/ap-aging" partyLabel="Vendor" queryKey="reports_ap_aging" />;
}
