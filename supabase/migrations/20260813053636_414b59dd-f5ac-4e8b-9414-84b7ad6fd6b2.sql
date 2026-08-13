create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null default 'web',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

grant select, insert, update, delete on public.device_tokens to authenticated;
grant all on public.device_tokens to service_role;

alter table public.device_tokens enable row level security;

create policy "own device tokens select" on public.device_tokens
  for select to authenticated using (auth.uid() = user_id);
create policy "own device tokens insert" on public.device_tokens
  for insert to authenticated with check (auth.uid() = user_id);
create policy "own device tokens update" on public.device_tokens
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own device tokens delete" on public.device_tokens
  for delete to authenticated using (auth.uid() = user_id);

create index device_tokens_user_idx on public.device_tokens(user_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'general',
  title text not null,
  body text not null default '',
  url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

grant select, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;

alter table public.notifications enable row level security;

create policy "own notifications select" on public.notifications
  for select to authenticated
  using (auth.uid() = user_id or public.is_super_admin());
create policy "own notifications update" on public.notifications
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own notifications delete" on public.notifications
  for delete to authenticated using (auth.uid() = user_id);

create index notifications_user_created_idx on public.notifications(user_id, created_at desc);

alter publication supabase_realtime add table public.notifications;