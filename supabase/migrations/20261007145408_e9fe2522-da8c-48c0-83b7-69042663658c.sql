revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon;
revoke execute on function public.conversation_blocked(uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;
grant execute on function public.conversation_blocked(uuid) to authenticated;
revoke execute on function public.handle_block() from public, anon, authenticated;
create policy "no direct access" on public.mku_verification_codes for select to authenticated using (false);