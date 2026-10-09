-- Store controlled, multi-select mentorship areas without changing existing mentor relationships.
alter table public.mentor_applications
  add column if not exists mentorship_areas text[] not null default '{}';

alter table public.mentors
  add column if not exists mentorship_areas text[] not null default '{}';

create index if not exists mentors_mentorship_areas_gin_idx
  on public.mentors using gin (mentorship_areas);
