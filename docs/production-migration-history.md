# Production migration history

The Ledger-Link Supabase project (`jhmlkcuqsmynnkqgfisf`) has two sets of historical
timestamps for the same early schema work. On 8 October 2026, production had 21
recorded migrations while Git had 49. Eleven production versions were absent
from Git, and twelve Git versions were absent from production history.

The eleven `supabase/migrations/*` files named below are history markers with no
SQL to replay. Their production SQL was applied before the matching Git files
were named. Replaying both would attempt to create the same tables or types
twice. The two demo seed markers are also no-ops locally; use
`scripts/seed-demo-org.ts` when a fictional demo tenant is needed.

| Production version | Equivalent Git migration or seed |
| --- | --- |
| 20260915151655 | 20260915151627_add_budgets_table.sql |
| 20260915152036 | 20260915153000_add_time_entries_table.sql |
| 20260915152747 | 20260915154500_add_banking_rules_and_connections.sql |
| 20260915153714 | 20260915160000_add_payroll_runs_table.sql |
| 20260915161542 | 20260915170000_fix_org_bootstrap_trigger_for_service_role.sql |
| 20260916210349, 20260916210432 | scripts/seed-demo-org.ts |
| 20260918034836 | 20260917172744_harden_financial_integrity.sql |
| 20260928100824 | 20260928090000_add_organization_business_type.sql |
| 20260928102632 | 20260928093000_add_organization_theme_accent.sql |
| 20260928120613 | 20260928150000_add_accountant_membership_role.sql |

The twelve Git-only early versions were recorded as history-only repairs on
8 October: the live database already had their tables, types, functions,
triggers, and grants. Their SQL was not run again. All migrations from
`20261002090000` through `20261008000200` were applied to production in filename
order and their recorded versions were aligned with Git. The local and remote
histories now each contain 60 matching versions.

After any migration deployment, run `supabase migration list | node scripts/check-migrations.ts`.
A zero exit code checks version agreement; it
does not replace schema tests or the Supabase security advisor.

Leaked-password protection remains disabled because this organization is on
Supabase Free; [Supabase offers that setting on Pro and above](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
