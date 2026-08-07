-- Repair the two already-deployed waiver functions without duplicating their
-- bodies: GREATEST is SQL syntax and cannot be schema-qualified.
do $$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.get_my_waiver_status(uuid)'::regprocedure,
    'public.process_league_waivers(uuid,integer)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_signature::oid) into v_definition;
    execute replace(v_definition, 'pg_catalog.greatest', 'greatest');
  end loop;
end;
$$;
