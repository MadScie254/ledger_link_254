import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  requireAuthenticationAndOrganization,
  requirePayrollAccess,
  type Variables,
} from './auth';
import { logError } from './http';
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

const app = new Hono<{ Variables: Variables }>();

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001').split(',');

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

app.route('/api', api);

app.onError((err, c) => {
  logError('Unhandled error', err);
  return c.json({ error: 'An unexpected error occurred. Please try again later.' }, 500);
});

export default app;
