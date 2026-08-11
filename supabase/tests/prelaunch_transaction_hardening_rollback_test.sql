-- Repeatable transaction-hardening regression test.
-- Run against a fully migrated database. Every fixture row is rolled back.
begin;

do $test$
declare
  v_league uuid := gen_random_uuid();
  v_user uuid;
  v_gkp integer[];
  v_def integer[];
  v_mid integer[];
  v_fwd integer[];
  v_starters integer[];
  v_bench integer[];
  v_result jsonb;
  v_claim_one uuid;
  v_claim_two uuid;
  v_priorities integer[];
begin
  if has_table_privilege('authenticated', 'public.waiver_claims', 'INSERT')
     or has_table_privilege('authenticated', 'public.waiver_claims', 'UPDATE')
     or has_table_privilege('authenticated', 'public.waiver_claims', 'DELETE')
     or has_table_privilege('authenticated', 'public.rosters', 'UPDATE')
     or has_table_privilege('authenticated', 'public.draft_picks', 'INSERT') then
    raise exception 'DIRECT_MUTATION_PRIVILEGE_REMAINS';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.submit_waiver_claim(uuid,integer,integer,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.reorder_waiver_claims(uuid,uuid[])',
    'EXECUTE'
  ) then
    raise exception 'HARDENED_RPC_PERMISSION_MISSING';
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.draft_picks'::regclass
      and t.tgname = 'enforce_manual_draft_pick_deadline_trigger'
      and not t.tgisinternal
  ) then
    raise exception 'DRAFT_DEADLINE_TRIGGER_MISSING';
  end if;

  select u.id into v_user from auth.users u order by u.created_at, u.id limit 1;
  if v_user is null then raise exception 'TEST_REQUIRES_AUTH_USER'; end if;

  select array_agg(id order by id) into v_gkp from (
    select id from public.players
    where upper(element_type::text) in ('GKP', 'GK', '1') and coalesce(is_active, true)
    order by id limit 2
  ) selected;
  select array_agg(id order by id) into v_def from (
    select id from public.players
    where upper(element_type::text) in ('DEF', '2') and coalesce(is_active, true)
    order by id limit 7
  ) selected;
  select array_agg(id order by id) into v_mid from (
    select id from public.players
    where upper(element_type::text) in ('MID', '3') and coalesce(is_active, true)
    order by id limit 5
  ) selected;
  select array_agg(id order by id) into v_fwd from (
    select id from public.players
    where upper(element_type::text) in ('FWD', '4') and coalesce(is_active, true)
    order by id limit 4
  ) selected;

  if cardinality(v_gkp) <> 2 or cardinality(v_def) <> 7
     or cardinality(v_mid) <> 5 or cardinality(v_fwd) <> 4 then
    raise exception 'TEST_REQUIRES_COMPLETE_PLAYER_POOL';
  end if;

  insert into public.leagues (
    id, name, commissioner_id, draft_status, status, roster_type,
    max_size, invite_code, code
  ) values (
    v_league, 'CODEX HARDENING ROLLBACK TEST', v_user, 'COMPLETED',
    'IN_SEASON', 'STRICT', 2, 'HT' || substr(v_league::text, 1, 6),
    'HX' || substr(v_league::text, 1, 6)
  );

  insert into public.league_members (league_id, user_id, team_name, draft_order, role)
  values (v_league, v_user, 'Hardening Test Manager', 1, 'COMMISSIONER');

  insert into public.league_settings (league_id, roster_type)
  values (v_league, 'STRICT');

  insert into public.gameweeks (
    gameweek_number, fpl_deadline_time, is_current, is_finished
  ) values (38, pg_catalog.now() + interval '2 hours', true, false)
  on conflict (gameweek_number) do update
  set fpl_deadline_time = excluded.fpl_deadline_time,
      is_current = true,
      is_finished = false;

  insert into public.league_gameweeks (
    league_id, gameweek, gw_deadline, waiver_deadline,
    is_waiver_processed, is_current, is_finished, status
  ) values (
    v_league, 38, pg_catalog.now() + interval '2 hours',
    pg_catalog.now() + interval '1 hour', false, true, false, 'WAIVERS_OPEN'
  );

  insert into public.rosters (
    league_id, user_id, player_id, is_gk, is_starting, bench_order, is_starter
  ) values
    (v_league, v_user, v_gkp[1], true, false, 0, false),
    (v_league, v_user, v_gkp[2], true, false, 0, false),
    (v_league, v_user, v_def[1], false, false, 1, false),
    (v_league, v_user, v_def[2], false, false, 1, false),
    (v_league, v_user, v_def[3], false, false, 1, false),
    (v_league, v_user, v_def[4], false, false, 1, false),
    (v_league, v_user, v_def[5], false, false, 1, false),
    (v_league, v_user, v_mid[1], false, false, 1, false),
    (v_league, v_user, v_mid[2], false, false, 1, false),
    (v_league, v_user, v_mid[3], false, false, 1, false),
    (v_league, v_user, v_mid[4], false, false, 1, false),
    (v_league, v_user, v_mid[5], false, false, 1, false),
    (v_league, v_user, v_fwd[1], false, false, 1, false),
    (v_league, v_user, v_fwd[2], false, false, 1, false),
    (v_league, v_user, v_fwd[3], false, false, 1, false);

  perform pg_catalog.set_config('request.jwt.claim.sub', v_user::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

  v_starters := array[
    v_gkp[1], v_def[1], v_def[2], v_def[3],
    v_mid[1], v_mid[2], v_mid[3], v_mid[4], v_mid[5],
    v_fwd[1], v_fwd[2]
  ];
  v_bench := array[v_gkp[2], v_def[4], v_def[5], v_fwd[3]];
  v_result := public.save_manager_lineup(v_league, v_starters, v_bench);
  if not coalesce((v_result ->> 'success')::boolean, false) then
    raise exception 'TEST_LINEUP_SETUP_FAILED: %', v_result;
  end if;

  v_result := public.submit_waiver_claim(v_league, v_def[6], v_def[4], 38);
  if not coalesce((v_result ->> 'success')::boolean, false)
     or (v_result ->> 'priority_order')::integer <> 1 then
    raise exception 'FIRST_WAIVER_SUBMISSION_FAILED: %', v_result;
  end if;
  v_claim_one := (v_result ->> 'claim_id')::uuid;

  v_result := public.submit_waiver_claim(v_league, v_def[7], v_def[5], 38);
  if not coalesce((v_result ->> 'success')::boolean, false)
     or (v_result ->> 'priority_order')::integer <> 2 then
    raise exception 'SECOND_WAIVER_SUBMISSION_FAILED: %', v_result;
  end if;
  v_claim_two := (v_result ->> 'claim_id')::uuid;

  -- A stale/incomplete client order must be rejected without partial writes.
  v_result := public.reorder_waiver_claims(v_league, array[v_claim_two]);
  if v_result ->> 'error' <> 'CLAIM_ORDER_MISMATCH' then
    raise exception 'STALE_REORDER_WAS_NOT_REJECTED: %', v_result;
  end if;

  v_result := public.reorder_waiver_claims(v_league, array[v_claim_two, v_claim_one]);
  if not coalesce((v_result ->> 'success')::boolean, false) then
    raise exception 'ATOMIC_REORDER_FAILED: %', v_result;
  end if;

  select array_agg(priority_order order by id) into v_priorities
  from public.waiver_claims where id in (v_claim_one, v_claim_two);
  if not (1 = any(v_priorities) and 2 = any(v_priorities)) then
    raise exception 'WAIVER_PRIORITIES_NOT_CONTIGUOUS: %', v_priorities;
  end if;

  v_result := public.cancel_waiver_claim(v_claim_two);
  if not coalesce((v_result ->> 'success')::boolean, false)
     or (select priority_order from public.waiver_claims where id = v_claim_one) <> 1 then
    raise exception 'WAIVER_CANCEL_COMPACTION_FAILED: %', v_result;
  end if;
  perform public.cancel_waiver_claim(v_claim_one);

  update public.leagues set roster_type = 'FLEXIBLE' where id = v_league;
  update public.league_settings set roster_type = 'FLEXIBLE' where league_id = v_league;
  update public.league_gameweeks
  set is_waiver_processed = true,
      waiver_deadline = pg_catalog.now() - interval '1 minute',
      status = 'FREE_AGENCY'
  where league_id = v_league and gameweek = 38;

  -- Replacing one of exactly three starting defenders with a forward would
  -- leave two defenders. The authoritative free-agent route must repair it.
  v_result := public.claim_free_agent_with_history(
    v_league, v_fwd[4], v_def[1], 38
  );
  if not coalesce((v_result ->> 'success')::boolean, false) then
    raise exception 'FLEXIBLE_FREE_AGENT_SWAP_FAILED: %', v_result;
  end if;

  select array_agg(r.player_id order by r.player_id) filter (where r.is_starting)
  into v_starters from public.rosters r
  where r.league_id = v_league and r.user_id = v_user;
  if not public.is_legal_starting_lineup(v_starters) then
    raise exception 'FREE_AGENT_LINEUP_REPAIR_FAILED: %', v_starters;
  end if;

  raise notice 'PRELAUNCH_TRANSACTION_HARDENING_ROLLBACK_TEST_PASSED';
end;
$test$;

rollback;
