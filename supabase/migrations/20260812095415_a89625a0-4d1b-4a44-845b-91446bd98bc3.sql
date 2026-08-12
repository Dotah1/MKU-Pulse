drop view if exists public.profiles_public;

create table if not exists public.profile_contacts (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  phone text not null default '',
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.profile_contacts to authenticated;
grant all on public.profile_contacts to service_role;

alter table public.profile_contacts enable row level security;

create policy "own or admin contact reads" on public.profile_contacts
  for select to authenticated
  using (auth.uid() = id or public.is_super_admin());
create policy "own contact insert" on public.profile_contacts
  for insert to authenticated
  with check (auth.uid() = id);
create policy "own contact update" on public.profile_contacts
  for update to authenticated
  using (auth.uid() = id or public.is_super_admin())
  with check (auth.uid() = id or public.is_super_admin());

insert into public.profile_contacts (id, email, phone)
  select id, email, phone from public.profiles
  on conflict (id) do nothing;

create trigger profile_contacts_updated
  before update on public.profile_contacts
  for each row execute function public.update_updated_at_column();

alter table public.profiles drop column email, drop column phone;

drop policy if exists "own or admin profile reads" on public.profiles;
create policy "profiles readable by authenticated" on public.profiles
  for select to authenticated using (true);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name, year_of_study, major, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce((new.raw_user_meta_data->>'year_of_study')::int, 1),
    coalesce(new.raw_user_meta_data->>'major',''),
    new.raw_user_meta_data->>'avatar_url'
  ) on conflict (id) do nothing;
  insert into public.profile_contacts (id, email, phone)
  values (new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'phone',''))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'student') on conflict do nothing;
  if lower(coalesce(new.email,'')) = 'odhiambochrishani@gmail.com' then
    insert into public.user_roles (user_id, role) values (new.id, 'admin') on conflict do nothing;
  end if;
  return new;
end; $function$;