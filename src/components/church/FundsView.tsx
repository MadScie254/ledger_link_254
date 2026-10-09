import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { monthRange } from '../../utils/churchReports';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { Amount, figureText } from '../ledger/Amount';
import { EmptyNote, LoadProblem, PageHeading, SkeletonRows, buttonClass } from '../ledger/Page';
import { FundDialog, GivingRuleDialog } from './ChurchDialogs';
import { RULE_TYPES, refreshChurch, say, shortDate, useChurchOrg, useFunds } from './churchData';

const COPY = {
  funds: say('Funds'),
  addFund: say('Add a fund'),
  addRule: say('Add a giving rule'),
  noFunds: say('No funds yet.'),
  noRules: say('No giving rules. Every M-Pesa receipt will wait in the queue.'),
  fundBalances: say('Fund balances'),
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

function useFundBalances(from: string, to: string) {
  const { orgId } = useChurchOrg();
  return useQuery({
    queryKey: ['fund-balances', orgId, from, to],
    enabled: Boolean(from && to),
    queryFn: () => apiRequest<{ funds: FundRow[]; reconciliation: any }>(`/api/church-reports/fund-balances?from=${from}&to=${to}`, { fallback: 'Fund balances could not be loaded.' }),
  });
}

export function FundsView() {
  const { orgId, today, currency, canPost } = useChurchOrg();
  const queryClient = useQueryClient();
  const funds = useFunds();
  const year = { from: `${today.slice(0, 4)}-01-01`, to: today };
  const balances = useFundBalances(year.from, year.to);
  const rules = useQuery({ queryKey: ['giving-rules', orgId], queryFn: () => apiRequest<{ rules: any[] }>('/api/giving-rules', { fallback: 'The giving rules could not be loaded.' }) });
  const [dialog, setDialog] = useState<{ kind: 'fund'; fund?: any } | { kind: 'rule' } | null>(null);
  const [notice, setNotice] = useState('');
  const toggleRule = useMutation({
    mutationFn: (rule: any) => apiRequest(`/api/giving-rules/${rule.id}`, { method: 'PATCH', body: { isActive: !rule.is_active } }),
    onSuccess: (_result, rule) => { refreshChurch(queryClient, orgId); setNotice(rule.is_active ? 'Giving rule turned off.' : 'Giving rule turned on.'); },
  });
  const done = (message: string) => { setDialog(null); setNotice(message); };
  const balanceOf = new Map((balances.data?.funds || []).map((row) => [row.fundId, row]));
  return (
    <div className="space-y-6">
      <PageHeading title={COPY.funds.en} note="Every gift and every cost belongs to a fund. Money in a restricted fund is spent only on its purpose."
        actions={canPost && <button type="button" className={buttonClass.primary} onClick={() => setDialog({ kind: 'fund' })}>{COPY.addFund.en}</button>} />
      <Notice message={notice} />
      {funds.isError ? <LoadProblem what="the funds" path="/api/funds" onRetry={() => funds.refetch()} />
        : funds.isLoading ? <SkeletonRows label="Loading the funds" rows={4} />
          : (funds.data?.funds || []).length === 0 ? <EmptyNote>{COPY.noFunds.en}</EmptyNote> : (
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
          {canPost && <button type="button" className={buttonClass.quiet} onClick={() => setDialog({ kind: 'rule' })}>{COPY.addRule.en}</button>}
        </div>
        <p className="max-w-2xl text-[13px] text-graphite-600">How an M-Pesa account reference finds its fund. Tried from the lowest priority up; a receipt no rule fits waits in Giving, Queue.</p>
        {rules.isError ? <LoadProblem what="the giving rules" path="/api/giving-rules" onRetry={() => rules.refetch()} />
          : (rules.data?.rules || []).length === 0 ? <EmptyNote>{COPY.noRules.en}</EmptyNote> : (
            <ul>
              {(rules.data?.rules || []).map((rule) => (
                <li key={rule.id} className={`flex flex-wrap items-baseline justify-between gap-2 border-b border-feint py-2 text-[13.5px] ${rule.is_active ? '' : 'text-graphite-600'}`}>
                  <span><span className="ll-figure mr-2">{rule.priority}</span>{RULE_TYPES[rule.match_type]?.en}{rule.pattern ? ` "${rule.pattern}"` : ''}: {rule.funds?.name}
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
    </div>
  );
}

const kes = (cents: number) => figureText(cents);

/** Fund balances for a period, and the check that they come to the trial balance. */
export function FundBalancesView() {
  const { today, currency, companyName, kraPin } = useChurchOrg();
  const month = monthRange(today.slice(0, 7))!;
  const [from, setFrom] = useState(month.from);
  const [to, setTo] = useState(today);
  const balances = useFundBalances(from, to);
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
  return (
    <div className="space-y-5">
      <PageHeading title={COPY.fundBalances.en} note={`${companyName} · ${shortDate(from)} to ${shortDate(to)} · Figures in ${currency}`}
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
                    <th scope="row" className="py-2 pr-3 text-left font-normal">{row.name}<RestrictedNote restricted={row.restricted} /></th>
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
          </>
        )}
    </div>
  );
}
