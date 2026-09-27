-- Permanently remove the retired Gameweek Rehearsal feature.
-- Historical migrations remain intact so deployed migration history is never rewritten.

-- Restore the real scoring and lineup lifecycle without rehearsal pause guards.
create or replace function public.trigger_live_stats_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_gw integer;
  v_cron_secret text;
  v_request_id bigint;
begin
  select gameweek_number into v_current_gw
  from public.gameweeks
  where not coalesce(is_finished, false)
    and fpl_deadline_time <= pg_catalog.now()
  order by coalesce(is_current, false) desc, gameweek_number desc
  limit 1;

  if v_current_gw is null then return; end if;

  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets
  where name = 'live_stats_cron_secret'
  limit 1;

  if v_cron_secret is null then
    raise warning 'live_stats_cron_secret is not configured; live stats sync skipped';
    return;
  end if;

  select net.http_get(
    url := 'https://fnysbiwhwcqqqdwvhkau.supabase.co/functions/v1/sync-live-stats?gameweek=' || v_current_gw,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_cron_secret)
  ) into v_request_id;
end;
$$;

create or replace function public.run_gameweek_lineup_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule jsonb;
  v_snapshots jsonb;
  v_autosubs jsonb;
begin
  v_schedule := public.refresh_league_gameweek_schedule();
  v_snapshots := public.capture_due_gameweek_lineups(null);
  v_autosubs := public.process_due_gameweek_autosubs(null);
  perform public.trigger_live_stats_sync();

  return jsonb_build_object(
    'success', true,
    'schedule', v_schedule,
    'snapshots', v_snapshots,
    'autosubs', v_autosubs,
    'live_sync_checked', true
  );
end;
$$;

-- Recreate waiver-window routines without rehearsal-window priority or locks.
create or replace function public.repair_pending_waiver_processed_state(
  p_league_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_updated integer := 0;
begin
  with active_window as (
    select distinct on (candidate.league_id) candidate.league_id, candidate.gameweek
    from public.league_gameweeks candidate
    where (p_league_id is null or candidate.league_id = p_league_id)
      and candidate.gw_deadline > pg_catalog.now()
      and not coalesce(candidate.is_finished, false)
    order by candidate.league_id, candidate.gw_deadline, candidate.gameweek
  )
  update public.league_gameweeks gameweek
  set is_waiver_processed = false,
      waiver_processed_at = null,
      status = 'WAIVERS_OPEN'
  from active_window active
  where gameweek.league_id = active.league_id
    and gameweek.gameweek = active.gameweek
    and gameweek.waiver_deadline > pg_catalog.now()
    and gameweek.gw_deadline > pg_catalog.now()
    and not coalesce(gameweek.is_finished, false)
    and (coalesce(gameweek.is_waiver_processed, false)
      or upper(coalesce(gameweek.status::text, '')) = 'FREE_AGENCY')
    and exists (
      select 1 from public.waiver_claims claim
      where claim.league_id = gameweek.league_id
        and lower(coalesce(claim.status::text, 'pending')) = 'pending'
    );
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.normalise_league_waiver_windows(
  p_league_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_updated integer := 0;
begin
  perform public.repair_pending_waiver_processed_state(p_league_id);
  with active_window as (
    select distinct on (lg.league_id) lg.league_id, lg.gameweek
    from public.league_gameweeks lg
    where (p_league_id is null or lg.league_id = p_league_id)
      and not coalesce(lg.is_finished, false)
      and lg.gw_deadline > pg_catalog.now()
    order by lg.league_id, lg.gw_deadline, lg.gameweek
  )
  update public.league_gameweeks lg
  set status = case
    when coalesce(lg.is_finished, false) then 'FINISHED'
    when lg.gw_deadline <= pg_catalog.now() then 'IN_PLAY'
    when active.gameweek is null then lg.status
    when lg.gameweek <> active.gameweek then 'SCHEDULED'
    when coalesce(lg.is_waiver_processed, false) then 'FREE_AGENCY'
    when lg.waiver_deadline is null or lg.waiver_deadline <= pg_catalog.now() then 'WAIVERS_CLOSED'
    else 'WAIVERS_OPEN'
  end
  from active_window active
  where lg.league_id = active.league_id
    and lg.status is distinct from case
      when coalesce(lg.is_finished, false) then 'FINISHED'
      when lg.gw_deadline <= pg_catalog.now() then 'IN_PLAY'
      when active.gameweek is null then lg.status
      when lg.gameweek <> active.gameweek then 'SCHEDULED'
      when coalesce(lg.is_waiver_processed, false) then 'FREE_AGENCY'
      when lg.waiver_deadline is null or lg.waiver_deadline <= pg_catalog.now() then 'WAIVERS_CLOSED'
      else 'WAIVERS_OPEN'
    end;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.reconcile_pending_waiver_claims(
  p_league_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_updated integer := 0;
begin
  with active_windows as (
    select distinct on (lg.league_id) lg.league_id, lg.gameweek
    from public.league_gameweeks lg
    where (p_league_id is null or lg.league_id = p_league_id)
      and upper(coalesce(lg.status::text, '')) = 'WAIVERS_OPEN'
      and not coalesce(lg.is_waiver_processed, false)
      and not coalesce(lg.is_finished, false)
      and lg.waiver_deadline > pg_catalog.now()
    order by lg.league_id, lg.gameweek, lg.waiver_deadline
  )
  update public.waiver_claims claim
  set gameweek = active.gameweek
  from active_windows active
  where claim.league_id = active.league_id
    and lower(coalesce(claim.status::text, 'pending')) = 'pending'
    and claim.gameweek is distinct from active.gameweek
    and not exists (
      select 1 from public.waiver_claims existing
      where existing.id <> claim.id
        and existing.league_id = claim.league_id
        and existing.user_id = claim.user_id
        and existing.player_to_add = claim.player_to_add
        and existing.player_to_drop = claim.player_to_drop
        and existing.gameweek = active.gameweek
    );
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- Live notifications now always track the real gameweek; remove the former lock.
create or replace function public.detect_live_player_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_goals integer := case when tg_op = 'UPDATE' then coalesce(old.goals_scored, 0) else 0 end;
  v_old_assists integer := case when tg_op = 'UPDATE' then coalesce(old.assists, 0) else 0 end;
  v_old_saves integer := case when tg_op = 'UPDATE' then coalesce(old.saves, 0) else 0 end;
  v_old_defcon_actions integer := case when tg_op = 'UPDATE' then coalesce(old.defensive_contribution, 0) else 0 end;
  v_player_position text;
  v_goal_points integer;
  v_old_defcon_points integer;
  v_new_defcon_points integer;
  v_level integer;
  v_snapshot record;
begin
  if coalesce(new.goals_scored, 0) <= v_old_goals
     and coalesce(new.assists, 0) <= v_old_assists
     and coalesce(new.saves, 0) / 3 <= v_old_saves / 3
     and coalesce(new.defensive_contribution, 0) <= v_old_defcon_actions then return new; end if;
  select upper(coalesce(player.element_type::text, 'FWD')) into v_player_position
  from public.players player where player.id = new.player_id;
  v_goal_points := case
    when v_player_position in ('1', 'GKP', 'GK', '2', 'DEF') then 6
    when v_player_position in ('3', 'MID') then 5 else 4 end;
  for v_snapshot in
    select snapshot.league_id, snapshot.user_id,
      new.player_id = any(snapshot.effective_starting_player_ids) as is_starting
    from public.gameweek_lineup_snapshots snapshot
    join public.league_gameweeks league_gameweek
      on league_gameweek.league_id = snapshot.league_id
     and league_gameweek.gameweek = snapshot.gameweek
    where snapshot.gameweek = new.gameweek
      and (new.player_id = any(snapshot.effective_starting_player_ids)
        or new.player_id = any(snapshot.effective_bench_player_ids))
      and league_gameweek.gw_deadline <= pg_catalog.now()
      and not coalesce(league_gameweek.is_finished, false)
  loop
    if coalesce(new.goals_scored, 0) > v_old_goals then
      for v_level in (v_old_goals + 1)..coalesce(new.goals_scored, 0) loop
        perform public.queue_live_player_event(v_snapshot.league_id, new.gameweek, new.player_id, v_snapshot.user_id, v_snapshot.is_starting, 'GOAL', v_level, v_level, v_goal_points);
      end loop;
    end if;
    if coalesce(new.assists, 0) > v_old_assists then
      for v_level in (v_old_assists + 1)..coalesce(new.assists, 0) loop
        perform public.queue_live_player_event(v_snapshot.league_id, new.gameweek, new.player_id, v_snapshot.user_id, v_snapshot.is_starting, 'ASSIST', v_level, v_level, 3);
      end loop;
    end if;
    if coalesce(new.saves, 0) / 3 > v_old_saves / 3 then
      for v_level in (v_old_saves / 3 + 1)..(coalesce(new.saves, 0) / 3) loop
        perform public.queue_live_player_event(v_snapshot.league_id, new.gameweek, new.player_id, v_snapshot.user_id, v_snapshot.is_starting, 'SAVE_POINT', v_level, v_level * 3, v_level);
      end loop;
    end if;
    if coalesce(new.defensive_contribution, 0) > v_old_defcon_actions
       and v_player_position not in ('1', 'GKP', 'GK') then
      v_old_defcon_points := public.calculate_player_defcon_points(v_snapshot.league_id, v_player_position, v_old_defcon_actions);
      v_new_defcon_points := public.calculate_player_defcon_points(v_snapshot.league_id, v_player_position, coalesce(new.defensive_contribution, 0));
      if v_new_defcon_points > v_old_defcon_points then
        perform public.queue_live_player_event(v_snapshot.league_id, new.gameweek, new.player_id, v_snapshot.user_id, v_snapshot.is_starting, 'DEFCON', v_new_defcon_points, coalesce(new.defensive_contribution, 0), v_new_defcon_points);
      end if;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.detect_live_player_events() from public, anon, authenticated;

-- Rehearsal RPCs and their stored snapshots/audit history are deliberately removed.
drop function if exists public.reset_gameweek_simulation(uuid, text);
drop function if exists public.get_gameweek_simulation_waiver_results(uuid);
drop function if exists public.get_gameweek_simulation_integrity(uuid);
drop function if exists public.get_gameweek_simulation_players(uuid);
drop function if exists public.set_gameweek_simulation_player_stats(uuid, integer, text, jsonb);
drop function if exists public.advance_gameweek_simulation(uuid, text);
drop function if exists public.start_gameweek_simulation(uuid, integer, integer);
drop function if exists public.get_gameweek_simulation_status(uuid);
drop function if exists public.expire_gameweek_simulations();
drop function if exists public.restore_gameweek_simulation_internal(uuid, text);

drop table if exists public.gameweek_simulation_audit;
drop table if exists public.gameweek_simulation_runs;
drop table if exists public.gameweek_simulation_config;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.prokind = 'f'
      and pg_catalog.pg_get_functiondef(routine.oid) ilike '%gameweek_simulation%'
  ) then
    raise exception 'Gameweek Rehearsal references remain in a public database routine';
  end if;
end;
$$;
