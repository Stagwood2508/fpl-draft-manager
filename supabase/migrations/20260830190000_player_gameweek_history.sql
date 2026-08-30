-- League-aware player history. In particular, DEFCON must be calculated from
-- the selected league's custom tiers rather than a generic stored fallback.

create or replace function public.get_player_gameweek_history(
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
    public.calculate_player_defcon_points(
      p_league_id,
      player.element_type::text,
      coalesce(stats.defensive_contribution, 0)::integer
    )::integer as defcon_points,
    coalesce(stats.total_points, 0)::integer,
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

revoke all on function public.get_player_gameweek_history(uuid,integer,integer)
  from public, anon;
grant execute on function public.get_player_gameweek_history(uuid,integer,integer)
  to authenticated, service_role;

comment on function public.get_player_gameweek_history(uuid, integer, integer) is
  'Returns current-season gameweek history with DEFCON recalculated using the selected league custom tiers.';

