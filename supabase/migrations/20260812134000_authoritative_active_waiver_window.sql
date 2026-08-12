-- A client-supplied Gameweek is advisory only. All submissions must be filed
-- into the earliest open, unprocessed waiver window for the league.

do $$
declare
  v_definition text;
  v_old_fragment constant text := $fragment$
  where lg.league_id = p_league_id
    and (p_gameweek is null or lg.gameweek = p_gameweek)
    and not coalesce(lg.is_waiver_processed, false)
  order by
    case when p_gameweek is not null then 0 else 1 end,
    lg.waiver_deadline nulls last,
    lg.gameweek
$fragment$;
  v_new_fragment constant text := $fragment$
  where lg.league_id = p_league_id
    and not coalesce(lg.is_waiver_processed, false)
    and not coalesce(lg.is_finished, false)
    and lg.waiver_deadline > pg_catalog.now()
    and upper(coalesce(lg.status::text, '')) = 'WAIVERS_OPEN'
  order by lg.waiver_deadline, lg.gameweek
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.submit_waiver_claim(uuid,integer,integer,integer)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, v_old_fragment) = 0 then
    raise exception 'submit_waiver_claim window selection did not match the expected secured definition';
  end if;

  execute pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
end;
$$;

-- Repair pending claims created by clients that selected the final future
-- Gameweek instead of the league's current window. Existing conflicting exact
-- pairings are left untouched rather than deleted.
with active_windows as (
  select league.id as league_id, active.gameweek
  from public.leagues league
  cross join lateral (
    select lg.gameweek
    from public.league_gameweeks lg
    where lg.league_id = league.id
      and not coalesce(lg.is_waiver_processed, false)
      and not coalesce(lg.is_finished, false)
      and lg.waiver_deadline > pg_catalog.now()
      and upper(coalesce(lg.status::text, '')) = 'WAIVERS_OPEN'
    order by lg.waiver_deadline, lg.gameweek
    limit 1
  ) active
)
update public.waiver_claims claim
set gameweek = active.gameweek
from active_windows active
where claim.league_id = active.league_id
  and lower(coalesce(claim.status::text, 'pending')) = 'pending'
  and claim.gameweek <> active.gameweek
  and not exists (
    select 1
    from public.waiver_claims existing
    where existing.id <> claim.id
      and existing.league_id = claim.league_id
      and existing.user_id = claim.user_id
      and existing.player_to_add = claim.player_to_add
      and existing.player_to_drop = claim.player_to_drop
      and existing.gameweek = active.gameweek
  );

revoke all on function public.submit_waiver_claim(uuid,integer,integer,integer)
  from public, anon;
grant execute on function public.submit_waiver_claim(uuid,integer,integer,integer)
  to authenticated;

comment on function public.submit_waiver_claim(uuid,integer,integer,integer) is
  'Submits a server-validated claim into the authoritative active waiver window; alternative outgoing players may target the same available player.';
