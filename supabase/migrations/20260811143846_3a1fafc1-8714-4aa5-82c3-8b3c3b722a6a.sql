-- ============ ENUMS ============
create type public.app_role as enum ('student','mentor','admin');
create type public.sub_tier as enum ('free','mid','full');
create type public.swipe_action as enum ('like','pass','super_like');
create type public.request_status as enum ('pending','approved','rejected');
create type public.report_target as enum ('post','message','user');

-- ============ HELPERS ============
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'odhiambochrishani@gmail.com', false)
$$;

create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  year_of_study int not null default 1,
  major text not null default '',
  avatar_url text,
  bio text not null default '',
  interests text[] not null default '{}',
  tier public.sub_tier not null default 'free',
  tier_expires_at timestamptz,
  pending_tier public.sub_tier,
  is_banned boolean not null default false,
  notifications_enabled boolean not null default true,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles readable by authenticated" on public.profiles for select to authenticated using (true);
create policy "own profile insert" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update to authenticated using (auth.uid() = id or public.is_super_admin());
create trigger profiles_updated before update on public.profiles for each row execute function public.update_updated_at_column();

-- ============ ROLES ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
create policy "roles readable" on public.user_roles for select to authenticated using (true);
create policy "admin manages roles" on public.user_roles for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- ============ APP SETTINGS ============
create table public.app_settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
grant select on public.app_settings to authenticated;
grant all on public.app_settings to service_role;
alter table public.app_settings enable row level security;
create policy "settings readable" on public.app_settings for select to authenticated using (true);
create policy "admin writes settings" on public.app_settings for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
insert into public.app_settings(key, value) values
  ('free_access_mode', '{"enabled": false}'),
  ('feature_toggles', '{"feed": true, "connect": true, "mentorship": true, "messages": true}'),
  ('payment_info', '{"number": "0712345678", "name": "Campus Connect", "mid_price": 150, "full_price": 300}');

-- effective tier honouring free access mode + expiry
create or replace function public.effective_tier(_user_id uuid)
returns public.sub_tier language sql stable security definer set search_path = public as $$
  select case
    when (select (value->>'enabled')::boolean from public.app_settings where key = 'free_access_mode') then 'full'::public.sub_tier
    when p.tier <> 'free' and (p.tier_expires_at is null or p.tier_expires_at < now()) then 'free'::public.sub_tier
    else p.tier
  end
  from public.profiles p where p.id = _user_id
$$;

-- ============ POSTS ============
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '',
  image_url text,
  video_url text,
  is_announcement boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.posts to authenticated;
grant all on public.posts to service_role;
alter table public.posts enable row level security;
create policy "posts readable" on public.posts for select to authenticated using (true);
create policy "create own post" on public.posts for insert to authenticated with check (
  auth.uid() = user_id
  and (is_announcement = false or public.is_super_admin())
  and not exists (select 1 from public.profiles where id = auth.uid() and is_banned)
);
create policy "update own post" on public.posts for update to authenticated using (auth.uid() = user_id or public.is_super_admin());
create policy "delete own post" on public.posts for delete to authenticated using (auth.uid() = user_id or public.is_super_admin());
create trigger posts_updated before update on public.posts for each row execute function public.update_updated_at_column();

create table public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);
grant select, insert, delete on public.post_likes to authenticated;
grant all on public.post_likes to service_role;
alter table public.post_likes enable row level security;
create policy "likes readable" on public.post_likes for select to authenticated using (true);
create policy "own like" on public.post_likes for insert to authenticated with check (auth.uid() = user_id);
create policy "remove own like" on public.post_likes for delete to authenticated using (auth.uid() = user_id);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.post_comments to authenticated;
grant all on public.post_comments to service_role;
alter table public.post_comments enable row level security;
create policy "comments readable" on public.post_comments for select to authenticated using (true);
create policy "own comment" on public.post_comments for insert to authenticated with check (auth.uid() = user_id);
create policy "delete own comment" on public.post_comments for delete to authenticated using (auth.uid() = user_id or public.is_super_admin());

-- ============ SWIPES / MATCHES ============
create table public.swipes (
  id uuid primary key default gen_random_uuid(),
  swiper_id uuid not null references auth.users(id) on delete cascade,
  swipee_id uuid not null references auth.users(id) on delete cascade,
  action public.swipe_action not null,
  created_at timestamptz not null default now(),
  unique (swiper_id, swipee_id)
);
grant select, insert on public.swipes to authenticated;
grant all on public.swipes to service_role;
alter table public.swipes enable row level security;
create policy "own swipes readable" on public.swipes for select to authenticated using (auth.uid() = swiper_id or auth.uid() = swipee_id);
create policy "create own swipe" on public.swipes for insert to authenticated with check (auth.uid() = swiper_id and swiper_id <> swipee_id);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);
grant select, update on public.matches to authenticated;
grant all on public.matches to service_role;
alter table public.matches enable row level security;
create policy "own matches" on public.matches for select to authenticated using (auth.uid() in (user_a, user_b));
create policy "unmatch own" on public.matches for update to authenticated using (auth.uid() in (user_a, user_b));

-- ============ CONVERSATIONS ============
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  last_message text not null default '',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);
grant select, insert, update on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;
create policy "own conversations" on public.conversations for select to authenticated using (auth.uid() in (user_a, user_b));
create policy "create conversation" on public.conversations for insert to authenticated with check (auth.uid() in (user_a, user_b));
create policy "update own conversation" on public.conversations for update to authenticated using (auth.uid() in (user_a, user_b));

create or replace function public.in_conversation(_conv uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations c where c.id = _conv and _user in (c.user_a, c.user_b))
$$;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy "conversation messages readable" on public.messages for select to authenticated using (public.in_conversation(conversation_id, auth.uid()));
create policy "send message" on public.messages for insert to authenticated with check (
  auth.uid() = sender_id and public.in_conversation(conversation_id, auth.uid())
  and not exists (select 1 from public.profiles where id = auth.uid() and is_banned)
);
create policy "mark read" on public.messages for update to authenticated using (public.in_conversation(conversation_id, auth.uid()));

create table public.typing_state (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
grant select, insert, update, delete on public.typing_state to authenticated;
grant all on public.typing_state to service_role;
alter table public.typing_state enable row level security;
create policy "typing readable" on public.typing_state for select to authenticated using (public.in_conversation(conversation_id, auth.uid()));
create policy "own typing" on public.typing_state for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id and public.in_conversation(conversation_id, auth.uid()));

-- ============ PAYMENTS ============
create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier public.sub_tier not null,
  amount int not null,
  mpesa_code text not null,
  payer_name text not null,
  status public.request_status not null default 'pending',
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.payment_requests to authenticated;
grant all on public.payment_requests to service_role;
alter table public.payment_requests enable row level security;
create policy "own or admin payment reads" on public.payment_requests for select to authenticated using (auth.uid() = user_id or public.is_super_admin());
create policy "submit payment" on public.payment_requests for insert to authenticated with check (auth.uid() = user_id and status = 'pending');
create policy "admin reviews payment" on public.payment_requests for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create trigger payment_requests_updated before update on public.payment_requests for each row execute function public.update_updated_at_column();

-- ============ MENTORS ============
create table public.mentor_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expertise text not null,
  availability text not null,
  experience text not null,
  photo_url text,
  status public.request_status not null default 'pending',
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.mentor_applications to authenticated;
grant all on public.mentor_applications to service_role;
alter table public.mentor_applications enable row level security;
create policy "own or admin application reads" on public.mentor_applications for select to authenticated using (auth.uid() = user_id or public.is_super_admin());
create policy "submit application" on public.mentor_applications for insert to authenticated with check (auth.uid() = user_id and status = 'pending');
create policy "admin reviews application" on public.mentor_applications for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create trigger mentor_applications_updated before update on public.mentor_applications for each row execute function public.update_updated_at_column();

create table public.mentors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expertise text not null default '',
  availability text not null default '',
  experience text not null default '',
  rating numeric(2,1) not null default 5.0,
  rating_count int not null default 0,
  created_at timestamptz not null default now()
);
grant select on public.mentors to authenticated;
grant all on public.mentors to service_role;
alter table public.mentors enable row level security;
create policy "mentors readable" on public.mentors for select to authenticated using (true);
create policy "admin manages mentors" on public.mentors for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

create table public.mentor_sessions (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  scheduled_at timestamptz not null,
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now()
);
grant select, insert, update on public.mentor_sessions to authenticated;
grant all on public.mentor_sessions to service_role;
alter table public.mentor_sessions enable row level security;
create policy "own sessions" on public.mentor_sessions for select to authenticated using (auth.uid() in (mentor_id, student_id) or public.is_super_admin());
create policy "request session" on public.mentor_sessions for insert to authenticated with check (auth.uid() = student_id);
create policy "mentor updates session" on public.mentor_sessions for update to authenticated using (auth.uid() = mentor_id);

-- ============ REPORTS ============
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type public.report_target not null,
  target_id uuid not null,
  reason text not null default '',
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now()
);
grant select, insert, update on public.reports to authenticated;
grant all on public.reports to service_role;
alter table public.reports enable row level security;
create policy "own or admin report reads" on public.reports for select to authenticated using (auth.uid() = reporter_id or public.is_super_admin());
create policy "create report" on public.reports for insert to authenticated with check (auth.uid() = reporter_id);
create policy "admin resolves report" on public.reports for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- ============ PUSH ============
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
alter table public.push_subscriptions enable row level security;
create policy "own push subs" on public.push_subscriptions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ SIGNUP TRIGGER ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone, year_of_study, major, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce(new.email,''),
    coalesce(new.raw_user_meta_data->>'phone',''),
    coalesce((new.raw_user_meta_data->>'year_of_study')::int, 1),
    coalesce(new.raw_user_meta_data->>'major',''),
    new.raw_user_meta_data->>'avatar_url'
  ) on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'student') on conflict do nothing;
  if lower(coalesce(new.email,'')) = 'odhiambochrishani@gmail.com' then
    insert into public.user_roles (user_id, role) values (new.id, 'admin') on conflict do nothing;
  end if;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ============ MATCH TRIGGER ============
create or replace function public.handle_swipe_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare a uuid; b uuid;
begin
  if new.action in ('like','super_like') then
    if exists (select 1 from public.swipes s where s.swiper_id = new.swipee_id and s.swipee_id = new.swiper_id and s.action in ('like','super_like')) then
      a := least(new.swiper_id, new.swipee_id); b := greatest(new.swiper_id, new.swipee_id);
      insert into public.matches (user_a, user_b) values (a, b) on conflict do nothing;
      insert into public.conversations (user_a, user_b) values (a, b) on conflict do nothing;
    end if;
  end if;
  return new;
end; $$;
create trigger on_swipe_created after insert on public.swipes for each row execute function public.handle_swipe_match();

-- ============ REALTIME ============
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.typing_state;
alter publication supabase_realtime add table public.posts;