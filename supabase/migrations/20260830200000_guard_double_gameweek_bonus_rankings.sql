-- The current live table stores one aggregate BPS value per player/Gameweek.
-- Do not present that aggregate as a per-match ranking during a double
-- Gameweek. Single-fixture clubs continue to receive accurate live rankings.

create or replace function public.get_gameweek_provisional_bonus_rankings(
  p_gameweek integer
)
returns table (
  premier_league_fixture_id integer,
  player_id integer,
  bps integer,
  bonus_rank bigint,
  provisional_bonus_points integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with fixture_sides as (
    select fixture.gameweek, fixture.home_team_id as team_id
    from public.fixtures fixture
    where fixture.gameweek = p_gameweek
    union all
    select fixture.gameweek, fixture.away_team_id
    from public.fixtures fixture
    where fixture.gameweek = p_gameweek
  ), team_fixture_counts as (
    select side.gameweek, side.team_id, count(*) as fixture_count
    from fixture_sides side
    group by side.gameweek, side.team_id
  ), ranked as (
    select
      fixture.id as premier_league_fixture_id,
      player.id as player_id,
      coalesce(stats.bps, 0)::integer as bps,
      rank() over (
        partition by fixture.id
        order by coalesce(stats.bps, 0) desc
      ) as bonus_rank
    from public.fixtures fixture
    join public.players player
      on player.team_id in (fixture.home_team_id, fixture.away_team_id)
    join team_fixture_counts fixture_count
      on fixture_count.gameweek = fixture.gameweek
     and fixture_count.team_id = player.team_id
     and fixture_count.fixture_count = 1
    join public.player_gameweek_stats stats
      on stats.player_id = player.id
     and stats.gameweek = fixture.gameweek
    where fixture.gameweek = p_gameweek
      and fixture.kickoff_time <= pg_catalog.now()
      and coalesce(stats.minutes, 0) > 0
      and coalesce(stats.bps, 0) > 0
  )
  select
    ranked.premier_league_fixture_id,
    ranked.player_id,
    ranked.bps,
    ranked.bonus_rank,
    case ranked.bonus_rank
      when 1 then 3
      when 2 then 2
      when 3 then 1
      else 0
    end::integer
  from ranked
  where ranked.bonus_rank <= 3;
$$;

