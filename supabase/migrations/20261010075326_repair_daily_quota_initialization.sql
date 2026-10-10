-- Ensure the first post or swipe of each local day initializes all counter types.
-- This prevents pre-existing same-day activity in the other category from being missed.

create or replace function public.initialize_daily_user_quota_row(_user_id uuid, _usage_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz := _usage_date::timestamp at time zone 'Africa/Nairobi';
  v_day_end timestamptz := (_usage_date + 1)::timestamp at time zone 'Africa/Nairobi';
begin
  if exists (
    select 1 from public.daily_user_quotas q
    where q.user_id = _user_id and q.usage_date = _usage_date
  ) then
    return;
  end if;

  insert into public.daily_user_quotas (
    user_id, usage_date, posts_count, videos_count, swipes_count, super_likes_count
  )
  values (
    _user_id,
    _usage_date,
    (select count(*)::integer from public.posts p
      where p.user_id = _user_id and p.created_at >= v_day_start and p.created_at < v_day_end),
    (select count(*)::integer from public.posts p
      where p.user_id = _user_id and p.video_url is not null
        and p.created_at >= v_day_start and p.created_at < v_day_end),
    (select count(*)::integer from public.swipes s
      where s.swiper_id = _user_id and s.created_at >= v_day_start and s.created_at < v_day_end),
    (select count(*)::integer from public.swipes s
      where s.swiper_id = _user_id and s.action = 'super_like'::public.swipe_action
        and s.created_at >= v_day_start and s.created_at < v_day_end)
  )
  on conflict (user_id, usage_date) do nothing;
end;
$$;

revoke all on function public.initialize_daily_user_quota_row(uuid, date) from public, anon, authenticated;

create or replace function public.enforce_daily_post_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_usage_date date;
  v_tier public.sub_tier;
  v_post_limit integer;
  v_video_limit integer;
  v_post_count integer;
  v_video_count integer;
begin
  v_usage_date := (v_now at time zone 'Africa/Nairobi')::date;
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

  perform public.initialize_daily_user_quota_row(new.user_id, v_usage_date);

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

create or replace function public.enforce_daily_swipe_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_usage_date date;
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

  perform public.initialize_daily_user_quota_row(new.swiper_id, v_usage_date);

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

-- Repair rows created between the initial migration and this correction. Keep
-- higher counter values so deletes or action edits never restore used quota.
update public.daily_user_quotas q
set posts_count = greatest(q.posts_count, (
      select count(*)::integer from public.posts p
      where p.user_id = q.user_id
        and p.created_at >= q.usage_date::timestamp at time zone 'Africa/Nairobi'
        and p.created_at < (q.usage_date + 1)::timestamp at time zone 'Africa/Nairobi'
    )),
    videos_count = greatest(q.videos_count, (
      select count(*)::integer from public.posts p
      where p.user_id = q.user_id and p.video_url is not null
        and p.created_at >= q.usage_date::timestamp at time zone 'Africa/Nairobi'
        and p.created_at < (q.usage_date + 1)::timestamp at time zone 'Africa/Nairobi'
    )),
    swipes_count = greatest(q.swipes_count, (
      select count(*)::integer from public.swipes s
      where s.swiper_id = q.user_id
        and s.created_at >= q.usage_date::timestamp at time zone 'Africa/Nairobi'
        and s.created_at < (q.usage_date + 1)::timestamp at time zone 'Africa/Nairobi'
    )),
    super_likes_count = greatest(q.super_likes_count, (
      select count(*)::integer from public.swipes s
      where s.swiper_id = q.user_id and s.action = 'super_like'::public.swipe_action
        and s.created_at >= q.usage_date::timestamp at time zone 'Africa/Nairobi'
        and s.created_at < (q.usage_date + 1)::timestamp at time zone 'Africa/Nairobi'
    ));
