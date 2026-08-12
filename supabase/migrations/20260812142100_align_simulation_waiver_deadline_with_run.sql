-- Keep the waiver setup stage open for the lifetime of the rehearsal. The
-- PROCESS_WAIVERS action closes it explicitly and processes the queue.

do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.start_gameweek_simulation(uuid,integer,integer)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'now() + interval ''10 minutes'' else waiver_deadline end') = 0
     or pg_catalog.strpos(v_definition, 'now() + interval ''15 minutes'' else gw_deadline end') = 0 then
    raise exception 'start_gameweek_simulation rehearsal deadlines did not match the expected definition';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    'now() + interval ''10 minutes'' else waiver_deadline end',
    'now() + make_interval(mins => least(greatest(p_duration_minutes, 30), 480)) else waiver_deadline end'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'now() + interval ''10 minutes'' else waiver_deadline_time end',
    'now() + make_interval(mins => least(greatest(p_duration_minutes, 30), 480)) else waiver_deadline_time end'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'now() + interval ''15 minutes'' else gw_deadline end',
    'now() + make_interval(mins => least(greatest(p_duration_minutes, 30), 480)) else gw_deadline end'
  );
  execute v_definition;
end;
$$;

update public.league_gameweeks gameweek
set waiver_deadline = run.expires_at,
    waiver_deadline_time = run.expires_at,
    gw_deadline = run.expires_at
from public.gameweek_simulation_runs run
where run.status = 'ACTIVE'
  and run.phase = 'PRE_DEADLINE'
  and gameweek.league_id = run.league_id
  and gameweek.gameweek = run.gameweek;

revoke all on function public.start_gameweek_simulation(uuid,integer,integer)
  from public,anon;
grant execute on function public.start_gameweek_simulation(uuid,integer,integer)
  to authenticated,service_role;
