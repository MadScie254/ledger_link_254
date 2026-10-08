-- Fund tags on supplier and customer lines. A bill or expense that names a
-- supplier carries the supplier as the entity of its expense lines too, and
-- an invoice its customer on its income lines, so the fund trigger of
-- 20261009000300 left those lines untagged and fund_balances counted them
-- to GENERAL whatever fund the treasurer chose. A journal line has one
-- entity; in a church, the fund wins on income, expense and cost of sales
-- lines. The supplier or customer stays on the payable or receivable line
-- and on the bill, expense or invoice itself, which is where supplier and
-- customer balances are read from. Lines already posted are not changed.

CREATE OR REPLACE FUNCTION private.tag_church_fund_line() RETURNS trigger
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
  IF NEW.entity_type IS NOT NULL AND NEW.entity_type NOT IN ('VENDOR', 'CUSTOMER') THEN RETURN NEW; END IF;
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

-- Rollback: re-run private.tag_church_fund_line from 20261009000300.
