-- The Draft bootstrap can retain last season's total_points during rollover.
-- Current-season scouting must therefore be based only on current Gameweek rows.

create or replace function public.get_player_pool_current_stats(
  p_through_gameweek integer default 38
)
returns table (
  player_id integer,
  total_points bigint,
  minutes bigint,
  starts bigint,
  appearances bigint,
  goals_scored bigint,
  assists bigint,
  clean_sheets bigint,
  saves bigint,
  penalties_saved bigint,
  bonus bigint,
  defensive_contribution bigint,
  ict_index numeric,
  expected_goals numeric,
  expected_assists numeric,
  expected_goal_involvements numeric,
  recent_form numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible_stats as (
    select stats.*
    from public.player_gameweek_stats stats
    where stats.gameweek between 1 and greatest(1, least(coalesce(p_through_gameweek, 38), 38))
  ),
  recent_gameweeks as (
    select distinct stats.gameweek
    from eligible_stats stats
    order by stats.gameweek desc
    limit 5
  ),
  aggregates as (
    select
      stats.player_id,
      sum(coalesce(stats.total_points, 0))::bigint as total_points,
      sum(coalesce(stats.minutes, 0))::bigint as minutes,
      sum(coalesce(stats.starts, 0))::bigint as starts,
      count(*) filter (where coalesce(stats.minutes, 0) > 0)::bigint as appearances,
      sum(coalesce(stats.goals_scored, 0))::bigint as goals_scored,
      sum(coalesce(stats.assists, 0))::bigint as assists,
      sum(coalesce(stats.clean_sheets, 0))::bigint as clean_sheets,
      sum(coalesce(stats.saves, 0))::bigint as saves,
      sum(coalesce(stats.penalties_saved, 0))::bigint as penalties_saved,
      sum(coalesce(stats.bonus, 0))::bigint as bonus,
      sum(coalesce(stats.defensive_contribution, 0))::bigint as defensive_contribution,
      sum(coalesce(stats.ict_index, 0))::numeric as ict_index,
      sum(coalesce(stats.expected_goals, 0))::numeric as expected_goals,
      sum(coalesce(stats.expected_assists, 0))::numeric as expected_assists,
      sum(coalesce(stats.expected_goal_involvements, 0))::numeric as expected_goal_involvements
    from eligible_stats stats
    group by stats.player_id
  ),
  form_stats as (
    select
      stats.player_id,
      round(
        sum(coalesce(stats.total_points, 0))::numeric /
        nullif(count(*) filter (where coalesce(stats.minutes, 0) > 0), 0),
        1
      ) as recent_form
    from eligible_stats stats
    join recent_gameweeks recent on recent.gameweek = stats.gameweek
    group by stats.player_id
  )
  select
    player.id::integer,
    coalesce(aggregates.total_points, 0)::bigint,
    coalesce(aggregates.minutes, 0)::bigint,
    coalesce(aggregates.starts, 0)::bigint,
    coalesce(aggregates.appearances, 0)::bigint,
    coalesce(aggregates.goals_scored, 0)::bigint,
    coalesce(aggregates.assists, 0)::bigint,
    coalesce(aggregates.clean_sheets, 0)::bigint,
    coalesce(aggregates.saves, 0)::bigint,
    coalesce(aggregates.penalties_saved, 0)::bigint,
    coalesce(aggregates.bonus, 0)::bigint,
    coalesce(aggregates.defensive_contribution, 0)::bigint,
    coalesce(aggregates.ict_index, 0)::numeric,
    coalesce(aggregates.expected_goals, 0)::numeric,
    coalesce(aggregates.expected_assists, 0)::numeric,
    coalesce(aggregates.expected_goal_involvements, 0)::numeric,
    coalesce(form_stats.recent_form, 0)::numeric
  from public.players player
  left join aggregates on aggregates.player_id = player.id
  left join form_stats on form_stats.player_id = player.id
  where coalesce(player.is_active, true);
$$;

revoke all on function public.get_player_pool_current_stats(integer) from public, anon;
grant execute on function public.get_player_pool_current_stats(integer) to authenticated, service_role;

comment on function public.get_player_pool_current_stats(integer) is
  'Returns current-season player-pool totals from Gameweek rows only; it deliberately never falls back to the Draft bootstrap season total.';
