-- Serialize seat reservations across Worker instances. A pending invitation
-- holds one seat until it is accepted, declined or revoked.
CREATE FUNCTION private.enforce_edition_user_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_edition public.organization_edition;
  v_limit INTEGER;
  v_used INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'organization_invitations' THEN
    IF NEW.status <> 'PENDING' OR (TG_OP = 'UPDATE' AND OLD.status = 'PENDING') THEN
      RETURN NEW;
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM public.memberships
    WHERE org_id = NEW.org_id AND user_id = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;

  -- A row lock makes two concurrent invitations count seats one after the other.
  SELECT edition INTO v_edition FROM public.organizations WHERE id = NEW.org_id FOR UPDATE;
  IF v_edition IS NULL OR v_edition = 'business' THEN RETURN NEW; END IF;
  SELECT plan.max_users INTO v_limit
  FROM public.organization_subscriptions AS subscription
  JOIN public.plans AS plan ON plan.id = subscription.plan_id
  WHERE subscription.org_id = NEW.org_id;
  -- Organization creation inserts its owner before the trial subscription.
  IF v_limit IS NULL THEN RETURN NEW; END IF;

  SELECT (SELECT count(*) FROM public.memberships WHERE org_id = NEW.org_id)
       + (SELECT count(*) FROM public.organization_invitations
          WHERE org_id = NEW.org_id AND status = 'PENDING')
  INTO v_used;
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'Plan user limit reached.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.enforce_edition_user_capacity() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER organization_invitations_capacity
  BEFORE INSERT OR UPDATE OF status ON public.organization_invitations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_edition_user_capacity();
CREATE TRIGGER memberships_edition_capacity
  BEFORE INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION private.enforce_edition_user_capacity();
