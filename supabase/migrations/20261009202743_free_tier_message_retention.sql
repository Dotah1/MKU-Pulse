-- Remove old chat rows only after both participants are effectively on free.
-- Active paid plans preserve shared history; after the last paid plan expires,
-- the conversation receives a 30-day grace period before the 90-day window applies.

create index if not exists messages_retention_created_at_id_idx
  on public.messages (created_at, id);

create or replace function public.purge_expired_free_messages(_batch_size integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_cutoff timestamptz := statement_timestamp() - interval '90 days';
  v_removed integer := 0;
begin
  with candidate_messages as materialized (
    select m.id, m.conversation_id
    from public.messages as m
    join public.conversations as c on c.id = m.conversation_id
    join public.profiles as participant_a on participant_a.id = c.user_a
    join public.profiles as participant_b on participant_b.id = c.user_b
    where m.created_at < v_cutoff
      and not (
        (participant_a.tier <> 'free'::public.sub_tier and participant_a.tier_expires_at > v_now)
        or (participant_b.tier <> 'free'::public.sub_tier and participant_b.tier_expires_at > v_now)
      )
      and not (
        (participant_a.tier <> 'free'::public.sub_tier and participant_a.tier_expires_at is null)
        or (participant_b.tier <> 'free'::public.sub_tier and participant_b.tier_expires_at is null)
      )
      and (
        (
          participant_a.tier = 'free'::public.sub_tier
          and participant_b.tier = 'free'::public.sub_tier
        )
        or greatest(
          case when participant_a.tier <> 'free'::public.sub_tier then participant_a.tier_expires_at end,
          case when participant_b.tier <> 'free'::public.sub_tier then participant_b.tier_expires_at end
        ) <= v_now - interval '30 days'
      )
      and not exists (
        select 1
        from public.reports as r
        where r.target_type = 'message'::public.report_target
          and r.target_id = m.id
          and r.status in ('pending'::public.request_status, 'approved'::public.request_status)
      )
    order by m.created_at, m.id
    limit least(greatest(coalesce(_batch_size, 1000), 1), 5000)
    for update of m skip locked
  ),
  deleted_messages as (
    delete from public.messages as m
    using candidate_messages as candidate
    where m.id = candidate.id
    returning m.conversation_id
  ),
  affected_conversations as (
    select distinct conversation_id
    from deleted_messages
  ),
  refreshed_summaries as (
    update public.conversations as c
    set last_message = coalesce(latest.content, ''),
        last_message_at = coalesce(latest.created_at, c.created_at)
    from affected_conversations as affected
    left join lateral (
      select remaining.content, remaining.created_at
      from public.messages as remaining
      where remaining.conversation_id = affected.conversation_id
      order by remaining.created_at desc, remaining.id desc
      limit 1
    ) as latest on true
    where c.id = affected.conversation_id
      and c.last_message_at < v_cutoff
    returning c.id
  )
  select count(*)::integer into v_removed
  from deleted_messages;

  return v_removed;
end;
$$;

revoke all on function public.purge_expired_free_messages(integer)
  from public, anon, authenticated, service_role;

-- Small, lock-aware batches run frequently so a large backlog is drained gradually.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-expired-free-messages') then
    perform cron.unschedule('purge-expired-free-messages');
  end if;
  perform cron.schedule(
    'purge-expired-free-messages',
    '*/15 * * * *',
    'select public.purge_expired_free_messages(1000);'
  );
end;
$$;
