-- Scale-hardening for the highest-volume read paths. All RPCs run with the
-- caller's privileges and therefore continue to honor the existing RLS policies.

create index if not exists profiles_connect_candidates_active_idx
  on public.profiles (id)
  where is_banned = false and is_private = false;

create index if not exists conversations_user_a_last_message_idx
  on public.conversations (user_a, last_message_at desc, id desc);

create index if not exists conversations_user_b_last_message_idx
  on public.conversations (user_b, last_message_at desc, id desc);

create index if not exists messages_unread_conversation_idx
  on public.messages (conversation_id, sender_id)
  where read_at is null;

create index if not exists notifications_dedupe_lookup_idx
  on public.notifications (user_id, kind, url, created_at desc);

create or replace function public.get_connect_candidates(
  _after_id uuid,
  _limit integer
)
returns table (
  id uuid,
  full_name text,
  avatar_url text,
  major text,
  year_of_study integer,
  bio text,
  interests text[],
  tier public.sub_tier,
  is_banned boolean,
  is_private boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.full_name,
    p.avatar_url,
    p.major,
    p.year_of_study,
    p.bio,
    p.interests,
    p.tier,
    p.is_banned,
    p.is_private
  from public.profiles as p
  where (select auth.uid()) is not null
    and p.id <> (select auth.uid())
    and p.is_banned = false
    and p.is_private = false
    and (_after_id is null or p.id > _after_id)
    and not exists (
      select 1
      from public.swipes as s
      where s.swiper_id = (select auth.uid())
        and s.swipee_id = p.id
    )
    and not public.is_blocked_between((select auth.uid()), p.id)
  order by p.id
  limit least(greatest(coalesce(_limit, 21), 1), 50);
$$;

revoke all on function public.get_connect_candidates(uuid, integer) from public, anon;
grant execute on function public.get_connect_candidates(uuid, integer) to authenticated;

create or replace function public.get_my_conversation_page(
  _before_last_message_at timestamptz,
  _before_id uuid,
  _conversation_id uuid,
  _limit integer
)
returns table (
  id uuid,
  user_a uuid,
  user_b uuid,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint,
  is_mentor boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.user_a,
    c.user_b,
    c.last_message,
    c.last_message_at,
    unread.unread_count,
    exists (
      select 1
      from public.mentors as mentor
      where mentor.user_id = case
        when c.user_a = (select auth.uid()) then c.user_b
        else c.user_a
      end
    ) as is_mentor
  from public.conversations as c
  cross join lateral (
    select count(*)::bigint as unread_count
    from public.messages as m
    where m.conversation_id = c.id
      and m.sender_id <> (select auth.uid())
      and m.read_at is null
  ) as unread
  where (c.user_a = (select auth.uid()) or c.user_b = (select auth.uid()))
    and (_conversation_id is null or c.id = _conversation_id)
    and (
      _before_last_message_at is null
      or (c.last_message_at, c.id) < (_before_last_message_at, _before_id)
    )
  order by c.last_message_at desc, c.id desc
  limit least(greatest(coalesce(_limit, 31), 1), 51);
$$;

revoke all on function public.get_my_conversation_page(timestamptz, uuid, uuid, integer) from public, anon;
grant execute on function public.get_my_conversation_page(timestamptz, uuid, uuid, integer) to authenticated;

create or replace function public.get_post_card_metrics(_post_ids uuid[])
returns table (
  post_id uuid,
  like_count bigint,
  comment_count bigint,
  viewer_liked boolean,
  viewer_reported boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with requested as (
    select distinct input.post_id
    from unnest(coalesce(_post_ids, '{}'::uuid[])) as input(post_id)
    where input.post_id is not null
    limit 100
  ),
  likes as (
    select item.post_id, count(*)::bigint as total
    from public.post_likes as item
    join requested using (post_id)
    group by item.post_id
  ),
  comments as (
    select item.post_id, count(*)::bigint as total
    from public.post_comments as item
    join requested using (post_id)
    group by item.post_id
  )
  select
    requested.post_id,
    coalesce(likes.total, 0),
    coalesce(comments.total, 0),
    exists (
      select 1
      from public.post_likes as own_like
      where own_like.post_id = requested.post_id
        and own_like.user_id = (select auth.uid())
    ),
    exists (
      select 1
      from public.reports as own_report
      where own_report.target_type = 'post'::public.report_target
        and own_report.target_id = requested.post_id
        and own_report.reporter_id = (select auth.uid())
    )
  from requested
  left join likes using (post_id)
  left join comments using (post_id);
$$;

revoke all on function public.get_post_card_metrics(uuid[]) from public, anon;
grant execute on function public.get_post_card_metrics(uuid[]) to authenticated;
