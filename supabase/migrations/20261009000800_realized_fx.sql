-- Realized exchange gain or loss when a foreign-currency invoice or bill is
-- settled at a different rate from the one it was booked at.
--
-- A USD invoice booked at KES 130 to the dollar carries its receivable at
-- that rate. Paid when the dollar buys KES 128, the bank receives less in
-- shillings than the receivable it clears; the difference is a realized
-- loss. Paid at KES 132, it is a gain. Either way it posts to 8100
-- (Realized FX Gain / Loss, an income account; a loss is a debit there).
--
-- The person enters what was settled in the document's currency and what
-- it came to in the base currency on the day (the shillings the bank
-- credited, or the dollars received at that day's rate); the rate is never
-- fetched or assumed here.
--
-- Invoice:  Dr bank (base received), Cr 1100 (the share of the receivable
--           at the booked rate), and the difference to 8100.
-- Bill:     Dr 2000 (the share of the payable at the booked rate),
--           Cr bank (base paid), and the difference to 8100.
--
-- The invoice or bill is owed less by the share at its booked rate, so
-- what remains stays at that rate. Reversal is unchanged: the whole entry,
-- the exchange difference included, goes back.

ALTER TABLE public.invoice_payments ADD COLUMN realized_fx_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.bill_payments ADD COLUMN realized_fx_cents BIGINT NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.invoice_payments.realized_fx_cents IS 'Exchange gain (positive) or loss (negative) realized by this payment, in the base currency.';
COMMENT ON COLUMN public.bill_payments.realized_fx_cents IS 'Exchange gain (positive) or loss (negative) realized by this payment, in the base currency.';

-- 8100, made the first time it is needed in a chart that has none.
CREATE FUNCTION private.realized_fx_account(p_org_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_account RECORD;
  v_id UUID;
BEGIN
  SELECT account.id, account.type::TEXT AS type, account.is_active INTO v_account
  FROM public.accounts AS account WHERE account.org_id = p_org_id AND account.code = '8100';
  IF FOUND THEN
    IF v_account.type <> 'INCOME' OR NOT v_account.is_active THEN
      RAISE EXCEPTION 'Account 8100 is needed as an active income account for exchange gains and losses.' USING ERRCODE = '23514';
    END IF;
    RETURN v_account.id;
  END IF;
  INSERT INTO public.accounts (org_id, code, name, type, currency, is_bank_account)
  SELECT p_org_id, '8100', 'Realized FX Gain / Loss', 'INCOME'::public.account_type, upper(org.base_currency), false
  FROM public.organizations AS org WHERE org.id = p_org_id
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION private.realized_fx_account(UUID) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. A foreign-currency invoice paid at the day's rate.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.receive_invoice_payment_at_rate(
  p_org_id UUID,
  p_invoice_id UUID,
  p_foreign_cents BIGINT,
  p_base_cents BIGINT,
  p_payment_date DATE,
  p_deposit_account_id UUID,
  p_idempotency_key TEXT,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_existing RECORD;
  v_invoice RECORD;
  v_base TEXT;
  v_cash_currency TEXT;
  v_foreign_paid BIGINT;
  v_foreign_due BIGINT;
  v_relieved BIGINT;
  v_fx BIGINT;
  v_lines JSONB;
  v_entry UUID;
  v_payment_id UUID := gen_random_uuid();
  v_due BIGINT;
  v_status TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::TEXT || ':invoice-payment:' || p_idempotency_key, 0));
  SELECT payment.id, payment.journal_entry_id, payment.invoice_id, payment.realized_fx_cents, invoice.amount_due_cents, invoice.status
  INTO v_existing
  FROM public.invoice_payments AS payment
  JOIN public.invoices AS invoice ON invoice.org_id = payment.org_id AND invoice.id = payment.invoice_id
  WHERE payment.org_id = p_org_id AND payment.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.invoice_id IS DISTINCT FROM p_invoice_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different invoice payment.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('paymentId', v_existing.id, 'journalEntryId', v_existing.journal_entry_id,
      'amountDueCents', v_existing.amount_due_cents, 'status', v_existing.status, 'realizedFxCents', v_existing.realized_fx_cents);
  END IF;

  IF p_foreign_cents IS NULL OR p_foreign_cents <= 0 OR p_base_cents IS NULL OR p_base_cents <= 0 OR p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Enter what was settled, what it came to in the base currency, and the date.' USING ERRCODE = '22023';
  END IF;

  SELECT invoice.id, invoice.customer_id, invoice.invoice_number, invoice.status, invoice.amount_due_cents,
         upper(invoice.currency) AS currency, invoice.exchange_rate, invoice.foreign_amount_cents
  INTO v_invoice
  FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id AND invoice.id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_invoice.status IN ('PAID', 'VOID', 'DRAFT') OR v_invoice.amount_due_cents <= 0 THEN
    RAISE EXCEPTION 'This invoice cannot receive a payment.' USING ERRCODE = '23514';
  END IF;
  SELECT upper(org.base_currency) INTO v_base FROM public.organizations AS org WHERE org.id = p_org_id;
  IF v_invoice.currency = v_base THEN
    RAISE EXCEPTION 'Invoice % is in %; receive its payment in the usual way.', v_invoice.invoice_number, v_base USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_money_account(p_org_id, p_deposit_account_id, 'The deposit account');
  SELECT upper(account.currency) INTO v_cash_currency FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.id = p_deposit_account_id;
  IF v_cash_currency NOT IN (v_base, v_invoice.currency) THEN
    RAISE EXCEPTION 'Deposit into a % or % account.', v_base, v_invoice.currency USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(payment.foreign_amount_cents), 0)::BIGINT INTO v_foreign_paid
  FROM public.invoice_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.invoice_id = p_invoice_id AND payment.reversed_at IS NULL;
  v_foreign_due := v_invoice.foreign_amount_cents - v_foreign_paid;
  IF p_foreign_cents > v_foreign_due THEN
    RAISE EXCEPTION '% has % % cents still owing; settle no more than that.', v_invoice.invoice_number, v_foreign_due, v_invoice.currency
      USING ERRCODE = '23514';
  END IF;
  -- The share of the receivable this clears, at the rate the invoice was booked.
  v_relieved := CASE WHEN p_foreign_cents = v_foreign_due THEN v_invoice.amount_due_cents
    ELSE least(round(p_foreign_cents / v_invoice.exchange_rate)::BIGINT, v_invoice.amount_due_cents) END;
  IF v_relieved <= 0 THEN
    RAISE EXCEPTION 'The payment is too small to clear any of the receivable.' USING ERRCODE = '23514';
  END IF;
  v_fx := p_base_cents - v_relieved;

  v_lines := jsonb_build_array(
    jsonb_build_object('accountId', p_deposit_account_id, 'debit', p_base_cents, 'credit', 0,
      'description', 'Customer payment', 'entityType', 'CUSTOMER', 'entityId', v_invoice.customer_id,
      'currency', v_cash_currency,
      'foreignDebit', CASE WHEN v_cash_currency = v_base THEN p_base_cents ELSE p_foreign_cents END, 'foreignCredit', 0,
      'exchangeRate', CASE WHEN v_cash_currency = v_base THEN 1 ELSE p_foreign_cents::NUMERIC / p_base_cents END),
    jsonb_build_object('accountId', private.control_account(p_org_id, '1100'), 'debit', 0, 'credit', v_relieved,
      'description', 'Reduce accounts receivable', 'entityType', 'CUSTOMER', 'entityId', v_invoice.customer_id,
      'currency', v_invoice.currency, 'foreignDebit', 0, 'foreignCredit', p_foreign_cents, 'exchangeRate', v_invoice.exchange_rate));
  IF v_fx <> 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('accountId', private.realized_fx_account(p_org_id),
      'debit', CASE WHEN v_fx < 0 THEN -v_fx ELSE 0 END, 'credit', CASE WHEN v_fx > 0 THEN v_fx ELSE 0 END,
      'description', CASE WHEN v_fx > 0 THEN 'Exchange gain on ' ELSE 'Exchange loss on ' END || v_invoice.invoice_number));
  END IF;
  v_entry := private.insert_journal_entry(p_org_id, p_payment_date, 'Payment received for ' || v_invoice.invoice_number,
    'PAYMENT', p_invoice_id, v_invoice.invoice_number, p_created_by, v_lines, 'invoice-payment-at-rate:' || p_idempotency_key);

  INSERT INTO public.invoice_payments (id, org_id, invoice_id, amount_cents, currency, foreign_amount_cents, exchange_rate,
    payment_date, account_id, journal_entry_id, idempotency_key, created_by, realized_fx_cents)
  VALUES (v_payment_id, p_org_id, p_invoice_id, v_relieved, v_invoice.currency, p_foreign_cents, v_invoice.exchange_rate,
    p_payment_date, p_deposit_account_id, v_entry, p_idempotency_key, p_created_by, v_fx);

  v_due := v_invoice.amount_due_cents - v_relieved;
  v_status := CASE WHEN v_due = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END;
  UPDATE public.invoices SET amount_due_cents = v_due, status = v_status WHERE org_id = p_org_id AND id = p_invoice_id;
  UPDATE public.customers SET balance = greatest(COALESCE(balance, 0) - v_relieved, 0)
  WHERE org_id = p_org_id AND id = v_invoice.customer_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'PAYMENT', 'INVOICE', p_invoice_id,
    jsonb_build_object('paymentId', v_payment_id, 'foreignCents', p_foreign_cents, 'baseCents', p_base_cents,
      'relievedCents', v_relieved, 'realizedFxCents', v_fx, 'amountDueCents', v_due, 'status', v_status));
  RETURN jsonb_build_object('paymentId', v_payment_id, 'journalEntryId', v_entry, 'amountDueCents', v_due, 'status', v_status,
    'realizedFxCents', v_fx);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. A foreign-currency bill paid at the day's rate.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.pay_bill_at_rate(
  p_org_id UUID,
  p_bill_id UUID,
  p_foreign_cents BIGINT,
  p_base_cents BIGINT,
  p_payment_date DATE,
  p_source_account_id UUID,
  p_idempotency_key TEXT,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_existing RECORD;
  v_bill RECORD;
  v_base TEXT;
  v_threshold BIGINT;
  v_cash_currency TEXT;
  v_foreign_paid BIGINT;
  v_foreign_due BIGINT;
  v_relieved BIGINT;
  v_fx BIGINT;
  v_lines JSONB;
  v_entry UUID;
  v_payment_id UUID := gen_random_uuid();
  v_due BIGINT;
  v_status TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_created_by);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::TEXT || ':bill-payment:' || p_idempotency_key, 0));
  SELECT payment.id, payment.journal_entry_id, payment.bill_id, payment.realized_fx_cents, bill.amount_due_cents, bill.status
  INTO v_existing
  FROM public.bill_payments AS payment
  JOIN public.bills AS bill ON bill.org_id = payment.org_id AND bill.id = payment.bill_id
  WHERE payment.org_id = p_org_id AND payment.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.bill_id IS DISTINCT FROM p_bill_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different bill payment.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('paymentId', v_existing.id, 'journalEntryId', v_existing.journal_entry_id,
      'amountDueCents', v_existing.amount_due_cents, 'status', v_existing.status, 'realizedFxCents', v_existing.realized_fx_cents);
  END IF;

  IF p_foreign_cents IS NULL OR p_foreign_cents <= 0 OR p_base_cents IS NULL OR p_base_cents <= 0 OR p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Enter what was settled, what it came to in the base currency, and the date.' USING ERRCODE = '22023';
  END IF;

  SELECT bill.id, bill.vendor_id, bill.bill_number, bill.status, bill.total_cents, bill.amount_due_cents,
         upper(bill.currency) AS currency, bill.exchange_rate, bill.foreign_amount_cents, bill.approved_at
  INTO v_bill
  FROM public.bills AS bill
  WHERE bill.org_id = p_org_id AND bill.id = p_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_bill.status IN ('PAID', 'VOID') OR v_bill.amount_due_cents <= 0 THEN
    RAISE EXCEPTION 'This bill cannot receive a payment.' USING ERRCODE = '23514';
  END IF;
  SELECT org.approval_threshold_cents, upper(org.base_currency) INTO v_threshold, v_base FROM public.organizations AS org WHERE org.id = p_org_id;
  IF v_threshold IS NOT NULL AND v_bill.total_cents >= v_threshold AND v_bill.approved_at IS NULL THEN
    RAISE EXCEPTION 'Bill % needs approval before it is paid.', v_bill.bill_number USING ERRCODE = '42501';
  END IF;
  IF v_bill.currency = v_base THEN
    RAISE EXCEPTION 'Bill % is in %; pay it in the usual way.', v_bill.bill_number, v_base USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_money_account(p_org_id, p_source_account_id, 'The payment account');
  SELECT upper(account.currency) INTO v_cash_currency FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.id = p_source_account_id;
  IF v_cash_currency NOT IN (v_base, v_bill.currency) THEN
    RAISE EXCEPTION 'Pay from a % or % account.', v_base, v_bill.currency USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(payment.foreign_amount_cents), 0)::BIGINT INTO v_foreign_paid
  FROM public.bill_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.bill_id = p_bill_id AND payment.reversed_at IS NULL;
  v_foreign_due := v_bill.foreign_amount_cents - v_foreign_paid;
  IF p_foreign_cents > v_foreign_due THEN
    RAISE EXCEPTION '% has % % cents still owing; settle no more than that.', v_bill.bill_number, v_foreign_due, v_bill.currency
      USING ERRCODE = '23514';
  END IF;
  v_relieved := CASE WHEN p_foreign_cents = v_foreign_due THEN v_bill.amount_due_cents
    ELSE least(round(p_foreign_cents / v_bill.exchange_rate)::BIGINT, v_bill.amount_due_cents) END;
  IF v_relieved <= 0 THEN
    RAISE EXCEPTION 'The payment is too small to clear any of the payable.' USING ERRCODE = '23514';
  END IF;
  -- Paying less in shillings than the payable carries is a gain.
  v_fx := v_relieved - p_base_cents;

  v_lines := jsonb_build_array(
    jsonb_build_object('accountId', private.control_account(p_org_id, '2000'), 'debit', v_relieved, 'credit', 0,
      'description', 'Reduce accounts payable', 'entityType', 'VENDOR', 'entityId', v_bill.vendor_id,
      'currency', v_bill.currency, 'foreignDebit', p_foreign_cents, 'foreignCredit', 0, 'exchangeRate', v_bill.exchange_rate),
    jsonb_build_object('accountId', p_source_account_id, 'debit', 0, 'credit', p_base_cents,
      'description', 'Vendor payment', 'entityType', 'VENDOR', 'entityId', v_bill.vendor_id,
      'currency', v_cash_currency, 'foreignDebit', 0,
      'foreignCredit', CASE WHEN v_cash_currency = v_base THEN p_base_cents ELSE p_foreign_cents END,
      'exchangeRate', CASE WHEN v_cash_currency = v_base THEN 1 ELSE p_foreign_cents::NUMERIC / p_base_cents END));
  IF v_fx <> 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('accountId', private.realized_fx_account(p_org_id),
      'debit', CASE WHEN v_fx < 0 THEN -v_fx ELSE 0 END, 'credit', CASE WHEN v_fx > 0 THEN v_fx ELSE 0 END,
      'description', CASE WHEN v_fx > 0 THEN 'Exchange gain on ' ELSE 'Exchange loss on ' END || v_bill.bill_number));
  END IF;
  v_entry := private.insert_journal_entry(p_org_id, p_payment_date, 'Payment for ' || v_bill.bill_number,
    'PAYMENT', p_bill_id, v_bill.bill_number, p_created_by, v_lines, 'bill-payment-at-rate:' || p_idempotency_key);

  INSERT INTO public.bill_payments (id, org_id, bill_id, amount_cents, currency, foreign_amount_cents, exchange_rate,
    payment_date, account_id, journal_entry_id, idempotency_key, created_by, realized_fx_cents)
  VALUES (v_payment_id, p_org_id, p_bill_id, v_relieved, v_bill.currency, p_foreign_cents, v_bill.exchange_rate,
    p_payment_date, p_source_account_id, v_entry, p_idempotency_key, p_created_by, v_fx);

  v_due := v_bill.amount_due_cents - v_relieved;
  v_status := CASE WHEN v_due = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END;
  UPDATE public.bills SET amount_due_cents = v_due, status = v_status WHERE org_id = p_org_id AND id = p_bill_id;
  UPDATE public.vendors SET balance = greatest(COALESCE(balance, 0) - v_relieved, 0)
  WHERE org_id = p_org_id AND id = v_bill.vendor_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'PAYMENT', 'BILL', p_bill_id,
    jsonb_build_object('paymentId', v_payment_id, 'foreignCents', p_foreign_cents, 'baseCents', p_base_cents,
      'relievedCents', v_relieved, 'realizedFxCents', v_fx, 'amountDueCents', v_due, 'status', v_status));
  RETURN jsonb_build_object('paymentId', v_payment_id, 'journalEntryId', v_entry, 'amountDueCents', v_due, 'status', v_status,
    'realizedFxCents', v_fx);
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_invoice_payment_at_rate(UUID, UUID, BIGINT, BIGINT, DATE, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay_bill_at_rate(UUID, UUID, BIGINT, BIGINT, DATE, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_invoice_payment_at_rate(UUID, UUID, BIGINT, BIGINT, DATE, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay_bill_at_rate(UUID, UUID, BIGINT, BIGINT, DATE, UUID, TEXT, UUID) TO service_role;

-- Rollback: drop the two public functions and private.realized_fx_account;
-- drop invoice_payments.realized_fx_cents and bill_payments.realized_fx_cents.
-- Account 8100 made by the functions stays in the chart.
