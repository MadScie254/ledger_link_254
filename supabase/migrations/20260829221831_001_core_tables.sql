-- ============================================================
-- LedgerLink Migration 001: Core Tables
-- organizations, memberships, accounts, journal_entries, journal_lines
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── organizations ─────────────────────────────────────────────────────────
CREATE TABLE public.organizations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  legal_name       TEXT,
  base_currency    TEXT NOT NULL DEFAULT 'KES',
  country          TEXT NOT NULL DEFAULT 'Kenya',
  tax_id           TEXT,
  fiscal_year_start TEXT DEFAULT 'January',
  industry         TEXT,
  address          TEXT,
  city             TEXT,
  phone            TEXT,
  email            TEXT,
  website          TEXT,
  is_default       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── memberships ───────────────────────────────────────────────────────────
-- This is the authoritative table for user<->org relationships.
-- All RLS policies on business tables key off this.
CREATE TYPE public.membership_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE public.memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.membership_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX idx_memberships_user_id ON public.memberships(user_id);
CREATE INDEX idx_memberships_org_id  ON public.memberships(org_id);

-- ─── accounts ──────────────────────────────────────────────────────────────
CREATE TYPE public.account_type AS ENUM (
  'ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COGS', 'EXPENSE'
);

CREATE TABLE public.accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       public.account_type NOT NULL,
  subtype    TEXT,
  parent_id  UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE INDEX idx_accounts_org_id ON public.accounts(org_id);

-- ─── journal_entries ───────────────────────────────────────────────────────
CREATE TABLE public.journal_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entry_date   DATE NOT NULL,
  memo         TEXT,
  source_type  TEXT,
  source_id    UUID,
  reference_no TEXT,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  posted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_entries_org_id     ON public.journal_entries(org_id);
CREATE INDEX idx_journal_entries_entry_date ON public.journal_entries(entry_date);

-- ─── journal_lines ─────────────────────────────────────────────────────────
CREATE TABLE public.journal_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  debit            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description      TEXT,
  entity_type      TEXT,
  entity_id        UUID
);

CREATE INDEX idx_journal_lines_journal_entry_id ON public.journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account_id       ON public.journal_lines(account_id);

-- Trigger to auto-update organizations.updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
