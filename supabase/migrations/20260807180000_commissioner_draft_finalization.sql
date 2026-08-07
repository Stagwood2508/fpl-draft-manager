-- Final commissioner and draft-result controls for V1.
-- All mutating actions are server-authoritative, commissioner-only and audited.

create or replace function public.enforce_draft_position_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_position text;
  v_position_count integer;
  v_position_limit integer;
  v_existing_pick_id bigint;
begin
  v_existing_pick_id := case when tg_op = 'UPDATE' then old.id else null end;

  if v_actor_id is not null
     and v_actor_id <> new.user_id
     and not exists (
       select 1 from public.leagues l
       where l.id = new.league_id and l.commissioner_id = v_actor_id
     ) then
    raise exception 'UNAUTHORIZED_PICK_ACTOR';
  end if;
  select upper(p.element_type::text)
  into v_position
  from public.players p
  where p.id = new.player_id;

  v_position_limit := case v_position
    when 'GKP' then 2
    when '1' then 2
    when 'DEF' then 5
    when '2' then 5
    when 'MID' then 5
    when '3' then 5
    when 'FWD' then 3
    when '4' then 3
    else null
  end;

  if v_position_limit is null then
    raise exception 'INVALID_PLAYER_POSITION';
  end if;

  select count(*)
  into v_position_count
  from public.draft_picks dp
  join public.players p on p.id = dp.player_id
  where dp.league_id = new.league_id
    and dp.user_id = new.user_id
    and upper(p.element_type::text) in (
      case v_position
        when 'GKP' then 'GKP' when '1' then '1'
        when 'DEF' then 'DEF' when '2' then '2'
        when 'MID' then 'MID' when '3' then '3'
        when 'FWD' then 'FWD' when '4' then '4'
      end
    )
    and (v_existing_pick_id is null or dp.id <> v_existing_pick_id);

  if v_position_count >= v_position_limit then
    raise exception 'POSITION_FULL:%', v_position;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_draft_position_limit_trigger on public.draft_picks;
create trigger enforce_draft_position_limit_trigger
before insert or update of player_id, user_id on public.draft_picks
for each row execute function public.enforce_draft_position_limit();

drop policy if exists "League members can view draft pick audit"
  on public.draft_pick_audit;
drop policy if exists "Commissioners can view draft pick audit"
  on public.draft_pick_audit;
create policy "Commissioners can view draft pick audit"
  on public.draft_pick_audit
  for select
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = draft_pick_audit.league_id
        and l.commissioner_id = auth.uid()
    )
  );

create or replace function public.draft_has_official_activity(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.transactions t where t.league_id = p_league_id)
    or exists (select 1 from public.waiver_claims w where w.league_id = p_league_id)
    or exists (
      select 1 from public.league_fixtures f
      where f.league_id = p_league_id
        and (
          coalesce(f.is_finished, false)
          or f.kickoff_time <= pg_catalog.now()
          or coalesce(f.home_score, 0) <> 0
          or coalesce(f.away_score, 0) <> 0
        )
    )
    or exists (
      select 1 from public.league_gameweeks g
      where g.league_id = p_league_id
        and (
          coalesce(g.is_finished, false)
          or coalesce(g.is_waiver_processed, false)
          or upper(coalesce(g.status, '')) in ('ACTIVE', 'LIVE', 'FINISHED', 'COMPLETED')
        )
    );
$$;

revoke all on function public.draft_has_official_activity(uuid) from public, anon, authenticated;

create or replace function public.commissioner_assign_current_pick(
  p_league_id uuid,
  p_player_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_session record;
  v_result jsonb;
  v_pick_id bigint;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;
  if not exists (
    select 1 from public.leagues l
    where l.id = p_league_id and l.commissioner_id = v_actor_id
  ) then
    return jsonb_build_object('success', false, 'error', 'COMMISSIONER_REQUIRED');
  end if;

  select * into v_session
  from public.draft_sessions
  where league_id = p_league_id
  for update;

  if v_session is null or v_session.draft_status not in ('LIVE', 'DRAFTING') then
    return jsonb_build_object('success', false, 'error', 'DRAFT_NOT_ACTIVE');
  end if;

  begin
    v_result := public.execute_draft_pick(
      p_league_id,
      v_session.current_picker_id,
      p_player_id
    );
  exception when others then
    if sqlerrm like 'POSITION_FULL:%' then
      return jsonb_build_object('success', false, 'error', 'POSITION_FULL');
    end if;
    raise;
  end;

  if not coalesce((v_result ->> 'success')::boolean, false) then
    return v_result;
  end if;

  v_pick_id := (v_result ->> 'pick_id')::bigint;
  update public.draft_picks
  set pick_source = 'COMMISSIONER', pick_reason = 'COMMISSIONER_ASSIGNED'
  where id = v_pick_id;

  update public.draft_pick_audit
  set pick_source = 'COMMISSIONER',
      pick_reason = 'COMMISSIONER_ASSIGNED',
      actor_user_id = v_actor_id,
      metadata = metadata || jsonb_build_object(
        'commissioner_assigned', true,
        'assigned_for_user_id', v_session.current_picker_id
      )
  where pick_id = v_pick_id and event_type = 'PICK_CREATED';

  return v_result || jsonb_build_object(
    'action', 'ASSIGN',
    'assigned_player_id', p_player_id,
    'assigned_for_user_id', v_session.current_picker_id
  );
end;
$$;

create or replace function public.commissioner_undo_latest_pick(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_session record;
  v_pick record;
  v_turn_duration integer := 60;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;
  if not exists (
    select 1 from public.leagues l
    where l.id = p_league_id and l.commissioner_id = v_actor_id
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

  select * into v_pick
  from public.draft_picks
  where league_id = p_league_id
  order by overall_pick_number desc, picked_at desc
  limit 1
  for update;

  if v_session is null then
    return jsonb_build_object('success', false, 'error', 'DRAFT_SESSION_NOT_FOUND');
  end if;
  if v_pick is null then
    return jsonb_build_object('success', false, 'error', 'NO_PICKS_TO_UNDO');
  end if;

  select coalesce(draft_clock_duration, 60) into v_turn_duration
  from public.league_settings where league_id = p_league_id;
  v_turn_duration := coalesce(v_turn_duration, 60);

  insert into public.draft_pick_audit (
    league_id, pick_id, event_type, user_id, player_id, round_number,
    overall_pick_number, pick_source, pick_reason, actor_user_id, metadata
  ) values (
    p_league_id, v_pick.id, 'PICK_UNDONE', v_pick.user_id, v_pick.player_id,
    v_pick.round_number, v_pick.overall_pick_number, 'COMMISSIONER',
    'COMMISSIONER_UNDO', v_actor_id,
    jsonb_build_object('original_pick_source', v_pick.pick_source, 'original_pick_reason', v_pick.pick_reason)
  );

  delete from public.rosters
  where league_id = p_league_id and user_id = v_pick.user_id and player_id = v_pick.player_id;
  delete from public.draft_picks where id = v_pick.id;

  update public.draft_sessions
  set current_round = v_pick.round_number,
      current_pick_index = v_pick.overall_pick_number,
      current_picker_id = v_pick.user_id,
      pick_deadline = pg_catalog.now() + (v_turn_duration || ' seconds')::interval,
      draft_status = 'DRAFTING',
      pause_started_at = null,
      paused_seconds_remaining = null,
      paused_by = null,
      updated_at = pg_catalog.now()
  where league_id = p_league_id;

  update public.leagues
  set draft_status = 'LIVE', status = 'DRAFTING'
  where id = p_league_id;

  insert into public.draft_manager_autopick_state (
    league_id, user_id, consecutive_autopicks, is_away, updated_at
  ) values (p_league_id, v_pick.user_id, 0, false, pg_catalog.now())
  on conflict (league_id, user_id) do update
  set consecutive_autopicks = 0, is_away = false, updated_at = pg_catalog.now();

  return jsonb_build_object(
    'success', true,
    'action', 'UNDO',
    'undone_pick_id', v_pick.id,
    'player_id', v_pick.player_id,
    'user_id', v_pick.user_id,
    'overall_pick_number', v_pick.overall_pick_number
  );
end;
$$;

create or replace function public.commissioner_correct_latest_pick(
  p_league_id uuid,
  p_player_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_session record;
  v_pick record;
  v_old_player_id integer;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;
  if not exists (
    select 1 from public.leagues l
    where l.id = p_league_id and l.commissioner_id = v_actor_id
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

  select * into v_pick
  from public.draft_picks
  where league_id = p_league_id
  order by overall_pick_number desc, picked_at desc
  limit 1
  for update;

  if v_session is null then
    return jsonb_build_object('success', false, 'error', 'DRAFT_SESSION_NOT_FOUND');
  end if;
  if v_pick is null then
    return jsonb_build_object('success', false, 'error', 'NO_PICKS_TO_CORRECT');
  end if;
  if v_pick.player_id = p_player_id then
    return jsonb_build_object('success', false, 'error', 'PLAYER_UNCHANGED');
  end if;
  if exists (
    select 1 from public.draft_picks
    where league_id = p_league_id and player_id = p_player_id
  ) then
    return jsonb_build_object('success', false, 'error', 'PLAYER_ALREADY_TAKEN');
  end if;

  v_old_player_id := v_pick.player_id;
  begin
    update public.draft_picks
    set player_id = p_player_id,
        pick_source = 'COMMISSIONER',
        pick_reason = 'COMMISSIONER_CORRECTION'
    where id = v_pick.id;
  exception when others then
    if sqlerrm like 'POSITION_FULL:%' then
      return jsonb_build_object('success', false, 'error', 'POSITION_FULL');
    end if;
    raise;
  end;

  update public.rosters
  set player_id = p_player_id
  where league_id = p_league_id
    and user_id = v_pick.user_id
    and player_id = v_old_player_id;

  insert into public.draft_pick_audit (
    league_id, pick_id, event_type, user_id, player_id, round_number,
    overall_pick_number, pick_source, pick_reason, actor_user_id, metadata
  ) values (
    p_league_id, v_pick.id, 'PICK_CORRECTED', v_pick.user_id, p_player_id,
    v_pick.round_number, v_pick.overall_pick_number, 'COMMISSIONER',
    'COMMISSIONER_CORRECTION', v_actor_id,
    jsonb_build_object('old_player_id', v_old_player_id, 'new_player_id', p_player_id)
  );

  return jsonb_build_object(
    'success', true,
    'action', 'CORRECT',
    'pick_id', v_pick.id,
    'old_player_id', v_old_player_id,
    'player_id', p_player_id,
    'user_id', v_pick.user_id,
    'overall_pick_number', v_pick.overall_pick_number
  );
end;
$$;

create or replace function public.commissioner_reorder_draft(
  p_league_id uuid,
  p_user_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_session record;
  v_member_count integer;
  v_supplied_count integer;
  v_first_picker uuid;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;
  if not exists (
    select 1 from public.leagues l
    where l.id = p_league_id and l.commissioner_id = v_actor_id
  ) then
    return jsonb_build_object('success', false, 'error', 'COMMISSIONER_REQUIRED');
  end if;

  select * into v_session
  from public.draft_sessions
  where league_id = p_league_id
  for update;

  if v_session is null then
    return jsonb_build_object('success', false, 'error', 'DRAFT_SESSION_NOT_FOUND');
  end if;
  if v_session.draft_status not in ('WAITING_ROOM', 'NOT_STARTED', 'PRE_DRAFT')
     or exists (select 1 from public.draft_picks where league_id = p_league_id) then
    return jsonb_build_object('success', false, 'error', 'DRAFT_ORDER_LOCKED');
  end if;

  select count(*) into v_member_count
  from public.league_members where league_id = p_league_id;
  select count(distinct supplied.user_id) into v_supplied_count
  from unnest(coalesce(p_user_ids, array[]::uuid[])) supplied(user_id);

  if cardinality(coalesce(p_user_ids, array[]::uuid[])) <> v_member_count
     or v_supplied_count <> v_member_count
     or exists (
       select 1 from unnest(coalesce(p_user_ids, array[]::uuid[])) supplied(user_id)
       where not exists (
         select 1 from public.league_members lm
         where lm.league_id = p_league_id and lm.user_id = supplied.user_id
       )
     ) then
    return jsonb_build_object('success', false, 'error', 'INVALID_DRAFT_ORDER');
  end if;

  update public.league_members lm
  set draft_order = supplied.ordinality
  from unnest(p_user_ids) with ordinality supplied(user_id, ordinality)
  where lm.league_id = p_league_id and lm.user_id = supplied.user_id;

  v_first_picker := p_user_ids[1];
  update public.draft_sessions
  set current_picker_id = v_first_picker, current_pick_index = 1, current_round = 1,
      updated_at = pg_catalog.now()
  where league_id = p_league_id;

  insert into public.draft_pick_audit (
    league_id, event_type, user_id, round_number, overall_pick_number,
    pick_source, pick_reason, actor_user_id, metadata
  ) values (
    p_league_id, 'DRAFT_ORDER_UPDATED', v_first_picker, 1, 1,
    'COMMISSIONER', 'COMMISSIONER_REORDERED', v_actor_id,
    jsonb_build_object('user_ids', to_jsonb(p_user_ids))
  );

  return jsonb_build_object('success', true, 'action', 'REORDER', 'user_ids', to_jsonb(p_user_ids));
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
    select 1 from public.leagues l
    where l.id = p_league_id and l.commissioner_id = v_actor_id
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

  select count(*) into v_deleted_picks
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

revoke all on function public.commissioner_assign_current_pick(uuid, integer) from public, anon;
revoke all on function public.commissioner_undo_latest_pick(uuid) from public, anon;
revoke all on function public.commissioner_correct_latest_pick(uuid, integer) from public, anon;
revoke all on function public.commissioner_reorder_draft(uuid, uuid[]) from public, anon;
revoke all on function public.commissioner_restart_draft(uuid) from public, anon;

grant execute on function public.commissioner_assign_current_pick(uuid, integer) to authenticated;
grant execute on function public.commissioner_undo_latest_pick(uuid) to authenticated;
grant execute on function public.commissioner_correct_latest_pick(uuid, integer) to authenticated;
grant execute on function public.commissioner_reorder_draft(uuid, uuid[]) to authenticated;
grant execute on function public.commissioner_restart_draft(uuid) to authenticated;

comment on function public.commissioner_assign_current_pick(uuid, integer) is
  'Assigns an eligible player to the current manager and advances the draft, with commissioner audit metadata.';
comment on function public.commissioner_undo_latest_pick(uuid) is
  'Undoes only the latest draft pick, restores that turn, and blocks after official season activity.';
comment on function public.commissioner_correct_latest_pick(uuid, integer) is
  'Replaces only the latest pick with an eligible player without changing the current turn.';
comment on function public.commissioner_reorder_draft(uuid, uuid[]) is
  'Reorders the complete manager list before the first pick only.';
comment on function public.commissioner_restart_draft(uuid) is
  'Clears draft picks and rosters and returns the league to the waiting room before official activity.';
