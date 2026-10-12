-- Allow users to read only their own daily quota usage row.
create policy "Users can view their own daily quota usage"
  on public.daily_user_quotas
  for select
  to authenticated
  using (auth.uid() = user_id);
