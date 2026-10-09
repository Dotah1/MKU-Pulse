create table public.campus_events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text check (description is null or char_length(description) <= 1500),
  category text not null check (category in ('social', 'academic', 'career', 'sports', 'club', 'other')),
  location text not null check (char_length(btrim(location)) between 2 and 160),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create index campus_events_upcoming_idx on public.campus_events (starts_at);
create index campus_events_creator_created_idx on public.campus_events (creator_id, created_at desc);

alter table public.campus_events enable row level security;

revoke all on table public.campus_events from public, anon, authenticated;
grant select on table public.campus_events to authenticated;
grant all on table public.campus_events to service_role;

create policy "campus events readable by authenticated users"
  on public.campus_events for select to authenticated using (true);

create or replace function public.create_campus_event(
  p_title text,
  p_description text,
  p_category text,
  p_location text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns public.campus_events
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_has_active_paid_plan boolean;
  v_event public.campus_events;
begin
  if v_user_id is null then
    raise exception 'Sign in to create a campus event.' using errcode = '42501';
  end if;

  if p_title is null or char_length(btrim(p_title)) not between 3 and 120 then
    raise exception 'Event title must be between 3 and 120 characters.' using errcode = '22023';
  end if;
  if p_location is null or char_length(btrim(p_location)) not between 2 and 160 then
    raise exception 'Event location must be between 2 and 160 characters.' using errcode = '22023';
  end if;
  if p_description is not null and char_length(p_description) > 1500 then
    raise exception 'Event description must be 1500 characters or fewer.' using errcode = '22023';
  end if;
  if p_category is null or p_category not in ('social', 'academic', 'career', 'sports', 'club', 'other') then
    raise exception 'Choose a valid event category.' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception 'Choose when the event starts.' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'Event end time must be after its start time.' using errcode = '22023';
  end if;

  -- Serialize attempts from this account so simultaneous requests cannot bypass the rolling limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  v_now := pg_catalog.clock_timestamp();

  select
    p.tier in ('mid'::public.sub_tier, 'full'::public.sub_tier)
      and p.tier_expires_at is not null
      and p.tier_expires_at > v_now
      and not p.is_banned
  into v_has_active_paid_plan
  from public.profiles as p
  where p.id = v_user_id;

  if not coalesce(v_has_active_paid_plan, false) then
    raise exception 'Event creation is available to active paid plans only.' using errcode = '42501';
  end if;

  if p_starts_at <= v_now then
    raise exception 'Choose a future event start time.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.campus_events as e
    where e.creator_id = v_user_id
      and e.created_at > v_now - interval '24 hours'
  ) then
    raise exception 'You can create only one event in any 24-hour period.' using errcode = 'P0001';
  end if;

  insert into public.campus_events (
    creator_id,
    title,
    description,
    category,
    location,
    starts_at,
    ends_at,
    created_at
  ) values (
    v_user_id,
    btrim(p_title),
    nullif(btrim(p_description), ''),
    p_category,
    btrim(p_location),
    p_starts_at,
    p_ends_at,
    v_now
  )
  returning * into v_event;

  return v_event;
end;
$function$;

revoke all on function public.create_campus_event(text, text, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.create_campus_event(text, text, text, text, timestamptz, timestamptz) to authenticated;
