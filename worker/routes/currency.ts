import { CurrencyService } from '../../src/server/currency';
import { OrganizationService } from '../../src/server/organizations';
import { bodyOf, enforceRateLimits, HOUR, respondError } from '../http';
import { currency, currencyRefreshSchema } from '../schemas';
import type { Api } from './types';

export function registerCurrencyRoutes(api: Api) {
  // Cached rates; a fresh fetch from the providers is a POST, rate limited.
  api.get('/currency/rates', async (c) => {
    try {
      const base = currency.parse(c.req.query('base') || 'KES');
      return c.json(await CurrencyService.fetchLiveRates(base, false));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/currency/refresh', async (c) => {
    try {
      const body = currencyRefreshSchema.parse(await bodyOf(c));
      await enforceRateLimits(
        [{ key: `fx-refresh:org:${c.get('orgId')}`, limit: 10, windowSeconds: HOUR }],
        'Exchange rates were refreshed recently. The cached rates are still in use.',
      );
      const ratesData = await CurrencyService.fetchLiveRates(body.base, true);
      return c.json({ success: true, data: ratesData, message: 'Exchange rates refreshed.' });
    } catch (err) { return respondError(c, err); }
  });

  // Measured against the organization's own base currency, whatever the caller asks.
  api.get('/currency/unrealized-fx', async (c) => {
    try {
      const organization = await OrganizationService.getOrganization(c.get('orgId'));
      return c.json(await CurrencyService.calculateUnrealizedFX(c.get('orgId'), organization?.baseCurrency || 'KES'));
    } catch (err) { return respondError(c, err); }
  });
}
