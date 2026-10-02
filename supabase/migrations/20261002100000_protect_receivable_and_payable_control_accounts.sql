-- Accounts receivable (1100) and accounts payable (2000) are control accounts:
-- each balance must equal the open invoices or bills behind it, customer by
-- customer and supplier by supplier. The invoice, bill, payment and void
-- workflows keep the two in step, because they post to 1100 or 2000 and update
-- amount_due_cents in the same transaction.
--
-- public.post_journal_entry, used for manual journals, adjustments and bank
-- matches, could also post to 1100 and 2000. Such an entry moved the ledger
-- balance without settling any invoice or bill, so the aged receivables and
-- payables stopped agreeing with the balance sheet. Bank matching did exactly
-- this whenever it matched a bank line to an invoice or bill.
--
-- This refuses manual, adjustment and bank journals that touch 1100 or 2000.
-- Bank lines that settle an invoice or bill now go through
-- receive_invoice_payment and pay_bill instead (src/server/banking.ts).
-- The workflows themselves call private.insert_journal_entry directly and are
-- not affected, and entries already posted are not changed.

CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_org_id UUID,
  p_entry_date DATE,
  p_memo TEXT,
  p_source_type TEXT,
  p_source_id UUID,
  p_reference_no TEXT,
  p_created_by UUID,
  p_lines JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_entry_id UUID;
  v_control_code TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);
  CASE upper(btrim(p_source_type))
    WHEN 'BANK' THEN
      PERFORM 1 FROM public.bank_transactions AS transaction
      WHERE transaction.org_id = p_org_id AND transaction.id = p_source_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Bank journal source does not belong to this organization.' USING ERRCODE = '23503';
      END IF;
    WHEN 'MANUAL', 'ADJUSTMENT' THEN
      IF p_source_id IS NOT NULL THEN
        RAISE EXCEPTION 'Manual journal entries cannot attach a polymorphic source ID.' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'This source type is reserved for an atomic workflow.' USING ERRCODE = '42501';
  END CASE;
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_org_id::TEXT || ':journal:' || p_idempotency_key, 0)
    );
    SELECT entry.id INTO v_entry_id
    FROM public.journal_entries AS entry
    WHERE entry.org_id = p_org_id AND entry.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_entry_id;
    END IF;
  END IF;

  IF jsonb_typeof(p_lines) = 'array' THEN
    SELECT account.code INTO v_control_code
    FROM public.accounts AS account
    WHERE account.org_id = p_org_id
      AND account.code IN ('1100', '2000')
      AND account.id::TEXT IN (
        SELECT lower(btrim(line.value ->> 'accountId'))
        FROM jsonb_array_elements(p_lines) AS line(value)
      )
    ORDER BY account.code
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION '%', CASE v_control_code
        WHEN '1100' THEN 'Accounts receivable (1100) changes only through invoices, payments and voids. Record the payment against the invoice instead.'
        ELSE 'Accounts payable (2000) changes only through bills, payments and voids. Record the payment against the bill instead.'
      END USING ERRCODE = '23514';
    END IF;
  END IF;

  v_entry_id := private.insert_journal_entry(
    p_org_id, p_entry_date, p_memo, p_source_type, p_source_id,
    p_reference_no, p_created_by, p_lines, p_idempotency_key
  );

  INSERT INTO public.audit_logs (
    org_id, user_id, action, resource_type, resource_id, details
  ) VALUES (
    p_org_id, p_created_by, 'CREATE', 'JOURNAL_ENTRY', v_entry_id,
    jsonb_build_object('sourceType', p_source_type, 'memo', p_memo)
  );

  RETURN v_entry_id;
END;
$function$;

-- CREATE OR REPLACE keeps the existing grants (service_role and authenticated
-- may execute; anon may not); restated here so this file stands alone.
REVOKE ALL ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, TEXT, UUID, JSONB, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, TEXT, UUID, JSONB, TEXT
) TO authenticated, service_role;

-- Rollback: re-run the public.post_journal_entry definition from
-- 20260917172909_add_atomic_financial_workflows.sql, which has no control
-- account check.
