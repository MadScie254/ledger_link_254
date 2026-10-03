\c lltest
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
-- Helpers: run a statement and return its error text, or 'ok'.
CREATE OR REPLACE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_err(p_sql text, p_pattern text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v text := pg_temp.err(p_sql);
BEGIN
  IF v !~* p_pattern THEN RAISE EXCEPTION 'expected error matching "%" but got "%" for: %', p_pattern, v, p_sql; END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.stock(p_id uuid) RETURNS int LANGUAGE sql AS $$ SELECT quantity_on_hand FROM public.inventory_items WHERE id = p_id $$;
CREATE OR REPLACE FUNCTION pg_temp.line(p_desc text, p_account text, p_item text, p_qty text, p_price bigint, p_rate text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('description', p_desc, 'accountId', p_account, 'inventoryItemId', p_item,
    'quantity', p_qty::numeric, 'unitPriceCents', p_price, 'taxRate', p_rate::numeric)) $$;

-- People: owner 01 (fixture), member 04, accountant 05. Another company bb.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000005', 'accountant@test');
INSERT INTO public.memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000004', 'member'),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000005', 'accountant');
INSERT INTO public.organizations (id, name) VALUES ('00000000-0000-0000-0000-0000000000bb', 'Other Co');
INSERT INTO public.customers (id, org_id, display_name) VALUES ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000bb', 'Not ours');
INSERT INTO public.accounts (id, org_id, code, name, type) VALUES ('00000000-0000-0000-0000-00000000b400', '00000000-0000-0000-0000-0000000000bb', '4000', 'Their sales', 'INCOME');
INSERT INTO public.inventory_items (id, org_id, name, type, quantity_on_hand) VALUES ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000bb', 'Their cement', 'Physical Product', 100);

\set ORG '00000000-0000-0000-0000-0000000000aa'
\set OWNER '00000000-0000-0000-0000-000000000001'
\set CUST '00000000-0000-0000-0000-0000000000c1'
\set SALES '00000000-0000-0000-0000-00000000a400'
\set CEMENT '00000000-0000-0000-0000-0000000000e1'
\set DELIVERY '00000000-0000-0000-0000-0000000000e2'

-- 1. Create: totals computed in SQL, numbering, replay.
SELECT public.create_sales_order(:'ORG', :'CUST', '2026-10-01', '2026-10-05', 'Deliver to site', :'OWNER',
  jsonb_build_array(
    pg_temp.line('Cement 50kg', :'SALES', :'CEMENT', '2', 75000, '16'),
    pg_temp.line('Delivery', :'SALES', :'DELIVERY', '1', 50000, '0'),
    pg_temp.line('Labour', :'SALES', NULL, '1.5', 2001, '0')),
  'key-o1') AS o1 \gset
SELECT (:'o1'::jsonb ->> 'id') AS o1_id \gset
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.sales_orders WHERE idempotency_key = 'key-o1';
  ASSERT r.order_number = 'SO-2026-00001', 'number ' || r.order_number;
  -- 2 x 750.00 = 1,500.00 + 16% VAT 240.00; delivery 500.00; 1.5 x 20.01 = 30.015 -> 30.02 (half away from zero)
  ASSERT r.subtotal_cents = 150000 + 50000 + 3002, 'subtotal ' || r.subtotal_cents;
  ASSERT r.tax_cents = 24000, 'tax ' || r.tax_cents;
  ASSERT r.total_cents = 227002, 'total ' || r.total_cents;
  ASSERT r.status = 'OPEN' AND r.currency = 'KES';
  ASSERT (SELECT count(*) FROM public.sales_order_lines WHERE order_id = r.id) = 3;
  ASSERT (SELECT sum(amount_cents) FROM public.sales_order_lines WHERE order_id = r.id) = r.subtotal_cents;
END $$;
SELECT public.create_sales_order(:'ORG', :'CUST', '2026-10-01', NULL, NULL, :'OWNER',
  jsonb_build_array(pg_temp.line('Anything', :'SALES', NULL, '9', 1, '0')), 'key-o1') ->> 'id' AS replay_id \gset
DO $$ BEGIN ASSERT (SELECT count(*) FROM public.sales_orders) = 1, 'replay created a second order'; END $$;
SELECT (:'replay_id' = :'o1_id') AS replay_same \gset
\if :replay_same
\else
  SELECT 1/0 AS replay_returned_a_different_order;
\endif

SELECT public.create_sales_order(:'ORG', :'CUST', '2026-10-02', NULL, NULL, :'OWNER',
  jsonb_build_array(pg_temp.line('Paint', :'SALES', NULL, '1', 120000, '0')), 'key-o2') ->> 'id' AS o2_id \gset
DO $$ BEGIN ASSERT (SELECT order_number FROM public.sales_orders WHERE idempotency_key = 'key-o2') = 'SO-2026-00002'; END $$;

-- 2. Refusals on create.
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, '00000000-0000-0000-0000-0000000000c9', '2026-10-01', NULL, NULL, %L, %L, 'k1')$q$,
  :'ORG', :'OWNER', jsonb_build_array(pg_temp.line('x', :'SALES', NULL, '1', 100, '0'))), 'Customer does not belong');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-01', NULL, NULL, %L, %L, 'k2')$q$,
  :'ORG', :'CUST', :'OWNER', jsonb_build_array(pg_temp.line('x', '00000000-0000-0000-0000-00000000b400', NULL, '1', 100, '0'))), 'active income account');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-01', NULL, NULL, %L, %L, 'k3')$q$,
  :'ORG', :'CUST', :'OWNER', jsonb_build_array(pg_temp.line('x', '00000000-0000-0000-0000-00000000a000', NULL, '1', 100, '0'))), 'active income account');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-01', NULL, NULL, %L, %L, 'k4')$q$,
  :'ORG', :'CUST', :'OWNER', jsonb_build_array(pg_temp.line('x', :'SALES', '00000000-0000-0000-0000-0000000000e9', '1', 100, '0'))), 'stock item from another organization');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-01', NULL, NULL, %L, %L, 'k5')$q$,
  :'ORG', :'CUST', :'OWNER', jsonb_build_array(pg_temp.line('x', :'SALES', NULL, '1', 0, '0'))), 'comes to nothing');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-01', NULL, NULL, %L, %L, 'k6')$q$,
  :'ORG', :'CUST', :'OWNER', jsonb_build_array(pg_temp.line('Cement', :'SALES', :'CEMENT', '1.5', 75000, '0'))), 'whole number');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-01', NULL, NULL, %L, %L, 'k7')$q$,
  :'ORG', :'CUST', :'OWNER', '[{"description":"x","accountId":"00000000-0000-0000-0000-00000000a400","quantity":"abc","unitPriceCents":1}]'), 'contains an invalid value');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-01', NULL, NULL, %L, %L, 'k8')$q$,
  :'ORG', :'CUST', :'OWNER', jsonb_build_array(pg_temp.line('x', :'SALES', NULL, '1', 100, '101'))), 'VAT rate');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-01', NULL, NULL, %L, %L, 'k9')$q$,
  :'ORG', :'CUST', :'OWNER', jsonb_build_array(pg_temp.line('x', :'SALES', NULL, '1.2345', 100, '0'))), 'three decimals');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-05', '2026-10-01', NULL, %L, %L, 'k10')$q$,
  :'ORG', :'CUST', :'OWNER', jsonb_build_array(pg_temp.line('x', :'SALES', NULL, '1', 100, '0'))), 'promised date');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-01', NULL, NULL, %L, '[]', 'k11')$q$,
  :'ORG', :'CUST', :'OWNER'), 'between 1 and 200');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-01', NULL, NULL, %L, %L, 'k12')$q$,
  :'ORG', :'CUST', '00000000-0000-0000-0000-000000000004', jsonb_build_array(pg_temp.line('x', :'SALES', NULL, '1', 100, '0'))), 'owner, administrator or accountant');
SELECT pg_temp.expect_err(format($q$SELECT public.create_sales_order(%L, %L, '2026-10-01', NULL, NULL, %L, %L, 'k13')$q$,
  :'ORG', :'CUST', :'OWNER', jsonb_build_array(pg_temp.line('x', :'SALES', NULL, '1000000000', 1000000000, '0'))), 'too large');
DO $$ BEGIN ASSERT (SELECT count(*) FROM public.sales_orders) = 2, 'a refused order was saved'; END $$;
-- An accountant may record orders.
SELECT public.create_sales_order(:'ORG', :'CUST', '2026-10-03', NULL, NULL, '00000000-0000-0000-0000-000000000005',
  jsonb_build_array(pg_temp.line('Cement 50kg', :'SALES', :'CEMENT', '10', 75000, '0')), 'key-o3') ->> 'id' AS o3_id \gset

-- 3. Status moves and stock on O1 (2 cement, 1 delivery service).
SELECT count(*) AS audit_before FROM public.audit_logs WHERE resource_type = 'SALES_ORDER' AND resource_id = :'o1_id' \gset
SELECT public.set_sales_order_status(:'ORG', :'o1_id', 'IN_PROGRESS', NULL, :'OWNER');
SELECT public.set_sales_order_status(:'ORG', :'o1_id', 'in_progress', NULL, :'OWNER');  -- no-op
SELECT count(*) AS audit_after FROM public.audit_logs WHERE resource_type = 'SALES_ORDER' AND resource_id = :'o1_id' \gset
SELECT (:audit_after = :audit_before + 1) AS one_audit_row \gset
\if :one_audit_row
\else
  SELECT 1/0 AS no_op_wrote_an_audit_row;
\endif
SELECT pg_temp.expect_err(format($q$SELECT public.set_sales_order_status(%L, %L, 'OPEN', NULL, %L)$q$, :'ORG', :'o1_id', :'OWNER'), 'in progress, completed or cancelled');
SELECT public.set_sales_order_status(:'ORG', :'o1_id', 'COMPLETED', NULL, :'OWNER') AS completed \gset
DO $$ BEGIN
  ASSERT pg_temp.stock('00000000-0000-0000-0000-0000000000e1') = 3, 'cement after completing: ' || pg_temp.stock('00000000-0000-0000-0000-0000000000e1');
  ASSERT pg_temp.stock('00000000-0000-0000-0000-0000000000e2') = 0, 'the service item was counted';
END $$;
SELECT (:'completed'::jsonb -> 'stockChanges' -> 0 ->> 'quantity') = '-2' AND (:'completed'::jsonb -> 'stockChanges' -> 0 ->> 'quantityOnHand') = '3'
  AND jsonb_array_length(:'completed'::jsonb -> 'stockChanges') = 1 AS stock_reported \gset
\if :stock_reported
\else
  SELECT 1/0 AS stock_changes_not_reported;
\endif
SELECT public.set_sales_order_status(:'ORG', :'o1_id', 'COMPLETED', NULL, :'OWNER');  -- double click
DO $$ BEGIN ASSERT pg_temp.stock('00000000-0000-0000-0000-0000000000e1') = 3, 'double completion counted stock twice'; END $$;
SELECT pg_temp.expect_err(format($q$SELECT public.set_sales_order_status(%L, %L, 'CANCELLED', 'x', %L)$q$, :'ORG', :'o1_id', :'OWNER'), 'is completed and cannot become cancelled');
SELECT public.set_sales_order_status(:'ORG', :'o1_id', 'IN_PROGRESS', NULL, :'OWNER');  -- reopen
DO $$ DECLARE r record; BEGIN
  ASSERT pg_temp.stock('00000000-0000-0000-0000-0000000000e1') = 5, 'reopen did not restore stock';
  SELECT * INTO r FROM public.sales_orders WHERE idempotency_key = 'key-o1';
  ASSERT r.completed_at IS NULL AND r.completed_by IS NULL;
END $$;
SELECT public.set_sales_order_status(:'ORG', :'o1_id', 'COMPLETED', NULL, '00000000-0000-0000-0000-000000000005');  -- accountant completes
DO $$ BEGIN ASSERT pg_temp.stock('00000000-0000-0000-0000-0000000000e1') = 3; END $$;
SELECT pg_temp.expect_err(format($q$SELECT public.set_sales_order_status(%L, %L, 'IN_PROGRESS', NULL, '00000000-0000-0000-0000-000000000004')$q$, :'ORG', :'o1_id'), 'owner, administrator or accountant');

-- 4. Over-selling records a negative count.
SELECT public.set_sales_order_status(:'ORG', :'o3_id', 'COMPLETED', NULL, :'OWNER');
DO $$ BEGIN ASSERT pg_temp.stock('00000000-0000-0000-0000-0000000000e1') = -7, 'oversold count: ' || pg_temp.stock('00000000-0000-0000-0000-0000000000e1'); END $$;

-- 5. Cancelling: needs a reason, never touches stock, is final.
SELECT pg_temp.expect_err(format($q$SELECT public.set_sales_order_status(%L, %L, 'CANCELLED', '  ', %L)$q$, :'ORG', :'o2_id', :'OWNER'), 'Give a reason');
SELECT public.set_sales_order_status(:'ORG', :'o2_id', 'CANCELLED', 'Customer changed their mind', :'OWNER');
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.sales_orders WHERE idempotency_key = 'key-o2';
  ASSERT r.status = 'CANCELLED' AND r.cancel_reason = 'Customer changed their mind' AND r.cancelled_at IS NOT NULL;
  ASSERT pg_temp.stock('00000000-0000-0000-0000-0000000000e1') = -7, 'cancel touched stock';
END $$;
SELECT pg_temp.expect_err(format($q$SELECT public.set_sales_order_status(%L, %L, 'IN_PROGRESS', NULL, %L)$q$, :'ORG', :'o2_id', :'OWNER'), 'is cancelled and cannot become in progress');
SELECT pg_temp.expect_err(format($q$SELECT public.set_sales_order_status(%L, %L, 'COMPLETED', NULL, %L)$q$, :'ORG', :'o2_id', :'OWNER'), 'is cancelled and cannot become completed');

-- 6. Invoicing O1: one balanced posting, receivables up by the order total, nothing else moves.
SELECT count(*) AS invoices_before FROM public.invoices \gset
SELECT public.invoice_sales_order(:'ORG', :'o1_id', '2026-10-04', '2026-11-03', :'OWNER') AS inv1 \gset
SELECT public.invoice_sales_order(:'ORG', :'o1_id', '2026-10-04', '2026-11-03', :'OWNER') AS inv1_again \gset
DO $$ DECLARE r record; inv record; j record; BEGIN
  SELECT * INTO r FROM public.sales_orders WHERE idempotency_key = 'key-o1';
  SELECT * INTO inv FROM public.invoices WHERE id = r.invoice_id;
  ASSERT inv.invoice_number = 'INV-2026-00001', 'invoice number ' || inv.invoice_number;
  ASSERT inv.total_cents = r.total_cents AND inv.tax_cents = r.tax_cents AND inv.status = 'SENT';
  ASSERT inv.notes LIKE 'Order SO-2026-00001%Deliver to site', 'notes ' || inv.notes;
  ASSERT r.status = 'COMPLETED', 'invoicing changed the status';
  ASSERT pg_temp.stock('00000000-0000-0000-0000-0000000000e1') = -7, 'invoicing touched stock';
  ASSERT EXISTS (SELECT 1 FROM public.invoice_lines WHERE invoice_id = inv.id AND description = 'Cement 50kg (2 x 750.00)');
  ASSERT EXISTS (SELECT 1 FROM public.invoice_lines WHERE invoice_id = inv.id AND description = 'Labour (1.5 x 20.01)');
  SELECT sum(l.debit) AS dr, sum(l.credit) AS cr INTO j FROM public.journal_lines l JOIN public.journal_entries e ON e.id = l.journal_entry_id WHERE e.source_id = inv.id AND e.source_type = 'INVOICE';
  ASSERT j.dr = j.cr AND j.dr = 227002, 'journal ' || j.dr || ' / ' || j.cr;
  ASSERT (SELECT sum(l.debit) - sum(l.credit) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id WHERE a.code = '1100' AND a.org_id = r.org_id) = 227002, 'AR did not rise by the total';
  ASSERT (SELECT sum(l.credit) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id WHERE a.code = '2100' AND a.org_id = r.org_id) = 24000, 'output VAT';
END $$;
SELECT (:'inv1'::jsonb ->> 'invoiceId') = (:'inv1_again'::jsonb ->> 'invoiceId') AND (SELECT count(*) FROM public.invoices) = :invoices_before + 1 AS invoiced_once \gset
\if :invoiced_once
\else
  SELECT 1/0 AS invoiced_twice;
\endif
SELECT pg_temp.expect_err(format($q$SELECT public.invoice_sales_order(%L, %L, '2026-10-04', '2026-11-03', %L)$q$, :'ORG', :'o2_id', :'OWNER'), 'cancelled and cannot be invoiced');
SELECT pg_temp.expect_err(format($q$SELECT public.invoice_sales_order(%L, %L, '2026-10-04', '2026-11-03', '00000000-0000-0000-0000-000000000004')$q$, :'ORG', :'o3_id'), 'owner, administrator or accountant');

-- 7. An invoiced order cannot be cancelled until its invoice is voided.
SELECT public.create_sales_order(:'ORG', :'CUST', '2026-10-04', NULL, NULL, :'OWNER',
  jsonb_build_array(pg_temp.line('Sand', :'SALES', NULL, '3', 10000, '0')), 'key-o4') ->> 'id' AS o4_id \gset
SELECT public.invoice_sales_order(:'ORG', :'o4_id', '2026-10-04', '2026-11-03', :'OWNER') ->> 'invoiceId' AS inv4 \gset
SELECT pg_temp.expect_err(format($q$SELECT public.set_sales_order_status(%L, %L, 'CANCELLED', 'Wrong customer', %L)$q$, :'ORG', :'o4_id', :'OWNER'), 'void the invoice first');
SELECT public.void_invoice_with_reversal(:'ORG', :'inv4', '2026-10-04', :'OWNER');
SELECT public.set_sales_order_status(:'ORG', :'o4_id', 'CANCELLED', 'Wrong customer', :'OWNER') ->> 'status' AS o4_status \gset
SELECT (:'o4_status' = 'CANCELLED') AS cancelled_after_void \gset
\if :cancelled_after_void
\else
  SELECT 1/0 AS not_cancelled_after_void;
\endif

-- 8. Every posted entry still balances; browser roles cannot call or read.
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.journal_lines l GROUP BY l.journal_entry_id HAVING sum(l.debit) <> sum(l.credit)), 'unbalanced entry';
END $$;
SET ROLE authenticated;
SELECT pg_temp.expect_err($q$SELECT public.set_sales_order_status('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000000', 'COMPLETED', NULL, '00000000-0000-0000-0000-000000000001')$q$, 'permission denied');
SELECT pg_temp.expect_err($q$SELECT count(*) FROM public.sales_orders$q$, 'permission denied');
RESET ROLE;
-- Deleting a stock item keeps the order line and only forgets the link.
DELETE FROM public.inventory_items WHERE id = '00000000-0000-0000-0000-0000000000e2';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.sales_order_lines WHERE description = 'Delivery' AND inventory_item_id IS NULL AND org_id IS NOT NULL) = 1;
END $$;
SELECT 'ALL SALES ORDER SQL TESTS PASSED' AS result;
