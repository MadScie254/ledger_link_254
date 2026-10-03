-- Atomic bank matching.
--
-- Matching a statement line read the line, posted (a payment, a bill payment
-- or a bank entry) and then marked the line matched, each a separate Worker
-- request. Two people, or a person and auto-accept, matching the same line to
-- different targets both posted, so one line of money was counted twice; and
-- two different lines could both claim one existing entry. Matching is now one
-- transaction that locks the line, and an entry can stand for one line only.
-- A match can also be undone: a posting the match made is reversed, a link to
-- an existing entry is removed, and a match that recorded a payment is undone
-- by reversing that payment.

CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_matched_entry_key
  ON public.bank_transactions(org_id, matched_journal_entry_id)
  WHERE matched_journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.match_bank_transaction(
  p_org_id UUID,
  p_transaction_id UUID,
  p_target_account_id UUID,
  p_existing_journal_entry_id UUID,
  p_invoice_id UUID,
  p_bill_id UUID,
  p_actor UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tx RECORD;
  v_bank_account_id UUID;
  v_target RECORD;
  v_entry_id UUID;
  v_net NUMERIC;
  v_expected NUMERIC;
  v_result JSONB;
  v_key TEXT;
  v_previous_matches INTEGER;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF (p_target_account_id IS NOT NULL)::INT + (p_existing_journal_entry_id IS NOT NULL)::INT
     + (p_invoice_id IS NOT NULL)::INT + (p_bill_id IS NOT NULL)::INT <> 1 THEN
    RAISE EXCEPTION 'Choose exactly one of an account, a posted entry, an invoice or a bill to match this line to.'
      USING ERRCODE = '22023';
  END IF;

  SELECT tx.id, tx.date, tx.description, tx.amount_cents, tx.direction, tx.status
  INTO v_tx
  FROM public.bank_transactions AS tx
  WHERE tx.org_id = p_org_id AND tx.id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Statement line not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_tx.status = 'MATCHED' THEN
    RAISE EXCEPTION 'This statement line is already matched.' USING ERRCODE = '23505';
  END IF;
  IF v_tx.amount_cents IS NULL OR v_tx.amount_cents <= 0 THEN
    RAISE EXCEPTION 'The statement line amount must be a positive number of cents.' USING ERRCODE = '22023';
  END IF;

  -- The posting's key names this line and how many times it has been matched
  -- before, so a retry returns the same posting while a fresh match after an
  -- undo or a payment reversal posts anew.
  SELECT count(*) INTO v_previous_matches
  FROM public.audit_logs AS log
  WHERE log.org_id = p_org_id AND log.resource_type = 'BANK_TRANSACTION'
    AND log.resource_id = p_transaction_id AND log.action = 'MATCH';
  v_key := 'bank-match:' || p_transaction_id::TEXT
    || CASE WHEN v_previous_matches = 0 THEN '' ELSE ':' || v_previous_matches::TEXT END;

  SELECT account.id INTO v_bank_account_id
  FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.code = '1000' AND account.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The bank account (1000) was not found in the chart of accounts.' USING ERRCODE = '23503';
  END IF;

  IF p_invoice_id IS NOT NULL THEN
    IF v_tx.direction <> 'IN' THEN
      RAISE EXCEPTION 'Only money coming in can pay an invoice.' USING ERRCODE = '22023';
    END IF;
    v_result := public.receive_invoice_payment(p_org_id, p_invoice_id, v_tx.amount_cents, v_tx.date,
      v_bank_account_id, v_key, p_actor);
    v_entry_id := (v_result ->> 'journalEntryId')::UUID;
  ELSIF p_bill_id IS NOT NULL THEN
    IF v_tx.direction <> 'OUT' THEN
      RAISE EXCEPTION 'Only money going out can pay a bill.' USING ERRCODE = '22023';
    END IF;
    v_result := public.pay_bill(p_org_id, p_bill_id, v_tx.amount_cents, v_tx.date,
      v_bank_account_id, v_key, p_actor);
    v_entry_id := (v_result ->> 'journalEntryId')::UUID;
  ELSIF p_existing_journal_entry_id IS NOT NULL THEN
    SELECT COALESCE(sum(line.debit - line.credit), 0) INTO v_net
    FROM public.journal_lines AS line
    WHERE line.org_id = p_org_id AND line.journal_entry_id = p_existing_journal_entry_id
      AND line.account_id = v_bank_account_id;
    PERFORM 1 FROM public.journal_entries AS entry
    WHERE entry.org_id = p_org_id AND entry.id = p_existing_journal_entry_id;
    IF NOT FOUND OR v_net = 0 THEN
      RAISE EXCEPTION 'That entry does not move the bank account, or belongs to another organization.' USING ERRCODE = '23503';
    END IF;
    v_expected := CASE WHEN v_tx.direction = 'IN' THEN v_tx.amount_cents ELSE -v_tx.amount_cents END;
    IF v_net <> v_expected THEN
      RAISE EXCEPTION 'That entry moves the bank account by a different amount or in the other direction, so it cannot stand for this line.'
        USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.bank_transactions AS other
    WHERE other.org_id = p_org_id AND other.matched_journal_entry_id = p_existing_journal_entry_id;
    IF FOUND THEN
      RAISE EXCEPTION 'That entry is already matched to another statement line.' USING ERRCODE = '23505';
    END IF;
    v_entry_id := p_existing_journal_entry_id;
  ELSE
    SELECT account.id, account.code INTO v_target
    FROM public.accounts AS account
    WHERE account.org_id = p_org_id AND account.id = p_target_account_id AND account.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The target account is inactive or belongs to another organization.' USING ERRCODE = '23503';
    END IF;
    IF v_target.id = v_bank_account_id THEN
      RAISE EXCEPTION 'A statement line cannot be posted back to the bank account itself.' USING ERRCODE = '22023';
    END IF;
    -- public.post_journal_entry refuses accounts receivable and payable.
    v_entry_id := public.post_journal_entry(
      p_org_id, v_tx.date, 'Bank match: ' || v_tx.description, 'BANK', v_tx.id, NULL, p_actor,
      CASE WHEN v_tx.direction = 'IN' THEN jsonb_build_array(
        jsonb_build_object('accountId', v_bank_account_id, 'debit', v_tx.amount_cents, 'credit', 0, 'description', v_tx.description),
        jsonb_build_object('accountId', v_target.id, 'debit', 0, 'credit', v_tx.amount_cents, 'description', v_tx.description))
      ELSE jsonb_build_array(
        jsonb_build_object('accountId', v_target.id, 'debit', v_tx.amount_cents, 'credit', 0, 'description', v_tx.description),
        jsonb_build_object('accountId', v_bank_account_id, 'debit', 0, 'credit', v_tx.amount_cents, 'description', v_tx.description))
      END,
      v_key
    );
  END IF;

  UPDATE public.bank_transactions
  SET status = 'MATCHED', matched_journal_entry_id = v_entry_id
  WHERE org_id = p_org_id AND id = p_transaction_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'MATCH', 'BANK_TRANSACTION', p_transaction_id,
    jsonb_build_object('journalEntryId', v_entry_id, 'amountCents', v_tx.amount_cents, 'direction', v_tx.direction,
      'target', CASE WHEN p_invoice_id IS NOT NULL THEN 'INVOICE' WHEN p_bill_id IS NOT NULL THEN 'BILL'
        WHEN p_existing_journal_entry_id IS NOT NULL THEN 'ENTRY' ELSE 'ACCOUNT' END));

  RETURN v_entry_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.unmatch_bank_transaction(
  p_org_id UUID,
  p_transaction_id UUID,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tx RECORD;
  v_entry RECORD;
  v_reversal_id UUID;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  SELECT tx.id, tx.status, tx.matched_journal_entry_id, tx.description
  INTO v_tx
  FROM public.bank_transactions AS tx
  WHERE tx.org_id = p_org_id AND tx.id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Statement line not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_tx.status <> 'MATCHED' OR v_tx.matched_journal_entry_id IS NULL THEN
    RETURN jsonb_build_object('reversalJournalEntryId', NULL);
  END IF;

  SELECT entry.id, entry.source_type, entry.source_id INTO v_entry
  FROM public.journal_entries AS entry
  WHERE entry.org_id = p_org_id AND entry.id = v_tx.matched_journal_entry_id;

  IF v_entry.source_type = 'PAYMENT' THEN
    RAISE EXCEPTION 'This line recorded a payment against an invoice or bill. Reverse that payment instead; the line is then unmatched.'
      USING ERRCODE = '23514';
  END IF;

  -- A posting the match itself made is reversed; a link to an entry posted
  -- elsewhere is only removed.
  IF v_entry.source_type = 'BANK' AND v_entry.source_id = p_transaction_id THEN
    v_reversal_id := private.insert_journal_entry(
      p_org_id,
      -- Today as the business sees it, in its own time zone.
      (now() AT TIME ZONE COALESCE((SELECT org.time_zone FROM public.organizations AS org WHERE org.id = p_org_id), 'Africa/Nairobi'))::DATE,
      'Undo bank match: ' || v_tx.description, 'ADJUSTMENT',
      NULL, NULL, p_actor, private.reversal_lines(p_org_id, v_entry.id, v_tx.description),
      'bank-unmatch:' || v_entry.id::TEXT
    );
  END IF;

  UPDATE public.bank_transactions
  SET status = 'UNREVIEWED', matched_journal_entry_id = NULL
  WHERE org_id = p_org_id AND id = p_transaction_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'UNMATCH', 'BANK_TRANSACTION', p_transaction_id,
    jsonb_build_object('journalEntryId', v_entry.id, 'reversalJournalEntryId', v_reversal_id));

  RETURN jsonb_build_object('reversalJournalEntryId', v_reversal_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.match_bank_transaction(UUID, UUID, UUID, UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unmatch_bank_transaction(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_bank_transaction(UUID, UUID, UUID, UUID, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.unmatch_bank_transaction(UUID, UUID, UUID) TO service_role;

-- Rollback: drop the two functions and the index.
