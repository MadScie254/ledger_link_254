import type { Context, Hono, Next } from 'hono';
import { MpesaC2bService, mpesaEdition } from '../../src/server/mpesaC2b';
import { MpesaPaymentService } from '../../src/server/mpesaPayments';
import { MpesaExpressService } from '../../src/server/mpesaExpress';
import { STK_ACCEPTED } from '../../src/utils/mpesaExpress';
import { assertChurchEdition } from '../../src/server/churchAccess';
import { UserError } from '../../src/server/errors';
import { C2B_ACCEPTED, C2B_MAX_BODY_BYTES, C2B_REJECTED } from '../../src/utils/mpesaC2b';
import { requireOrganizationAdministrator, type Variables } from '../auth';
import { bodyOf, enforceRateLimits, HOUR, logError, respondError } from '../http';
import { mpesaExpressSchema, mpesaIntegrationSchema, mpesaPaymentRequestSchema, mpesaStatementSchema } from '../churchSchemas';
import { uuid } from '../schemas';
import type { Api } from './types';

type Input<F extends (...args: any[]) => any, N extends number> = Parameters<F>[N];

export async function requireChurchEdition(c: Context<{ Variables: Variables }>, next: Next) {
  try { await assertChurchEdition(c.get('orgId')); }
  catch (err) { return respondError(c, err); }
  await next();
}

/** Businesses and Kundi churches link an M-Pesa paybill or till; law organizations do not. */
export async function requireMpesaEdition(c: Context<{ Variables: Variables }>, next: Next) {
  try { await mpesaEdition(c.get('orgId')); }
  catch (err) { return respondError(c, err); }
  await next();
}

async function requireBusinessEdition(c: Context<{ Variables: Variables }>, next: Next) {
  try {
    if (await mpesaEdition(c.get('orgId')) !== 'business') {
      throw new UserError('M-Pesa payments are kept for business organizations. A church reads its receipts in Giving.', 403);
    }
  } catch (err) { return respondError(c, err); }
  await next();
}

/** Runs work after the response when the Worker allows it, else before. */
async function afterResponse(c: Context, work: () => Promise<unknown>) {
  const run = () => work().catch((err) => logError('M-Pesa receipt processing failed', err));
  let ctx: { waitUntil(promise: Promise<unknown>): void } | undefined;
  try { ctx = c.executionCtx; } catch { ctx = undefined; }
  if (ctx) ctx.waitUntil(run());
  else await run();
}

/** Optional allow-list of Safaricom's callback addresses (MPESA_CALLBACK_IPS, comma separated). */
function callerAllowed(c: Context) {
  const allowed = (process.env.MPESA_CALLBACK_IPS || '').split(',').map((ip) => ip.trim()).filter(Boolean);
  if (!allowed.length) return true;
  return allowed.includes(c.req.header('cf-connecting-ip') || '');
}

/**
 * Safaricom's C2B callbacks, outside sign-in: the token in the path names
 * the organization, whichever of the paths it arrives on. Validation always
 * accepts (a church takes every gift; a business takes every payment and
 * sorts it afterwards). The confirmation is kept, answered, then matched
 * and posted.
 */
export function registerMpesaPublicRoutes(app: Hono<any>) {
  for (const base of ['/api/public/mpesa/c2b/:token', '/api/public/giving/c2b/:token', '/api/public/payments/c2b/:token']) {
    app.post(`${base}/validation`, (c) => c.json(C2B_ACCEPTED));
    app.post(`${base}/confirmation`, async (c) => {
      try {
        if (!callerAllowed(c)) return c.json(C2B_REJECTED, 403);
        const raw = await c.req.text();
        if (raw.length > C2B_MAX_BODY_BYTES) return c.json(C2B_REJECTED, 413);
        let body: unknown;
        try { body = JSON.parse(raw); } catch { return c.json(C2B_REJECTED, 400); }
        const outcome = await MpesaC2bService.receiveConfirmation(c.req.param('token') || '', body);
        if (outcome.status === 'unknown-token') return c.json(C2B_REJECTED, 404);
        if (outcome.status === 'unreadable') {
          console.warn('[M-Pesa] Confirmation not read:', outcome.reason);
          return c.json(C2B_REJECTED, 400);
        }
        await afterResponse(c, outcome.process);
        return c.json(C2B_ACCEPTED);
      } catch (err) {
        logError('M-Pesa confirmation failed', err);
        return c.json(C2B_REJECTED, 500);
      }
    });
  }

  // The result of one invoice's payment request (M-Pesa Express). The token
  // in the path names that request alone.
  app.post('/api/public/payments/stk/:token', async (c) => {
    try {
      if (!callerAllowed(c)) return c.json(C2B_REJECTED, 403);
      const raw = await c.req.text();
      if (raw.length > C2B_MAX_BODY_BYTES) return c.json(C2B_REJECTED, 413);
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return c.json(C2B_REJECTED, 400); }
      const outcome = await MpesaExpressService.receiveCallback(c.req.param('token') || '', body);
      if (outcome.status === 'unknown-token') return c.json(C2B_REJECTED, 404);
      if (outcome.status === 'unreadable') {
        console.warn('[M-Pesa] Payment request result not read:', outcome.reason);
        return c.json(C2B_REJECTED, 400);
      }
      await afterResponse(c, outcome.process);
      return c.json(STK_ACCEPTED);
    } catch (err) {
      logError('M-Pesa payment request result failed', err);
      return c.json(C2B_REJECTED, 500);
    }
  });
}

export function registerMpesaRoutes(api: Api) {
  api.use('/integrations/mpesa', requireMpesaEdition);
  api.use('/integrations/mpesa/*', requireMpesaEdition);
  api.use('/mpesa/*', requireChurchEdition);

  // A business's payments: what arrived, and why any waits in Banking.
  api.get('/integrations/mpesa/payments', requireOrganizationAdministrator, requireBusinessEdition, async (c) => {
    try { return c.json({ payments: await MpesaPaymentService.recent(c.get('orgId')) }); }
    catch (err) { return respondError(c, err); }
  });
  // The M-Pesa Express passkey; blank stops payment requests.
  api.put('/integrations/mpesa/express', requireOrganizationAdministrator, requireBusinessEdition, async (c) => {
    try {
      const { passkey } = mpesaExpressSchema.parse(await bodyOf(c));
      await MpesaExpressService.savePasskey(c.get('orgId'), c.get('userId'), passkey);
      return c.json(await MpesaC2bService.settings(c.get('orgId')));
    } catch (err) { return respondError(c, err); }
  });
  // Whether invoices can ask for payment, for every role that sees invoices.
  api.get('/integrations/mpesa/express-status', requireBusinessEdition, async (c) => {
    try { return c.json({ ready: await MpesaExpressService.ready(c.get('orgId')) }); }
    catch (err) { return respondError(c, err); }
  });
  // An open invoice asks the customer's phone to pay (owners, admins and accountants: a write).
  api.post('/invoices/:id/mpesa-request', requireBusinessEdition, async (c) => {
    try {
      const input = mpesaPaymentRequestSchema.parse(await bodyOf(c));
      await enforceRateLimits([{ key: `mpesa-request:${c.get('orgId')}`, limit: 60, windowSeconds: HOUR }],
        'Sixty payment requests an hour is the limit for one organization. Try again later.');
      return c.json(await MpesaExpressService.requestPayment(c.get('orgId'), uuid.parse(c.req.param('id')), input as Input<typeof MpesaExpressService.requestPayment, 2>,
        c.get('userId'), MpesaC2bService.callbackOrigin(c.req.url)), 201);
    } catch (err) { return respondError(c, err); }
  });
  api.get('/invoices/:id/mpesa-requests', requireBusinessEdition, async (c) => {
    try { return c.json({ requests: await MpesaExpressService.requestsFor(c.get('orgId'), uuid.parse(c.req.param('id'))) }); }
    catch (err) { return respondError(c, err); }
  });
  // Try again once the invoice exists or the books allow it, in the asker's name.
  api.post('/integrations/mpesa/payments/:id/settle', requireOrganizationAdministrator, requireBusinessEdition, async (c) => {
    try {
      return c.json(await MpesaPaymentService.settle(c.get('orgId'), uuid.parse(c.req.param('id')), c.get('userId')));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/integrations/mpesa', requireOrganizationAdministrator, async (c) => {
    try { return c.json(await MpesaC2bService.settings(c.get('orgId'))); }
    catch (err) { return respondError(c, err); }
  });
  api.put('/integrations/mpesa', requireOrganizationAdministrator, async (c) => {
    try {
      const body = mpesaIntegrationSchema.parse(await bodyOf(c));
      await MpesaC2bService.saveSettings(c.get('orgId'), c.get('userId'),
        { ...body, integrationActorId: body.integrationActorId ?? null } as Input<typeof MpesaC2bService.saveSettings, 2>);
      return c.json(await MpesaC2bService.settings(c.get('orgId')));
    } catch (err) { return respondError(c, err); }
  });
  api.post('/integrations/mpesa/register', requireOrganizationAdministrator, async (c) => {
    try {
      return c.json(await MpesaC2bService.register(c.get('orgId'), c.get('userId'), MpesaC2bService.callbackOrigin(c.req.url)));
    } catch (err) { return respondError(c, err); }
  });
  api.post('/integrations/mpesa/callback-urls', requireOrganizationAdministrator, async (c) => {
    try {
      return c.json(await MpesaC2bService.issueCallbackUrls(c.get('orgId'), c.get('userId'), MpesaC2bService.callbackOrigin(c.req.url)));
    } catch (err) { return respondError(c, err); }
  });
  api.post('/mpesa/statements', async (c) => {
    try {
      const body = mpesaStatementSchema.parse(await bodyOf(c));
      return c.json(await MpesaC2bService.uploadStatement(c.get('orgId'), c.get('userId'),
        body as Input<typeof MpesaC2bService.uploadStatement, 2>));
    } catch (err) { return respondError(c, err); }
  });
}
