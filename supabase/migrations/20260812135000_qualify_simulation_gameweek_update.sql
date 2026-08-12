-- The project rejects unqualified UPDATE statements. Scope the simulation's
-- reset of current-Gameweek flags to the valid FPL Gameweek key range.

do $$
declare
  v_definition text;
  v_old_fragment constant text :=
    'update public.gameweeks set is_current = false;';
  v_new_fragment constant text :=
    'update public.gameweeks set is_current = false where gameweek_number between 1 and 38;';
begin
  select pg_catalog.pg_get_functiondef(
    'public.start_gameweek_simulation(uuid,integer,integer)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, v_old_fragment) = 0 then
    raise exception 'start_gameweek_simulation did not contain the expected current-Gameweek update';
  end if;

  execute pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
end;
$$;

revoke all on function public.start_gameweek_simulation(uuid,integer,integer)
  from public, anon;
grant execute on function public.start_gameweek_simulation(uuid,integer,integer)
  to authenticated, service_role;
