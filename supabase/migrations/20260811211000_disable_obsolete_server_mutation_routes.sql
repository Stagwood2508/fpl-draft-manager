-- Preserve obsolete hosted functions for forensic/recovery purposes, but
-- remove all app-facing execution privileges. These functions target retired
-- columns or tables and are not referenced by the current client.

do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'get_manager_luck_analysis',
        'get_manager_luck_index',
        'process_weekly_waiver_claims',
        'check_and_process_all_leagues',
        'execute_auto_pick',
        'simulate_single_gameweek',
        'simulate_full_season'
      ])
  loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated',
      v_function.signature
    );
  end loop;
end;
$$;
