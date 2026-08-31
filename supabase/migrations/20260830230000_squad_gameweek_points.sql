-- Let a manager see current custom-league points for their complete squad,
-- including substitutes, without opening Match Centre.

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
  select
    roster.player_id::integer,
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
  from public.rosters roster
  join public.players player on player.id = roster.player_id
  left join public.player_gameweek_stats stats
    on stats.player_id = roster.player_id
   and stats.gameweek = p_gameweek
  where roster.league_id = p_league_id
    and roster.user_id = auth.uid()
    and exists (
      select 1
      from public.league_members membership
      where membership.league_id = p_league_id
        and membership.user_id = auth.uid()
    )
  order by roster.is_starting desc, roster.bench_order nulls first, roster.player_id;
$$;

revoke all on function public.get_my_squad_gameweek_scores(uuid, integer)
  from public, anon;
grant execute on function public.get_my_squad_gameweek_scores(uuid, integer)
  to authenticated, service_role;

comment on function public.get_my_squad_gameweek_scores(uuid, integer) is
  'Returns base FPL plus custom league DEFCON points for all 15 players owned by the signed-in manager.';
