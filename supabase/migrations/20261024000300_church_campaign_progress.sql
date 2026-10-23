-- A campaign and its pledges read posted giving; they do not create receivables.
CREATE OR REPLACE FUNCTION public.church_campaign_progress(p_org_id UUID)
RETURNS TABLE(campaign_id UUID, given_cents BIGINT, pledged_cents BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT campaign.id,
    COALESCE((SELECT sum(gift.amount_cents) FROM public.contributions AS gift
      WHERE gift.org_id = p_org_id AND gift.fund_id = campaign.fund_id
        AND gift.received_on BETWEEN campaign.starts_on AND COALESCE(campaign.ends_on, CURRENT_DATE)), 0)::BIGINT,
    COALESCE((SELECT sum(pledge.pledged_cents) FROM public.church_pledges AS pledge
      WHERE pledge.org_id = p_org_id AND pledge.campaign_id = campaign.id AND pledge.status = 'ACTIVE'), 0)::BIGINT
  FROM public.church_campaigns AS campaign WHERE campaign.org_id = p_org_id;
$function$;

CREATE OR REPLACE FUNCTION public.church_pledge_progress(p_org_id UUID)
RETURNS TABLE(pledge_id UUID, campaign_id UUID, member_id UUID, pledged_cents BIGINT, received_cents BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT pledge.id, pledge.campaign_id, pledge.member_id, pledge.pledged_cents,
    COALESCE((SELECT sum(gift.amount_cents) FROM public.contributions AS gift
      WHERE gift.org_id = p_org_id AND gift.member_id = pledge.member_id AND gift.fund_id = campaign.fund_id
        AND gift.received_on BETWEEN GREATEST(pledge.pledged_on, campaign.starts_on)
          AND COALESCE(campaign.ends_on, CURRENT_DATE)), 0)::BIGINT
  FROM public.church_pledges AS pledge
  JOIN public.church_campaigns AS campaign ON campaign.org_id = pledge.org_id AND campaign.id = pledge.campaign_id
  WHERE pledge.org_id = p_org_id;
$function$;

REVOKE ALL ON FUNCTION public.church_campaign_progress(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.church_campaign_progress(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.church_pledge_progress(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.church_pledge_progress(UUID) TO service_role;
