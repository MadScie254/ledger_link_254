import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { format } from 'date-fns';
import Papa from 'papaparse';

const tabs = ['Employees', 'Run payroll', 'Payslips', 'Statutory filings (PAYE/NSSF/SHIF)'];

// Mirrors src/server/payroll.ts calculatePayslip — Kenyan statutory bands
// (Finance Act 2023 / NSSF Act / SHIF Act, 2024/2025 rates). Duplicated here
// purely for an instant client-side preview; the server recomputes and is
// the source of truth when a payroll run is actually processed.
function calculatePayslipPreview(grossCents: number) {
  const gross = grossCents / 100;
  const bands = [
    { upTo: 24000, rate: 0.10 },
    { upTo: 32333, rate: 0.25 },
    { upTo: 500000, rate: 0.30 },
    { upTo: 800000, rate: 0.325 },
    { upTo: Infinity, rate: 0.35 }
  ];
  let remaining = gross;
  let lowerBound = 0;
  let taxBeforeRelief = 0;
  for (const band of bands) {
    if (remaining <= 0) break;
    const bandWidth = band.upTo - lowerBound;
    const taxableInBand = Math.min(remaining, bandWidth);
    taxBeforeRelief += taxableInBand * band.rate;
    remaining -= taxableInBand;
    lowerBound = band.upTo;
  }
  const paye = Math.max(taxBeforeRelief - 2400, 0);
  const nssf = Math.min(gross, 36000) * 0.06;
  const shif = Math.max(gross * 0.0275, 300);
  const ahl = gross * 0.015;
  const net = gross - paye - nssf - shif - ahl;
  return { gross, paye, nssf, shif, ahl, net };
}

export function PayrollView() {
  const [activeTab, setActiveTab] = useState('Employees');
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [payPeriod, setPayPeriod] = useState(format(new Date(), 'MMMM yyyy'));
  const [payDate, setPayDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [runError, setRunError] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { currentOrgId } = useAppStore();
  const queryClient = useQueryClient();

  const { data: employeesData, isLoading } = useQuery({
    queryKey: ['employees', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/employees', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch employees');
      return res.json();
    }
  });

  const employees = employeesData?.employees || [];
  const activeEmployees = employees.filter((e: any) => (e.status || 'Active') === 'Active');

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ['payroll_runs', currentOrgId],
    queryFn: async () => {
      const res = await fetch('/api/payroll/runs', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch payroll runs');
      return res.json();
    }
  });

  const runs = runsData?.runs || [];
  const latestRun = runs[0] || null;
  const effectiveSelectedRunId = selectedRunId || latestRun?.id || null;

  const { data: payslipsData, isLoading: payslipsLoading } = useQuery({
    queryKey: ['payslips', effectiveSelectedRunId],
    queryFn: async () => {
      const res = await fetch(`/api/payroll/runs/${effectiveSelectedRunId}/payslips`, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch payslips');
      return res.json();
    },
    enabled: !!effectiveSelectedRunId
  });

  const payslips = payslipsData?.payslips || [];

  const runPayrollMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/payroll/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': currentOrgId },
        body: JSON.stringify({ period: payPeriod, payDate })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to process payroll');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll_runs', currentOrgId] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
      setRunError('');
    },
    onError: (err: any) => setRunError(err.message)
  });

  const handleExportStatutory = (type: 'PAYE' | 'NSSF' | 'SHIF') => {
    if (!payslips.length) return;
    const columnMap = {
      PAYE: (p: any) => ({ Employee: p.employeeName, 'Gross Pay': p.grossCents / 100, 'PAYE Deducted': p.payeCents / 100 }),
      NSSF: (p: any) => ({ Employee: p.employeeName, 'Pensionable Pay': p.grossCents / 100, 'NSSF Deducted': p.nssfCents / 100 }),
      SHIF: (p: any) => ({ Employee: p.employeeName, 'Gross Pay': p.grossCents / 100, 'SHIF Deducted': p.shifCents / 100 }),
    };
    const csv = Papa.unparse(payslips.map(columnMap[type]));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${type.toLowerCase()}_${latestRun?.period?.replace(/\s+/g, '_') || 'export'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Payroll & HR</h1>
        {activeTab === 'Employees' && (
          <button 
            onClick={() => setIsAddingEmployee(true)}
            className="bg-sidebar-bg text-sidebar-ink  px-4 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors"
          >
            Add Employee
          </button>
        )}
      </div>
      <div className="ledger-divider mb-6"></div>

      <div className="flex space-x-6 border-b border-ink-900/10 mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === tab 
                ? 'border-brass-500 text-ink-900' 
                : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-ink-900/20'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Employees' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">KRA PIN</th>
                <th className="px-4 py-3 font-semibold text-right">Base Salary (KES)</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading employees...</td></tr>
              ) : employees.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No employees found.</td></tr>
              ) : (
                employees.map((emp: any) => (
                  <tr 
                    key={emp.id} 
                    onClick={() => setSelectedEmployee(emp)}
                    className="hover:bg-paper-50 dark:hover:bg-ink-900/40 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium text-ink-900">{emp.firstName} {emp.lastName}</td>
                    <td className="px-4 py-3 text-slate-500">{emp.email || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono">{emp.kraPin || '-'}</td>
                    <td className="px-4 py-3 tabular-currency text-right text-ink-900 font-medium">
                      {formatCurrency(emp.baseSalaryCents)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-ledger-green-700/10 text-ledger-green-700">
                        {emp.status || 'Active'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'Run payroll' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8">
          <div className="flex items-center justify-between border-b border-ink-900/10 pb-6 mb-6 flex-wrap gap-4">
            <div className="flex items-end gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Period</label>
                <input
                  value={payPeriod}
                  onChange={(e) => setPayPeriod(e.target.value)}
                  placeholder="e.g., September 2026"
                  className="bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Pay Date</label>
                <input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                />
              </div>
            </div>
            <button
              onClick={() => { setRunError(''); runPayrollMutation.mutate(); }}
              disabled={runPayrollMutation.isPending || activeEmployees.length === 0}
              className="bg-sidebar-bg text-sidebar-ink px-4 py-2 text-sm font-medium rounded-sm hover:bg-sidebar-bg/90 transition-colors disabled:opacity-50"
            >
              {runPayrollMutation.isPending ? 'Processing...' : 'Process Payroll →'}
            </button>
          </div>

          {runError && (
            <div className="mb-4 p-3 bg-rust-700/10 border border-rust-700/20 text-rust-700 text-sm rounded-sm">
              {runError}
            </div>
          )}
          {runPayrollMutation.isSuccess && (
            <div className="mb-4 p-3 bg-ledger-green-700/10 border border-ledger-green-700/20 text-ledger-green-700 text-sm rounded-sm">
              Payroll processed and posted to the ledger. See the Payslips tab.
            </div>
          )}

          <p className="text-xs text-slate-400 mb-4">Preview below — actual figures are computed again on the server when you process the run.</p>

          <table className="w-full text-sm text-left">
            <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Employee</th>
                <th className="px-4 py-3 font-semibold text-right">Gross Pay</th>
                <th className="px-4 py-3 font-semibold text-right text-rust-700">PAYE</th>
                <th className="px-4 py-3 font-semibold text-right text-rust-700">NSSF</th>
                <th className="px-4 py-3 font-semibold text-right text-rust-700">SHIF</th>
                <th className="px-4 py-3 font-semibold text-right text-rust-700">AHL</th>
                <th className="px-4 py-3 font-semibold text-right">Net Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {activeEmployees.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Add active employees to run payroll.</td></tr>
              ) : (
                activeEmployees.map((emp: any) => {
                  const p = calculatePayslipPreview(emp.baseSalaryCents || 0);
                  return (
                    <tr key={emp.id} className="hover:bg-paper-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-ink-900">{emp.firstName} {emp.lastName}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-ink-900">{formatCurrencyFromFloat(p.gross)}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-rust-700">{formatCurrencyFromFloat(p.paye)}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-rust-700">{formatCurrencyFromFloat(p.nssf)}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-rust-700">{formatCurrencyFromFloat(p.shif)}</td>
                      <td className="px-4 py-3 tabular-currency text-right text-rust-700">{formatCurrencyFromFloat(p.ahl)}</td>
                      <td className="px-4 py-3 tabular-currency text-right font-semibold text-ledger-green-700">{formatCurrencyFromFloat(p.net)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'Payslips' && (
        <div className="space-y-4">
          {runsLoading ? (
            <div className="p-16 text-center text-slate-500 bg-paper-100 border border-ink-900/10 rounded-sm">Loading payroll runs...</div>
          ) : runs.length === 0 ? (
            <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto text-center">
              <h3 className="text-xl font-medium text-ink-900 mb-2">Employee Payslips</h3>
              <p className="text-slate-500 mb-6">Run a payroll cycle first to generate payslips.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pay Run</label>
                <select
                  value={effectiveSelectedRunId || ''}
                  onChange={(e) => setSelectedRunId(e.target.value)}
                  className="bg-paper-100 border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 focus:ring-1 focus:ring-focus-blue-500 outline-none"
                >
                  {runs.map((run: any) => (
                    <option key={run.id} value={run.id}>{run.period} — paid {format(new Date(run.payDate), 'MMM d, yyyy')}</option>
                  ))}
                </select>
              </div>
              <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-paper-100 border-b border-ink-900/10 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Employee</th>
                      <th className="px-4 py-3 font-semibold text-right">Gross</th>
                      <th className="px-4 py-3 font-semibold text-right">PAYE</th>
                      <th className="px-4 py-3 font-semibold text-right">NSSF</th>
                      <th className="px-4 py-3 font-semibold text-right">SHIF</th>
                      <th className="px-4 py-3 font-semibold text-right">AHL</th>
                      <th className="px-4 py-3 font-semibold text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-900/5">
                    {payslipsLoading ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading payslips...</td></tr>
                    ) : (
                      payslips.map((p: any) => (
                        <tr key={p.id} className="hover:bg-paper-50">
                          <td className="px-4 py-3 font-medium text-ink-900">{p.employeeName}</td>
                          <td className="px-4 py-3 tabular-currency text-right text-ink-900">{formatCurrency(p.grossCents)}</td>
                          <td className="px-4 py-3 tabular-currency text-right text-rust-700">{formatCurrency(p.payeCents)}</td>
                          <td className="px-4 py-3 tabular-currency text-right text-rust-700">{formatCurrency(p.nssfCents)}</td>
                          <td className="px-4 py-3 tabular-currency text-right text-rust-700">{formatCurrency(p.shifCents)}</td>
                          <td className="px-4 py-3 tabular-currency text-right text-rust-700">{formatCurrency(p.ahlCents)}</td>
                          <td className="px-4 py-3 tabular-currency text-right font-semibold text-ledger-green-700">{formatCurrency(p.netCents)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'Statutory filings (PAYE/NSSF/SHIF)' && (
        <div className="bg-paper-100 border border-ink-900/10 shadow-sm rounded-sm p-8 max-w-4xl mx-auto">
           <div className="text-center mb-6">
             <h3 className="text-xl font-medium text-ink-900 mb-2">Statutory Deductions Center</h3>
             <p className="text-slate-500">
               {latestRun ? `Based on the most recent payroll run: ${latestRun.period}` : 'Process a payroll run first to generate filing exports.'}
             </p>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
             <div className="border border-ink-900/10 p-4 rounded-sm hover:shadow transition-shadow">
               <h4 className="font-semibold text-ink-900">PAYE</h4>
               <p className="text-xs text-slate-500 mt-1 mb-4">Kenya Revenue Authority</p>
               <button
                 onClick={() => handleExportStatutory('PAYE')}
                 disabled={!latestRun}
                 className="text-sm font-medium text-focus-blue-500 w-full text-left disabled:opacity-40 disabled:cursor-not-allowed"
               >
                 Export CSV
               </button>
             </div>
             <div className="border border-ink-900/10 p-4 rounded-sm hover:shadow transition-shadow">
               <h4 className="font-semibold text-ink-900">NSSF</h4>
               <p className="text-xs text-slate-500 mt-1 mb-4">National Social Security</p>
               <button
                 onClick={() => handleExportStatutory('NSSF')}
                 disabled={!latestRun}
                 className="text-sm font-medium text-focus-blue-500 w-full text-left disabled:opacity-40 disabled:cursor-not-allowed"
               >
                 Export CSV
               </button>
             </div>
             <div className="border border-ink-900/10 p-4 rounded-sm hover:shadow transition-shadow">
               <h4 className="font-semibold text-ink-900">SHIF / NHIF</h4>
               <p className="text-xs text-slate-500 mt-1 mb-4">Social Health Authority</p>
               <button
                 onClick={() => handleExportStatutory('SHIF')}
                 disabled={!latestRun}
                 className="text-sm font-medium text-focus-blue-500 w-full text-left disabled:opacity-40 disabled:cursor-not-allowed"
               >
                 Export CSV
               </button>
             </div>
           </div>
        </div>
      )}

      {/* Dynamic Contextual Add Employee Modal */}
      <DynamicQuickAddModal
        isOpen={isAddingEmployee}
        onClose={() => setIsAddingEmployee(false)}
        overrideType="EMPLOYEE"
      />

      {/* Comprehensive Employee Drill-Down Overlay */}
      <EntityDrillDownModal
        isOpen={!!selectedEmployee}
        onClose={() => setSelectedEmployee(null)}
        entityType="EMPLOYEE"
        entityId={selectedEmployee?.id || null}
        initialData={selectedEmployee}
      />
    </div>
  );
}
