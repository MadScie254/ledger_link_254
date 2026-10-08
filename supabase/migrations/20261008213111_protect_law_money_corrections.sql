-- Forward corrections to the already-applied client-account migration.
-- All posting RPCs are SECURITY DEFINER; the Worker needs read access to the
-- immutable journal, not direct write access to its tables.
REVOKE INSERT,UPDATE,DELETE ON public.journal_entries,public.journal_lines
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.protect_client_money_accounts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_code TEXT; v_source TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations AS org
    WHERE org.id=NEW.org_id AND org.edition='law') THEN RETURN NEW; END IF;
  SELECT account.code INTO v_code FROM public.accounts AS account
  WHERE account.org_id=NEW.org_id AND account.id=NEW.account_id;
  IF v_code NOT IN ('1060','2200') THEN RETURN NEW; END IF;
  SELECT entry.source_type INTO v_source FROM public.journal_entries AS entry
  WHERE entry.org_id=NEW.org_id AND entry.id=NEW.journal_entry_id;
  IF v_source NOT IN ('CLIENT_RECEIPT','CLIENT_PAYMENT','CLIENT_TRANSFER',
      'CLIENT_TRANSFER_REVERSAL') OR v_source IS NULL THEN
    RAISE EXCEPTION 'Client money (1060/2200) moves only through client receipts, payments and transfers.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.tag_law_journal_line() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_source TEXT; v_source_id UUID; v_matter_id UUID; v_client_id UUID;
BEGIN
  SELECT entry.source_type,entry.source_id INTO v_source,v_source_id
  FROM public.journal_entries AS entry
  WHERE entry.org_id=NEW.org_id AND entry.id=NEW.journal_entry_id;
  IF v_source IN ('CLIENT_RECEIPT','CLIENT_PAYMENT','CLIENT_TRANSFER','DISBURSEMENT',
      'CLIENT_TRANSFER_REVERSAL') THEN
    v_matter_id := v_source_id;
  ELSIF v_source IN ('PAYMENT','FEE_PAYMENT_REVERSAL') THEN
    SELECT invoice.matter_id INTO v_matter_id FROM public.invoices AS invoice
    WHERE invoice.org_id=NEW.org_id AND invoice.id=v_source_id;
  END IF;
  IF v_matter_id IS NULL THEN RETURN NEW; END IF;
  SELECT matter.client_id INTO v_client_id FROM public.matters AS matter
  WHERE matter.org_id=NEW.org_id AND matter.id=v_matter_id;
  IF NOT FOUND OR NEW.entity_type IS DISTINCT FROM 'CUSTOMER'
    OR NEW.entity_id IS DISTINCT FROM v_client_id THEN
    RAISE EXCEPTION 'Law journal line must belong to its matter and client.' USING ERRCODE='23503';
  END IF;
  NEW.entity_type := 'MATTER'; NEW.entity_id := v_matter_id;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION private.preserve_posted_matter_client() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id AND (
    EXISTS (SELECT 1 FROM public.journal_lines AS line
      WHERE line.org_id=OLD.org_id AND line.entity_type='MATTER' AND line.entity_id=OLD.id)
    OR EXISTS (SELECT 1 FROM public.invoices AS invoice
      WHERE invoice.org_id=OLD.org_id AND invoice.matter_id=OLD.id)
  ) THEN
    RAISE EXCEPTION 'A matter client cannot change after financial posting.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.preserve_posted_matter_client()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER matters_preserve_posted_client BEFORE UPDATE OF client_id ON public.matters
  FOR EACH ROW EXECUTE FUNCTION private.preserve_posted_matter_client();

-- The lowest balance on or after the proposed withdrawal date. A later
-- posted payment must still be covered when an older payment is backdated.
CREATE FUNCTION private.available_client_balance(p_org_id UUID,p_matter_id UUID,p_on DATE)
RETURNS BIGINT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_now BIGINT; v_future_min BIGINT;
BEGIN
  SELECT balance_cents INTO v_now FROM public.client_balances(p_org_id,p_on)
  WHERE matter_id=p_matter_id;
  IF v_now IS NULL THEN RETURN 0; END IF;
  WITH daily AS (
    SELECT entry.entry_date,sum(line.credit-line.debit)::BIGINT AS delta
    FROM public.journal_lines AS line
    JOIN public.journal_entries AS entry ON entry.org_id=line.org_id AND entry.id=line.journal_entry_id
    JOIN public.accounts AS account ON account.org_id=line.org_id AND account.id=line.account_id
    WHERE line.org_id=p_org_id AND line.entity_type='MATTER' AND line.entity_id=p_matter_id
      AND account.code='2200' AND entry.entry_date>p_on
    GROUP BY entry.entry_date
  ), running AS (
    SELECT v_now+sum(delta) OVER (ORDER BY entry_date) AS balance FROM daily
  ) SELECT min(balance)::BIGINT INTO v_future_min FROM running;
  RETURN least(v_now,COALESCE(v_future_min,v_now));
END;
$function$;
REVOKE ALL ON FUNCTION private.available_client_balance(UUID,UUID,DATE)
  FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.record_client_receipt(p_org_id UUID,p_matter_id UUID,
  p_amount_cents BIGINT,p_receipt_date DATE,p_method TEXT,p_reference TEXT,
  p_idempotency_key TEXT,p_created_by UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_client UUID; v_entry UUID; v_bank UUID; v_liability UUID;
BEGIN
  v_client := private.require_law_matter(p_org_id,p_matter_id,p_created_by);
  IF p_amount_cents IS NULL OR p_amount_cents<=0 OR p_receipt_date IS NULL
    OR NULLIF(btrim(p_method),'') IS NULL OR NULLIF(btrim(p_reference),'') IS NULL THEN
    RAISE EXCEPTION 'Client receipt amount, date, method and reference are required.' USING ERRCODE='22023';
  END IF;
  v_entry := private.law_existing_entry(p_org_id,p_idempotency_key,'CLIENT_RECEIPT',
    p_matter_id,p_receipt_date,p_amount_cents,'1060',true);
  IF v_entry IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.audit_logs AS audit
      WHERE audit.org_id=p_org_id AND audit.resource_type='CLIENT_RECEIPT'
        AND audit.resource_id=v_entry AND audit.details->>'method'=p_method
        AND audit.details->>'reference'=p_reference) THEN
      RAISE EXCEPTION 'Idempotency key was already used for another client receipt.' USING ERRCODE='23505';
    END IF;
    RETURN v_entry;
  END IF;
  IF EXISTS (SELECT 1 FROM public.matters WHERE org_id=p_org_id AND id=p_matter_id AND status='CLOSED') THEN
    RAISE EXCEPTION 'A closed matter cannot receive client money.' USING ERRCODE='23514';
  END IF;
  v_bank := private.law_account(p_org_id,'1060','ASSET',true);
  v_liability := private.law_account(p_org_id,'2200','LIABILITY');
  v_entry := private.insert_journal_entry(p_org_id,p_receipt_date,
    'Client receipt (' || btrim(p_method) || ')','CLIENT_RECEIPT',p_matter_id,p_reference,p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId',v_bank,'debit',p_amount_cents,'credit',0,'entityType','CUSTOMER','entityId',v_client),
      jsonb_build_object('accountId',v_liability,'debit',0,'credit',p_amount_cents,'entityType','CUSTOMER','entityId',v_client)),
    'law:' || p_idempotency_key);
  INSERT INTO public.audit_logs(org_id,user_id,action,resource_type,resource_id,details)
  VALUES(p_org_id,p_created_by,'CREATE','CLIENT_RECEIPT',v_entry,
    jsonb_build_object('matterId',p_matter_id,'amountCents',p_amount_cents,'method',p_method,'reference',p_reference));
  RETURN v_entry;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_client_payment(p_org_id UUID,p_matter_id UUID,
  p_amount_cents BIGINT,p_payment_date DATE,p_payee TEXT,p_purpose TEXT,
  p_as_disbursement BOOLEAN,p_idempotency_key TEXT,p_created_by UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_client UUID; v_entry UUID; v_bank UUID; v_liability UUID; v_balance BIGINT;
BEGIN
  v_client := private.require_law_matter(p_org_id,p_matter_id,p_created_by);
  IF p_amount_cents IS NULL OR p_amount_cents<=0 OR p_payment_date IS NULL
    OR NULLIF(btrim(p_payee),'') IS NULL OR NULLIF(btrim(p_purpose),'') IS NULL
    OR p_as_disbursement IS NULL THEN
    RAISE EXCEPTION 'Client payment amount, date, payee and purpose are required.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':client:' || p_matter_id::TEXT,0));
  v_entry := private.law_existing_entry(p_org_id,p_idempotency_key,'CLIENT_PAYMENT',
    p_matter_id,p_payment_date,p_amount_cents,'2200',true);
  IF v_entry IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.audit_logs AS audit
      WHERE audit.org_id=p_org_id AND audit.resource_type='CLIENT_PAYMENT'
        AND audit.resource_id=v_entry AND audit.details->>'payee'=p_payee
        AND audit.details->>'purpose'=p_purpose
        AND (audit.details->>'asDisbursement')::BOOLEAN=p_as_disbursement) THEN
      RAISE EXCEPTION 'Idempotency key was already used for another client payment.' USING ERRCODE='23505';
    END IF;
    RETURN v_entry;
  END IF;
  v_balance := private.available_client_balance(p_org_id,p_matter_id,p_payment_date);
  IF p_amount_cents>COALESCE(v_balance,0) THEN
    RAISE EXCEPTION 'Client payment exceeds this matter client balance.' USING ERRCODE='23514';
  END IF;
  v_bank := private.law_account(p_org_id,'1060','ASSET',true);
  v_liability := private.law_account(p_org_id,'2200','LIABILITY');
  v_entry := private.insert_journal_entry(p_org_id,p_payment_date,
    'Client payment to ' || btrim(p_payee),'CLIENT_PAYMENT',p_matter_id,NULL,p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId',v_liability,'debit',p_amount_cents,'credit',0,'entityType','CUSTOMER','entityId',v_client),
      jsonb_build_object('accountId',v_bank,'debit',0,'credit',p_amount_cents,'entityType','CUSTOMER','entityId',v_client)),
    'law:' || p_idempotency_key);
  IF p_as_disbursement THEN
    INSERT INTO public.disbursements(org_id,matter_id,incurred_on,description,amount_cents,
      paid_from,journal_entry_id,created_by)
    VALUES(p_org_id,p_matter_id,p_payment_date,p_purpose,p_amount_cents,'CLIENT',v_entry,p_created_by);
  END IF;
  INSERT INTO public.audit_logs(org_id,user_id,action,resource_type,resource_id,details)
  VALUES(p_org_id,p_created_by,'CREATE','CLIENT_PAYMENT',v_entry,
    jsonb_build_object('matterId',p_matter_id,'amountCents',p_amount_cents,'payee',p_payee,
      'purpose',p_purpose,'asDisbursement',p_as_disbursement));
  RETURN v_entry;
END;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_client_to_office(p_org_id UUID,p_matter_id UUID,
  p_invoice_id UUID,p_amount_cents BIGINT,p_transfer_date DATE,p_office_account_id UUID,
  p_idempotency_key TEXT,p_created_by UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_client UUID; v_entry UUID; v_bank UUID; v_liability UUID; v_ar UUID;
  v_invoice RECORD; v_balance BIGINT; v_due BIGINT; v_payment_id UUID;
BEGIN
  v_client := private.require_law_matter(p_org_id,p_matter_id,p_created_by);
  IF p_amount_cents IS NULL OR p_amount_cents<=0 OR p_transfer_date IS NULL THEN
    RAISE EXCEPTION 'Transfer amount and date are required.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':client:' || p_matter_id::TEXT,0));
  v_entry := private.law_existing_entry(p_org_id,p_idempotency_key,'CLIENT_TRANSFER',
    p_matter_id,p_transfer_date,p_amount_cents,'2200',true);
  IF v_entry IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.invoice_payments AS payment
      WHERE payment.org_id=p_org_id AND payment.journal_entry_id=v_entry
        AND payment.invoice_id=p_invoice_id AND payment.account_id=p_office_account_id) THEN
      RAISE EXCEPTION 'Idempotency key was already used for another transfer.' USING ERRCODE='23505';
    END IF;
    RETURN v_entry;
  END IF;
  SELECT invoice.id,invoice.invoice_number,invoice.customer_id,invoice.matter_id,
    invoice.status,invoice.amount_due_cents,invoice.currency
  INTO v_invoice FROM public.invoices AS invoice
  WHERE invoice.org_id=p_org_id AND invoice.id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.matter_id IS DISTINCT FROM p_matter_id
    OR v_invoice.customer_id IS DISTINCT FROM v_client THEN
    RAISE EXCEPTION 'Invoice does not belong to this matter and client.' USING ERRCODE='23503';
  END IF;
  IF v_invoice.status NOT IN ('SENT','PARTIALLY_PAID') OR v_invoice.amount_due_cents<=0 THEN
    RAISE EXCEPTION 'This invoice cannot receive a client-money transfer.' USING ERRCODE='23514';
  END IF;
  IF p_amount_cents>v_invoice.amount_due_cents THEN
    RAISE EXCEPTION 'Transfer exceeds the invoice amount due.' USING ERRCODE='23514';
  END IF;
  IF v_invoice.currency IS DISTINCT FROM (SELECT upper(base_currency) FROM public.organizations WHERE id=p_org_id) THEN
    RAISE EXCEPTION 'Client-money transfers require a base-currency fee note.' USING ERRCODE='22023';
  END IF;
  v_balance := private.available_client_balance(p_org_id,p_matter_id,p_transfer_date);
  IF p_amount_cents>COALESCE(v_balance,0) THEN
    RAISE EXCEPTION 'Transfer exceeds this matter client balance.' USING ERRCODE='23514';
  END IF;
  PERFORM private.require_office_bank(p_org_id,p_office_account_id);
  v_bank := private.law_account(p_org_id,'1060','ASSET',true);
  v_liability := private.law_account(p_org_id,'2200','LIABILITY');
  v_ar := private.law_account(p_org_id,'1100','ASSET');
  v_entry := private.insert_journal_entry(p_org_id,p_transfer_date,
    'Client money transferred to office for ' || v_invoice.invoice_number,
    'CLIENT_TRANSFER',p_matter_id,v_invoice.invoice_number,p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId',v_liability,'debit',p_amount_cents,'credit',0,'entityType','CUSTOMER','entityId',v_client),
      jsonb_build_object('accountId',v_bank,'debit',0,'credit',p_amount_cents,'entityType','CUSTOMER','entityId',v_client),
      jsonb_build_object('accountId',p_office_account_id,'debit',p_amount_cents,'credit',0,'entityType','CUSTOMER','entityId',v_client),
      jsonb_build_object('accountId',v_ar,'debit',0,'credit',p_amount_cents,'entityType','CUSTOMER','entityId',v_client)),
    'law:' || p_idempotency_key);
  v_payment_id := gen_random_uuid();
  INSERT INTO public.invoice_payments(id,org_id,invoice_id,amount_cents,currency,
    foreign_amount_cents,exchange_rate,payment_date,account_id,journal_entry_id,idempotency_key,created_by)
  VALUES(v_payment_id,p_org_id,p_invoice_id,p_amount_cents,v_invoice.currency,
    p_amount_cents,1,p_transfer_date,p_office_account_id,v_entry,'law-transfer:' || p_idempotency_key,p_created_by);
  v_due := v_invoice.amount_due_cents-p_amount_cents;
  UPDATE public.invoices SET amount_due_cents=v_due,
    status=CASE WHEN v_due=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END
  WHERE org_id=p_org_id AND id=p_invoice_id;
  UPDATE public.customers SET balance=greatest(COALESCE(balance,0)-p_amount_cents,0)
  WHERE org_id=p_org_id AND id=v_client;
  INSERT INTO public.audit_logs(org_id,user_id,action,resource_type,resource_id,details)
  VALUES(p_org_id,p_created_by,'PAYMENT','INVOICE',p_invoice_id,
    jsonb_build_object('paymentId',v_payment_id,'journalEntryId',v_entry,
      'matterId',p_matter_id,'clientTransferCents',p_amount_cents,'amountDueCents',v_due));
  RETURN v_entry;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_office_disbursement(p_org_id UUID,p_matter_id UUID,
  p_amount_cents BIGINT,p_incurred_on DATE,p_description TEXT,p_paid_from_account_id UUID,
  p_receipt_reference TEXT,p_idempotency_key TEXT,p_created_by UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_client UUID; v_entry UUID; v_recoverable UUID;
BEGIN
  v_client := private.require_law_matter(p_org_id,p_matter_id,p_created_by);
  IF p_amount_cents IS NULL OR p_amount_cents<=0 OR p_incurred_on IS NULL
    OR NULLIF(btrim(p_description),'') IS NULL THEN
    RAISE EXCEPTION 'Office disbursement amount, date and description are required.' USING ERRCODE='22023';
  END IF;
  v_entry := private.law_existing_entry(p_org_id,p_idempotency_key,'DISBURSEMENT',
    p_matter_id,p_incurred_on,p_amount_cents,'1180',true);
  IF v_entry IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.disbursements AS disbursement
      JOIN public.audit_logs AS audit ON audit.org_id=disbursement.org_id
        AND audit.resource_type='DISBURSEMENT' AND audit.resource_id=v_entry
      WHERE disbursement.org_id=p_org_id AND disbursement.journal_entry_id=v_entry
        AND disbursement.description=p_description
        AND disbursement.receipt_reference IS NOT DISTINCT FROM p_receipt_reference
        AND audit.details->>'paidFromAccountId'=p_paid_from_account_id::TEXT) THEN
      RAISE EXCEPTION 'Idempotency key was already used for another disbursement.' USING ERRCODE='23505';
    END IF;
    RETURN v_entry;
  END IF;
  PERFORM private.require_office_bank(p_org_id,p_paid_from_account_id);
  v_recoverable := private.law_account(p_org_id,'1180','ASSET');
  v_entry := private.insert_journal_entry(p_org_id,p_incurred_on,p_description,
    'DISBURSEMENT',p_matter_id,p_receipt_reference,p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId',v_recoverable,'debit',p_amount_cents,'credit',0,'entityType','CUSTOMER','entityId',v_client),
      jsonb_build_object('accountId',p_paid_from_account_id,'debit',0,'credit',p_amount_cents,'entityType','CUSTOMER','entityId',v_client)),
    'law:' || p_idempotency_key);
  INSERT INTO public.disbursements(org_id,matter_id,incurred_on,description,amount_cents,
    paid_from,journal_entry_id,receipt_reference,created_by)
  VALUES(p_org_id,p_matter_id,p_incurred_on,p_description,p_amount_cents,
    'OFFICE',v_entry,p_receipt_reference,p_created_by);
  INSERT INTO public.audit_logs(org_id,user_id,action,resource_type,resource_id,details)
  VALUES(p_org_id,p_created_by,'CREATE','DISBURSEMENT',v_entry,
    jsonb_build_object('matterId',p_matter_id,'amountCents',p_amount_cents,
      'paidFromAccountId',p_paid_from_account_id,'receiptReference',p_receipt_reference));
  RETURN v_entry;
END;
$function$;

-- The core journal writer accepts CUSTOMER tags. The existing law trigger
-- converts these back to MATTER tags after checking the current matter client.
CREATE FUNCTION private.law_reversal_lines(p_org_id UUID,p_entry_id UUID,
  p_client_id UUID,p_label TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT jsonb_agg(jsonb_build_object(
    'accountId',line.account_id,'debit',line.credit,'credit',line.debit,
    'description','Reversal: ' || COALESCE(line.description,p_label),
    'entityType','CUSTOMER','entityId',p_client_id,
    'currency',line.currency,'foreignDebit',line.foreign_credit,
    'foreignCredit',line.foreign_debit,'exchangeRate',line.exchange_rate
  ) ORDER BY line.id)
  FROM public.journal_lines AS line
  WHERE line.org_id=p_org_id AND line.journal_entry_id=p_entry_id;
$function$;
REVOKE ALL ON FUNCTION private.law_reversal_lines(UUID,UUID,UUID,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.reverse_law_invoice_payment(p_org_id UUID,p_payment_id UUID,
  p_reversal_date DATE,p_reason TEXT,p_actor UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_payment RECORD; v_invoice RECORD; v_matter UUID; v_source TEXT;
  v_reason TEXT; v_reversal_id UUID; v_new_due BIGINT; v_status TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id,p_actor);
  v_reason := private.require_reason(p_reason,'this payment');
  IF p_reversal_date IS NULL THEN
    RAISE EXCEPTION 'A reversal date is required.' USING ERRCODE='22023';
  END IF;
  SELECT invoice.matter_id INTO v_matter
  FROM public.invoice_payments AS payment
  JOIN public.invoices AS invoice ON invoice.org_id=payment.org_id
    AND invoice.id=payment.invoice_id
  WHERE payment.org_id=p_org_id AND payment.id=p_payment_id;
  IF v_matter IS NULL THEN
    RAISE EXCEPTION 'Law payment not found in this organization.' USING ERRCODE='23503';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':client:' || v_matter::TEXT,0));
  SELECT payment.id,payment.invoice_id,payment.amount_cents,payment.payment_date,
    payment.journal_entry_id,payment.reversed_at,payment.reversal_journal_entry_id
  INTO v_payment FROM public.invoice_payments AS payment
  WHERE payment.org_id=p_org_id AND payment.id=p_payment_id FOR UPDATE;
  SELECT invoice.id,invoice.invoice_number,invoice.customer_id,invoice.matter_id,
    invoice.status,invoice.total_cents,invoice.amount_due_cents
  INTO v_invoice FROM public.invoices AS invoice
  WHERE invoice.org_id=p_org_id AND invoice.id=v_payment.invoice_id FOR UPDATE;
  IF v_invoice.matter_id IS DISTINCT FROM v_matter THEN
    RAISE EXCEPTION 'Payment matter changed during reversal.' USING ERRCODE='40001';
  END IF;
  IF v_payment.reversed_at IS NOT NULL THEN
    RETURN jsonb_build_object('reversalJournalEntryId',v_payment.reversal_journal_entry_id,
      'amountDueCents',v_invoice.amount_due_cents,'status',v_invoice.status);
  END IF;
  IF p_reversal_date<v_payment.payment_date THEN
    RAISE EXCEPTION 'A reversal cannot be dated before the payment it reverses.' USING ERRCODE='22023';
  END IF;
  SELECT entry.source_type INTO v_source FROM public.journal_entries AS entry
  WHERE entry.org_id=p_org_id AND entry.id=v_payment.journal_entry_id;
  IF v_source NOT IN ('CLIENT_TRANSFER','PAYMENT') OR v_source IS NULL THEN
    RAISE EXCEPTION 'This law payment has no reversible posting.' USING ERRCODE='23514';
  END IF;
  v_new_due := v_invoice.amount_due_cents+v_payment.amount_cents;
  IF v_new_due>v_invoice.total_cents THEN
    RAISE EXCEPTION 'Reversal exceeds the original fee note total.' USING ERRCODE='23514';
  END IF;
  v_reversal_id := private.insert_journal_entry(p_org_id,p_reversal_date,
    'Reverse payment for ' || v_invoice.invoice_number,
    CASE WHEN v_source='CLIENT_TRANSFER' THEN 'CLIENT_TRANSFER_REVERSAL'
      ELSE 'FEE_PAYMENT_REVERSAL' END,
    CASE WHEN v_source='CLIENT_TRANSFER' THEN v_matter ELSE v_invoice.id END,
    'REV-' || v_invoice.invoice_number,p_actor,
    private.law_reversal_lines(p_org_id,v_payment.journal_entry_id,
      v_invoice.customer_id,v_invoice.invoice_number),
    'invoice-payment-reversal:' || p_payment_id::TEXT);
  UPDATE public.invoice_payments SET reversed_at=now(),reversed_by=p_actor,
    reversal_journal_entry_id=v_reversal_id,reversal_reason=v_reason
  WHERE org_id=p_org_id AND id=p_payment_id;
  v_status := CASE WHEN v_new_due>=v_invoice.total_cents THEN 'SENT'
    ELSE 'PARTIALLY_PAID' END;
  UPDATE public.invoices SET amount_due_cents=v_new_due,status=v_status
  WHERE org_id=p_org_id AND id=v_invoice.id;
  UPDATE public.customers SET balance=COALESCE(balance,0)+v_payment.amount_cents
  WHERE org_id=p_org_id AND id=v_invoice.customer_id;
  UPDATE public.bank_transactions SET status='UNREVIEWED',matched_journal_entry_id=NULL
  WHERE org_id=p_org_id AND matched_journal_entry_id=v_payment.journal_entry_id;
  INSERT INTO public.audit_logs(org_id,user_id,action,resource_type,resource_id,details)
  VALUES(p_org_id,p_actor,'REVERSE','INVOICE',v_invoice.id,
    jsonb_build_object('paymentId',p_payment_id,'amountCents',v_payment.amount_cents,
      'reason',v_reason,'reversalJournalEntryId',v_reversal_id,
      'amountDueCents',v_new_due,'status',v_status));
  RETURN jsonb_build_object('reversalJournalEntryId',v_reversal_id,
    'amountDueCents',v_new_due,'status',v_status);
END;
$function$;
REVOKE ALL ON FUNCTION public.reverse_law_invoice_payment(UUID,UUID,DATE,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_law_invoice_payment(UUID,UUID,DATE,TEXT,UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(
  p_org_id UUID,
  p_payment_id UUID,
  p_reversal_date DATE,
  p_reason TEXT,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment RECORD;
  v_invoice RECORD;
  v_reason TEXT;
  v_reversal_id UUID;
  v_new_due BIGINT;
  v_status TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoice_payments AS payment
    JOIN public.invoices AS invoice ON invoice.org_id=payment.org_id
      AND invoice.id=payment.invoice_id
    JOIN public.organizations AS org ON org.id=invoice.org_id
    WHERE payment.org_id=p_org_id AND payment.id=p_payment_id
      AND invoice.matter_id IS NOT NULL AND org.edition='law') THEN
    RETURN public.reverse_law_invoice_payment(p_org_id,p_payment_id,
      p_reversal_date,p_reason,p_actor);
  END IF;
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  v_reason := private.require_reason(p_reason, 'this payment');
  IF p_reversal_date IS NULL THEN
    RAISE EXCEPTION 'A reversal date is required.' USING ERRCODE = '22023';
  END IF;

  SELECT payment.id, payment.invoice_id, payment.amount_cents, payment.payment_date,
         payment.journal_entry_id, payment.reversed_at, payment.reversal_journal_entry_id
  INTO v_payment
  FROM public.invoice_payments AS payment
  WHERE payment.org_id = p_org_id AND payment.id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found in this organization.' USING ERRCODE = '23503';
  END IF;

  SELECT invoice.id, invoice.invoice_number, invoice.customer_id, invoice.status,
         invoice.total_cents, invoice.amount_due_cents
  INTO v_invoice
  FROM public.invoices AS invoice
  WHERE invoice.org_id = p_org_id AND invoice.id = v_payment.invoice_id
  FOR UPDATE;

  -- Asking twice returns the first reversal.
  IF v_payment.reversed_at IS NOT NULL THEN
    RETURN jsonb_build_object('reversalJournalEntryId', v_payment.reversal_journal_entry_id,
      'amountDueCents', v_invoice.amount_due_cents, 'status', v_invoice.status);
  END IF;
  IF p_reversal_date < v_payment.payment_date THEN
    RAISE EXCEPTION 'A reversal cannot be dated before the payment it reverses.' USING ERRCODE = '22023';
  END IF;

  v_reversal_id := private.insert_journal_entry(
    p_org_id, p_reversal_date, 'Reverse payment for ' || v_invoice.invoice_number,
    'ADJUSTMENT', v_invoice.id, 'REV-' || v_invoice.invoice_number, p_actor,
    private.reversal_lines(p_org_id, v_payment.journal_entry_id, v_invoice.invoice_number),
    'invoice-payment-reversal:' || p_payment_id::TEXT
  );

  UPDATE public.invoice_payments
  SET reversed_at = now(), reversed_by = p_actor,
      reversal_journal_entry_id = v_reversal_id, reversal_reason = v_reason
  WHERE org_id = p_org_id AND id = p_payment_id;

  v_new_due := v_invoice.amount_due_cents + v_payment.amount_cents;
  v_status := CASE WHEN v_new_due >= v_invoice.total_cents THEN 'SENT' ELSE 'PARTIALLY_PAID' END;
  UPDATE public.invoices
  SET amount_due_cents = v_new_due, status = v_status
  WHERE org_id = p_org_id AND id = v_invoice.id;
  UPDATE public.customers
  SET balance = COALESCE(balance, 0) + v_payment.amount_cents
  WHERE org_id = p_org_id AND id = v_invoice.customer_id;

  -- A statement line matched to this payment can be matched again.
  UPDATE public.bank_transactions
  SET status = 'UNREVIEWED', matched_journal_entry_id = NULL
  WHERE org_id = p_org_id AND matched_journal_entry_id = v_payment.journal_entry_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    p_org_id, p_actor, 'REVERSE', 'INVOICE', v_invoice.id,
    jsonb_build_object('paymentId', p_payment_id, 'amountCents', v_payment.amount_cents,
      'reason', v_reason, 'reversalJournalEntryId', v_reversal_id,
      'amountDueCents', v_new_due, 'status', v_status)
  );

  RETURN jsonb_build_object('reversalJournalEntryId', v_reversal_id,
    'amountDueCents', v_new_due, 'status', v_status);
END;
$function$;
