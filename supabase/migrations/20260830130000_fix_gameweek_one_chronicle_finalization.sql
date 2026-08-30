-- GW1 has no prior table from which to calculate an upset. The Chronicle
-- generator previously dereferenced its unassigned record anyway, causing the
-- fixture-finalization update (and therefore the entire deadline transaction)
-- to roll back.

do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.generate_league_chronicle(uuid,integer,boolean)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'v_upset record;') = 0
     or pg_catalog.strpos(v_definition, 'select * into v_upset from upsets where winner_rank > loser_rank order by winner_rank - loser_rank desc limit 1;') = 0
     or pg_catalog.strpos(v_definition, 'if v_upset.id is not null then') = 0 then
    raise exception 'generate_league_chronicle did not match the expected GW1 upset definition';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    'v_upset record;',
    'v_upset record;' || E'\n  ' || 'v_has_upset boolean := false;'
  );

  v_definition := pg_catalog.replace(
    v_definition,
    'select * into v_upset from upsets where winner_rank > loser_rank order by winner_rank - loser_rank desc limit 1;',
    'select * into v_upset from upsets where winner_rank > loser_rank order by winner_rank - loser_rank desc limit 1;' ||
      E'\n    ' || 'v_has_upset := found;'
  );

  v_definition := pg_catalog.replace(
    v_definition,
    'if v_upset.id is not null then',
    'if v_has_upset then'
  );

  execute v_definition;
end;
$$;

comment on function public.generate_league_chronicle(uuid, integer, boolean) is
  'Generates a deterministic finalized Gameweek Chronicle; GW1 safely omits prior-table upset analysis.';
