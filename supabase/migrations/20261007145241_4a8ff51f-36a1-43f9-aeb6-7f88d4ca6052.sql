create table public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
grant select, insert, delete on public.blocked_users to authenticated;
grant all on public.blocked_users to service_role;
alter table public.blocked_users enable row level security;
create policy "own blocks readable" on public.blocked_users for select to authenticated using (auth.uid() = blocker_id or public.is_super_admin());
create policy "create own block" on public.blocked_users for insert to authenticated with check (auth.uid() = blocker_id);
create policy "remove own block" on public.blocked_users for delete to authenticated using (auth.uid() = blocker_id);
create index blocked_users_blocked_idx on public.blocked_users (blocked_id);

create or replace function public.is_blocked_between(_a uuid, _b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocked_users
    where (blocker_id = _a and blocked_id = _b) or (blocker_id = _b and blocked_id = _a))
$$;

create or replace function public.blocked_user_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select blocked_id from public.blocked_users where blocker_id = auth.uid()
  union select blocker_id from public.blocked_users where blocked_id = auth.uid()
$$;
revoke execute on function public.blocked_user_ids() from public, anon;
grant execute on function public.blocked_user_ids() to authenticated;

create or replace function public.conversation_blocked(_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations c
    where c.id = _conv and public.is_blocked_between(c.user_a, c.user_b))
$$;

drop policy if exists "send message" on public.messages;
create policy "send message" on public.messages for insert to authenticated with check (
  auth.uid() = sender_id and public.in_conversation(conversation_id, auth.uid())
  and not exists (select 1 from public.profiles where id = auth.uid() and is_banned)
  and not public.conversation_blocked(conversation_id)
);

drop policy if exists "create conversation" on public.conversations;
create policy "create conversation" on public.conversations for insert to authenticated with check (
  auth.uid() in (user_a, user_b) and not public.is_blocked_between(user_a, user_b)
);

drop policy if exists "create own swipe" on public.swipes;
create policy "create own swipe" on public.swipes for insert to authenticated with check (
  auth.uid() = swiper_id and swiper_id <> swipee_id and not public.is_blocked_between(swiper_id, swipee_id)
);

-- Blocking ends any match between the two users.
create or replace function public.handle_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.matches set is_active = false
    where user_a = least(new.blocker_id, new.blocked_id) and user_b = greatest(new.blocker_id, new.blocked_id);
  return new;
end; $$;
create trigger on_user_blocked after insert on public.blocked_users for each row execute function public.handle_block();

-- MKU verification
alter table public.profiles add column if not exists mku_verified boolean not null default false;
alter table public.profile_contacts add column if not exists mku_email text;

create or replace function public.protect_profile_privileges()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if public.is_super_admin() then return new; end if;
  new.tier := old.tier;
  new.tier_expires_at := old.tier_expires_at;
  new.pending_tier := old.pending_tier;
  new.is_banned := old.is_banned;
  new.post_block_until := old.post_block_until;
  if coalesce(current_setting('app.mku_verify', true), '') <> '1' then
    new.mku_verified := old.mku_verified;
  end if;
  if coalesce(current_setting('app.streak_update', true), '') <> '1' then
    new.streak_count := old.streak_count;
    new.last_active_on := old.last_active_on;
  end if;
  return new;
end; $function$;

create table public.mku_verification_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
grant all on public.mku_verification_codes to service_role;
alter table public.mku_verification_codes enable row level security;

-- Only the server (service role) calls this after checking the code.
create or replace function public.mark_mku_verified(_user uuid, _email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.mku_verify', '1', true);
  update public.profiles set mku_verified = true where id = _user;
  perform set_config('app.mku_verify', '', true);
  update public.profile_contacts set mku_email = _email where id = _user;
  delete from public.mku_verification_codes where user_id = _user;
end; $$;
revoke execute on function public.mark_mku_verified(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_mku_verified(uuid, text) to service_role;