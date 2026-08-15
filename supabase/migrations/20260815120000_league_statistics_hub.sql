-- League-scoped statistics for the League Hub. These functions deliberately
-- calculate from finalized fixtures and locked lineup snapshots so the same
-- figures are shared by web, native and future historical exports.

create or replace function public.get_league_stats_dashboard(
  p_league_id uuid,
  p_start_gw integer default 1,
  p_end_gw integer default 38
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select greatest(1, least(coalesce(p_start_gw, 1), 38)) as start_gw,
           greatest(1, least(coalesce(p_end_gw, 38), 38)) as end_gw
  ),
  members as (
    select
      member.user_id,
      coalesce(member.team_name, 'FC Manager')::text as team_name,
      coalesce(nullif(profile.display_name, ''), nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''), member.team_name, 'Manager')::text as manager_name
    from public.league_members member
    left join public.profiles profile on profile.id = member.user_id
    where member.league_id = p_league_id
  ),
  manager_gameweeks as (
    select fixture.gameweek, fixture.home_user_id as user_id,
           coalesce(fixture.home_score, 0)::integer as score,
           coalesce(fixture.away_score, 0)::integer as opponent_score,
           fixture.away_user_id as opponent_id
    from public.league_fixtures fixture, bounds
    where fixture.league_id = p_league_id
      and fixture.gameweek between bounds.start_gw and bounds.end_gw
      and coalesce(fixture.is_finished, false)
    union all
    select fixture.gameweek, fixture.away_user_id,
           coalesce(fixture.away_score, 0)::integer,
           coalesce(fixture.home_score, 0)::integer,
           fixture.home_user_id
    from public.league_fixtures fixture, bounds
    where fixture.league_id = p_league_id
      and fixture.gameweek between bounds.start_gw and bounds.end_gw
      and coalesce(fixture.is_finished, false)
      and fixture.away_user_id is not null
  ),
  all_play as (
    select own.user_id, own.gameweek,
      coalesce(avg(case when own.score > peer.score then 1.0 when own.score = peer.score then 0.5 else 0.0 end), 0)::numeric as expected_win
    from manager_gameweeks own
    left join manager_gameweeks peer
      on peer.gameweek = own.gameweek and peer.user_id <> own.user_id
    group by own.user_id, own.gameweek
  ),
  bench_totals as (
    select snapshot.user_id,
           sum(
             coalesce(stats.total_points, 0)
             + public.calculate_player_defcon_points(
                 p_league_id,
                 player.element_type::text,
                 coalesce(stats.defensive_contribution, 0)::integer
               )
           )::integer as benched_points
    from public.gameweek_lineup_snapshots snapshot, bounds
    cross join lateral unnest(snapshot.effective_bench_player_ids) bench(player_id)
    join public.players player on player.id = bench.player_id
    left join public.player_gameweek_stats stats
      on stats.player_id = bench.player_id and stats.gameweek = snapshot.gameweek
    where snapshot.league_id = p_league_id
      and snapshot.gameweek between bounds.start_gw and bounds.end_gw
    group by snapshot.user_id
  ),
  aggregates as (
    select
      member.user_id, member.team_name, member.manager_name,
      count(gameweek.gameweek)::integer as played,
      count(*) filter (where gameweek.score > gameweek.opponent_score)::integer as won,
      count(*) filter (where gameweek.score = gameweek.opponent_score and gameweek.gameweek is not null)::integer as drawn,
      count(*) filter (where gameweek.score < gameweek.opponent_score)::integer as lost,
      coalesce(sum(gameweek.score), 0)::integer as total_points,
      coalesce(round(avg(gameweek.score)::numeric, 1), 0)::numeric as average_points,
      coalesce(max(gameweek.score), 0)::integer as best_score,
      coalesce(min(gameweek.score), 0)::integer as worst_score,
      coalesce(sum(case when gameweek.score > gameweek.opponent_score then 3 when gameweek.score = gameweek.opponent_score then 1 else 0 end), 0)::integer as league_points,
      coalesce(sum(case when gameweek.score > gameweek.opponent_score then 1.0 when gameweek.score = gameweek.opponent_score then 0.5 else 0 end), 0)::numeric as actual_equivalent_wins,
      coalesce(sum(all_play.expected_win), 0)::numeric as expected_wins,
      coalesce(bench.benched_points, 0)::integer as benched_points
    from members member
    left join manager_gameweeks gameweek on gameweek.user_id = member.user_id
    left join all_play on all_play.user_id = gameweek.user_id and all_play.gameweek = gameweek.gameweek
    left join bench_totals bench on bench.user_id = member.user_id
    group by member.user_id, member.team_name, member.manager_name, bench.benched_points
  ),
  ranked as (
    select aggregates.*,
      row_number() over (order by league_points desc, total_points desc, team_name, user_id)::integer as rank,
      round((actual_equivalent_wins - expected_wins)::numeric, 1) as luck_score
    from aggregates
  ),
  form_rows as (
    select recent.user_id,
      jsonb_agg(jsonb_build_object(
        'gameweek', recent.gameweek,
        'score', recent.score,
        'opponent_score', recent.opponent_score,
        'result', case when recent.score > recent.opponent_score then 'W' when recent.score = recent.opponent_score then 'D' else 'L' end
      ) order by recent.gameweek) as recent_form
    from (
      select gameweek.*,
             row_number() over (partition by gameweek.user_id order by gameweek.gameweek desc) as recent_rank
      from manager_gameweeks gameweek
    ) recent
    where recent.recent_rank <= 6
    group by recent.user_id
  ),
  manager_json as (
    select jsonb_agg(
      jsonb_build_object(
        'rank', ranked.rank,
        'user_id', ranked.user_id,
        'team_name', ranked.team_name,
        'manager_name', ranked.manager_name,
        'played', ranked.played,
        'won', ranked.won,
        'drawn', ranked.drawn,
        'lost', ranked.lost,
        'league_points', ranked.league_points,
        'total_points', ranked.total_points,
        'average_points', ranked.average_points,
        'best_score', ranked.best_score,
        'worst_score', ranked.worst_score,
        'benched_points', ranked.benched_points,
        'expected_wins', round(ranked.expected_wins, 1),
        'luck_score', ranked.luck_score,
        'recent_form', coalesce(form.recent_form, '[]'::jsonb)
      ) order by ranked.rank, ranked.team_name
    ) as data
    from ranked
    left join form_rows form on form.user_id = ranked.user_id
  )
  select case
    when not exists (select 1 from members viewer where viewer.user_id = auth.uid())
         and auth.role() <> 'service_role'
      then jsonb_build_object('success', false, 'error', 'LEAGUE_ACCESS_REQUIRED')
    else jsonb_build_object(
      'success', true,
      'start_gameweek', (select start_gw from bounds),
      'end_gameweek', (select end_gw from bounds),
      'completed_gameweeks', coalesce((select count(distinct gameweek) from manager_gameweeks), 0),
      'managers', coalesce((select data from manager_json), '[]'::jsonb)
    )
  end;
$$;

create or replace function public.get_manager_stats_profile(
  p_league_id uuid,
  p_user_id uuid,
  p_start_gw integer default 1,
  p_end_gw integer default 38
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select greatest(1, least(coalesce(p_start_gw, 1), 38)) as start_gw,
           greatest(1, least(coalesce(p_end_gw, 38), 38)) as end_gw
  ),
  fixtures as (
    select fixture.gameweek, fixture.home_user_id as user_id, fixture.away_user_id as opponent_id,
           fixture.home_team_name as team_name, fixture.away_team_name as opponent_name,
           coalesce(fixture.home_score, 0)::integer as points,
           coalesce(fixture.away_score, 0)::integer as opponent_points
    from public.league_fixtures fixture, bounds
    where fixture.league_id = p_league_id and fixture.gameweek between bounds.start_gw and bounds.end_gw
      and coalesce(fixture.is_finished, false)
    union all
    select fixture.gameweek, fixture.away_user_id, fixture.home_user_id,
           fixture.away_team_name, fixture.home_team_name,
           coalesce(fixture.away_score, 0)::integer, coalesce(fixture.home_score, 0)::integer
    from public.league_fixtures fixture, bounds
    where fixture.league_id = p_league_id and fixture.gameweek between bounds.start_gw and bounds.end_gw
      and coalesce(fixture.is_finished, false) and fixture.away_user_id is not null
  ),
  selected_fixtures as (
    select * from fixtures where user_id = p_user_id
  ),
  trend_rows as (
    select selected_fixtures.*,
           sum(points) over (order by gameweek)::integer as cumulative_points
    from selected_fixtures
  ),
  trends as (
    select jsonb_agg(jsonb_build_object(
      'gameweek', gameweek, 'points', points, 'opponent_points', opponent_points,
      'result', case when points > opponent_points then 'WIN' when points = opponent_points then 'DRAW' else 'LOSS' end,
      'cumulative_points', cumulative_points
    ) order by gameweek) as data
    from trend_rows
  ),
  h2h_rows as (
    select opponent_id, max(opponent_name) as opponent_name,
      count(*) filter (where points > opponent_points)::integer as wins,
      count(*) filter (where points = opponent_points)::integer as draws,
      count(*) filter (where points < opponent_points)::integer as losses,
      sum(points)::integer as points_for, sum(opponent_points)::integer as points_against
    from selected_fixtures
    where opponent_id is not null
    group by opponent_id
  ),
  h2h as (
    select jsonb_agg(jsonb_build_object(
      'opponent_id', opponent_id, 'opponent_name', opponent_name,
      'wins', wins, 'draws', draws, 'losses', losses,
      'points_for', points_for, 'points_against', points_against
    ) order by opponent_name) as data from h2h_rows
  ),
  selected_players as (
    select snapshot.gameweek, selected.player_id
    from public.gameweek_lineup_snapshots snapshot, bounds
    cross join lateral unnest(snapshot.effective_starting_player_ids) selected(player_id)
    where snapshot.league_id = p_league_id and snapshot.user_id = p_user_id
      and snapshot.gameweek between bounds.start_gw and bounds.end_gw
  ),
  roster_players as (
    select
      snapshot.gameweek,
      case upper(player.element_type::text)
        when '1' then 'GKP'
        when 'GK' then 'GKP'
        when 'GKP' then 'GKP'
        when '2' then 'DEF'
        when 'DEF' then 'DEF'
        when '3' then 'MID'
        when 'MID' then 'MID'
        else 'FWD'
      end as position,
      (
        coalesce(stats.total_points, 0)
        + public.calculate_player_defcon_points(
            p_league_id,
            player.element_type::text,
            coalesce(stats.defensive_contribution, 0)::integer
          )
      )::integer as points
    from public.gameweek_lineup_snapshots snapshot, bounds
    cross join lateral unnest(snapshot.starting_player_ids || snapshot.bench_player_ids) roster(player_id)
    join public.players player on player.id = roster.player_id
    left join public.player_gameweek_stats stats
      on stats.player_id = roster.player_id and stats.gameweek = snapshot.gameweek
    where snapshot.league_id = p_league_id and snapshot.user_id = p_user_id
      and snapshot.gameweek between bounds.start_gw and bounds.end_gw
  ),
  ranked_roster as (
    select roster_players.*,
           row_number() over (partition by gameweek, position order by points desc)::integer as position_rank
    from roster_players
  ),
  legal_formations as (
    select defenders, midfielders, forwards
    from generate_series(3, 5) as defender_options(defenders)
    cross join generate_series(2, 5) as midfielder_options(midfielders)
    cross join generate_series(1, 3) as forward_options(forwards)
    where defenders + midfielders + forwards = 10
  ),
  formation_scores as (
    select
      roster.gameweek,
      formation.defenders,
      formation.midfielders,
      formation.forwards,
      sum(case
        when roster.position = 'GKP' and roster.position_rank <= 1 then roster.points
        when roster.position = 'DEF' and roster.position_rank <= formation.defenders then roster.points
        when roster.position = 'MID' and roster.position_rank <= formation.midfielders then roster.points
        when roster.position = 'FWD' and roster.position_rank <= formation.forwards then roster.points
        else 0
      end)::integer as optimal_points
    from ranked_roster roster
    cross join legal_formations formation
    group by roster.gameweek, formation.defenders, formation.midfielders, formation.forwards
  ),
  optimal_lineups as (
    select gameweek, max(optimal_points)::integer as optimal_points
    from formation_scores
    group by gameweek
  ),
  lineup_blunder_rows as (
    select
      fixture.gameweek,
      fixture.points as actual_points,
      fixture.opponent_points,
      optimal.optimal_points,
      (optimal.optimal_points - fixture.points)::integer as missed_points
    from selected_fixtures fixture
    join optimal_lineups optimal on optimal.gameweek = fixture.gameweek
    where fixture.points < fixture.opponent_points
      and optimal.optimal_points > fixture.opponent_points
  ),
  lineup_blunders as (
    select jsonb_agg(jsonb_build_object(
      'gameweek', gameweek,
      'actual_points', actual_points,
      'opponent_points', opponent_points,
      'optimal_points', optimal_points,
      'missed_points', missed_points
    ) order by gameweek) as data
    from lineup_blunder_rows
  ),
  player_rows as (
    select player.id as player_id, coalesce(player.web_name, 'Unknown player')::text as player_name,
      coalesce(player.team_short_name, player.team_name, '')::text as club,
      upper(coalesce(player.element_type::text, 'FWD'))::text as position,
      count(*) filter (where coalesce(stats.minutes, 0) > 0)::integer as appearances,
      sum(coalesce(stats.minutes, 0))::integer as minutes,
      sum(coalesce(stats.total_points, 0) + public.calculate_player_defcon_points(p_league_id, player.element_type::text, coalesce(stats.defensive_contribution, 0)::integer))::integer as points,
      sum(coalesce(stats.goals_scored, 0))::integer as goals,
      sum(coalesce(stats.assists, 0))::integer as assists,
      sum(coalesce(stats.bonus, 0))::integer as bonus
    from selected_players selected
    join public.players player on player.id = selected.player_id
    left join public.player_gameweek_stats stats on stats.player_id = selected.player_id and stats.gameweek = selected.gameweek
    group by player.id, player.web_name, player.team_short_name, player.team_name, player.element_type
  ),
  players as (
    select jsonb_agg(jsonb_build_object(
      'player_id', player_id, 'player_name', player_name, 'club', club, 'position', position,
      'appearances', appearances, 'minutes', minutes, 'points', points,
      'average_points', round(points::numeric / nullif(appearances, 0), 1),
      'points_per_90', round(points::numeric * 90 / nullif(minutes, 0), 1),
      'goals', goals, 'assists', assists, 'bonus', bonus
    ) order by points desc, player_name) as data from player_rows
  ),
  positions as (
    select jsonb_agg(jsonb_build_object('position', position, 'points', points) order by sort_order) as data
    from (
      select position, sum(points)::integer as points,
        case position when 'GKP' then 1 when 'GK' then 1 when '1' then 1 when 'DEF' then 2 when '2' then 2 when 'MID' then 3 when '3' then 3 else 4 end as sort_order
      from player_rows group by position
    ) grouped
  )
  select case
    when not exists (
      select 1 from public.league_members viewer
      where viewer.league_id = p_league_id and viewer.user_id = auth.uid()
    ) and auth.role() <> 'service_role'
      then jsonb_build_object('success', false, 'error', 'LEAGUE_ACCESS_REQUIRED')
    when not exists (
      select 1 from public.league_members target
      where target.league_id = p_league_id and target.user_id = p_user_id
    ) then jsonb_build_object('success', false, 'error', 'MANAGER_NOT_FOUND')
    else jsonb_build_object(
      'success', true,
      'trends', coalesce((select data from trends), '[]'::jsonb),
      'h2h', coalesce((select data from h2h), '[]'::jsonb),
      'players', coalesce((select data from players), '[]'::jsonb),
      'positions', coalesce((select data from positions), '[]'::jsonb),
      'lineup_blunders', coalesce((select data from lineup_blunders), '[]'::jsonb)
    )
  end;
$$;

create or replace function public.get_trade_impact(
  p_league_id uuid,
  p_transaction_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with package as (
    select coalesce(trade.parent_transaction_id, trade.id) as package_id,
           trade.sender_id, trade.receiver_id,
           coalesce(trade.updated_at, trade.created_at) as completed_at
    from public.transactions trade
    where trade.league_id = p_league_id
      and (trade.id = p_transaction_id or trade.parent_transaction_id = p_transaction_id)
      and upper(trade.type::text) = 'TRADE'
      and upper(trade.status::text) = 'ACCEPTED'
    order by trade.created_at
    limit 1
  ),
  rows as (
    select trade.player_out_id as sender_gives_id,
           trade.player_in_id as receiver_gives_id
    from public.transactions trade, package
    where trade.league_id = p_league_id
      and coalesce(trade.parent_transaction_id, trade.id) = package.package_id
  ),
  trade_gw as (
    select coalesce(min(gameweek.gameweek), 1)::integer as gameweek
    from public.league_gameweeks gameweek, package
    where gameweek.league_id = p_league_id and gameweek.gw_deadline >= package.completed_at
  ),
  sides as (
    select 'SENDER_GIVES'::text as side, sender_gives_id as player_id from rows
    union all select 'RECEIVER_GIVES', receiver_gives_id from rows
  ),
  stats as (
    select side.side, player.id as player_id, player.web_name as player_name,
      coalesce(player.team_short_name, player.team_name, '')::text as club,
      upper(player.element_type::text) as position,
      sum(coalesce(gw.total_points, 0)) filter (where gw.gameweek < trade_gw.gameweek)::integer as before_points,
      sum(coalesce(gw.total_points, 0)) filter (where gw.gameweek >= trade_gw.gameweek)::integer as since_points,
      sum(coalesce(gw.minutes, 0)) filter (where gw.gameweek >= trade_gw.gameweek)::integer as since_minutes,
      sum(coalesce(gw.goals_scored, 0)) filter (where gw.gameweek >= trade_gw.gameweek)::integer as since_goals,
      sum(coalesce(gw.assists, 0)) filter (where gw.gameweek >= trade_gw.gameweek)::integer as since_assists,
      count(*) filter (where gw.gameweek >= trade_gw.gameweek and coalesce(gw.minutes, 0) > 0)::integer as since_appearances
    from sides side
    join public.players player on player.id = side.player_id
    cross join trade_gw
    left join public.player_gameweek_stats gw on gw.player_id = side.player_id
    group by side.side, player.id, player.web_name, player.team_short_name, player.team_name, player.element_type
  )
  select case
    when not exists (
      select 1 from public.league_members viewer
      where viewer.league_id = p_league_id and viewer.user_id = auth.uid()
    ) and auth.role() <> 'service_role'
      then jsonb_build_object('success', false, 'error', 'LEAGUE_ACCESS_REQUIRED')
    when not exists (select 1 from package)
      then jsonb_build_object('success', false, 'error', 'ACCEPTED_TRADE_NOT_FOUND')
    else jsonb_build_object(
      'success', true,
      'trade_gameweek', (select gameweek from trade_gw),
      'sender_id', (select sender_id from package),
      'receiver_id', (select receiver_id from package),
      'players', coalesce((select jsonb_agg(to_jsonb(stats) order by side, player_name) from stats), '[]'::jsonb)
    )
  end;
$$;

revoke all on function public.get_league_stats_dashboard(uuid, integer, integer) from public, anon;
revoke all on function public.get_manager_stats_profile(uuid, uuid, integer, integer) from public, anon;
revoke all on function public.get_trade_impact(uuid, uuid) from public, anon;
grant execute on function public.get_league_stats_dashboard(uuid, integer, integer) to authenticated, service_role;
grant execute on function public.get_manager_stats_profile(uuid, uuid, integer, integer) to authenticated, service_role;
grant execute on function public.get_trade_impact(uuid, uuid) to authenticated, service_role;

comment on function public.get_league_stats_dashboard(uuid, integer, integer) is
  'League-scoped overview, form, bench and all-play luck statistics from finalized fixtures.';
comment on function public.get_manager_stats_profile(uuid, uuid, integer, integer) is
  'League-visible manager trends, H2H, legal-lineup mistakes and actual starting-player contributions.';
comment on function public.get_trade_impact(uuid, uuid) is
  'League-visible accepted trade comparison split into pre-trade and post-trade output.';
