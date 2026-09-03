-- New leagues must remain unscheduled until their commissioner explicitly
-- selects a future draft time. Also make draft restarts clear the old schedule
-- so the due-draft worker cannot immediately start them again.

alter table public.league_settings
  alter column draft_start_time drop default,
  alter column draft_start_time drop not null;

-- A league with fewer than two managers cannot run a meaningful draft. Clear
-- stale inherited dates for those untouched leagues without changing any draft
-- that has picks or official activity.
update public.league_settings settings
set draft_start_time = null,
    updated_at = pg_catalog.now()
where settings.draft_start_time <= pg_catalog.now()
  and (
    select pg_catalog.count(*)
    from public.league_members member
    where member.league_id = settings.league_id
  ) < 2
  and not exists (
    select 1 from public.draft_picks pick
    where pick.league_id = settings.league_id
  )
  and exists (
    select 1 from public.leagues league
    where league.id = settings.league_id
      and pg_catalog.upper(coalesce(league.draft_status, league.status, 'PRE_DRAFT'))
        in ('PRE_DRAFT', 'WAITING_ROOM', 'NOT_STARTED', 'WAITING')
  );

create or replace procedure public.auto_initialize_drafts()
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league record;
  v_member_count integer;
  v_order_count integer;
  v_min_order integer;
  v_max_order integer;
  v_first_picker uuid;
  v_turn_duration integer;
begin
  for v_league in
    select settings.league_id, settings.draft_start_time
    from public.league_settings settings
    join public.leagues league on league.id = settings.league_id
    where settings.draft_start_time is not null
      and settings.draft_start_time <= pg_catalog.now()
      and pg_catalog.upper(coalesce(league.draft_status, league.status, 'PRE_DRAFT'))
        in ('PRE_DRAFT', 'WAITING_ROOM', 'NOT_STARTED', 'WAITING')
      and not exists (
        select 1 from public.draft_picks pick
        where pick.league_id = settings.league_id
      )
      and not exists (
        select 1 from public.draft_sessions session
        where session.league_id = settings.league_id
          and pg_catalog.upper(coalesce(session.draft_status, ''))
            in ('LIVE', 'DRAFTING', 'COMPLETED')
      )
    order by settings.draft_start_time
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_league.league_id::text, 12100020260812)
    );

    select
      pg_catalog.count(*)::integer,
      pg_catalog.count(distinct member.draft_order)::integer,
      pg_catalog.min(member.draft_order),
      pg_catalog.max(member.draft_order)
    into v_member_count, v_order_count, v_min_order, v_max_order
    from public.league_members member
    where member.league_id = v_league.league_id;

    if v_member_count < 2 then
      continue;
    end if;

    if v_order_count <> v_member_count
       or v_min_order <> 1
       or v_max_order <> v_member_count then
      with randomized as (
        select
          member.user_id,
          pg_catalog.row_number() over (order by pg_catalog.random())::integer as new_order
        from public.league_members member
        where member.league_id = v_league.league_id
      )
      update public.league_members member
      set draft_order = randomized.new_order
      from randomized
      where member.league_id = v_league.league_id
        and member.user_id = randomized.user_id;
    end if;

    select member.user_id
    into v_first_picker
    from public.league_members member
    where member.league_id = v_league.league_id
    order by member.draft_order, member.user_id
    limit 1;

    select coalesce(settings.draft_clock_duration, 60)
    into v_turn_duration
    from public.league_settings settings
    where settings.league_id = v_league.league_id;

    insert into public.draft_sessions (
      league_id, current_round, current_pick_index, current_picker_id,
      pick_deadline, draft_status
    ) values (
      v_league.league_id, 1, 1, v_first_picker,
      pg_catalog.now() + (coalesce(v_turn_duration, 60) || ' seconds')::interval,
      'LIVE'
    )
    on conflict (league_id)
    do update set
      current_round = 1,
      current_pick_index = 1,
      current_picker_id = excluded.current_picker_id,
      pick_deadline = excluded.pick_deadline,
      draft_status = 'LIVE';

    update public.leagues league
    set draft_status = 'DRAFTING', status = 'DRAFTING'
    where league.id = v_league.league_id;
  end loop;
end;
$$;

create or replace function public.commissioner_restart_draft(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_session record;
  v_first_picker uuid;
  v_deleted_picks integer;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;
  if not exists (
    select 1 from public.leagues league
    where league.id = p_league_id and league.commissioner_id = v_actor_id
  ) then
    return jsonb_build_object('success', false, 'error', 'COMMISSIONER_REQUIRED');
  end if;
  if public.draft_has_official_activity(p_league_id) then
    return jsonb_build_object('success', false, 'error', 'OFFICIAL_ACTIVITY_STARTED');
  end if;

  select * into v_session
  from public.draft_sessions
  where league_id = p_league_id
  for update;
  if v_session is null then
    return jsonb_build_object('success', false, 'error', 'DRAFT_SESSION_NOT_FOUND');
  end if;

  select user_id into v_first_picker
  from public.league_members
  where league_id = p_league_id
  order by draft_order asc
  limit 1;

  select pg_catalog.count(*) into v_deleted_picks
  from public.draft_picks where league_id = p_league_id;

  insert into public.draft_pick_audit (
    league_id, event_type, user_id, round_number, overall_pick_number,
    pick_source, pick_reason, actor_user_id, metadata
  ) values (
    p_league_id, 'DRAFT_RESTARTED', v_first_picker, 1, 1,
    'COMMISSIONER', 'COMMISSIONER_RESTART', v_actor_id,
    jsonb_build_object('deleted_pick_count', v_deleted_picks, 'previous_status', v_session.draft_status)
  );

  delete from public.rosters where league_id = p_league_id;
  delete from public.draft_picks where league_id = p_league_id;
  delete from public.draft_manager_autopick_state where league_id = p_league_id;

  update public.league_settings
  set draft_start_time = null,
      updated_at = pg_catalog.now()
  where league_id = p_league_id;

  update public.draft_sessions
  set current_round = 1,
      current_pick_index = 1,
      current_picker_id = v_first_picker,
      pick_deadline = null,
      draft_status = 'WAITING_ROOM',
      pause_started_at = null,
      paused_seconds_remaining = null,
      paused_by = null,
      updated_at = pg_catalog.now()
  where league_id = p_league_id;

  update public.leagues
  set draft_status = 'WAITING_ROOM', status = 'PRE_DRAFT'
  where id = p_league_id;

  return jsonb_build_object(
    'success', true,
    'action', 'RESTART',
    'deleted_pick_count', v_deleted_picks,
    'first_picker_id', v_first_picker
  );
end;
$$;

revoke all on function public.commissioner_restart_draft(uuid) from public, anon;
grant execute on function public.commissioner_restart_draft(uuid) to authenticated, service_role;

comment on column public.league_settings.draft_start_time is
  'Nullable until the commissioner explicitly schedules a future draft time.';

