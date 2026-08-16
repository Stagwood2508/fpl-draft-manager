-- Creates and validates a cup inside a transaction, then removes every test row.
begin;

do $test$
declare
  v_league_id uuid;
  v_commissioner_id uuid;
  v_participants uuid[];
  v_participant_count integer;
  v_bracket_size integer := 1;
  v_round_count integer := 0;
  v_cup_id uuid;
  v_result jsonb;
  v_expected_opening_fixtures integer;
  v_expected_byes integer;
begin
  if pg_catalog.to_regprocedure(
       'public.create_single_knockout_cup(uuid,text,integer,uuid[],text[])'
     ) is null
     or pg_catalog.to_regprocedure('public.finalize_cup_gameweek(integer)') is null
     or pg_catalog.to_regprocedure('public.get_cup_fixture_board(uuid)') is null then
    raise exception 'cup RPC installation is incomplete';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.create_single_knockout_cup(uuid,text,integer,uuid[],text[])',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', 'public.finalize_cup_gameweek(integer)', 'EXECUTE'
     ) then
    raise exception 'cup mutation permissions are too broad';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated',
       'public.create_single_knockout_cup(uuid,text,integer,uuid[],text[])',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.get_cup_fixture_board(uuid)', 'EXECUTE'
     ) then
    raise exception 'authenticated cup operations are unavailable';
  end if;

  select league.id, league.commissioner_id
  into v_league_id, v_commissioner_id
  from public.leagues league
  where league.commissioner_id is not null
    and (select pg_catalog.count(*) from public.league_members member where member.league_id = league.id) >= 2
  order by league.created_at
  limit 1;

  if v_league_id is null then
    raise exception 'cup rollback test requires one league with at least two managers';
  end if;

  select pg_catalog.array_agg(selected.user_id order by selected.user_id)
  into v_participants
  from (
    select member.user_id
    from public.league_members member
    where member.league_id = v_league_id
    order by member.user_id
    limit 5
  ) selected;

  v_participant_count := pg_catalog.cardinality(v_participants);
  while v_bracket_size < v_participant_count loop
    v_bracket_size := v_bracket_size * 2;
    v_round_count := v_round_count + 1;
  end loop;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_commissioner_id::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := public.create_single_knockout_cup(
    v_league_id,
    'CODEX CUP ROLLBACK ' || pg_catalog.substr(pg_catalog.gen_random_uuid()::text, 1, 8),
    30,
    v_participants,
    array['HIGHEST_STARTER', 'MOST_GOALS', 'MOST_ASSISTS', 'HIGHER_SEED']::text[]
  );

  if not coalesce((v_result ->> 'success')::boolean, false) then
    raise exception 'cup creation failed: %', v_result;
  end if;

  v_cup_id := (v_result ->> 'cup_id')::uuid;
  if (select cup.participant_count from public.cups cup where cup.id = v_cup_id) <> v_participant_count
     or (select pg_catalog.count(*) from public.cup_entries entry where entry.cup_id = v_cup_id) <> v_participant_count
     or (select pg_catalog.count(*) from public.cup_rounds round where round.cup_id = v_cup_id) <> v_round_count then
    raise exception 'cup metadata, entries or rounds were generated incorrectly';
  end if;

  v_expected_opening_fixtures := v_bracket_size / 2;
  v_expected_byes := v_bracket_size - v_participant_count;

  if (select pg_catalog.count(*) from public.cup_fixtures fixture where fixture.cup_id = v_cup_id) <> v_expected_opening_fixtures
     or (select pg_catalog.count(*) from public.cup_fixtures fixture where fixture.cup_id = v_cup_id and fixture.status = 'BYE') <> v_expected_byes then
    raise exception 'opening fixtures or byes were generated incorrectly';
  end if;

  if exists (
    select entry.user_id
    from public.cup_entries entry
    left join lateral (
      select fixture.home_user_id as user_id
      from public.cup_fixtures fixture
      where fixture.cup_id = v_cup_id and fixture.round_number = 1
      union all
      select fixture.away_user_id
      from public.cup_fixtures fixture
      where fixture.cup_id = v_cup_id and fixture.round_number = 1
        and fixture.away_user_id is not null
    ) appearance on appearance.user_id = entry.user_id
    where entry.cup_id = v_cup_id
    group by entry.user_id
    having pg_catalog.count(appearance.user_id) <> 1
  ) then
    raise exception 'an entrant is missing or appears twice in the opening draw';
  end if;

  raise notice 'CUP_COMPETITION_ROLLBACK_TEST_PASSED';
end;
$test$;

rollback;
