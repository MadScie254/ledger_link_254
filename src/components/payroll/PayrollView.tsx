import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { DynamicQuickAddModal } from '../common/DynamicQuickAddModal';
import { EntityDrillDownModal } from '../common/EntityDrillDownModal';
import { differenceInCalendarDays, format, isValid, parse } from 'date-fns';
import Papa from 'papaparse';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { PageHeading, IndexTabs, PageNote, SkeletonRows, EmptyNote, buttonClass } from '../ledger/Page';
import { payrollReturnsDue } from '../../utils/statutory';
import {
  calculatePayslip,
  findRateTable,
  isIsoCalendarDate,
  UNSUPPORTED_EMPLOYEE_ADJUSTMENTS,
  type PayslipBreakdown,
} from '../../utils/kenyaPayroll';

const tabs = ['Employees', 'Run payroll', 'Payslips', 'Statutory filings (PAYE/NSSF/SHIF)'];

type ReturnKey = 'PAYE' | 'NSSF' | 'SHIF' | 'AHL';
const STATUTORY_RETURNS: { key: ReturnKey; name: string; authority: string; field: 'payeCents' | 'nssfCents' | 'shifCents' | 'ahlCents' }[] = [
  { key: 'PAYE', name: 'PAYE', authority: 'Kenya Revenue Authority', field: 'payeCents' },
  { key: 'NSSF', name: 'NSSF', authority: 'National Social Security Fund', field: 'nssfCents' },
  { key: 'SHIF', name: 'SHIF', authority: 'Social Health Authority', field: 'shifCents' },
  { key: 'AHL', name: 'Housing Levy', authority: 'Kenya Revenue Authority', field: 'ahlCents' },
];

export function PayrollView() {
  const [activeTab, setActiveTab] = useState('Employees');
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [payPeriod, setPayPeriod] = useState(format(new Date(), 'MMMM yyyy'));
  const [payDate, setPayDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [runError, setRunError] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { currentOrgId, activeCompany } = useAppStore();
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
  const selectedRun = runs.find((r: any) => r.id === effectiveSelectedRunId) || latestRun;
  const slipTotal = (field: string) => payslips.reduce((sum: number, p: any) => sum + (p[field] || 0), 0);
  // Returns for a run fall due in the month after its period, not after today.
  const runMonth = (() => {
    const parsed = selectedRun?.period ? parse(selectedRun.period, 'MMMM yyyy', new Date()) : null;
    if (parsed && isValid(parsed)) return parsed;
    return selectedRun?.payDate ? new Date(selectedRun.payDate) : new Date();
  })();
  const returnsDue = payrollReturnsDue(runMonth);

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

  const handleExportStatutory = (type: ReturnKey) => {
    if (!payslips.length) return;
    const columnMap = {
      PAYE: (p: any) => ({ Employee: p.employeeName, 'Gross Pay': p.grossCents / 100, 'PAYE Deducted': p.payeCents / 100 }),
      NSSF: (p: any) => ({ Employee: p.employeeName, 'Pensionable Pay': p.grossCents / 100, 'NSSF Deducted': p.nssfCents / 100 }),
      SHIF: (p: any) => ({ Employee: p.employeeName, 'Gross Pay': p.grossCents / 100, 'SHIF Deducted': p.shifCents / 100 }),
      AHL: (p: any) => ({ Employee: p.employeeName, 'Gross Pay': p.grossCents / 100, 'Housing Levy Deducted': p.ahlCents / 100 }),
    };
    const csv = Papa.unparse(payslips.map(columnMap[type]));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${type.toLowerCase()}_${selectedRun?.period?.replace(/\s+/g, '_') || 'export'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const baseCurrency = activeCompany?.baseCurrency || 'KES';
  const previewRates = findRateTable(payDate);
  const preview = (() => {
    if (!isIsoCalendarDate(payDate)) {
      return { rows: [] as { emp: any; p: PayslipBreakdown }[], error: 'Choose a valid pay date to calculate this preview.' };
    }
    if (!previewRates) {
      return { rows: [] as { emp: any; p: PayslipBreakdown }[], error: `No statutory rate table is coded for ${payDate}.` };
    }

    try {
      return {
        rows: activeEmployees.map((emp: any) => ({
          emp,
          p: calculatePayslip(emp.baseSalaryCents ?? 0, payDate),
        })),
        error: '',
      };
    } catch (error) {
      return {
        rows: [] as { emp: any; p: PayslipBreakdown }[],
        error: error instanceof Error ? error.message : 'The payroll preview could not be calculated.',
      };
    }
  })();
  const runRows = preview.rows;
  const runTotals = runRows.reduce(
    (t: any, { p }: any) => ({
      gross: t.gross + p.grossCents,
      paye: t.paye + p.payeCents,
      nssf: t.nssf + p.nssfCents,
      shif: t.shif + p.shifCents,
      ahl: t.ahl + p.ahlCents,
      net: t.net + p.netCents,
    }),
    { gross: 0, paye: 0, nssf: 0, shif: 0, ahl: 0, net: 0 },
  );
  const salaryTotal = employees.reduce((sum: number, e: any) => sum + (e.baseSalaryCents || 0), 0);

  return (
    <div className="space-y-5">
      <PageHeading
        title="Payroll"
        note={<>Employees, pay runs and statutory deductions · Figures in {baseCurrency}</>}
        actions={
          activeTab === 'Employees' ? (
            <button type="button" onClick={() => setIsAddingEmployee(true)} className={buttonClass.primary}>Add employee</button>
          ) : activeTab === 'Run payroll' ? (
            <button
              type="button"
              onClick={() => { setRunError(''); runPayrollMutation.mutate(); }}
              disabled={runPayrollMutation.isPending || activeEmployees.length === 0 || !!preview.error}
              className={buttonClass.primary}
            >
              {runPayrollMutation.isPending ? 'Posting the run…' : 'Post this pay run'}
            </button>
          ) : null
        }
      />

      <IndexTabs
        label="Payroll"
        active={activeTab}
        onChange={setActiveTab}
        tabs={tabs.map((tab) => ({
          id: tab,
          name: tab === 'Run payroll' ? 'Pay run' : tab === 'Statutory filings (PAYE/NSSF/SHIF)' ? 'Statutory returns' : tab,
          count: tab === 'Employees' ? employees.length : undefined,
        }))}
      />

      {activeTab === 'Employees' && (
        isLoading ? (
          <div aria-busy="true" aria-label="Loading employees">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 border-b border-feint flex items-center gap-6">
                <div className="h-3 w-40 bg-paper-200" />
                <div className="h-3 flex-1 bg-paper-200" />
                <div className="h-3 w-24 bg-paper-200" />
              </div>
            ))}
          </div>
        ) : employees.length === 0 ? (
          <div className="py-6 max-w-xl text-[14px] text-graphite-600">
            <p>No employees yet. Each person on the payroll is listed here with their KRA PIN and basic salary.</p>
            <button type="button" onClick={() => setIsAddingEmployee(true)} className={`${buttonClass.quiet} mt-2`}>Add the first employee</button>
          </div>
        ) : (
          <>
            <ul className="sm:hidden" aria-label={`Employees, figures in ${baseCurrency}`}>
              {employees.map((emp: any) => (
                <li key={emp.id} className="border-b border-feint">
                  <button type="button" onClick={() => setSelectedEmployee(emp)} className="w-full py-3 text-left">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[14.5px] text-ink-900">{emp.firstName} {emp.lastName}</span>
                      <Amount cents={emp.baseSalaryCents || 0} currency={baseCurrency} className="shrink-0" />
                    </span>
                    <span className="mt-1 block text-[12.5px] text-graphite-600">
                      {[emp.kraPin && `PIN ${emp.kraPin}`, emp.status || 'Active'].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block relative overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">Employees and basic salaries, figures in {baseCurrency}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pr-4 text-left">Employee</th>
                    <th scope="col" className="pr-4 text-left">KRA PIN</th>
                    <th scope="col" className="pr-4 text-left">Email</th>
                    <th scope="col" className="pr-4 text-left">Standing</th>
                    <th scope="col" className="text-right">Basic salary, {baseCurrency}</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp: any) => (
                    <tr key={emp.id} onClick={() => setSelectedEmployee(emp)} className="cursor-pointer">
                      <td className="pr-4">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedEmployee(emp); }}
                          className="text-left text-ink-900 hover:underline underline-offset-[3px]"
                        >
                          {emp.firstName} {emp.lastName}
                        </button>
                      </td>
                      <td className="pr-4 whitespace-nowrap text-graphite-600">{emp.kraPin || '–'}</td>
                      <td className="pr-4 text-graphite-600">{emp.email || '–'}</td>
                      <td className="pr-4 text-graphite-600">{emp.status || 'Active'}</td>
                      <td className="text-right whitespace-nowrap"><Amount cents={emp.baseSalaryCents || 0} currency={baseCurrency} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={4} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">Monthly basic salaries, {employees.length} employees</th>
                    <td className="ll-total py-2 text-right whitespace-nowrap"><Amount cents={salaryTotal} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )
      )}

      {activeTab === 'Run payroll' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <label>
              <span className="block text-[13px] font-semibold text-ink-900">Period</span>
              <input
                value={payPeriod}
                onChange={(e) => setPayPeriod(e.target.value)}
                placeholder="September 2026"
                className="mt-1.5 h-9 px-3 text-[13.5px] border"
              />
            </label>
            <label>
              <span className="block text-[13px] font-semibold text-ink-900">Pay date</span>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1.5 h-9 px-3 text-[13.5px] border" />
            </label>
          </div>

          {runError && (
            <p role="alert" className="flex items-start gap-2 text-[13.5px] text-ledger-red">
              <Mark kind="circled" className="mt-0.5" />
              <span>{runError}</span>
            </p>
          )}
          {preview.error && (
            <p role="alert" className="flex items-start gap-2 text-[13.5px] text-ledger-red">
              <Mark kind="circled" className="mt-0.5" />
              <span>{preview.error}</span>
            </p>
          )}
          {runPayrollMutation.isSuccess && (
            <p role="status" className="flex items-start gap-2 text-[13.5px] text-ink-900">
              <Mark kind="tick" draw className="mt-0.5" />
              <span>Pay run for {payPeriod} posted to the ledger. Payslips are in the Payslips tab.</span>
            </p>
          )}

          <PageNote>
            {previewRates ? (
              <>
                Preview and posting use rate table <strong>{previewRates.version}</strong>, effective{' '}
                {format(parse(previewRates.effectiveFrom, 'yyyy-MM-dd', new Date()), 'd MMMM yyyy')}, selected from the pay date.
              </>
            ) : (
              <>Choose a supported pay date to select a statutory rate table.</>
            )}
          </PageNote>

          <p className="max-w-4xl text-[13px] leading-5 text-graphite-600">
            <Mark
              kind="query"
              label={`Not included yet: ${UNSUPPORTED_EMPLOYEE_ADJUSTMENTS.join(', ')}. Review affected employees before posting or filing.`}
            />
          </p>

          {runRows.length === 0 ? (
            <p className="py-6 text-[14px] text-graphite-600">No active employees. Add or reactivate employees to prepare a pay run.</p>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[46rem] text-[13.5px]">
                <caption className="sr-only">Pay run preview, figures in {baseCurrency}</caption>
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2} className="pr-4 text-left align-bottom">Employee</th>
                    <th scope="col" rowSpan={2} className="pr-4 text-right align-bottom">Gross</th>
                    <th scope="colgroup" colSpan={4} className="pr-4 text-center border-b border-feint">Deductions</th>
                    <th scope="col" rowSpan={2} className="text-right align-bottom">Net pay</th>
                  </tr>
                  <tr>
                    <th scope="col" className="pr-4 text-right">PAYE</th>
                    <th scope="col" className="pr-4 text-right">NSSF</th>
                    <th scope="col" className="pr-4 text-right">SHIF</th>
                    <th scope="col" className="pr-4 text-right">Housing Levy</th>
                  </tr>
                </thead>
                <tbody>
                  {runRows.map(({ emp, p }) => (
                    <tr key={emp.id}>
                      <td className="pr-4 text-ink-900">{emp.firstName} {emp.lastName}</td>
                      <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.grossCents} currency={baseCurrency} /></td>
                      <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.payeCents} currency={baseCurrency} /></td>
                      <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.nssfCents} currency={baseCurrency} /></td>
                      <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.shifCents} currency={baseCurrency} /></td>
                      <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.ahlCents} currency={baseCurrency} /></td>
                      <td className="text-right whitespace-nowrap"><Amount cents={p.netCents} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">Run totals</th>
                    <td className="ll-total py-2 pr-4 text-right whitespace-nowrap"><Amount cents={runTotals.gross} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                    <td className="ll-total py-2 pr-4 text-right whitespace-nowrap"><Amount cents={runTotals.paye} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                    <td className="ll-total py-2 pr-4 text-right whitespace-nowrap"><Amount cents={runTotals.nssf} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                    <td className="ll-total py-2 pr-4 text-right whitespace-nowrap"><Amount cents={runTotals.shif} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                    <td className="ll-total py-2 pr-4 text-right whitespace-nowrap"><Amount cents={runTotals.ahl} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                    <td className="ll-total py-2 text-right whitespace-nowrap"><Amount cents={runTotals.net} currency={baseCurrency} tone="ink" className="font-semibold" /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {(activeTab === 'Payslips' || activeTab === 'Statutory filings (PAYE/NSSF/SHIF)') &&
        (runsLoading ? (
          <SkeletonRows label="Loading pay runs" rows={4} />
        ) : runs.length === 0 ? (
          <EmptyNote
            action={
              <button type="button" onClick={() => setActiveTab('Run payroll')} className={buttonClass.quiet}>
                Run payroll
              </button>
            }
          >
            No pay run has been posted yet. Payslips and the PAYE, NSSF, SHIF and Housing Levy figures for filing come from a posted run.
          </EmptyNote>
        ) : (
          <div className="space-y-4">
            <label className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="text-[13px] font-semibold text-ink-900">Pay run</span>
              <select value={effectiveSelectedRunId || ''} onChange={(e) => setSelectedRunId(e.target.value)} className="h-9 border px-2.5 text-[14px] sm:w-80">
                {runs.map((run: any) => (
                  <option key={run.id} value={run.id}>
                    {run.period} · paid {format(new Date(run.payDate), 'dd/MM/yyyy')}
                  </option>
                ))}
              </select>
            </label>

            {payslipsLoading ? (
              <SkeletonRows label="Loading payslips" />
            ) : activeTab === 'Payslips' ? (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[44rem] text-[13.5px]">
                  <caption className="sr-only">Payslips for {selectedRun?.period}, figures in {baseCurrency}</caption>
                  <thead>
                    <tr>
                      <th scope="col" rowSpan={2} className="pr-4 text-left align-bottom">Employee</th>
                      <th scope="col" rowSpan={2} className="pr-4 text-right align-bottom">Gross</th>
                      <th scope="colgroup" colSpan={4} className="pr-4 text-center">Deductions</th>
                      <th scope="col" rowSpan={2} className="text-right align-bottom">Net pay</th>
                    </tr>
                    <tr>
                      <th scope="col" className="pr-4 text-right">PAYE</th>
                      <th scope="col" className="pr-4 text-right">NSSF</th>
                      <th scope="col" className="pr-4 text-right">SHIF</th>
                      <th scope="col" className="pr-4 text-right">Housing Levy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslips.map((p: any) => (
                      <tr key={p.id}>
                        <td className="pr-4 text-ink-900">{p.employeeName}</td>
                        <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.grossCents} currency={baseCurrency} tone="ink" /></td>
                        <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.payeCents} currency={baseCurrency} tone="ink" /></td>
                        <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.nssfCents} currency={baseCurrency} tone="ink" /></td>
                        <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.shifCents} currency={baseCurrency} tone="ink" /></td>
                        <td className="pr-4 text-right whitespace-nowrap"><Amount cents={p.ahlCents} currency={baseCurrency} tone="ink" /></td>
                        <td className="text-right whitespace-nowrap font-semibold"><Amount cents={p.netCents} currency={baseCurrency} tone="ink" /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">{payslips.length} payslips</th>
                      {(['grossCents', 'payeCents', 'nssfCents', 'shifCents', 'ahlCents'] as const).map((k) => (
                        <td key={k} className="ll-total py-2 pr-4 text-right whitespace-nowrap font-semibold"><Amount cents={slipTotal(k)} currency={baseCurrency} tone="ink" /></td>
                      ))}
                      <td className="ll-total py-2 text-right whitespace-nowrap font-semibold"><Amount cents={slipTotal('netCents')} currency={baseCurrency} tone="ink" /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="max-w-3xl">
                <p className="mb-3 text-[13.5px] text-graphite-600">
                  What {selectedRun?.period} owes each authority, with a CSV for the return. Filing itself is done on iTax, the NSSF portal and the SHA portal.
                </p>
                <p className="mb-3 text-[13px] text-ink-900">
                  <Mark
                    kind="query"
                    label={(() => {
                      const table = selectedRun?.payDate ? findRateTable(selectedRun.payDate) : null;
                      return table
                        ? `Recorded pay date maps to rate table ${table.version}, effective ${table.effectiveFrom}. Review employee-specific adjustments before filing.`
                        : 'This run has no supported rate-table match. Check the posted figures before filing.';
                    })()}
                  />
                </p>
                <ul className="border-t border-feint-strong">
                  {STATUTORY_RETURNS.map((r) => {
                    const due = r.key === 'AHL' ? returnsDue.levy : returnsDue.paye;
                    const late = differenceInCalendarDays(due, new Date()) < 0;
                    return (
                      <li key={r.key} className="grid grid-cols-1 gap-2 border-b border-feint py-3 sm:grid-cols-[minmax(0,1fr)_10rem_7rem] sm:items-baseline sm:gap-4">
                        <div>
                          <p className="text-[14.5px] font-semibold text-ink-900">{r.name}</p>
                          <p className="mt-0.5 text-[12.5px] text-graphite-600">
                            {r.authority}
                            {` · ${late ? 'was due' : 'due'} ${format(due, 'EEE d MMM yyyy')}`}
                          </p>
                        </div>
                        <div className="sm:text-right">
                          <Amount cents={slipTotal(r.field)} currency={baseCurrency} tone="ink" />
                        </div>
                        <div className="sm:text-right">
                          <button type="button" onClick={() => handleExportStatutory(r.key)} disabled={!payslips.length} className={buttonClass.quiet}>
                            Export CSV
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ))}

      <DynamicQuickAddModal isOpen={isAddingEmployee} onClose={() => setIsAddingEmployee(false)} overrideType="EMPLOYEE" />

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
