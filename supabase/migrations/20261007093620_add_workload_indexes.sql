-- Workload-aligned indexes for bounded list queries and feed ordering.
create index if not exists posts_feed_order_idx
  on public.posts (is_announcement desc, created_at desc, id desc);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc, id desc);

create index if not exists post_comments_post_created_idx
  on public.post_comments (post_id, created_at desc, id desc);

create index if not exists mentor_sessions_mentor_created_idx
  on public.mentor_sessions (mentor_id, created_at desc, id desc);

create index if not exists swipes_swiper_created_idx
  on public.swipes (swiper_id, created_at desc, id desc);
