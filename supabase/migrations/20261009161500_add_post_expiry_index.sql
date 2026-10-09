-- Supports the scheduled cleanup query filtering and ordering posts by created_at.
create index if not exists posts_created_at_expiry_idx
  on public.posts (created_at);
