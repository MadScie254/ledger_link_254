CREATE OR REPLACE FUNCTION public.church_giving_plan_monthly(p_org_id UUID, p_month DATE)
RETURNS TABLE(plan_id UUID, member_id UUID, fund_id UUID, monthly_cents BIGINT, received_cents BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT plan.id, plan.member_id, plan.fund_id, plan.monthly_cents,
    COALESCE((SELECT sum(gift.amount_cents) FROM public.contributions AS gift
      WHERE gift.org_id = p_org_id AND gift.member_id = plan.member_id AND gift.fund_id = plan.fund_id
        AND gift.received_on >= date_trunc('month', p_month)::date
        AND gift.received_on < (date_trunc('month', p_month) + INTERVAL '1 month')::date), 0)::BIGINT
  FROM public.church_giving_plans AS plan
  WHERE plan.org_id = p_org_id
    AND plan.starts_on <= date_trunc('month', p_month)::date
    AND (plan.ends_on IS NULL OR plan.ends_on >= date_trunc('month', p_month)::date);
$function$;
REVOKE ALL ON FUNCTION public.church_giving_plan_monthly(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.church_giving_plan_monthly(UUID, DATE) TO service_role;
