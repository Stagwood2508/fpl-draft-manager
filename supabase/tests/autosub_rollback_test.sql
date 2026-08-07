begin;

do $test$
declare
  v_league uuid;
  v_user uuid;
  v_starters integer[];
  v_bench integer[];
  v_start_gk integer;
  v_bench_gk integer;
  v_start_out integer;
  v_bench_out integer;
  v_snapshot uuid;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  select r.league_id, r.user_id into v_league, v_user
  from public.rosters r
  group by r.league_id, r.user_id
  having count(*) = 15
  limit 1;

  if v_user is null then
    raise exception 'NO_COMPLETE_ROSTER';
  end if;

  select
    array_agg(r.player_id order by r.player_id) filter (where r.is_starting),
    array_agg(r.player_id order by r.bench_order nulls last, r.player_id) filter (where not r.is_starting),
    jsonb_agg(jsonb_build_object('id', r.id, 'starting', r.is_starting, 'bench', r.bench_order) order by r.id)
  into v_starters, v_bench, v_before
  from public.rosters r
  where r.league_id = v_league and r.user_id = v_user;

  if not public.is_legal_starting_lineup(v_starters) then
    raise exception 'SOURCE_LINEUP_INVALID';
  end if;

  select submitted.player_id into v_start_gk
  from unnest(v_starters) submitted(player_id)
  join public.players p on p.id = submitted.player_id
  where upper(p.element_type::text) in ('GKP', 'GK', '1')
  limit 1;

  select submitted.player_id into v_bench_gk
  from unnest(v_bench) submitted(player_id)
  join public.players p on p.id = submitted.player_id
  where upper(p.element_type::text) in ('GKP', 'GK', '1')
  limit 1;

  select bench.player_id, starter.player_id
  into v_bench_out, v_start_out
  from unnest(v_bench) with ordinality bench(player_id, ordinality)
  join public.players bench_player on bench_player.id = bench.player_id
  join lateral (
    select submitted.player_id
    from unnest(v_starters) submitted(player_id)
    join public.players starting_player on starting_player.id = submitted.player_id
    where upper(starting_player.element_type::text) = upper(bench_player.element_type::text)
      and upper(starting_player.element_type::text) not in ('GKP', 'GK', '1')
    limit 1
  ) starter on true
  where upper(bench_player.element_type::text) not in ('GKP', 'GK', '1')
  order by bench.ordinality
  limit 1;

  insert into public.gameweek_lineup_snapshots (
    league_id, user_id, gameweek, deadline_at,
    starting_player_ids, bench_player_ids,
    effective_starting_player_ids, effective_bench_player_ids
  ) values (
    v_league, v_user, 38, now() - interval '1 hour',
    v_starters, v_bench, v_starters, v_bench
  ) returning id into v_snapshot;

  insert into public.player_gameweek_stats(player_id, gameweek, minutes)
  select player_id, 38, 90 from unnest(v_starters || v_bench) players(player_id)
  on conflict (player_id, gameweek) do update set minutes = excluded.minutes;

  update public.player_gameweek_stats
  set minutes = 0
  where gameweek = 38 and player_id in (v_start_gk, v_start_out);

  v_result := public.process_gameweek_autosubs(v_league, 38, true);

  if coalesce((v_result ->> 'swaps')::integer, 0) <> 2 then
    raise exception 'EXPECTED_TWO_SWAPS: %', v_result;
  end if;

  if not exists (
    select 1 from public.gameweek_lineup_snapshots snapshot
    where snapshot.id = v_snapshot
      and snapshot.status = 'PROCESSED'
      and v_bench_gk = any(snapshot.effective_starting_player_ids)
      and v_bench_out = any(snapshot.effective_starting_player_ids)
      and public.is_legal_starting_lineup(snapshot.effective_starting_player_ids)
  ) then
    raise exception 'EFFECTIVE_LINEUP_INVALID';
  end if;

  select jsonb_agg(
    jsonb_build_object('id', r.id, 'starting', r.is_starting, 'bench', r.bench_order)
    order by r.id
  ) into v_after
  from public.rosters r
  where r.league_id = v_league and r.user_id = v_user;

  if v_before <> v_after then
    raise exception 'LIVE_ROSTER_WAS_MUTATED';
  end if;

  raise notice 'AUTOSUB_SNAPSHOT_ROLLBACK_TEST_PASSED %', v_result;
end;
$test$;

do $deadline_test$
declare
  v_league uuid;
  v_starters integer[];
  v_bench integer[];
  v_result jsonb;
begin
  select
    r.league_id,
    array_agg(r.player_id order by r.player_id) filter (where r.is_starting),
    array_agg(r.player_id order by r.bench_order nulls last, r.player_id) filter (where not r.is_starting)
  into v_league, v_starters, v_bench
  from public.rosters r
  group by r.league_id, r.user_id
  having count(*) = 15
  limit 1;

  insert into public.gameweeks(gameweek_number, fpl_deadline_time, is_current, is_finished)
  values (38, now() - interval '1 minute', true, false)
  on conflict (gameweek_number) do update
  set fpl_deadline_time = excluded.fpl_deadline_time,
      is_current = true,
      is_finished = false;

  v_result := public.save_manager_lineup(v_league, v_starters, v_bench);
  if v_result ->> 'error' <> 'LINEUP_LOCKED' then
    raise exception 'DEADLINE_LOCK_FAILED: %', v_result;
  end if;

  raise notice 'LINEUP_DEADLINE_ROLLBACK_TEST_PASSED %', v_result;
end;
$deadline_test$;

rollback;
