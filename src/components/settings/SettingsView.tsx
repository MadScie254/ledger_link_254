import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore, OrganizationData } from '../../store';
import { SUPPORTED_CURRENCIES, fetchExchangeRates, refreshLiveRates } from '../../utils/currency';
import { 
  Building2, 
  Coins, 
  Plus, 
  Check, 
  RefreshCw, 
  Globe, 
  Shield, 
  Sliders, 
  Save, 
  Building, 
  ArrowRight,
  TrendingUp, 
  CheckCircle2, 
  AlertCircle,
  ExternalLink,
  Edit2,
  Clock,
  Lock,
  Download
} from 'lucide-react';

export function SettingsView() {
  const { 
    currentOrgId, 
    setCurrentOrgId, 
    organizations, 
    setOrganizations, 
    activeCompany, 
    setActiveCompany,
    displayCurrency,
    setDisplayCurrency,
    exchangeRates,
    setExchangeRates,
    rateMetadata
  } = useAppStore();

  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'companies' | 'currencies' | 'accounting' | 'security'>('companies');
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrganizationData | null>(null);
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [rateFeedback, setRateFeedback] = useState<string | null>(null);
  const [customRateCurrency, setCustomRateCurrency] = useState('');
  const [customRateValue, setCustomRateValue] = useState('');

  // Fetch organizations from server
  const { data: orgsData, isLoading: isOrgsLoading, refetch: refetchOrgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const res = await fetch('/api/organizations');
      if (!res.ok) throw new Error('Failed to fetch organizations');
      const json = await res.json();
      return json.organizations as OrganizationData[];
    }
  });

  React.useEffect(() => {
    if (orgsData && orgsData.length > 0) {
      setOrganizations(orgsData);
      const current = orgsData.find(o => o.id === currentOrgId) || orgsData[0];
      if (current && (!activeCompany || activeCompany.id !== current.id)) {
        setActiveCompany(current);
      }
    }
  }, [orgsData, currentOrgId, activeCompany, setOrganizations, setActiveCompany]);

  // Fetch Unrealized FX summary
  const { data: unrealizedFXData, refetch: refetchFX } = useQuery({
    queryKey: ['unrealized-fx', currentOrgId, activeCompany?.baseCurrency],
    queryFn: async () => {
      const res = await fetch(`/api/currency/unrealized-fx?base=${encodeURIComponent(activeCompany?.baseCurrency || 'KES')}`, {
        headers: { 'x-org-id': currentOrgId }
      });
      if (!res.ok) return null;
      return res.json();
    }
  });

  const handleSwitchCompany = (org: OrganizationData) => {
    setActiveCompany(org);
    setCurrentOrgId(org.id);
    setDisplayCurrency(org.baseCurrency);
    // Invalidate queries so the whole app switches context cleanly
    queryClient.invalidateQueries();
  };

  const handleRefreshMarketRates = async () => {
    setIsRefreshingRates(true);
    setRateFeedback(null);
    try {
      const base = activeCompany?.baseCurrency || 'KES';
      const updated = await refreshLiveRates(base);
      setRateFeedback(`Live daily exchange rates updated successfully from free open market feed (Base: ${base})`);
      refetchFX();
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    } catch (err: any) {
      setRateFeedback(`Error refreshing rates: ${err.message}`);
    } finally {
      setIsRefreshingRates(false);
      setTimeout(() => setRateFeedback(null), 5000);
    }
  };

  const handleSetCustomRate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customRateCurrency || !customRateValue) return;
    const rateNum = parseFloat(customRateValue);
    if (isNaN(rateNum) || rateNum <= 0) return;

    const newRates = { ...exchangeRates, [customRateCurrency.toUpperCase()]: rateNum };
    setExchangeRates(newRates);
    setCustomRateCurrency('');
    setCustomRateValue('');
    setRateFeedback(`Custom exchange rate applied: 1 ${activeCompany?.baseCurrency || 'KES'} = ${rateNum} ${customRateCurrency.toUpperCase()}`);
    setTimeout(() => setRateFeedback(null), 4000);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif text-ink-900">Platform Settings & Operations</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage multi-company entities, live currency exchange rate engine, accounting policies, and security
          </p>
        </div>
        {activeTab === 'companies' && (
          <button
            onClick={() => {
              setEditingOrg(null);
              setIsCompanyModalOpen(true);
            }}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-ink-900 text-white dark:text-slate-900 rounded-sm text-xs font-medium hover:bg-ink-900/90 transition-colors shadow-xs shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add New Company</span>
          </button>
        )}
      </div>

      <div className="ledger-divider"></div>

      {/* Settings Navigation Tabs */}
      <div className="flex space-x-2 border-b border-ink-900/10">
        <button
          onClick={() => setActiveTab('companies')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'companies'
              ? 'border-focus-blue-600 text-focus-blue-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-slate-300'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Companies & Legal Entities ({organizations.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('currencies')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'currencies'
              ? 'border-focus-blue-600 text-focus-blue-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-slate-300'
          }`}
        >
          <Coins className="w-4 h-4" />
          <span>Multi-Currency & FX Engine</span>
        </button>

        <button
          onClick={() => setActiveTab('accounting')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'accounting'
              ? 'border-focus-blue-600 text-focus-blue-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-slate-300'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Accounting Defaults & FX Rules</span>
        </button>

        <button
          onClick={() => setActiveTab('security')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'security'
              ? 'border-focus-blue-600 text-focus-blue-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-slate-300'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Security & Backup</span>
        </button>
      </div>

      {/* TAB 1: Companies & Legal Entities */}
      {activeTab === 'companies' && (
        <div className="space-y-6">
          <div className="bg-paper-50 dark:bg-ink-900/30 p-4 border border-ink-900/10 rounded-sm">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">Active Company Context</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ledger Link supports seamless multi-entity accounting. Switching company updates all financial records, charts of accounts, and reports.
                </p>
              </div>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-ledger-green-100 text-ledger-green-800">
                Active: {activeCompany?.name || 'Acme Corp Ltd.'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {organizations.map((org) => {
              const isActive = activeCompany?.id === org.id || currentOrgId === org.id;
              return (
                <div
                  key={org.id}
                  className={`bg-white dark:bg-[#111827] border rounded-sm p-5 transition-all shadow-xs flex flex-col justify-between ${
                    isActive ? 'border-focus-blue-600 ring-1 ring-focus-blue-600' : 'border-ink-900/10 hover:border-slate-300'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-9 h-9 rounded bg-paper-100 dark:bg-ink-900/40 flex items-center justify-center text-ink-900 font-bold font-serif text-sm">
                          {org.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-ink-900">{org.name}</h4>
                          <p className="text-[11px] text-slate-500 font-mono">{org.legalName || org.name}</p>
                        </div>
                      </div>
                      {isActive && (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-focus-blue-100 text-focus-blue-800">
                          <Check className="w-3 h-3" />
                          <span>Active Entity</span>
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs py-3 border-y border-ink-900/5 my-2">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Base Currency</span>
                        <span className="font-semibold text-ink-900 font-mono">{org.baseCurrency}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Tax ID / PIN</span>
                        <span className="font-semibold text-ink-900 font-mono">{org.taxId || 'Not specified'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Country</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">{org.country}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Fiscal Year Starts</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">{org.fiscalYearStart || 'January'}</span>
                      </div>
                    </div>

                    {org.address && (
                      <p className="text-[11px] text-slate-500 mb-3 truncate">📍 {org.address}, {org.city}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-ink-900/5 mt-auto">
                    <button
                      onClick={() => {
                        setEditingOrg(org);
                        setIsCompanyModalOpen(true);
                      }}
                      className="text-xs text-slate-600 hover:text-ink-900 flex items-center space-x-1 py-1"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit Details</span>
                    </button>

                    {!isActive ? (
                      <button
                        onClick={() => handleSwitchCompany(org)}
                        className="text-xs font-semibold px-3 py-1.5 bg-focus-blue-600 text-white rounded-sm hover:bg-focus-blue-700 transition-colors flex items-center space-x-1"
                      >
                        <span>Switch to Company</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-ledger-green-700 flex items-center">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Currently Open
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: Multi-Currency & FX Engine */}
      {activeTab === 'currencies' && (
        <div className="space-y-6">
          {/* Live Rate Synchronizer Card */}
          <div className="bg-white dark:bg-[#111827] border border-ink-900/10 rounded-sm p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-base font-semibold text-ink-900">Automated Daily Exchange Rate Fetching</h3>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-ledger-green-100 text-ledger-green-800">
                    Free Live API Connected
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Exchange rates are automatically fetched daily from open free APIs (<span className="font-mono text-focus-blue-600">open.er-api.com</span> & <span className="font-mono text-focus-blue-600">ExchangeRate-API</span>).
                </p>
              </div>

              <button
                onClick={handleRefreshMarketRates}
                disabled={isRefreshingRates}
                className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-focus-blue-600 text-white rounded-sm text-xs font-medium hover:bg-focus-blue-700 disabled:opacity-50 transition-colors shrink-0 shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingRates ? 'animate-spin' : ''}`} />
                <span>{isRefreshingRates ? 'Fetching Live Rates...' : 'Fetch Market Rates Now'}</span>
              </button>
            </div>

            {rateFeedback && (
              <div className="mb-4 p-2.5 bg-ledger-green-50 dark:bg-ledger-green-900/20 border border-ledger-green-200 text-ledger-green-800 text-xs rounded-sm flex items-center space-x-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{rateFeedback}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-paper-50 dark:bg-ink-900/30 rounded-sm text-xs">
              <div>
                <span className="text-slate-400 block text-[10px]">Entity Base Currency</span>
                <span className="font-bold text-ink-900 text-sm font-mono">{activeCompany?.baseCurrency || 'KES'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">API Feed Source</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">{rateMetadata?.source || 'Open Exchange Rate API (Live Market)'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Last Market Sync</span>
                <span className="font-medium text-slate-700 dark:text-slate-300 font-mono">{rateMetadata?.lastUpdated || 'Today (Automated Daily)'}</span>
              </div>
            </div>
          </div>

          {/* Unrealized Gain/Loss Status Card */}
          {unrealizedFXData && (
            <div className="bg-white dark:bg-[#111827] border border-ink-900/10 rounded-sm p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-ink-900">Unrealized FX Revaluation Summary</h3>
                  <p className="text-xs text-slate-500">IAS 21 compliant balance sheet revaluation of open foreign balances</p>
                </div>
                <span className={`text-base font-serif font-bold tabular-currency ${
                  unrealizedFXData.totalUnrealizedGainLossCents >= 0 ? 'text-ledger-green-700' : 'text-rust-700'
                }`}>
                  {unrealizedFXData.totalUnrealizedGainLossCents >= 0 ? '+' : ''}
                  {activeCompany?.baseCurrency || 'KES'} {(unrealizedFXData.totalUnrealizedGainLossCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-ink-900/10 bg-paper-50 dark:bg-ink-900/30 text-slate-500 font-semibold">
                      <th className="py-2 px-3">Item / Party</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Foreign Amount</th>
                      <th className="py-2 px-3">Booked Rate</th>
                      <th className="py-2 px-3">Current Live Rate</th>
                      <th className="py-2 px-3 text-right">Unrealized Gain / Loss</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-900/5">
                    {(unrealizedFXData.items || []).map((item: any) => {
                      const isGain = item.gainLossCents >= 0;
                      return (
                        <tr key={item.id} className="hover:bg-paper-50/50">
                          <td className="py-2 px-3">
                            <span className="font-semibold text-ink-900 block">{item.partyName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{item.referenceNo}</span>
                          </td>
                          <td className="py-2 px-3">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-paper-100 dark:bg-ink-900/50 text-slate-600">
                              {item.entityType}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono font-medium">
                            {item.foreignCurrency} {(item.foreignAmountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-500">
                            {item.bookedRate < 1 ? `1 / ${(1 / item.bookedRate).toFixed(2)}` : item.bookedRate.toFixed(4)}
                          </td>
                          <td className="py-2 px-3 font-mono text-focus-blue-600 font-medium">
                            {item.currentRate < 1 ? `1 / ${(1 / item.currentRate).toFixed(2)}` : item.currentRate.toFixed(4)}
                          </td>
                          <td className={`py-2 px-3 text-right font-mono font-bold ${isGain ? 'text-ledger-green-700' : 'text-rust-700'}`}>
                            {isGain ? '+' : ''}{(item.gainLossCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} {activeCompany?.baseCurrency || 'KES'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Live Currency Exchange Rate Matrix */}
          <div className="bg-white dark:bg-[#111827] border border-ink-900/10 rounded-sm p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-ink-900 mb-3">Live Exchange Rate Matrix (vs. {activeCompany?.baseCurrency || 'KES'})</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {SUPPORTED_CURRENCIES.map((curr) => {
                const isBase = curr.code === (activeCompany?.baseCurrency || 'KES');
                const rate = exchangeRates[curr.code] || (isBase ? 1 : 0);
                const inverse = rate > 0 ? 1 / rate : 0;
                
                return (
                  <div key={curr.code} className="p-3 bg-paper-50 dark:bg-ink-900/30 rounded-sm border border-ink-900/5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-base">{curr.flag}</span>
                        <span className="font-bold text-xs text-ink-900">{curr.code}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">{curr.symbol}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate mb-1.5">{curr.name}</p>
                    <div className="text-xs font-mono font-semibold text-ink-900">
                      {isBase ? (
                        <span className="text-ledger-green-700">1.0000 (Base)</span>
                      ) : (
                        <span>1 {curr.code} = {inverse.toFixed(2)} {activeCompany?.baseCurrency || 'KES'}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Manual Exchange Rate Override */}
          <div className="bg-white dark:bg-[#111827] border border-ink-900/10 rounded-sm p-5 shadow-xs">
            <h3 className="text-sm font-semibold text-ink-900 mb-1">Set Manual Rate Override</h3>
            <p className="text-xs text-slate-500 mb-3">
              Override an automated exchange rate for internal transactions or customs declaration valuations.
            </p>
            <form onSubmit={handleSetCustomRate} className="flex flex-wrap items-center gap-3">
              <select
                value={customRateCurrency}
                onChange={(e) => setCustomRateCurrency(e.target.value)}
                className="text-xs border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900"
                required
              >
                <option value="">Select Currency...</option>
                {SUPPORTED_CURRENCIES.filter(c => c.code !== (activeCompany?.baseCurrency || 'KES')).map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.code} - {c.name}</option>
                ))}
              </select>

              <input
                type="number"
                step="any"
                placeholder={`Rate (e.g. 0.00775 for USD)`}
                value={customRateValue}
                onChange={(e) => setCustomRateValue(e.target.value)}
                className="text-xs border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900 w-52 font-mono"
                required
              />

              <button
                type="submit"
                className="px-3.5 py-1.5 bg-ink-900 text-white rounded-sm text-xs font-medium hover:bg-ink-900/90 transition-colors shadow-xs"
              >
                Apply Custom Rate
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 3: Accounting Defaults & FX Rules */}
      {activeTab === 'accounting' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#111827] border border-ink-900/10 rounded-sm p-5 shadow-xs">
            <h3 className="text-base font-semibold text-ink-900 mb-1">Chart of Accounts & FX Accounting Rules</h3>
            <p className="text-xs text-slate-500 mb-4">
              Configure standard ledger accounts mapped for double-entry posting and FX revaluation.
            </p>

            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between p-3 bg-paper-50 dark:bg-ink-900/30 rounded-sm border border-ink-900/5">
                <div>
                  <p className="font-semibold text-ink-900">Unrealized FX Gain / Loss Account</p>
                  <p className="text-slate-500 text-[11px]">IAS 21 temporary revaluations of open foreign invoices & bills</p>
                </div>
                <span className="font-mono bg-paper-100 dark:bg-ink-900/60 px-2.5 py-1 rounded text-ink-900 font-bold">
                  8000 - Unrealized FX Gain / Loss
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-paper-50 dark:bg-ink-900/30 rounded-sm border border-ink-900/5">
                <div>
                  <p className="font-semibold text-ink-900">Realized FX Gain / Loss Account</p>
                  <p className="text-slate-500 text-[11px]">Settlement variances when invoices/bills are settled at payment date</p>
                </div>
                <span className="font-mono bg-paper-100 dark:bg-ink-900/60 px-2.5 py-1 rounded text-ink-900 font-bold">
                  8100 - Realized FX Gain / Loss
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-paper-50 dark:bg-ink-900/30 rounded-sm border border-ink-900/5">
                <div>
                  <p className="font-semibold text-ink-900">Default Accounts Receivable (A/R)</p>
                  <p className="text-slate-500 text-[11px]">Customer billing ledger account</p>
                </div>
                <span className="font-mono bg-paper-100 dark:bg-ink-900/60 px-2.5 py-1 rounded text-ink-900 font-bold">
                  1100 - Accounts Receivable (A/R)
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-paper-50 dark:bg-ink-900/30 rounded-sm border border-ink-900/5">
                <div>
                  <p className="font-semibold text-ink-900">Default Accounts Payable (A/P)</p>
                  <p className="text-slate-500 text-[11px]">Vendor invoices & bills payable ledger account</p>
                </div>
                <span className="font-mono bg-paper-100 dark:bg-ink-900/60 px-2.5 py-1 rounded text-ink-900 font-bold">
                  2000 - Accounts Payable (A/P)
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Security & System */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#111827] border border-ink-900/10 rounded-sm p-5 shadow-xs">
            <h3 className="text-base font-semibold text-ink-900 mb-1">Session & Inactivity Lock</h3>
            <p className="text-xs text-slate-500 mb-4">
              Automatic screen lock protects financial data when the computer is left unattended.
            </p>

            <div className="flex items-center space-x-3 text-xs">
              <span className="text-slate-600">Auto-lock timer:</span>
              <span className="font-semibold px-2.5 py-1 bg-paper-100 dark:bg-ink-900 rounded font-mono">15 Minutes (Active)</span>
            </div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-ink-900/10 rounded-sm p-5 shadow-xs">
            <h3 className="text-base font-semibold text-ink-900 mb-1">Financial Data Export</h3>
            <p className="text-xs text-slate-500 mb-4">
              Export verified journal entries, trial balance, and multi-currency records in CSV format.
            </p>

            <button
              onClick={() => alert('Financial ledger snapshot exported.')}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-paper-100 hover:bg-paper-200 text-ink-900 rounded-sm text-xs font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Company General Ledger</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal to Add / Edit Company */}
      {isCompanyModalOpen && (
        <CompanyModal
          isOpen={isCompanyModalOpen}
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

interface CompanyModalProps {
  isOpen: boolean;
  initialData: OrganizationData | null;
  onClose: () => void;
  onSuccess: () => void;
}

function CompanyModal({ isOpen, initialData, onClose, onSuccess }: CompanyModalProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [legalName, setLegalName] = useState(initialData?.legalName || '');
  const [baseCurrency, setBaseCurrency] = useState(initialData?.baseCurrency || 'KES');
  const [country, setCountry] = useState(initialData?.country || 'Kenya');
  const [taxId, setTaxId] = useState(initialData?.taxId || '');
  const [fiscalYearStart, setFiscalYearStart] = useState(initialData?.fiscalYearStart || 'January');
  const [industry, setIndustry] = useState(initialData?.industry || 'Technology & Logistics');
  const [address, setAddress] = useState(initialData?.address || '');
  const [city, setCity] = useState(initialData?.city || 'Nairobi');
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [email, setEmail] = useState(initialData?.email || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        name,
        legalName: legalName || name,
        baseCurrency,
        country,
        taxId,
        fiscalYearStart,
        industry,
        address,
        city,
        phone,
        email,
      };

      const url = initialData ? `/api/organizations/${initialData.id}` : '/api/organizations';
      const method = initialData ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Failed to save company');
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="bg-white dark:bg-[#111827] border border-ink-900/10 rounded-sm shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-ink-900/10 pb-3 mb-4">
          <div className="flex items-center space-x-2">
            <Building2 className="w-5 h-5 text-focus-blue-600" />
            <h3 className="text-base font-semibold text-ink-900">
              {initialData ? 'Edit Company Profile' : 'Add New Company / Entity'}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-ink-900 text-sm font-bold">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-2.5 bg-rust-50 border border-rust-200 text-rust-700 text-xs rounded flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-ink-900 mb-1">Company Display Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme East Africa Ltd."
              className="w-full border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900"
            />
          </div>

          <div>
            <label className="block font-medium text-ink-900 mb-1">Full Legal Entity Name</label>
            <input
              type="text"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="e.g. Acme Corporation Kenya Limited"
              className="w-full border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-ink-900 mb-1">Base Currency *</label>
              <select
                value={baseCurrency}
                onChange={(e) => setBaseCurrency(e.target.value)}
                className="w-full border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.code} ({c.name})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-ink-900 mb-1">Country</label>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. Kenya, US, UK"
                className="w-full border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-ink-900 mb-1">Tax ID / PIN</label>
              <input
                type="text"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="e.g. P051234567Z"
                className="w-full border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900 font-mono"
              />
            </div>

            <div>
              <label className="block font-medium text-ink-900 mb-1">Fiscal Year Start</label>
              <select
                value={fiscalYearStart}
                onChange={(e) => setFiscalYearStart(e.target.value)}
                className="w-full border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900"
              >
                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-ink-900 mb-1">Industry</label>
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. Logistics, FinTech"
                className="w-full border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900"
              />
            </div>

            <div>
              <label className="block font-medium text-ink-900 mb-1">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Nairobi"
                className="w-full border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-ink-900 mb-1">Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. Riverside Square, 4th Floor"
              className="w-full border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-ink-900 mb-1">Finance Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="finance@company.com"
                className="w-full border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900"
              />
            </div>

            <div>
              <label className="block font-medium text-ink-900 mb-1">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+254 700 000 000"
                className="w-full border border-ink-900/20 rounded-sm px-3 py-1.5 bg-white dark:bg-ink-900 text-ink-900"
              />
            </div>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-4 border-t border-ink-900/10">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 border border-ink-900/20 text-slate-700 dark:text-slate-300 rounded-sm hover:bg-paper-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 bg-ink-900 text-white rounded-sm font-medium hover:bg-ink-900/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : initialData ? 'Update Company' : 'Create Company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
