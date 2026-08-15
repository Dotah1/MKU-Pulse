do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_gender') then
    create type public.user_gender as enum ('male','female');
  end if;
end $$;

alter table public.profiles add column if not exists gender public.user_gender;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name, year_of_study, major, avatar_url, gender)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce((new.raw_user_meta_data->>'year_of_study')::int, 1),
    coalesce(new.raw_user_meta_data->>'major',''),
    new.raw_user_meta_data->>'avatar_url',
    case when new.raw_user_meta_data->>'gender' in ('male','female')
      then (new.raw_user_meta_data->>'gender')::public.user_gender else null end
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

create or replace function public.delete_expired_posts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare removed integer;
begin
  with gone as (
    delete from public.posts where created_at < now() - interval '24 hours' returning 1
  )
  select count(*) into removed from gone;
  return removed;
end; $$;

revoke all on function public.delete_expired_posts() from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'delete-expired-posts') then
    perform cron.unschedule('delete-expired-posts');
  end if;
  perform cron.schedule('delete-expired-posts', '*/15 * * * *', $cmd$select public.delete_expired_posts();$cmd$);
end $$;