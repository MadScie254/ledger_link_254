# LedgerLink 📒

> **Corporate-grade, multi-currency accounting & financial operations platform.**  
> Built for East African businesses (and beyond) — double-entry bookkeeping, real-time
> banking reconciliation, payroll, invoicing, and AI-powered receipt scanning.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Stack: React 19 + Vite + Cloudflare Workers + Supabase](https://img.shields.io/badge/Stack-React%2019%20%2B%20Vite%20%2B%20Cloudflare%20Workers%20%2B%20Supabase-green.svg)](#tech-stack)

---

## What is LedgerLink?

LedgerLink is a full-stack, multi-tenant accounting platform designed for small-to-medium
enterprises operating across multiple currencies (KES, USD, EUR, GBP, UGX, TZS).

**Key capabilities:**
- 📊 **Double-entry ledger** — journal entries validated atomically in Postgres; `SUM(debit) = SUM(credit)` enforced server-side, never client-side; posted entries are permanent and corrected by dated reversals; a closing date locks past periods
- 🧾 **Sales** — estimates, sales orders, invoices, sales receipts, credit notes and refunds, recurring invoices on a daily schedule, customer statements
- 🛒 **Purchases** — purchase orders billed as goods arrive, multi-line bills with stock items, expenses paid on the spot, supplier credits, bill approval, recurring bills
- 🏦 **Banking** — statement import (CSV with M-Pesa layouts, OFX, QFX) for every bank, cash and M-Pesa account, AI-assisted matching, transfers, and reconciliation to statement balances
- 💰 **Payroll** — Kenyan PAYE, NSSF, SHA and Housing Levy, with reversible runs
- 📦 **Inventory** — every stock change recorded as a movement; purchases, returns, sales and counts
- 🏷️ **Classes and locations** — tag postings by line of business or branch and cut the P&L by either
- 📎 **Attachments** — receipts, PDFs and documents on any record; a scanned receipt stays with its expense
- 🖨️ **Printable documents** — invoices, credit notes, estimates, sales receipts, sales orders and purchase orders saved as PDFs, carrying the company's KRA PIN, how to pay (bank or M-Pesa) and its own footer; a foreign-currency invoice prints in its own currency
- 📥 **Imports** — customers, suppliers and stock items from a spreadsheet
- 🤖 **AI features on Cloudflare Workers AI** — opt-in per organization, each suggestion or draft checked by a person: receipt reading (supplier, date, total, VAT, currency); questions about the books, typed or spoken, in English or Kiswahili, answered from fixed reports with the figures shown; account suggestions for unmatched statement lines; payment reminders; fee note narratives (Mizani); the treasurer's remarks (Kundi). Use is recorded and capped per organization each day
- 📈 **Reports** — P&L (and by month, class or location), Balance Sheet, Cash Flow, Trial Balance, General Ledger, aging, sales by customer and item, spending by supplier, VAT and eTIMS summary
- 🔐 **Email/password auth** — Supabase Auth with row-level security
- 🌙 **Light/dark theme** — corporate light default, toggleable dark mode

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4 |
| State | Zustand, TanStack React Query |
| Backend | Hono, TypeScript, Cloudflare Workers |
| Database | Supabase (PostgreSQL), Row Level Security |
| Auth | Supabase Auth (email / password) |
| AI | Cloudflare Workers AI through the Worker's `AI` binding — Llama 3.3 70B, Gemma 4, Mistral Small 3.1 and Whisper; server-side only |
| Charts | Recharts |
| PDF/CSV | jsPDF, PapaParse, SheetJS |

---

## Prerequisites

- **Node.js** v18 or later
- **npm** v9 or later
- A **Supabase** project (free tier is fine for development)
- A **Cloudflare account** for the AI features: the Worker's `AI` binding (`wrangler.jsonc`) runs Workers AI on it, with no API key. Locally, `npx wrangler login` once; AI calls from `npm run dev` then run on that account and count against its daily allowance

---

## Local Setup

### 1. Clone & install dependencies

```bash
git clone https://github.com/MadScie254/ledger_link_254.git
cd ledger_link_254
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SECRET_KEY=sb_secret_your-secret-key     # backend only, never expose to client
# SUPABASE_SERVICE_ROLE_KEY still works as a fallback, but Supabase retires
# legacy service_role keys at the end of 2026.
PORT=3001
NODE_ENV=development
ENABLE_SEED_DATA=false                              # set to true for dev/staging demo data

# Vite only exposes VITE_-prefixed vars to the browser — the frontend Supabase
# client (src/lib/supabase.ts) reads these, separately from the server-only
# vars above. Use the same project URL and anon key.
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

> ⚠️ **Never commit `.env`** — it is listed in `.gitignore`. Only `.env.example` is committed.

### 3. Run database migrations

Apply the Supabase schema migrations via the Supabase CLI or MCP:

```bash
# Using Supabase CLI (if installed)
supabase migration list
# Review and resolve history mismatches before pushing.
supabase db push
supabase migration list | node scripts/check-migrations.ts
```

Or apply them manually from the `supabase/migrations/` directory in the Supabase dashboard.
The check compares every local migration version with the remote history and exits non-zero
if either side has a migration the other lacks. Run it after applying migrations and before
deploying the Worker. Review `supabase migration list` and resolve any history mismatch
before running `supabase db push`; a missing history row does not prove its SQL is absent.
See [the production migration history](docs/production-migration-history.md) for the
legacy version aliases in this project.

### 4. Start the development server

```bash
npm run dev
```

The app starts at **http://localhost:5173**. The `@cloudflare/vite-plugin` runs the API
(`worker/index.ts`, a Hono app) inside the real Workers runtime (via `workerd`/Miniflare)
alongside the Vite frontend, so local dev closely matches production.

---

## Deploying to Cloudflare

The whole app — frontend and API — deploys as a single Cloudflare Worker with static assets.

### 1. Authenticate Wrangler (one-time)

```bash
npx wrangler login
```

### 2. Set secrets

Non-secret config (`SUPABASE_URL`, `ALLOWED_ORIGINS`, `NODE_ENV`) lives in `wrangler.jsonc`.
Set the real secret once per environment:

```bash
npx wrangler secret put SUPABASE_SECRET_KEY
```

The AI features need no secret: the `ai` binding in `wrangler.jsonc` gives the Worker Workers AI on its own Cloudflare account. The Workers Free plan includes 10,000 Neurons a day across the account; each organization may use 4,000 of them a day unless `AI_DAILY_UNITS_PER_ORG` is set.

### Automatic deploys from `main`

The `ledgerlink` Worker is connected to this repository through Cloudflare Workers Builds
(Worker → Settings → Builds): every push to `main` runs `npm run build`, then
`npx wrangler deploy`, on Cloudflare. The browser build values come from `.env.production`
(public by design); the Worker's secrets stay in Cloudflare. Build logs are under the Worker's
Deployments in the dashboard, and each commit on GitHub shows the build as a check.

Supabase applies new migrations from the same push, a few minutes later. A push that adds a
migration together with code that calls it can therefore reach users before the database has
it. Push the migration on its own first, confirm it is applied (`supabase migration list`, or
`supabase_migrations.schema_migrations` in production), then push the code that uses it.

### 3. Apply database migrations, then build and deploy by hand

Apply new migrations first, so the Worker never calls a function the database does not yet have:

```bash
supabase db push
npm run deploy
```

`wrangler.jsonc` also registers a daily cron trigger (00:17 UTC) that posts recurring invoices and
bills that have fallen due; it needs no extra setup.

This runs `vite build` (produces `dist/client/` for static assets and bundles the Worker),
then `wrangler deploy`. Wrangler prints the live `*.workers.dev` URL — update `ALLOWED_ORIGINS`
in `wrangler.jsonc` to match it (or your custom domain) and redeploy if it changes.

`npm run build` alone builds without deploying; `npx wrangler dev` runs the built Worker
directly against the real Workers runtime for a final check before deploying.

---

## Project Structure

```
ledger_link/
├── src/
│   ├── components/          # React UI components, organized by domain
│   │   ├── accounting/      # Chart of accounts, journal entries
│   │   ├── auth/            # Login page (email/password)
│   │   ├── banking/         # Bank reconciliation
│   │   ├── common/          # Shared modals, tables, form components
│   │   ├── dashboard/       # KPI dashboard
│   │   ├── expenses/        # Expenses & receipt scanner
│   │   ├── invoices/        # A/R invoicing
│   │   ├── layout/          # App shell, sidebar, header, theme toggle
│   │   ├── payroll/         # Payroll management
│   │   ├── reports/         # Financial reports
│   │   └── ...
│   ├── context/             # React contexts (Auth, Tenant)
│   ├── hooks/               # Custom React hooks
│   ├── server/              # Backend domain services (framework-agnostic; used by worker/)
│   │   ├── supabase.ts      # Supabase admin client (service role)
│   │   ├── accounts.ts      # Chart of accounts service
│   │   ├── ledger.ts        # Double-entry ledger service (calls Postgres fn)
│   │   ├── banking.ts       # Banking & reconciliation service
│   │   └── ...              # Other domain services
│   ├── store.ts             # Zustand global state
│   └── utils/               # Shared utilities (API client, currency, PDF export)
├── worker/                  # Cloudflare Worker entry point (Hono)
│   ├── index.ts             # All API routes, mounted at /api/*
│   └── auth.ts              # Auth/org-membership middleware
├── supabase/
│   └── migrations/          # SQL migration files
├── wrangler.jsonc           # Cloudflare Worker + static assets configuration
├── vite.config.ts           # Vite configuration (includes @cloudflare/vite-plugin)
├── .env.example             # Environment variable template
└── package.json
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (Vite + Worker via `@cloudflare/vite-plugin`) |
| `npm run build` | Build for production (client assets + Worker bundle) |
| `npm run preview` | Preview the production build locally |
| `npm run deploy` | Build and deploy to Cloudflare Workers |
| `npm run lint` | TypeScript type-check |
| `npm test` | Unit tests |
| `npm run test:db` | SQL tests, each on a freshly migrated local Postgres 16 |
| `npm run test:integration` | Worker services against PostgREST and Postgres |
| `npm run test:e2e` | Browser flows through the real Worker (workerd), PostgREST and Postgres |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push and open a Pull Request

---

## License

[MIT](LICENSE) © LedgerLink Contributors
