import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  requireAuthenticationAndOrganization,
  requirePayrollAccess,
  type Variables,
} from './auth';
import { logError, respondError } from './http';
import { registerOrganizationRoutes } from './routes/organizations';
import { registerTeamRoutes } from './routes/team';
import { registerAccountingRoutes } from './routes/accounting';
import { registerReportRoutes } from './routes/reports';
import { registerSalesRoutes } from './routes/sales';
import { registerPurchaseRoutes } from './routes/purchases';
import { registerBankingRoutes } from './routes/banking';
import { registerPayrollRoutes } from './routes/payroll';
import { registerOperationsRoutes } from './routes/operations';
import { registerBulkRoutes } from './routes/bulk';
import { registerAiRoutes } from './routes/ai';
import { registerCurrencyRoutes } from './routes/currency';
import { registerCashRoutes } from './routes/cash';
import { registerCreditRoutes } from './routes/credits';
import { registerPurchaseOrderRoutes } from './routes/purchaseOrders';
import { registerRecurringRoutes } from './routes/recurring';
import { registerImportRoutes } from './routes/imports';
import { registerAttachmentRoutes } from './routes/attachments';
import { registerTrackingRoutes } from './routes/tracking';
import { registerDocumentRoutes } from './routes/documents';
import { registerLawRoutes } from './routes/law';
import { registerMpesaPublicRoutes, registerMpesaRoutes } from './routes/mpesa';
import { registerChurchRoutes } from './routes/church';
import { CourtEventService } from '../src/server/courtEvents';
import { RecurringService } from '../src/server/recurring';
import { allowedOriginsForBrands, brandForHost, configuredBrandHosts } from '../src/utils/publicBrand';

const app = new Hono<{ Variables: Variables }>();

const BRAND_HOSTS = configuredBrandHosts(process.env.MIZANI_HOSTS, process.env.KUNDI_HOSTS);
const ALLOWED_ORIGINS = allowedOriginsForBrands(
  process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001',
  BRAND_HOSTS,
);

// --- Security headers on API responses (static assets get public/_headers) ---
app.use('*', async (c, next) => {
  await next();
  const isProduction = process.env.NODE_ENV === 'production';
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "frame-ancestors 'none'",
      isProduction ? "script-src 'none'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    ].join('; ')
  );
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cache-Control', 'no-store');
});

// --- CORS ---
app.use(
  '/api/*',
  cors({
    origin: (origin) => (!origin || ALLOWED_ORIGINS.includes(origin) ? origin : null),
    credentials: true,
  })
);

const api = new Hono<{ Variables: Variables }>();
app.get('/api/public/brand', (c) => c.json(brandForHost(c.req.header('host'), c.req.url, BRAND_HOSTS)));
app.get('/api/court-events/calendar.ics', async (c) => {
  try {
    const feed = await CourtEventService.calendarForToken(c.req.query('token') || '');
    if (feed === null) return c.text('Calendar feed not found.', 404);
    return c.text(feed, 200, { 'Content-Type': 'text/calendar; charset=utf-8' });
  } catch (err) { return respondError(c, err); }
});
// Safaricom's C2B callbacks carry their own token and are answered outside sign-in.
registerMpesaPublicRoutes(app);
api.use('*', requireAuthenticationAndOrganization);
// Employee and payroll records are personal data: not for the read-only member role.
api.use('/employees', requirePayrollAccess);
api.use('/employees/*', requirePayrollAccess);
api.use('/payroll/*', requirePayrollAccess);

registerOrganizationRoutes(api);
registerTeamRoutes(api);
registerAccountingRoutes(api);
registerReportRoutes(api);
registerSalesRoutes(api);
registerPurchaseRoutes(api);
registerBankingRoutes(api);
registerPayrollRoutes(api);
registerOperationsRoutes(api);
registerBulkRoutes(api);
registerAiRoutes(api);
registerCurrencyRoutes(api);
registerCashRoutes(api);
registerCreditRoutes(api);
registerPurchaseOrderRoutes(api);
registerRecurringRoutes(api);
registerImportRoutes(api);
registerAttachmentRoutes(api);
registerTrackingRoutes(api);
registerDocumentRoutes(api);
registerLawRoutes(api);
registerMpesaRoutes(api);
registerChurchRoutes(api);

app.route('/api', api);

app.onError((err, c) => {
  logError('Unhandled error', err);
  return c.json({ error: 'An unexpected error occurred. Please try again later.' }, 500);
});

/**
 * The daily schedule (triggers.crons in wrangler.jsonc): posts recurring
 * invoices and bills that have fallen due. A failing template records why on
 * itself and the rest still run.
 */
async function scheduled(_controller: unknown, _env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }) {
  ctx.waitUntil(
    RecurringService.runDue()
      .then((result) => console.log('[Schedule] Recurring documents:', result.posted, 'posted,', result.failed, 'failed'))
      .catch((err) => logError('Recurring run failed', err)),
  );
}

export default { fetch: app.fetch, scheduled };
