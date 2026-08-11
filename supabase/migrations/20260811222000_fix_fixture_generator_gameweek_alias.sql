-- Qualify the generated Gameweek column inside the deployed fixture generator.
-- The unqualified name conflicts with the output column of the pairing function.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.generate_league_fixtures(uuid)'::regprocedure::oid
  ) into v_definition;

  if position('on appearance.gameweek = gameweek' in v_definition) = 0 then
    raise exception 'FIXTURE_GENERATOR_GAMEWEEK_REFERENCE_NOT_FOUND';
  end if;

  v_definition := replace(
    v_definition,
    'on appearance.gameweek = gameweek',
    'on appearance.gameweek = expected_gameweek.gameweek'
  );
  v_definition := replace(
    v_definition,
    'group by gameweek, manager.user_id',
    'group by expected_gameweek.gameweek, manager.user_id'
  );

  execute v_definition;
end;
$$;
