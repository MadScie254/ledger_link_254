import type { Context, Hono, Next } from 'hono';
import { MpesaC2bService } from '../../src/server/mpesaC2b';
import { assertChurchEdition } from '../../src/server/churchAccess';
import { C2B_ACCEPTED, C2B_MAX_BODY_BYTES, C2B_REJECTED } from '../../src/utils/mpesaC2b';
import { requireOrganizationAdministrator, type Variables } from '../auth';
import { bodyOf, logError, respondError } from '../http';
import { mpesaIntegrationSchema, mpesaStatementSchema } from '../churchSchemas';
import type { Api } from './types';

type Input<F extends (...args: any[]) => any, N extends number> = Parameters<F>[N];

export async function requireChurchEdition(c: Context<{ Variables: Variables }>, next: Next) {
  try { await assertChurchEdition(c.get('orgId')); }
  catch (err) { return respondError(c, err); }
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
 * the church. Validation always accepts (Kundi takes every gift). The
 * confirmation is kept, answered, then matched and posted.
 */
export function registerMpesaPublicRoutes(app: Hono<any>) {
  for (const base of ['/api/public/mpesa/c2b/:token', '/api/public/giving/c2b/:token']) {
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
}

export function registerMpesaRoutes(api: Api) {
  api.use('/integrations/mpesa', requireChurchEdition);
  api.use('/integrations/mpesa/*', requireChurchEdition);
  api.use('/mpesa/*', requireChurchEdition);

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
