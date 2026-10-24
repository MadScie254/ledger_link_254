import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { budgetPeriodRange } from '../../utils/budgetPeriods';
import { monthRange } from '../../utils/churchReports';
import { centsFromAmountText } from '../../utils/salesOrders';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { Amount, figureText } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { EmptyNote, LoadProblem, PageHeading, SkeletonRows, buttonClass } from '../ledger/Page';
import { useAppStore } from '../../store';
import { FundDialog, GivingRuleDialog } from './ChurchDialogs';
import { RULE_TYPES, refreshChurch, say, shortDate, useChurchOrg, useFunds } from './churchData';
import { text } from '../../utils/language';

const COPY = {
  funds: say('Funds'),
  addFund: say('Add a fund'),
  addRule: say('Add a giving rule'),
  noFunds: say('No funds yet.'),
  noRules: say('No giving rules. Every M-Pesa receipt will wait in the queue.'),
  fundBalances: say('Fund balances'),
  fundBudgets: say('Fund budgets'),
  budgetYear: say('Budget year'),
  incomeTarget: say('Income target'),
  expenseLimit: say('Spending limit'),
  actualIncome: say('Income so far'),
  actualExpense: say('Spent so far'),
  remaining: say('Remaining'),
  editBudget: say('Set budget'),
  saveBudget: say('Save budget'),
  invalidAmount: say('Enter an amount with up to two decimal places.'),
};

function Notice({ message }: { message: string }) {
  return message ? <p role="status" className="text-[13.5px] text-ink-900">{message}</p> : null;
}

/** "Restricted" in words, never colour alone. */
export function RestrictedNote({ restricted }: { restricted: boolean }) {
  return restricted
    ? <span className="ml-2 border border-ink-900 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-900">Restricted</span>
    : <span className="ml-2 text-[12px] text-graphite-600">Unrestricted</span>;
}

interface FundRow {
  fundId: string; code: string; name: string; restricted: boolean; isActive: boolean;
  openingCents: number; incomeCents: number; expenseCents: number; closingCents: number;
}

interface FundDetail {
  fund: { id: string; code: string; name: string; restricted: boolean };
  from: string; to: string; openingCents: number; incomeCents: number; expenseCents: number; closingCents: number;
  incomeByAccount: Array<{ code: string; name: string; amountCents: number }>;
  expensesByAccount: Array<{ code: string; name: string; amountCents: number }>;
}

function useFundBalances(from: string, to: string) {
  const { orgId } = useChurchOrg();
  return useQuery({
    queryKey: ['fund-balances', orgId, from, to],
    enabled: Boolean(from && to),
    queryFn: () => apiRequest<{ funds: FundRow[]; reconciliation: any }>(`/api/church-reports/fund-balances?from=${from}&to=${to}`, { fallback: 'Fund balances could not be loaded.' }),
  });
}

export function FundsView() {
  const { orgId, today, currency, canPost, isAdmin } = useChurchOrg();
  const fiscalYearStart = useAppStore((state) => state.activeCompany?.fiscalYearStart);
  const queryClient = useQueryClient();
  const funds = useFunds();
  const year = { from: `${today.slice(0, 4)}-01-01`, to: today };
  const balances = useFundBalances(year.from, year.to);
  const [budgetYear, setBudgetYear] = useState(Number(budgetPeriodRange('YEARLY', today, fiscalYearStart).from.slice(0, 4)));
  const budgets = useQuery({ queryKey: ['fund-budgets', orgId, budgetYear],
    queryFn: () => apiRequest<{ periodStart: string; periodEnd: string; funds: Array<FundRow & {
      budgetId: string | null; incomeTargetCents: number; expenseLimitCents: number; expenseRemainingCents: number;
    }> }>(`/api/church/fund-budgets?year=${budgetYear}`, { fallback: 'Fund budgets could not be loaded.' }) });
  const rules = useQuery({ queryKey: ['giving-rules', orgId], queryFn: () => apiRequest<{ rules: any[] }>('/api/giving-rules', { fallback: 'The giving rules could not be loaded.' }) });
  const [dialog, setDialog] = useState<{ kind: 'fund'; fund?: any } | { kind: 'rule' } | { kind: 'budget'; fund: any; budget?: any } | null>(null);
  const [notice, setNotice] = useState('');
  const toggleRule = useMutation({
    mutationFn: (rule: any) => apiRequest(`/api/giving-rules/${rule.id}`, { method: 'PATCH', body: { isActive: !rule.is_active } }),
    onSuccess: (_result, rule) => { refreshChurch(queryClient, orgId); setNotice(rule.is_active ? 'Giving rule turned off.' : 'Giving rule turned on.'); },
  });
  const done = (message: string) => { setDialog(null); setNotice(message); };
  const balanceOf = new Map((balances.data?.funds || []).map((row) => [row.fundId, row]));
  return (
    <div className="space-y-6">
      <PageHeading title={text(COPY.funds)} note="Every gift and every cost belongs to a fund. Money in a restricted fund is spent only on its purpose."
        actions={canPost && <button type="button" className={buttonClass.primary} onClick={() => setDialog({ kind: 'fund' })}>{text(COPY.addFund)}</button>} />
      <Notice message={notice} />
      <section aria-labelledby="fund-budgets" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="fund-budgets" className="ll-heading text-[17px] text-ink-900">{text(COPY.fundBudgets)}</h2>
          <label className="text-[12.5px]">{text(COPY.budgetYear)}<input type="number" min="2000" max="2100" name="budget-year" value={budgetYear}
            onChange={(event) => setBudgetYear(Number(event.target.value) || budgetYear)} className="ml-2 h-9 w-24 rounded-lg border border-border px-2" /></label>
        </div>
        {budgets.isError ? <LoadProblem what="fund budgets" path="/api/church/fund-budgets" onRetry={() => budgets.refetch()} />
          : budgets.isLoading || !budgets.data ? <SkeletonRows label="Loading fund budgets" rows={4} /> : (
            <>
              <p className="text-[12.5px] text-text-3">{shortDate(budgets.data.periodStart)} to {shortDate(budgets.data.periodEnd)}</p>
              <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-[13.5px]">
                <caption className="sr-only">{text(COPY.fundBudgets)}</caption>
                <thead><tr><th scope="col" className="text-left">Fund</th><th scope="col" className="text-right">{text(COPY.incomeTarget)}</th>
                  <th scope="col" className="text-right">{text(COPY.actualIncome)}</th><th scope="col" className="text-right">{text(COPY.expenseLimit)}</th>
                  <th scope="col" className="text-right">{text(COPY.actualExpense)}</th><th scope="col" className="text-right">{text(COPY.remaining)}</th><th scope="col" className="sr-only">Actions</th></tr></thead>
                <tbody>{budgets.data.funds.map((row) => <tr key={row.fundId} className="border-b border-border">
                  <td className="py-2">{row.name}<RestrictedNote restricted={row.restricted} /></td>
                  <td className="py-2 text-right">{row.budgetId ? <Amount cents={row.incomeTargetCents} currency={currency} /> : 'Not set'}</td>
                  <td className="py-2 text-right"><Amount cents={row.incomeCents} currency={currency} /></td>
                  <td className="py-2 text-right">{row.budgetId ? <Amount cents={row.expenseLimitCents} currency={currency} /> : 'Not set'}</td>
                  <td className="py-2 text-right"><Amount cents={row.expenseCents} currency={currency} /></td>
                  <td className="py-2 text-right">{row.budgetId ? <Amount cents={row.expenseRemainingCents} currency={currency} /> : '—'}</td>
                  <td className="py-2 text-right">{isAdmin && row.isActive && <button type="button" className={buttonClass.quiet}
                    onClick={() => setDialog({ kind: 'budget', fund: row, budget: row })}>{text(COPY.editBudget)}</button>}</td>
                </tr>)}</tbody>
              </table></div>
            </>
          )}
      </section>
      {funds.isError ? <LoadProblem what="the funds" path="/api/funds" onRetry={() => funds.refetch()} />
        : funds.isLoading ? <SkeletonRows label="Loading the funds" rows={4} />
          : (funds.data?.funds || []).length === 0 ? <EmptyNote>{text(COPY.noFunds)}</EmptyNote> : (
            <table className="w-full text-[13.5px]">
              <caption className="sr-only">Funds, balances since {shortDate(year.from)}</caption>
              <thead>
                <tr>
                  <th scope="col" className="pr-3 text-left">Fund</th>
                  <th scope="col" className="hidden pr-3 text-left sm:table-cell">Income account</th>
                  <th scope="col" className="pr-3 text-right">Given this year</th>
                  <th scope="col" className="pr-3 text-right">Spent this year</th>
                  <th scope="col" className="pr-3 text-right">Balance</th>
                  <th scope="col" className="text-left"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {(funds.data?.funds || []).map((fund) => {
                  const row = balanceOf.get(fund.id);
                  return (
                    <tr key={fund.id}>
                      <td className="py-2 pr-3">{fund.name}<RestrictedNote restricted={fund.restricted} />
                        {!fund.is_active && <span className="block text-[12px] text-graphite-600">Closed to new giving</span>}</td>
                      <td className="hidden py-2 pr-3 sm:table-cell">{fund.accounts ? `${fund.accounts.code} · ${fund.accounts.name}` : ''}</td>
                      <td className="py-2 pr-3 text-right"><Amount cents={row?.incomeCents || 0} currency={currency} /></td>
                      <td className="py-2 pr-3 text-right"><Amount cents={row?.expenseCents || 0} currency={currency} /></td>
                      <td className="py-2 pr-3 text-right"><Amount cents={row?.closingCents || 0} currency={currency} tone="result" /></td>
                      <td className="py-2">{canPost && <button type="button" className={buttonClass.quiet} onClick={() => setDialog({ kind: 'fund', fund })}>Edit</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      <section aria-labelledby="giving-rules" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-feint-strong pb-1">
          <h2 id="giving-rules" className="ll-heading text-[17px] text-ink-900">Giving rules for M-Pesa</h2>
          {canPost && <button type="button" className={buttonClass.quiet} onClick={() => setDialog({ kind: 'rule' })}>{text(COPY.addRule)}</button>}
        </div>
        <p className="max-w-2xl text-[13px] text-graphite-600">How an M-Pesa account reference finds its fund. Tried from the lowest priority up; a receipt no rule fits waits in Giving, Queue.</p>
        {rules.isError ? <LoadProblem what="the giving rules" path="/api/giving-rules" onRetry={() => rules.refetch()} />
          : (rules.data?.rules || []).length === 0 ? <EmptyNote>{text(COPY.noRules)}</EmptyNote> : (
            <ul>
              {(rules.data?.rules || []).map((rule) => (
                <li key={rule.id} className={`flex flex-wrap items-baseline justify-between gap-2 border-b border-feint py-2 text-[13.5px] ${rule.is_active ? '' : 'text-graphite-600'}`}>
                  <span><span className="ll-figure mr-2">{rule.priority}</span>{text(RULE_TYPES[rule.match_type])}{rule.pattern ? ` "${rule.pattern}"` : ''}: {rule.funds?.name}
                    {rule.accounts && <span className="text-graphite-600"> via {rule.accounts.code} {rule.accounts.name}</span>}
                    {!rule.is_active && <span className="ml-2">(off)</span>}</span>
                  {canPost && <button type="button" className={buttonClass.quiet} disabled={toggleRule.isPending} onClick={() => toggleRule.mutate(rule)}>{rule.is_active ? 'Turn off' : 'Turn on'}</button>}
                </li>
              ))}
            </ul>
          )}
      </section>
      {dialog?.kind === 'fund' && <FundDialog fund={dialog.fund} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'rule' && <GivingRuleDialog onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'budget' && <FundBudgetDialog fund={dialog.fund} budget={dialog.budget} year={budgetYear}
        onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

function FundBudgetDialog({ fund, budget, year, onClose, onDone }: { fund: any; budget?: any; year: number; onClose: () => void; onDone: (message: string) => void }) {
  const { orgId, currency } = useChurchOrg();
  const queryClient = useQueryClient();
  const [income, setIncome] = useState(((budget?.incomeTargetCents || 0) / 100).toFixed(2));
  const [expense, setExpense] = useState(((budget?.expenseLimitCents || 0) / 100).toFixed(2));
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (body: { year: number; incomeTargetCents: number; expenseLimitCents: number }) => apiRequest(`/api/church/fund-budgets/${fund.fundId}`, { method: 'PUT', body }),
    onSuccess: () => { refreshChurch(queryClient, orgId); onDone(`Fund budget for ${fund.name} saved.`); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The fund budget could not be saved.'),
  });
  return <Dialog open onClose={onClose} title={`${fund.name} · ${year}`} note={`Plan for this fund in ${currency}. No journal entry is posted.`}
    footer={<><button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
      <button type="submit" form="fund-budget-form" className={buttonClass.primary} disabled={save.isPending}>{text(COPY.saveBudget)}</button></>}>
    <form id="fund-budget-form" className="space-y-4" onSubmit={(event) => {
      event.preventDefault();
      const incomeTargetCents = centsFromAmountText(income);
      const expenseLimitCents = centsFromAmountText(expense);
      if (incomeTargetCents === null || expenseLimitCents === null) { setError(text(COPY.invalidAmount)); return; }
      setError(''); save.mutate({ year, incomeTargetCents, expenseLimitCents });
    }}>
      <Field label={`${text(COPY.incomeTarget)} (${currency})`}><input required inputMode="decimal" value={income} onChange={(event) => setIncome(event.target.value)} name="income-target" /></Field>
      <Field label={`${text(COPY.expenseLimit)} (${currency})`}><input required inputMode="decimal" value={expense} onChange={(event) => setExpense(event.target.value)} name="expense-limit" /></Field>
      {error && <p role="alert" className="text-[13px] text-negative">{error}</p>}
    </form>
  </Dialog>;
}

const kes = (cents: number) => figureText(cents);

/** Fund balances for a period, and the check that they come to the trial balance. */
export function FundBalancesView() {
  const { orgId, today, currency, companyName, kraPin } = useChurchOrg();
  const month = monthRange(today.slice(0, 7))!;
  const [from, setFrom] = useState(month.from);
  const [to, setTo] = useState(today);
  const [selectedFundId, setSelectedFundId] = useState<string | null>(null);
  const balances = useFundBalances(from, to);
  const detail = useQuery({ queryKey: ['fund-detail', orgId, selectedFundId, from, to], enabled: Boolean(selectedFundId && from && to && from <= to),
    queryFn: () => apiRequest<FundDetail>(`/api/church-reports/funds/${selectedFundId}?from=${from}&to=${to}`,
      { fallback: 'The fund report could not be loaded.' }) });
  const rows = balances.data?.funds || [];
  const check = balances.data?.reconciliation;
  const total = (key: keyof FundRow) => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  const exportPdf = () => FinancialPDFEngine.exportFinancialStatement(
    { title: 'Fund balances', period: `${shortDate(from)} to ${shortDate(to)}`, companyName, kraPin, currency, filename: `fund-balances-${from}-${to}.pdf` },
    [{
      headers: ['Fund', 'Opening', 'Income', 'Expenses', 'Closing'],
      rows: [
        ...rows.map((row) => [`${row.name}${row.restricted ? ' (restricted)' : ''}`, kes(row.openingCents), kes(row.incomeCents), kes(row.expenseCents), kes(row.closingCents)]),
        ['Total', kes(total('openingCents')), kes(total('incomeCents')), kes(total('expenseCents')), kes(total('closingCents'))],
      ],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
    }],
  );
  const exportFundPdf = () => {
    const data = detail.data;
    if (!data) return;
    FinancialPDFEngine.exportFinancialStatement(
      { title: `${data.fund.name} fund report`, period: `${shortDate(from)} to ${shortDate(to)}`,
        companyName, kraPin, currency, filename: `fund-report-${data.fund.code}-${from}-${to}.pdf` },
      [
        { title: 'Fund movement', headers: ['Measure', currency], rows: [
          ['Opening', kes(data.openingCents)], ['Income', kes(data.incomeCents)],
          ['Expenses', kes(data.expenseCents)], ['Closing', kes(data.closingCents)],
        ] },
        { title: 'Income by account', headers: ['Account', currency], rows: data.incomeByAccount.length
          ? data.incomeByAccount.map((row) => [`${row.code} ${row.name}`, kes(row.amountCents)]) : [['No income in this period', '']] },
        { title: 'Expenses by account', headers: ['Account', currency], rows: data.expensesByAccount.length
          ? data.expensesByAccount.map((row) => [`${row.code} ${row.name}`, kes(row.amountCents)]) : [['No expenses in this period', '']] },
      ],
    );
  };
  return (
    <div className="space-y-5">
      <PageHeading title={text(COPY.fundBalances)} note={`${companyName} · ${shortDate(from)} to ${shortDate(to)} · Figures in ${currency}`}
        actions={
          <div className="flex flex-wrap items-end gap-2 no-print">
            <label className="text-[12.5px]">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ml-1 h-9 border px-2" name="from" /></label>
            <label className="text-[12.5px]">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ml-1 h-9 border px-2" name="to" /></label>
            <button type="button" className={buttonClass.secondary} onClick={() => window.print()}>Print</button>
            <button type="button" className={buttonClass.primary} onClick={exportPdf} disabled={!rows.length}>Export PDF</button>
          </div>
        } />
      {balances.isError ? <LoadProblem what="fund balances" path="/api/church-reports/fund-balances" onRetry={() => balances.refetch()} />
        : balances.isLoading ? <SkeletonRows label="Loading fund balances" rows={5} /> : (
          <>
            <table className="w-full max-w-4xl text-[13.5px]">
              <caption className="sr-only">Fund balances</caption>
              <thead>
                <tr>
                  <th scope="col" className="pr-3 text-left">Fund</th>
                  <th scope="col" className="pr-3 text-right">Opening</th>
                  <th scope="col" className="pr-3 text-right">Income</th>
                  <th scope="col" className="pr-3 text-right">Expenses</th>
                  <th scope="col" className="text-right">Closing</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.fundId}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal">{row.name}<RestrictedNote restricted={row.restricted} />
                      <button type="button" className={buttonClass.quiet} onClick={() => setSelectedFundId(row.fundId)}
                        aria-label={`${text(say('View fund report'))} for ${row.name}`}>{text(say('View report'))}</button></th>
                    <td className="py-2 pr-3 text-right"><Amount cents={row.openingCents} currency={currency} /></td>
                    <td className="py-2 pr-3 text-right"><Amount cents={row.incomeCents} currency={currency} /></td>
                    <td className="py-2 pr-3 text-right"><Amount cents={row.expenseCents} currency={currency} /></td>
                    <td className="py-2 text-right"><Amount cents={row.closingCents} currency={currency} tone="result" /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-900">
                  <th scope="row" className="pt-2 text-left">Total</th>
                  <td className="pt-2 pr-3 text-right"><Amount cents={total('openingCents')} currency={currency} tone="ink" /></td>
                  <td className="pt-2 pr-3 text-right"><Amount cents={total('incomeCents')} currency={currency} tone="ink" /></td>
                  <td className="pt-2 pr-3 text-right"><Amount cents={total('expenseCents')} currency={currency} tone="ink" /></td>
                  <td className="pt-2 text-right"><Amount cents={total('closingCents')} currency={currency} tone="ink" /></td>
                </tr>
              </tfoot>
            </table>
            {check && (
              <section aria-labelledby="fund-check" className="max-w-3xl border-t border-feint-strong pt-3 text-[13.5px]">
                <h2 id="fund-check" className="ll-heading text-[17px] text-ink-900">Against the trial balance</h2>
                {check.reconciles ? (
                  <p className="mt-1 text-ink-900">The funds come to the ledger: closing funds of <Amount cents={check.fundsClosingCents} currency={currency} /> equal income less expenses in the trial balance to {shortDate(to)}, and the period's movement agrees.</p>
                ) : (
                  <p role="alert" className="mt-1 text-ledger-red">The funds differ from the ledger by <Amount cents={check.closingDifferenceCents} currency={currency} /> to {shortDate(to)} and by <Amount cents={check.periodDifferenceCents} currency={currency} /> for the period. Check Full books, Accounting.</p>
                )}
              </section>
            )}
            {selectedFundId && <section aria-label="Fund project report" className="max-w-4xl space-y-3 rounded-xl border border-border bg-surface p-4">
              {detail.isError ? <LoadProblem what="the fund report" path="/api/church-reports/funds" onRetry={() => detail.refetch()} />
                : detail.isLoading || !detail.data ? <SkeletonRows label="Loading the fund report" rows={4} /> : <>
                  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{detail.data.fund.name} · {text(say('Fund project report'))}</h2>
                    <button type="button" className={buttonClass.secondary} onClick={exportFundPdf}>{text(say('Export fund PDF'))}</button></div>
                  <p className="text-[13px] text-text-2">{text(say('Posted income and expenses by account for the selected period.'))}</p>
                  {([['Income', detail.data.incomeByAccount], ['Expenses', detail.data.expensesByAccount]] as const).map(([title, accountRows]) =>
                    <div key={title}><h3 className="text-[13px] font-semibold">{title}</h3>
                      {accountRows.length === 0 ? <p className="text-[13px] text-text-2">{text(say('No posted entries in this period.'))}</p>
                        : accountRows.map((account) => <div key={account.code} className="flex justify-between border-b border-border py-1 text-[13px]">
                          <span>{account.code} {account.name}</span><Amount cents={account.amountCents} currency={currency} /></div>)}</div>)}
                </>}
            </section>}
          </>
        )}
    </div>
  );
}
