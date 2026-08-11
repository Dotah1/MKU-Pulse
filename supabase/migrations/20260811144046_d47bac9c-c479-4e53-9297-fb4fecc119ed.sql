create policy "read campus media" on storage.objects for select to authenticated
  using (bucket_id in ('avatars','media'));
create policy "upload own campus media" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars','media') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "update own campus media" on storage.objects for update to authenticated
  using (bucket_id in ('avatars','media') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own campus media" on storage.objects for delete to authenticated
  using (bucket_id in ('avatars','media') and (storage.foldername(name))[1] = auth.uid()::text);