\c lltest
\set ON_ERROR_STOP 1
BEGIN;
DO $test$
DECLARE v_org UUID := '00000000-0000-0000-0000-0000000000aa'; v_bank UUID := '00000000-0000-0000-0000-00000000a000'; v_failed BOOLEAN;
BEGIN
  INSERT INTO public.statement_import_layouts(org_id, bank_account_id, header_row, mapping)
    VALUES(v_org, v_bank, 1, '{"date":0,"description":1,"amount":2,"dateFormat":"DMY"}');
  INSERT INTO public.statement_import_layouts(org_id, bank_account_id, header_row, mapping)
    VALUES(v_org, v_bank, 2, '{"date":1,"description":2,"moneyIn":3,"moneyOut":4,"dateFormat":"YMD"}')
    ON CONFLICT (org_id, bank_account_id) DO UPDATE SET header_row = EXCLUDED.header_row, mapping = EXCLUDED.mapping;
  IF (SELECT header_row FROM public.statement_import_layouts WHERE org_id = v_org AND bank_account_id = v_bank) <> 2 THEN
    RAISE EXCEPTION 'Saved statement layout was not replaced for this account.';
  END IF;
  v_failed := false;
  BEGIN
    INSERT INTO public.statement_import_layouts(org_id, bank_account_id, header_row, mapping)
      VALUES(v_org, '00000000-0000-0000-0000-00000000a110', 0, '{"date":0}');
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Non-money account accepted a statement layout.'; END IF;
  v_failed := false;
  BEGIN
    INSERT INTO public.statement_import_layouts(org_id, bank_account_id, header_row, mapping)
      VALUES('00000000-0000-0000-0000-0000000000bb', v_bank, 0, '{"date":0}');
  EXCEPTION WHEN foreign_key_violation THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A cross-organization layout was accepted.'; END IF;
  IF has_table_privilege('authenticated', 'public.statement_import_layouts', 'SELECT') THEN
    RAISE EXCEPTION 'Saved layouts bypass organization API access.';
  END IF;
END;
$test$;
ROLLBACK;
SELECT 'statement import layouts passed';
