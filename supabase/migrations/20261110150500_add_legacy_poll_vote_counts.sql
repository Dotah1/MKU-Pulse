alter table public.poll_options
  add column if not exists legacy_vote_count integer not null default 0;

alter table public.poll_options
  drop constraint if exists poll_options_legacy_vote_count_check;

alter table public.poll_options
  add constraint poll_options_legacy_vote_count_check
  check (legacy_vote_count >= 0);

create or replace function public.poll_vote_counts(_poll uuid)
returns table(option_id uuid, votes bigint)
language sql stable security definer set search_path = public
as $$
  select
    o.id as option_id,
    (o.legacy_vote_count::bigint + count(v.id))::bigint as votes
  from public.poll_options o
  left join public.poll_votes v
    on v.option_id = o.id
   and v.poll_id = _poll
  where o.poll_id = _poll
    and auth.uid() is not null
  group by o.id, o.legacy_vote_count
  order by o.position, o.id;
$$;

revoke all on function public.poll_vote_counts(uuid) from public, anon;
grant execute on function public.poll_vote_counts(uuid) to authenticated;
