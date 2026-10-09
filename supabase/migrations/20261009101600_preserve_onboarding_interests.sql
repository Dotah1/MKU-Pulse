create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name, year_of_study, major, avatar_url, gender, interests)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce((new.raw_user_meta_data->>'year_of_study')::int, 1),
    coalesce(new.raw_user_meta_data->>'major',''),
    new.raw_user_meta_data->>'avatar_url',
    case when new.raw_user_meta_data->>'gender' in ('male','female')
      then (new.raw_user_meta_data->>'gender')::public.user_gender else null end,
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(
        coalesce(new.raw_user_meta_data->'interests', '[]'::jsonb)
      ) as value),
      '{}'::text[]
    )
  ) on conflict (id) do nothing;
  insert into public.profile_contacts (id, email, phone)
  values (new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'phone',''))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'student') on conflict do nothing;
  if lower(coalesce(new.email,'')) = 'odhiambochrishani@gmail.com' then
    insert into public.user_roles (user_id, role) values (new.id, 'admin') on conflict do nothing;
  end if;
  return new;
end; $function$;
