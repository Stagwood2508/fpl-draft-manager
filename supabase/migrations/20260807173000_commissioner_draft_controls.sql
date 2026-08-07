-- Commissioner draft controls (applied after the draft audit foundation):
-- 1. Pause and resume the authoritative server clock.
-- 2. Extend the current turn without replacing its deadline.
-- 3. Force the current manager's normal watchlist/player-pool autopick.
-- Every action is commissioner-only, row-locked, and recorded in the audit log.

alter table public.draft_sessions
  add column if not exists pause_started_at timestamptz,
  add column if not exists paused_seconds_remaining integer,
  add column if not exists paused_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'draft_sessions_paused_seconds_check'
      and conrelid = 'public.draft_sessions'::regclass
  ) then
    alter table public.draft_sessions
      add constraint draft_sessions_paused_seconds_check
      check (paused_seconds_remaining is null or paused_seconds_remaining >= 0);
  end if;
end;
$$;

create or replace function public.commissioner_control_draft(
  p_league_id uuid,
  p_action text,
  p_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_action text := upper(trim(coalesce(p_action, '')));
  v_session record;
  v_turn_duration integer := 60;
  v_remaining integer;
  v_result jsonb;
  v_pick_id bigint;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if not exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and l.commissioner_id = v_actor_id
  ) then
    return jsonb_build_object('success', false, 'error', 'COMMISSIONER_REQUIRED');
  end if;

  select *
  into v_session
  from public.draft_sessions
  where league_id = p_league_id
  for update;

  if v_session is null then
    return jsonb_build_object('success', false, 'error', 'DRAFT_SESSION_NOT_FOUND');
  end if;

  select coalesce(draft_clock_duration, 60)
  into v_turn_duration
  from public.league_settings
  where league_id = p_league_id;

  v_turn_duration := coalesce(v_turn_duration, 60);

  if v_action = 'PAUSE' then
    if v_session.draft_status not in ('LIVE', 'DRAFTING') then
      return jsonb_build_object('success', false, 'error', 'DRAFT_NOT_ACTIVE');
    end if;

    v_remaining := greatest(
      0,
      ceil(extract(epoch from (coalesce(v_session.pick_deadline, pg_catalog.now()) - pg_catalog.now())))::integer
    );

    update public.draft_sessions
    set draft_status = 'PAUSED',
        pause_started_at = pg_catalog.now(),
        paused_seconds_remaining = v_remaining,
        paused_by = v_actor_id,
        pick_deadline = null,
        updated_at = pg_catalog.now()
    where league_id = p_league_id;

    update public.leagues
    set draft_status = 'PAUSED'
    where id = p_league_id;

    insert into public.draft_pick_audit (
      league_id, event_type, user_id, round_number, overall_pick_number,
      pick_source, pick_reason, actor_user_id, metadata
    ) values (
      p_league_id, 'DRAFT_PAUSED', v_session.current_picker_id,
      v_session.current_round, v_session.current_pick_index,
      'COMMISSIONER', 'COMMISSIONER_PAUSED', v_actor_id,
      jsonb_build_object('seconds_remaining', v_remaining)
    );

    return jsonb_build_object(
      'success', true,
      'action', 'PAUSE',
      'seconds_remaining', v_remaining,
      'current_picker_id', v_session.current_picker_id
    );
  end if;

  if v_action = 'RESUME' then
    if v_session.draft_status <> 'PAUSED' then
      return jsonb_build_object('success', false, 'error', 'DRAFT_NOT_PAUSED');
    end if;

    v_remaining := greatest(
      1,
      coalesce(v_session.paused_seconds_remaining, v_turn_duration)
    );

    update public.draft_sessions
    set draft_status = 'DRAFTING',
        pick_deadline = pg_catalog.now() + (v_remaining || ' seconds')::interval,
        pause_started_at = null,
        paused_seconds_remaining = null,
        paused_by = null,
        updated_at = pg_catalog.now()
    where league_id = p_league_id;

    update public.leagues
    set draft_status = 'LIVE'
    where id = p_league_id;

    insert into public.draft_pick_audit (
      league_id, event_type, user_id, round_number, overall_pick_number,
      pick_source, pick_reason, actor_user_id, metadata
    ) values (
      p_league_id, 'DRAFT_RESUMED', v_session.current_picker_id,
      v_session.current_round, v_session.current_pick_index,
      'COMMISSIONER', 'COMMISSIONER_RESUMED', v_actor_id,
      jsonb_build_object('restored_seconds', v_remaining)
    );

    return jsonb_build_object(
      'success', true,
      'action', 'RESUME',
      'restored_seconds', v_remaining,
      'current_picker_id', v_session.current_picker_id
    );
  end if;

  if v_action = 'EXTEND' then
    if v_session.draft_status not in ('LIVE', 'DRAFTING') then
      return jsonb_build_object('success', false, 'error', 'DRAFT_NOT_ACTIVE');
    end if;

    if p_seconds is null or p_seconds < 5 or p_seconds > 300 then
      return jsonb_build_object('success', false, 'error', 'INVALID_EXTENSION');
    end if;

    update public.draft_sessions
    set pick_deadline = greatest(
          coalesce(pick_deadline, pg_catalog.now()),
          pg_catalog.now()
        ) + (p_seconds || ' seconds')::interval,
        updated_at = pg_catalog.now()
    where league_id = p_league_id
    returning ceil(extract(epoch from (pick_deadline - pg_catalog.now())))::integer
    into v_remaining;

    insert into public.draft_pick_audit (
      league_id, event_type, user_id, round_number, overall_pick_number,
      pick_source, pick_reason, actor_user_id, metadata
    ) values (
      p_league_id, 'TURN_EXTENDED', v_session.current_picker_id,
      v_session.current_round, v_session.current_pick_index,
      'COMMISSIONER', 'COMMISSIONER_EXTENDED_TIMER', v_actor_id,
      jsonb_build_object('added_seconds', p_seconds, 'new_seconds_remaining', v_remaining)
    );

    return jsonb_build_object(
      'success', true,
      'action', 'EXTEND',
      'added_seconds', p_seconds,
      'seconds_remaining', v_remaining,
      'current_picker_id', v_session.current_picker_id
    );
  end if;

  if v_action = 'AUTOPICK' then
    if v_session.draft_status not in ('LIVE', 'DRAFTING') then
      return jsonb_build_object('success', false, 'error', 'DRAFT_NOT_ACTIVE');
    end if;

    if v_session.current_picker_id is null then
      return jsonb_build_object('success', false, 'error', 'CURRENT_PICKER_NOT_FOUND');
    end if;

    v_result := public.execute_draft_autopick(
      p_league_id,
      v_session.current_picker_id,
      v_session.current_pick_index
    );

    if not coalesce((v_result ->> 'success')::boolean, false) then
      return v_result;
    end if;

    v_pick_id := nullif(v_result ->> 'pick_id', '')::bigint;

    update public.draft_picks
    set pick_reason = 'COMMISSIONER_FORCED'
    where id = v_pick_id;

    update public.draft_pick_audit
    set pick_reason = 'COMMISSIONER_FORCED',
        actor_user_id = v_actor_id,
        metadata = metadata || jsonb_build_object(
          'commissioner_forced', true,
          'forced_for_user_id', v_session.current_picker_id
        )
    where pick_id = v_pick_id
      and event_type = 'PICK_CREATED';

    return v_result || jsonb_build_object(
      'action', 'AUTOPICK',
      'autopick_reason', 'COMMISSIONER_FORCED',
      'forced_for_user_id', v_session.current_picker_id
    );
  end if;

  return jsonb_build_object('success', false, 'error', 'UNKNOWN_ACTION');
end;
$$;

revoke all on function public.commissioner_control_draft(uuid, text, integer)
  from public, anon;
grant execute on function public.commissioner_control_draft(uuid, text, integer)
  to authenticated;

comment on function public.commissioner_control_draft(uuid, text, integer) is
  'Commissioner-only row-locked pause, resume, timer extension, and forced autopick controls with audit records.';
