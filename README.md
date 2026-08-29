# LedgerLink 📒

> **Corporate-grade, multi-currency accounting & financial operations platform.**  
> Built for East African businesses (and beyond) — double-entry bookkeeping, real-time
> banking reconciliation, payroll, invoicing, and AI-powered receipt scanning.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Stack: React 19 + Vite + Express + Supabase](https://img.shields.io/badge/Stack-React%2019%20%2B%20Vite%20%2B%20Express%20%2B%20Supabase-green.svg)](#tech-stack)

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
- 🔐 **Passwordless auth** — Supabase magic link (OTP-via-email) with row-level security
- 🌙 **Light/dark theme** — corporate light default, toggleable dark mode

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4 |
| State | Zustand, TanStack React Query |
| Backend | Express.js, TypeScript, Node.js |
| Database | Supabase (PostgreSQL), Row Level Security |
| Auth | Supabase Auth (magic link / OTP) |
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

The app starts at **http://localhost:3001** (Express serves both the API and the Vite-built frontend).

---

## Project Structure

```
ledger_link/
├── src/
│   ├── components/          # React UI components, organized by domain
│   │   ├── accounting/      # Chart of accounts, journal entries
│   │   ├── auth/            # Login page (magic link)
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
│   ├── server/              # Express backend
│   │   ├── supabase.ts      # Supabase admin client (service role)
│   │   ├── routes.ts        # All API routes with zod validation
│   │   ├── accounts.ts      # Chart of accounts service
│   │   ├── ledger.ts        # Double-entry ledger service (calls Postgres fn)
│   │   ├── banking.ts       # Banking & reconciliation service
│   │   └── ...              # Other domain services
│   ├── store.ts             # Zustand global state
│   └── utils/               # Shared utilities (API client, currency, PDF export)
├── supabase/
│   └── migrations/          # SQL migration files
├── server.ts                # Express entry point
├── vite.config.ts           # Vite configuration
├── .env.example             # Environment variable template
└── package.json
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (Express + Vite HMR) |
| `npm run build` | Build for production (Vite frontend + esbuild server) |
| `npm start` | Start production server |
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
