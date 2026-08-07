-- FREE_AGENT/COMPLETED are intentionally not values in the legacy trade and
-- waiver transaction table. Free-agent activity has its own atomic history
-- table, so remove the incompatible legacy audit insert from the deployed RPC.
do $$
declare
  v_signature regprocedure := 'public.claim_free_agent(uuid,integer,integer,integer)'::regprocedure;
  v_definition text;
  v_start integer;
  v_relative_end integer;
begin
  select pg_get_functiondef(v_signature::oid) into v_definition;
  v_start := strpos(v_definition, '  insert into public.transactions (');

  if v_start = 0 then
    raise exception 'Expected legacy free-agent transaction insert was not found.';
  end if;

  v_relative_end := strpos(
    substr(v_definition, v_start),
    '  return jsonb_build_object'
  );

  if v_relative_end = 0 then
    raise exception 'Expected free-agent success return was not found.';
  end if;

  v_definition := overlay(
    v_definition placing '' from v_start for v_relative_end - 1
  );
  execute v_definition;
end;
$$;
