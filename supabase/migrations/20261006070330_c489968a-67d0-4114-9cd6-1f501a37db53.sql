DROP POLICY IF EXISTS "poll votes readable" ON public.poll_votes;
CREATE POLICY "own poll votes readable" ON public.poll_votes FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.poll_vote_counts(_poll uuid)
RETURNS TABLE(option_id uuid, votes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  select v.option_id, count(*) from public.poll_votes v
  where v.poll_id = _poll and auth.uid() is not null
  group by v.option_id
$$;
REVOKE ALL ON FUNCTION public.poll_vote_counts(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.poll_vote_counts(uuid) TO authenticated;