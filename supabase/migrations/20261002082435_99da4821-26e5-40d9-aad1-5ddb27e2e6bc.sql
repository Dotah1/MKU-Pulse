create table public.campus_crushes (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  compliment_tag text not null,
  is_revealed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (sender_id, recipient_id)
);
grant select on public.campus_crushes to authenticated;
grant all on public.campus_crushes to service_role;
alter table public.campus_crushes enable row level security;
create policy "Senders see their sent compliments" on public.campus_crushes
  for select to authenticated using (auth.uid() = sender_id);
create index campus_crushes_recipient_idx on public.campus_crushes (recipient_id, created_at desc);

create or replace function public.send_compliment(_recipient uuid, _tag text)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mutual boolean; a uuid; b uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if _recipient = me then raise exception 'You cannot compliment yourself'; end if;
  if _tag not in ('Best Dressed in ST Tower','Future First-Class','Library Grinder','Great Energy','Smartest in CATs') then
    raise exception 'Unknown compliment'; end if;
  insert into public.campus_crushes (sender_id, recipient_id, compliment_tag)
    values (me, _recipient, _tag)
    on conflict (sender_id, recipient_id) do update set compliment_tag = excluded.compliment_tag;
  mutual := exists (select 1 from public.campus_crushes where sender_id = _recipient and recipient_id = me);
  if mutual then
    update public.campus_crushes set is_revealed = true
      where (sender_id = me and recipient_id = _recipient) or (sender_id = _recipient and recipient_id = me);
    a := least(me, _recipient); b := greatest(me, _recipient);
    insert into public.conversations (user_a, user_b) values (a, b) on conflict do nothing;
  end if;
  return mutual;
end; $$;

create or replace function public.my_compliments()
returns table (id uuid, compliment_tag text, created_at timestamptz, is_revealed boolean, sender_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id, c.compliment_tag, c.created_at, c.is_revealed,
    case when c.is_revealed then c.sender_id else null end
  from public.campus_crushes c where c.recipient_id = auth.uid()
  order by c.created_at desc limit 100
$$;
revoke execute on function public.send_compliment(uuid, text) from public, anon;
revoke execute on function public.my_compliments() from public, anon;
grant execute on function public.send_compliment(uuid, text) to authenticated;
grant execute on function public.my_compliments() to authenticated;

alter table public.profiles add column streak_count integer not null default 0,
  add column last_active_on date;

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_super_admin() then return new; end if;
  new.tier := old.tier;
  new.tier_expires_at := old.tier_expires_at;
  new.pending_tier := old.pending_tier;
  new.is_banned := old.is_banned;
  new.post_block_until := old.post_block_until;
  if coalesce(current_setting('app.streak_update', true), '') <> '1' then
    new.streak_count := old.streak_count;
    new.last_active_on := old.last_active_on;
  end if;
  return new;
end; $$;

create or replace function public.check_in_streak(_today date)
returns integer language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cur int; last date; nxt int;
begin
  if me is null then return 0; end if;
  -- accept the user's local date only within a day of server time
  if _today is null or abs(_today - (now() at time zone 'Africa/Nairobi')::date) > 1 then
    _today := (now() at time zone 'Africa/Nairobi')::date; end if;
  select streak_count, last_active_on into cur, last from public.profiles where id = me;
  if last = _today then return cur; end if;
  if last is not null and _today < last then return cur; end if;
  nxt := case when last = _today - 1 then cur + 1 else 1 end;
  perform set_config('app.streak_update', '1', true);
  update public.profiles set streak_count = nxt, last_active_on = _today where id = me;
  perform set_config('app.streak_update', '', true);
  return nxt;
end; $$;
revoke execute on function public.check_in_streak(date) from public, anon;
grant execute on function public.check_in_streak(date) to authenticated;