-- Score each gameweek from its deadline snapshot/effective autosub lineup.

create or replace function public.get_live_fixture_scores(p_gameweek integer)
returns table(
  fixture_id uuid,
  league_id uuid,
  gameweek integer,
  home_user_id uuid,
  home_score integer,
  home_fpl_points integer,
  home_defcon_points integer,
  away_user_id uuid,
  away_score integer,
  away_fpl_points integer,
  away_defcon_points integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with selected_players as (
    select
      s.league_id,
      s.user_id,
      selected.player_id
    from public.gameweek_lineup_snapshots s
    cross join lateral unnest(s.effective_starting_player_ids) selected(player_id)
    where s.gameweek = p_gameweek

    union all

    select r.league_id, r.user_id, r.player_id
    from public.rosters r
    where r.is_starting
      and not exists (
        select 1
        from public.gameweek_lineup_snapshots s
        where s.league_id = r.league_id
          and s.user_id = r.user_id
          and s.gameweek = p_gameweek
      )
  ),
  player_scores as (
    select
      selected.league_id,
      selected.user_id,
      selected.player_id,
      coalesce(pgs.total_points, 0) as fpl_base_pts,
      case
        when upper(p.element_type::text) in ('1', 'GKP', 'GK') then 0
        when coalesce(pgs.defensive_contribution, 0) >= coalesce(
          case
            when upper(p.element_type::text) in ('2', 'DEF') then (ls.defcon_thresholds_def->'tier_3'->>'threshold')::integer
            when upper(p.element_type::text) in ('3', 'MID') then (ls.defcon_thresholds_mid->'tier_3'->>'threshold')::integer
            when upper(p.element_type::text) in ('4', 'FWD') then (ls.defcon_thresholds_fwd->'tier_3'->>'threshold')::integer
          end, 30
        ) then coalesce(
          case
            when upper(p.element_type::text) in ('2', 'DEF') then (ls.defcon_thresholds_def->'tier_3'->>'points')::integer
            when upper(p.element_type::text) in ('3', 'MID') then (ls.defcon_thresholds_mid->'tier_3'->>'points')::integer
            when upper(p.element_type::text) in ('4', 'FWD') then (ls.defcon_thresholds_fwd->'tier_3'->>'points')::integer
          end, 10
        )
        when coalesce(pgs.defensive_contribution, 0) >= coalesce(
          case
            when upper(p.element_type::text) in ('2', 'DEF') then (ls.defcon_thresholds_def->'tier_2'->>'threshold')::integer
            when upper(p.element_type::text) in ('3', 'MID') then (ls.defcon_thresholds_mid->'tier_2'->>'threshold')::integer
            when upper(p.element_type::text) in ('4', 'FWD') then (ls.defcon_thresholds_fwd->'tier_2'->>'threshold')::integer
          end, 20
        ) then coalesce(
          case
            when upper(p.element_type::text) in ('2', 'DEF') then (ls.defcon_thresholds_def->'tier_2'->>'points')::integer
            when upper(p.element_type::text) in ('3', 'MID') then (ls.defcon_thresholds_mid->'tier_2'->>'points')::integer
            when upper(p.element_type::text) in ('4', 'FWD') then (ls.defcon_thresholds_fwd->'tier_2'->>'points')::integer
          end, 5
        )
        when coalesce(pgs.defensive_contribution, 0) >= coalesce(
          case
            when upper(p.element_type::text) in ('2', 'DEF') then (ls.defcon_thresholds_def->'tier_1'->>'threshold')::integer
            when upper(p.element_type::text) in ('3', 'MID') then (ls.defcon_thresholds_mid->'tier_1'->>'threshold')::integer
            when upper(p.element_type::text) in ('4', 'FWD') then (ls.defcon_thresholds_fwd->'tier_1'->>'threshold')::integer
          end, 10
        ) then coalesce(
          case
            when upper(p.element_type::text) in ('2', 'DEF') then (ls.defcon_thresholds_def->'tier_1'->>'points')::integer
            when upper(p.element_type::text) in ('3', 'MID') then (ls.defcon_thresholds_mid->'tier_1'->>'points')::integer
            when upper(p.element_type::text) in ('4', 'FWD') then (ls.defcon_thresholds_fwd->'tier_1'->>'points')::integer
          end, 2
        )
        else 0
      end as custom_defcon_pts
    from selected_players selected
    join public.players p on p.id = selected.player_id
    left join public.league_settings ls on ls.league_id = selected.league_id
    left join public.player_gameweek_stats pgs
      on pgs.player_id = selected.player_id and pgs.gameweek = p_gameweek
  ),
  manager_totals as (
    select
      scores.league_id,
      scores.user_id,
      sum(scores.fpl_base_pts)::integer as total_fpl_pts,
      sum(scores.custom_defcon_pts)::integer as total_defcon_pts,
      (sum(scores.fpl_base_pts) + sum(scores.custom_defcon_pts))::integer as total_combined_score
    from player_scores scores
    group by scores.league_id, scores.user_id
  )
  select
    fixture.id,
    fixture.league_id,
    p_gameweek,
    fixture.home_user_id,
    coalesce(home.total_combined_score, 0),
    coalesce(home.total_fpl_pts, 0),
    coalesce(home.total_defcon_pts, 0),
    fixture.away_user_id,
    coalesce(away.total_combined_score, 0),
    coalesce(away.total_fpl_pts, 0),
    coalesce(away.total_defcon_pts, 0)
  from public.league_fixtures fixture
  left join manager_totals home
    on home.league_id = fixture.league_id and home.user_id = fixture.home_user_id
  left join manager_totals away
    on away.league_id = fixture.league_id and away.user_id = fixture.away_user_id
  where fixture.gameweek = p_gameweek;
$$;

revoke all on function public.get_live_fixture_scores(integer) from public, anon;
grant execute on function public.get_live_fixture_scores(integer) to authenticated, service_role;

comment on function public.get_live_fixture_scores(integer) is
  'Scores deadline snapshots and their processed autosub lineups, falling back to the current XI only before a snapshot exists.';
