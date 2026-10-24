-- The client account reconciliation, month by month, for a Mizani firm.
--
-- The client account screen already compares the client bank account in the
-- books (1060) with client money held (2200) and the matter ledgers
-- (public.client_account_position). The third leg was missing: the bank's
-- own statement. This brings the three together on a date, from a completed
-- bank reconciliation of the client bank account to that date:
--   statement balance + receipts not yet on the statement
--     - payments not yet on the statement      = client cash book (1060)
--   client cash book                           = client money held (2200)
--   client money held                          = the matter ledgers' total
-- and lets an owner or admin sign it, keeping what it showed and any
-- explanation of a difference. A signed reconciliation is never changed.

CREATE TABLE public.client_account_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  as_of DATE NOT NULL,
  bank_reconciliation_id UUID NOT NULL,
  statement_balance_cents BIGINT NOT NULL,
  uncleared_receipts_cents BIGINT NOT NULL,
  unpresented_payments_cents BIGINT NOT NULL,
  cash_book_cents BIGINT NOT NULL,
  client_held_cents BIGINT NOT NULL,
  matter_ledgers_cents BIGINT NOT NULL,
  untagged_held_cents BIGINT NOT NULL,
  matters JSONB NOT NULL DEFAULT '[]'::JSONB,
  agrees BOOLEAN NOT NULL,
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  signed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_account_reconciliations_org_date_key UNIQUE (org_id, as_of),
  CONSTRAINT client_account_reconciliations_bank_fkey FOREIGN KEY (org_id, bank_reconciliation_id)
    REFERENCES public.bank_reconciliations(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT client_account_reconciliations_explained CHECK (agrees OR note IS NOT NULL)
);
ALTER TABLE public.client_account_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_account_reconciliations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_account_reconciliations TO service_role;
CREATE TRIGGER client_account_reconciliations_permanent
  BEFORE UPDATE OR DELETE ON public.client_account_reconciliations
  FOR EACH ROW EXECUTE FUNCTION private.forbid_history_change();

-- The three legs on a date, read only. Nothing to compare until the client
-- bank account is reconciled to its statement on that date.
CREATE FUNCTION public.client_account_reconciliation(p_org_id UUID, p_as_of DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_bank UUID;
  v_rec RECORD;
  v_receipts BIGINT := 0;
  v_payments BIGINT := 0;
  v_position RECORD;
  v_matters JSONB;
  v_adjusted BIGINT;
  v_signed JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id AND edition = 'law') THEN
    RAISE EXCEPTION 'The client account reconciliation belongs to a Mizani law firm.' USING ERRCODE = '23514';
  END IF;
  IF p_as_of IS NULL THEN RAISE EXCEPTION 'Choose the date to reconcile to.' USING ERRCODE = '22023'; END IF;
  SELECT account.id INTO v_bank FROM public.accounts AS account WHERE account.org_id = p_org_id AND account.code = '1060';

  SELECT row_to_json(rec)::JSONB INTO v_signed FROM (
    SELECT id, as_of AS "asOf", statement_balance_cents AS "statementBalanceCents",
      uncleared_receipts_cents AS "unclearedReceiptsCents", unpresented_payments_cents AS "unpresentedPaymentsCents",
      cash_book_cents AS "cashBookCents", client_held_cents AS "clientHeldCents", matter_ledgers_cents AS "matterLedgersCents",
      untagged_held_cents AS "untaggedHeldCents", matters, agrees, note, signed_by AS "signedBy", signed_at AS "signedAt"
    FROM public.client_account_reconciliations WHERE org_id = p_org_id AND as_of = p_as_of) AS rec;

  SELECT * INTO v_position FROM public.client_account_position(p_org_id, p_as_of);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('matterId', matter.id, 'matterNumber', matter.matter_number,
      'title', matter.title, 'client', customer.display_name, 'heldCents', balance.balance_cents)
      ORDER BY matter.matter_number), '[]'::JSONB)
  INTO v_matters
  FROM public.client_balances(p_org_id, p_as_of) AS balance
  JOIN public.matters AS matter ON matter.org_id = p_org_id AND matter.id = balance.matter_id
  LEFT JOIN public.customers AS customer ON customer.org_id = p_org_id AND customer.id = matter.client_id
  WHERE balance.balance_cents <> 0;

  SELECT rec.id, rec.statement_balance_cents INTO v_rec
  FROM public.bank_reconciliations AS rec
  WHERE rec.org_id = p_org_id AND rec.account_id = v_bank AND rec.statement_date = p_as_of AND rec.status = 'COMPLETED'
  ORDER BY rec.completed_at DESC LIMIT 1;
  IF v_rec.id IS NOT NULL THEN
    -- What the books hold that the statement does not show yet.
    SELECT COALESCE(sum(sheet.debit) FILTER (WHERE NOT sheet.cleared), 0)::BIGINT,
           COALESCE(sum(sheet.credit) FILTER (WHERE NOT sheet.cleared), 0)::BIGINT
    INTO v_receipts, v_payments
    FROM public.bank_reconciliation_worksheet(p_org_id, v_rec.id) AS sheet;
    v_adjusted := v_rec.statement_balance_cents + v_receipts - v_payments;
  END IF;

  RETURN jsonb_build_object(
    'asOf', p_as_of,
    'hasClientBankAccount', v_bank IS NOT NULL,
    'bankReconciliationId', v_rec.id,
    'statementBalanceCents', v_rec.statement_balance_cents,
    'unclearedReceiptsCents', v_receipts,
    'unpresentedPaymentsCents', v_payments,
    'adjustedStatementCents', v_adjusted,
    'cashBookCents', v_position.client_bank_cents,
    'clientHeldCents', v_position.client_held_cents,
    'matterLedgersCents', v_position.matter_ledgers_cents,
    'untaggedHeldCents', v_position.untagged_held_cents,
    'matters', v_matters,
    'agrees', v_rec.id IS NOT NULL AND v_adjusted = v_position.client_bank_cents
      AND v_position.client_bank_cents = v_position.client_held_cents
      AND v_position.client_held_cents = v_position.matter_ledgers_cents,
    'signed', v_signed);
END;
$function$;
REVOKE ALL ON FUNCTION public.client_account_reconciliation(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_account_reconciliation(UUID, DATE) TO service_role;

-- An owner or admin signs the reconciliation for a date as it stands. A
-- difference is signed only with an explanation; a date is signed once.
CREATE FUNCTION public.sign_client_account_reconciliation(p_org_id UUID, p_as_of DATE, p_note TEXT, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_now JSONB;
  v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_id UUID;
BEGIN
  PERFORM 1 FROM public.memberships WHERE org_id = p_org_id AND user_id = p_actor AND role::TEXT IN ('owner', 'admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an owner or admin signs the client account reconciliation.' USING ERRCODE = '42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::TEXT || ':client-rec:' || p_as_of::TEXT, 0));
  v_now := public.client_account_reconciliation(p_org_id, p_as_of);
  IF v_now->'signed' IS NOT NULL AND jsonb_typeof(v_now->'signed') = 'object' THEN
    RAISE EXCEPTION 'The client account is already reconciled to %.', pg_catalog.to_char(p_as_of, 'DD/MM/YYYY') USING ERRCODE = '23505';
  END IF;
  IF v_now->>'bankReconciliationId' IS NULL THEN
    RAISE EXCEPTION 'Reconcile the client bank account to its statement for % first, in Banking.',
      pg_catalog.to_char(p_as_of, 'DD/MM/YYYY') USING ERRCODE = '23514';
  END IF;
  IF NOT (v_now->>'agrees')::BOOLEAN AND v_note IS NULL THEN
    RAISE EXCEPTION 'The three do not agree. Explain the difference before signing.' USING ERRCODE = '23514';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
    RAISE EXCEPTION 'The explanation is at most 1,000 characters.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.client_account_reconciliations (org_id, as_of, bank_reconciliation_id, statement_balance_cents,
    uncleared_receipts_cents, unpresented_payments_cents, cash_book_cents, client_held_cents, matter_ledgers_cents,
    untagged_held_cents, matters, agrees, note, signed_by)
  VALUES (p_org_id, p_as_of, (v_now->>'bankReconciliationId')::UUID, (v_now->>'statementBalanceCents')::BIGINT,
    (v_now->>'unclearedReceiptsCents')::BIGINT, (v_now->>'unpresentedPaymentsCents')::BIGINT, (v_now->>'cashBookCents')::BIGINT,
    (v_now->>'clientHeldCents')::BIGINT, (v_now->>'matterLedgersCents')::BIGINT, (v_now->>'untaggedHeldCents')::BIGINT,
    v_now->'matters', (v_now->>'agrees')::BOOLEAN, v_note, p_actor)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'SIGN', 'CLIENT_ACCOUNT_RECONCILIATION', v_id,
    jsonb_build_object('asOf', p_as_of, 'agrees', (v_now->>'agrees')::BOOLEAN, 'note', v_note));
  RETURN public.client_account_reconciliation(p_org_id, p_as_of);
END;
$function$;
REVOKE ALL ON FUNCTION public.sign_client_account_reconciliation(UUID, DATE, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_client_account_reconciliation(UUID, DATE, TEXT, UUID) TO service_role;

-- Rollback: DROP FUNCTION public.sign_client_account_reconciliation(UUID, DATE, TEXT, UUID),
-- public.client_account_reconciliation(UUID, DATE); DROP TABLE public.client_account_reconciliations.
