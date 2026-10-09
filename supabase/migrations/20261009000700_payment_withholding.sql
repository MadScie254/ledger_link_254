-- Tax withheld at payment (Kenya). A customer who is a withholding agent
-- pays an invoice net of income tax withheld and, if appointed for VAT,
-- of VAT withheld, and gives a KRA certificate for each; a business that
-- withholds pays a supplier's bill net and owes the withheld tax to KRA.
--
-- The amounts are entered from the certificate or the payment advice, never
-- worked out from a rate here: rates and who must withhold are set by KRA
-- and change, so the person records what was actually withheld.
--
-- Invoice paid net:  Dr bank (cash received), Dr 1170 income tax withheld,
--                    Dr 1175 VAT withheld, Cr 1100 the total settled.
-- Bill paid net:     Dr 2000 the total settled, Cr bank (cash paid),
--                    Cr 2150 income tax withheld, Cr 2155 VAT withheld.
--
-- The four accounts are made the first time they are needed. A payment
-- with tax withheld is reversed like any other (reverse_invoice_payment,
-- reverse_bill_payment): the whole entry, withheld tax included, goes back.
-- Base-currency documents only. Law fee notes keep their own payment
-- (receive_fee_note_payment).

ALTER TABLE public.invoice_payments
  ADD COLUMN wvat_cents BIGINT NOT NULL DEFAULT 0 CHECK (wvat_cents >= 0),
  ADD COLUMN wvat_certificate_number TEXT CHECK (wvat_certificate_number IS NULL OR length(wvat_certificate_number) <= 100);
ALTER TABLE public.bill_payments
  ADD COLUMN wht_cents BIGINT NOT NULL DEFAULT 0 CHECK (wht_cents >= 0),
  ADD COLUMN wht_certificate_number TEXT CHECK (wht_certificate_number IS NULL OR length(wht_certificate_number) <= 100),
  ADD COLUMN wvat_cents BIGINT NOT NULL DEFAULT 0 CHECK (wvat_cents >= 0),
  ADD COLUMN wvat_certificate_number TEXT CHECK (wvat_certificate_number IS NULL OR length(wvat_certificate_number) <= 100);

-- The organization's account with this code, made if it has none yet.
CREATE FUNCTION private.withholding_account(p_org_id UUID, p_code TEXT, p_name TEXT, p_type TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_account RECORD;
  v_id UUID;
BEGIN
  SELECT account.id, account.type::TEXT AS type, account.is_active INTO v_account
  FROM public.accounts AS account WHERE account.org_id = p_org_id AND account.code = p_code;
  IF FOUND THEN
    IF v_account.type <> p_type OR NOT v_account.is_active THEN
      RAISE EXCEPTION 'Account % is needed as an active % account for tax withheld.', p_code, lower(p_type) USING ERRCODE = '23514';
    END IF;
    RETURN v_account.id;
  END IF;
  INSERT INTO public.accounts (org_id, code, name, type, currency, is_bank_account)
  SELECT p_org_id, p_code, p_name, p_type::public.account_type, upper(org.base_currency), false
  FROM public.organizations AS org WHERE org.id = p_org_id
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION private.withholding_account(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. An invoice paid net of tax the customer withheld.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.receive_invoice_payment_withheld(
  p_org_id UUID,
  p_invoice_id UUID,
  p_cash_cents BIGINT,
  p_wht_cents BIGINT,
  p_wvat_cents BIGINT,
  p_wht_certificate TEXT,
  p_wvat_certificate TEXT,
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
  v_total BIGINT;
  v_prior RECORD;
  v_wht_certificate TEXT := NULLIF(btrim(COALESCE(p_wht_certificate, '')), '');
  v_wvat_certificate TEXT := NULLIF(btrim(COALESCE(p_wvat_certificate, '')), '');
  v_lines JSONB := '[]'::JSONB;
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
  SELECT payment.id, payment.journal_entry_id, payment.invoice_id, invoice.amount_due_cents, invoice.status INTO v_existing
  FROM public.invoice_payments AS payment
  JOIN public.invoices AS invoice ON invoice.org_id = payment.org_id AND invoice.id = payment.invoice_id
  WHERE payment.org_id = p_org_id AND payment.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.invoice_id IS DISTINCT FROM p_invoice_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different invoice payment.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('paymentId', v_existing.id, 'journalEntryId', v_existing.journal_entry_id,
      'amountDueCents', v_existing.amount_due_cents, 'status', v_existing.status);
  END IF;

  IF p_cash_cents IS NULL OR p_cash_cents < 0 OR p_wht_cents IS NULL OR p_wht_cents < 0
    OR p_wvat_cents IS NULL OR p_wvat_cents < 0 OR p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Enter the amount received, the tax withheld and the date.' USING ERRCODE = '22023';
  END IF;
  v_total := p_cash_cents + p_wht_cents + p_wvat_cents;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'The payment settles nothing.' USING ERRCODE = '22023';
  END IF;
  IF p_wht_cents > 0 AND v_wht_certificate IS NULL THEN
    RAISE EXCEPTION 'Enter the number of the customer''s withholding tax certificate.' USING ERRCODE = '22023';
  END IF;
  IF p_wvat_cents > 0 AND v_wvat_certificate IS NULL THEN
    RAISE EXCEPTION 'Enter the number of the customer''s withholding VAT certificate.' USING ERRCODE = '22023';
  END IF;
  IF length(v_wht_certificate) > 100 OR length(v_wvat_certificate) > 100 THEN
    RAISE EXCEPTION 'A certificate number is up to 100 characters.' USING ERRCODE = '22023';
  END IF;

  SELECT invoice.id, invoice.customer_id, invoice.invoice_number, invoice.status, invoice.subtotal_cents,
         invoice.tax_cents, invoice.amount_due_cents, upper(invoice.currency) AS currency, invoice.matter_id
  INTO v_invoice
  FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id AND invoice.id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found in this organization.' USING ERRCODE = '23503';
  END IF;
  IF v_invoice.matter_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id AND edition = 'law') THEN
    RAISE EXCEPTION 'Fee note % is paid from its matter, where withholding is recorded.', v_invoice.invoice_number USING ERRCODE = '23514';
  END IF;
  IF v_invoice.status IN ('PAID', 'VOID', 'DRAFT') OR v_invoice.amount_due_cents <= 0 THEN
    RAISE EXCEPTION 'This invoice cannot receive a payment.' USING ERRCODE = '23514';
  END IF;
  IF v_total > v_invoice.amount_due_cents THEN
    RAISE EXCEPTION 'The amount received and the tax withheld come to more than is due on %.', v_invoice.invoice_number USING ERRCODE = '23514';
  END IF;
  SELECT upper(org.base_currency) INTO v_base FROM public.organizations AS org WHERE org.id = p_org_id;
  IF v_invoice.currency IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION 'Tax withheld is recorded on invoices in %. Invoice % is in %.', v_base, v_invoice.invoice_number, v_invoice.currency
      USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_money_account(p_org_id, p_deposit_account_id, 'The deposit account');
  IF (SELECT upper(account.currency) FROM public.accounts AS account WHERE account.org_id = p_org_id AND account.id = p_deposit_account_id) IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION 'Receive a payment with tax withheld into a % account.', v_base USING ERRCODE = '22023';
  END IF;

  -- Withheld tax never comes to more than the invoice carries.
  SELECT COALESCE(sum(payment.wht_cents), 0)::BIGINT AS wht, COALESCE(sum(payment.wvat_cents), 0)::BIGINT AS wvat INTO v_prior
  FROM public.invoice_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.invoice_id = p_invoice_id AND payment.reversed_at IS NULL;
  IF p_wvat_cents > v_invoice.tax_cents - v_prior.wvat THEN
    RAISE EXCEPTION 'VAT withheld cannot be more than the VAT on % (% cents, % already withheld).',
      v_invoice.invoice_number, v_invoice.tax_cents, v_prior.wvat USING ERRCODE = '23514';
  END IF;
  IF p_wht_cents > v_invoice.subtotal_cents - v_prior.wht THEN
    RAISE EXCEPTION 'Income tax withheld cannot be more than the value of % before VAT.', v_invoice.invoice_number USING ERRCODE = '23514';
  END IF;

  IF p_cash_cents > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('accountId', p_deposit_account_id, 'debit', p_cash_cents, 'credit', 0,
      'description', 'Customer payment', 'entityType', 'CUSTOMER', 'entityId', v_invoice.customer_id));
  END IF;
  IF p_wht_cents > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', private.withholding_account(p_org_id, '1170', 'Withholding tax receivable', 'ASSET'),
      'debit', p_wht_cents, 'credit', 0, 'description', 'Income tax withheld, certificate ' || v_wht_certificate,
      'entityType', 'CUSTOMER', 'entityId', v_invoice.customer_id));
  END IF;
  IF p_wvat_cents > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', private.withholding_account(p_org_id, '1175', 'VAT withheld by customers', 'ASSET'),
      'debit', p_wvat_cents, 'credit', 0, 'description', 'VAT withheld, certificate ' || v_wvat_certificate,
      'entityType', 'CUSTOMER', 'entityId', v_invoice.customer_id));
  END IF;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('accountId', private.control_account(p_org_id, '1100'),
    'debit', 0, 'credit', v_total, 'description', 'Reduce accounts receivable', 'entityType', 'CUSTOMER', 'entityId', v_invoice.customer_id));
  v_entry := private.insert_journal_entry(p_org_id, p_payment_date, 'Payment received for ' || v_invoice.invoice_number,
    'PAYMENT', p_invoice_id, v_invoice.invoice_number, p_created_by, v_lines, 'invoice-payment-withheld:' || p_idempotency_key);

  INSERT INTO public.invoice_payments (id, org_id, invoice_id, amount_cents, currency, foreign_amount_cents, exchange_rate,
    payment_date, account_id, journal_entry_id, idempotency_key, created_by,
    wht_cents, wht_certificate_number, wvat_cents, wvat_certificate_number)
  VALUES (v_payment_id, p_org_id, p_invoice_id, v_total, v_base, v_total, 1, p_payment_date, p_deposit_account_id, v_entry,
    p_idempotency_key, p_created_by, p_wht_cents, v_wht_certificate, p_wvat_cents, v_wvat_certificate);

  v_due := v_invoice.amount_due_cents - v_total;
  v_status := CASE WHEN v_due = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END;
  UPDATE public.invoices SET amount_due_cents = v_due, status = v_status WHERE org_id = p_org_id AND id = p_invoice_id;
  UPDATE public.customers SET balance = greatest(COALESCE(balance, 0) - v_total, 0)
  WHERE org_id = p_org_id AND id = v_invoice.customer_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'PAYMENT', 'INVOICE', p_invoice_id,
    jsonb_build_object('paymentId', v_payment_id, 'cashCents', p_cash_cents, 'whtCents', p_wht_cents, 'wvatCents', p_wvat_cents,
      'amountDueCents', v_due, 'status', v_status));
  RETURN jsonb_build_object('paymentId', v_payment_id, 'journalEntryId', v_entry, 'amountDueCents', v_due, 'status', v_status);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. A bill paid net of tax this business withheld and owes to KRA.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.pay_bill_withheld(
  p_org_id UUID,
  p_bill_id UUID,
  p_cash_cents BIGINT,
  p_wht_cents BIGINT,
  p_wvat_cents BIGINT,
  p_wht_certificate TEXT,
  p_wvat_certificate TEXT,
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
  v_total BIGINT;
  v_prior RECORD;
  v_threshold BIGINT;
  v_wht_certificate TEXT := NULLIF(btrim(COALESCE(p_wht_certificate, '')), '');
  v_wvat_certificate TEXT := NULLIF(btrim(COALESCE(p_wvat_certificate, '')), '');
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
  SELECT payment.id, payment.journal_entry_id, payment.bill_id, bill.amount_due_cents, bill.status INTO v_existing
  FROM public.bill_payments AS payment
  JOIN public.bills AS bill ON bill.org_id = payment.org_id AND bill.id = payment.bill_id
  WHERE payment.org_id = p_org_id AND payment.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.bill_id IS DISTINCT FROM p_bill_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different bill payment.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('paymentId', v_existing.id, 'journalEntryId', v_existing.journal_entry_id,
      'amountDueCents', v_existing.amount_due_cents, 'status', v_existing.status);
  END IF;

  IF p_cash_cents IS NULL OR p_cash_cents < 0 OR p_wht_cents IS NULL OR p_wht_cents < 0
    OR p_wvat_cents IS NULL OR p_wvat_cents < 0 OR p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Enter the amount paid, the tax withheld and the date.' USING ERRCODE = '22023';
  END IF;
  v_total := p_cash_cents + p_wht_cents + p_wvat_cents;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'The payment settles nothing.' USING ERRCODE = '22023';
  END IF;
  IF length(v_wht_certificate) > 100 OR length(v_wvat_certificate) > 100 THEN
    RAISE EXCEPTION 'A certificate number is up to 100 characters.' USING ERRCODE = '22023';
  END IF;

  SELECT bill.id, bill.vendor_id, bill.bill_number, bill.status, bill.subtotal_cents, bill.tax_cents, bill.total_cents,
         bill.amount_due_cents, upper(bill.currency) AS currency, bill.approved_at
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
  IF v_total > v_bill.amount_due_cents THEN
    RAISE EXCEPTION 'The amount paid and the tax withheld come to more than is due on %.', v_bill.bill_number USING ERRCODE = '23514';
  END IF;
  SELECT org.approval_threshold_cents, upper(org.base_currency) INTO v_threshold, v_base FROM public.organizations AS org WHERE org.id = p_org_id;
  IF v_threshold IS NOT NULL AND v_bill.total_cents >= v_threshold AND v_bill.approved_at IS NULL THEN
    RAISE EXCEPTION 'Bill % needs approval before it is paid.', v_bill.bill_number USING ERRCODE = '42501';
  END IF;
  IF v_bill.currency IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION 'Tax withheld is recorded on bills in %. Bill % is in %.', v_base, v_bill.bill_number, v_bill.currency USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_money_account(p_org_id, p_source_account_id, 'The payment account');
  IF (SELECT upper(account.currency) FROM public.accounts AS account WHERE account.org_id = p_org_id AND account.id = p_source_account_id) IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION 'Pay a bill with tax withheld from a % account.', v_base USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(payment.wht_cents), 0)::BIGINT AS wht, COALESCE(sum(payment.wvat_cents), 0)::BIGINT AS wvat INTO v_prior
  FROM public.bill_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.bill_id = p_bill_id AND payment.reversed_at IS NULL;
  IF p_wvat_cents > v_bill.tax_cents - v_prior.wvat THEN
    RAISE EXCEPTION 'VAT withheld cannot be more than the VAT on % (% cents, % already withheld).',
      v_bill.bill_number, v_bill.tax_cents, v_prior.wvat USING ERRCODE = '23514';
  END IF;
  IF p_wht_cents > v_bill.subtotal_cents - v_prior.wht THEN
    RAISE EXCEPTION 'Income tax withheld cannot be more than the value of % before VAT.', v_bill.bill_number USING ERRCODE = '23514';
  END IF;

  v_lines := jsonb_build_array(jsonb_build_object('accountId', private.control_account(p_org_id, '2000'),
    'debit', v_total, 'credit', 0, 'description', 'Reduce accounts payable', 'entityType', 'VENDOR', 'entityId', v_bill.vendor_id));
  IF p_cash_cents > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('accountId', p_source_account_id, 'debit', 0, 'credit', p_cash_cents,
      'description', 'Vendor payment', 'entityType', 'VENDOR', 'entityId', v_bill.vendor_id));
  END IF;
  IF p_wht_cents > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', private.withholding_account(p_org_id, '2150', 'Withholding tax payable', 'LIABILITY'),
      'debit', 0, 'credit', p_wht_cents, 'description', 'Income tax withheld' || COALESCE(', certificate ' || v_wht_certificate, ''),
      'entityType', 'VENDOR', 'entityId', v_bill.vendor_id));
  END IF;
  IF p_wvat_cents > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', private.withholding_account(p_org_id, '2155', 'Withholding VAT payable', 'LIABILITY'),
      'debit', 0, 'credit', p_wvat_cents, 'description', 'VAT withheld' || COALESCE(', certificate ' || v_wvat_certificate, ''),
      'entityType', 'VENDOR', 'entityId', v_bill.vendor_id));
  END IF;
  v_entry := private.insert_journal_entry(p_org_id, p_payment_date, 'Payment for ' || v_bill.bill_number,
    'PAYMENT', p_bill_id, v_bill.bill_number, p_created_by, v_lines, 'bill-payment-withheld:' || p_idempotency_key);

  INSERT INTO public.bill_payments (id, org_id, bill_id, amount_cents, currency, foreign_amount_cents, exchange_rate,
    payment_date, account_id, journal_entry_id, idempotency_key, created_by,
    wht_cents, wht_certificate_number, wvat_cents, wvat_certificate_number)
  VALUES (v_payment_id, p_org_id, p_bill_id, v_total, v_base, v_total, 1, p_payment_date, p_source_account_id, v_entry,
    p_idempotency_key, p_created_by, p_wht_cents, v_wht_certificate, p_wvat_cents, v_wvat_certificate);

  v_due := v_bill.amount_due_cents - v_total;
  v_status := CASE WHEN v_due = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END;
  UPDATE public.bills SET amount_due_cents = v_due, status = v_status WHERE org_id = p_org_id AND id = p_bill_id;
  UPDATE public.vendors SET balance = greatest(COALESCE(balance, 0) - v_total, 0)
  WHERE org_id = p_org_id AND id = v_bill.vendor_id;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'PAYMENT', 'BILL', p_bill_id,
    jsonb_build_object('paymentId', v_payment_id, 'cashCents', p_cash_cents, 'whtCents', p_wht_cents, 'wvatCents', p_wvat_cents,
      'amountDueCents', v_due, 'status', v_status));
  RETURN jsonb_build_object('paymentId', v_payment_id, 'journalEntryId', v_entry, 'amountDueCents', v_due, 'status', v_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_invoice_payment_withheld(UUID, UUID, BIGINT, BIGINT, BIGINT, TEXT, TEXT, DATE, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay_bill_withheld(UUID, UUID, BIGINT, BIGINT, BIGINT, TEXT, TEXT, DATE, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_invoice_payment_withheld(UUID, UUID, BIGINT, BIGINT, BIGINT, TEXT, TEXT, DATE, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay_bill_withheld(UUID, UUID, BIGINT, BIGINT, BIGINT, TEXT, TEXT, DATE, UUID, TEXT, UUID) TO service_role;

-- Rollback: drop the two public functions and private.withholding_account;
-- drop invoice_payments.wvat_cents and wvat_certificate_number, and
-- bill_payments.wht_cents, wht_certificate_number, wvat_cents and
-- wvat_certificate_number. Accounts 1170, 1175, 2150 and 2155 made by the
-- functions stay in the chart.
