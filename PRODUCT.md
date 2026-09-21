# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

A Capacitor wrap for the Play Store is planned once the responsive web app works (spec section 3.7). It wraps the website; the design language stays web.

## Users

Two primary users, equally weighted:

- **The owner.** Runs a Kenyan small or medium business: a duka, a service firm, a hardware supplier, an NGO or SACCO. Checks cash, approves bills and payroll, sends invoices, and wants to know whether the business is all right. Often does this on an Android phone between other work.
- **The accountant.** An in-house bookkeeper or an external accountant. Posts entries, reconciles M-Pesa and bank lines, runs payroll, closes the month and files with KRA. Works at a desk for long sessions and prefers the keyboard.

Both work in the same books. The owner reads summaries and decides; the accountant works in the detail. Neither is a secondary audience.

A third audience exists for the marketing surface only: a finance director or CFO who has used Sage, QuickBooks or Xero and is deciding whether to switch.

## Product Purpose

Double-entry accounting for Kenyan businesses: chart of accounts and journals, M-Pesa and bank reconciliation, invoicing and bills, payroll with Kenyan statutory deductions, VAT and eTIMS, inventory, projects, budgets, and financial reports (P&L, balance sheet, cash flow, trial balance, AR/AP aging, tax summary).

Success is a Kenyan bookkeeper using a feature for a full working day without support, and a finance director trusting the numbers enough to move their books off their current system.

## Positioning

- M-Pesa is treated as a payment rail, not a bank statement import.
- Kenyan statutory rules (PAYE bands, NSSF tiers, SHIF, Housing Levy, VAT, eTIMS) are the core of the product, not a localisation layer.
- Double entry is enforced in Postgres through `post_journal_entry()`. The database refuses unbalanced entries, so no frontend bug can put the books out of balance.
- Multi-currency (KES base; USD, UGX, TZS, RWF and others) holds invoices at the issue-date rate and posts unrealised FX to its own account.
- Planned and not yet built: WhatsApp Business invoicing with an M-Pesa STK push payment link and auto-reconciliation (section 3.6).

## Operating Context

- Money arrives through M-Pesa tills and paybills (Safaricom Daraja C2B/B2C) and Kenyan banks. KCB, Equity, Co-op and Absa arrive as CSV or OFX imports, not live feeds.
- Tax runs against a KRA PIN. eTIMS submission needs the business's own OSCU or VSCU device registration.
- The monthly statutory calendar: PAYE, NSSF and SHIF by the 9th; the Housing Levy by the ninth working day; VAT by the 20th.
- Reports are printed, exported to Excel and PDF, and handed to auditors who have never seen the product.
- Android is 92.93% of Kenyan mobile traffic (StatCounter, August 2026). The target device for acceptance testing is a Tecno Spark 20 on Android 14. Connectivity is mobile data.
- Accountants are expected to learn keyboard shortcuts: a command palette on Ctrl+K today, with Vim-style leader sequences and row navigation specified in section 4.

## Capabilities and Constraints

**Stack (fixed):** React 19, Vite, TypeScript, Tailwind CSS v4, Hono on Cloudflare Workers, Supabase (Postgres with row-level security, Auth with email and password), Zustand, TanStack Query, Recharts, Gemini for receipt OCR only. Do not port frameworks or add a component library.

**Must survive any redesign, extended but not replaced:** the Zustand store, TanStack Query setup, RLS policies, the double-entry Postgres function, the currency service with unrealised-FX journals, the audit log, the eTIMS Type C draft, the Gemini receipt scanner, the dashboard widget picker (drag, pin, reset), the command palette architecture, the dark mode implementation, the print CSS, and the name.

**Authentication:** email and password only. Magic links are out and must not be reintroduced.

**Built today:** accounts, journals, invoices, recurring invoices, bills, vendors, customers, banking with AI match suggestions and rules, payroll runs and payslips, inventory, projects and time entries, budgets, team roles (owner, admin, member), audit log, reports, multi-org switching, demo tenant.

**Specified but not built:** Daraja polling and live M-Pesa sync (3.3), CSV/OFX bank import with saved mappings (3.3), statutory rate tables with effective-from dates and atomic payroll journal batches (3.4), estimates and purchase orders (3.5), WhatsApp invoicing (3.6), mobile bottom navigation (3.7), ledger book view (3.8), react-hook-form and zod forms (3.9), keyboard leader sequences (4), onboarding wizard (3.2). The interface must never present these as working.

**Terminology:** invoice, bill, vendor, customer, journal entry, chart of accounts, till, paybill, KRA PIN, PAYE, NSSF, SHIF, Housing Levy, eTIMS, trial balance, carried forward and brought forward.

## Brand Commitments

- **Name:** Ledger Link, two words. The codebase currently also says "LedgerLink" and "Ledgerline"; both are wrong.
- **Concept (binding):** the product is a ledger book rendered in a browser. How that is expressed — typefaces, palette, radii, specific devices — was opened for replacement on 17 September 2026. The earlier section 1 specifics (IBM Plex Serif, Inter, IBM Plex Mono, the paper and ink palette, 2px corners, 6px status squares) are evidence, not requirements.
- **Voice (binding, from section 1):** success messages read as receipts ("Invoice INV-2026-0142 saved. Journal entry #4471 posted."). No exclamation marks anywhere. No second-person marketing voice. Errors name what failed and where. Banned words: streamline, seamless, empower, unlock, delve into, leverage, robust, ensure, "in today's fast-paced".
- **No generated illustration:** no cartoon or mascot illustrations.
- **Swahili:** onboarding, sidebar navigation, primary buttons and empty states must exist in real Swahili, not machine translation. The rest of the app may stay English for now.

## Evidence on Hand

- **Demo tenant:** Riverside Hardware Ltd (`146b2a09-11b0-47bd-a0ba-d9f27f1f12ec`), a Nairobi hardware retailer with 16 accounts and 12 balanced journal entries from January to June 2026. Served publicly at `GET /api/public/demo-balance-sheet`. Assets 3,151,250; liabilities 1,267,750; equity 1,883,500 (KES).
- **Specification:** the product owner's remediation prompt, sections 0 to 7, in this session's history.
- **Audit:** the interface strategy of 17 September 2026 (https://claude.ai/artifact/Hbr3aLKYbqZ5AVAS7QL6A7) with measured counts of the current UI.
- **Absent, must not be fabricated:** customers, testimonials, case studies, press, usage figures, certifications (no SOC 2, ISO 27001 or penetration test), and the ODPC registration number (pending).
- **Unconfirmed placeholders already in PR #4:** pricing of KES 1,500 / 4,500 / 12,000 a month; the office address "Kalson Towers, Crescent Lane, off Parklands Road"; the addresses sales@, support@ and privacy@ledgerlink.co.ke. These were written by Claude and are not facts.

## Product Principles

1. **Numbers you can trust at a glance.** Every figure traces back to its journal lines. Nothing is converted, rounded or hidden silently.
2. **Kenya is the default, not a locale.** M-Pesa, KRA and the statutory calendar come first in the flow, not at the end of a settings page.
3. **One ledger, two readers.** The owner gets the summary and the decision; the accountant gets the detail and the speed. Neither view is a watered-down version of the other.
4. **Say only what is true.** Unbuilt features do not appear as buttons, and marketing copy does not describe them in the present tense.
5. **Fast on a mid-range Android.** A three-second load on mobile data is a product requirement, not an optimisation.

## Accessibility & Inclusion

- WCAG 2.2 AA. Zero critical axe-core violations on every screen (spec section 6).
- Full keyboard operation, including table rows and the command palette, with visible focus.
- Acceptance on Chrome, Firefox and Safari at desktop and mobile widths, and on Chrome on a Tecno Spark 20.
- English and Swahili, with layouts that tolerate longer Swahili strings.
