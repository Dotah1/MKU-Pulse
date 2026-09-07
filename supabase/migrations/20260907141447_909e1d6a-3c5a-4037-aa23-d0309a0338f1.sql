alter table public.post_comments add column if not exists parent_id uuid references public.post_comments(id) on delete cascade;
create index if not exists post_comments_parent_idx on public.post_comments(parent_id);

alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;

alter table public.posts add column if not exists video_seconds integer;

alter table public.profiles add column if not exists post_block_until timestamptz;

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if public.is_super_admin() then
    return new;
  end if;
  new.tier := old.tier;
  new.tier_expires_at := old.tier_expires_at;
  new.pending_tier := old.pending_tier;
  new.is_banned := old.is_banned;
  new.post_block_until := old.post_block_until;
  return new;
end; $$;

drop policy if exists "create own post" on public.posts;
create policy "create own post" on public.posts for insert to authenticated
with check (
  auth.uid() = user_id
  and (is_announcement = false or public.is_super_admin())
  and not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.is_banned or (p.post_block_until is not null and p.post_block_until > now()))
  )
);

create or replace function public.effective_tier(_user_id uuid)
returns sub_tier language sql stable security definer set search_path to 'public' as $$
  select case
    when p.tier <> 'free' and (p.tier_expires_at is null or p.tier_expires_at < now())
      then case when (select (value->>'enabled')::boolean from public.app_settings where key = 'free_access_mode')
        then 'mid'::public.sub_tier else 'free'::public.sub_tier end
    when p.tier = 'free' and (select (value->>'enabled')::boolean from public.app_settings where key = 'free_access_mode')
      then 'mid'::public.sub_tier
    else p.tier
  end
  from public.profiles p where p.id = _user_id
$$;

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.polls to authenticated;
grant all on public.polls to service_role;
alter table public.polls enable row level security;
create policy "polls readable" on public.polls for select to authenticated using (true);
create policy "admin creates polls" on public.polls for insert to authenticated with check (public.is_super_admin());
create policy "admin updates polls" on public.polls for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy "admin deletes polls" on public.polls for delete to authenticated using (public.is_super_admin());
create trigger polls_updated before update on public.polls for each row execute function public.update_updated_at_column();

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists poll_options_poll_idx on public.poll_options(poll_id);
grant select, insert, update, delete on public.poll_options to authenticated;
grant all on public.poll_options to service_role;
alter table public.poll_options enable row level security;
create policy "poll options readable" on public.poll_options for select to authenticated using (true);
create policy "admin creates poll options" on public.poll_options for insert to authenticated with check (public.is_super_admin());
create policy "admin updates poll options" on public.poll_options for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy "admin deletes poll options" on public.poll_options for delete to authenticated using (public.is_super_admin());

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (poll_id, user_id)
);
create index if not exists poll_votes_poll_idx on public.poll_votes(poll_id);
grant select, insert, update, delete on public.poll_votes to authenticated;
grant all on public.poll_votes to service_role;
alter table public.poll_votes enable row level security;
create policy "poll votes readable" on public.poll_votes for select to authenticated using (true);
create policy "cast own vote" on public.poll_votes for insert to authenticated with check (auth.uid() = user_id);
create policy "change own vote" on public.poll_votes for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "remove own vote" on public.poll_votes for delete to authenticated using (auth.uid() = user_id or public.is_super_admin());

alter publication supabase_realtime add table public.poll_votes;
alter publication supabase_realtime add table public.polls;