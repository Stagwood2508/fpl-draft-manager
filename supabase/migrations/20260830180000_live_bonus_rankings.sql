-- Calculate provisional bonus rankings from live BPS within each real Premier
-- League fixture. These rankings are display-only; official FPL totals remain
-- authoritative so provisional bonus is never double counted.

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
  with ranked as (
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
    end::integer as provisional_bonus_points
  from ranked
  where ranked.bonus_rank <= 3;
$$;

revoke all on function public.get_gameweek_provisional_bonus_rankings(integer)
  from public, anon;
grant execute on function public.get_gameweek_provisional_bonus_rankings(integer)
  to authenticated, service_role;

comment on function public.get_gameweek_provisional_bonus_rankings(integer) is
  'Ranks live BPS per Premier League fixture using official tie positions and returns display-only provisional 3/2/1 bonus awards.';

