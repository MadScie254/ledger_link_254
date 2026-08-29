import { useAppStore } from '../store';

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
  flag: string;
}

export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪' },
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', flag: '🇺🇬' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', flag: '🇹🇿' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', flag: '🇦🇪' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', flag: '🇨🇦' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', flag: '🇿🇦' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', flag: '🇨🇳' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', flag: '🇮🇳' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', flag: '🇯🇵' },
];

export const FALLBACK_RATES: Record<string, number> = {
  KES: 1,
  USD: 0.00775,
  EUR: 0.00714,
  GBP: 0.00602,
  UGX: 28.65,
  TZS: 19.85,
  AED: 0.0284,
  CAD: 0.0105,
  ZAR: 0.142,
  CNY: 0.0558,
  INR: 0.655,
  JPY: 1.18
};

/**
 * Fetches daily live exchange rates from the backend which connects
 * to free open APIs (open.er-api.com and exchangerate-api)
 */
export async function fetchExchangeRates(baseCurrency: string = 'KES', forceRefresh: boolean = false): Promise<Record<string, number>> {
  try {
    const url = `/api/currency/rates?base=${encodeURIComponent(baseCurrency)}${forceRefresh ? '&refresh=true' : ''}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.rates && Object.keys(data.rates).length > 0) {
        useAppStore.getState().setExchangeRates(data.rates);
        useAppStore.getState().setRateMetadata({
          source: data.source || 'Open Exchange Rate API (Live Market Feed)',
          lastUpdated: new Date().toLocaleTimeString()
        });
        return data.rates;
      }
    }
  } catch (err) {
    console.warn('[Currency] Live API rates fetch failed, falling back to local cache/rates:', err);
  }

  return useAppStore.getState().exchangeRates || FALLBACK_RATES;
}

export async function refreshLiveRates(baseCurrency: string = 'KES'): Promise<Record<string, number>> {
  try {
    const res = await fetch('/api/currency/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: baseCurrency })
    });
    if (res.ok) {
      const result = await res.json();
      if (result.data?.rates) {
        useAppStore.getState().setExchangeRates(result.data.rates);
        useAppStore.getState().setRateMetadata({
          source: result.data.source || 'Free Open Exchange Rate API (Daily Sync)',
          lastUpdated: new Date().toLocaleTimeString()
        });
        return result.data.rates;
      }
    }
  } catch (e) {
    console.error('Failed to trigger live rate refresh:', e);
  }
  return fetchExchangeRates(baseCurrency, true);
}

export function formatCurrency(amountCents: number, includeSymbol: boolean = false, currency?: string): string {
  // If no currency is explicitly passed, read from the global store
  const targetCurrency = currency || useAppStore.getState().displayCurrency || 'KES';
  const rates = useAppStore.getState().exchangeRates || FALLBACK_RATES;
  
  // Convert based on rate if not base
  const rate = rates[targetCurrency] || FALLBACK_RATES[targetCurrency] || 1;
  const convertedAmountCents = amountCents * rate;
  
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  };
  
  if (includeSymbol) {
    options.style = 'currency';
    options.currency = targetCurrency;
  }
  
  return (convertedAmountCents / 100).toLocaleString('en-US', options) + (!includeSymbol ? ` ${targetCurrency}` : '');
}

export function formatCurrencyFromFloat(amount: number, includeSymbol: boolean = false, currency?: string): string {
  const targetCurrency = currency || useAppStore.getState().displayCurrency || 'KES';
  const rates = useAppStore.getState().exchangeRates || FALLBACK_RATES;
  
  const rate = rates[targetCurrency] || FALLBACK_RATES[targetCurrency] || 1;
  const convertedAmount = amount * rate;
  
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  };
  
  if (includeSymbol) {
    options.style = 'currency';
    options.currency = targetCurrency;
  }
  
  return convertedAmount.toLocaleString('en-US', options) + (!includeSymbol ? ` ${targetCurrency}` : '');
}

export function convertAmount(amountCents: number, fromCurrency: string, toCurrency: string, rates?: Record<string, number>): number {
  if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) return amountCents;
  const r = rates || useAppStore.getState().exchangeRates || FALLBACK_RATES;
  
  const fromRate = r[fromCurrency.toUpperCase()] || 1;
  const toRate = r[toCurrency.toUpperCase()] || 1;
  
  // Base = amountCents / fromRate
  // Target = Base * toRate
  const baseAmount = amountCents / fromRate;
  return Math.round(baseAmount * toRate);
}

