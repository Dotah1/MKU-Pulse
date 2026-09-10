alter table public.polls add column if not exists image_url text;

alter table public.messages add column if not exists post_id uuid references public.posts(id) on delete set null;

-- Let a member revise a swipe they already made.
drop policy if exists "swipes_update_own" on public.swipes;
create policy "swipes_update_own" on public.swipes
  for update to authenticated
  using (swiper_id = auth.uid())
  with check (swiper_id = auth.uid());

create or replace function public.handle_swipe_match()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare a uuid; b uuid;
begin
  a := least(new.swiper_id, new.swipee_id);
  b := greatest(new.swiper_id, new.swipee_id);
  if new.action in ('like','super_like') then
    if exists (
      select 1 from public.swipes s
      where s.swiper_id = new.swipee_id and s.swipee_id = new.swiper_id
        and s.action in ('like','super_like')
    ) then
      insert into public.matches (user_a, user_b) values (a, b)
        on conflict (user_a, user_b) do update set is_active = true;
      insert into public.conversations (user_a, user_b) values (a, b) on conflict do nothing;
    end if;
  else
    update public.matches set is_active = false where user_a = a and user_b = b;
  end if;
  return new;
end; $$;

drop trigger if exists on_swipe_created on public.swipes;
create trigger on_swipe_created
  after insert or update on public.swipes
  for each row execute function public.handle_swipe_match();

-- Token the scheduled cleanup uses to authenticate against the app endpoint.
insert into public.app_settings (key, value)
values ('post_purge_token', jsonb_build_object('token', gen_random_uuid()::text))
on conflict (key) do nothing;

create extension if not exists pg_net with schema extensions;

select cron.unschedule('delete-expired-posts');

select cron.schedule(
  'purge-expired-posts',
  '7 * * * *',
  $cron$
  select net.http_post(
    url := 'https://project--5c8e481e-7af2-4312-8b1c-7fcd5958c492.lovable.app/api/public/purge-expired-posts',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-purge-token', (select value->>'token' from public.app_settings where key = 'post_purge_token')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

select cron.schedule(
  'purge-expired-posts-fallback',
  '30 3 * * *',
  $cron$ select public.delete_expired_posts(); $cron$
);