create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  )
$$;

revoke all on function public.handle_new_user() from anon, authenticated;
revoke all on function public.handle_swipe_match() from anon, authenticated;
revoke all on function public.protect_profile_privileges() from anon, authenticated;
revoke all on function public.update_updated_at_column() from anon, authenticated;
revoke all on function public.is_super_admin() from anon;
revoke all on function public.has_role(uuid, public.app_role) from anon;
revoke all on function public.effective_tier(uuid) from anon;
revoke all on function public.in_conversation(uuid, uuid) from anon;