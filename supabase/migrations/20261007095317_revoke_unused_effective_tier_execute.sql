-- effective_tier is not called by the client or any current database policy.
-- Keep it available to trusted server roles, but remove unnecessary API access.
revoke execute on function public.effective_tier(uuid) from authenticated;
