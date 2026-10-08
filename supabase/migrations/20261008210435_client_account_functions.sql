-- Mizani client money is posted only through these atomic, service-role RPCs.
-- The shared ledger functions remain unchanged. Every amount is integer cents.

CREATE FUNCTION private.require_law_matter(p_org_id UUID, p_matter_id UUID,
  p_actor_id UUID, p_open BOOLEAN DEFAULT false) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_client_id UUID; v_status TEXT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id,p_actor_id);
  SELECT matter.client_id,matter.status INTO v_client_id,v_status
  FROM public.matters AS matter JOIN public.organizations AS org ON org.id=matter.org_id
  WHERE matter.org_id=p_org_id AND matter.id=p_matter_id AND org.edition='law';
  IF NOT FOUND THEN RAISE EXCEPTION 'Matter not found in this law organization.' USING ERRCODE='23503'; END IF;
  IF p_open AND v_status='CLOSED' THEN RAISE EXCEPTION 'A closed matter cannot receive client money.' USING ERRCODE='23514'; END IF;
  RETURN v_client_id;
END;
$function$;
REVOKE ALL ON FUNCTION private.require_law_matter(UUID,UUID,UUID,BOOLEAN)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.law_account(p_org_id UUID,p_code TEXT,p_type TEXT,
  p_money BOOLEAN DEFAULT false) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_id UUID;
BEGIN
  SELECT account.id INTO v_id FROM public.accounts AS account
  JOIN public.organizations AS org ON org.id=account.org_id
  WHERE account.org_id=p_org_id AND account.code=p_code AND account.type::TEXT=p_type
    AND account.is_active AND (NOT p_money OR account.is_bank_account)
    AND account.currency=upper(org.base_currency);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active base-currency account % is required for this law posting.',p_code USING ERRCODE='23503';
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION private.law_account(UUID,TEXT,TEXT,BOOLEAN)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.require_office_bank(p_org_id UUID,p_account_id UUID) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_id UUID;
BEGIN
  SELECT account.id INTO v_id FROM public.accounts AS account
  JOIN public.organizations AS org ON org.id=account.org_id
  WHERE account.org_id=p_org_id AND account.id=p_account_id AND account.is_active
    AND account.type='ASSET' AND account.is_bank_account AND account.code <> '1060'
    AND account.currency=upper(org.base_currency);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an active office bank, cash or M-Pesa account in the base currency.' USING ERRCODE='23503';
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION private.require_office_bank(UUID,UUID)
  FROM PUBLIC,anon,authenticated,service_role;

-- A single namespace covers all law postings. A reused key must describe the
-- same source, date and amount; otherwise it is an error, never a new posting.
CREATE FUNCTION private.law_existing_entry(p_org_id UUID,p_key TEXT,p_source TEXT,
  p_source_id UUID,p_date DATE,p_amount BIGINT,p_account_code TEXT,p_debit BOOLEAN)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_entry RECORD; v_amount NUMERIC;
BEGIN
  IF p_key IS NULL OR btrim(p_key)='' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::TEXT || ':law-idempotency:' || p_key,0));
  SELECT entry.id,entry.source_type,entry.source_id,entry.entry_date INTO v_entry
  FROM public.journal_entries AS entry
  WHERE entry.org_id=p_org_id AND entry.idempotency_key='law:' || p_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(CASE WHEN p_debit THEN line.debit ELSE line.credit END),0)
    INTO v_amount FROM public.journal_lines AS line
  JOIN public.accounts AS account ON account.org_id=line.org_id AND account.id=line.account_id
  WHERE line.org_id=p_org_id AND line.journal_entry_id=v_entry.id AND account.code=p_account_code;
  IF v_entry.source_type IS DISTINCT FROM p_source
    OR v_entry.source_id IS DISTINCT FROM p_source_id
    OR v_entry.entry_date IS DISTINCT FROM p_date OR v_amount IS DISTINCT FROM p_amount THEN
    RAISE EXCEPTION 'Idempotency key was already used for a different law posting.' USING ERRCODE='23505';
  END IF;
  RETURN v_entry.id;
END;
$function$;
REVOKE ALL ON FUNCTION private.law_existing_entry(UUID,TEXT,TEXT,UUID,DATE,BIGINT,TEXT,BOOLEAN)
  FROM PUBLIC,anon,authenticated,service_role;

-- The first law migration blocked manual, adjustment and bank journals. Also
-- prevent other document workflows from depositing into the client account.
CREATE OR REPLACE FUNCTION private.protect_client_money_accounts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_code TEXT; v_source TEXT;
BEGIN
  SELECT account.code INTO v_code FROM public.accounts AS account
  WHERE account.org_id=NEW.org_id AND account.id=NEW.account_id;
  IF v_code NOT IN ('1060','2200') THEN RETURN NEW; END IF;
  SELECT entry.source_type INTO v_source FROM public.journal_entries AS entry
  WHERE entry.org_id=NEW.org_id AND entry.id=NEW.journal_entry_id;
  IF v_source NOT IN ('CLIENT_RECEIPT','CLIENT_PAYMENT','CLIENT_TRANSFER') OR v_source IS NULL THEN
    RAISE EXCEPTION 'Client money (1060/2200) moves only through client receipts, payments and transfers.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;

-- The core ledger validates CUSTOMER entities. Once it inserts a line, this
-- trigger validates the source's law matter and replaces that entity with the
-- matter tag. A caller cannot tag an unrelated or nonexistent matter.
CREATE FUNCTION private.tag_law_journal_line() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_source TEXT; v_source_id UUID; v_matter_id UUID; v_client_id UUID;
BEGIN
  SELECT entry.source_type,entry.source_id INTO v_source,v_source_id
  FROM public.journal_entries AS entry
  WHERE entry.org_id=NEW.org_id AND entry.id=NEW.journal_entry_id;
  IF v_source IN ('CLIENT_RECEIPT','CLIENT_PAYMENT','CLIENT_TRANSFER','DISBURSEMENT') THEN
    v_matter_id := v_source_id;
  ELSIF v_source='PAYMENT' THEN
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
REVOKE ALL ON FUNCTION private.tag_law_journal_line() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER journal_lines_tag_law_matter BEFORE INSERT ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION private.tag_law_journal_line();
CREATE INDEX journal_lines_matter_balance ON public.journal_lines(org_id,account_id,entity_id)
  WHERE entity_type='MATTER';

CREATE FUNCTION public.client_balances(p_org_id UUID,p_as_of DATE)
RETURNS TABLE(matter_id UUID,client_id UUID,balance_cents BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT matter.id,matter.client_id,
    COALESCE(sum(CASE WHEN account.code='2200' THEN line.credit-line.debit ELSE 0 END),0)::BIGINT
  FROM public.matters AS matter
  LEFT JOIN public.journal_lines AS line ON line.org_id=matter.org_id
    AND line.entity_type='MATTER' AND line.entity_id=matter.id
  LEFT JOIN public.journal_entries AS entry ON entry.org_id=line.org_id
    AND entry.id=line.journal_entry_id AND entry.entry_date<=p_as_of
  LEFT JOIN public.accounts AS account ON account.org_id=line.org_id
    AND account.id=line.account_id AND entry.id IS NOT NULL
  WHERE matter.org_id=p_org_id
  GROUP BY matter.id,matter.client_id;
$function$;
REVOKE ALL ON FUNCTION public.client_balances(UUID,DATE) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.client_balances(UUID,DATE) TO service_role;

CREATE FUNCTION public.record_client_receipt(p_org_id UUID,p_matter_id UUID,
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
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
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
REVOKE ALL ON FUNCTION public.record_client_receipt(UUID,UUID,BIGINT,DATE,TEXT,TEXT,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_client_receipt(UUID,UUID,BIGINT,DATE,TEXT,TEXT,TEXT,UUID)
  TO service_role;

CREATE FUNCTION public.record_client_payment(p_org_id UUID,p_matter_id UUID,
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
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
  SELECT balance_cents INTO v_balance FROM public.client_balances(p_org_id,p_payment_date)
  WHERE matter_id=p_matter_id;
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
REVOKE ALL ON FUNCTION public.record_client_payment(UUID,UUID,BIGINT,DATE,TEXT,TEXT,BOOLEAN,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_client_payment(UUID,UUID,BIGINT,DATE,TEXT,TEXT,BOOLEAN,TEXT,UUID)
  TO service_role;

CREATE FUNCTION public.transfer_client_to_office(p_org_id UUID,p_matter_id UUID,
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
  SELECT balance_cents INTO v_balance FROM public.client_balances(p_org_id,p_transfer_date)
  WHERE matter_id=p_matter_id;
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
REVOKE ALL ON FUNCTION public.transfer_client_to_office(UUID,UUID,UUID,BIGINT,DATE,UUID,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_client_to_office(UUID,UUID,UUID,BIGINT,DATE,UUID,TEXT,UUID)
  TO service_role;

CREATE FUNCTION public.record_office_disbursement(p_org_id UUID,p_matter_id UUID,
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
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
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
REVOKE ALL ON FUNCTION public.record_office_disbursement(UUID,UUID,BIGINT,DATE,TEXT,UUID,TEXT,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_office_disbursement(UUID,UUID,BIGINT,DATE,TEXT,UUID,TEXT,TEXT,UUID)
  TO service_role;

CREATE FUNCTION public.receive_fee_note_payment(p_org_id UUID,p_invoice_id UUID,
  p_cash_cents BIGINT,p_wht_cents BIGINT,p_wht_certificate_number TEXT,p_payment_date DATE,
  p_deposit_account_id UUID,p_idempotency_key TEXT,p_created_by UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_invoice RECORD; v_entry UUID; v_ar UUID; v_wht UUID; v_payment_id UUID;
  v_total BIGINT; v_fee_cents BIGINT; v_prior_wht BIGINT; v_due BIGINT;
BEGIN
  PERFORM private.require_financial_actor(p_org_id,p_created_by);
  IF p_cash_cents IS NULL OR p_cash_cents<0 OR p_wht_cents IS NULL OR p_wht_cents<0
    OR p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Fee-note payment amounts and date are invalid.' USING ERRCODE='22023';
  END IF;
  v_total := p_cash_cents+p_wht_cents;
  IF v_total<=0 THEN RAISE EXCEPTION 'Fee-note payment must be positive.' USING ERRCODE='22023'; END IF;
  v_entry := private.law_existing_entry(p_org_id,p_idempotency_key,'PAYMENT',
    p_invoice_id,p_payment_date,v_total,'1100',false);
  IF v_entry IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.invoice_payments AS payment
      WHERE payment.org_id=p_org_id AND payment.journal_entry_id=v_entry
        AND payment.account_id=p_deposit_account_id AND payment.wht_cents=p_wht_cents
        AND payment.wht_certificate_number IS NOT DISTINCT FROM p_wht_certificate_number) THEN
      RAISE EXCEPTION 'Idempotency key was already used for another fee-note payment.' USING ERRCODE='23505';
    END IF;
    RETURN v_entry;
  END IF;
  SELECT invoice.id,invoice.invoice_number,invoice.customer_id,invoice.matter_id,
    invoice.status,invoice.amount_due_cents,invoice.currency
  INTO v_invoice FROM public.invoices AS invoice
  JOIN public.matters AS matter ON matter.org_id=invoice.org_id AND matter.id=invoice.matter_id
  WHERE invoice.org_id=p_org_id AND invoice.id=p_invoice_id FOR UPDATE OF invoice;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fee note not found in this law organization.' USING ERRCODE='23503'; END IF;
  IF v_invoice.status NOT IN ('SENT','PARTIALLY_PAID') OR v_invoice.amount_due_cents<=0 THEN
    RAISE EXCEPTION 'This fee note cannot receive a payment.' USING ERRCODE='23514';
  END IF;
  IF v_total>v_invoice.amount_due_cents THEN
    RAISE EXCEPTION 'Fee-note payment exceeds the amount due.' USING ERRCODE='23514';
  END IF;
  IF v_invoice.currency IS DISTINCT FROM (SELECT upper(base_currency) FROM public.organizations WHERE id=p_org_id) THEN
    RAISE EXCEPTION 'Fee-note withholding requires a base-currency invoice.' USING ERRCODE='22023';
  END IF;
  PERFORM private.require_office_bank(p_org_id,p_deposit_account_id);
  SELECT COALESCE(sum(line.amount_cents),0)::BIGINT INTO v_fee_cents
  FROM public.invoice_lines AS line
  WHERE line.org_id=p_org_id AND line.invoice_id=p_invoice_id AND line.line_kind='PROFIT_COST';
  SELECT COALESCE(sum(payment.wht_cents),0)::BIGINT INTO v_prior_wht
  FROM public.invoice_payments AS payment
  WHERE payment.org_id=p_org_id AND payment.invoice_id=p_invoice_id AND payment.reversed_at IS NULL;
  IF p_wht_cents>floor(v_fee_cents*0.05)-v_prior_wht THEN
    RAISE EXCEPTION 'Withholding exceeds five percent of fee lines.' USING ERRCODE='23514';
  END IF;
  IF p_wht_cents>0 AND NULLIF(btrim(p_wht_certificate_number),'') IS NULL THEN
    RAISE EXCEPTION 'Withholding certificate number is required.' USING ERRCODE='22023';
  END IF;
  v_ar := private.law_account(p_org_id,'1100','ASSET');
  IF p_wht_cents>0 THEN v_wht := private.law_account(p_org_id,'1170','ASSET'); END IF;
  v_entry := private.insert_journal_entry(p_org_id,p_payment_date,
    'Fee-note payment for ' || v_invoice.invoice_number,'PAYMENT',p_invoice_id,
    v_invoice.invoice_number,p_created_by,
    (CASE WHEN p_cash_cents>0 THEN
      jsonb_build_array(jsonb_build_object('accountId',p_deposit_account_id,
        'debit',p_cash_cents,'credit',0,'entityType','CUSTOMER','entityId',v_invoice.customer_id))
    ELSE '[]'::jsonb END)
    || (CASE WHEN p_wht_cents>0 THEN
      jsonb_build_array(jsonb_build_object('accountId',v_wht,'debit',p_wht_cents,
        'credit',0,'entityType','CUSTOMER','entityId',v_invoice.customer_id))
    ELSE '[]'::jsonb END)
    || jsonb_build_array(jsonb_build_object('accountId',v_ar,'debit',0,'credit',v_total,
        'entityType','CUSTOMER','entityId',v_invoice.customer_id)),
    'law:' || p_idempotency_key);
  v_payment_id := gen_random_uuid();
  INSERT INTO public.invoice_payments(id,org_id,invoice_id,amount_cents,currency,
    foreign_amount_cents,exchange_rate,payment_date,account_id,journal_entry_id,
    idempotency_key,created_by,wht_cents,wht_certificate_number)
  VALUES(v_payment_id,p_org_id,p_invoice_id,v_total,v_invoice.currency,v_total,1,
    p_payment_date,p_deposit_account_id,v_entry,'law-fee:' || p_idempotency_key,
    p_created_by,p_wht_cents,p_wht_certificate_number);
  v_due := v_invoice.amount_due_cents-v_total;
  UPDATE public.invoices SET amount_due_cents=v_due,
    status=CASE WHEN v_due=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END
  WHERE org_id=p_org_id AND id=p_invoice_id;
  UPDATE public.customers SET balance=greatest(COALESCE(balance,0)-v_total,0)
  WHERE org_id=p_org_id AND id=v_invoice.customer_id;
  INSERT INTO public.audit_logs(org_id,user_id,action,resource_type,resource_id,details)
  VALUES(p_org_id,p_created_by,'PAYMENT','INVOICE',p_invoice_id,
    jsonb_build_object('paymentId',v_payment_id,'journalEntryId',v_entry,
      'cashCents',p_cash_cents,'whtCents',p_wht_cents,'amountDueCents',v_due));
  RETURN v_entry;
END;
$function$;
REVOKE ALL ON FUNCTION public.receive_fee_note_payment(UUID,UUID,BIGINT,BIGINT,TEXT,DATE,UUID,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receive_fee_note_payment(UUID,UUID,BIGINT,BIGINT,TEXT,DATE,UUID,TEXT,UUID)
  TO service_role;
