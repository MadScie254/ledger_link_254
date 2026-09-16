-- Six months of books for the demo tenant rendered on the public landing page.
-- Inserted directly rather than through post_journal_entry(), which requires
-- auth.uid() to equal p_created_by and a membership row - neither exists in a
-- migration. The assertions at the end enforce the same invariants that
-- function does: every entry balances, and the whole ledger balances.

DO $$
DECLARE
  v_org uuid := '146b2a09-11b0-47bd-a0ba-d9f27f1f12ec';
  v_entry jsonb;
  v_line jsonb;
  v_entry_id uuid;
  v_unbalanced int;
  v_debits numeric;
  v_credits numeric;
  v_spec jsonb := $spec$[
    {"date":"2026-01-05","ref":"JE-0001","memo":"Share capital injection","lines":[
      {"code":"1000","debit":150000000},{"code":"1010","debit":10000000},{"code":"3000","credit":160000000}]},
    {"date":"2026-01-10","ref":"JE-0002","memo":"Purchase of workshop equipment","lines":[
      {"code":"1500","debit":45000000},{"code":"1000","credit":45000000}]},
    {"date":"2026-02-02","ref":"JE-0003","memo":"Stock purchase on 30-day terms","lines":[
      {"code":"1200","debit":160000000},{"code":"2000","credit":160000000}]},
    {"date":"2026-03-15","ref":"JE-0004","memo":"Credit sales - March, VAT at 16%","lines":[
      {"code":"1100","debit":174000000},{"code":"4000","credit":150000000},{"code":"2100","credit":24000000}]},
    {"date":"2026-03-15","ref":"JE-0005","memo":"Cost of goods sold - March credit sales","lines":[
      {"code":"5000","debit":90000000},{"code":"1200","credit":90000000}]},
    {"date":"2026-04-02","ref":"JE-0006","memo":"M-Pesa counter sales, VAT at 16%","lines":[
      {"code":"1010","debit":92800000},{"code":"4000","credit":80000000},{"code":"2100","credit":12800000}]},
    {"date":"2026-04-02","ref":"JE-0007","memo":"Cost of goods sold - counter sales","lines":[
      {"code":"5000","debit":47000000},{"code":"1200","credit":47000000}]},
    {"date":"2026-04-30","ref":"JE-0008","memo":"Customer receipts against March invoices","lines":[
      {"code":"1000","debit":120000000},{"code":"1100","credit":120000000}]},
    {"date":"2026-05-05","ref":"JE-0009","memo":"Supplier payment","lines":[
      {"code":"2000","debit":80000000},{"code":"1000","credit":80000000}]},
    {"date":"2026-05-31","ref":"JE-0010","memo":"Payroll - May 2026","lines":[
      {"code":"6000","debit":42000000},{"code":"2200","credit":6300000},{"code":"2210","credit":2520000},
      {"code":"2220","credit":1155000},{"code":"1000","credit":32025000}]},
    {"date":"2026-06-01","ref":"JE-0011","memo":"Rent - second quarter","lines":[
      {"code":"6100","debit":18000000},{"code":"1000","credit":18000000}]},
    {"date":"2026-06-15","ref":"JE-0012","memo":"Electricity and water","lines":[
      {"code":"6200","debit":4650000},{"code":"1010","credit":4650000}]}
  ]$spec$::jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.journal_entries WHERE org_id = v_org) THEN
    RAISE NOTICE 'Demo tenant already has journal entries; leaving them alone.';
    RETURN;
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_spec) LOOP
    INSERT INTO public.journal_entries (org_id, entry_date, memo, source_type, reference_no)
    VALUES (v_org, (v_entry->>'date')::date, v_entry->>'memo', 'SEED', v_entry->>'ref')
    RETURNING id INTO v_entry_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(v_entry->'lines') LOOP
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
      SELECT v_entry_id, a.id,
             COALESCE((v_line->>'debit')::numeric, 0),
             COALESCE((v_line->>'credit')::numeric, 0),
             v_entry->>'memo'
      FROM public.accounts a
      WHERE a.org_id = v_org AND a.code = v_line->>'code';
    END LOOP;
  END LOOP;

  SELECT count(*) INTO v_unbalanced FROM (
    SELECT je.id FROM public.journal_entries je
    JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.org_id = v_org
    GROUP BY je.id
    HAVING sum(jl.debit) <> sum(jl.credit)
  ) bad;
  IF v_unbalanced > 0 THEN
    RAISE EXCEPTION 'Demo seed produced % unbalanced journal entries.', v_unbalanced;
  END IF;

  SELECT sum(jl.debit), sum(jl.credit) INTO v_debits, v_credits
  FROM public.journal_entries je
  JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
  WHERE je.org_id = v_org;
  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'Demo ledger unbalanced: debits % vs credits %.', v_debits, v_credits;
  END IF;

  RAISE NOTICE 'Demo tenant seeded: % in debits, matching credits.', v_debits;
END $$;
