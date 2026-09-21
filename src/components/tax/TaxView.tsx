import React, { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { statutoryDeadlines, dueIn } from '../../utils/statutory';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { Dialog } from '../ledger/Dialog';
import { PageHeading, IndexTabs, LoadProblem, buttonClass } from '../ledger/Page';

type Tab = 'VAT' | 'eTIMS' | 'Calendar';

export function TaxView() {
  const [activeTab, setActiveTab] = useState<Tab>('VAT');
  const [showEtimsNeeds, setShowEtimsNeeds] = useState(false);
  const { currentOrgId, setActiveView, activeCompany } = useAppStore();
  const baseCurrency = activeCompany?.baseCurrency || 'KES';

  const currentPeriod = new Date().toISOString().substring(0, 7);
  const summary = useQuery({
    queryKey: ['reports_tax_summary', currentOrgId, currentPeriod],
    queryFn: async () => {
      const res = await fetch(`/api/reports/tax-summary?period=${encodeURIComponent(currentPeriod)}`, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch tax summary');
      return res.json();
    },
  });

  const data = summary.data;
  const outputVat = data?.outputVat?.taxAmountCents ?? 0;
  const inputVat = data?.inputVat?.taxAmountCents ?? 0;
  const withheld = data?.withholdingTaxVat?.withheldAmountCents ?? 0;
  const netVat = data?.netVatPayableCents ?? outputVat - inputVat - withheld;
  const etimsVerified = data?.etimsVerifiedCount ?? 0;
  const etimsPending = data?.etimsPendingCount ?? 0;
  const kraPin = data?.kraPin || activeCompany?.taxId;
  const deadlines = statutoryDeadlines();
  const monthName = format(new Date(), 'MMMM yyyy');

  const sales = data?.outputVat?.standardRatedSalesCents ?? 0;
  const purchases = data?.inputVat?.claimablePurchasesCents ?? 0;
  const vatDue = deadlines.find((d) => d.id === 'vat');

  /** One ruled line of the VAT computation: particulars, the base it was worked on, the tax. */
  const vatLine = (label: string, basis: React.ReactNode, cents: number, sign: '' | 'Less') => (
    <tr>
      <td className="pr-4 text-ink-900">
        {sign && <span className="mr-1.5 text-graphite-600">{sign}</span>}
        {label}
      </td>
      <td className="hidden pr-4 text-[12.5px] text-graphite-600 sm:table-cell">{basis}</td>
      <td className="text-right whitespace-nowrap">
        {summary.isLoading ? <span className="inline-block h-4 w-24 bg-paper-200" aria-label="Loading" /> : <Amount cents={cents} currency={baseCurrency} tone="ink" />}
      </td>
    </tr>
  );

  return (
    <div className="space-y-5 pb-16">
      <PageHeading
        tourId="tax-overview"
        title="Tax"
        note={<>VAT position, eTIMS invoices and the filing calendar{kraPin ? ` · KRA PIN ${kraPin}` : ''}</>}
        actions={
          <button type="button" onClick={() => setActiveView('Reports')} className={buttonClass.secondary}>
            Open the VAT and eTIMS summary
          </button>
        }
      />

      <IndexTabs
        label="Tax"
        active={activeTab}
        onChange={(id) => setActiveTab(id as Tab)}
        tabs={[
          { id: 'VAT', name: 'VAT this month' },
          { id: 'eTIMS', name: 'eTIMS' },
          { id: 'Calendar', name: 'Filing calendar' },
        ]}
      />

      {activeTab === 'VAT' &&
        (summary.isError ? (
          <LoadProblem what="the VAT position" path="/api/reports/tax-summary" onRetry={() => summary.refetch()} />
        ) : (
          <div className="max-w-3xl">
            <table className="w-full text-[14px]">
              <caption className="sr-only">VAT for {monthName}, figures in {baseCurrency}</caption>
              <thead>
                <tr>
                  <th scope="col" className="pr-4 text-left">{monthName}</th>
                  <th scope="col" className="hidden pr-4 text-left sm:table-cell">Worked on</th>
                  <th scope="col" className="text-right">VAT</th>
                </tr>
              </thead>
              <tbody>
                {vatLine('Output VAT on sales', <>Standard-rated sales <Amount cents={sales} currency={baseCurrency} size="xs" tone="ink" /> at 16%</>, outputVat, '')}
                {vatLine('Input VAT on purchases', <>Claimable purchases <Amount cents={purchases} currency={baseCurrency} size="xs" tone="ink" /> at 16%</>, inputVat, 'Less')}
                {withheld !== 0 && vatLine('VAT withheld by customers', 'Withholding VAT at 2%', withheld, 'Less')}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">{netVat < 0 ? 'VAT to claim back' : 'Net VAT due'}</th>
                  <td className="ll-total hidden py-2 pr-4 text-[12.5px] font-normal text-graphite-600 sm:table-cell">
                    {vatDue ? `${vatDue.rule}, ${format(vatDue.due, 'EEE d MMM')}` : ''}
                  </td>
                  <td className="ll-total py-2 text-right whitespace-nowrap font-semibold">
                    <Amount cents={Math.abs(netVat)} currency={baseCurrency} size="lg" tone="ink" />
                  </td>
                </tr>
              </tfoot>
            </table>
            {vatDue && <p className="mt-2 text-[12.5px] text-graphite-600 sm:hidden">{vatDue.rule}, {format(vatDue.due, 'EEE d MMM')}</p>}
            {!kraPin && (
              <p className="mt-3 text-[13px]">
                <Mark kind="circled" label="No KRA PIN is recorded for this organization. Add it in Settings before filing." />
              </p>
            )}
          </div>
        ))}

      {activeTab === 'eTIMS' && (
        <div className="max-w-2xl space-y-4">
          <p className="text-[14px] leading-relaxed text-ink-900">
            Every invoice is logged and queued for eTIMS as it is issued. Submitting the queue to KRA needs your own OSCU or VSCU device registration against your PIN.
          </p>
          <div className="border-y border-feint-strong">
            <div className="flex items-baseline justify-between gap-4 border-b border-feint py-2.5 text-[13.5px]">
              <span className="text-ink-900">Invoices signed by eTIMS</span>
              <span className="ll-figure text-ink-900">{etimsVerified}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2.5 text-[13.5px]">
              <span className="text-ink-900">Invoices queued, not yet submitted</span>
              <span className="ll-figure text-ink-900">{etimsPending}</span>
            </div>
          </div>
          <p className="text-[13px]">
            {etimsVerified + etimsPending === 0 ? (
              <Mark kind="query" label="No device registration is connected, so nothing has been submitted." />
            ) : etimsPending > 0 ? (
              <Mark kind="query" label={`${etimsPending} invoices are waiting for a connected device.`} />
            ) : (
              <Mark kind="tick" label="Every invoice this period is signed." />
            )}
          </p>
          <button type="button" onClick={() => setShowEtimsNeeds(true)} className={buttonClass.quiet}>
            What connecting eTIMS needs
          </button>
        </div>
      )}

      {activeTab === 'Calendar' && (
        <ul className="max-w-2xl border-t border-feint-strong">
          {deadlines.map((d) => (
            <li key={d.id} className="border-b border-feint py-3">
              <div className="flex items-baseline justify-between gap-4 text-[14px]">
                <span className="flex items-center gap-2.5 text-ink-900">
                  <Mark kind="query" />
                  {d.label}
                </span>
                <span className="shrink-0 font-semibold text-ink-900">{format(d.due, 'EEE d MMM')}</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-4 pl-6 text-[12.5px] text-graphite-600">
                <span>{d.rule}</span>
                <span className="shrink-0">{dueIn(d.due)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={showEtimsNeeds}
        onClose={() => setShowEtimsNeeds(false)}
        title="Connecting eTIMS"
        footer={
          <button type="button" onClick={() => setShowEtimsNeeds(false)} className={buttonClass.primary}>
            Close
          </button>
        }
      >
        <div className="space-y-3 text-[14px] leading-relaxed text-ink-900">
          <p>
            Live submission needs a KRA-issued Type C OSCU or VSCU device registration and API credentials tied to your organization’s PIN. It cannot be switched on from inside Ledger Link; the registration is completed with KRA through iTax first.
          </p>
          <p className="text-graphite-600">
            Nothing is lost in the meantime. Invoices stay queued, and once credentials are added to the server configuration the queue can be submitted.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
