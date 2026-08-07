create or replace function public.get_league_live_fixture_scores(
  p_league_id uuid,
  p_gameweek integer
)
returns table (
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
  select scores.*
  from public.get_live_fixture_scores(p_gameweek) scores
  where scores.league_id = p_league_id
    and exists (
      select 1
      from public.league_members member
      where member.league_id = p_league_id
        and member.user_id = auth.uid()
    );
$$;

revoke all on function public.get_league_live_fixture_scores(uuid, integer) from public, anon;
grant execute on function public.get_league_live_fixture_scores(uuid, integer) to authenticated;

comment on function public.get_league_live_fixture_scores(uuid, integer) is
  'Returns live fixture scores only for a league the authenticated manager belongs to.';

