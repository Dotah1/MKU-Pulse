-- Enforce the existing tier quotas in Postgres so callers cannot bypass the UI.
-- Per-user/date counters make multi-row inserts and concurrent tabs safe without
-- recounting a user's entire activity history for every post or swipe.

create index if not exists posts_user_created_at_idx
  on public.posts (user_id, created_at desc);

create index if not exists posts_user_video_created_at_idx
  on public.posts (user_id, created_at desc)
  where video_url is not null;

create table if not exists public.daily_user_quotas (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  posts_count integer not null default 0 check (posts_count >= 0),
  videos_count integer not null default 0 check (videos_count >= 0),
  swipes_count integer not null default 0 check (swipes_count >= 0),
  super_likes_count integer not null default 0 check (super_likes_count >= 0),
  primary key (user_id, usage_date)
);

create index if not exists daily_user_quotas_usage_date_idx
  on public.daily_user_quotas (usage_date);

alter table public.daily_user_quotas enable row level security;
revoke all on table public.daily_user_quotas from public, anon, authenticated;
grant all on table public.daily_user_quotas to service_role;

create or replace function public.get_my_daily_quota_usage()
returns table (
  posts_count integer,
  videos_count integer,
  swipes_count integer,
  super_likes_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_usage_date date;
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_usage_date := (v_now at time zone 'Africa/Nairobi')::date;
  v_day_start := v_usage_date::timestamp at time zone 'Africa/Nairobi';
  v_day_end := (v_usage_date + 1)::timestamp at time zone 'Africa/Nairobi';
  perform pg_advisory_xact_lock(hashtext('daily-post-quota'), hashtext(v_user_id::text));
  perform pg_advisory_xact_lock(hashtext('daily-swipe-quota'), hashtext(v_user_id::text));

  insert into public.daily_user_quotas (
    user_id, usage_date, posts_count, videos_count, swipes_count, super_likes_count
  )
  values (
    v_user_id,
    v_usage_date,
    (select count(*)::integer from public.posts p
      where p.user_id = v_user_id and p.created_at >= v_day_start and p.created_at < v_day_end),
    (select count(*)::integer from public.posts p
      where p.user_id = v_user_id and p.video_url is not null
        and p.created_at >= v_day_start and p.created_at < v_day_end),
    (select count(*)::integer from public.swipes s
      where s.swiper_id = v_user_id and s.created_at >= v_day_start and s.created_at < v_day_end),
    (select count(*)::integer from public.swipes s
      where s.swiper_id = v_user_id and s.action = 'super_like'::public.swipe_action
        and s.created_at >= v_day_start and s.created_at < v_day_end)
  )
  on conflict (user_id, usage_date) do nothing;

  return query
  select q.posts_count, q.videos_count, q.swipes_count, q.super_likes_count
  from public.daily_user_quotas q
  where q.user_id = v_user_id and q.usage_date = v_usage_date;
end;
$$;

revoke all on function public.get_my_daily_quota_usage() from public, anon;
grant execute on function public.get_my_daily_quota_usage() to authenticated;

create or replace function public.enforce_daily_post_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_usage_date date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_tier public.sub_tier;
  v_post_limit integer;
  v_video_limit integer;
  v_post_count integer;
  v_video_count integer;
begin
  -- The app's daily usage periods follow the campus's Africa/Nairobi timezone.
  v_usage_date := (v_now at time zone 'Africa/Nairobi')::date;
  v_day_start := v_usage_date::timestamp at time zone 'Africa/Nairobi';
  v_day_end := (v_usage_date + 1)::timestamp at time zone 'Africa/Nairobi';
  -- Do not let clients backdate posts to evade daily quotas.
  new.created_at := v_now;
  v_tier := coalesce(public.effective_tier(new.user_id), 'free'::public.sub_tier);

  perform pg_advisory_xact_lock(hashtext('daily-post-quota'), hashtext(new.user_id::text));

  v_post_limit := case v_tier
    when 'full'::public.sub_tier then 10
    when 'mid'::public.sub_tier then 5
    else 2
  end;
  v_video_limit := case v_tier
    when 'full'::public.sub_tier then 5
    when 'mid'::public.sub_tier then 1
    else 0
  end;

  insert into public.daily_user_quotas (user_id, usage_date, posts_count, videos_count)
  values (
    new.user_id,
    v_usage_date,
    (select count(*)::integer from public.posts p
      where p.user_id = new.user_id and p.created_at >= v_day_start and p.created_at < v_day_end),
    (select count(*)::integer from public.posts p
      where p.user_id = new.user_id and p.video_url is not null
        and p.created_at >= v_day_start and p.created_at < v_day_end)
  )
  on conflict (user_id, usage_date) do nothing;

  update public.daily_user_quotas q
  set posts_count = q.posts_count + 1,
      videos_count = q.videos_count + case when new.video_url is null then 0 else 1 end
  where q.user_id = new.user_id
    and q.usage_date = v_usage_date
    and q.posts_count < v_post_limit
    and (new.video_url is null or q.videos_count < v_video_limit);

  if not found then
    select q.posts_count, q.videos_count into v_post_count, v_video_count
    from public.daily_user_quotas q
    where q.user_id = new.user_id and q.usage_date = v_usage_date;
    if v_post_count >= v_post_limit then
      raise exception 'Daily post limit reached for your plan' using errcode = '23514';
    elsif new.video_url is not null and v_video_limit = 0 then
      raise exception 'Video posts are not available on the free plan' using errcode = '23514';
    else
      raise exception 'Daily video post limit reached for your plan' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_daily_post_limits() from public, anon, authenticated;
drop trigger if exists enforce_daily_post_limits on public.posts;
create trigger enforce_daily_post_limits
before insert on public.posts
for each row execute function public.enforce_daily_post_limits();

create or replace function public.enforce_daily_swipe_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_usage_date date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_tier public.sub_tier;
  v_swipe_limit integer;
  v_super_like_limit integer;
  v_swipe_count integer;
  v_super_like_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.action = 'super_like'::public.swipe_action
      and old.action <> 'super_like'::public.swipe_action then
      raise exception 'Super Likes must be used when creating a swipe' using errcode = '23514';
    end if;
    return new;
  end if;

  v_usage_date := (v_now at time zone 'Africa/Nairobi')::date;
  v_day_start := v_usage_date::timestamp at time zone 'Africa/Nairobi';
  v_day_end := (v_usage_date + 1)::timestamp at time zone 'Africa/Nairobi';
  -- A client-supplied timestamp must not bypass daily limits.
  new.created_at := v_now;
  v_tier := coalesce(public.effective_tier(new.swiper_id), 'free'::public.sub_tier);

  perform pg_advisory_xact_lock(hashtext('daily-swipe-quota'), hashtext(new.swiper_id::text));

  v_swipe_limit := case v_tier
    when 'full'::public.sub_tier then 250
    when 'mid'::public.sub_tier then 100
    else 25
  end;
  v_super_like_limit := case v_tier
    when 'full'::public.sub_tier then 5
    when 'mid'::public.sub_tier then 1
    else 0
  end;

  insert into public.daily_user_quotas (user_id, usage_date, swipes_count, super_likes_count)
  values (
    new.swiper_id,
    v_usage_date,
    (select count(*)::integer from public.swipes s
      where s.swiper_id = new.swiper_id and s.created_at >= v_day_start and s.created_at < v_day_end),
    (select count(*)::integer from public.swipes s
      where s.swiper_id = new.swiper_id and s.action = 'super_like'::public.swipe_action
        and s.created_at >= v_day_start and s.created_at < v_day_end)
  )
  on conflict (user_id, usage_date) do nothing;

  update public.daily_user_quotas q
  set swipes_count = q.swipes_count + 1,
      super_likes_count = q.super_likes_count + case
        when new.action = 'super_like'::public.swipe_action then 1 else 0 end
  where q.user_id = new.swiper_id
    and q.usage_date = v_usage_date
    and q.swipes_count < v_swipe_limit
    and (new.action <> 'super_like'::public.swipe_action or q.super_likes_count < v_super_like_limit);

  if not found then
    select q.swipes_count, q.super_likes_count into v_swipe_count, v_super_like_count
    from public.daily_user_quotas q
    where q.user_id = new.swiper_id and q.usage_date = v_usage_date;
    if v_swipe_count >= v_swipe_limit then
      raise exception 'Daily swipe limit reached for your plan' using errcode = '23514';
    elsif new.action = 'super_like'::public.swipe_action and v_super_like_limit = 0 then
      raise exception 'Super Likes are not available on the free plan' using errcode = '23514';
    else
      raise exception 'Daily Super Like limit reached for your plan' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_daily_swipe_limits() from public, anon, authenticated;
drop trigger if exists enforce_daily_swipe_limits on public.swipes;
create trigger enforce_daily_swipe_limits
before insert or update of action on public.swipes
for each row execute function public.enforce_daily_swipe_limits();

-- Keep only two weeks of internal quota counters; historical content stays untouched.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'cleanup-daily-user-quotas';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'cleanup-daily-user-quotas',
    '20 1 * * *',
    $job$delete from public.daily_user_quotas
      where usage_date < ((now() at time zone 'Africa/Nairobi')::date - 14);$job$
  );
end;
$$;
