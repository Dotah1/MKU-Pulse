alter table public.posts
  add column if not exists is_permanent boolean not null default false;

-- Only admins may create or retain non-expiring posts. Existing posts remain expiring.
drop policy if exists "create own post" on public.posts;
create policy "create own post" on public.posts for insert to authenticated with check (
  auth.uid() = user_id
  and (is_announcement = false or public.is_super_admin())
  and (is_permanent = false or public.is_super_admin())
  and not exists (select 1 from public.profiles where id = auth.uid() and is_banned)
);

drop policy if exists "update own post" on public.posts;
create policy "update own post" on public.posts for update to authenticated
  using (auth.uid() = user_id or public.is_super_admin())
  with check (
    (auth.uid() = user_id and is_permanent = false)
    or public.is_super_admin()
  );

create or replace function public.delete_expired_posts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare removed integer;
begin
  with gone as (
    delete from public.posts
    where created_at < now() - interval '24 hours'
      and is_permanent = false
    returning 1
  )
  select count(*) into removed from gone;
  return removed;
end; $$;

revoke all on function public.delete_expired_posts() from public, anon, authenticated;
