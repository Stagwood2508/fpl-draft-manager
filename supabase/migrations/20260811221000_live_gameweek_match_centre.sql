-- Authoritative player-level Match Centre scoring and one-minute live sync.

create or replace function public.get_league_gameweek_player_scores(
  p_league_id uuid,
  p_gameweek integer
)
returns table (
  fixture_id uuid,
  user_id uuid,
  fixture_side text,
  manager_team_name text,
  player_id integer,
  player_name text,
  club_name text,
  position text,
  minutes integer,
  fpl_points integer,
  defcon_points integer,
  combined_points integer,
  appearance_points integer,
  goal_count integer,
  goal_points integer,
  assist_count integer,
  assist_points integer,
  clean_sheet_count integer,
  clean_sheet_points integer,
  goals_conceded_count integer,
  goals_conceded_points integer,
  save_count integer,
  save_points integer,
  penalties_saved_count integer,
  penalties_saved_points integer,
  penalties_missed_count integer,
  penalties_missed_points integer,
  own_goal_count integer,
  own_goal_points integer,
  yellow_card_count integer,
  yellow_card_points integer,
  red_card_count integer,
  red_card_points integer,
  bonus_points integer,
  other_fpl_points integer,
  bps integer,
  defensive_contribution integer,
  clearances_blocks_interceptions integer,
  recoveries integer,
  tackles integer,
  stats_updated_at timestamptz,
  lineup_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with fixture_teams as (
    select
      fixture.id as fixture_id,
      fixture.league_id,
      fixture.gameweek,
      fixture.home_user_id as user_id,
      'HOME'::text as fixture_side,
      fixture.home_team_name as manager_team_name
    from public.league_fixtures fixture
    where fixture.league_id = p_league_id
      and fixture.gameweek = p_gameweek

    union all

    select
      fixture.id,
      fixture.league_id,
      fixture.gameweek,
      fixture.away_user_id,
      'AWAY'::text,
      fixture.away_team_name
    from public.league_fixtures fixture
    where fixture.league_id = p_league_id
      and fixture.gameweek = p_gameweek
      and fixture.away_user_id is not null
  ),
  selected_players as (
    select
      team.fixture_id,
      team.league_id,
      team.user_id,
      team.fixture_side,
      team.manager_team_name,
      selected.player_id,
      snapshot.status as lineup_status
    from fixture_teams team
    join public.gameweek_lineup_snapshots snapshot
      on snapshot.league_id = team.league_id
     and snapshot.user_id = team.user_id
     and snapshot.gameweek = p_gameweek
    cross join lateral unnest(snapshot.effective_starting_player_ids) selected(player_id)

    union all

    select
      team.fixture_id,
      team.league_id,
      team.user_id,
      team.fixture_side,
      team.manager_team_name,
      roster.player_id,
      'CURRENT'::text
    from fixture_teams team
    join public.rosters roster
      on roster.league_id = team.league_id
     and roster.user_id = team.user_id
     and roster.is_starting
    where not exists (
      select 1
      from public.gameweek_lineup_snapshots snapshot
      where snapshot.league_id = team.league_id
        and snapshot.user_id = team.user_id
        and snapshot.gameweek = p_gameweek
    )
  ),
  raw_scores as (
    select
      selected.fixture_id,
      selected.user_id,
      selected.fixture_side,
      selected.manager_team_name,
      player.id as player_id,
      coalesce(player.web_name, 'Unknown player')::text as player_name,
      coalesce(player.team_name, '')::text as club_name,
      upper(coalesce(player.element_type::text, 'FWD')) as position,
      coalesce(stats.minutes, 0)::integer as minutes,
      coalesce(stats.total_points, 0)::integer as fpl_points,
      public.calculate_player_defcon_points(
        selected.league_id,
        player.element_type::text,
        coalesce(stats.defensive_contribution, 0)::integer
      )::integer as defcon_points,
      case
        when coalesce(stats.minutes, 0) >= 60 then 2
        when coalesce(stats.minutes, 0) > 0 then 1
        else 0
      end::integer as appearance_points,
      coalesce(stats.goals_scored, 0)::integer as goal_count,
      (
        coalesce(stats.goals_scored, 0) * case
          when upper(player.element_type::text) in ('1', 'GKP', 'GK', '2', 'DEF') then 6
          when upper(player.element_type::text) in ('3', 'MID') then 5
          else 4
        end
      )::integer as goal_points,
      coalesce(stats.assists, 0)::integer as assist_count,
      (coalesce(stats.assists, 0) * 3)::integer as assist_points,
      coalesce(stats.clean_sheets, 0)::integer as clean_sheet_count,
      (
        coalesce(stats.clean_sheets, 0) * case
          when upper(player.element_type::text) in ('1', 'GKP', 'GK', '2', 'DEF') then 4
          when upper(player.element_type::text) in ('3', 'MID') then 1
          else 0
        end
      )::integer as clean_sheet_points,
      coalesce(stats.goals_conceded, 0)::integer as goals_conceded_count,
      case
        when upper(player.element_type::text) in ('1', 'GKP', 'GK', '2', 'DEF')
          then -(coalesce(stats.goals_conceded, 0) / 2)::integer
        else 0
      end as goals_conceded_points,
      coalesce(stats.saves, 0)::integer as save_count,
      case
        when upper(player.element_type::text) in ('1', 'GKP', 'GK')
          then (coalesce(stats.saves, 0) / 3)::integer
        else 0
      end as save_points,
      coalesce(stats.penalties_saved, 0)::integer as penalties_saved_count,
      (coalesce(stats.penalties_saved, 0) * 5)::integer as penalties_saved_points,
      coalesce(stats.penalties_missed, 0)::integer as penalties_missed_count,
      (coalesce(stats.penalties_missed, 0) * -2)::integer as penalties_missed_points,
      coalesce(stats.own_goals, 0)::integer as own_goal_count,
      (coalesce(stats.own_goals, 0) * -2)::integer as own_goal_points,
      coalesce(stats.yellow_cards, 0)::integer as yellow_card_count,
      (coalesce(stats.yellow_cards, 0) * -1)::integer as yellow_card_points,
      coalesce(stats.red_cards, 0)::integer as red_card_count,
      (coalesce(stats.red_cards, 0) * -3)::integer as red_card_points,
      coalesce(stats.bonus, 0)::integer as bonus_points,
      coalesce(stats.bps, 0)::integer as bps,
      coalesce(stats.defensive_contribution, 0)::integer as defensive_contribution,
      coalesce(stats.clearances_blocks_interceptions, 0)::integer as clearances_blocks_interceptions,
      coalesce(stats.recoveries, 0)::integer as recoveries,
      coalesce(stats.tackles, 0)::integer as tackles,
      stats.updated_at as stats_updated_at,
      selected.lineup_status
    from selected_players selected
    join public.players player on player.id = selected.player_id
    left join public.player_gameweek_stats stats
      on stats.player_id = selected.player_id
     and stats.gameweek = p_gameweek
  )
  select
    score.fixture_id,
    score.user_id,
    score.fixture_side,
    score.manager_team_name,
    score.player_id,
    score.player_name,
    score.club_name,
    score.position,
    score.minutes,
    score.fpl_points,
    score.defcon_points,
    (score.fpl_points + score.defcon_points)::integer,
    score.appearance_points,
    score.goal_count,
    score.goal_points,
    score.assist_count,
    score.assist_points,
    score.clean_sheet_count,
    score.clean_sheet_points,
    score.goals_conceded_count,
    score.goals_conceded_points,
    score.save_count,
    score.save_points,
    score.penalties_saved_count,
    score.penalties_saved_points,
    score.penalties_missed_count,
    score.penalties_missed_points,
    score.own_goal_count,
    score.own_goal_points,
    score.yellow_card_count,
    score.yellow_card_points,
    score.red_card_count,
    score.red_card_points,
    score.bonus_points,
    (
      score.fpl_points - (
        score.appearance_points + score.goal_points + score.assist_points
        + score.clean_sheet_points + score.goals_conceded_points
        + score.save_points + score.penalties_saved_points
        + score.penalties_missed_points + score.own_goal_points
        + score.yellow_card_points + score.red_card_points
        + score.bonus_points
      )
    )::integer as other_fpl_points,
    score.bps,
    score.defensive_contribution,
    score.clearances_blocks_interceptions,
    score.recoveries,
    score.tackles,
    score.stats_updated_at,
    score.lineup_status
  from raw_scores score
  where exists (
    select 1
    from public.league_members viewer
    where viewer.league_id = p_league_id
      and viewer.user_id = auth.uid()
  )
  order by
    score.fixture_id,
    case score.fixture_side when 'HOME' then 1 else 2 end,
    case score.position when 'GKP' then 1 when 'GK' then 1 when '1' then 1 when 'DEF' then 2 when '2' then 2 when 'MID' then 3 when '3' then 3 else 4 end,
    score.player_name;
$$;

revoke all on function public.get_league_gameweek_player_scores(uuid, integer)
  from public, anon;
grant execute on function public.get_league_gameweek_player_scores(uuid, integer)
  to authenticated, service_role;

comment on function public.get_league_gameweek_player_scores(uuid, integer) is
  'Returns every effective starting player and a reconciled FPL plus DEFCON scoring breakdown for Match Centre viewers in the league.';

-- Only call the live API after the deadline and while the Gameweek remains
-- unfinished. The existing lifecycle cron invokes this function every minute.
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
  select gameweek.gameweek_number into v_current_gw
  from public.gameweeks gameweek
  where not coalesce(gameweek.is_finished, false)
    and gameweek.fpl_deadline_time <= pg_catalog.now()
  order by coalesce(gameweek.is_current, false) desc,
    gameweek.gameweek_number desc
  limit 1;

  if v_current_gw is null then
    return;
  end if;

  select secret.decrypted_secret into v_cron_secret
  from vault.decrypted_secrets secret
  where secret.name = 'live_stats_cron_secret'
  limit 1;

  if v_cron_secret is null then
    raise warning 'live_stats_cron_secret is not configured; live stats sync skipped';
    return;
  end if;

  select net.http_get(
    url := 'https://fnysbiwhwcqqqdwvhkau.supabase.co/functions/v1/sync-live-stats?gameweek=' || v_current_gw,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_cron_secret
    )
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

revoke all on function public.trigger_live_stats_sync()
  from public, anon, authenticated;
revoke all on function public.run_gameweek_lineup_lifecycle()
  from public, anon, authenticated;
grant execute on function public.trigger_live_stats_sync() to service_role;
grant execute on function public.run_gameweek_lineup_lifecycle() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'gameweek-lineup-lifecycle') then
    perform cron.schedule(
      'gameweek-lineup-lifecycle',
      '* * * * *',
      'select public.run_gameweek_lineup_lifecycle();'
    );
  end if;
end;
$$;
