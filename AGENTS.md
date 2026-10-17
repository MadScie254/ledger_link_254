# Ledger Link agent rules

- Read `PRODUCT.md`, `DESIGN.md`, and `README.md` before changing product behavior.
- Add schema and SQL function changes only in new, ordered `supabase/migrations/20261011NNNNNN_short_name.sql` files, using later dates when needed. Never edit an existing migration.
- Never modify `post_journal_entry()` or `private.insert_journal_entry()`. Never update or delete posted journal lines. Correct a posting with a reversing entry.
- Store money as integer cents. Post all lines for one operation inside one SQL function call and one transaction.
- Scope every query to the caller's organization. Guard payroll and employee routes with `requirePayrollAccess` in `worker/index.ts`. Enable row level security on new tables.
- Keep secrets out of code, logs, and `VITE_` variables. Use local Postgres only. Do not access the live Supabase project or Cloudflare account.
- Do not push to main, merge a pull request, force-push, rewrite pushed history, or reset a pushed commit.
- Before every commit, run `npm run lint` and `npm test`. When local Postgres 16 is available, also run `npm run test:db` and `npm run test:integration`; otherwise record the limitation in `docs/handoff/codex.md`.
- Use no exclamation marks or the banned words from the user task in UI text, docs, or commit messages. Write “Ledger Link” as two words. Describe only working features.
- Add no statutory or legal figure without a source. Dated, sourced, unverified rows may hold roadmap figures; do not present them as confirmed. List figures without a source under Open questions.
- Match existing patterns: pure helpers in `src/utils` with `node:test` tests and `.ts` imports; services in `src/server`; routes in `worker/routes` with Zod schemas in `worker/schemas.ts`; SQL tests in `tests/db/*.test.sql`; API tests in `tests/integration`.
- Keep `docs/handoff/codex.md` current in every commit so another agent can continue without asking for context.

## Test commands

```sh
npm run lint
npm test
npm run test:db
npm run test:integration
```
