-- A church's public giving page.
--
-- One link per Kundi church, made by an owner or admin and shared with the
-- congregation. Outside sign-in it shows the church's paybill (once its C2B
-- link is registered with Safaricom, so gifts post through the giving rules,
-- 20261009000400), the account number to type for each fund (from the
-- church's own EXACT and PREFIX giving rules, and the member-number rule),
-- and its open campaigns with what has been given towards each goal
-- (public.church_campaign_progress, 20261024000300). It names no member and
-- shows no gift.

CREATE TABLE public.church_giving_links (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  token TEXT NOT NULL CHECK (token ~ '^[0-9a-f]{64}$'),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  views INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT church_giving_links_token_key UNIQUE (token)
);
ALTER TABLE public.church_giving_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.church_giving_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.church_giving_links TO service_role;
CREATE TRIGGER church_giving_links_require_church BEFORE INSERT OR UPDATE OF org_id ON public.church_giving_links
  FOR EACH ROW EXECUTE FUNCTION private.require_church_org();

-- The church's link: the one standing, or a new one with p_token.
CREATE FUNCTION public.share_giving_page(p_org_id UUID, p_token TEXT, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_link RECORD;
BEGIN
  PERFORM private.require_org_admin(p_org_id, p_actor);
  SELECT token, created_at, views INTO v_link FROM public.church_giving_links WHERE org_id = p_org_id;
  IF FOUND THEN
    RETURN jsonb_build_object('token', v_link.token, 'createdAt', v_link.created_at, 'views', v_link.views, 'created', false);
  END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'The link token is not valid.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.church_giving_links (org_id, token, created_by) VALUES (p_org_id, p_token, p_actor)
  RETURNING created_at INTO v_link;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'SHARE', 'GIVING_PAGE', p_org_id, '{}'::JSONB);
  RETURN jsonb_build_object('token', p_token, 'createdAt', v_link.created_at, 'views', 0, 'created', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.share_giving_page(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_giving_page(UUID, TEXT, UUID) TO service_role;

-- Withdraws the link; the next share makes a new one.
CREATE FUNCTION public.withdraw_giving_page(p_org_id UUID, p_actor UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM private.require_org_admin(p_org_id, p_actor);
  DELETE FROM public.church_giving_links WHERE org_id = p_org_id;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (p_org_id, p_actor, 'UNSHARE', 'GIVING_PAGE', p_org_id, '{}'::JSONB);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.withdraw_giving_page(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_giving_page(UUID, UUID) TO service_role;

-- What the page shows, counted as a view. Nothing for an unknown link.
CREATE FUNCTION public.open_giving_page(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_org UUID;
  v_paybill TEXT;
  v_ways JSONB;
  v_campaigns JSONB;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT link.org_id INTO v_org FROM public.church_giving_links AS link WHERE link.token = p_token;
  IF v_org IS NULL THEN RETURN NULL; END IF;
  UPDATE public.church_giving_links SET views = views + 1 WHERE org_id = v_org;

  SELECT integration.shortcode INTO v_paybill FROM public.org_integrations AS integration
  WHERE integration.org_id = v_org AND integration.kind = 'MPESA_C2B' AND integration.status = 'REGISTERED'
    AND integration.callback_token_hash IS NOT NULL;

  -- One way per account number (and one for member numbers), the rule
  -- tried first winning, in the order the rules are tried.
  SELECT COALESCE(jsonb_agg(way ORDER BY (way->>'priority')::INTEGER, way->>'fund'), '[]'::JSONB) INTO v_ways
  FROM (
    SELECT DISTINCT ON (CASE WHEN rule.match_type = 'MEMBER_NUMBER' THEN '' ELSE upper(rule.pattern) END)
      jsonb_build_object('fund', fund.name, 'fundCode', fund.code, 'priority', rule.priority,
        'kind', rule.match_type,
        'accountNumber', CASE WHEN rule.match_type = 'MEMBER_NUMBER' THEN NULL ELSE upper(rule.pattern) END) AS way
    FROM public.giving_rules AS rule
    JOIN public.funds AS fund ON fund.org_id = rule.org_id AND fund.id = rule.fund_id
    WHERE rule.org_id = v_org AND rule.is_active AND fund.is_active
    ORDER BY CASE WHEN rule.match_type = 'MEMBER_NUMBER' THEN '' ELSE upper(rule.pattern) END, rule.priority, rule.id
  ) AS ways;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', campaign.name, 'fund', fund.name,
      'goalCents', campaign.goal_cents, 'givenCents', progress.given_cents,
      'startsOn', campaign.starts_on, 'endsOn', campaign.ends_on,
      'accountNumber', (SELECT upper(rule.pattern) FROM public.giving_rules AS rule
        WHERE rule.org_id = v_org AND rule.fund_id = campaign.fund_id AND rule.is_active AND rule.match_type IN ('EXACT', 'PREFIX')
        ORDER BY rule.priority LIMIT 1))
      ORDER BY campaign.starts_on DESC), '[]'::JSONB)
  INTO v_campaigns
  FROM public.church_campaigns AS campaign
  JOIN public.funds AS fund ON fund.org_id = campaign.org_id AND fund.id = campaign.fund_id
  JOIN public.church_campaign_progress(v_org) AS progress ON progress.campaign_id = campaign.id
  WHERE campaign.org_id = v_org AND campaign.status = 'OPEN';

  RETURN jsonb_build_object(
    'church', (SELECT org.name FROM public.organizations AS org WHERE org.id = v_org),
    'currency', (SELECT upper(org.base_currency) FROM public.organizations AS org WHERE org.id = v_org),
    'paybill', v_paybill, 'ways', v_ways, 'campaigns', v_campaigns);
END;
$function$;
REVOKE ALL ON FUNCTION public.open_giving_page(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_giving_page(TEXT) TO service_role;

-- Rollback: DROP FUNCTION public.open_giving_page(TEXT), public.withdraw_giving_page(UUID, UUID),
-- public.share_giving_page(UUID, TEXT, UUID); DROP TABLE public.church_giving_links.
