# Mizani Pilot Implementation Plan

**Goal:** Deliver the law edition from matter opening through a reconciled client account and fee note.

**Architecture:** Keep the shared organization ledger and immutable journal. Add law records under organization RLS, post client money only through dedicated atomic SQL functions, and expose edition-guarded Worker routes. Preserve all business flows.

**Spec:** User-provided `Pasted text.txt`, E2.1–E2.6, attached 8 October 2026.

**Constraints:** Work directly on `main`, pull before each numbered task, tag and push before each migration commit, run local app and SQL checks before each commit, apply committed migrations to Ledger-Link Supabase, and never change `post_journal_entry` or `private.insert_journal_entry`.

## Task E2.1: law schema and client-money account protection

- [x] Write failing SQL assertions for matter relations, cross-organization keys, time-entry compatibility, invoice additions, and manual/bank/adjustment refusal on 1060/2200.
- [x] Add `pg_trgm` and the law tables; extend time and invoice records without breaking business defaults.
- [x] Add a journal-line insert guard for 1060/2200; keep core journal functions untouched.
- [x] Replay all migrations, run SQL and app checks, tag, commit, push, then apply and verify in production.

## Task E2.2: client account functions

- [ ] Write failing SQL tests for receipt, overdraw, void-invoice transfer, idempotency, and reconciliation.
- [ ] Add a validated matter-tag trigger that runs when a dedicated client-money function calls the unchanged core journal function.
- [ ] Add receipt, payment, transfer, office-disbursement, withholding payment, and balance functions with actor checks and per-matter locks.
- [ ] Run checks, tag, commit, push, apply migration, and verify live grants and migration history.

## Task E2.3: fee notes

- [ ] Test separated profit-cost and disbursement lines, unbilled stamping, VAT decision, and business invoice compatibility.
- [ ] Extend invoice creation and add atomic fee-note creation from unbilled work. Record eTIMS numbers as manual fields only.
- [ ] Run checks, tag, commit, push, apply migration, and verify.

## Task E2.4: services and routes

- [ ] Add Zod schemas, services, and edition-guarded routes for matters, parties, conflict checks, court diary, time, client money, disbursements, and fee notes.
- [ ] Add hashed calendar tokens and a public read-only ICS route; test cross-organization and role refusals.
- [ ] Run checks and commit directly to `main`.

## Task E2.5: law screens

- [ ] Build Matters, Matter record, Court diary, Client account, Fee note builder, and law Home with honest empty states and `{ en, sw: 'TODO-SW' }` copy.
- [ ] Use the established ledger, amount, dialog, print, and responsive patterns. Verify the end-to-end pilot sequence locally.
- [ ] Run checks and commit directly to `main`.

## Task E2.6: navigation and pilot acceptance

- [ ] Enable only completed law sidebar destinations and keep Full books role-aware.
- [ ] Verify a complete client-money and fee-note posting reconciles 1060, 2200, 1100, and 1170 in the trial balance.
- [ ] Run checks, commit, push, and report E2 evidence and remaining limits.
