-- Expand the player scoring-history feed with the useful FPL events managers
-- need, while continuing to replace official defensive-contribution points
-- with each league's custom DEFCON tiers.

drop function if exists public.get_player_gameweek_history(uuid, integer, integer);

create function public.get_player_gameweek_history(
  p_league_id uuid,
  p_player_id integer,
  p_through_gameweek integer default 38
)
returns table (
  gameweek integer,
  minutes integer,
  goals_scored integer,
  assists integer,
  clean_sheets integer,
  goals_conceded integer,
  own_goals integer,
  penalties_saved integer,
  penalties_missed integer,
  yellow_cards integer,
  red_cards integer,
  saves integer,
  bonus integer,
  defcon_points integer,
  total_points integer,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    stats.gameweek,
    coalesce(stats.minutes, 0)::integer,
    coalesce(stats.goals_scored, 0)::integer,
    coalesce(stats.assists, 0)::integer,
    coalesce(stats.clean_sheets, 0)::integer,
    coalesce(stats.goals_conceded, 0)::integer,
    coalesce(stats.own_goals, 0)::integer,
    coalesce(stats.penalties_saved, 0)::integer,
    coalesce(stats.penalties_missed, 0)::integer,
    coalesce(stats.yellow_cards, 0)::integer,
    coalesce(stats.red_cards, 0)::integer,
    coalesce(stats.saves, 0)::integer,
    coalesce(stats.bonus, 0)::integer,
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
    )::integer as total_points,
    stats.updated_at
  from public.player_gameweek_stats stats
  join public.players player on player.id = stats.player_id
  where stats.player_id = p_player_id
    and stats.gameweek <= greatest(coalesce(p_through_gameweek, 38), 1)
    and (
      auth.role() = 'service_role'
      or exists (
        select 1
        from public.league_members membership
        where membership.league_id = p_league_id
          and membership.user_id = auth.uid()
      )
    )
  order by stats.gameweek desc;
$$;

revoke all on function public.get_player_gameweek_history(uuid, integer, integer)
  from public, anon;
grant execute on function public.get_player_gameweek_history(uuid, integer, integer)
  to authenticated, service_role;

comment on function public.get_player_gameweek_history(uuid, integer, integer) is
  'Returns useful per-Gameweek scoring events and base FPL plus custom league DEFCON points for an authenticated league member.';
