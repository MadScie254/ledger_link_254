import { getSupabase } from './supabase';

export interface ExchangeRateData {
  base: string;
  date: string;
  timeLastUpdateUtc: string;
  rates: Record<string, number>;
  source: string;
}

export interface UnrealizedFXBreakdown {
  totalUnrealizedGainLossCents: number;
  receivablesGainLossCents: number;
  payablesGainLossCents: number;
  bankHoldingsGainLossCents: number;
  baseCurrency: string;
  asOfDate: string;
  items: Array<{
    id: string;
    entityType: 'INVOICE' | 'BILL' | 'BANK_ACCOUNT';
    referenceNo: string;
    partyName: string;
    foreignCurrency: string;
    foreignAmountCents: number;
    bookedRate: number;
    currentRate: number;
    bookedBaseCents: number;
    currentBaseCents: number;
    gainLossCents: number; // positive = gain, negative = loss
    status: string;
  }>;
  currencySummaries: Array<{
    currency: string;
    rate: number;
    openReceivablesForeignCents: number;
    openPayablesForeignCents: number;
    foreignBankHoldingsCents: number;
    netUnrealizedGainLossCents: number;
  }>;
}

// Fallback static high-precision rates if offline/airgapped
const DEFAULT_KES_RATES: Record<string, number> = {
  KES: 1,
  USD: 0.00775, // 1 USD = ~129 KES
  EUR: 0.00714, // 1 EUR = ~140 KES
  GBP: 0.00602, // 1 GBP = ~166 KES
  UGX: 28.65,   // 1 KES = ~28.65 UGX
  TZS: 19.85,   // 1 KES = ~19.85 TZS
  AED: 0.0284,  // 1 KES = ~0.0284 AED
  CAD: 0.0105,  // 1 KES = ~0.0105 CAD
  ZAR: 0.142,   // 1 KES = ~0.142 ZAR
  CNY: 0.0558,  // 1 KES = ~0.0558 CNY
  INR: 0.655,   // 1 KES = ~0.655 INR
  JPY: 1.18     // 1 KES = ~1.18 JPY
};

// In-memory cache for fast response times
let cachedRates: { [base: string]: { data: ExchangeRateData; timestamp: number } } = {};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export class CurrencyService {
  /**
   * Fetch daily live exchange rates using 100% free open APIs
   * Primary: open.er-api.com
   * Secondary: api.exchangerate-api.com
   */
  static async fetchLiveRates(baseCurrency: string = 'KES', forceRefresh: boolean = false): Promise<ExchangeRateData> {
    const base = baseCurrency.toUpperCase();
    const now = Date.now();

    if (!forceRefresh && cachedRates[base] && (now - cachedRates[base].timestamp < CACHE_TTL_MS)) {
      return cachedRates[base].data;
    }

    try {
      // 1. Attempt Primary Free API: open.er-api.com
      const primaryUrl = `https://open.er-api.com/v6/latest/${base}`;
      const response = await fetch(primaryUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });

      if (response.ok) {
        const json = await response.json();
        if (json.rates && Object.keys(json.rates).length > 0) {
          const rateData: ExchangeRateData = {
            base,
            date: new Date().toISOString().split('T')[0],
            timeLastUpdateUtc: json.time_last_update_utc || new Date().toUTCString(),
            rates: json.rates,
            source: 'Open Exchange Rate API (Live Market Feed)'
          };

          cachedRates[base] = { data: rateData, timestamp: now };
          return rateData;
        }
      }
    } catch (err: any) {
      console.warn(`[CurrencyService] Primary API fetch failed: ${err.message}. Trying secondary fallback...`);
    }

    try {
      // 2. Attempt Secondary Free API: api.exchangerate-api.com (v4)
      const secondaryUrl = `https://api.exchangerate-api.com/v4/latest/${base}`;
      const response = await fetch(secondaryUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });

      if (response.ok) {
        const json = await response.json();
        if (json.rates && Object.keys(json.rates).length > 0) {
          const rateData: ExchangeRateData = {
            base,
            date: json.date || new Date().toISOString().split('T')[0],
            timeLastUpdateUtc: new Date().toUTCString(),
            rates: json.rates,
            source: 'ExchangeRate-API Open Tier'
          };

          cachedRates[base] = { data: rateData, timestamp: now };
          return rateData;
        }
      }
    } catch (err: any) {
      console.warn(`[CurrencyService] Secondary API fetch failed: ${err.message}. Using built-in rates...`);
    }

    // 3. Fallback to resilient default rates computed relative to requested base
    let baseRates = { ...DEFAULT_KES_RATES };
    if (base !== 'KES' && DEFAULT_KES_RATES[base]) {
      const baseToKES = 1 / DEFAULT_KES_RATES[base];
      const recalculated: Record<string, number> = {};
      for (const [curr, val] of Object.entries(DEFAULT_KES_RATES)) {
        recalculated[curr] = val * baseToKES;
      }
      baseRates = recalculated;
    }

    const fallbackData: ExchangeRateData = {
      base,
      date: new Date().toISOString().split('T')[0],
      timeLastUpdateUtc: new Date().toUTCString(),
      rates: baseRates,
      source: 'System Base Reserves (Offline Safe)'
    };

    cachedRates[base] = { data: fallbackData, timestamp: now };
    return fallbackData;
  }

  /**
   * Computes comprehensive Unrealized Foreign Exchange (FX) Gains / Losses
   * for an organization according to standard accounting principles (IAS 21).
   */
  static async calculateUnrealizedFX(orgId: string, baseCurrency: string = 'KES'): Promise<UnrealizedFXBreakdown> {
    const supabase = getSupabase();
    const liveRates = await this.fetchLiveRates(baseCurrency);
    if (liveRates.source === 'System Base Reserves (Offline Safe)') {
      throw new Error('Live exchange rates are unavailable. FX revaluation was not calculated from fallback rates.');
    }
    const rates = liveRates.rates;
    const normalizedBase = baseCurrency.toUpperCase();
    const breakdownItems: UnrealizedFXBreakdown['items'] = [];
    let receivablesGainLossCents = 0;
    let payablesGainLossCents = 0;
    const bankHoldingsGainLossCents = 0;

    const relatedName = (relation: any, fallback: string) => {
      const record = Array.isArray(relation) ? relation[0] : relation;
      return record?.display_name || fallback;
    };

    const outstandingForeignAmount = (row: any) => {
      const foreignTotal = Number(row.foreign_amount_cents);
      const baseTotal = Number(row.total_cents);
      const baseDue = Number(row.amount_due_cents);
      if (!Number.isFinite(foreignTotal) || !Number.isFinite(baseTotal) || !Number.isFinite(baseDue) || baseTotal <= 0 || baseDue <= 0) {
        return 0;
      }
      return Math.round(foreignTotal * (baseDue / baseTotal));
    };

    // 1. Evaluate Open Receivables (Invoices)
    const { data: invoices, error: invoicesError } = await supabase
      .from('invoices')
      .select('id, invoice_number, customer_id, currency, exchange_rate, foreign_amount_cents, total_cents, amount_due_cents, status, customer:customers(display_name)')
      .eq('org_id', orgId)
      .neq('status', 'PAID')
      .neq('status', 'VOID');

    if (invoicesError) throw invoicesError;
    for (const data of invoices || []) {
      const foreignCurr = (data.currency || normalizedBase).toUpperCase();
      if (foreignCurr === normalizedBase) continue;

      const bookedRate = Number(data.exchange_rate);
      const currentRate = Number(rates[foreignCurr]);
      const foreignAmountCents = outstandingForeignAmount(data);
      if (bookedRate <= 0 || currentRate <= 0 || foreignAmountCents <= 0) continue;

      const bookedBaseCents = Number(data.amount_due_cents);
      const currentBaseCents = Math.round(foreignAmountCents / currentRate);
      const gainLossCents = currentBaseCents - bookedBaseCents;
      receivablesGainLossCents += gainLossCents;
      breakdownItems.push({
        id: data.id,
        entityType: 'INVOICE',
        referenceNo: data.invoice_number || `INV-${data.id.substring(0, 5)}`,
        partyName: relatedName(data.customer, 'Customer'),
        foreignCurrency: foreignCurr,
        foreignAmountCents,
        bookedRate,
        currentRate,
        bookedBaseCents,
        currentBaseCents,
        gainLossCents,
        status: data.status || 'SENT'
      });
    }

    // 2. Evaluate Open Payables (Bills)
    const { data: bills, error: billsError } = await supabase
      .from('bills')
      .select('id, bill_number, vendor_id, currency, exchange_rate, foreign_amount_cents, total_cents, amount_due_cents, status, vendor:vendors(display_name)')
      .eq('org_id', orgId)
      .neq('status', 'PAID')
      .neq('status', 'VOID');

    if (billsError) throw billsError;
    for (const data of bills || []) {
      const foreignCurr = (data.currency || normalizedBase).toUpperCase();
      if (foreignCurr === normalizedBase) continue;

      const bookedRate = Number(data.exchange_rate);
      const currentRate = Number(rates[foreignCurr]);
      const foreignAmountCents = outstandingForeignAmount(data);
      if (bookedRate <= 0 || currentRate <= 0 || foreignAmountCents <= 0) continue;

      const bookedBaseCents = Number(data.amount_due_cents);
      const currentBaseCents = Math.round(foreignAmountCents / currentRate);
      const gainLossCents = bookedBaseCents - currentBaseCents;
      payablesGainLossCents += gainLossCents;
      breakdownItems.push({
        id: data.id,
        entityType: 'BILL',
        referenceNo: data.bill_number || `BILL-${data.id.substring(0, 5)}`,
        partyName: relatedName(data.vendor, 'Vendor'),
        foreignCurrency: foreignCurr,
        foreignAmountCents,
        bookedRate,
        currentRate,
        bookedBaseCents,
        currentBaseCents,
        gainLossCents,
        status: data.status || 'OPEN'
      });
    }

    // Foreign bank holdings are deliberately omitted until balances store both
    // their transaction-currency amount and historical carrying amount. Account
    // names and guessed balances are not accounting evidence.

    const totalUnrealizedGainLossCents = receivablesGainLossCents + payablesGainLossCents + bankHoldingsGainLossCents;

    // Currency Summaries
    const currencyMap: Record<string, { openReceivables: number; openPayables: number; bankHoldings: number; netGainLoss: number }> = {};
    for (const item of breakdownItems) {
      if (!currencyMap[item.foreignCurrency]) {
        currencyMap[item.foreignCurrency] = { openReceivables: 0, openPayables: 0, bankHoldings: 0, netGainLoss: 0 };
      }
      if (item.entityType === 'INVOICE') currencyMap[item.foreignCurrency].openReceivables += item.foreignAmountCents;
      if (item.entityType === 'BILL') currencyMap[item.foreignCurrency].openPayables += item.foreignAmountCents;
      if (item.entityType === 'BANK_ACCOUNT') currencyMap[item.foreignCurrency].bankHoldings += item.foreignAmountCents;
      currencyMap[item.foreignCurrency].netGainLoss += item.gainLossCents;
    }

    const currencySummaries = Object.entries(currencyMap).map(([curr, data]) => ({
      currency: curr,
      rate: rates[curr] || 1,
      openReceivablesForeignCents: data.openReceivables,
      openPayablesForeignCents: data.openPayables,
      foreignBankHoldingsCents: data.bankHoldings,
      netUnrealizedGainLossCents: data.netGainLoss
    }));

    return {
      totalUnrealizedGainLossCents,
      receivablesGainLossCents,
      payablesGainLossCents,
      bankHoldingsGainLossCents,
      baseCurrency: normalizedBase,
      asOfDate: liveRates.date,
      items: breakdownItems,
      currencySummaries
    };
  }
}
