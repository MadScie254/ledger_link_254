# Kundi feature handoff

Branch: `codex/church-features`, based on `origin/main` at `02ffe2b`, merged with `main` at `fd06fe8`.

## Done in this branch

- Member giving statements with a date filter, plus a PDF receipt for each posted gift.
- Fund budgets for annual income targets and expense limits, compared with posted fund results.
- Campaigns and member pledges tied to existing funds. Campaign and pledge progress comes from posted gifts in the campaign period. A pledge does not post money.
- Monthly giving plans compared with posted member gifts. A plan does not collect or post money.
- M-Pesa exception summary and reason filters on the existing waiting queue.
- Service-to-deposit review on cash counts: counted, banked and matched-to-statement states, plus variances.
- Council pack PDF for a selected month, with the monthly result, restricted funds, budgets through that month, money accounts and items needing review.
- Fund project report for a selected date range, with posted movement and income and expenses by account, plus PDF export.

## In progress

- Remaining requested features: split gifts, spending requests, attendance and visitor follow-up, and multi-campus reporting.

## Next

1. Finish the local database and integration suites for this first slice, then commit it.
2. Build spending requests and their approval trail, with no posting until an expense is recorded through the existing ledger workflow.
3. Design split gifts as one atomic posting so the ledger and fund reports agree.

## Open questions

- Campus model: one church ledger with campus tags or separate books. The user has been asked; no answer has arrived. Shared ledger is the current working assumption.
- Campaign progress attributes all gifts from a member to the campaign's fund during its dates. A gift is not explicitly linked to a pledge. Campaigns for the same fund cannot overlap.

## Deployment

- Claude, 24 October 2026: the five migrations were renamed from `20261013000100`-`000500` to `20261024000100`-`000500` before anything applied them, because production already held `20261022000300` and Supabase applies migrations in order. Their SQL is unchanged.
- Shipped in two steps, as the README asks: the migrations and their SQL tests first, then the code that calls them once production held them.
- Checks on `main` with this branch merged: `npm run lint`; `npm test` (223); `npm run test:db` (40 files) and `npm run test:integration` (22 suites) on PostgreSQL 16 with PostgREST 12.2.3. GitHub Actions remains locked by billing.
- Payroll PRs #11 to #13 are merged and their migrations are applied in production.
