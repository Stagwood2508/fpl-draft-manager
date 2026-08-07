-- Transactional production-schema smoke test. All fixture data is deliberately
-- rolled back inside the exception block; only this migration record persists.
do $$
declare
  v_league uuid := gen_random_uuid();
  v_users uuid[];
  v_gkp integer[];
  v_def integer[];
  v_mid integer[];
  v_fwd integer[];
  v_i integer;
  v_offset integer;
  v_result jsonb;
  v_starting integer[];
  v_bench integer[];
  v_snapshot_id uuid;
  v_audit_count integer;
  v_test_gameweek integer;
  v_passes text[] := array[]::text[];
begin
  begin
    select array_agg(id order by created_at, id)
    into v_users
    from (select id, created_at from auth.users order by created_at, id limit 3) selected;

    if cardinality(coalesce(v_users, array[]::uuid[])) < 3 then
      raise exception 'TEST_SETUP_REQUIRES_THREE_USERS';
    end if;

    select array_agg(id order by id) into v_gkp from (
      select id from public.players where upper(element_type::text) in ('GKP', 'GK', '1') order by id limit 6
    ) selected;
    select array_agg(id order by id) into v_def from (
      select id from public.players where upper(element_type::text) in ('DEF', '2') order by id limit 24
    ) selected;
    select array_agg(id order by id) into v_mid from (
      select id from public.players where upper(element_type::text) in ('MID', '3') order by id limit 18
    ) selected;
    select array_agg(id order by id) into v_fwd from (
      select id from public.players where upper(element_type::text) in ('FWD', '4') order by id limit 9
    ) selected;

    if cardinality(v_gkp) < 6 or cardinality(v_def) < 24
       or cardinality(v_mid) < 18 or cardinality(v_fwd) < 9 then
      raise exception 'TEST_SETUP_REQUIRES_COMPLETE_PLAYER_POOL';
    end if;

    insert into public.leagues (
      id, name, commissioner_id, draft_status, status, roster_type,
      max_size, invite_code, code
    ) values (
      v_league, 'CODEX LIFECYCLE SMOKE TEST', v_users[1], 'COMPLETED',
      'IN_SEASON', 'STRICT', 3, 'CX' || substr(v_league::text, 1, 6),
      'CT' || substr(v_league::text, 1, 6)
    );

    for v_i in 1..3 loop
      insert into public.league_members (league_id, user_id, team_name, draft_order, role)
      values (
        v_league, v_users[v_i], 'Codex Test Manager ' || v_i, v_i,
        case when v_i = 1 then 'COMMISSIONER' else 'MEMBER' end
      );
    end loop;

    insert into public.league_settings (
      league_id, roster_type, trade_cutoff_rule,
      dropped_player_rule, initial_waiver_order_rule
    ) values (
      v_league, 'STRICT', 'WAIVER_DEADLINE', 'NEXT_WAIVER', 'REVERSE_DRAFT'
    );

    for v_i in 1..3 loop
      v_offset := (v_i - 1) * 5;

      insert into public.rosters (
        league_id, user_id, player_id, is_gk, is_starting,
        bench_order, is_starter
      ) values
        (v_league, v_users[v_i], v_gkp[(v_i - 1) * 2 + 1], true, true, null, true),
        (v_league, v_users[v_i], v_gkp[(v_i - 1) * 2 + 2], true, false, 0, false),
        (v_league, v_users[v_i], v_def[v_offset + 1], false, true, null, true),
        (v_league, v_users[v_i], v_def[v_offset + 2], false, true, null, true),
        (v_league, v_users[v_i], v_def[v_offset + 3], false, true, null, true),
        (v_league, v_users[v_i], v_def[v_offset + 4], false, true, null, true),
        (v_league, v_users[v_i], v_def[v_offset + 5], false, false, 1, false),
        (v_league, v_users[v_i], v_mid[v_offset + 1], false, true, null, true),
        (v_league, v_users[v_i], v_mid[v_offset + 2], false, true, null, true),
        (v_league, v_users[v_i], v_mid[v_offset + 3], false, true, null, true),
        (v_league, v_users[v_i], v_mid[v_offset + 4], false, true, null, true),
        (v_league, v_users[v_i], v_mid[v_offset + 5], false, false, 2, false),
        (v_league, v_users[v_i], v_fwd[(v_i - 1) * 3 + 1], false, true, null, true),
        (v_league, v_users[v_i], v_fwd[(v_i - 1) * 3 + 2], false, true, null, true),
        (v_league, v_users[v_i], v_fwd[(v_i - 1) * 3 + 3], false, false, 3, false);
    end loop;

    insert into public.league_gameweeks (
      league_id, gameweek, gw_deadline, waiver_deadline,
      is_waiver_processed, is_current, is_finished, status
    ) values (
      v_league, 1, pg_catalog.now() + interval '2 hours',
      pg_catalog.now() - interval '1 minute', false, true, false, 'WAIVERS_OPEN'
    )
    on conflict (league_id, gameweek) do update
    set gw_deadline = excluded.gw_deadline,
        waiver_deadline = excluded.waiver_deadline,
        is_waiver_processed = excluded.is_waiver_processed,
        is_current = excluded.is_current,
        is_finished = excluded.is_finished,
        status = excluded.status;

    -- Reverse draft order, overlapping first choices and two successful passes.
    insert into public.waiver_claims (
      league_id, user_id, player_to_add, player_to_drop, priority_order, gameweek
    ) values
      (v_league, v_users[3], v_def[16], v_def[11], 1, 1),
      (v_league, v_users[3], v_def[19], v_def[12], 2, 1),
      (v_league, v_users[2], v_def[16], v_def[6], 1, 1),
      (v_league, v_users[2], v_def[17], v_def[6], 2, 1),
      (v_league, v_users[2], v_def[20], v_def[7], 3, 1),
      (v_league, v_users[1], v_def[18], v_def[1], 1, 1),
      (v_league, v_users[1], v_def[21], v_def[2], 2, 1);

    v_result := public.process_league_waivers(v_league, 1);
    if not coalesce((v_result->>'success')::boolean, false)
       or (v_result->>'successful_claims')::integer <> 6
       or (v_result->>'failed_claims')::integer <> 1
       or (v_result->>'passes_completed')::integer <> 3 then
      raise exception 'WAIVER_REPEATED_PASS_TEST_FAILED: %', v_result;
    end if;
    if (select count(*) from public.waiver_player_locks where league_id = v_league) <> 6 then
      raise exception 'WAIVER_DROPPED_PLAYER_LOCK_TEST_FAILED';
    end if;
    v_passes := array_append(v_passes, 'waiver repeated passes and protected drops');

    -- Genuine table position for GW2: manager 3 loses to manager 1 in GW1.
    insert into public.league_fixtures (
      league_id, gameweek, home_user_id, away_user_id,
      home_team_name, away_team_name, is_finished
    ) values (
      v_league, 1, v_users[1], v_users[3],
      'Codex Test Manager 1', 'Codex Test Manager 3', true
    );

    insert into public.player_gameweek_stats (player_id, gameweek, minutes, total_points)
    select r.player_id, 1, 90, case when r.user_id = v_users[1] then 10 else 1 end
    from public.rosters r
    where r.league_id = v_league and r.user_id in (v_users[1], v_users[3]) and r.is_starting
    on conflict (player_id, gameweek) do update
      set minutes = excluded.minutes, total_points = excluded.total_points;

    update public.leagues set draft_status = 'PRE_DRAFT' where id = v_league;
    update public.league_settings set dropped_player_rule = 'IMMEDIATE_FREE_AGENT' where league_id = v_league;
    update public.leagues set draft_status = 'COMPLETED' where id = v_league;

    insert into public.league_gameweeks (
      league_id, gameweek, gw_deadline, waiver_deadline,
      is_waiver_processed, is_current, is_finished, status
    ) values (
      v_league, 2, pg_catalog.now() + interval '2 hours',
      pg_catalog.now() - interval '1 minute', false, true, false, 'WAIVERS_OPEN'
    )
    on conflict (league_id, gameweek) do update
    set gw_deadline = excluded.gw_deadline,
        waiver_deadline = excluded.waiver_deadline,
        is_waiver_processed = excluded.is_waiver_processed,
        is_current = excluded.is_current,
        is_finished = excluded.is_finished,
        status = excluded.status;

    insert into public.waiver_claims (
      league_id, user_id, player_to_add, player_to_drop, priority_order, gameweek
    ) values
      (v_league, v_users[3], v_def[22], v_def[13], 1, 2),
      (v_league, v_users[1], v_def[22], v_def[3], 1, 2);

    v_result := public.process_league_waivers(v_league, 2);
    if not coalesce((v_result->>'success')::boolean, false)
       or not exists (
         select 1 from public.rosters
         where league_id = v_league and user_id = v_users[3] and player_id = v_def[22]
       ) then
      raise exception 'BOTTOM_TO_TOP_WAIVER_ORDER_TEST_FAILED: %', v_result;
    end if;
    if exists (
      select 1 from public.waiver_player_locks
      where league_id = v_league and player_id = v_def[13]
    ) then
      raise exception 'IMMEDIATE_FREE_AGENT_DROP_TEST_FAILED';
    end if;
    v_passes := array_append(v_passes, 'bottom-to-top priority and immediate drops');

    -- Authenticated free-agent success plus invalid and locked-player rejection.
    perform set_config('request.jwt.claim.sub', v_users[1]::text, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_users[1], 'role', 'authenticated')::text,
      true
    );

    v_result := public.claim_free_agent_with_history(v_league, v_def[23], v_def[4], 2);
    if not coalesce((v_result->>'success')::boolean, false)
       or not exists (
         select 1 from public.free_agent_transactions
         where league_id = v_league and user_id = v_users[1]
           and player_in_id = v_def[23] and player_out_id = v_def[4]
       ) then
      raise exception 'FREE_AGENT_ATOMIC_HISTORY_TEST_FAILED: %', v_result;
    end if;

    v_result := public.claim_free_agent_with_history(v_league, v_mid[16], v_def[5], 2);
    if v_result->>'error' <> 'POSITION_MISMATCH' then
      raise exception 'FREE_AGENT_POSITION_VALIDATION_TEST_FAILED: %', v_result;
    end if;

    v_result := public.claim_free_agent_with_history(v_league, v_def[1], v_def[5], 1);
    if v_result->>'error' <> 'PLAYER_WAIVER_LOCKED' then
      raise exception 'FREE_AGENT_PLAYER_LOCK_TEST_FAILED: %', v_result;
    end if;
    v_passes := array_append(v_passes, 'free-agent atomicity, history and validation');

    -- Build a legal 4-4-2 lineup from manager 1's post-transaction roster.
    select array_agg(player_id order by player_id) into v_starting
    from (
      (select r.player_id from public.rosters r join public.players p on p.id = r.player_id
       where r.league_id = v_league and r.user_id = v_users[1]
         and upper(p.element_type::text) in ('GKP', 'GK', '1') order by r.player_id limit 1)
      union all
      (select r.player_id from public.rosters r join public.players p on p.id = r.player_id
       where r.league_id = v_league and r.user_id = v_users[1]
         and upper(p.element_type::text) in ('DEF', '2') order by r.player_id limit 4)
      union all
      (select r.player_id from public.rosters r join public.players p on p.id = r.player_id
       where r.league_id = v_league and r.user_id = v_users[1]
         and upper(p.element_type::text) in ('MID', '3') order by r.player_id limit 4)
      union all
      (select r.player_id from public.rosters r join public.players p on p.id = r.player_id
       where r.league_id = v_league and r.user_id = v_users[1]
         and upper(p.element_type::text) in ('FWD', '4') order by r.player_id limit 2)
    ) selected;

    select array_agg(r.player_id order by
      case when upper(p.element_type::text) in ('GKP', 'GK', '1') then 0
           when upper(p.element_type::text) in ('FWD', '4') then 1
           when upper(p.element_type::text) in ('MID', '3') then 2 else 3 end,
      r.player_id)
    into v_bench
    from public.rosters r
    join public.players p on p.id = r.player_id
    where r.league_id = v_league and r.user_id = v_users[1]
      and not (r.player_id = any(v_starting));

    update public.gameweeks
    set fpl_deadline_time = pg_catalog.now() + (gameweek_number || ' days')::interval,
        is_finished = false;

    v_result := public.save_manager_lineup(v_league, v_starting, v_bench);
    if not coalesce((v_result->>'success')::boolean, false) then
      raise exception 'PRE_DEADLINE_LINEUP_SAVE_TEST_FAILED: %', v_result;
    end if;

    v_test_gameweek := (select max(gameweek_number) from public.gameweeks);
    update public.gameweeks
    set fpl_deadline_time = pg_catalog.now() - interval '1 minute', is_finished = false
    where gameweek_number = v_test_gameweek;

    v_result := public.save_manager_lineup(v_league, v_starting, v_bench);
    if v_result->>'error' <> 'LINEUP_LOCKED' or not exists (
      select 1 from public.gameweek_lineup_snapshots
      where league_id = v_league and user_id = v_users[1] and gameweek = v_test_gameweek
    ) then
      raise exception 'LINEUP_DEADLINE_LOCK_TEST_FAILED: %', v_result;
    end if;
    v_passes := array_append(v_passes, 'lineup pre-deadline save and deadline lock');

    delete from public.gameweek_lineup_snapshots where league_id = v_league;
    update public.gameweeks
    set fpl_deadline_time = pg_catalog.now() + interval '30 days', is_finished = false
    where gameweek_number = v_test_gameweek;
    update public.league_gameweeks
    set gw_deadline = pg_catalog.now() + interval '30 days'
    where league_id = v_league and gameweek = v_test_gameweek;

    insert into public.gameweek_lineup_snapshots (
      league_id, user_id, gameweek, deadline_at,
      starting_player_ids, bench_player_ids,
      effective_starting_player_ids, effective_bench_player_ids, status
    ) values (
      v_league, v_users[1], v_test_gameweek, pg_catalog.now(),
      v_starting, v_bench, v_starting, v_bench, 'LOCKED'
    ) returning id into v_snapshot_id;

    insert into public.player_gameweek_stats (player_id, gameweek, minutes, total_points)
    select player_id, v_test_gameweek, 90, 2
    from unnest(v_starting || v_bench) submitted(player_id)
    on conflict (player_id, gameweek) do update
      set minutes = excluded.minutes, total_points = excluded.total_points;

    -- Starting goalkeeper and two starting defenders miss out. Only the bench
    -- goalkeeper and first-priority forward play, leaving one legal unresolved absence.
    update public.player_gameweek_stats set minutes = 0
    where gameweek = v_test_gameweek and player_id = (
      select player_id from unnest(v_starting) submitted(player_id)
      join public.players p on p.id = submitted.player_id
      where upper(p.element_type::text) in ('GKP', 'GK', '1') limit 1
    );
    update public.player_gameweek_stats set minutes = 0
    where gameweek = v_test_gameweek and player_id in (
      select player_id from unnest(v_starting) submitted(player_id)
      join public.players p on p.id = submitted.player_id
      where upper(p.element_type::text) in ('DEF', '2') order by player_id limit 2
    );
    update public.player_gameweek_stats set minutes = 0
    where gameweek = v_test_gameweek and player_id = any(v_bench[3:4]);

    v_result := public.process_gameweek_autosubs(v_league, v_test_gameweek, true);
    if not coalesce((v_result->>'success')::boolean, false)
       or (v_result->>'swaps')::integer <> 2
       or (v_result->>'unresolved_absences')::integer <> 1
       or not public.is_legal_starting_lineup((
         select effective_starting_player_ids from public.gameweek_lineup_snapshots
         where id = v_snapshot_id
       )) then
      raise exception 'AUTOSUB_PRIORITY_FORMATION_TEST_FAILED: %', v_result;
    end if;

    select count(*) into v_audit_count
    from public.gameweek_autosub_audit where snapshot_id = v_snapshot_id;
    v_result := public.process_gameweek_autosubs(v_league, v_test_gameweek, true);
    if (v_result->>'lineups_processed')::integer <> 0 or v_audit_count <> (
      select count(*) from public.gameweek_autosub_audit where snapshot_id = v_snapshot_id
    ) then
      raise exception 'AUTOSUB_REPEAT_SAFETY_TEST_FAILED: %', v_result;
    end if;
    v_passes := array_append(v_passes, 'autosub priority, formation and repeat safety');

    raise exception 'CODEX_SMOKE_TEST_ROLLBACK';
  exception
    when raise_exception then
      if sqlerrm <> 'CODEX_SMOKE_TEST_ROLLBACK' then
        raise;
      end if;
  end;

  raise notice 'INSEASON_SMOKE_TEST_PASSED|%', array_to_string(v_passes, '|');
end;
$$;
