-- Immutable ledger, balanced entries, and an audit row for every change to
-- the records fraud targets.
--
-- 1. Posted journal entries and lines, payments and the audit log could be
--    updated or deleted by the service role, which every Worker request uses.
--    Only grants kept the browser out; nothing stopped a Worker bug or a
--    leaked key from rewriting history. A trigger now refuses UPDATE and
--    DELETE on them for every role except the database owner (migrations and
--    the owner's SQL editor, the break-glass path). The SECURITY DEFINER
--    workflows run as the owner, so a reversal can still mark a payment
--    reversed; nothing else can.
-- 2. Every journal entry must balance and have at least two lines when the
--    transaction commits, whichever path wrote it.
-- 3. Changes to customers, vendors, employees, stock items, accounts,
--    projects, budgets, bank rules, memberships, organization settings and
--    invoice or bill dates and notes each write an audit row with what
--    changed, in the same transaction as the change. The actor is the
--    signed-in person the Worker acts for: it sends the x-ledger-actor header
--    with every service-role request, which PostgREST exposes as
--    request.headers; SQL functions may set ledger.actor_id instead.

-- ---------------------------------------------------------------------------
-- 1. Immutability
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.forbid_history_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION '% rows are permanent. Post a reversing entry instead of changing or deleting one.', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION private.forbid_history_change() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS journal_entries_permanent ON public.journal_entries;
CREATE TRIGGER journal_entries_permanent
  BEFORE UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();

DROP TRIGGER IF EXISTS journal_lines_permanent ON public.journal_lines;
CREATE TRIGGER journal_lines_permanent
  BEFORE UPDATE OR DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();

DROP TRIGGER IF EXISTS audit_logs_permanent ON public.audit_logs;
CREATE TRIGGER audit_logs_permanent
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();

DROP TRIGGER IF EXISTS invoice_payments_permanent ON public.invoice_payments;
CREATE TRIGGER invoice_payments_permanent
  BEFORE UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();

DROP TRIGGER IF EXISTS bill_payments_permanent ON public.bill_payments;
CREATE TRIGGER bill_payments_permanent
  BEFORE UPDATE OR DELETE ON public.bill_payments
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();

-- An organization's audit log outlives any attempt to delete the
-- organization, and so, through it, do its books.
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_org_id_fkey;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- 2. Balanced at commit
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.check_journal_entry_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_entry_id UUID;
  v_lines INTEGER;
  v_debit NUMERIC;
  v_credit NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    v_entry_id := (to_jsonb(NEW) ->> 'id')::UUID;
  ELSE
    v_entry_id := (to_jsonb(NEW) ->> 'journal_entry_id')::UUID;
  END IF;
  SELECT count(*), COALESCE(sum(line.debit), 0), COALESCE(sum(line.credit), 0)
  INTO v_lines, v_debit, v_credit
  FROM public.journal_lines AS line
  WHERE line.journal_entry_id = v_entry_id;

  IF v_lines < 2 OR v_debit <= 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'Journal entry % does not balance: % lines, debits %, credits %.', v_entry_id, v_lines, v_debit, v_credit
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.check_journal_entry_balanced() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS journal_lines_balanced ON public.journal_lines;
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT ON public.journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.check_journal_entry_balanced();

DROP TRIGGER IF EXISTS journal_entries_balanced ON public.journal_entries;
CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT ON public.journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.check_journal_entry_balanced();

-- ---------------------------------------------------------------------------
-- 3. Record audit
-- ---------------------------------------------------------------------------

-- The person a change is made for: a SQL function's ledger.actor_id, else the
-- Worker's x-ledger-actor header, else the signed-in caller.
CREATE OR REPLACE FUNCTION private.request_actor()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  v_text TEXT;
  v_headers TEXT;
BEGIN
  v_text := NULLIF(current_setting('ledger.actor_id', true), '');
  IF v_text IS NULL THEN
    v_headers := NULLIF(current_setting('request.headers', true), '');
    IF v_headers IS NOT NULL THEN
      v_text := v_headers::jsonb ->> 'x-ledger-actor';
    END IF;
  END IF;
  IF v_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_text::UUID;
  END IF;
  RETURN auth.uid();
END;
$function$;

REVOKE ALL ON FUNCTION private.request_actor() FROM PUBLIC, anon, authenticated, service_role;

-- Lets a SQL function name the person it acts for, for the rest of its
-- transaction.
CREATE OR REPLACE FUNCTION private.set_actor(p_actor UUID)
RETURNS VOID
LANGUAGE sql
SET search_path = ''
AS $function$
  SELECT set_config('ledger.actor_id', COALESCE(p_actor::TEXT, ''), true);
$function$;

REVOKE ALL ON FUNCTION private.set_actor(UUID) FROM PUBLIC, anon, authenticated, service_role;

-- TG_ARGV[0]: the resource type written to audit_logs.
-- TG_ARGV[1..]: columns left out of the record (balances kept by workflows,
-- stock counts kept by inventory_movements, timestamps).
CREATE OR REPLACE FUNCTION private.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_resource TEXT := TG_ARGV[0];
  v_ignored TEXT[] := CASE WHEN TG_NARGS > 1 THEN TG_ARGV[1:TG_NARGS - 1] ELSE ARRAY[]::TEXT[] END;
  v_old JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  v_new JSONB := CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN to_jsonb(NEW) END;
  v_row JSONB := COALESCE(v_new, v_old);
  v_changes JSONB := '{}'::JSONB;
  v_key TEXT;
  v_details JSONB;
  v_actor UUID := private.request_actor();
  v_email TEXT;
  v_org UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      CONTINUE WHEN v_key = ANY(v_ignored);
      IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key));
      END IF;
    END LOOP;
    IF v_changes = '{}'::JSONB THEN
      RETURN NULL;
    END IF;
    v_details := jsonb_build_object('changes', v_changes);
  ELSE
    v_details := jsonb_build_object('values', v_row - v_ignored);
  END IF;

  v_org := CASE WHEN TG_TABLE_NAME = 'organizations' THEN (v_row ->> 'id')::UUID ELSE (v_row ->> 'org_id')::UUID END;
  -- An organization being deleted cannot carry new audit rows; its existing
  -- rows already block the delete.
  IF TG_TABLE_NAME = 'organizations' AND TG_OP = 'DELETE' THEN
    RETURN NULL;
  END IF;

  IF v_actor IS NOT NULL THEN
    SELECT auth_user.email::TEXT INTO v_email FROM auth.users AS auth_user WHERE auth_user.id = v_actor;
  END IF;

  INSERT INTO public.audit_logs (org_id, user_id, actor_email, action, resource_type, resource_id, details)
  VALUES (
    v_org, v_actor, v_email,
    CASE TG_OP WHEN 'INSERT' THEN 'CREATE' WHEN 'UPDATE' THEN 'UPDATE' ELSE 'DELETE' END,
    v_resource, (v_row ->> 'id')::UUID, v_details
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.audit_row_change() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS customers_audit ON public.customers;
CREATE TRIGGER customers_audit AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change('CUSTOMER', 'balance', 'created_at');

DROP TRIGGER IF EXISTS vendors_audit ON public.vendors;
CREATE TRIGGER vendors_audit AFTER INSERT OR UPDATE OR DELETE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change('VENDOR', 'balance', 'created_at');

DROP TRIGGER IF EXISTS employees_audit ON public.employees;
CREATE TRIGGER employees_audit AFTER INSERT OR UPDATE OR DELETE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change('EMPLOYEE', 'created_at');

DROP TRIGGER IF EXISTS inventory_items_audit ON public.inventory_items;
CREATE TRIGGER inventory_items_audit AFTER INSERT OR UPDATE OR DELETE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change('INVENTORY_ITEM', 'quantity_on_hand', 'created_at');

DROP TRIGGER IF EXISTS accounts_audit ON public.accounts;
CREATE TRIGGER accounts_audit AFTER INSERT OR UPDATE OR DELETE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change('ACCOUNT', 'created_at');

DROP TRIGGER IF EXISTS projects_audit ON public.projects;
CREATE TRIGGER projects_audit AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change('PROJECT', 'created_at');

DROP TRIGGER IF EXISTS budgets_audit ON public.budgets;
CREATE TRIGGER budgets_audit AFTER INSERT OR UPDATE OR DELETE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change('BUDGET', 'created_at', 'updated_at');

DROP TRIGGER IF EXISTS bank_rules_audit ON public.bank_rules;
CREATE TRIGGER bank_rules_audit AFTER INSERT OR UPDATE OR DELETE ON public.bank_rules
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change('BANK_RULE', 'created_at');

DROP TRIGGER IF EXISTS memberships_audit ON public.memberships;
CREATE TRIGGER memberships_audit AFTER INSERT OR UPDATE OR DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change('TEAM_MEMBER', 'created_at');

DROP TRIGGER IF EXISTS organizations_audit ON public.organizations;
CREATE TRIGGER organizations_audit AFTER UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change('ORGANIZATION', 'updated_at', 'created_at');

-- Invoice and bill amounts and statuses change only through the workflows,
-- which write their own audit rows. Dates, notes and references changed
-- directly are recorded here.
DROP TRIGGER IF EXISTS invoices_edit_audit ON public.invoices;
CREATE TRIGGER invoices_edit_audit AFTER UPDATE OF due_date, notes ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change(
    'INVOICE', 'amount_due_cents', 'status', 'subtotal_cents', 'tax_cents', 'total_cents', 'created_at');

DROP TRIGGER IF EXISTS bills_edit_audit ON public.bills;
CREATE TRIGGER bills_edit_audit AFTER UPDATE OF due_date, notes, supplier_reference ON public.bills
  FOR EACH ROW EXECUTE FUNCTION private.audit_row_change(
    'BILL', 'amount_due_cents', 'status', 'subtotal_cents', 'tax_cents', 'total_cents',
    'approved_at', 'approved_by', 'created_at');

-- Rollback: drop the triggers above, then the functions
-- private.audit_row_change, private.set_actor, private.request_actor,
-- private.check_journal_entry_balanced and private.forbid_history_change,
-- and restore audit_logs_org_id_fkey with ON DELETE CASCADE.
