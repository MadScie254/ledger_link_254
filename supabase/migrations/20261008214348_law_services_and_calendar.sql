-- Matter numbers are issued in the same transaction as the record, so a
-- rejected opening cannot consume a number or leave an unnumbered matter.
CREATE FUNCTION public.create_law_matter(p_org_id UUID,p_details JSONB,p_created_by UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_id UUID; v_number INTEGER; v_opened DATE;
BEGIN
  PERFORM private.require_financial_actor(p_org_id,p_created_by);
  IF NOT EXISTS (SELECT 1 FROM public.organizations
      WHERE id=p_org_id AND edition='law') THEN
    RAISE EXCEPTION 'Matters belong to law organizations.' USING ERRCODE='23514';
  END IF;
  IF NULLIF(btrim(p_details->>'title'),'') IS NULL
    OR NULLIF(p_details->>'clientId','') IS NULL THEN
    RAISE EXCEPTION 'A matter title and client are required.' USING ERRCODE='22023';
  END IF;
  v_opened := COALESCE((p_details->>'openedOn')::DATE,CURRENT_DATE);
  v_number := private.next_document_number(p_org_id,'MATTER');
  INSERT INTO public.matters(org_id,matter_number,title,client_id,practice_area,
    matter_type,stage,status,responsible_user_id,court,court_station,case_number,
    judicial_officer,billing_method,default_rate_cents,fixed_fee_cents,opened_on,
    notes,created_by)
  VALUES(p_org_id,'MAT-' || extract(year from v_opened)::TEXT || '-' || lpad(v_number::TEXT,4,'0'),
    btrim(p_details->>'title'),(p_details->>'clientId')::UUID,
    p_details->>'practiceArea',COALESCE(p_details->>'matterType','OTHER'),
    p_details->>'stage','OPEN',(p_details->>'responsibleUserId')::UUID,
    p_details->>'court',p_details->>'courtStation',p_details->>'caseNumber',
    p_details->>'judicialOfficer',p_details->>'billingMethod',
    (p_details->>'defaultRateCents')::BIGINT,(p_details->>'fixedFeeCents')::BIGINT,
    v_opened,p_details->>'notes',p_created_by)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(org_id,user_id,action,resource_type,resource_id,details)
  VALUES(p_org_id,p_created_by,'CREATE','MATTER',v_id,
    jsonb_build_object('matterNumber',
      'MAT-' || extract(year from v_opened)::TEXT || '-' || lpad(v_number::TEXT,4,'0')));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_law_matter(UUID,JSONB,UUID)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_law_matter(UUID,JSONB,UUID) TO service_role;

-- Similarity and literal substring searches cover spelling variations and
-- short exact names. Every result stays within the requesting organization.
CREATE INDEX customers_name_trgm ON public.customers
  USING gin (lower(display_name) extensions.gin_trgm_ops);
CREATE FUNCTION public.search_matter_conflicts(p_org_id UUID,p_query TEXT)
RETURNS TABLE(source TEXT,name TEXT,matter_id UUID,matter_number TEXT,score REAL)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT hit.source,hit.name,hit.matter_id,hit.matter_number,hit.score
  FROM (
    SELECT 'PARTY'::TEXT AS source,party.name,matter.id AS matter_id,
      matter.matter_number,extensions.similarity(lower(party.name),lower(btrim(p_query))) AS score
    FROM public.matter_parties AS party
    JOIN public.matters AS matter ON matter.org_id=party.org_id AND matter.id=party.matter_id
    WHERE party.org_id=p_org_id AND length(btrim(COALESCE(p_query,'')))>=3
      AND (extensions.similarity(lower(party.name),lower(btrim(p_query)))>=0.2
        OR position(lower(btrim(p_query)) in lower(party.name))>0)
    UNION ALL
    SELECT 'CUSTOMER'::TEXT,customer.display_name,matter.id,matter.matter_number,
      extensions.similarity(lower(customer.display_name),lower(btrim(p_query)))
    FROM public.customers AS customer
    LEFT JOIN public.matters AS matter ON matter.org_id=customer.org_id
      AND matter.client_id=customer.id
    WHERE customer.org_id=p_org_id AND length(btrim(COALESCE(p_query,'')))>=3
      AND (extensions.similarity(lower(customer.display_name),lower(btrim(p_query)))>=0.2
        OR position(lower(btrim(p_query)) in lower(customer.display_name))>0)
  ) AS hit ORDER BY hit.score DESC,hit.name LIMIT 30;
$function$;
REVOKE ALL ON FUNCTION public.search_matter_conflicts(UUID,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_matter_conflicts(UUID,TEXT) TO service_role;

CREATE FUNCTION private.validate_court_outcome() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NULLIF(btrim(NEW.outcome),'') IS NOT NULL
    AND NEW.next_event_id IS NULL AND NOT NEW.no_further_date THEN
    RAISE EXCEPTION 'Record the next court date or choose no further date with the outcome.'
      USING ERRCODE='23514';
  END IF;
  IF NEW.next_event_id IS NOT NULL AND (
    NEW.next_event_id=NEW.id OR NOT EXISTS (
      SELECT 1 FROM public.court_events AS next_event
      WHERE next_event.org_id=NEW.org_id AND next_event.id=NEW.next_event_id
        AND next_event.matter_id=NEW.matter_id)) THEN
    RAISE EXCEPTION 'The next court event must belong to the same matter.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.validate_court_outcome()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER court_events_validate_outcome BEFORE INSERT OR UPDATE ON public.court_events
  FOR EACH ROW EXECUTE FUNCTION private.validate_court_outcome();

-- Only a SHA-256 hash is stored. A token is rotated by replacing this row;
-- removing a member cascades away the feed credential.
CREATE TABLE public.calendar_tokens (
  org_id UUID NOT NULL,
  user_id UUID NOT NULL,
  token_hash TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,user_id),
  UNIQUE (token_hash),
  FOREIGN KEY (org_id,user_id) REFERENCES public.memberships(org_id,user_id)
    ON DELETE CASCADE
);
ALTER TABLE public.calendar_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_tokens FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.calendar_tokens TO service_role;
GRANT SELECT ON public.calendar_tokens TO authenticated;
CREATE POLICY calendar_tokens_owner_read ON public.calendar_tokens FOR SELECT TO authenticated
  USING (user_id=(SELECT auth.uid()) AND (SELECT public.user_has_org_access(org_id)));
