-- handle_new_organization is a trigger function, meant to fire only via the AFTER INSERT trigger
-- on organizations — revoking direct EXECUTE doesn't affect trigger firing (Postgres triggers
-- aren't gated by the caller's EXECUTE privilege), it only removes the ability to call it
-- directly via /rest/v1/rpc/handle_new_organization, which nobody should be doing.
REVOKE EXECUTE ON FUNCTION public.handle_new_organization() FROM PUBLIC, anon, authenticated;
