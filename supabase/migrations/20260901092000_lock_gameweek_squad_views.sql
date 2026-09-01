-- Match Centre should expose the complete deadline squad, and the squad GW
-- points view must not follow ownership changes made after the deadline.

do $$
declare
  v_definition text;
  v_snapshot_old constant text := $fragment$      selected.player_id,
      snapshot.status as lineup_status
    from fixture_teams team
    join public.gameweek_lineup_snapshots snapshot
      on snapshot.league_id = team.league_id
     and snapshot.user_id = team.user_id
     and snapshot.gameweek = p_gameweek
    cross join lateral unnest(snapshot.effective_starting_player_ids) selected(player_id)
$fragment$;
  v_snapshot_new constant text := $fragment$      selected.player_id,
      'STARTER'::text as lineup_status
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
      selected.player_id,
      'BENCH'::text as lineup_status
    from fixture_teams team
    join public.gameweek_lineup_snapshots snapshot
      on snapshot.league_id = team.league_id
     and snapshot.user_id = team.user_id
     and snapshot.gameweek = p_gameweek
    cross join lateral unnest(snapshot.effective_bench_player_ids) selected(player_id)
$fragment$;
  v_roster_old constant text := $fragment$      roster.player_id,
      'CURRENT'::text
    from fixture_teams team
    join public.rosters roster
      on roster.league_id = team.league_id
     and roster.user_id = team.user_id
     and roster.is_starting
$fragment$;
  v_roster_new constant text := $fragment$      roster.player_id,
      case when roster.is_starting then 'STARTER' else 'BENCH' end::text
    from fixture_teams team
    join public.rosters roster
      on roster.league_id = team.league_id
     and roster.user_id = team.user_id
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.get_league_gameweek_player_scores(uuid,integer)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, v_snapshot_old) = 0 then
    raise exception 'get_league_gameweek_player_scores snapshot selection did not match the expected definition';
  end if;
  if pg_catalog.strpos(v_definition, v_roster_old) = 0 then
    raise exception 'get_league_gameweek_player_scores roster fallback did not match the expected definition';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_snapshot_old, v_snapshot_new);
  v_definition := pg_catalog.replace(v_definition, v_roster_old, v_roster_new);
  execute v_definition;
end;
$$;

comment on function public.get_league_gameweek_player_scores(uuid, integer) is
  'Returns scoring breakdowns for all 15 players in each locked Gameweek squad, split between the effective XI and bench.';

create or replace function public.get_my_squad_gameweek_scores(
  p_league_id uuid,
  p_gameweek integer
)
returns table (
  player_id integer,
  fpl_points integer,
  defcon_points integer,
  combined_points integer,
  minutes integer,
  stats_updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with selected_players as (
    select selected.player_id
    from public.gameweek_lineup_snapshots snapshot
    cross join lateral pg_catalog.unnest(
      snapshot.starting_player_ids || snapshot.bench_player_ids
    ) selected(player_id)
    where snapshot.league_id = p_league_id
      and snapshot.user_id = auth.uid()
      and snapshot.gameweek = p_gameweek

    union all

    select roster.player_id
    from public.rosters roster
    where roster.league_id = p_league_id
      and roster.user_id = auth.uid()
      and not exists (
        select 1
        from public.gameweek_lineup_snapshots snapshot
        where snapshot.league_id = p_league_id
          and snapshot.user_id = auth.uid()
          and snapshot.gameweek = p_gameweek
      )
  )
  select
    selected.player_id::integer,
    coalesce(stats.total_points, 0)::integer as fpl_points,
    public.calculate_player_defcon_points(
      p_league_id,
      player.element_type::text,
      coalesce(stats.defensive_contribution, 0)::integer
    )::integer as defcon_points,
    (
      coalesce(stats.total_points, 0)
      + public.calculate_player_defcon_points(
          p_league_id,
          player.element_type::text,
          coalesce(stats.defensive_contribution, 0)::integer
        )
    )::integer as combined_points,
    coalesce(stats.minutes, 0)::integer as minutes,
    stats.updated_at as stats_updated_at
  from selected_players selected
  join public.players player on player.id = selected.player_id
  left join public.player_gameweek_stats stats
    on stats.player_id = selected.player_id
   and stats.gameweek = p_gameweek
  where exists (
    select 1
    from public.league_members membership
    where membership.league_id = p_league_id
      and membership.user_id = auth.uid()
  )
  order by selected.player_id;
$$;

revoke all on function public.get_my_squad_gameweek_scores(uuid, integer)
  from public, anon;
grant execute on function public.get_my_squad_gameweek_scores(uuid, integer)
  to authenticated, service_role;

comment on function public.get_my_squad_gameweek_scores(uuid, integer) is
  'Returns custom-league points for the manager''s locked 15-player Gameweek squad, falling back to current ownership before a snapshot exists.';

