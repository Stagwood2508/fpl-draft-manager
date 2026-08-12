-- PRE_DEADLINE is the rehearsal's waiver setup stage. Claims must remain open
-- for submission, cancellation and reordering until PROCESS_WAIVERS is chosen.

do $$
declare
  v_definition text;
  v_old_fragment constant text := $fragment$
  update public.league_gameweeks
  set is_current = (gameweek = p_gameweek),
      is_finished = case when gameweek = p_gameweek then false else is_finished end,
      status = case when gameweek = p_gameweek then 'WAIVERS_CLOSED' else status end,
      gw_deadline = case when gameweek = p_gameweek then now() + interval '10 minutes' else gw_deadline end
  where league_id = p_league_id;
$fragment$;
  v_new_fragment constant text := $fragment$
  update public.league_gameweeks
  set is_current = (gameweek = p_gameweek),
      is_finished = case when gameweek = p_gameweek then false else is_finished end,
      is_waiver_processed = case when gameweek = p_gameweek then false else is_waiver_processed end,
      status = case when gameweek = p_gameweek then 'WAIVERS_OPEN' else status end,
      waiver_deadline = case when gameweek = p_gameweek then now() + interval '10 minutes' else waiver_deadline end,
      waiver_deadline_time = case when gameweek = p_gameweek then now() + interval '10 minutes' else waiver_deadline_time end,
      waiver_processed_at = case when gameweek = p_gameweek then null else waiver_processed_at end,
      gw_deadline = case when gameweek = p_gameweek then now() + interval '15 minutes' else gw_deadline end
  where league_id = p_league_id;
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.start_gameweek_simulation(uuid,integer,integer)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_old_fragment) = 0 then
    raise exception 'start_gameweek_simulation schedule update did not match the expected definition';
  end if;
  execute pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
end;
$$;

-- Repair a currently active rehearsal that is still in its setup phase.
update public.league_gameweeks gameweek
set status = 'WAIVERS_OPEN',
    is_waiver_processed = false,
    waiver_deadline = now() + interval '10 minutes',
    waiver_deadline_time = now() + interval '10 minutes',
    waiver_processed_at = null,
    gw_deadline = greatest(gameweek.gw_deadline, now() + interval '15 minutes')
from public.gameweek_simulation_runs run
where run.status = 'ACTIVE'
  and run.phase = 'PRE_DEADLINE'
  and gameweek.league_id = run.league_id
  and gameweek.gameweek = run.gameweek;

revoke all on function public.start_gameweek_simulation(uuid,integer,integer)
  from public,anon;
grant execute on function public.start_gameweek_simulation(uuid,integer,integer)
  to authenticated,service_role;
