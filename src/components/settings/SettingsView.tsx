import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { useAppStore, OrganizationData } from '../../store';
import { SUPPORTED_CURRENCIES, refreshLiveRates } from '../../utils/currency';
import { Mark } from '../ledger/Mark';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { PageHeading, IndexTabs, EmptyNote, buttonClass } from '../ledger/Page';
import { BookOpen } from 'lucide-react';
import { useOnboarding } from '../onboarding/OnboardingProvider';

type Tab = 'companies' | 'currencies' | 'accounting' | 'security';

const POSTING_ACCOUNTS = [
  { code: '1100', name: 'Accounts receivable', use: 'Every invoice posts its amount owed here' },
  { code: '2000', name: 'Accounts payable', use: 'Every bill posts its amount owed here' },
  { code: '8000', name: 'Unrealized FX gain or loss', use: 'Open foreign invoices and bills revalued at today’s rate' },
  { code: '8100', name: 'Realized FX gain or loss', use: 'The difference when a foreign invoice or bill is settled' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const looksLikeId = (s?: string) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s);

export function SettingsView() {
  const { currentOrgId, setCurrentOrgId, organizations, setOrganizations, activeCompany, setActiveCompany, setDisplayCurrency, exchangeRates, setExchangeRates, rateMetadata } = useAppStore();

  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('companies');
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrganizationData | null>(null);
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [rateFeedback, setRateFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [customRateCurrency, setCustomRateCurrency] = useState('');
  const [customRateValue, setCustomRateValue] = useState('');
  const [exportProblem, setExportProblem] = useState('');
  const base = activeCompany?.baseCurrency || 'KES';
  const { restartTutorial, isReady: isOnboardingReady } = useOnboarding();

  const { data: orgsData, refetch: refetchOrgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const res = await fetch('/api/organizations');
      if (!res.ok) throw new Error('Failed to fetch organizations');
      const json = await res.json();
      return json.organizations as OrganizationData[];
    },
  });

  React.useEffect(() => {
    if (orgsData && orgsData.length > 0) {
      setOrganizations(orgsData);
      const current = orgsData.find((o) => o.id === currentOrgId) || orgsData[0];
      if (current && (!activeCompany || activeCompany.id !== current.id)) {
        setActiveCompany(current);
      }
    }
  }, [orgsData, currentOrgId, activeCompany, setOrganizations, setActiveCompany]);

  const { data: unrealizedFXData, refetch: refetchFX } = useQuery({
    queryKey: ['unrealized-fx', currentOrgId, activeCompany?.baseCurrency],
    queryFn: async () => {
      const res = await fetch(`/api/currency/unrealized-fx?base=${encodeURIComponent(base)}`, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const handleSwitchCompany = (org: OrganizationData) => {
    setActiveCompany(org);
    setCurrentOrgId(org.id);
    setDisplayCurrency(org.baseCurrency);
    queryClient.invalidateQueries();
  };

  const handleRefreshMarketRates = async () => {
    setIsRefreshingRates(true);
    setRateFeedback(null);
    try {
      await refreshLiveRates(base);
      setRateFeedback({ ok: true, text: `Rates fetched against ${base}.` });
      refetchFX();
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    } catch (err: any) {
      setRateFeedback({ ok: false, text: `Rates could not be fetched: ${err.message}` });
    } finally {
      setIsRefreshingRates(false);
    }
  };

  const handleSetCustomRate = (e: React.FormEvent) => {
    e.preventDefault();
    const rateNum = parseFloat(customRateValue);
    if (!customRateCurrency || isNaN(rateNum) || rateNum <= 0) return;
    const code = customRateCurrency.toUpperCase();
    setExchangeRates({ ...exchangeRates, [code]: rateNum });
    setCustomRateCurrency('');
    setCustomRateValue('');
    setRateFeedback({ ok: true, text: `1 ${code} now counts as ${(1 / rateNum).toFixed(2)} ${base} in this browser until rates are fetched again.` });
  };

  const exportLedger = async () => {
    setExportProblem('');
    try {
      const res = await fetch('/api/journal-entries', { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) throw new Error('Failed to fetch journal entries');
      const { entries } = await res.json();
      const rows = (entries || []).flatMap((entry: any) =>
        (entry.lines || []).map((line: any) => ({
          Date: entry.entryDate,
          Memo: entry.memo || '',
          Source: entry.sourceType,
          Reference: entry.referenceNo || '',
          AccountId: line.accountId,
          Debit: (line.debit || 0) / 100,
          Credit: (line.credit || 0) / 100,
        })),
      );
      if (rows.length === 0) {
        setExportProblem('There are no posted journal entries to export yet.');
        return;
      }
      const url = URL.createObjectURL(new Blob([Papa.unparse(rows)], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `general_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      setExportProblem('The general ledger could not be exported. Check the connection and try again.');
    }
  };

  const rateText = (rate: number) => (rate < 1 ? `1 / ${(1 / rate).toFixed(2)}` : rate.toFixed(4));
  const fxItems: any[] = unrealizedFXData?.items || [];

  return (
    <div className="space-y-5 pb-16">
      <PageHeading
        title="Settings"
        note="Companies, currencies, the accounts postings use, and security"
        actions={
          activeTab === 'companies' && (
            <button
              type="button"
              onClick={() => {
                setEditingOrg(null);
                setIsCompanyModalOpen(true);
              }}
              className={buttonClass.primary}
            >
              Add a company
            </button>
          )
        }
      />

      <IndexTabs
        label="Settings"
        active={activeTab}
        onChange={(id) => setActiveTab(id as Tab)}
        tabs={[
          { id: 'companies', name: 'Companies', count: organizations.length },
          { id: 'currencies', name: 'Currencies' },
          { id: 'accounting', name: 'Posting accounts' },
          { id: 'security', name: 'Security and export' },
        ]}
      />

      {activeTab === 'companies' && (
        <div className="space-y-3">
          <p className="max-w-2xl text-[13.5px] text-graphite-600">
            Each company keeps its own books. Opening another company changes the records, chart of accounts and reports throughout Ledger Link.
          </p>
          {organizations.length === 0 ? (
            <EmptyNote>No companies yet.</EmptyNote>
          ) : (
            <ul className="border-t border-feint-strong">
              {organizations.map((org) => {
                const isActive = activeCompany?.id === org.id || currentOrgId === org.id;
                return (
                  <li key={org.id} className="border-b border-feint py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-ink-900">{org.name}</p>
                        {org.legalName && org.legalName !== org.name && <p className="mt-0.5 text-[13px] text-graphite-600">{org.legalName}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingOrg(org);
                            setIsCompanyModalOpen(true);
                          }}
                          className={buttonClass.quiet}
                        >
                          Edit details
                        </button>
                        {isActive ? (
                          <Mark kind="tick" label="Open now" />
                        ) : (
                          <button type="button" onClick={() => handleSwitchCompany(org)} className={buttonClass.secondary}>
                            Open these books
                          </button>
                        )}
                      </div>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
                      {[
                        ['Base currency', org.baseCurrency],
                        ['KRA PIN', org.taxId || 'Not recorded'],
                        ['Country', org.country || '–'],
                        ['Year starts', org.fiscalYearStart || 'January'],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt className="ll-printed text-[10.5px] text-graphite-600">{k}</dt>
                          <dd className={`mt-0.5 ${v === 'Not recorded' ? 'text-graphite-600' : 'text-ink-900'}`}>{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {org.address && (
                      <p className="mt-2 truncate text-[12.5px] text-graphite-600">
                        {org.address}
                        {org.city ? `, ${org.city}` : ''}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'currencies' && (
        <div className="space-y-8">
          <section aria-labelledby="rates-heading" className="max-w-3xl">
            <div className="flex flex-col gap-3 border-b-2 border-ink-900 pb-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="rates-heading" className="ll-heading text-[20px] text-ink-900">Exchange rates</h2>
                <p className="mt-1 text-[13px] text-graphite-600">
                  Fetched from open.er-api.com when Ledger Link opens.{' '}
                  {rateMetadata?.lastUpdated ? `Last fetched at ${rateMetadata.lastUpdated}.` : 'Not fetched in this session yet; the figures below are stored defaults.'}
                </p>
              </div>
              <button type="button" onClick={handleRefreshMarketRates} disabled={isRefreshingRates} className={buttonClass.secondary}>
                {isRefreshingRates ? 'Fetching rates' : 'Fetch rates now'}
              </button>
            </div>

            {rateFeedback && (
              <p role="status" className={`mt-3 text-[13px] ${rateFeedback.ok ? '' : 'text-ledger-red'}`}>
                {rateFeedback.ok ? <Mark kind="tick" label={rateFeedback.text} /> : rateFeedback.text}
              </p>
            )}

            <table className="mt-2 w-full text-[13.5px]">
              <caption className="sr-only">Exchange rates against {base}</caption>
              <thead>
                <tr>
                  <th scope="col" className="pr-4 text-left">Currency</th>
                  <th scope="col" className="text-right">One unit in {base}</th>
                </tr>
              </thead>
              <tbody>
                {SUPPORTED_CURRENCIES.map((curr) => {
                  const isBase = curr.code === base;
                  const rate = exchangeRates[curr.code] || (isBase ? 1 : 0);
                  return (
                    <tr key={curr.code}>
                      <td className="pr-4 text-ink-900">
                        <span className="mr-2 inline-block w-9 font-semibold">{curr.code}</span>
                        <span className="text-graphite-600">{curr.name}</span>
                      </td>
                      <td className="text-right ll-figure text-ink-900">{isBase ? <span className="text-graphite-600">Base currency</span> : rate > 0 ? (1 / rate).toFixed(2) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <form onSubmit={handleSetCustomRate} className="ll-margin mt-5 grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <p className="text-[13px] text-graphite-600 sm:col-span-3">Set a rate by hand, for a customs valuation or a bank’s quoted rate. It lasts in this browser until rates are fetched again.</p>
              <Field label="Currency">
                <select value={customRateCurrency} onChange={(e) => setCustomRateCurrency(e.target.value)} required>
                  <option value="">Choose</option>
                  {SUPPORTED_CURRENCIES.filter((c) => c.code !== base).map((c) => (
                    <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label={`${customRateCurrency || 'Foreign'} per 1 ${base}`}>
                <input type="number" step="any" min="0" inputMode="decimal" value={customRateValue} onChange={(e) => setCustomRateValue(e.target.value)} required className="tabular-currency" />
              </Field>
              <button type="submit" className={`${buttonClass.secondary} h-10`}>
                Use this rate
              </button>
            </form>
          </section>

          <section aria-labelledby="fx-heading">
            <div className="flex items-end justify-between gap-4 border-b-2 border-ink-900 pb-2">
              <div>
                <h2 id="fx-heading" className="ll-heading text-[20px] text-ink-900">Unrealized FX</h2>
                <p className="mt-1 text-[13px] text-graphite-600">Open foreign-currency invoices and bills, revalued at today’s rate.</p>
              </div>
              {unrealizedFXData && <Amount cents={unrealizedFXData.totalUnrealizedGainLossCents || 0} currency={base} size="lg" tone="result" />}
            </div>
            {fxItems.length === 0 ? (
              <EmptyNote>No open foreign-currency invoices or bills, so nothing needs revaluing.</EmptyNote>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[40rem] text-[13.5px]">
                  <caption className="sr-only">Unrealized FX, figures in {base}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="pr-4 text-left">Document</th>
                      <th scope="col" className="pr-4 text-right">Foreign amount</th>
                      <th scope="col" className="pr-4 text-right">Booked rate</th>
                      <th scope="col" className="pr-4 text-right">Today</th>
                      <th scope="col" className="text-right">Gain or (loss)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fxItems.map((item) => (
                      <tr key={item.id}>
                        <td className="pr-4 text-ink-900">
                          <span className="ll-figure font-semibold">{item.referenceNo}</span>
                          <span className="ml-2 text-graphite-600">{item.entityType === 'BILL' ? 'Bill' : item.entityType === 'INVOICE' ? 'Invoice' : 'Bank account'}{!looksLikeId(item.partyName) && item.partyName ? ` · ${item.partyName}` : ''}</span>
                        </td>
                        <td className="pr-4 text-right whitespace-nowrap"><Amount cents={item.foreignAmountCents} currency={item.foreignCurrency} tone="ink" /></td>
                        <td className="pr-4 text-right ll-figure text-graphite-600">{rateText(item.bookedRate)}</td>
                        <td className="pr-4 text-right ll-figure text-ink-900">{rateText(item.currentRate)}</td>
                        <td className="text-right whitespace-nowrap"><Amount cents={item.gainLossCents} currency={base} tone="result" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'accounting' && (
        <div className="max-w-3xl space-y-3">
          <p className="text-[13.5px] text-graphite-600">These accounts are set when a company is opened and every automatic posting uses them. They cannot be changed here.</p>
          <ul className="border-t border-feint-strong">
            {POSTING_ACCOUNTS.map((a) => (
              <li key={a.code} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 border-b border-feint py-3">
                <span className="ll-figure pt-px text-[14px] font-semibold text-ink-900">{a.code}</span>
                <span>
                  <span className="block text-[14px] text-ink-900">{a.name}</span>
                  <span className="mt-0.5 block text-[12.5px] text-graphite-600">{a.use}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeTab === 'security' && (
        <div className="max-w-3xl space-y-8">
          <section aria-labelledby="lock-heading">
            <h2 id="lock-heading" className="ll-heading border-b-2 border-ink-900 pb-1.5 text-[20px] text-ink-900">Inactivity sign-out</h2>
            <p className="mt-3 text-[14px] text-ink-900">
              After <span className="font-semibold">15 minutes</span> without a click, key press or scroll, Ledger Link locks and signs you out.
            </p>
            <p className="mt-1 text-[12.5px] text-graphite-600">The interval is fixed for every organization.</p>
          </section>

          <section aria-labelledby="export-heading">
            <h2 id="export-heading" className="ll-heading border-b-2 border-ink-900 pb-1.5 text-[20px] text-ink-900">Export the general ledger</h2>
            <p className="mt-3 text-[14px] text-ink-900">Every posted journal line for {activeCompany?.name || 'this company'}, as a CSV file.</p>
            <button type="button" onClick={exportLedger} className={`${buttonClass.secondary} mt-3`}>
              Export CSV
            </button>
            {exportProblem && (
              <p role="alert" className="mt-2 text-[13px] text-ledger-red">
                {exportProblem}
              </p>
            )}
          </section>
        </div>
      )}

      <section data-tour="restart-tutorial" aria-labelledby="tutorial-heading" className="max-w-3xl border-t border-feint-strong pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="border border-feint-strong bg-paper-200 p-2 text-oxblood" aria-hidden="true">
              <BookOpen className="h-5 w-5" />
            </span>
            <div>
              <h2 id="tutorial-heading" className="ll-heading text-[17px] text-ink-900">Ledger Link tutorial</h2>
              <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-graphite-600">
                Review the main screens again. Restarting the tutorial does not change any records.
              </p>
            </div>
          </div>
          <button type="button" onClick={restartTutorial} disabled={!isOnboardingReady} className={`${buttonClass.secondary} shrink-0`}>
            <BookOpen className="h-4 w-4" aria-hidden="true" /> Restart tutorial
          </button>
        </div>
      </section>

      {isCompanyModalOpen && (
        <CompanyModal
          initialData={editingOrg}
          onClose={() => setIsCompanyModalOpen(false)}
          onSuccess={() => {
            setIsCompanyModalOpen(false);
            refetchOrgs();
          }}
        />
      )}
    </div>
  );
}

function CompanyModal({ initialData, onClose, onSuccess }: { initialData: OrganizationData | null; onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState(initialData?.name || '');
  const [legalName, setLegalName] = useState(initialData?.legalName || '');
  const [baseCurrency, setBaseCurrency] = useState(initialData?.baseCurrency || 'KES');
  const [country, setCountry] = useState(initialData?.country || 'Kenya');
  const [taxId, setTaxId] = useState(initialData?.taxId || '');
  const [fiscalYearStart, setFiscalYearStart] = useState(initialData?.fiscalYearStart || 'January');
  const [industry, setIndustry] = useState(initialData?.industry || '');
  const [address, setAddress] = useState(initialData?.address || '');
  const [city, setCity] = useState(initialData?.city || 'Nairobi');
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [email, setEmail] = useState(initialData?.email || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const payload = { name, legalName: legalName || name, baseCurrency, country, taxId, fiscalYearStart, industry, address, city, phone, email };
      const res = await fetch(initialData ? `/api/organizations/${initialData.id}` : '/api/organizations', {
        method: initialData ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'The company could not be saved.');
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width="lg"
      title={initialData ? `Edit ${initialData.name}` : 'Add a company'}
      note={initialData ? undefined : 'A new company starts with its own empty books and a standard chart of accounts.'}
      footer={
        <>
          {error && (
            <p role="alert" className="mr-auto text-[13px] text-ledger-red">
              {error}
            </p>
          )}
          <button type="button" onClick={onClose} className={buttonClass.secondary}>
            Cancel
          </button>
          <button type="submit" form="company-form" disabled={isSubmitting} className={buttonClass.primary}>
            {isSubmitting ? 'Saving' : initialData ? 'Save changes' : 'Add company'}
          </button>
        </>
      }
    >
      <form id="company-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Trading name">
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Registered name" hint="As on the certificate of incorporation">
          <input type="text" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        </Field>
        <Field label="Base currency" hint={initialData ? 'Changing it does not convert posted figures' : undefined}>
          <select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Country">
          <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} />
        </Field>
        <Field label="KRA PIN">
          <input type="text" value={taxId} onChange={(e) => setTaxId(e.target.value.toUpperCase())} className="ll-figure uppercase" />
        </Field>
        <Field label="Financial year starts">
          <select value={fiscalYearStart} onChange={(e) => setFiscalYearStart(e.target.value)}>
            {MONTHS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Industry">
          <input type="text" value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </Field>
        <Field label="Town or city">
          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Address">
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>
        <Field label="Finance email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
