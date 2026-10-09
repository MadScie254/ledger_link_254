-- Kundi money: giving, two-person cash counts, banking a count, M-Pesa
-- charges, and fund balances. Every function follows the atomic pattern of
-- 20260917172909: an actor allowed to post, an idempotency key under an
-- advisory lock, journal lines through private.insert_journal_entry (left
-- unchanged), an audit row, and execution for the service role only.
--
-- Funds. Every income and expense line in a church organization carries its
-- fund as entity FUND. The core journal function accepts only customer,
-- supplier, employee and project entities, so a line is tagged after it is
-- validated, by a trigger on journal_lines, from (in order):
--   1. ledger.fund_id, set by the church functions below for their own lines;
--   2. the x-ledger-fund request header, sent by the Bills and expenses
--      screens of a church;
--   3. the line it reverses, when private.reversal_lines (re-created below to
--      name the entry being reversed) builds a reversal;
--   4. otherwise the church's general fund.

-- ---------------------------------------------------------------------------
-- Fund tagging
-- ---------------------------------------------------------------------------

CREATE FUNCTION private.tag_church_fund_line() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_edition TEXT;
  v_type TEXT;
  v_text TEXT;
  v_headers TEXT;
  v_fund UUID;
  v_reversing TEXT;
  v_source TEXT;
BEGIN
  IF NEW.entity_type IS NOT NULL THEN RETURN NEW; END IF;
  SELECT org.edition::TEXT INTO v_edition FROM public.organizations AS org WHERE org.id = NEW.org_id;
  IF v_edition IS DISTINCT FROM 'church' THEN RETURN NEW; END IF;
  SELECT account.type::TEXT INTO v_type FROM public.accounts AS account
  WHERE account.org_id = NEW.org_id AND account.id = NEW.account_id;
  IF v_type NOT IN ('INCOME', 'EXPENSE', 'COGS') THEN RETURN NEW; END IF;

  v_text := NULLIF(current_setting('ledger.fund_id', true), '');
  IF v_text IS NULL THEN
    v_headers := NULLIF(current_setting('request.headers', true), '');
    IF v_headers IS NOT NULL THEN
      v_text := NULLIF(v_headers::JSONB ->> 'x-ledger-fund', '');
    END IF;
  END IF;
  IF v_text IS NOT NULL THEN
    IF v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'That fund is not recognised.' USING ERRCODE = '22023';
    END IF;
    SELECT fund.id INTO v_fund FROM public.funds AS fund
    WHERE fund.org_id = NEW.org_id AND fund.id = v_text::UUID AND fund.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That fund is not an open fund of this church.' USING ERRCODE = '23503';
    END IF;
  END IF;

  -- A reversal takes the fund of the line it reverses.
  IF v_fund IS NULL THEN
    v_reversing := NULLIF(current_setting('ledger.reversing_entry_id', true), '');
    IF v_reversing IS NOT NULL THEN
      SELECT entry.source_type INTO v_source FROM public.journal_entries AS entry
      WHERE entry.org_id = NEW.org_id AND entry.id = NEW.journal_entry_id;
      IF v_source = 'ADJUSTMENT' OR v_source LIKE '%REVERSAL%' THEN
        SELECT line.entity_id INTO v_fund FROM public.journal_lines AS line
        WHERE line.org_id = NEW.org_id AND line.journal_entry_id = v_reversing::UUID
          AND line.account_id = NEW.account_id AND line.debit = NEW.credit AND line.credit = NEW.debit
          AND line.entity_type = 'FUND'
        ORDER BY line.id LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF v_fund IS NULL THEN
    SELECT fund.id INTO v_fund FROM public.funds AS fund
    WHERE fund.org_id = NEW.org_id AND fund.code = 'GENERAL';
  END IF;
  IF v_fund IS NOT NULL THEN
    NEW.entity_type := 'FUND';
    NEW.entity_id := v_fund;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.tag_church_fund_line() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER journal_lines_tag_church_fund BEFORE INSERT ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION private.tag_church_fund_line();

-- Reversal lines: a fund-tagged line goes back without its entity (the core
-- journal function would refuse FUND) and the trigger above restores its
-- fund from the entry named here. Otherwise as in 20261004000100.
CREATE OR REPLACE FUNCTION private.reversal_lines(p_org_id UUID, p_entry_id UUID, p_label TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM set_config('ledger.reversing_entry_id', p_entry_id::TEXT, true);
  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
      'accountId', line.account_id,
      'debit', line.credit,
      'credit', line.debit,
      'description', 'Reversal: ' || COALESCE(line.description, p_label),
      'entityType', CASE WHEN line.entity_type = 'FUND' THEN NULL ELSE line.entity_type END,
      'entityId', CASE WHEN line.entity_type = 'FUND' THEN NULL ELSE line.entity_id END,
      'currency', line.currency,
      'foreignDebit', line.foreign_credit,
      'foreignCredit', line.foreign_debit,
      'exchangeRate', line.exchange_rate
    ) ORDER BY line.id)
    FROM public.journal_lines AS line
    WHERE line.org_id = p_org_id AND line.journal_entry_id = p_entry_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.reversal_lines(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- An actor who may post, in a church organization.
CREATE FUNCTION private.require_church_actor(p_org_id UUID, p_actor UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM private.require_financial_actor(p_org_id, p_actor);
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id AND edition = 'church') THEN
    RAISE EXCEPTION 'This action is available in Kundi church organizations.' USING ERRCODE = '23514';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION private.require_church_actor(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.church_account(p_org_id UUID, p_code TEXT, p_type TEXT) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_id UUID;
BEGIN
  SELECT account.id INTO v_id FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.code = p_code AND account.type::TEXT = p_type AND account.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account % is needed in the chart of accounts for this.', p_code USING ERRCODE = '23503';
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION private.church_account(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- Notes and coins counted, {"1000": 3, "50": 4}, as cents. Kenyan notes are
-- 1000, 500, 200, 100 and 50; coins 20, 10, 5 and 1.
CREATE FUNCTION private.count_total_cents(p_counts JSONB) RETURNS BIGINT
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $function$
DECLARE
  v_key TEXT;
  v_value JSONB;
  v_count BIGINT;
  v_total BIGINT := 0;
BEGIN
  IF jsonb_typeof(p_counts) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Give the count as notes and coins.' USING ERRCODE = '22023';
  END IF;
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_counts)
  LOOP
    IF v_key NOT IN ('1000', '500', '200', '100', '50', '20', '10', '5', '1') THEN
      RAISE EXCEPTION 'KES % is not a Kenyan note or coin.', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_value) <> 'number' OR (v_value #>> '{}') !~ '^[0-9]{1,6}$' THEN
      RAISE EXCEPTION 'Count the KES % pieces as a whole number.', v_key USING ERRCODE = '22023';
    END IF;
    v_count := (v_value #>> '{}')::BIGINT;
    v_total := v_total + v_count * v_key::BIGINT * 100;
  END LOOP;
  RETURN v_total;
END;
$function$;
REVOKE ALL ON FUNCTION private.count_total_cents(JSONB) FROM PUBLIC, anon, authenticated, service_role;

-- The counts with zero pieces left out, so two counts compare as equal.
CREATE FUNCTION private.normalised_counts(p_counts JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT COALESCE(jsonb_object_agg(key, (value #>> '{}')::BIGINT), '{}'::JSONB)
  FROM jsonb_each(p_counts) WHERE (value #>> '{}')::BIGINT > 0;
$function$;
REVOKE ALL ON FUNCTION private.normalised_counts(JSONB) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.kes(p_cents BIGINT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT 'KES ' || to_char(p_cents / 100.0, 'FM999,999,999,990.00');
$function$;
REVOKE ALL ON FUNCTION private.kes(BIGINT) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. A gift: M-Pesa, bank transfer, cheque or cash handed in, to a fund.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.record_contribution(
  p_org_id UUID,
  p_member_id UUID,
  p_fund_id UUID,
  p_income_account_id UUID,
  p_amount_cents BIGINT,
  p_method TEXT,
  p_received_on DATE,
  p_mpesa_receipt_id UUID,
  p_idempotency_key TEXT,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_existing RECORD;
  v_fund RECORD;
  v_income UUID;
  v_money UUID;
  v_receipt RECORD;
  v_member TEXT;
  v_received DATE := p_received_on;
  v_reference TEXT;
  v_id UUID := gen_random_uuid();
  v_entry UUID;
BEGIN
  PERFORM private.require_church_actor(p_org_id, p_created_by);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::TEXT || ':giving:' || p_idempotency_key, 0));
  SELECT contribution.id, contribution.journal_entry_id INTO v_existing
  FROM public.contributions AS contribution
  WHERE contribution.org_id = p_org_id AND contribution.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'journalEntryId', v_existing.journal_entry_id);
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > 900000000000000 THEN
    RAISE EXCEPTION 'Enter the amount given, above nil.' USING ERRCODE = '22023';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('MPESA', 'CASH', 'BANK', 'CHEQUE') THEN
    RAISE EXCEPTION 'Say how the gift came: M-Pesa, cash, bank or cheque.' USING ERRCODE = '22023';
  END IF;
  SELECT fund.id, fund.name, fund.income_account_id, fund.is_active INTO v_fund
  FROM public.funds AS fund WHERE fund.org_id = p_org_id AND fund.id = p_fund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose one of this church''s funds.' USING ERRCODE = '23503';
  END IF;
  IF NOT v_fund.is_active THEN
    RAISE EXCEPTION 'The % is closed to new giving.', v_fund.name USING ERRCODE = '23514';
  END IF;
  v_income := COALESCE(p_income_account_id, v_fund.income_account_id);
  PERFORM 1 FROM public.accounts AS account
  WHERE account.org_id = p_org_id AND account.id = v_income AND account.type = 'INCOME' AND account.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Giving is credited to an active income account.' USING ERRCODE = '23503';
  END IF;
  IF p_member_id IS NOT NULL THEN
    SELECT member.member_number INTO v_member FROM public.members AS member
    WHERE member.org_id = p_org_id AND member.id = p_member_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That member is not in this church''s register.' USING ERRCODE = '23503';
    END IF;
  END IF;

  IF p_mpesa_receipt_id IS NOT NULL THEN
    SELECT receipt.id, receipt.trans_id, receipt.status, receipt.amount_cents, receipt.trans_time INTO v_receipt
    FROM public.mpesa_receipts AS receipt
    WHERE receipt.org_id = p_org_id AND receipt.id = p_mpesa_receipt_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'M-Pesa receipt not found in this church.' USING ERRCODE = '23503';
    END IF;
    IF v_receipt.status = 'POSTED' THEN
      RAISE EXCEPTION 'M-Pesa receipt % is already posted.', v_receipt.trans_id USING ERRCODE = '23505';
    END IF;
    IF v_receipt.status = 'IGNORED' THEN
      RAISE EXCEPTION 'M-Pesa receipt % was set aside as not giving.', v_receipt.trans_id USING ERRCODE = '23514';
    END IF;
    IF p_method <> 'MPESA' OR p_amount_cents <> v_receipt.amount_cents THEN
      RAISE EXCEPTION 'An M-Pesa gift is posted for the amount Safaricom received.' USING ERRCODE = '22023';
    END IF;
    v_received := COALESCE(v_received, (v_receipt.trans_time AT TIME ZONE 'Africa/Nairobi')::DATE);
    v_reference := v_receipt.trans_id;
  END IF;
  IF v_received IS NULL THEN
    RAISE EXCEPTION 'The date the gift was received is required.' USING ERRCODE = '22023';
  END IF;

  v_money := CASE p_method
    WHEN 'MPESA' THEN private.church_account(p_org_id, '1050', 'ASSET')
    WHEN 'CASH' THEN private.church_account(p_org_id, '1040', 'ASSET')
    ELSE private.church_account(p_org_id, '1000', 'ASSET') END;

  PERFORM set_config('ledger.fund_id', p_fund_id::TEXT, true);
  v_entry := private.insert_journal_entry(
    p_org_id, v_received,
    'Giving to the ' || v_fund.name || COALESCE(', member ' || v_member, ''),
    'GIVING', v_id, COALESCE(v_reference, v_member), p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId', v_money, 'debit', p_amount_cents, 'credit', 0,
        'description', initcap(lower(p_method)) || ' giving'),
      jsonb_build_object('accountId', v_income, 'debit', 0, 'credit', p_amount_cents,
        'description', v_fund.name)),
    'church:giving:' || p_idempotency_key);
  PERFORM set_config('ledger.fund_id', '', true);

  INSERT INTO public.contributions (id, org_id, member_id, fund_id, income_account_id, amount_cents, method,
    received_on, reference, mpesa_receipt_id, journal_entry_id, idempotency_key, created_by)
  VALUES (v_id, p_org_id, p_member_id, p_fund_id, v_income, p_amount_cents, p_method,
    v_received, v_reference, p_mpesa_receipt_id, v_entry, p_idempotency_key, p_created_by);

  IF p_mpesa_receipt_id IS NOT NULL THEN
    UPDATE public.mpesa_receipts
    SET status = 'POSTED', member_id = p_member_id, fund_id = p_fund_id, journal_entry_id = v_entry
    WHERE org_id = p_org_id AND id = p_mpesa_receipt_id;
  END IF;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'CREATE', 'CONTRIBUTION', v_id,
    jsonb_build_object('fundId', p_fund_id, 'memberId', p_member_id, 'amountCents', p_amount_cents,
      'method', p_method, 'journalEntryId', v_entry, 'mpesaReceiptId', p_mpesa_receipt_id));

  RETURN jsonb_build_object('id', v_id, 'journalEntryId', v_entry);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. A service's cash, counted by one person and confirmed by another.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.start_collection_count(
  p_org_id UUID,
  p_service_date DATE,
  p_service_name TEXT,
  p_denominations JSONB,
  p_fund_id UUID,
  p_idempotency_key TEXT,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_existing RECORD;
  v_counts JSONB;
  v_total BIGINT;
  v_declared BIGINT;
  v_fund UUID := p_fund_id;
  v_id UUID := gen_random_uuid();
  v_number TEXT;
BEGIN
  PERFORM private.require_church_actor(p_org_id, p_created_by);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::TEXT || ':collection:' || p_idempotency_key, 0));
  SELECT collection.id, collection.collection_number, collection.total_cents INTO v_existing
  FROM public.collections AS collection
  WHERE collection.org_id = p_org_id AND collection.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_existing.id, 'number', v_existing.collection_number, 'totalCents', v_existing.total_cents);
  END IF;

  IF p_service_date IS NULL OR NULLIF(btrim(COALESCE(p_service_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Name the service and its date.' USING ERRCODE = '22023';
  END IF;
  v_counts := COALESCE(p_denominations -> 'counts', p_denominations);
  v_total := private.count_total_cents(v_counts);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'The count has no notes or coins.' USING ERRCODE = '22023';
  END IF;
  IF p_denominations ? 'totalCents' THEN
    v_declared := (p_denominations ->> 'totalCents')::BIGINT;
    IF v_declared <> v_total THEN
      RAISE EXCEPTION 'The notes and coins come to %, not %.', private.kes(v_total), private.kes(v_declared)
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF v_fund IS NULL THEN
    SELECT fund.id INTO v_fund FROM public.funds AS fund WHERE fund.org_id = p_org_id AND fund.code = 'GENERAL';
  END IF;
  PERFORM 1 FROM public.funds AS fund WHERE fund.org_id = p_org_id AND fund.id = v_fund AND fund.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an open fund for this collection.' USING ERRCODE = '23503';
  END IF;

  v_number := 'COL-' || to_char(p_service_date, 'YYYY') || '-'
    || lpad(private.next_document_number(p_org_id, 'COLLECTION')::TEXT, 4, '0');
  INSERT INTO public.collections (id, org_id, collection_number, service_date, service_name, fund_id,
    denominations, total_cents, counted_by_1, idempotency_key)
  VALUES (v_id, p_org_id, v_number, p_service_date, btrim(p_service_name), v_fund,
    private.normalised_counts(v_counts), v_total, p_created_by, p_idempotency_key);

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'CREATE', 'COLLECTION', v_id,
    jsonb_build_object('number', v_number, 'totalCents', v_total, 'stage', 'FIRST_COUNT'));
  RETURN jsonb_build_object('id', v_id, 'number', v_number, 'totalCents', v_total);
END;
$function$;

CREATE FUNCTION public.confirm_collection_count(
  p_org_id UUID,
  p_collection_id UUID,
  p_denominations JSONB,
  p_idempotency_key TEXT,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_collection RECORD;
  v_counts JSONB;
  v_total BIGINT;
  v_cash UUID;
  v_offerings UUID;
  v_fund_name TEXT;
  v_entry UUID;
BEGIN
  PERFORM private.require_church_actor(p_org_id, p_created_by);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  SELECT collection.* INTO v_collection FROM public.collections AS collection
  WHERE collection.org_id = p_org_id AND collection.id = p_collection_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collection not found in this church.' USING ERRCODE = '23503';
  END IF;
  IF v_collection.status <> 'AWAITING_SECOND_COUNT' THEN
    IF v_collection.counted_by_2 = p_created_by THEN
      RETURN jsonb_build_object('id', v_collection.id, 'number', v_collection.collection_number,
        'totalCents', v_collection.total_cents, 'journalEntryId', v_collection.journal_entry_id);
    END IF;
    RAISE EXCEPTION 'Collection % has already been counted twice.', v_collection.collection_number USING ERRCODE = '23505';
  END IF;
  IF v_collection.counted_by_1 = p_created_by THEN
    RAISE EXCEPTION 'The first counter cannot confirm their own count. A second counter confirms it from their own sign-in.'
      USING ERRCODE = '42501';
  END IF;
  v_counts := COALESCE(p_denominations -> 'counts', p_denominations);
  v_total := private.count_total_cents(v_counts);
  IF v_total <> v_collection.total_cents OR private.normalised_counts(v_counts) <> v_collection.denominations THEN
    RAISE EXCEPTION 'The second count comes to %; the first came to %. Count again together; nothing is posted until both counts agree.',
      private.kes(v_total), private.kes(v_collection.total_cents) USING ERRCODE = '23514';
  END IF;

  v_cash := private.church_account(p_org_id, '1040', 'ASSET');
  v_offerings := private.church_account(p_org_id, '4020', 'INCOME');
  SELECT fund.name INTO v_fund_name FROM public.funds AS fund WHERE fund.org_id = p_org_id AND fund.id = v_collection.fund_id;
  PERFORM set_config('ledger.fund_id', v_collection.fund_id::TEXT, true);
  v_entry := private.insert_journal_entry(
    p_org_id, v_collection.service_date,
    v_collection.service_name || ' collection, counted twice',
    'COLLECTION', v_collection.id, v_collection.collection_number, p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId', v_cash, 'debit', v_collection.total_cents, 'credit', 0,
        'description', 'Cash collected, ' || v_collection.collection_number),
      jsonb_build_object('accountId', v_offerings, 'debit', 0, 'credit', v_collection.total_cents,
        'description', 'Offerings, ' || v_fund_name)),
    'church:collection:' || p_collection_id::TEXT);
  PERFORM set_config('ledger.fund_id', '', true);

  UPDATE public.collections
  SET status = 'COUNTED', counted_by_2 = p_created_by, second_denominations = private.normalised_counts(v_counts),
      confirmed_at = now(), journal_entry_id = v_entry
  WHERE org_id = p_org_id AND id = p_collection_id;

  -- The collection is giving too: by cash, to its fund, from no one member.
  INSERT INTO public.contributions (org_id, fund_id, income_account_id, amount_cents, method, received_on,
    reference, collection_id, journal_entry_id, idempotency_key, created_by)
  VALUES (p_org_id, v_collection.fund_id, v_offerings, v_collection.total_cents, 'CASH', v_collection.service_date,
    v_collection.collection_number, p_collection_id, v_entry, 'collection:' || p_collection_id::TEXT, p_created_by);

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'POST', 'COLLECTION', p_collection_id,
    jsonb_build_object('number', v_collection.collection_number, 'totalCents', v_collection.total_cents,
      'firstCounter', v_collection.counted_by_1, 'secondCounter', p_created_by, 'journalEntryId', v_entry));
  RETURN jsonb_build_object('id', v_collection.id, 'number', v_collection.collection_number,
    'totalCents', v_collection.total_cents, 'journalEntryId', v_entry);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. A counted collection banked. Short or over is posted to bank and M-Pesa
--    charges (6400) with a memo naming it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.bank_collection(
  p_org_id UUID,
  p_collection_id UUID,
  p_banked_cents BIGINT,
  p_banked_on DATE,
  p_bank_account_id UUID,
  p_bank_reference TEXT,
  p_idempotency_key TEXT,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_collection RECORD;
  v_cash UUID;
  v_charges UUID;
  v_code TEXT;
  v_variance BIGINT;
  v_lines JSONB;
  v_entry UUID;
  v_memo TEXT;
BEGIN
  PERFORM private.require_church_actor(p_org_id, p_created_by);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  SELECT collection.* INTO v_collection FROM public.collections AS collection
  WHERE collection.org_id = p_org_id AND collection.id = p_collection_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collection not found in this church.' USING ERRCODE = '23503';
  END IF;
  IF v_collection.status = 'BANKED' THEN
    IF v_collection.banked_cents = p_banked_cents AND v_collection.banked_on = p_banked_on THEN
      RETURN jsonb_build_object('id', v_collection.id, 'varianceCents', v_collection.variance_cents,
        'journalEntryId', v_collection.banking_journal_entry_id);
    END IF;
    RAISE EXCEPTION 'Collection % is already banked.', v_collection.collection_number USING ERRCODE = '23505';
  END IF;
  IF v_collection.status <> 'COUNTED' THEN
    RAISE EXCEPTION 'Collection % is banked after its second count.', v_collection.collection_number USING ERRCODE = '23514';
  END IF;
  IF p_banked_cents IS NULL OR p_banked_cents <= 0 OR p_banked_on IS NULL THEN
    RAISE EXCEPTION 'Enter the amount banked and the date.' USING ERRCODE = '22023';
  END IF;
  IF p_banked_on < v_collection.service_date THEN
    RAISE EXCEPTION 'A collection is banked on or after its service date.' USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_money_account(p_org_id, p_bank_account_id, 'The bank account');
  SELECT account.code INTO v_code FROM public.accounts AS account WHERE account.org_id = p_org_id AND account.id = p_bank_account_id;
  IF v_code IN ('1040', '1060') THEN
    RAISE EXCEPTION 'Bank the collection into a bank or M-Pesa account.' USING ERRCODE = '22023';
  END IF;

  v_cash := private.church_account(p_org_id, '1040', 'ASSET');
  v_variance := p_banked_cents - v_collection.total_cents;
  v_lines := jsonb_build_array(
    jsonb_build_object('accountId', p_bank_account_id, 'debit', p_banked_cents, 'credit', 0,
      'description', 'Banked, ' || v_collection.collection_number),
    jsonb_build_object('accountId', v_cash, 'debit', 0, 'credit', v_collection.total_cents,
      'description', 'Cash collected, ' || v_collection.collection_number));
  v_memo := 'Banking ' || v_collection.collection_number;
  IF v_variance <> 0 THEN
    v_charges := private.church_account(p_org_id, '6400', 'EXPENSE');
    v_memo := v_memo || CASE WHEN v_variance < 0 THEN ', short by ' ELSE ', over by ' END || private.kes(abs(v_variance));
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'accountId', v_charges,
      'debit', CASE WHEN v_variance < 0 THEN -v_variance ELSE 0 END,
      'credit', CASE WHEN v_variance > 0 THEN v_variance ELSE 0 END,
      'description', CASE WHEN v_variance < 0 THEN 'Banked short of the count' ELSE 'Banked over the count' END));
  END IF;

  PERFORM set_config('ledger.fund_id', v_collection.fund_id::TEXT, true);
  v_entry := private.insert_journal_entry(p_org_id, p_banked_on, v_memo, 'COLLECTION_BANKING', p_collection_id,
    NULLIF(btrim(COALESCE(p_bank_reference, '')), ''), p_created_by, v_lines,
    'church:banking:' || p_idempotency_key);
  PERFORM set_config('ledger.fund_id', '', true);

  UPDATE public.collections
  SET status = 'BANKED', banked_on = p_banked_on, banked_cents = p_banked_cents, variance_cents = v_variance,
      bank_account_id = p_bank_account_id, bank_reference = NULLIF(btrim(COALESCE(p_bank_reference, '')), ''),
      banking_journal_entry_id = v_entry
  WHERE org_id = p_org_id AND id = p_collection_id;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'POST', 'COLLECTION', p_collection_id,
    jsonb_build_object('stage', 'BANKED', 'bankedCents', p_banked_cents, 'varianceCents', v_variance, 'journalEntryId', v_entry));
  RETURN jsonb_build_object('id', p_collection_id, 'varianceCents', v_variance, 'journalEntryId', v_entry);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. M-Pesa charges for a period, from the statement.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.record_mpesa_charges(
  p_org_id UUID,
  p_period_end DATE,
  p_amount_cents BIGINT,
  p_reference TEXT,
  p_idempotency_key TEXT,
  p_created_by UUID
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_entry UUID;
BEGIN
  PERFORM private.require_church_actor(p_org_id, p_created_by);
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_period_end IS NULL THEN
    RAISE EXCEPTION 'Enter the charges, above nil, and the date they run to.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::TEXT || ':charges:' || p_idempotency_key, 0));
  v_entry := private.insert_journal_entry(p_org_id, p_period_end, 'M-Pesa charges to ' || to_char(p_period_end, 'DD/MM/YYYY'),
    'MPESA_CHARGES', NULL, NULLIF(btrim(COALESCE(p_reference, '')), ''), p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId', private.church_account(p_org_id, '6400', 'EXPENSE'), 'debit', p_amount_cents, 'credit', 0,
        'description', 'M-Pesa charges'),
      jsonb_build_object('accountId', private.church_account(p_org_id, '1050', 'ASSET'), 'debit', 0, 'credit', p_amount_cents,
        'description', 'M-Pesa charges')),
    'church:charges:' || p_idempotency_key);
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_created_by, 'POST', 'MPESA_CHARGES', v_entry,
    jsonb_build_object('amountCents', p_amount_cents, 'periodEnd', p_period_end, 'reference', p_reference));
  RETURN v_entry;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Fund balances: opening, income, expense and closing per fund. A line
--    with no fund (posted before the church had funds) counts to GENERAL.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fund_balances(p_org_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (fund_id UUID, code TEXT, name TEXT, restricted BOOLEAN, is_active BOOLEAN,
  opening_cents BIGINT, income_cents BIGINT, expense_cents BIGINT, closing_cents BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  WITH general AS (
    SELECT fund.id FROM public.funds AS fund WHERE fund.org_id = p_org_id AND fund.code = 'GENERAL'
  ), lines AS (
    SELECT CASE WHEN line.entity_type = 'FUND' THEN line.entity_id ELSE (SELECT id FROM general) END AS fund_id,
           entry.entry_date, account.type::TEXT AS type, line.debit, line.credit
    FROM public.journal_lines AS line
    JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
    JOIN public.accounts AS account ON account.org_id = line.org_id AND account.id = line.account_id
    WHERE line.org_id = p_org_id AND account.type IN ('INCOME', 'EXPENSE', 'COGS') AND entry.entry_date <= p_to
  ), sums AS (
    SELECT lines.fund_id,
      COALESCE(sum(lines.credit - lines.debit) FILTER (WHERE lines.entry_date < p_from), 0) AS opening,
      COALESCE(sum(lines.credit - lines.debit) FILTER (WHERE lines.entry_date >= p_from AND lines.type = 'INCOME'), 0) AS income,
      COALESCE(sum(lines.debit - lines.credit) FILTER (WHERE lines.entry_date >= p_from AND lines.type <> 'INCOME'), 0) AS expense
    FROM lines GROUP BY lines.fund_id
  )
  SELECT fund.id, fund.code, fund.name, fund.restricted, fund.is_active,
         COALESCE(sums.opening, 0)::BIGINT, COALESCE(sums.income, 0)::BIGINT, COALESCE(sums.expense, 0)::BIGINT,
         (COALESCE(sums.opening, 0) + COALESCE(sums.income, 0) - COALESCE(sums.expense, 0))::BIGINT
  FROM public.funds AS fund
  LEFT JOIN sums ON sums.fund_id = fund.id
  WHERE fund.org_id = p_org_id
  ORDER BY fund.code = 'GENERAL' DESC, fund.code;
$function$;

-- The treasurer's report: income and spending in a period by fund and
-- account, and what each money account (10xx) held at the end of it.
CREATE FUNCTION public.church_treasurer_lines(p_org_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (kind TEXT, fund_id UUID, account_id UUID, account_code TEXT, account_name TEXT, amount_cents BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  WITH general AS (
    SELECT fund.id FROM public.funds AS fund WHERE fund.org_id = p_org_id AND fund.code = 'GENERAL'
  )
  SELECT CASE WHEN account.type = 'INCOME' THEN 'INCOME' ELSE 'EXPENSE' END,
         CASE WHEN line.entity_type = 'FUND' THEN line.entity_id ELSE (SELECT id FROM general) END,
         account.id, account.code, account.name,
         sum(CASE WHEN account.type = 'INCOME' THEN line.credit - line.debit ELSE line.debit - line.credit END)::BIGINT
  FROM public.journal_lines AS line
  JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
  JOIN public.accounts AS account ON account.org_id = line.org_id AND account.id = line.account_id
  WHERE line.org_id = p_org_id AND account.type IN ('INCOME', 'EXPENSE', 'COGS')
    AND entry.entry_date BETWEEN p_from AND p_to
  GROUP BY 1, 2, account.id, account.code, account.name
  UNION ALL
  SELECT 'MONEY', NULL, account.id, account.code, account.name,
         COALESCE(sum(line.debit - line.credit) FILTER (WHERE entry.entry_date <= p_to), 0)::BIGINT
  FROM public.accounts AS account
  LEFT JOIN public.journal_lines AS line ON line.org_id = account.org_id AND line.account_id = account.id
  LEFT JOIN public.journal_entries AS entry ON entry.org_id = line.org_id AND entry.id = line.journal_entry_id
  WHERE account.org_id = p_org_id AND account.is_bank_account AND account.type = 'ASSET' AND account.is_active
  GROUP BY account.id, account.code, account.name;
$function$;

REVOKE ALL ON FUNCTION public.record_contribution(UUID, UUID, UUID, UUID, BIGINT, TEXT, DATE, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_collection_count(UUID, DATE, TEXT, JSONB, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_collection_count(UUID, UUID, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bank_collection(UUID, UUID, BIGINT, DATE, UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_mpesa_charges(UUID, DATE, BIGINT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fund_balances(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.church_treasurer_lines(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_contribution(UUID, UUID, UUID, UUID, BIGINT, TEXT, DATE, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_collection_count(UUID, DATE, TEXT, JSONB, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_collection_count(UUID, UUID, JSONB, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.bank_collection(UUID, UUID, BIGINT, DATE, UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_mpesa_charges(UUID, DATE, BIGINT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fund_balances(UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.church_treasurer_lines(UUID, DATE, DATE) TO service_role;

-- Rollback: drop the trigger journal_lines_tag_church_fund and the functions
-- above; re-run private.reversal_lines from 20261004000100.
