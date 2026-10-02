# Ledger Link codebase audit (engineering gaps, risks, improvement opportunities)

_Status: IN PROGRESS — partial notes, written incrementally. Repo at /home/user/ledger_link_254, branch ccr-af7d00fb-cvlafc, HEAD 144ee4a (2026-09-28). All references are `path:line` in that repo._

## Security & multi-tenancy

### Takeaway
(draft) Worker authenticates via `supabase.auth.getUser(token)` and checks membership per request, then uses the service-role/secret key for every query, so RLS is effectively bypassed and tenant isolation depends on every service filtering by `org_id`. DB-side atomic RPCs re-check membership, and composite `(org_id,id)` FKs make cross-tenant links structurally impossible for core tables.

### Cited Findings (draft)
- Auth middleware: `worker/auth.ts:36-92` — verifies JWT with `supabase.auth.getUser(token)` (network call to Supabase Auth on every request), reads `x-org-id`, validates UUID, looks up `memberships` with the service client, rejects non-write roles for non-GET. Write roles include `accountant` (`worker/auth.ts:18`).
- Service client created fresh per call with secret key: `src/server/supabase.ts:10-20` (no per-request user-JWT client, so RLS never applies to Worker traffic).
- CRITICAL/HIGH functional bug: DB guard `private.require_financial_actor` only accepts `owner`/`admin` (`supabase/migrations/20260917172909_add_atomic_financial_workflows.sql:36`), but the `accountant` role added later (`supabase/migrations/20260928150000_add_accountant_membership_role.sql:10`, commit fb2aabe) is a Worker write role (`worker/auth.ts:18`). No migration updates `require_financial_actor`, so every accountant posting (journal, invoice, bill, payment, void, payroll — all 8 callers at lines 280, 372, 619, 858, 1050, 1229, 1323, 1448) will fail with "An organization owner or administrator is required."
