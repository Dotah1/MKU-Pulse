-- Purge cleanup now authenticates with Vercel environment secrets.
-- Remove the old Supabase schedules and the database-stored bearer token.
select cron.unschedule('purge-expired-posts');
select cron.unschedule('purge-expired-posts-fallback');

delete from public.app_settings where key = 'post_purge_token';

-- Keep ordinary authenticated users limited to settings intentionally used by the UI.
-- The existing admin policy still lets super admins manage/read all settings.
drop policy if exists "settings readable" on public.app_settings;
create policy "safe settings readable"
  on public.app_settings
  for select
  to authenticated
  using (key in ('free_access_mode', 'feature_toggles', 'payment_info'));
