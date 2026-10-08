-- Run after the migration stack and tests/db/fixture.sql, using psql -v ON_ERROR_STOP=1.
BEGIN;
DO $test$
DECLARE
  v_owner UUID := '00000000-0000-0000-0000-000000000004';
  v_law UUID;
  v_invitation UUID;
  v_error TEXT;
BEGIN
  v_law := public.create_organization(v_owner, '{"name":"Seat limit test","edition":"law"}', '[]', 'seat-limit-test');
  v_invitation := (public.invite_member(v_law, 'first-seat@test.example', 'member', v_owner)->>'invitationId')::UUID;
  IF (SELECT count(*) FROM public.organization_invitations WHERE org_id=v_law AND status='PENDING') <> 1 THEN
    RAISE EXCEPTION 'The first invitation was not recorded.';
  END IF;
  BEGIN
    PERFORM public.invite_member(v_law, 'second-seat@test.example', 'member', v_owner);
    RAISE EXCEPTION 'A third Solo user seat was allowed.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'plan user limit' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.organization_invitations WHERE org_id=v_law AND status='PENDING') <> 1 THEN
    RAISE EXCEPTION 'The refused invitation changed the pending count.';
  END IF;

  INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-000000000098','first-seat@test.example');
  PERFORM public.respond_to_invitation(v_invitation, '00000000-0000-0000-0000-000000000098', true);
  IF (SELECT count(*) FROM public.memberships WHERE org_id=v_law) <> 2
    OR EXISTS (SELECT 1 FROM public.organization_invitations WHERE id=v_invitation AND status='PENDING') THEN
    RAISE EXCEPTION 'Accepting an invitation did not turn its reserved seat into a membership.';
  END IF;

  INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-000000000099','direct-seat@test.example');
  BEGIN
    INSERT INTO public.memberships(org_id,user_id,role)
    VALUES (v_law,'00000000-0000-0000-0000-000000000099','member');
    RAISE EXCEPTION 'A direct third Solo user seat was allowed.';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error !~* 'plan user limit' THEN RAISE; END IF;
  END;
END
$test$;
ROLLBACK;
