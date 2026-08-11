-- Pure schedule regression checks. No production rows are created or changed.
begin;

do $test$
declare
  v_manager_count integer;
  v_manager_ids uuid[];
  v_expected_rows integer;
  v_actual_rows integer;
begin
  for v_manager_count in 2..12 loop
    select array_agg(gen_random_uuid())
    into v_manager_ids
    from generate_series(1, v_manager_count);

    v_expected_rows := 38 * ((v_manager_count + 1) / 2);

    select count(*) into v_actual_rows
    from public.build_league_fixture_pairings(v_manager_ids, 38);

    if v_actual_rows <> v_expected_rows then
      raise exception 'WRONG_FIXTURE_COUNT_FOR_%_MANAGERS:%/%',
        v_manager_count, v_actual_rows, v_expected_rows;
    end if;

    if exists (
      with pairings as (
        select * from public.build_league_fixture_pairings(v_manager_ids, 38)
      ),
      appearances as (
        select gameweek, home_user_id as user_id from pairings
        union all
        select gameweek, away_user_id from pairings where away_user_id is not null
      )
      select 1
      from generate_series(1, 38) as expected_gameweek(gameweek)
      cross join unnest(v_manager_ids) manager(user_id)
      left join appearances appearance
        on appearance.gameweek = gameweek
       and appearance.user_id = manager.user_id
      group by gameweek, manager.user_id
      having count(appearance.user_id) <> 1
    ) then
      raise exception 'MANAGER_DOUBLE_BOOKED_OR_MISSING_FOR_%_MANAGERS', v_manager_count;
    end if;

    if exists (
      select 1
      from public.build_league_fixture_pairings(v_manager_ids, 38) pairing
      where pairing.home_user_id is null
        or pairing.home_user_id = pairing.away_user_id
        or (pairing.is_league_average and pairing.away_user_id is not null)
        or (not pairing.is_league_average and pairing.away_user_id is null)
    ) then
      raise exception 'INVALID_PAIRING_FOR_%_MANAGERS', v_manager_count;
    end if;

    if exists (
      select 1
      from public.build_league_fixture_pairings(v_manager_ids, 38) pairing
      group by pairing.gameweek
      having count(*) filter (where pairing.is_league_average)
        <> case when v_manager_count % 2 = 1 then 1 else 0 end
    ) then
      raise exception 'WRONG_AVERAGE_FIXTURE_COUNT_FOR_%_MANAGERS', v_manager_count;
    end if;

    -- Every real opponent (plus the average in odd leagues) must rotate as
    -- evenly as a 38-gameweek season permits: counts differ by at most one.
    if exists (
      with opponent_counts as (
        select manager_id, opponent_key, count(*)::integer as meetings
        from (
          select
            pairing.home_user_id as manager_id,
            coalesce(pairing.away_user_id::text, 'LEAGUE_AVERAGE') as opponent_key
          from public.build_league_fixture_pairings(v_manager_ids, 38) pairing
          union all
          select pairing.away_user_id, pairing.home_user_id::text
          from public.build_league_fixture_pairings(v_manager_ids, 38) pairing
          where pairing.away_user_id is not null
        ) meetings
        group by manager_id, opponent_key
      ), spreads as (
        select manager_id, min(meetings) as minimum, max(meetings) as maximum
        from opponent_counts
        group by manager_id
      )
      select 1 from spreads where maximum - minimum > 1
    ) then
      raise exception 'UNFAIR_OPPONENT_ROTATION_FOR_%_MANAGERS', v_manager_count;
    end if;

    -- Repeated head-to-head meetings must alternate venue. With a partial
    -- final cycle, either manager can have at most one extra home meeting.
    if exists (
      with directed_meetings as (
        select
          least(pairing.home_user_id, pairing.away_user_id) as manager_one,
          greatest(pairing.home_user_id, pairing.away_user_id) as manager_two,
          count(*) filter (
            where pairing.home_user_id = least(pairing.home_user_id, pairing.away_user_id)
          )::integer as manager_one_home,
          count(*) filter (
            where pairing.home_user_id = greatest(pairing.home_user_id, pairing.away_user_id)
          )::integer as manager_two_home
        from public.build_league_fixture_pairings(v_manager_ids, 38) pairing
        where not pairing.is_league_average
        group by
          least(pairing.home_user_id, pairing.away_user_id),
          greatest(pairing.home_user_id, pairing.away_user_id)
      )
      select 1
      from directed_meetings
      where abs(manager_one_home - manager_two_home) > 1
    ) then
      raise exception 'UNBALANCED_HOME_AWAY_PAIR_FOR_%_MANAGERS', v_manager_count;
    end if;
  end loop;

  raise notice 'FIXTURE_GENERATION_ROLLBACK_TEST_PASSED';
end;
$test$;

rollback;
