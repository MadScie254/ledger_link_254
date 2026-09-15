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
- 📊 **Double-entry ledger** — journal entries validated atomically in Postgres; `SUM(debit) = SUM(credit)` enforced server-side, never client-side
- 🏦 **Banking & reconciliation** — AI-assisted transaction matching with full audit trail
- 🧾 **Invoicing & bills** — full A/R and A/P workflow with multi-currency support
- 💰 **Payroll** — employee management and payroll run processing
- 📦 **Inventory** — stock tracking with COGS accounting
- 🤖 **Receipt scanner** — AI-powered OCR via Gemini (vendor, amount, date extraction)
- 📈 **Reports** — P&L, Balance Sheet, Cash Flow, Trial Balance, Tax Summary
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
| AI | Google Gemini API (`@google/genai`) — server-side only |
| Charts | Recharts |
| PDF/CSV | jsPDF, PapaParse, SheetJS |

---

## Prerequisites

- **Node.js** v18 or later
- **npm** v9 or later
- A **Supabase** project (free tier is fine for development)
- A **Gemini API key** (from [Google AI Studio](https://aistudio.google.com/apikey)) — server-only, never committed

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
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key    # backend only, never expose to client
GEMINI_API_KEY=your-gemini-api-key                 # backend only, never expose to client
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
supabase db push
```

Or apply them manually from the `supabase/migrations/` directory in the Supabase dashboard.

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
Set the two real secrets once per environment:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put GEMINI_API_KEY
```

### 3. Build and deploy

```bash
npm run deploy
```

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

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push and open a Pull Request

---

## License

[MIT](LICENSE) © LedgerLink Contributors
