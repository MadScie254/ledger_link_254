# Ledger Link codebase audit: engineering gaps, risks and what to build next

_Repo `/home/user/ledger_link_254`, branch `ccr-af7d00fb-cvlafc`, code audited at `144ee4a` (2026-09-28). The later commit `6e2b82d` only adds research notes. Unless marked as a URL, every source is a repo path with line numbers; the code itself is the primary source. Ratings: **Severity** critical / high / medium / low; **Effort** S (under 1 day), M (1–5 days), L (over 1 week)._

**Commands run (read-only):**
- `npm test`: 48 of 48 tests pass across 6 files.
- `npx tsc --noEmit` (this is `npm run lint`): **fails with 21 errors, exit 2**.
- `npx vite build --outDir <scratchpad>`: builds. Sizes are under Performance.
- `npm audit --omit=dev`: 1 low (dompurify, pulled in through jspdf).
- `git log`.

**External checks** (docs MCP tools; general web fetching was blocked):
- Cloudflare Workers limits/changelog: Free plan is **50 external subrequests per invocation**; Paid defaults to 10,000.
- Supabase SSR auth guide: `getClaims()`; legacy `service_role` keys "work until the end of 2026".

**Headline: top 12 items by severity**

| # | Item | Severity | Effort |
|---|---|---|---|
| 1 | Accountant role cannot post anything at the DB layer | high | S |
| 2 | AR/AP subledger drifts from the GL through bank matching, manual journals and the lack of payment reversal | critical | M |
| 3 | Unpaginated reads are silently truncated at PostgREST max-rows (dashboard, chart-of-accounts balances, GL export, journal list, budgets, reconciliation) | critical | M |
| 4 | Reports and the dashboard load the whole ledger into the Worker; this breaks the 50-subrequest Free-plan ceiling as data grows | high | M |
| 5 | No period close or lock date | high | M |
| 6 | eTIMS is a stub that only writes a `NOT_CONFIGURED` row | high | L |
| 7 | No bank, M-Pesa or CSV import; banking is unusable outside the demo seed | high | M–L |
| 8 | Unvalidated bodies on ~20 write routes | high | M |
| 9 | Security headers never reach the SPA | high | S |
| 10 | `tsc` fails (no `@types/react`), there is no CI, and no DB or API tests | high | S–M |
| 11 | Employee allowances silently dropped; payroll is base salary only, and legally required reliefs are unsupported | high | M |
| 12 | Base currency can be edited after posting | high | S |

---

## 1. Security & multi-tenancy (RLS completeness, service-role use, validation, rate limiting, CORS, headers/CSP, MFA, sessions, SECURITY DEFINER, audit tamper-resistance)

### Takeaway
The Worker verifies the Supabase JWT and re-checks org membership on **every** `/api` request, then runs all queries with the secret/service key. RLS therefore never applies to app traffic. Tenant isolation rests on:
- each service adding `.eq('org_id', …)`;
- composite `(org_id, id)` foreign keys;
- `SECURITY DEFINER` RPCs that re-check the actor.

That core is well built, and I found no route that reads or writes another tenant's rows. The real gaps are:
- a broken accountant role at the DB layer;
- unvalidated bodies;
- headers that never reach the HTML;
- no rate limiting;
- no MFA or password reset;
- ledger and audit immutability that relies on RLS, which does not bind `service_role`.

### Cited Findings
- **[HIGH, S] Accountant role cannot post.**
  - `private.require_financial_actor` rejects anything but `owner`/`admin` — `supabase/migrations/20260917172909_add_atomic_financial_workflows.sql:36`.
  - `accountant` was added later — `supabase/migrations/20260928150000_add_accountant_membership_role.sql:10` (commit fb2aabe). It is a Worker write role (`worker/auth.ts:18`), and PRODUCT.md:53 says accountants "post to the books".
  - No migration updates the guard. All 8 callers raise "An organization owner or administrator is required.": journal :280, invoice :372, bill :619, invoice payment :858, bill payment :1050, void invoice :1229, void bill :1323, payroll :1448.
  - Fix: one `CREATE OR REPLACE` adding `'accountant'`, plus a pgTAP test.
- **Per-request auth flow is correct but costly** (`worker/auth.ts:36-92`):
  - `supabase.auth.getUser(token)` makes a network call to Supabase Auth on every request (:45).
  - `x-org-id` must be a UUID (:64).
  - Membership lookup (:68-73); writes need owner/admin/accountant (:85).
  - User-scoped exemptions cover only `GET/POST /api/organizations` and `GET/PATCH /api/onboarding` (:22-28).
  - `requireRequestedOrganization` pins `/organizations/:id` to the selected org (:102-107).
  - So each API call spends **2 subrequests before doing any work**. The Supabase guide recommends `getClaims()`, which "validates the JWT signature against the project's published public keys" locally — [Supabase SSR client guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
- **Service key everywhere.**
  - `src/server/supabase.ts:10-20` builds a new secret-key client on every service call. There is no per-request user-JWT client, unlike Supabase's Hono example, which creates a request-scoped client so "RLS enabled… auth token is automatically sent" — [Supabase SSR client guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
  - Browser roles lost all table privileges (`supabase/migrations/20260917172922_grant_financial_data_api_access.sql:12-39`, good). `service_role` has `SELECT/INSERT/UPDATE/DELETE` on all 26 tables, including `journal_entries`, `journal_lines` and `audit_logs` (:41-68).
- **[MEDIUM, S] Legacy key deadline.**
  - README tells operators to `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (README.md:131).
  - Supabase says legacy `anon`/`service_role` keys "will work until the end of 2026" — [Supabase SSR client guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
  - The code already prefers `SUPABASE_SECRET_KEY` (`src/server/supabase.ts:6`), so only README and deploy secrets need updating before 2027.
- **[MEDIUM, M] Immutability is policy-only.**
  - `…enforce_journal_entry_immutability.sql:7-12` only drops or denies RLS UPDATE/DELETE, and RLS does not bind `service_role`.
  - The generic policy loop also created an **UPDATE policy on `audit_logs`** (`…003_rls_policies.sql:262-287`; `audit_logs` is in the list at :272).
  - There are no `BEFORE UPDATE OR DELETE` triggers on `journal_entries`, `journal_lines`, `invoice_payments`, `bill_payments`, `payslips` or `audit_logs`.
  - Any Worker bug or leaked secret can rewrite posted history. Fix:
    - add raise-on-modify triggers;
    - revoke UPDATE/DELETE from `service_role` on those tables;
    - optionally hash-chain audit rows.
- **[MEDIUM, S] App-level audit writes are fire-and-forget and sparse.**
  - `src/server/audit.ts:4-15` never checks `error`.
  - Only `accounts.ts:62,118` and `team.ts:112,152,187` call it. Customers, vendors, employees (including salary and bank account changes), inventory, projects, budgets, bank rules, org settings and bulk deletes (`worker/index.ts:698-753`) are **not audited**.
  - RPC workflows do write audit rows in-transaction (e.g. `…atomic_financial_workflows.sql:312-317, 564-569`).
  - `getLogs` returns only the last 50 rows, with no paging or filter (`src/server/audit.ts:18-25`).
- **[HIGH, M] Unvalidated JSON on ~20 write routes.**
  - zod covers only invoices, bills, payments, journals, bulk ops and onboarding (`worker/index.ts:92-176`).
  - Raw `await bodyOf(c)` reaches `input: any` services on these routes:
    - `POST/PATCH/DELETE /team` (:260-281)
    - `/accounts`, `/accounts/bulk`, `/accounts/undo-bulk` (:291-313)
    - budgets (:358-379)
    - banking match, rules and connection requests (:394-455)
    - customers (:464-476), vendors (:520-532)
    - `/expenses/scan` (:578-586), `/ai/ask` (:589-598)
    - employees (:607-619), `/payroll/runs` (:633-640)
    - inventory (:649-661), projects and time entries (:670-695)
    - organizations POST/PUT (:771-783), currency (:786-800)
  - `:id` params are UUID-checked only for invoices and bills.
  - Examples of the effect:
    - `base_salary` can be set to any JSON value (`src/server/payroll.ts:150`);
    - `currency` is free text (`src/server/customers.ts:252`);
    - `manager_id` accepts any auth user (`src/server/projects.ts:59`);
    - receipt image size and MIME type are unchecked (`worker/index.ts:580-583`).
  - Best practice for Hono is `@hono/zod-validator` per route with shared schemas reused on the client.
- **[HIGH, S] Base currency editable after posting.** `OrganizationService.updateOrganization` writes `base_currency` without checking for journals (`src/server/organizations.ts:161`). Every historical line would be reinterpreted. Block this once any journal exists.
- **[HIGH, S] Security headers never reach the app shell.**
  - The header and CSP middleware runs on the Hono app (`worker/index.ts:38-55`).
  - But `wrangler.jsonc:8-11` sets `run_worker_first: ["/api/*"]` with `not_found_handling: single-page-application`, so `index.html` and assets come straight from Static Assets.
  - There is no `public/_headers` (directory listing). The SPA therefore ships **without CSP, X-Frame-Options/frame-ancestors or HSTS**, which allows clickjacking, and the CSP applies only to JSON responses.
  - Static Assets support `_headers` (100 rules) — [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
  - `index.html:36` has an inline `<script>`, which needs a CSP hash. Google Fonts are third-party (`index.html:14-19`).
- **[MEDIUM, S] CORS.** `worker/index.ts:35,58-64`:
  - no-Origin requests are allowed;
  - `credentials: true` is unnecessary because auth is a Bearer header;
  - the allow-list silently falls back to localhost if `ALLOWED_ORIGINS` is unset.
- **[MEDIUM, M] No rate limiting** (no binding in `wrangler.jsonc`, no middleware). Cost and abuse vectors:
  - Gemini OCR and Q&A (`src/server/gemini.ts:70`, `src/server/aiInsights.ts:149`);
  - Supabase invite emails (`src/server/team.ts:87`);
  - unbounded `POST /organizations`;
  - forced third-party FX refresh (`/currency/refresh`, `src/server/currency.ts:68-151`).
- **[MEDIUM, M] Team invites.**
  - `addMember` pages through **every user in the Supabase project** (all tenants) 200 at a time to find an email (`src/server/team.ts:74-84`). That is O(total users) subrequests and will breach the 50-subrequest Free ceiling at about 10k users.
  - An existing user is attached immediately, with no acceptance step (:103-107); `status` is hard-coded `'Active'` (:52).
  - `getMembers` calls `auth.admin.getUserById` once per member, an N+1 (:37-56).
- **[MEDIUM, S] Least privilege.** The read-only `member` role can `GET /employees`, which exposes salaries, KRA PINs and bank accounts (`worker/index.ts:601-605`, `src/server/payroll.ts:77-107`), plus `/audit` and `/team`. There is no payroll-sensitive permission.
- **[MEDIUM, M] No MFA and no password reset.**
  - There is no `supabase.auth.mfa` and no `resetPasswordForEmail` anywhere in `src/` (grep).
  - `src/context/AuthProvider.tsx:83-105` offers only password sign-in and sign-up.
  - For finance apps, TOTP MFA enforced for owner, admin and accountant (checking `aal2` in `worker/auth.ts`) is standard.
  - Positive: a 15-minute inactivity lock exists (`src/components/settings/SettingsView.tsx:401-404`).
- **[LOW, S] Global `window.fetch` monkey-patch and duplicated token.**
  - `src/utils/api.ts:19-53`, with the token copied into a custom localStorage key (`src/context/AuthProvider.tsx:47-51`).
  - It works (refreshes flow through `onAuthStateChange`), but it is hidden global behaviour and widens XSS impact.
  - Most views also hand-roll `fetch` with headers; there are 40+ call sites (grep).
- **[LOW, S] `base` query param interpolated into the upstream FX URL** without ISO validation (`src/server/currency.ts:69,78,105`).
- **[LOW, S] CSV exports lack formula-injection guarding.** `src/utils/exportCsv.ts:3-6` quotes but does not neutralise leading `= + - @`. Customer and vendor names are user data.
- **Positives:**
  - Later SECURITY DEFINER functions use `SET search_path = ''` with qualified names (e.g. `…atomic_financial_workflows.sql:15-16, 274-275`).
  - Privileged helpers live in a `private` schema with EXECUTE revoked (:42-43, 71-72, 254-256).
  - Workflow RPCs are `service_role`-only (`…grant_financial_data_api_access.sql:79-117`).
  - Secrets are set via `wrangler secret` (`wrangler.jsonc:14-16`), and `.env*` is git-ignored (`.gitignore:7`).
- **RLS coverage per table:** every table has RLS enabled.
  - Business tables: select/insert/update for **any** member via `user_has_org_access`, with no role awareness (`…003_rls_policies.sql:262-312`).
  - `journal_lines`: select and insert only (:317-332).
  - `document_counters`: select only (`…fix_etims_and_counters_schema.sql:51-54`).
  - Document lines and payments: select only (`…harden_financial_integrity.sql:405-421`).
  - `payroll_runs`/`payslips`: select and insert (`…add_payroll_runs_table.sql:42-57`).
  - `user_profiles`: own row only (`…add_user_onboarding.sql:19-26`).
  - No table is missing RLS. The policies are coarse but moot while browser roles hold no table grants.

### Inferences
- Moving to request-scoped user-JWT clients (with `getClaims()`) for reads would make RLS a real second line of defence and drop one auth subrequest per call. Keeping service-role only for the workflow RPCs is the recommended Supabase pattern. Effort M.
- The single highest-value security fix is S-effort: `_headers` for the SPA plus fixing the accountant guard.

### Gaps
- I could not inspect the live Supabase project's Auth settings: MFA factors, password policy, leaked-password protection, SMTP, JWT signing-key type. I also could not check the PostgREST max-rows setting.

---

## 2. Financial integrity (double entry, immutability, reversals, period locks, numeric/rounding, FX, idempotency, concurrency, payroll atomicity)

### Takeaway
The database core is strong:
- balanced-entry enforcement in `private.insert_journal_entry`;
- integer-cent checks;
- cross-tenant FK guards;
- idempotency keys with advisory locks;
- atomic invoice, bill, payment, void and payroll RPCs.

Integrity breaks at the **edges**. Bank matching, manual journals and the absence of payment or journal reversal let the GL and the AR/AP subledgers drift apart. There is no period close or lock date. FX settlement never books realised gains or losses, and rates come from free unofficial APIs. Several read paths silently truncate.

### Cited Findings
- **Double entry, enforced in SQL.** `private.insert_journal_entry` does all of the following:
  - requires 2 or more lines and integer non-negative cents with exactly one non-zero side (`…atomic_financial_workflows.sql:110-155`);
  - checks that each account is active and in the org (:157-165), and validates entities against the org (:188-209);
  - checks currency and foreign-side consistency (:167-186);
  - raises if debits ≠ credits or the total is ≤ 0 (:215-218).
  - The public `post_journal_entry` only allows `MANUAL/ADJUSTMENT` or an org-owned `BANK` source (:281-294). Other source types are reserved for atomic workflows. It writes an audit row in the same transaction (:312-317).
  - The Worker pre-validates balance with zod (`worker/index.ts:149-170`).
- **[MEDIUM, S] Column type mismatch.** `journal_lines.debit/credit` are `NUMERIC(14,2)` (`…001_core_tables.sql:87-88`) but store integer **cents** (comments in `src/server/accounts.ts:181-182`). That caps each line at 999,999,999,999 cents (≈KES 10 bn) and confuses anyone reading the schema. Every other money column is `BIGINT` cents (e.g. `…002_business_tables.sql:61-64`).
- **Idempotency and concurrency.**
  - Invoice, bill, payment and payroll RPCs require a key and take `pg_advisory_xact_lock(hashtextextended(org||key))` (`…atomic_financial_workflows.sql:374-387, 859-888, 1453-1465`).
  - Payment replay with different parameters is rejected (:875-881).
  - Unique partial indexes back this up (`…harden_financial_integrity.sql:225-240`).
  - Invoice and bill numbers come from `private.next_document_number` using `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the same transaction. This is row-lock-serialised and gap-free unless the transaction rolls back (:45-69, 491-492).
  - The client generates one UUID per form (`src/components/sales/InvoiceBuilder.tsx:46`, `src/components/accounting/AccountingView.tsx:35`, `src/components/expenses/ExpensesView.tsx:29`).
  - **[LOW, S]** Batch bill pay mints a fresh key on every call (`src/components/expenses/ExpensesView.tsx:118-130`), so a retry is not idempotent. The risk is largely contained: each payment is for the full `amountDueCents`, so the RPC rejects a second payment on an already-PAID bill. Stale client amounts on a partially paid bill could still double-apply.
  - Manual journals make the key optional (`worker/index.ts:162`).
- **[CRITICAL, M] GL and subledger drift.** There are three ways for the two to diverge:
  - **Bank matching.** `BankingService.matchTransaction` posts Dr/Cr bank 1000 against any target account, including AR 1100 or AP 2000 when the "AI" matched an invoice or bill. It never applies the payment to the invoice or bill (`src/server/banking.ts:383-420`). `amount_due_cents` and `customers.balance` stay open while the GL says they are paid.
  - **Manual journals.** These can hit control accounts 1100 and 2000 directly. Nothing blocks control accounts in `post_journal_entry` (`…atomic_financial_workflows.sql:281-294`).
  - **No payment reversal.** There is no reverse-payment RPC; the only functions are create, pay, void and payroll (`…grant_financial_data_api_access.sql:79-117`). Voiding a paid invoice is refused with "reverse its payments first" (`…atomic_financial_workflows.sql:1246-1252`), which leaves no path at all.

  Fixes:
  - a `reverse_payment` RPC;
  - "apply bank line to invoice/bill" calling `receive_invoice_payment`/`pay_bill`;
  - a control-account flag that blocks manual posting;
  - a nightly "subledger vs GL" check.
- **[HIGH, M] No period close or lock date.** Grep finds no lock date, closed period or year-end close anywhere in `src/` or `supabase/`.
  - Any writer can post or backdate into any past period: `entry_date` is free (`worker/index.ts:158`), and payments only need a date (`…atomic_financial_workflows.sql:890-892`).
  - `fiscal_year_start` is stored but ignored by reports; "last financial year" means the calendar year (`src/utils/reportCalculations.ts:143-149`).
  - The balance sheet shows all-time "Current-period earnings (unclosed)" (`src/utils/reportCalculations.ts:250-269`), with no closing to retained earnings 3100.
  - Fix: an `organizations.lock_date` checked inside `insert_journal_entry`, plus a year-end close RPC.
- **[MEDIUM, M] No manual-journal reversal** endpoint or UI. Corrections need a hand-keyed opposite entry. Void exists only for invoices and bills, as full reversals dated today (`src/server/invoices.ts:212-221`). There are **no credit notes** (grep), which matter for eTIMS.
- **[HIGH, M] FX correctness gaps.**
  - **Payment amounts.** Payments are entered in **base** cents and applied at the invoice's booked rate (`…atomic_financial_workflows.sql:936-951, 961-975`). The settlement difference against the payment-date spot rate is never computed, so there are **no realised FX gain/loss postings**. Account 8100 is seeded but unused (`src/server/organizations.ts:229`). IAS 21 requires the settlement difference in P&L.
  - **Unrealised FX.** It is computed on the fly from a free API (`src/server/currency.ts:157-298`) and **never journalised**; there is no revaluation or reversal RPC. PRODUCT.md:49 claims "the currency service with unrealised-FX journals". Foreign bank balances are omitted (`src/server/currency.ts:261-263`).
  - **Rate source.** Rates come from `open.er-api.com` / `exchangerate-api.com` with hard-coded fallbacks (`src/server/currency.ts:43-56, 78, 105`), not CBK, and no dated rate table is stored for reproducibility.
  - **Rate convention.** Rates are foreign-per-KES (e.g. `USD: 0.00775`; `src/utils/currency.ts:110-123`, `…atomic_financial_workflows.sql:464-468`). That is the inverse of how Kenyan users quote rates (KES per USD) and invites entry errors.
  - **Hard-coded base.** The dashboard hard-codes base `'KES'` (`src/server/metrics.ts:114`).
- **[MEDIUM, S] Display-currency translation uses unreliable, browser-local rates.** `formatCurrency` multiplies every amount by the store rate for the chosen display currency (`src/utils/currency.ts:175-195`). Display currency defaults to the org base (`src/App.tsx:137`), so the default view is unconverted. The problems start when the user switches currency:
  - The Reports page lets the user switch and shows a disclosure: "translated… at the latest stored rate, not the rate on each transaction's date" (`src/components/reports/ReportsView.tsx:83-100`).
  - The rate can be **hard-coded fallback rates** (`src/utils/currency.ts:110-123`; `src/store.ts:75`) or a **hand-typed rate kept only in that browser** (`src/components/settings/SettingsView.tsx:105-114`). Two users can therefore print different "USD" statements from the same books.
  - Translating P&L at a closing rate is also not IAS 21 presentation-currency practice, which uses transaction or average rates for income and expenses.
  - Fix: server-side translation using stored, dated rates, with the rate and date printed on every export.
- **[MEDIUM, S] Floating-point money in JS.**
  - Client parsing uses `Math.round(parseFloat(x)*100)` (`src/components/sales/InvoiceBuilder.tsx:24`, `src/components/sales/SalesView.tsx:157`, `src/components/common/DynamicQuickAddModal.tsx:173-253`). This is acceptable at KES magnitudes.
  - VAT is computed **client-side** per line from a free-text rate and trusted by the server, which only checks tax ≥ 0 (`src/components/sales/InvoiceBuilder.tsx:117`, `…atomic_financial_workflows.sql:444`). There are no tax codes (16 %, 8 %, 0 %, exempt).
  - Dashboard monthly trends round each line to whole shillings (`src/server/metrics.ts:96,104`).
- **[CRITICAL, M] Silent truncation of unpaginated reads.** Supabase caps each API response at the project "Max rows" setting, 1,000 by default. That figure is background knowledge per the [supabase-js select() reference](https://supabase.com/docs/reference/javascript/select), not re-fetched this session. `src/server/reports.ts:15-34` already pages in 1,000-row chunks, so the developers know the cap applies. These paths do **not** page and will silently under-report:
  - `AccountService.getAccountBalances`, which drives chart-of-accounts balances, budgets "spent" and the reconciliation GL balance (`src/server/accounts.ts:164-188`; used by `src/server/budgets.ts:212`, `src/server/banking.ts:150`);
  - `LedgerService.getJournalEntries`, which drives the journal list, dashboard and **Settings "export general ledger" CSV** (`src/server/ledger.ts:37-48`; `src/components/settings/SettingsView.tsx:116-140`);
  - `DashboardService.getMetrics` (`src/server/metrics.ts:59-70`);
  - invoices, bills and customers lists (`src/server/invoices.ts:122-132`);
  - bank transactions (`src/server/banking.ts:21-27`).
- **[HIGH, S] Dashboard metrics are wrong today, before truncation.** In `src/server/metrics.ts`:
  - "Money in" sums `total_cents` of every invoice not `PAID`, **including VOID**, and ignores partial payments (:9-28). Bills have the same problem (:31-42).
  - `cashPositionCents` sums **all ASSET accounts**, including AR, inventory and VAT recoverable (:90-92).
  - Monthly trends bucket by month name only, so January 2025 and January 2026 are merged (:82, 120-123).
  - A dead `journal_lines` query filters on `journal_entries.org_id` without embedding that relation and is never used (:45-56). PostgREST most likely rejects it; either way it is a wasted subrequest, and its error is never checked.
- **[MEDIUM, S] Budgets compare against lifetime balances.** `spentCents` ignores the budget's `period` (`src/server/budgets.ts:212-223`).
- **Payroll atomicity is good, with gaps.**
  - `run_payroll_with_journal` validates every payslip identity (net = gross − deductions), rate-version consistency, duplicate employees, active employees and account codes. It posts one journal and writes run and payslips atomically (`…atomic_financial_workflows.sql:1399-1650`).
  - **[MEDIUM, S]** Uniqueness is on free-text `period` (`…add_payroll_runs_table.sql:23`, `src/server/payroll.ts:173`). "August 2026" and "Aug 2026" can both run.
  - **[MEDIUM, M]** Net pay is credited straight to cash 1000 (`src/server/payroll.ts:10`), with no net-salaries-payable or M-Pesa B2C/bank disbursement step. There is no payroll reversal RPC.
  - **[LOW, S]** Statutory amounts are computed in TS and only cross-checked for internal consistency in SQL. That is acceptable because the TS runs server-side (`src/server/payroll.ts:195-210`).
- **[MEDIUM, M] Non-atomic multi-step service flows.**
  - `createOrganization` runs three statements without a transaction, and the seed failure path leaves an org with no accounts (`src/server/organizations.ts:108-154`).
  - `matchTransaction` posts the journal, then updates the bank row separately (`src/server/banking.ts:411-436`). It is mitigated by the `bank-match:{id}` idempotency key.
  - `autoReconcileAll` loops sequentially (`src/server/banking.ts:332-352`).
- **[HIGH, M] "AI" bank matching is keyword heuristics with invented confidence scores**, and auto-reconcile posts at ≥ 85 (`worker/index.ts:397`). For example:
  - any description containing "TOTAL" becomes fuel expense at 95 % (`src/server/banking.ts:276`);
  - "M-PESA" becomes Sales Revenue at 94 % (:220-229);
  - invoices match on `inv.customerName` and `inv.totalAmount`, fields `mapInvoice` never returns (`src/server/banking.ts:200-202` vs `src/server/invoices.ts:63-87`);
  - status is not filtered, so PAID or VOID invoices can match.

### Inferences
- The two **critical** items (subledger drift and truncation) both silently produce wrong numbers. That directly undermines the product's stated success metric, "a finance director trusting the numbers" (PRODUCT.md:26). They should precede any new feature work.
- Moving balances and reports into SQL (views or RPCs returning per-account sums, ideally with a `gl_balances` table maintained in `insert_journal_entry`) fixes truncation, subrequest blow-ups and performance in one change.

### Gaps
- I could not run the SQL against a database to prove the accountant failure or truncation empirically. There is no local Supabase config, so these conclusions come from code reading.

---

## 3. Compliance logic (kenyaPayroll.ts, statutory.ts, etims.ts vs current Kenyan rules)

### Takeaway
The coded **rates are current and effective-dated in code** and match the team's regulation notes as of 1 Oct 2026:
- PAYE 10 / 25 / 30 / 32.5 / 35 % with KES 2,400 relief;
- SHIF 2.75 % (minimum 300), deductible;
- AHL 1.5 %, deductible;
- NSSF Year 3 at 8,000 / 72,000 and Year 4 at 9,000 / 108,000, at 6 % + 6 %;
- a 30,000 pension cap.

The gaps are breadth and mechanics:
- tables are hard-coded and keyed on pay date rather than pay period;
- reliefs the Finance Act 2025 makes mandatory are unsupported;
- allowances are silently dropped;
- there is no NITA, HELB, P10, P9 or remittance files;
- the statutory calendar has no holidays or WHT/TOT deadlines;
- eTIMS is a stub.

### Cited Findings
- **Rates match.**
  - PAYE bands: `src/utils/kenyaPayroll.ts:62-68`. Relief, SHIF, AHL and pension cap: :70-76.
  - Effective-dated tables: KE-2024-12 (NSSF Year 2, 7,000 / 36,000) :80-90; KE-2025-02 (Year 3, 8,000 / 72,000) :91-101; KE-2026-02 (Year 4, 9,000 / 108,000) :102-112.
  - SHIF, AHL and NSSF (capped at 30,000) are deducted before PAYE (:221-229).
  - The regulation notes confirm bands and relief are unchanged by Finance Acts 2025 and 2026, that SHIF and AHL have been deductible since 27 Dec 2024, and the NSSF Year 4 values — `research_notes/Ledger Link improvement roadmap/kenya_ea_regulation.md` §§1–4 (citing [KRA Public Notice 2157](https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024) and [Workpay NSSF 2026](https://www.myworkpay.com/blogs/nssf-2026-phase-4-implementation)).
  - Employer NSSF and AHL match the employee amounts (`src/server/payroll.ts:205-206`). There is no employer SHIF (correct).
  - The rate version is stored per run and per payslip (`…harden_financial_integrity.sql:81-112`).
  - Payroll tests cover these rates (`src/utils/kenyaPayroll.test.ts`, 184 lines).
- **[MEDIUM, M] Hard-coded tables.** Changing them needs a deploy (`src/utils/kenyaPayroll.ts:79-113`). There is no DB-held, admin-auditable rate table. A PAYE relief bill (≤ 30k exempt, 25 % on 30–50k) is in public participation in October 2026 and could apply from 1 Jan 2027 — `kenya_ea_regulation.md` §1 (citing [Kenyans.co.ke](https://www.kenyans.co.ke/news/127103-treasury-delays-paye-relief-bill-again-sets-october-timeline)). NSSF Year 5 is due Feb 2027 (§2). The band model already supports arbitrary bands (`PayeBand[]`, :14-18), which is good.
- **[MEDIUM, S] Lookup by pay date, not period.** `findRateTable(payDate)` (`src/utils/kenyaPayroll.ts:135-143`, used at `src/server/payroll.ts:180,196`). A January payroll paid on 2 February picks Year 4 NSSF limits; KRA and NSSF key on earnings period — `kenya_ea_regulation.md` §1 Inferences.
- **[HIGH, M] Mandatory reliefs unsupported.** `UNSUPPORTED_EMPLOYEE_ADJUSTMENTS` lists pension above NSSF, mortgage interest, PRMF, non-cash benefits and exemptions (`src/utils/kenyaPayroll.ts:52-58`). The Finance Act 2025 (from 1 July 2025) obliges employers to grant all applicable deductions and reliefs — `kenya_ea_regulation.md` §1 (citing [payroll.org](https://payroll.org/news-resources/news/news-detail/2025/05/12/kenya-mandates-automatic-paye-tax-relief-starting-1-july-2025)). Insurance relief and the disability exemption are also missing.
- **[HIGH, S] Allowances and fields silently dropped.**
  - The employee form sends `housingAllowanceCents`, `transportAllowanceCents`, `nationalId`, `employmentType` and `mpesaNumber` (`src/components/common/DynamicQuickAddModal.tsx:240-256`).
  - `PayrollService.addEmployee` ignores them, and there are no columns (`src/server/payroll.ts:110-138`; `…002_business_tables.sql:106-126`).
  - Gross is `base_salary` only (`src/server/payroll.ts:196`), so PAYE, SHIF and AHL are under-deducted whenever allowances exist.
  - Also: monthly only (`pay_frequency` hard-coded, :125), no pro-rating, no casuals.
- **[LOW, S] Net-pay floor.** The KES 300 SHIF minimum can push net pay negative for tiny gross amounts. The DB rejects `v_net < 0` (`…atomic_financial_workflows.sql:1516`), which fails the **whole** run. Add a TS guard and a clear message.
- **[MEDIUM, M] Missing payroll statutory items and outputs.** None of these are in the code (grep):
  - NITA levy (KES 50 per employee per month, employer; flagged "verify" in `kenya_ea_regulation.md` §5);
  - HELB deductions;
  - P10 CSV (with sheet M for AHL), P9;
  - NSSF and SHIF returns;
  - bank or M-Pesa B2C payment files.
  - "SHA" vs "SHIF" labelling: account 2130 is named "SHA Payable" (`src/server/organizations.ts:217`), while the regulation notes say the fund is SHIF (§3).
- **[MEDIUM, S] statutory.ts.**
  - It correctly encodes PAYE, NSSF and SHA by the 9th, AHL by the 9th working day and VAT by the 20th, with weekend roll-forward (`src/utils/statutory.ts:7-11, 38-66`).
  - It has no public holidays; its own comment admits this (:9-10).
  - It omits the WHT and WHVAT (20th), TOT, installment tax, NITA and HELB (15 days) deadlines.
  - It uses browser-local `Date` (fine for EAT users).
- **[HIGH, L] eTIMS is a stub.**
  - `EtimsService.submitInvoice` only inserts `status: 'NOT_CONFIGURED'` (`src/server/etims.ts:8-16`). It is called best-effort after invoice creation (`src/server/invoices.ts:164-170`).
  - Missing: OSCU/VSCU integration, item tax categories, credit notes, buyer PIN validation, QR/CU numbers, and purchase-side capture.
  - Since 1 Jan 2026 KRA validates income and expenses against eTIMS, and expenses without eTIMS invoices are disallowed (ITA s.16(1)(c)) — `kenya_ea_regulation.md` §7 (citing [EY](https://taxnews.ey.com/news/2025-2471-kenya-revenue-authority-to-validate-income-and-expenses-in-income-tax-returns)).
  - PRODUCT.md:49 calls this "the eTIMS Type C draft"; the code holds no draft payload.
- **[MEDIUM, S] Tax summary.**
  - The 16 % VAT rate is a fixed label (`src/server/reports.ts:253-262`).
  - Withholding VAT is hard-coded to 0 (:263-266).
  - All non-void bills are treated as claimable input VAT, with no eTIMS-backed, exempt or zero-rated distinction (:222-230, 244).
  - The default period is hard-coded to `'August 2026'` (`worker/index.ts:226`).

### Inferences
- The fastest compliance wins are:
  - fix the dropped allowances and add allowance and benefit columns (S–M);
  - switch the rate lookup to pay period (S);
  - add per-employee relief and deduction certificates (M).
- After that, purchase-side eTIMS capture (record supplier CU invoice numbers, flag non-deductible expenses) is cheaper than full OSCU certification and directly protects customers' deductions.

### Gaps
- I did not verify the P10 template columns, the NITA amount or the Year 5 NSSF limits; the regulation notes mark these "verify".
- The `gemini-3.1-pro` model ID (`src/server/gemini.ts:71`) could not be verified as a valid production model name.

---

## 4. Testing & quality (coverage, integration/e2e, CI, lint/format, type safety, error handling, logging/monitoring, Workers observability)

### Takeaway
Only pure utilities are tested: 48 tests in 6 files. There are no tests for the Worker, the services, the 3,400 lines of SQL, the UI, accessibility or end-to-end flows, and there is no CI at all. The repo's only static check, `npm run lint` (`tsc --noEmit`), **currently fails** because `@types/react` is not installed. Observability is `console.*` plus Workers Logs, with no error tracking.

### Cited Findings
- **Tests.**
  - The `test` script covers only `src/utils/*.test.ts`, onboarding and documentation tests (`package.json:12`).
  - Files: `kenyaPayroll.test.ts` (184 lines), `reportCalculations.test.ts` (193), `businessTypes.test.ts` (76), `companyMark.test.ts` (25), `tourSteps.test.ts` (100), `documentationContent.test.ts` (57). All 48 pass (`npm test`).
  - Untested:
    - all of `worker/` and `src/server/` (~3,700 lines; `wc -l`);
    - every migration and RPC (e.g. the 1,656-line `…atomic_financial_workflows.sql`);
    - all React components.
  - There is no `supabase/tests` (pgTAP), no `supabase/config.toml`, no Playwright/Vitest/Testing Library/axe in `package.json`, and no seed SQL for local resets. `supabase/` contains only `migrations/` and a CLI `.temp` file.
- **[HIGH, S] No CI.** There is no `.github/` directory (`ls -a`), so no lint, test, build or migration check runs on PRs, even though PRs #1–#7 were merged (git log).
- **[HIGH, S] Type check fails.**
  - `npx tsc --noEmit` → 21 errors. They are mostly `key` not allowed on props, `ErrorBoundary` lacking `props`/`setState`, `unknown` element refs, and `Cannot find namespace 'React'`. Examples: `src/components/layout/ErrorBoundary.tsx:29,37`; `src/components/reports/BalanceSheetView.tsx:128-152`; `src/components/sales/InvoiceBuilder.tsx:89`.
  - Root cause: no `@types/react`/`@types/react-dom` in `package.json:39-50`.
  - `tsconfig.json` has no `strict` (`tsconfig.json:1-27`), so `strictNullChecks` and `noImplicitAny` are off.
  - `vite build` does not type-check, so broken types ship.
- **[MEDIUM, M] `any` usage.** 308 occurrences of `: any`, `as any`, `<any>` or `any[]` in `src` and `worker` (grep, tests excluded). Hot spots: `src/components/banking/BankingView.tsx` 24, `src/components/expenses/ExpensesView.tsx` 21, `src/components/payroll/PayrollView.tsx` 18. Services take `input: any` (e.g. `src/server/customers.ts:40`). There are no generated Supabase DB types (`supabase gen types`).
- **No ESLint, Prettier or Biome configuration** (repo root listing). `npm run lint` is only `tsc` (`package.json:11`).
- **[MEDIUM, S] Error handling.**
  - Each route repeats `try/catch` with `serverError` or `clientError` (`worker/index.ts:71-90`, ~90 handlers).
  - `clientError` deliberately forwards DB error messages as 400s (:76-90). That exposes Postgres constraint and column names (e.g. unique-index names) to clients, which is the leak the 500 path is designed to avoid (:69-70). Map known SQLSTATEs to user messages instead.
  - Some validation failures return 500. For example `resolveReportDateRange` throws on a bad period (`src/utils/reportCalculations.ts:173`), surfaced via `serverError` (`worker/index.ts:196-201`). `/expenses/scan` uses `serverError` for bad input (:585).
  - `catch (e) {}` swallows errors (`src/server/banking.ts:170-174`).
- **[MEDIUM, M] Monitoring and logging.**
  - `src/utils/monitoring.ts:25-48` keeps the last 100 API and render metrics **in browser memory only**.
  - `ErrorBoundary` only does `console.error` (`src/components/layout/ErrorBoundary.tsx:24-26`).
  - The Worker logs with `console.error` (`worker/index.ts:72,88,812`); Workers Logs are enabled (`wrangler.jsonc:12-14`).
  - Missing: request IDs, structured JSON logs, a Sentry or Toucan-style error sink, tracing, uptime checks, `/api/health`, and alerting on RPC failures or eTIMS backlog.
- **[LOW, S] Stale or false documentation claims** that will mislead contributors:
  - PRODUCT.md:53 lists "recurring invoices" as built; there is no code (grep "recurring").
  - PRODUCT.md:69 cites `GET /api/public/demo-balance-sheet`; there is no such route in `worker/index.ts`.
  - PRODUCT.md:55 lists effective-dated rate tables, atomic payroll and mobile bottom navigation as "not built". They exist: `src/utils/kenyaPayroll.ts:79-113`; `…atomic_financial_workflows.sql:1399`; `src/components/layout/MobileTabBar.tsx`, used at `src/components/layout/AppLayout.tsx:27`.
  - The README says to set `SUPABASE_SERVICE_ROLE_KEY` (README.md:131), while `.env.example` prefers `SUPABASE_SECRET_KEY`.

### Inferences
- A one-day "quality floor" PR would catch regressions like the accountant-role break before merge:
  - add `@types/react` and `@types/react-dom`;
  - fix the 21 errors;
  - add a GitHub Actions workflow running `tsc`, `npm test` and `vite build`;
  - add `supabase db lint` / `supabase test db`.
- pgTAP tests for the 8 RPCs (balanced and unbalanced, cross-tenant, idempotent replay, role matrix) give the highest test ROI, because the business rules live in SQL.

### Gaps
- No coverage tool is configured, so I cannot give a line-coverage percentage.

---

## 5. Performance (bundle, code splitting, large files, N+1 / subrequests, pagination, where reports compute)

### Takeaway
Route views are already lazy-loaded. However:
- the eager shell is about 864 KB raw (~248 KB gzip);
- jsPDF is statically bundled into the Reports chunk (460 KB);
- several unused dependencies linger.

The bigger problem is server-side. Every report and the dashboard pull **entire tables** through PostgREST into the Worker and aggregate in JS. Each API call spends 2 auth subrequests, and loops issue per-row calls. On the Workers Free plan's **50-subrequest** ceiling (the plan the team evidently runs on, per commit 144ee4a) this fails as soon as a tenant has a few thousand journal lines.

### Cited Findings
- **Build output** (`vite build`, sizes raw / gzip):
  - eager: `index` 324 KB / 99 KB; `vendor-supabase` 220 / 58; `vendor-react` 194 / 61; `vendor-state` 42 / 12; `vendor-icons` 28 / 6; CSS 56 / 12. That is ≈ **864 KB raw / ≈ 248 KB gzip** before any view chunk.
  - Largest lazy chunks: `ReportsView` **460 KB / 149 KB**, `html2canvas` 202 KB, jsPDF `index.es` 160 KB, `DocumentationView` 68 KB, `PayrollView` 43 KB.
  - The Worker bundle `index.js` is 1.18 MB raw (`@google/genai`, supabase-js, zod, hono).
- **Code splitting.**
  - 18 views use `React.lazy` (`src/App.tsx:42-59`).
  - The landing page, lock screen, onboarding and `motion` are eager in the main chunk (`src/App.tsx:13-19`; `motion` imported by `src/components/layout/LockScreen.tsx`, `src/components/onboarding/OnboardingProvider.tsx` and `src/marketing/LandingPage.tsx`).
  - Manual chunks are configured (`vite.config.ts:24-38`).
- **[MEDIUM, S] jsPDF imported statically** by six report views (`src/components/reports/{ARAging,BalanceSheet,CashFlow,ProfitAndLoss,TrialBalance,TaxSummary}View.tsx` via `src/utils/pdfExport.ts:1-2`). Dynamic `import()` on the export click would cut ~150 KB gzip from the Reports chunk.
- **[LOW, S] Unused or misplaced dependencies** (grep of imports):
  - unused: `recharts`, `clsx`, `tailwind-merge`, `autoprefixer`; Recharts is listed in the fixed stack at PRODUCT.md:47 but never imported;
  - `vite` appears in both deps and devDeps (`package.json:35,49`);
  - build plugins `@vitejs/plugin-react` and `@tailwindcss/vite` sit in `dependencies` (:19,22);
  - `dotenv` is in `dependencies` but used only by `scripts/seed-demo-org.ts:1`.
- **[HIGH, M] Reports aggregate in JS over full scans.**
  - `ReportsService` pages 1,000 rows at a time (`src/server/reports.ts:15-34`). The balance sheet reads **every line ever** (:96-115). Cash flow reads every line twice, for period and opening balance (:128-144). The trial balance reads all lines (:152-166).
  - Each page is one subrequest. With 2 auth subrequests on top, a tenant with about 48k lines exhausts 50 subrequests on one balance-sheet call.
  - The offset pagination (`.range`) ordered by UUID also degrades.
  - Fix: Postgres RPCs or views returning per-account sums (`GROUP BY account_id` with an `entry_date` filter), backed by the existing `idx_journal_lines_org_account` and `idx_journal_entries_org_date` indexes (`…harden_financial_integrity.sql:388-391`).
- **[HIGH, M] Dashboard over-fetch.**
  - On load, `DashboardView` fires 7 queries, including **all invoices with lines and payments**, **all journal entries with lines** and all bank lines (`src/components/dashboard/DashboardView.tsx:188-199`).
  - `/dashboard/metrics` itself loads all unpaid invoices, bills and entries and calls the FX API (`src/server/metrics.ts:9-117`).
  - `QueryClient` uses defaults: `staleTime 0`, refetch on focus (`src/main.tsx:29`). Only one `staleTime`/`refetchInterval` setting exists in the app (grep count 1), so every tab focus re-downloads the ledger. This conflicts with PRODUCT.md:81 ("three-second load on mobile data").
- **[MEDIUM, M] N+1 and sequential loops** (each item is several subrequests):
  - `TeamService.getMembers` makes one auth call per member (`src/server/team.ts:37-56`); `addMember` lists all project users (:74-84).
  - `AccountService.bulkCreateAccounts` creates accounts sequentially, 3–4 calls each (`src/server/accounts.ts:89-103`). This is the same bug class commit 144ee4a fixed for seeding.
  - `bulkDeleteAccounts` audits each account sequentially (:116-127).
  - `BillService.recordBatchPayment` handles up to 100 payments × 3 calls (`src/server/bills.ts:206-225`).
  - Bulk invoice and bill void loops up to 100 times (`worker/index.ts:704-712`).
  - `BankingService.autoReconcileAll` costs 2–6 calls per match (`src/server/banking.ts:332-352`).
  - Invoice creation runs TS pre-checks that duplicate the SQL checks (`src/server/invoices.ts:89-104`, :135), then makes an extra eTIMS insert (:166-170).
  - A new `createClient` is built per service call (`src/server/supabase.ts:14`).
- **Pagination.** No list endpoint takes `limit` or cursor parameters (`worker/index.ts`, all `GET` list routes). The UI renders full lists with no virtualisation. Time entries are capped at 100 (`src/server/projects.ts:77`); the audit log at 50.
- **Large files:**
  - `src/components/common/DynamicQuickAddModal.tsx` 1,383 lines (one modal for 6+ entity types);
  - `src/components/banking/BankingView.tsx` 887; `DashboardView.tsx` 823; `worker/index.ts` 816; `OnboardingProvider.tsx` 730;
  - `src/components/documentation/documentationContent.ts` 1,012 (content bundled as JS).
- **Workers limits confirmed (2026):** "Workers on the free plan remain limited to 50 external subrequests… paid plans… 10,000 subrequests per invocation… up to 10 million" — [Cloudflare changelog 2026-02-11](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/); [Workers limits](https://developers.cloudflare.com/workers/platform/limits/). Commit 144ee4a's message reports hitting "Too many subrequests by single Worker invocation" with about 50 calls, which implies the Free plan.

### Inferences
- Moving to Workers Paid (10k subrequests) is a cheap stop-gap, but it does not fix truncation, latency or over-fetch. SQL-side aggregation plus paginated list endpoints is the durable fix.
- Hyperdrive with a direct Postgres driver (instead of PostgREST over HTTP) is another option if many small queries remain. I did not evaluate it.

### Gaps
- I did not measure a Lighthouse or real-device load time; no Tecno Spark 20 or emulator was available. Bundle numbers come from the local build only.

---

## 6. Offline/PWA & mobile (service worker, manifest, offline banner, tab bar, Capacitor)

### Takeaway
The app has a valid manifest and a mobile tab bar, but **no service worker**, so it neither installs nor opens offline. Its offline banner claims changes will reach the books later, yet nothing queues them across reloads. Capacitor is not started.

### Cited Findings
- `public/manifest.webmanifest` has standalone display, 192 and 512 icons, maskable icons and a theme colour. There is no `serviceWorker` registration, Workbox or `vite-plugin-pwa` anywhere (grep `src/`, `index.html`, `vite.config.ts`, `package.json`).
- **[MEDIUM, S] Offline banner over-promises.** `OfflineBanner` says "Changes made now will not reach the books until the connection returns" (`src/components/layout/OfflineBanner.tsx:26`). TanStack Query uses defaults (`src/main.tsx:29`), with no persister or offline mutation queue. Paused mutations resume only while the tab stays open, and many writes use raw `fetch` outside mutations (e.g. `src/components/sales/InvoiceBuilder.tsx:98`), which simply fail.
- Mobile bottom navigation exists and is mounted (`src/components/layout/MobileTabBar.tsx`, 66 lines; `src/components/layout/AppLayout.tsx:5,27`).
- Capacitor: no dependency or config (grep). PRODUCT.md:9 plans it "once the responsive web app works".
- **[LOW, S] Third-party fonts** are render-blocking from Google (`index.html:14-19`). On mobile data that adds DNS, TLS and download time before first paint. Self-hosting removes it and simplifies CSP.
- **[LOW, S] Receipt capture uploads full-resolution frames** as base64 JPEG with no downscale (`src/components/expenses/ReceiptScanner.tsx:66-73`). Receipt images are not stored as attachments anywhere, so there is no audit evidence and no retention.

### Inferences
Offline-first for an accounting ledger should not mean posting offline. The idempotency keys already in place would, however, make a durable outbox safe: drafts persisted in IndexedDB and replayed with the same key. The minimal step is:
- a service worker for shell and asset caching;
- a persisted query cache for read-only browsing.

### Gaps
- I did not test install prompts or performance on Android.

---

## 7. Accessibility & i18n (Swahili, hard-coded strings, ARIA)

### Takeaway
ARIA use is deliberate (235 `aria-*` attributes), but nothing tests it automatically. Swahili exists **only** in the onboarding tour. Sidebar, buttons and empty states are hard-coded English, which falls short of PRODUCT.md's own commitment. There is no i18n framework.

### Cited Findings
- `Language = 'en' | 'sw'` and the bilingual copy live only in `src/components/onboarding/tourSteps.ts:13`, tested by `src/components/onboarding/tourSteps.test.ts:77-81`.
- The sidebar uses English literals (`src/components/layout/Sidebar.tsx:18,28,39`).
- PRODUCT.md:65 requires "onboarding, sidebar navigation, primary buttons and empty states… in real Swahili".
- `index.html:2` is fixed to `lang="en"`.
- Number and currency formatting is hard-coded to `'en-US'` (`src/utils/currency.ts:194,214`), not `en-KE`/`sw-KE`. JPY etc. are forced to 2 decimals (:184-187).
- There are 235 `aria-*` attributes across `.tsx` files (grep). Dialogs set `role="dialog" aria-modal` (e.g. `src/components/layout/Sidebar.tsx:150`), and there are `role="status"`/`role="alert"` regions (`src/components/layout/OfflineBanner.tsx:25`, `src/components/layout/ErrorBoundary.tsx:32`).
- No axe-core or Playwright a11y tests exist (`package.json`), despite PRODUCT.md:85 requiring "zero critical axe-core violations on every screen".

### Inferences
- Introduce a small message catalogue (or `react-i18next`/`@lingui`) with `en` and `sw`. Migrate the PRODUCT.md-mandated surfaces first (nav, primary buttons, empty states), and add a CI check that every key has `sw`, mirroring the existing tour test. Effort M.
- Add `@axe-core/playwright` smoke tests per route in CI. Effort M.

### Gaps
- I did not run axe or a screen reader, so ARIA quality is unverified beyond counts and spot reads.

---

## 8. Architecture & maintainability (worker/index.ts, duplication, migrations hygiene, seeds, dependencies)

### Takeaway
There is a clean three-tier split: SPA → Hono Worker → service classes → SQL RPCs. It is held back by:
- one 816-line route file with repetitive handlers;
- `any`-typed service inputs;
- validation duplicated between TS and SQL;
- no generated DB types;
- migrations that were partly backfilled from a live project, with no local stack config.

### Cited Findings
- **`worker/index.ts`** (816 lines) defines ~90 routes inline with copy-pasted `try/catch` (:179-807). The `collectionMap` is duplicated (:714-719 and :737-742). There are raw table writes from the router itself (bulk delete and status updates, :724-726, :747-749). There are no route modules, no `@hono/zod-validator`, no OpenAPI and no `/api/health`.
- **Service duplication.**
  - `invoices.ts` and `bills.ts` are near-mirrors (`src/server/invoices.ts` 245 lines vs `src/server/bills.ts` 260): mapping, pre-checks, payment, void and update.
  - Pre-checks repeat what the RPCs already enforce (`src/server/invoices.ts:89-119` vs `…atomic_financial_workflows.sql:396-454`).
  - camelCase↔snake_case mapping is hand-written in every service (e.g. `src/server/customers.ts:14-36, 79-96`).
- **Migrations hygiene.**
  - There are 22 timestamped files. Some were backfilled from the live DB with `IF NOT EXISTS` shims (`…fix_etims_and_counters_schema.sql:7-26`).
  - The large workflow migration (1,656 lines) mixes many functions.
  - Data backfills live inside DDL migrations (`…harden_financial_integrity.sql:21-29, 428-475`).
  - There is no `supabase/config.toml`, `seed.sql` or tests directory. `supabase/.temp/cli-latest` is committed (git ls-files).
  - The README tells operators to `supabase db push` against production (README.md:92-101) with no staging step.
  - Positive: rollback notes exist in recent migrations (e.g. `…add_user_onboarding.sql:58-62`).
- **Seeds.** `scripts/seed-demo-org.ts` reuses the services with a real `DEMO_USER_ID` (:1-40). It is guarded by an env UUID check. It is the **only** writer of `bank_transactions` in the repo (`scripts/seed-demo-org.ts:206`), which confirms there is no import path.
- **Config.** `vite.config.ts:16-21` carries AI-Studio HMR comments (mojibake at :17). `tsconfig.json` sets `experimentalDecorators` and `useDefineForClassFields:false` (:4-5), which are unused in the code, and it lacks `strict`.

### Inferences
Suggested refactor order:
1. Split routes into `worker/routes/*.ts` with `zValidator`.
2. Generate `Database` types (`supabase gen types typescript`) and type services.
3. Extract a generic document service for invoices and bills.
4. Drop the TS pre-checks that duplicate RPC checks (this also saves subrequests).

### Gaps
- None material.

---

## 9. "Specified but not built" (PRODUCT.md:55): which to build first, given the code that exists

### Takeaway
PRODUCT.md's list is partly stale:
- effective-dated rate tables, atomic payroll and mobile bottom navigation **are** built;
- "recurring invoices" is claimed as built but is **not**.

Of the genuinely unbuilt items, **CSV/OFX bank and M-Pesa statement import with saved mappings** has the highest leverage. Banking, reconciliation and the bank-rules engine already exist but have **no data source** outside the seed script. Next comes **Daraja C2B ingestion**, then the **eTIMS / credit-note / estimate** document chain.

### Cited Findings
- Stale entries: rate tables are built (`src/utils/kenyaPayroll.ts:79-113`); atomic payroll is built (`…atomic_financial_workflows.sql:1399-1656`); mobile nav is built (`src/components/layout/MobileTabBar.tsx`, `src/components/layout/AppLayout.tsx:27`). "Recurring invoices" appear nowhere in code (grep), contradicting PRODUCT.md:53.
- **Bank import is the missing input.**
  - `syncTransactions` returns "Bank sync isn't connected yet" (`src/server/banking.ts:45-48`).
  - `bank_transactions` has no `account_id`, so every line is assumed to be bank 1000 (`…002_business_tables.sql:92-103`; `src/server/banking.ts:397`). M-Pesa 1050 or several banks cannot be reconciled.
  - PapaParse is already a dependency and used for exports (`src/components/settings/SettingsView.tsx:137`). The rules table and the match → journal path exist (`src/server/banking.ts:69-92, 354-439`).
- **Daraja / M-Pesa (3.3).** No Daraja code exists (grep). PRODUCT.md:30 positions M-Pesa "as a payment rail".
- **Estimates and POs (3.5), WhatsApp invoicing (3.6), credit notes.** There is no table or route for any of these (grep). The invoice RPC posts immediately as `SENT` with no draft state (`…atomic_financial_workflows.sql:500`).
- **react-hook-form + zod forms (3.9).** zod is server-only today (`worker/index.ts:92-176`). The 1,383-line `DynamicQuickAddModal` is hand-rolled, and silently drops fields (see §3).
- **Keyboard leader sequences (4), ledger book view (3.8), onboarding wizard (3.2).** These are UX items with no integrity impact.

### Inferences
Recommended build order, weighing leverage against existing code:

1. **CSV/OFX + M-Pesa statement import with saved column mappings** (M–L). Work items:
   - add `bank_accounts`, or `bank_transactions.account_id` plus `external_id` with a unique `(org_id, account_id, external_id)` for de-duplication;
   - a mapping table;
   - reuse the rules engine;
   - make "match" apply payments to invoices and bills via the existing RPCs.

   This unlocks the whole Banking module, the M-Pesa positioning and the reconciliation report.
2. **Daraja C2B confirmation webhook** (M). Store callbacks idempotently by `TransID` into the same table. "Polling" is less useful than C2B callbacks.
3. **Payment reversal + credit notes + period lock** (M). Not on PRODUCT.md's list, but prerequisites for eTIMS credit notes and auditor trust.
4. **Estimates → invoice conversion and draft invoices** (M), then **eTIMS OSCU/VSCU** (L), and purchase-side eTIMS capture (M).
5. **zod + react-hook-form** for the employee, customer, vendor and account forms (M). Share schemas with the Worker; this fixes the silent field drops.
6. **WhatsApp invoicing + STK push** (L). It depends on 1–2 for auto-reconciliation.

#### Consolidated fix list across all areas (severity, effort, location)
| Item | Severity | Effort | Location |
|---|---|---|---|
| Add `accountant` to `require_financial_actor` | high | S | `…atomic_financial_workflows.sql:36` |
| Apply bank matches to invoices/bills; add `reverse_payment`; block manual posts to control accounts | critical | M | `src/server/banking.ts:383-420`; `…atomic_financial_workflows.sql:281-294` |
| Paginate or aggregate in SQL; fix the truncating reads | critical | M | `src/server/accounts.ts:164`, `src/server/ledger.ts:37`, `src/server/metrics.ts:59` |
| Fix dashboard metric bugs | high | S | `src/server/metrics.ts:9-123` |
| Period lock date + year-end close | high | M | new migration, checked in `private.insert_journal_entry` |
| `public/_headers` with CSP / frame-ancestors / HSTS | high | S | `wrangler.jsonc:8-11` |
| zod on all write routes | high | M | `worker/index.ts` |
| Block base-currency change after posting | high | S | `src/server/organizations.ts:161` |
| `@types/react` + fix `tsc` + GitHub Actions CI + pgTAP | high | S–M | `package.json`, `tsconfig.json` |
| Persist allowances and reliefs; rate lookup by pay period | high | M | `src/server/payroll.ts:110-138,180-196`, `src/utils/kenyaPayroll.ts:135` |
| Realised FX on settlement; stored dated rates (CBK); server-side display translation | high | M | `…atomic_financial_workflows.sql:936-975`; `src/utils/currency.ts:175-195` |
| Immutability triggers; revoke service-role UPDATE/DELETE on ledger and audit tables | medium | M | `…grant_financial_data_api_access.sql:41-68` |
| Rate limiting (Workers Rate Limiting binding) on AI, invite and org-create routes | medium | M | `worker/index.ts` |
| MFA (TOTP) + password reset | medium | M | `src/context/AuthProvider.tsx` |
| Invitations table; drop the `listUsers` scan | medium | M | `src/server/team.ts:74-84` |
| Lazy-load jsPDF; drop unused deps; self-host fonts | medium/low | S | `src/utils/pdfExport.ts`, `package.json`, `index.html` |
| Service worker + honest offline copy | medium | S–M | `src/components/layout/OfflineBanner.tsx:26` |
| Swahili catalogue for nav, buttons and empty states; axe CI | medium | M | `src/components/layout/Sidebar.tsx` |

### Gaps
- PRODUCT.md references spec sections (3.2–3.9, 4) that are not in the repo, so I could not compare against the detailed acceptance criteria.
