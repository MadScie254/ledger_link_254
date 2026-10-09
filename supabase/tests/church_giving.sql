-- Run after the full migration stack and tests/db/fixture.sql. The
-- transaction leaves the fixture unchanged.
BEGIN;
DO $test$
DECLARE
  v_first UUID := '00000000-0000-0000-0000-000000000004';
  v_second UUID := '00000000-0000-0000-0000-000000000001';
  v_business UUID := '00000000-0000-0000-0000-0000000000aa';
  v_org UUID;
  v_general UUID;
  v_building UUID;
  v_bank UUID;
  v_member UUID;
  v_receipt UUID;
  v_result JSONB;
  v_collection JSONB;
  v_expense JSONB;
  v_error TEXT;
  v_income BIGINT;
  v_expenses BIGINT;
  v_funds RECORD;
BEGIN
  IF has_function_privilege('authenticated',
      'public.record_contribution(uuid,uuid,uuid,uuid,bigint,text,date,uuid,text,uuid)'::regprocedure, 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.fund_balances(uuid,date,date)'::regprocedure, 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.confirm_collection_count(uuid,uuid,jsonb,text,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Church money functions are not service-role-only.';
  END IF;

  v_org := public.create_organization(v_first, '{"name":"Kanisa test","edition":"church"}',
    '[{"code":"1000","name":"Bank","type":"ASSET","isBankAccount":true},
      {"code":"1040","name":"Cash on hand, collections","type":"ASSET","isBankAccount":true},
      {"code":"1050","name":"M-Pesa","type":"ASSET","isBankAccount":true},
      {"code":"3300","name":"General fund","type":"EQUITY"},
      {"code":"4010","name":"Tithes","type":"INCOME"},
      {"code":"4020","name":"Offerings","type":"INCOME"},
      {"code":"4030","name":"Thanksgiving and special offerings","type":"INCOME"},
      {"code":"4040","name":"Building and project giving","type":"INCOME"},
      {"code":"4050","name":"Missions giving","type":"INCOME"},
      {"code":"6310","name":"Ministry and department costs","type":"EXPENSE"},
      {"code":"6400","name":"Bank and M-Pesa charges","type":"EXPENSE"}]', 'church-giving-test');
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_second, 'accountant');

  -- A church starts with four funds and the default giving rules.
  IF (SELECT string_agg(code || ':' || restricted, ',' ORDER BY code) FROM public.funds WHERE org_id = v_org)
     <> 'BUILDING:true,GENERAL:false,MISSIONS:true,WELFARE:true' THEN
    RAISE EXCEPTION 'Funds were not seeded: %', (SELECT string_agg(code, ',') FROM public.funds WHERE org_id = v_org);
  END IF;
  IF (SELECT string_agg(match_type || ':' || COALESCE(pattern, '*'), ',' ORDER BY priority) FROM public.giving_rules WHERE org_id = v_org)
     <> 'EXACT:TITHE,PREFIX:BLD,PREFIX:MSN,MEMBER_NUMBER:*' THEN
    RAISE EXCEPTION 'Giving rules were not seeded.';
  END IF;
  SELECT id INTO v_general FROM public.funds WHERE org_id = v_org AND code = 'GENERAL';
  SELECT id INTO v_building FROM public.funds WHERE org_id = v_org AND code = 'BUILDING';
  SELECT id INTO v_bank FROM public.accounts WHERE org_id = v_org AND code = '1000';

  -- Church records stay with churches.
  BEGIN
    INSERT INTO public.households (org_id, name) VALUES (v_business, 'Not a church');
    RAISE EXCEPTION 'A business organization took a household.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- A phone number needs the member's consent.
  BEGIN
    INSERT INTO public.members (org_id, member_number, first_name, phone) VALUES (v_org, '1001', 'Amina', '0700000001');
    RAISE EXCEPTION 'A phone number was saved without consent.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.members (org_id, member_number, first_name, last_name, phone, consent_given_at, consent_method)
  VALUES (v_org, '1043', 'Amina', 'Wekesa', '0700000043', now(), 'Signed form') RETURNING id INTO v_member;

  -- An M-Pesa gift posts once, however often Safaricom sends it.
  INSERT INTO public.mpesa_receipts (org_id, trans_id, trans_time, amount_cents, bill_ref_number, source)
  VALUES (v_org, 'SJK3H2K9QX', '2026-10-04 08:15+03', 150000, '1043', 'C2B_CALLBACK') RETURNING id INTO v_receipt;
  INSERT INTO public.mpesa_receipts (org_id, trans_id, trans_time, amount_cents, bill_ref_number, source)
  VALUES (v_org, 'SJK3H2K9QX', '2026-10-04 08:15+03', 150000, '1043', 'C2B_CALLBACK')
  ON CONFLICT (org_id, trans_id) DO NOTHING;
  IF (SELECT count(*) FROM public.mpesa_receipts WHERE org_id = v_org) <> 1 THEN
    RAISE EXCEPTION 'A repeated M-Pesa transaction was stored twice.';
  END IF;
  v_result := public.record_contribution(v_org, v_member, v_general, NULL, 150000, 'MPESA', NULL, v_receipt, 'mpesa:SJK3H2K9QX', v_first);
  IF (SELECT status FROM public.mpesa_receipts WHERE id = v_receipt) <> 'POSTED' THEN
    RAISE EXCEPTION 'The receipt was not marked posted.';
  END IF;
  IF public.record_contribution(v_org, v_member, v_general, NULL, 150000, 'MPESA', NULL, v_receipt, 'mpesa:SJK3H2K9QX', v_first)->>'id'
     <> v_result->>'id' THEN
    RAISE EXCEPTION 'A retry with the same key posted again.';
  END IF;
  BEGIN
    PERFORM public.record_contribution(v_org, v_member, v_general, NULL, 150000, 'MPESA', NULL, v_receipt, 'mpesa:other-key', v_first);
    RAISE EXCEPTION 'A posted receipt posted again under another key.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.contributions WHERE org_id = v_org) <> 1 THEN
    RAISE EXCEPTION 'The M-Pesa gift is recorded more than once.';
  END IF;
  -- Its income line carries the fund.
  IF NOT EXISTS (SELECT 1 FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE line.journal_entry_id = (v_result->>'journalEntryId')::UUID AND account.code = '4020'
        AND line.entity_type = 'FUND' AND line.entity_id = v_general) THEN
    RAISE EXCEPTION 'The giving line is not tagged to the general fund.';
  END IF;

  -- Cash: counted by one, confirmed by another, then banked short by KES 100.
  v_collection := public.start_collection_count(v_org, DATE '2026-10-04', 'First service',
    '{"counts":{"1000":10,"500":4,"100":15,"50":2},"totalCents":1360000}', NULL, 'count-1', v_first);
  BEGIN
    PERFORM public.start_collection_count(v_org, DATE '2026-10-04', 'Second service',
      '{"counts":{"1000":1},"totalCents":200000}', NULL, 'count-bad', v_first);
    RAISE EXCEPTION 'A count that does not add up was saved.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.confirm_collection_count(v_org, (v_collection->>'id')::UUID, '{"1000":10,"500":4,"100":15,"50":2}', 'confirm-self', v_first);
    RAISE EXCEPTION 'The first counter confirmed their own count.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.confirm_collection_count(v_org, (v_collection->>'id')::UUID, '{"1000":10,"500":4,"100":14,"50":2}', 'confirm-differ', v_second);
    RAISE EXCEPTION 'A second count that differs was accepted.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE '%KES 13,500.00%KES 13,600.00%' THEN
      RAISE EXCEPTION 'Both totals are not shown: %', v_error;
    END IF;
  END;
  IF (SELECT status FROM public.collections WHERE id = (v_collection->>'id')::UUID) <> 'AWAITING_SECOND_COUNT' THEN
    RAISE EXCEPTION 'A refused count changed the collection.';
  END IF;
  PERFORM public.confirm_collection_count(v_org, (v_collection->>'id')::UUID, '{"50":2,"100":15,"500":4,"1000":10,"20":0}', 'confirm-ok', v_second);
  PERFORM public.bank_collection(v_org, (v_collection->>'id')::UUID, 1350000, DATE '2026-10-05', v_bank, 'DEP-77', 'bank-1', v_first);
  IF (SELECT variance_cents FROM public.collections WHERE id = (v_collection->>'id')::UUID) <> -10000 THEN
    RAISE EXCEPTION 'The KES 100 shortfall was not recorded.';
  END IF;
  IF (SELECT COALESCE(sum(line.debit - line.credit), 0) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE account.org_id = v_org AND account.code = '1040') <> 0 THEN
    RAISE EXCEPTION 'Cash on hand is not cleared by banking.';
  END IF;
  IF (SELECT COALESCE(sum(line.debit - line.credit), 0) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE account.org_id = v_org AND account.code = '6400') <> 10000 THEN
    RAISE EXCEPTION 'The shortfall is not on 6400.';
  END IF;
  BEGIN
    PERFORM public.bank_collection(v_org, (v_collection->>'id')::UUID, 1360000, DATE '2026-10-06', v_bank, 'DEP-78', 'bank-2', v_first);
    RAISE EXCEPTION 'A banked collection was banked again.';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- An expense under the building fund, then voided: the reversal stays with the fund.
  PERFORM set_config('ledger.fund_id', v_building::TEXT, true);
  v_expense := public.record_expense(v_org, NULL, 'Hardware shop', DATE '2026-10-06', v_bank, NULL, NULL,
    jsonb_build_array(jsonb_build_object('description', 'Roofing sheets', 'accountId',
      (SELECT id FROM public.accounts WHERE org_id = v_org AND code = '6310'), 'amountCents', 400000)), v_first, 'church-expense');
  PERFORM set_config('ledger.fund_id', '', true);
  PERFORM public.void_cash_transaction(v_org, (v_expense->>'id')::UUID, DATE '2026-10-07', 'Entered twice', v_first);
  IF (SELECT count(*) FROM public.journal_lines AS line JOIN public.accounts AS account ON account.id = line.account_id
      WHERE account.org_id = v_org AND account.code = '6310' AND line.entity_type = 'FUND' AND line.entity_id = v_building) <> 2 THEN
    RAISE EXCEPTION 'The expense and its reversal are not both on the building fund.';
  END IF;

  PERFORM public.record_mpesa_charges(v_org, DATE '2026-10-31', 3300, 'Statement October', 'charges-oct', v_first);

  -- Fund balances add up to the income and spending of the period.
  SELECT COALESCE(sum(line.credit - line.debit) FILTER (WHERE account.type = 'INCOME'), 0),
         COALESCE(sum(line.debit - line.credit) FILTER (WHERE account.type <> 'INCOME'), 0)
  INTO v_income, v_expenses
  FROM public.journal_lines AS line
  JOIN public.journal_entries AS entry ON entry.id = line.journal_entry_id
  JOIN public.accounts AS account ON account.id = line.account_id
  WHERE line.org_id = v_org AND account.type IN ('INCOME', 'EXPENSE', 'COGS') AND entry.entry_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-31';
  SELECT sum(income_cents) AS income, sum(expense_cents) AS expense, sum(closing_cents) AS closing INTO v_funds
  FROM public.fund_balances(v_org, DATE '2026-10-01', DATE '2026-10-31');
  IF v_funds.income <> v_income OR v_funds.expense <> v_expenses OR v_funds.closing <> v_income - v_expenses THEN
    RAISE EXCEPTION 'Fund balances % do not add up to income % and spending %.', row_to_json(v_funds), v_income, v_expenses;
  END IF;
  IF v_income <> 150000 + 1360000 OR v_expenses <> 10000 + 3300 THEN
    RAISE EXCEPTION 'Unexpected totals: income %, spending %.', v_income, v_expenses;
  END IF;
  IF (SELECT closing_cents FROM public.fund_balances(v_org, DATE '2026-10-01', DATE '2026-10-31') WHERE code = 'BUILDING') <> 0 THEN
    RAISE EXCEPTION 'The voided expense still weighs on the building fund.';
  END IF;

  -- The plan's member limit.
  UPDATE public.plans SET max_members = 1 WHERE id = 'church_seed';
  BEGIN
    INSERT INTO public.members (org_id, member_number, first_name) VALUES (v_org, '1044', 'Baraka');
    RAISE EXCEPTION 'A member over the plan limit was added.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE 'The Seed plan includes 1 members.' THEN RAISE EXCEPTION 'Unexpected message: %', v_error; END IF;
  END;
  INSERT INTO public.members (org_id, member_number, first_name, status) VALUES (v_org, '1045', 'Chebet', 'TRANSFERRED');
END
$test$;
ROLLBACK;
