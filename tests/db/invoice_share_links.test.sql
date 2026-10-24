\c lltest
\set ON_ERROR_STOP 1
-- Invoice links for the customer (20261024000700): made once and copied
-- again, counted when opened, withdrawn, never for a draft or voided
-- invoice, and offering the paybill or a payment request only when the
-- business is set up for them.
BEGIN;
DO $test$
DECLARE
  v_org UUID := '00000000-0000-0000-0000-0000000000aa';
  v_owner UUID := '00000000-0000-0000-0000-000000000001';
  v_member UUID := '00000000-0000-0000-0000-000000000004';
  v_sales UUID := '00000000-0000-0000-0000-00000000a400';
  v_customer UUID := '00000000-0000-0000-0000-0000000000c1';
  v_token TEXT := repeat('ab', 32);
  v_other TEXT := repeat('cd', 32);
  v_invoice UUID;
  v_link JSONB;
  v_open JSONB;
  v_failed BOOLEAN;
BEGIN
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_member, 'member') ON CONFLICT DO NOTHING;
  v_invoice := public.create_invoice_with_journal(v_org, v_customer, DATE '2026-10-01', DATE '2026-10-31', 'KES', 1, NULL, v_owner,
    jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', v_sales, 'amountCents', 150000)), 'share-inv-1');

  -- A member does not share.
  v_failed := false;
  BEGIN PERFORM public.share_invoice_link(v_org, v_invoice, v_token, v_member);
  EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  ASSERT v_failed, 'a read-only member cannot share an invoice';

  -- Made once; asking again returns the same link.
  v_link := public.share_invoice_link(v_org, v_invoice, v_token, v_owner);
  ASSERT v_link->>'token' = v_token AND (v_link->>'created')::BOOLEAN, 'link made';
  v_link := public.share_invoice_link(v_org, v_invoice, v_other, v_owner);
  ASSERT v_link->>'token' = v_token AND NOT (v_link->>'created')::BOOLEAN, 'the same link is copied again';

  -- Opened: the invoice and what is due; no paybill or request without M-Pesa set up.
  v_open := public.open_invoice_link(v_token);
  ASSERT (v_open->>'invoiceId')::UUID = v_invoice, 'opens the invoice';
  ASSERT (v_open->>'amountDueCents')::BIGINT = 150000, 'amount due';
  ASSERT v_open->>'paybill' IS NULL AND NOT (v_open->>'canRequestPayment')::BOOLEAN, 'no M-Pesa offered without a link';
  ASSERT v_open->>'accountNumber' = upper(regexp_replace((SELECT invoice_number FROM public.invoices WHERE id = v_invoice), '[^A-Za-z0-9]', '', 'g')),
    'the account number is the invoice number in letters and digits';
  PERFORM public.open_invoice_link(v_token, false);
  ASSERT (SELECT views FROM public.invoice_share_links WHERE token = v_token) = 1, 'a status check is not a view';
  ASSERT public.open_invoice_link(repeat('ef', 32)) IS NULL AND public.open_invoice_link('not-a-token') IS NULL, 'unknown links open nothing';

  -- A registered paybill is offered; a payment request needs the passkey and a posting person.
  INSERT INTO public.org_integrations (org_id, kind, shortcode, environment, status, callback_token_hash, created_by)
  VALUES (v_org, 'MPESA_C2B', '600100', 'SANDBOX', 'REGISTERED', repeat('0', 64), v_owner);
  v_open := public.open_invoice_link(v_token);
  ASSERT v_open->>'paybill' = '600100', 'paybill offered once registered';
  ASSERT NOT (v_open->>'canRequestPayment')::BOOLEAN, 'no request without the passkey';
  UPDATE public.org_integrations SET express_secret_id = gen_random_uuid() WHERE org_id = v_org;
  UPDATE public.organizations SET integration_actor_id = v_owner WHERE id = v_org;
  v_open := public.open_invoice_link(v_token);
  ASSERT (v_open->>'canRequestPayment')::BOOLEAN AND (v_open->>'requestActor')::UUID = v_owner, 'request offered in the posting person''s name';

  -- Withdrawn: the old link opens nothing and the next share is new.
  ASSERT public.withdraw_invoice_link(v_org, v_invoice, v_owner), 'withdrawn';
  ASSERT public.open_invoice_link(v_token) IS NULL, 'a withdrawn link opens nothing';
  v_link := public.share_invoice_link(v_org, v_invoice, v_other, v_owner);
  ASSERT v_link->>'token' = v_other AND (v_link->>'created')::BOOLEAN, 'a new link after withdrawal';

  -- A voided invoice is not shown, and is not shared again.
  PERFORM public.void_invoice_with_reversal(v_org, v_invoice, DATE '2026-10-02', v_owner);
  ASSERT public.open_invoice_link(v_other) IS NULL, 'a voided invoice is not shown';
  PERFORM public.withdraw_invoice_link(v_org, v_invoice, v_owner);
  v_failed := false;
  BEGIN PERFORM public.share_invoice_link(v_org, v_invoice, repeat('12', 32), v_owner);
  EXCEPTION WHEN check_violation THEN v_failed := true; END;
  ASSERT v_failed, 'a voided invoice is not shared';

  -- The links are the service role's alone.
  ASSERT NOT has_table_privilege('authenticated', 'public.invoice_share_links', 'SELECT'), 'signed-in users cannot read tokens';

  RAISE NOTICE 'invoice share links passed';
END $test$;
ROLLBACK;
SELECT 'invoice share links passed';
