-- Keep admin writes separate from ordinary reads so Supabase evaluates fewer
-- permissive policies for each SELECT query.
drop policy if exists "admin writes settings" on public.app_settings;
drop policy if exists "safe settings readable" on public.app_settings;
create policy "safe settings readable"
  on public.app_settings
  for select
  to authenticated
  using (
    key in ('free_access_mode', 'feature_toggles', 'payment_info')
    or (select public.is_super_admin())
  );
create policy "admin inserts settings"
  on public.app_settings
  for insert
  to authenticated
  with check ((select public.is_super_admin()));
create policy "admin updates settings"
  on public.app_settings
  for update
  to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));
create policy "admin deletes settings"
  on public.app_settings
  for delete
  to authenticated
  using ((select public.is_super_admin()));

-- The public SELECT policy already covers mentors, so admin management only
-- needs write policies.
drop policy if exists "admin manages mentors" on public.mentors;
create policy "admin inserts mentors"
  on public.mentors
  for insert
  to authenticated
  with check ((select public.is_super_admin()));
create policy "admin updates mentors"
  on public.mentors
  for update
  to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));
create policy "admin deletes mentors"
  on public.mentors
  for delete
  to authenticated
  using ((select public.is_super_admin()));

-- Conversation participants can use the existing SELECT policy; this policy
-- set only governs typing-state writes.
drop policy if exists "own typing" on public.typing_state;
create policy "own typing inserts"
  on public.typing_state
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (select public.in_conversation(conversation_id, (select auth.uid())))
  );
create policy "own typing updates"
  on public.typing_state
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (select public.in_conversation(conversation_id, (select auth.uid())))
  );
create policy "own typing deletes"
  on public.typing_state
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- The existing SELECT policy already permits a user to read their own role;
-- admin management only needs write policies.
drop policy if exists "admin manages roles" on public.user_roles;
create policy "admin inserts roles"
  on public.user_roles
  for insert
  to authenticated
  with check ((select public.is_super_admin()));
create policy "admin updates roles"
  on public.user_roles
  for update
  to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));
create policy "admin deletes roles"
  on public.user_roles
  for delete
  to authenticated
  using ((select public.is_super_admin()));
