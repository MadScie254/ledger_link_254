import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import type { TreasurerReport } from '../../utils/churchReports';
import { Amount, figureText } from '../ledger/Amount';
import { EmptyNote, LoadProblem, PageHeading, SkeletonRows, buttonClass } from '../ledger/Page';
import { Mark } from '../ledger/Mark';
import { RestrictedNote } from './FundsView';
import { GIFT_METHODS, say, shortDate, useChurchOrg } from './churchData';

const COPY = {
  treasurer: say("Treasurer's report"),
  home: say('Giving and what is waiting, at a glance.'),
  noGiving: say('No giving recorded this month yet.'),
};

const monthName = (month: string) => new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${month}-01T00:00:00Z`));

type Report = TreasurerReport & { month: string; awaitingSecondCount: number };

/** The monthly report the treasurer reads to the church council. Printable, and exported to PDF. */
export function TreasurerReportView() {
  const { orgId, today, currency, companyName, kraPin } = useChurchOrg();
  const [month, setMonth] = useState(today.slice(0, 7));
  const report = useQuery({
    queryKey: ['treasurer-report', orgId, month],
    queryFn: () => apiRequest<Report>(`/api/church-reports/treasurer?month=${month}`, { fallback: "The treasurer's report could not be loaded." }),
  });
  const data = report.data;
  const exportPdf = () => {
    if (!data) return;
    const kes = (cents: number) => figureText(cents);
    const fundRows = (sections: Report['incomeByFund']) => sections.flatMap((section) => [
      [`${section.name}${section.restricted ? ' (restricted)' : ''}`, kes(section.totalCents)],
      ...section.accounts.map((account) => [`    ${account.code} ${account.name}`, kes(account.amountCents)]),
    ]);
    FinancialPDFEngine.exportFinancialStatement(
      { title: "Treasurer's report", period: monthName(month), companyName, kraPin, currency, filename: `treasurers-report-${month}.pdf` },
      [
        { title: 'Summary', headers: ['', currency], rows: [
          ['Opening balance of the funds', kes(data.openingCents)],
          ['Income', kes(data.incomeCents)],
          ['Expenses', kes(data.expenseCents)],
          ['Closing balance of the funds', kes(data.closingCents)],
        ] },
        { title: 'Income by fund and account', headers: ['Fund and account', currency], rows: fundRows(data.incomeByFund).length ? fundRows(data.incomeByFund) : [['No income this month', '']] },
        { title: 'Expenses by fund', headers: ['Fund and account', currency], rows: fundRows(data.expensesByFund).length ? fundRows(data.expensesByFund) : [['No expenses this month', '']] },
        { title: `Bank, cash and M-Pesa at ${shortDate(data.to)}`, headers: ['Account', currency], rows: [
          ...data.money.map((account) => [`${account.code} ${account.name}`, kes(account.balanceCents)]),
          ['Total', kes(data.moneyTotalCents)],
        ] },
        { title: 'Waiting', headers: ['', ''], rows: [
          ['M-Pesa receipts not yet placed', `${data.unmatchedCount} (${currency} ${kes(data.unmatchedCents)})`],
          ['Counted cash not yet banked', `${currency} ${kes(data.cashNotBankedCents)}`],
        ] },
      ],
    );
  };
  return (
    <div className="space-y-5 pb-16">
      <PageHeading title={COPY.treasurer.en} note={`${companyName} · ${monthName(month)} · Figures in ${currency}`}
        actions={
          <div className="flex flex-wrap items-end gap-2 no-print">
            <label className="text-[12.5px]">Month <input type="month" value={month} onChange={(e) => setMonth(e.target.value || today.slice(0, 7))} className="ml-1 h-9 border px-2" name="month" /></label>
            <button type="button" className={buttonClass.secondary} onClick={() => window.print()}>Print</button>
            <button type="button" className={buttonClass.primary} onClick={exportPdf} disabled={!data}>Export PDF</button>
          </div>
        } />
      {report.isError ? <LoadProblem what="the treasurer's report" path="/api/church-reports/treasurer" onRetry={() => report.refetch()} />
        : report.isLoading || !data ? <SkeletonRows label="Loading the treasurer's report" rows={10} /> : (
          <div className="max-w-3xl space-y-6 text-[13.5px]">
            <section aria-labelledby="tr-summary">
              <h2 id="tr-summary" className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">Summary</h2>
              {[
                ['Opening balance of the funds', data.openingCents, 'figure'],
                ['Income', data.incomeCents, 'figure'],
                ['Expenses', data.expenseCents, 'figure'],
                ['Closing balance of the funds', data.closingCents, 'result'],
              ].map(([label, cents, tone]) => (
                <div key={label as string} className="flex justify-between border-b border-feint py-2"><span>{label}</span><Amount cents={cents as number} currency={currency} tone={tone as any} /></div>
              ))}
            </section>
            {[['Income by fund and account', data.incomeByFund, 'No income this month.'], ['Expenses by fund', data.expensesByFund, 'No expenses this month.']].map(([title, sections, empty]) => (
              <section key={title as string} aria-label={title as string}>
                <h2 className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">{title as string}</h2>
                {(sections as Report['incomeByFund']).length === 0 ? <p className="py-2 text-graphite-600">{empty as string}</p>
                  : (sections as Report['incomeByFund']).map((section) => (
                    <div key={section.fundId} className="border-b border-feint py-2">
                      <div className="flex justify-between font-semibold text-ink-900"><span>{section.name}<RestrictedNote restricted={section.restricted} /></span><Amount cents={section.totalCents} currency={currency} tone="ink" /></div>
                      {section.accounts.map((account) => (
                        <div key={account.accountId} className="flex justify-between pl-4 text-graphite-600"><span>{account.code} {account.name}</span><Amount cents={account.amountCents} currency={currency} /></div>
                      ))}
                    </div>
                  ))}
              </section>
            ))}
            <section aria-labelledby="tr-money">
              <h2 id="tr-money" className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">Bank, cash and M-Pesa at {shortDate(data.to)}</h2>
              {data.money.map((account) => (
                <div key={account.accountId} className="flex justify-between border-b border-feint py-2"><span>{account.code} {account.name}</span><Amount cents={account.balanceCents} currency={currency} /></div>
              ))}
              <div className="flex justify-between py-2 font-semibold"><span>Total</span><Amount cents={data.moneyTotalCents} currency={currency} tone="ink" /></div>
            </section>
            <section aria-labelledby="tr-waiting">
              <h2 id="tr-waiting" className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">Waiting</h2>
              <p className="py-2">{data.unmatchedCount === 0 ? 'Every M-Pesa receipt has been placed.' : <>{data.unmatchedCount} M-Pesa {data.unmatchedCount === 1 ? 'receipt is' : 'receipts are'} not yet placed (<Amount cents={data.unmatchedCents} currency={currency} />). They are not in the income above.</>}</p>
              <p className="py-1">{data.cashNotBankedCents === 0 ? 'All counted cash has been banked.' : <>Counted cash not yet banked: <Amount cents={data.cashNotBankedCents} currency={currency} />.</>}
                {data.awaitingSecondCount > 0 && ` ${data.awaitingSecondCount} cash ${data.awaitingSecondCount === 1 ? 'count waits' : 'counts wait'} for a second counter and ${data.awaitingSecondCount === 1 ? 'is' : 'are'} not in the income above.`}</p>
            </section>
            <p className="text-[12px] text-graphite-600">Prepared from the books on {shortDate(today)}. Journal entries and the trial balance are in Full books.</p>
          </div>
        )}
    </div>
  );
}

/** The church Home: this Sunday's giving, the month so far by fund, the queue and cash not yet banked. */
export function ChurchHomeView() {
  const { orgId, currency, canPost } = useChurchOrg();
  const setActiveView = useAppStore((state) => state.setActiveView);
  const home = useQuery({
    queryKey: ['church-dashboard', orgId],
    queryFn: () => apiRequest<any>('/api/church/dashboard', { fallback: 'The church Home could not be loaded.' }),
  });
  const date = new Intl.DateTimeFormat('en-KE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi' }).format(new Date());
  if (home.isError) return <LoadProblem what="the church Home" path="/api/church/dashboard" onRetry={() => home.refetch()} />;
  const data = home.data;
  return (
    <div className="space-y-5">
      <PageHeading title={date} note={COPY.home.en} />
      {home.isLoading || !data ? <SkeletonRows label="Loading the church Home" rows={6} /> : (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="min-w-0 rounded-xl border border-border bg-surface p-5 shadow-sm"><dt className="text-[13px] font-medium text-text-2">Sunday {shortDate(data.sunday)}</dt><dd className="mt-3"><Amount cents={data.sundayGivingCents} currency={currency} size="lg" /></dd></div>
            <div className="min-w-0 rounded-xl border border-border bg-surface p-5 shadow-sm"><dt className="text-[13px] font-medium text-text-2">This month so far</dt><dd className="mt-3"><Amount cents={data.monthGivingCents} currency={currency} size="lg" /></dd></div>
            <div className="min-w-0 rounded-xl border border-border bg-surface p-5 shadow-sm"><dt className="text-[13px] font-medium text-text-2">M-Pesa queue</dt><dd className="mt-3 font-display text-[24px] font-bold leading-7 text-text">{data.unmatchedCount}</dd></div>
            <div className="min-w-0 rounded-xl border border-border bg-surface p-5 shadow-sm"><dt className="text-[13px] font-medium text-text-2">Cash not yet banked</dt><dd className="mt-3"><Amount cents={data.cashNotBankedCents} currency={currency} size="lg" /></dd></div>
          </dl>
          <div className="grid gap-8 lg:grid-cols-2">
            <section aria-labelledby="home-funds">
              <h2 id="home-funds" className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">Giving this month by fund</h2>
              {data.monthGivingCents === 0 ? <EmptyNote>{COPY.noGiving.en}</EmptyNote> : (
                <ul>
                  {data.monthByFund.filter((fund: any) => fund.givingCents > 0).map((fund: any) => (
                    <li key={fund.fundId} className="flex justify-between border-b border-feint py-2 text-[13.5px]"><span>{fund.name}<RestrictedNote restricted={fund.restricted} /></span><Amount cents={fund.givingCents} currency={currency} /></li>
                  ))}
                </ul>
              )}
              <button type="button" className={`${buttonClass.quiet} mt-2`} onClick={() => setActiveView('Church / Fund balances')}>Fund balances</button>
            </section>
            <section aria-labelledby="home-sunday" className="space-y-4">
              <div>
                <h2 id="home-sunday" className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">Sunday {shortDate(data.sunday)} by how it came</h2>
                {data.sundayGivingCents === 0 ? <p className="py-3 text-[13.5px] text-graphite-600">No giving recorded for that Sunday yet.</p> : (
                  <ul>
                    {Object.entries(data.sundayByMethod as Record<string, number>).map(([method, cents]) => (
                      <li key={method} className="flex justify-between border-b border-feint py-2 text-[13.5px]"><span>{GIFT_METHODS[method]?.en}</span><Amount cents={cents} currency={currency} /></li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h2 className="ll-heading border-b border-feint-strong pb-1 text-[17px] text-ink-900">Waiting</h2>
                <ul className="text-[13.5px]">
                  <li className="border-b border-feint py-2">{data.unmatchedCount === 0 ? <Mark kind="tick" label="Every M-Pesa receipt has been placed." />
                    : <>{data.unmatchedCount} M-Pesa {data.unmatchedCount === 1 ? 'receipt waits' : 'receipts wait'} in the queue (<Amount cents={data.unmatchedCents} currency={currency} />). {canPost && <button type="button" className={buttonClass.quiet} onClick={() => setActiveView('Church / Giving')}>Open the queue</button>}</>}</li>
                  <li className="border-b border-feint py-2">{data.awaitingSecondCount === 0 ? 'No cash count waits for a second counter.' : <>{data.awaitingSecondCount} cash {data.awaitingSecondCount === 1 ? 'count waits' : 'counts wait'} for a second counter. <button type="button" className={buttonClass.quiet} onClick={() => setActiveView('Church / Cash count')}>Cash count</button></>}</li>
                  <li className="border-b border-feint py-2">{data.cashNotBankedCents === 0 ? 'All counted cash is banked.' : <>Counted cash of <Amount cents={data.cashNotBankedCents} currency={currency} /> is not yet banked.</>}</li>
                </ul>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
