-- The integrity and security controls added on 4 October 2026
-- (20261004000100 to 20261004000600). Runs as the database owner against the
-- shared fixture; each check raises on failure.
\c lltest
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_err(p_sql text, p_pattern text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v text := pg_temp.err(p_sql);
BEGIN
  IF v !~* p_pattern THEN RAISE EXCEPTION 'expected error matching "%" but got "%" for: %', p_pattern, v, left(p_sql, 200); END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'check failed: %', p_what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.ar_gap() RETURNS numeric LANGUAGE sql AS $$
  SELECT ar_ledger_cents - open_invoice_cents FROM public.control_account_check('00000000-0000-0000-0000-0000000000aa') $$;
CREATE OR REPLACE FUNCTION pg_temp.ap_gap() RETURNS numeric LANGUAGE sql AS $$
  SELECT ap_ledger_cents - open_bill_cents FROM public.control_account_check('00000000-0000-0000-0000-0000000000aa') $$;

\set org '00000000-0000-0000-0000-0000000000aa'
\set owner '00000000-0000-0000-0000-000000000001'
\set admin '00000000-0000-0000-0000-000000000002'
\set accountant '00000000-0000-0000-0000-000000000003'
\set member '00000000-0000-0000-0000-000000000004'
\set bank '00000000-0000-0000-0000-00000000a000'
\set ar '00000000-0000-0000-0000-00000000a110'
\set vat_in '00000000-0000-0000-0000-00000000a150'
\set sales '00000000-0000-0000-0000-00000000a400'
\set opex '00000000-0000-0000-0000-00000000a600'
\set equity '00000000-0000-0000-0000-00000000a300'
\set customer '00000000-0000-0000-0000-0000000000c1'
\set vendor '00000000-0000-0000-0000-0000000000d1'

INSERT INTO auth.users (id, email) VALUES
  (:'admin', 'admin@test'), (:'accountant', 'accountant@test');
INSERT INTO public.memberships (org_id, user_id, role) VALUES
  (:'org', :'admin', 'admin'), (:'org', :'accountant', 'accountant');
INSERT INTO public.accounts (id, org_id, code, name, type) VALUES
  ('00000000-0000-0000-0000-00000000a120', :'org', '1200', 'Inventory asset', 'ASSET');

-- Invoice of 100.00 used throughout.
SELECT public.create_invoice_with_journal(:'org', :'customer', '2026-09-01', '2026-09-30', 'KES', 1, NULL, :'owner',
  jsonb_build_array(jsonb_build_object('description', 'Consulting', 'accountId', :'sales', 'amountCents', 10000)), 'inv-1') AS inv1 \gset

-- H1: money accounts only -------------------------------------------------------
SELECT pg_temp.expect_err(format($$SELECT public.receive_invoice_payment(%L, %L, 10000, '2026-09-05', %L, 'p-ar', %L)$$,
  :'org', :'inv1', :'ar', :'owner'), 'bank, cash or M-Pesa');
SELECT pg_temp.expect_err(format($$SELECT public.create_bill_with_journal(%L, %L, '2026-09-02', '2026-09-30', 'KES', 1, NULL, %L,
  '[{"description":"x","accountId":"%s","amountCents":7000}]', 'b-ar')$$, :'org', :'vendor', :'owner', :'ar'), 'not bill lines');
SELECT pg_temp.expect_err(format($$SELECT public.create_bill_with_journal(%L, %L, '2026-09-02', '2026-09-30', 'KES', 1, NULL, %L,
  '[{"description":"x","accountId":"%s","amountCents":7000}]', 'b-vat')$$, :'org', :'vendor', :'owner', :'vat_in'), 'not bill lines');
SELECT pg_temp.expect_err(format($$SELECT public.create_bill_with_journal(%L, %L, '2026-09-02', '2026-09-30', 'KES', 1, NULL, %L,
  '[{"description":"x","accountId":"%s","amountCents":7000}]', 'b-bank')$$, :'org', :'vendor', :'owner', :'bank'), 'not bill lines');
-- An asset such as inventory is still a valid bill line.
SELECT public.create_bill_with_journal(:'org', :'vendor', '2026-09-02', '2026-09-30', 'KES', 1, NULL, :'owner',
  jsonb_build_array(jsonb_build_object('description', 'Stock', 'accountId', '00000000-0000-0000-0000-00000000a120', 'amountCents', 4000)), 'b-stock') AS bill_stock \gset
SELECT pg_temp.expect_err(format($$SELECT public.pay_bill(%L, %L, 4000, '2026-09-03', %L, 'bp-ar', %L)$$,
  :'org', :'bill_stock', :'ar', :'owner'), 'bank, cash or M-Pesa');
SELECT pg_temp.expect_err($$UPDATE public.accounts SET is_bank_account = true WHERE code = '1100'$$, 'control_account_not_money');
SELECT pg_temp.expect_err($$UPDATE public.accounts SET is_bank_account = true WHERE code = '6000'$$, 'bank_account_is_asset');
SELECT pg_temp.check(pg_temp.ar_gap() = 0 AND pg_temp.ap_gap() = 0, 'control accounts agree with documents');

-- M7: reversing a payment ------------------------------------------------------
SELECT (public.receive_invoice_payment(:'org', :'inv1', 6000, '2026-09-05', :'bank', 'p-1', :'owner') ->> 'paymentId') AS pay1 \gset
SELECT pg_temp.check((SELECT status FROM public.invoices WHERE id = :'inv1') = 'PARTIALLY_PAID', 'partly paid');
SELECT pg_temp.expect_err(format($$SELECT public.void_invoice_with_reversal(%L, %L, '2026-09-06', %L)$$, :'org', :'inv1', :'owner'), 'reverse its payments first');
SELECT pg_temp.expect_err(format($$SELECT public.reverse_invoice_payment(%L, %L, '2026-09-06', '  ', %L)$$, :'org', :'pay1', :'owner'), 'reason');
SELECT pg_temp.expect_err(format($$SELECT public.reverse_invoice_payment(%L, %L, '2026-09-04', 'wrong', %L)$$, :'org', :'pay1', :'owner'), 'before the payment');
SELECT public.reverse_invoice_payment(:'org', :'pay1', '2026-09-06', 'Cheque bounced', :'accountant') ->> 'status' AS after_reversal \gset
SELECT pg_temp.check(:'after_reversal' = 'SENT', 'invoice back to SENT');
SELECT pg_temp.check((SELECT amount_due_cents FROM public.invoices WHERE id = :'inv1') = 10000, 'amount due restored');
-- Asking twice returns the first reversal.
SELECT pg_temp.check((SELECT count(*) FROM public.journal_entries WHERE idempotency_key = 'invoice-payment-reversal:' || :'pay1') = 1, 'one reversal entry');
SELECT public.reverse_invoice_payment(:'org', :'pay1', '2026-09-07', 'again', :'owner');
SELECT pg_temp.check((SELECT count(*) FROM public.journal_entries WHERE source_type = 'ADJUSTMENT' AND reference_no = 'REV-' || (SELECT invoice_number FROM public.invoices WHERE id = :'inv1')) = 1, 'still one reversal');
-- With the payment reversed the invoice can be voided.
SELECT public.void_invoice_with_reversal(:'org', :'inv1', '2026-09-08', :'owner');
SELECT pg_temp.check(pg_temp.ar_gap() = 0, 'AR agrees after pay, reverse, void');

-- A bill payment reversal restores the bill.
SELECT (public.pay_bill(:'org', :'bill_stock', 4000, '2026-09-04', :'bank', 'bp-1', :'owner') ->> 'paymentId') AS bpay1 \gset
SELECT public.reverse_bill_payment(:'org', :'bpay1', '2026-09-05', 'Paid the wrong supplier', :'owner') ->> 'status' AS bill_after \gset
SELECT pg_temp.check(:'bill_after' = 'OPEN', 'bill open again');
SELECT pg_temp.check(pg_temp.ap_gap() = 0, 'AP agrees after reversal');

-- M3: posted history is permanent for the service role -------------------------
SET ROLE service_role;
SELECT pg_temp.expect_err($$UPDATE public.journal_lines SET debit = debit + 1 WHERE debit > 0$$, 'permanent|permission denied');
SELECT pg_temp.expect_err($$DELETE FROM public.journal_entries$$, 'permanent|permission denied');
SELECT pg_temp.expect_err($$DELETE FROM public.audit_logs$$, 'permanent');
SELECT pg_temp.expect_err($$UPDATE public.invoice_payments SET amount_cents = 1$$, 'permanent');
SELECT pg_temp.expect_err($$DELETE FROM public.bill_payments$$, 'permanent');
RESET ROLE;

-- Every entry balances at commit, whoever writes it.
DO $$
DECLARE v_entry uuid := gen_random_uuid();
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  BEGIN
    INSERT INTO public.journal_entries (id, org_id, entry_date, source_type) VALUES (v_entry, '00000000-0000-0000-0000-0000000000aa', '2026-09-10', 'MANUAL');
    INSERT INTO public.journal_lines (org_id, journal_entry_id, account_id, debit, credit)
      VALUES ('00000000-0000-0000-0000-0000000000aa', v_entry, '00000000-0000-0000-0000-00000000a600', 500, 0);
    RAISE EXCEPTION 'an unbalanced entry was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;
END $$;

-- M5: the closing date ----------------------------------------------------------
UPDATE public.organizations SET books_closed_through = '2026-08-31' WHERE id = :'org';
SELECT pg_temp.expect_err(format($$SELECT public.post_journal_entry(%L, '2026-08-15', 'Late', 'MANUAL', NULL, NULL, %L,
  '[{"accountId":"%s","debit":500,"credit":0},{"accountId":"%s","debit":0,"credit":500}]')$$, :'org', :'owner', :'opex', :'equity'), 'closed through 31/08/2026');
SELECT pg_temp.expect_err(format($$SELECT public.create_invoice_with_journal(%L, %L, '2026-08-20', '2026-09-30', 'KES', 1, NULL, %L,
  '[{"description":"x","accountId":"%s","amountCents":100}]', 'inv-closed')$$, :'org', :'customer', :'owner', :'sales'), 'closed through');
SELECT public.post_journal_entry(:'org', '2026-09-01', 'Open period', 'MANUAL', NULL, NULL, :'owner',
  jsonb_build_array(jsonb_build_object('accountId', :'opex', 'debit', 500, 'credit', 0), jsonb_build_object('accountId', :'equity', 'debit', 0, 'credit', 500))) IS NOT NULL AS open_ok \gset
SELECT pg_temp.check(:'open_ok', 'posting after the closing date');
UPDATE public.organizations SET books_closed_through = NULL WHERE id = :'org';

-- Due dates on or after issue, for new and changed rows.
SELECT public.create_invoice_with_journal(:'org', :'customer', '2026-09-10', '2026-10-10', 'KES', 1, NULL, :'owner',
  jsonb_build_array(jsonb_build_object('description', 'Design', 'accountId', :'sales', 'amountCents', 50000)), 'inv-2') AS inv2 \gset
SELECT pg_temp.expect_err(format($$UPDATE public.invoices SET due_date = '2026-09-01' WHERE id = %L$$, :'inv2'), 'due_on_or_after_issue');

-- H2: changes to records are audited, with the actor, in the same transaction ---
INSERT INTO public.employees (id, org_id, first_name, last_name, base_salary, bank_account, status)
VALUES ('00000000-0000-0000-0000-0000000000f1', :'org', 'Wanjiru', 'Kamau', 8500000, '111', 'Active');
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.headers', '{"x-ledger-actor":"00000000-0000-0000-0000-000000000003"}', true);
UPDATE public.employees SET bank_account = '999', phone = phone WHERE id = '00000000-0000-0000-0000-0000000000f1';
COMMIT;
SELECT pg_temp.check((
  SELECT details -> 'changes' -> 'bank_account' = '{"from":"111","to":"999"}'::jsonb
     AND user_id = :'accountant' AND actor_email = 'accountant@test' AND action = 'UPDATE'
     AND NOT (details -> 'changes' ? 'phone')
  FROM public.audit_logs WHERE resource_type = 'EMPLOYEE' AND action = 'UPDATE'
  ORDER BY "timestamp" DESC LIMIT 1), 'employee bank change audited with actor');
-- Balances kept by workflows do not flood the log.
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE resource_type = 'CUSTOMER' AND action = 'UPDATE'), 'balance updates not audited');
-- Invoice date edits are audited; workflow status changes are not doubled.
UPDATE public.invoices SET due_date = '2026-10-20', notes = 'Agreed extension' WHERE id = :'inv2';
SELECT pg_temp.check((SELECT details -> 'changes' ? 'due_date' AND details -> 'changes' ? 'notes'
  FROM public.audit_logs WHERE resource_type = 'INVOICE' AND action = 'UPDATE' AND resource_id = :'inv2'), 'invoice edit audited');

-- H2/M8: stock moves only through movements -------------------------------------
SET ROLE service_role;
SELECT pg_temp.expect_err($$UPDATE public.inventory_items SET quantity_on_hand = 40 WHERE id = '00000000-0000-0000-0000-0000000000e1'$$, 'stock adjustment or an order');
RESET ROLE;
SELECT pg_temp.check((SELECT sum(quantity) FROM public.inventory_movements WHERE item_id = '00000000-0000-0000-0000-0000000000e1') = 5, 'opening movement');
SELECT pg_temp.expect_err(format($$SELECT public.adjust_stock(%L, '00000000-0000-0000-0000-0000000000e1', 3, '', %L, 'adj-1')$$, :'org', :'owner'), 'reason');
SELECT public.adjust_stock(:'org', '00000000-0000-0000-0000-0000000000e1', 3, 'Count on 30 September: two bags damaged', :'accountant', 'adj-1') ->> 'quantityOnHand' AS after_count \gset
SELECT pg_temp.check(:'after_count'::int = 3, 'counted to 3');
SELECT public.adjust_stock(:'org', '00000000-0000-0000-0000-0000000000e1', 3, 'retry', :'accountant', 'adj-1');
SELECT pg_temp.check((SELECT count(*) FROM public.inventory_movements WHERE idempotency_key = 'adj-1') = 1, 'adjustment once');
SELECT pg_temp.check((SELECT quantity_on_hand FROM public.inventory_items WHERE id = '00000000-0000-0000-0000-0000000000e1') = 3, 'stock 3');

-- Phantom stock: a service ordered, completed, its type changed, then reopened.
SELECT (public.create_sales_order(:'org', :'customer', '2026-09-05', NULL, NULL, :'owner',
  jsonb_build_array(jsonb_build_object('description', 'Delivery', 'accountId', :'sales', 'inventoryItemId', '00000000-0000-0000-0000-0000000000e2',
    'quantity', 4, 'unitPriceCents', 50000)), 'so-1') ->> 'id') AS so1 \gset
SELECT public.set_sales_order_status(:'org', :'so1', 'COMPLETED', NULL, :'owner');
UPDATE public.inventory_items SET type = 'Physical Product' WHERE id = '00000000-0000-0000-0000-0000000000e2';
SELECT public.set_sales_order_status(:'org', :'so1', 'IN_PROGRESS', NULL, :'owner');
SELECT pg_temp.check((SELECT quantity_on_hand FROM public.inventory_items WHERE id = '00000000-0000-0000-0000-0000000000e2') = 0, 'no phantom stock');
-- A real stock item is counted out and back exactly.
SELECT (public.create_sales_order(:'org', :'customer', '2026-09-05', NULL, NULL, :'owner',
  jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', :'sales', 'inventoryItemId', '00000000-0000-0000-0000-0000000000e1',
    'quantity', 2, 'unitPriceCents', 75000)), 'so-2') ->> 'id') AS so2 \gset
SELECT public.set_sales_order_status(:'org', :'so2', 'COMPLETED', NULL, :'owner');
SELECT pg_temp.check((SELECT quantity_on_hand FROM public.inventory_items WHERE id = '00000000-0000-0000-0000-0000000000e1') = 1, 'counted out');
UPDATE public.inventory_items SET type = 'Digital Service' WHERE id = '00000000-0000-0000-0000-0000000000e1';
SELECT public.set_sales_order_status(:'org', :'so2', 'IN_PROGRESS', NULL, :'owner');
SELECT pg_temp.check((SELECT quantity_on_hand FROM public.inventory_items WHERE id = '00000000-0000-0000-0000-0000000000e1') = 3, 'counted back exactly');
UPDATE public.inventory_items SET type = 'Physical Product' WHERE id = '00000000-0000-0000-0000-0000000000e1';

-- M7(c): an order whose invoice was voided is invoiced afresh.
SELECT (public.invoice_sales_order(:'org', :'so2', '2026-09-06', '2026-10-06', :'owner') ->> 'invoiceId') AS so_inv1 \gset
SELECT public.void_invoice_with_reversal(:'org', :'so_inv1', '2026-09-07', :'owner');
SELECT (public.invoice_sales_order(:'org', :'so2', '2026-09-08', '2026-10-08', :'owner') ->> 'invoiceId') AS so_inv2 \gset
SELECT pg_temp.check(:'so_inv1' <> :'so_inv2', 'new invoice after void');
SELECT pg_temp.check((SELECT invoice_id FROM public.sales_orders WHERE id = :'so2') = :'so_inv2'::uuid, 'order points at the new invoice');
SELECT pg_temp.check((public.invoice_sales_order(:'org', :'so2', '2026-09-09', '2026-10-09', :'owner') ->> 'invoiceId') = :'so_inv2', 'standing invoice returned');

-- M6: bill approvals ----------------------------------------------------------------
UPDATE public.organizations SET approval_threshold_cents = 100000 WHERE id = :'org';
SELECT public.create_bill_with_journal(:'org', :'vendor', '2026-09-10', '2026-10-10', 'KES', 1, NULL, :'accountant',
  jsonb_build_array(jsonb_build_object('description', 'Generator service', 'accountId', :'opex', 'amountCents', 250000)), 'b-big', 'KPLC-778') AS big \gset
SELECT pg_temp.expect_err(format($$SELECT public.pay_bill(%L, %L, 250000, '2026-09-11', %L, 'bp-big', %L)$$, :'org', :'big', :'bank', :'accountant'), 'needs approval');
SELECT pg_temp.expect_err(format($$SELECT public.approve_bill(%L, %L, %L)$$, :'org', :'big', :'accountant'), 'owner or administrator');
-- The owner who entered a bill cannot approve their own.
SELECT public.create_bill_with_journal(:'org', :'vendor', '2026-09-10', '2026-10-10', 'KES', 1, NULL, :'owner',
  jsonb_build_array(jsonb_build_object('description', 'Rent', 'accountId', :'opex', 'amountCents', 300000)), 'b-own') AS own \gset
SELECT pg_temp.expect_err(format($$SELECT public.approve_bill(%L, %L, %L)$$, :'org', :'own', :'owner'), 'cannot also approve');
SELECT public.approve_bill(:'org', :'big', :'admin');
SELECT public.pay_bill(:'org', :'big', 250000, '2026-09-11', :'bank', 'bp-big', :'accountant') ->> 'status' AS big_status \gset
SELECT pg_temp.check(:'big_status' = 'PAID', 'approved bill paid');
UPDATE public.organizations SET approval_threshold_cents = NULL WHERE id = :'org';

-- L13: the same supplier invoice cannot be entered twice --------------------------
SELECT pg_temp.expect_err(format($$SELECT public.create_bill_with_journal(%L, %L, '2026-09-12', '2026-10-12', 'KES', 1, NULL, %L,
  '[{"description":"dup","accountId":"%s","amountCents":100}]', 'b-dup', 'kplc-778')$$, :'org', :'vendor', :'owner', :'opex'), 'already recorded as bill');

-- Payroll: a reversed run frees its month for a corrected run -----------------------
SELECT public.run_payroll_with_journal(:'org', 'September 2026', '2026-09-30', 'KE-2026-07', :'owner', 'payroll:sep',
  '00000000-0000-0000-0000-00000000a610', '00000000-0000-0000-0000-00000000a611', :'bank',
  '00000000-0000-0000-0000-00000000a211', '00000000-0000-0000-0000-00000000a212', '00000000-0000-0000-0000-00000000a213', '00000000-0000-0000-0000-00000000a214',
  jsonb_build_array(jsonb_build_object('employeeId', '00000000-0000-0000-0000-0000000000f1', 'grossCents', 100000, 'taxablePayCents', 100000,
    'payeCents', 0, 'nssfCents', 6000, 'shifCents', 2750, 'ahlCents', 1500, 'employerNssfCents', 6000, 'employerAhlCents', 1500,
    'netCents', 89750, 'rateVersion', 'KE-2026-07'))) AS run1 \gset
SELECT pg_temp.expect_err(format($$SELECT public.run_payroll_with_journal(%L, 'September 2026', '2026-09-30', 'KE-2026-07', %L, 'payroll:other',
  %L, %L, %L, %L, %L, %L, %L, '[]')$$, :'org', :'owner', '00000000-0000-0000-0000-00000000a610', '00000000-0000-0000-0000-00000000a611', :'bank',
  '00000000-0000-0000-0000-00000000a211', '00000000-0000-0000-0000-00000000a212', '00000000-0000-0000-0000-00000000a213', '00000000-0000-0000-0000-00000000a214'), 'already been run');
SELECT public.reverse_payroll_run(:'org', :'run1', '2026-09-30', 'Wrong allowances', :'owner');
SELECT public.run_payroll_with_journal(:'org', 'September 2026', '2026-09-30', 'KE-2026-07', :'owner', 'payroll:sep',
  '00000000-0000-0000-0000-00000000a610', '00000000-0000-0000-0000-00000000a611', :'bank',
  '00000000-0000-0000-0000-00000000a211', '00000000-0000-0000-0000-00000000a212', '00000000-0000-0000-0000-00000000a213', '00000000-0000-0000-0000-00000000a214',
  jsonb_build_array(jsonb_build_object('employeeId', '00000000-0000-0000-0000-0000000000f1', 'grossCents', 110000, 'taxablePayCents', 110000,
    'payeCents', 0, 'nssfCents', 6600, 'shifCents', 3025, 'ahlCents', 1650, 'employerNssfCents', 6600, 'employerAhlCents', 1650,
    'netCents', 98725, 'rateVersion', 'KE-2026-07'))) AS run2 \gset
SELECT pg_temp.check(:'run1' <> :'run2', 'corrected run is a new run');
SELECT pg_temp.check((SELECT count(DISTINCT journal_entry_id) FROM public.payroll_runs WHERE period = 'September 2026') = 2, 'each run has its own posting');

-- M4: bank matching is one locked transaction ---------------------------------------
SELECT public.create_invoice_with_journal(:'org', :'customer', '2026-09-09', '2026-10-09', 'KES', 1, NULL, :'owner',
  jsonb_build_array(jsonb_build_object('description', 'Supply', 'accountId', :'sales', 'amountCents', 50000)), 'inv-bank') AS inv_bank \gset
SELECT public.match_bank_transaction(:'org', '00000000-0000-0000-0000-0000000000b1', NULL, NULL, :'inv_bank', NULL, :'owner') AS match1 \gset
SELECT pg_temp.expect_err(format($$SELECT public.match_bank_transaction(%L, '00000000-0000-0000-0000-0000000000b1', %L, NULL, NULL, NULL, %L)$$,
  :'org', :'opex', :'owner'), 'already matched');
SELECT pg_temp.expect_err(format($$SELECT public.unmatch_bank_transaction(%L, '00000000-0000-0000-0000-0000000000b1', %L)$$, :'org', :'owner'), 'Reverse that payment');
-- Reversing the payment opens the line; matching again records a new payment.
SELECT public.reverse_invoice_payment(:'org', (SELECT id FROM public.invoice_payments WHERE journal_entry_id = :'match1'), '2026-09-12', 'Matched in error', :'owner');
SELECT pg_temp.check((SELECT status FROM public.bank_transactions WHERE id = '00000000-0000-0000-0000-0000000000b1') = 'UNREVIEWED', 'line reopened');
SELECT public.match_bank_transaction(:'org', '00000000-0000-0000-0000-0000000000b1', NULL, NULL, :'inv_bank', NULL, :'owner') AS match2 \gset
SELECT pg_temp.check(:'match1' <> :'match2', 'a fresh payment');
SELECT pg_temp.check((SELECT status FROM public.invoices WHERE id = :'inv_bank') = 'PAID', 'invoice paid by the line');
-- A line posted to an account can be undone and matched again.
SELECT public.match_bank_transaction(:'org', '00000000-0000-0000-0000-0000000000b2', :'opex', NULL, NULL, NULL, :'owner') AS match3 \gset
SELECT public.unmatch_bank_transaction(:'org', '00000000-0000-0000-0000-0000000000b2', :'owner') ->> 'reversalJournalEntryId' IS NOT NULL AS reversed \gset
SELECT pg_temp.check(:'reversed', 'match posting reversed');
SELECT public.match_bank_transaction(:'org', '00000000-0000-0000-0000-0000000000b2', :'opex', NULL, NULL, NULL, :'owner') AS match4 \gset
SELECT pg_temp.check(:'match3' <> :'match4', 'rematch posts anew');
-- One entry cannot stand for two lines.
INSERT INTO public.bank_transactions (id, org_id, date, description, amount_cents, direction)
VALUES ('00000000-0000-0000-0000-0000000000b3', :'org', '2026-09-11', 'KPLC TOKENS', 30000, 'OUT');
SELECT pg_temp.expect_err(format($$SELECT public.match_bank_transaction(%L, '00000000-0000-0000-0000-0000000000b3', NULL, %L, NULL, NULL, %L)$$,
  :'org', :'match4', :'owner'), 'already matched to another');
SELECT pg_temp.expect_err(format($$UPDATE public.bank_transactions SET matched_journal_entry_id = %L WHERE id = '00000000-0000-0000-0000-0000000000b3'$$, :'match4'), 'duplicate key');

-- M1: invitations need consent ----------------------------------------------------------
SELECT pg_temp.expect_err(format($$SELECT public.invite_member(%L, 'someone@test', 'member', %L)$$, :'org', :'accountant'), 'Only an owner or administrator');
SELECT pg_temp.expect_err(format($$SELECT public.invite_member(%L, 'someone@test', 'admin', %L)$$, :'org', :'admin'), 'Only the owner invites administrators');
UPDATE auth.users SET email = 'member@example.com' WHERE id = :'member';
SELECT pg_temp.expect_err(format($$SELECT public.invite_member(%L, 'not-an-email', 'member', %L)$$, :'org', :'admin'), 'valid email');
SELECT (public.invite_member(:'org', ' Member@Example.com ', 'accountant', :'admin') ->> 'invitationId') AS invite \gset
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.memberships WHERE org_id = :'org' AND user_id = :'member'), 'no membership before acceptance');
SELECT pg_temp.check((SELECT count(*) FROM public.pending_invitations(:'member')) = 1, 'invitation listed for the invitee');
SELECT pg_temp.check((SELECT count(*) FROM public.pending_invitations(:'admin')) = 0, 'not listed for others');
SELECT pg_temp.expect_err(format($$SELECT public.respond_to_invitation(%L, %L, true)$$, :'invite', :'admin'), 'not addressed to your');
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = :'member';
SELECT pg_temp.expect_err(format($$SELECT public.respond_to_invitation(%L, %L, true)$$, :'invite', :'member'), 'not addressed to your');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = :'member';
SELECT public.respond_to_invitation(:'invite', :'member', true);
SELECT pg_temp.check((SELECT role FROM public.memberships WHERE org_id = :'org' AND user_id = :'member') = 'accountant', 'joined as accountant');
SELECT pg_temp.expect_err(format($$SELECT public.respond_to_invitation(%L, %L, true)$$, :'invite', :'member'), 'no longer open');
SELECT public.leave_organization(:'org', :'member');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.memberships WHERE org_id = :'org' AND user_id = :'member'), 'left');
SELECT pg_temp.expect_err(format($$SELECT public.leave_organization(%L, %L)$$, :'org', :'owner'), 'Transfer ownership');
SELECT public.transfer_ownership(:'org', (SELECT id FROM public.memberships WHERE org_id = :'org' AND user_id = :'admin'), :'owner');
SELECT pg_temp.check((SELECT role FROM public.memberships WHERE org_id = :'org' AND user_id = :'admin') = 'owner'
  AND (SELECT role FROM public.memberships WHERE org_id = :'org' AND user_id = :'owner') = 'admin', 'ownership transferred');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.audit_logs WHERE resource_type = 'TEAM_MEMBER' AND action = 'DELETE' AND user_id = :'member'), 'leaving audited with the leaver');
SELECT public.transfer_ownership(:'org', (SELECT id FROM public.memberships WHERE org_id = :'org' AND user_id = :'owner'), :'admin');

-- L10: organizations are created whole, once per key ---------------------------------------
SELECT public.create_organization(:'member', '{"name":"Duka Ltd","baseCurrency":"kes","businessType":"retail"}',
  '[{"code":"1000","name":"Cash","type":"ASSET","isBankAccount":true},{"code":"1100","name":"AR","type":"ASSET"}]', 'key-1') AS new_org \gset
SELECT pg_temp.check(public.create_organization(:'member', '{"name":"Duka Ltd"}', '[]', 'key-1') = :'new_org'::uuid, 'same key, same organization');
SELECT pg_temp.check((SELECT role FROM public.memberships WHERE org_id = :'new_org' AND user_id = :'member') = 'owner', 'creator owns it');
SELECT pg_temp.check((SELECT count(*) FROM public.accounts WHERE org_id = :'new_org') = 2
  AND (SELECT is_bank_account FROM public.accounts WHERE org_id = :'new_org' AND code = '1000'), 'chart created');
SELECT pg_temp.check((SELECT base_currency FROM public.organizations WHERE id = :'new_org') = 'KES', 'currency normalized');
SELECT pg_temp.expect_err(format($$SELECT public.create_organization(%L, '{"name":"  "}', '[]', NULL)$$, :'member'), 'name of up to 200');

-- M2: rate limits -------------------------------------------------------------------------
SELECT pg_temp.check(public.consume_rate_limit('test:a', 2, 60) AND public.consume_rate_limit('test:a', 2, 60)
  AND NOT public.consume_rate_limit('test:a', 2, 60) AND public.consume_rate_limit('test:b', 2, 60), 'limit of 2 per window');

-- L14: browser roles cannot post journals directly -------------------------------------------
SELECT pg_temp.check(NOT has_function_privilege('authenticated',
  'public.post_journal_entry(uuid, date, text, text, uuid, text, uuid, jsonb, text)', 'EXECUTE'), 'journal RPC not public');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.match_bank_transaction(uuid, uuid, uuid, uuid, uuid, uuid, uuid)', 'EXECUTE'), 'match RPC not public');
SELECT pg_temp.check(NOT has_table_privilege('authenticated', 'public.inventory_movements', 'SELECT'), 'movements not public');

-- L12: balances from documents ------------------------------------------------------------------
SELECT pg_temp.check((SELECT open_cents FROM public.party_balances(:'org') WHERE party_type = 'CUSTOMER' AND party_id = :'customer')
  = (SELECT sum(amount_due_cents) FROM public.invoices WHERE org_id = :'org' AND customer_id = :'customer' AND status NOT IN ('PAID','VOID')), 'customer balance from invoices');

-- Throughout: receivables and payables still agree with their documents.
SELECT pg_temp.check(pg_temp.ar_gap() = 0 AND pg_temp.ap_gap() = 0, 'control accounts agree at the end');

SELECT 'ALL CONTROL TESTS PASSED' AS result;
