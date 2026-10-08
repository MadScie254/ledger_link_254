# Edition Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each organization a business, law, or church edition while preserving the current business experience.

**Architecture:** Store edition and subscription data in Supabase. Define brands, navigation, and account additions once in a shared TypeScript module. Have the Worker create organizations and enforce plan limits; have client navigation read the same edition definition.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind v4, Hono Worker, Supabase Postgres/RLS, Zustand, TanStack Query.

**Spec:** User-provided `Pasted text.txt`, E1.1–E1.5, attached to this task on 8 October 2026.

## Global Constraints

- Work on `main` directly; pull before each numbered task, tag and push before migration commits, then push each verified commit.
- Keep existing business view keys and appearance unchanged.
- Use one bulk account insert for organization seeding.
- No new framework or payment collection in E1.

## Review Focus

- Existing organizations without an edition value must resolve to business.
- Account codes must be unique across standard, business-type, and edition charts.
- Edition sidebar links must point to rendered views; member roles cannot see Full books.
- A different organization's member cannot read or alter a subscription or set its integration actor.
- Repeated organization creation with the same key must not make duplicate subscriptions or accounts.

### Task 1: E1.1 database edition foundation

**Files:** Create `supabase/migrations/*_add_organization_editions.sql`; create `tests/db/editions.test.sql`.

**Interfaces:** Produces `organization_edition`, `organizations.edition`, `parent_org_id`, `integration_actor_id`, `plans`, and `organization_subscriptions`; extends `private.next_document_number` without removing current document types.

- [x] Write SQL tests for the existing organization default, plan seeds, subscription RLS, integration actor guard, and new document types.
- [x] Run the tests against the current schema and confirm the expected failure.
- [x] Generate and implement the migration, then replay all migrations and run database tests.
- [x] Run app tests, lint, and build; tag the previous commit, commit E1.1, and push.

### Task 2: E1.2 shared edition definitions

**Files:** Create `src/utils/editions.ts`, `src/utils/editions.test.ts`; modify `src/App.tsx` to export `KNOWN_VIEWS` when renderers exist.

**Interfaces:** Produces `Edition`, `EditionDefinition`, `editionDefinition`, edition account lists, and localized sidebar groups.

- [ ] Write tests for names, view keys, defaults, and account-code collisions; confirm failure.
- [ ] Implement definitions and app view registry, then run tests, lint, and build.
- [ ] Commit E1.2 and push.

### Task 3: E1.3 organization and navigation wiring

**Files:** Modify `src/server/organizations.ts`, `src/store.ts`, `worker/schemas.ts`, organization routes, `src/components/layout/Sidebar.tsx`, `src/components/layout/MobileTabBar.tsx`, `src/components/layout/CommandPalette.tsx`, and `src/App.tsx`; add focused tests.

**Interfaces:** `POST /api/organizations` accepts an edition; the creation RPC stores it and starts a trial subscription for law/church; navigation uses edition groups with Full books for privileged members.

- [ ] Add failing tests for edition creation, account seeding, business fallback, and role-aware navigation.
- [ ] Implement one account insert and edition-aware views, then run app, SQL, and build checks.
- [ ] Commit E1.3 and push.

### Task 4: E1.4 public brand by host

**Files:** Modify `worker/index.ts`, `worker/auth.ts`, `wrangler.jsonc`, `src/components/layout/LockScreen.tsx`, `src/marketing/LandingPage.tsx`, and brand components; add route and mapping tests.

**Interfaces:** `GET /api/public/brand` returns `{ edition, brandName, poweredBy }` from configured host lists before auth runs.

- [ ] Write failing host-match and fallback tests, including an untrusted Host value.
- [ ] Implement route, allowed origins, and auth-page branding; run tests, lint, and build.
- [ ] Commit E1.4 and push.

### Task 5: E1.5 limits and plan settings

**Files:** Create `src/utils/planLimits.ts` and tests; modify team route and settings view; add service tests.

**Interfaces:** `canAddUser` and `canAddMember` check nullable limits; Worker rejects users over the edition's current plan and names the next plan; Settings shows subscription status and limits.

- [ ] Write failing boundary tests for unlimited, at-limit, and next-plan messages.
- [ ] Enforce server-side, render plan settings, run tests, lint, build, and database checks.
- [ ] Verify E1 acceptance, commit E1.5, and push.
