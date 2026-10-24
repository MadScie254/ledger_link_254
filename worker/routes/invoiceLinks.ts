import type { Hono } from 'hono';
import { z } from 'zod';
import { InvoiceLinkService } from '../../src/server/invoiceLinks';
import { GivingPageService } from '../../src/server/givingPage';
import { MpesaC2bService } from '../../src/server/mpesaC2b';
import { bodyOf, enforceRateLimits, HOUR, respondError } from '../http';
import { uuid } from '../schemas';
import { mpesaPaymentRequestSchema } from '../churchSchemas';
import type { Api } from './types';

/** The invoice's link for the customer: made or read, and withdrawn. */
export function registerInvoiceLinkRoutes(api: Api) {
  api.post('/invoices/:id/share-link', async (c) => {
    try {
      return c.json(await InvoiceLinkService.share(c.get('orgId'), uuid.parse(c.req.param('id')), c.get('userId'),
        MpesaC2bService.callbackOrigin(c.req.url)));
    } catch (err) { return respondError(c, err); }
  });
  api.delete('/invoices/:id/share-link', async (c) => {
    try {
      return c.json(await InvoiceLinkService.withdraw(c.get('orgId'), uuid.parse(c.req.param('id')), c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });
}

const token = z.string().regex(/^[0-9a-f]{64}$/, 'This invoice link is not valid.');
const callerIp = (c: { req: { header: (name: string) => string | undefined } }) => c.req.header('cf-connecting-ip') || 'unknown';

/**
 * The customer's page, outside sign-in: the token in the path names one
 * invoice. Reading is limited per caller; payment requests per invoice
 * link and per caller, since each one rings a phone.
 */
export function registerInvoiceLinkPublicRoutes(app: Hono<any>) {
  app.get('/api/public/invoices/:token', async (c) => {
    try {
      await enforceRateLimits([{ key: `pay-view:ip:${callerIp(c)}`, limit: 300, windowSeconds: HOUR }],
        'Too many pages opened from here. Try again later.');
      return c.json(await InvoiceLinkService.view(token.parse(c.req.param('token'))), 200, { 'Cache-Control': 'no-store' });
    } catch (err) { return respondError(c, err); }
  });

  // A church's giving page: the paybill, an account number per fund and its open campaigns.
  app.get('/api/public/give/:token', async (c) => {
    try {
      await enforceRateLimits([{ key: `give-view:ip:${callerIp(c)}`, limit: 300, windowSeconds: HOUR }],
        'Too many pages opened from here. Try again later.');
      return c.json(await GivingPageService.view(c.req.param('token') || ''), 200, { 'Cache-Control': 'no-store' });
    } catch (err) { return respondError(c, err); }
  });

  app.post('/api/public/invoices/:token/mpesa', async (c) => {
    try {
      const linkToken = token.parse(c.req.param('token'));
      const input = mpesaPaymentRequestSchema.parse(await bodyOf(c));
      await enforceRateLimits([
        { key: `pay-request:link:${linkToken}`, limit: 5, windowSeconds: HOUR },
        { key: `pay-request:ip:${callerIp(c)}`, limit: 20, windowSeconds: HOUR },
      ], 'That is as many payment requests as this page can send for now. Try again later, or pay to the paybill shown.');
      return c.json(await InvoiceLinkService.requestPayment(linkToken, input as { phone: string; amountCents: number },
        MpesaC2bService.callbackOrigin(c.req.url)), 201);
    } catch (err) { return respondError(c, err); }
  });

  app.get('/api/public/invoices/:token/mpesa/:requestId', async (c) => {
    try {
      await enforceRateLimits([{ key: `pay-status:ip:${callerIp(c)}`, limit: 600, windowSeconds: HOUR }],
        'Too many checks from here. Try again later.');
      return c.json(await InvoiceLinkService.requestStatus(token.parse(c.req.param('token')), uuid.parse(c.req.param('requestId'))),
        200, { 'Cache-Control': 'no-store' });
    } catch (err) { return respondError(c, err); }
  });
}
