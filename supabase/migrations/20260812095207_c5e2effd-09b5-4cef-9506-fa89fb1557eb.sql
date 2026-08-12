-- 1. Profiles: hide contact data from other users
drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "own or admin profile reads" on public.profiles
  for select to authenticated
  using (auth.uid() = id or public.is_super_admin());

create or replace view public.profiles_public as
  select id, full_name, avatar_url, bio, interests, major, year_of_study,
         tier, is_private, is_banned, created_at
  from public.profiles;

grant select on public.profiles_public to authenticated;

-- 2. Prevent self-escalation of privileged columns
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_super_admin() then
    return new;
  end if;
  new.tier := old.tier;
  new.tier_expires_at := old.tier_expires_at;
  new.pending_tier := old.pending_tier;
  new.is_banned := old.is_banned;
  return new;
end; $$;

drop trigger if exists profiles_protect_privileges on public.profiles;
create trigger profiles_protect_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- 3. Roles visible only to owner or admin
drop policy if exists "roles readable" on public.user_roles;
create policy "own or admin role reads" on public.user_roles
  for select to authenticated
  using (auth.uid() = user_id or public.is_super_admin());

-- 4. Owners can delete their pending mentor application
create policy "delete own pending application" on public.mentor_applications
  for delete to authenticated
  using (auth.uid() = user_id and status = 'pending');

-- 5. Revoke execute on internal helper functions from API roles
revoke execute on function public.effective_tier(uuid) from anon, authenticated;
revoke execute on function public.has_role(uuid, public.app_role) from anon, authenticated;
revoke execute on function public.in_conversation(uuid, uuid) from anon, authenticated;
revoke execute on function public.is_super_admin() from anon, authenticated;
revoke execute on function public.protect_profile_privileges() from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.handle_swipe_match() from anon, authenticated;
revoke execute on function public.update_updated_at_column() from anon, authenticated;