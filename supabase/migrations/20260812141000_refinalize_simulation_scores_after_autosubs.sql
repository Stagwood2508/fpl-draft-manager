-- Effective lineups change during autosub processing, so fixture totals must
-- be recalculated after those changes rather than retaining pre-autosub scores.

do $$
declare
  v_definition text;
  v_old_fragment constant text := $fragment$
  elsif v_action = 'PROCESS_AUTOSUBS' and v_run.phase = 'FINISHED' then
    v_result := public.process_gameweek_autosubs(v_run.league_id, v_run.gameweek, true);
    v_phase := 'AUTOSUBS';
$fragment$;
  v_new_fragment constant text := $fragment$
  elsif v_action = 'PROCESS_AUTOSUBS' and v_run.phase = 'FINISHED' then
    v_result := public.process_gameweek_autosubs(v_run.league_id, v_run.gameweek, true);
    if not coalesce((v_result ->> 'success')::boolean, false) then
      return jsonb_build_object(
        'success', false,
        'error', coalesce(v_result ->> 'error', 'AUTOSUB_PROCESSING_FAILED'),
        'result', v_result
      );
    end if;
    with scores as (
      select * from public.get_live_fixture_scores(v_run.gameweek)
    )
    update public.league_fixtures fixture
    set home_score = scores.home_score,
        home_fpl_points = scores.home_fpl_points,
        home_defcon_points = scores.home_defcon_points,
        away_score = scores.away_score,
        away_fpl_points = scores.away_fpl_points,
        away_defcon_points = scores.away_defcon_points,
        is_finished = true
    from scores
    where fixture.id = scores.fixture_id
      and fixture.league_id = v_run.league_id;
    v_result := v_result || jsonb_build_object('fixture_scores_refinalized', true);
    v_phase := 'AUTOSUBS';
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.advance_gameweek_simulation(uuid,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_old_fragment) = 0 then
    raise exception 'advance_gameweek_simulation autosub transition did not match the expected definition';
  end if;
  execute pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
end;
$$;

-- Repair any active rehearsal that already processed autosubs before this fix.
with active_runs as (
  select run.league_id, run.gameweek
  from public.gameweek_simulation_runs run
  where run.status = 'ACTIVE'
    and run.phase in ('AUTOSUBS', 'WAIVERS_OPEN')
), scores as (
  select run.league_id as rehearsal_league_id, live.*
  from active_runs run
  cross join lateral public.get_live_fixture_scores(run.gameweek) live
)
update public.league_fixtures fixture
set home_score = scores.home_score,
    home_fpl_points = scores.home_fpl_points,
    home_defcon_points = scores.home_defcon_points,
    away_score = scores.away_score,
    away_fpl_points = scores.away_fpl_points,
    away_defcon_points = scores.away_defcon_points,
    is_finished = true
from scores
where fixture.id = scores.fixture_id
  and fixture.league_id = scores.rehearsal_league_id;

revoke all on function public.advance_gameweek_simulation(uuid,text)
  from public,anon;
grant execute on function public.advance_gameweek_simulation(uuid,text)
  to authenticated,service_role;
