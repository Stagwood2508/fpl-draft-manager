-- Refresh effective live lineups as individual Premier League fixtures finish,
-- while keeping deadline snapshots LOCKED until the authoritative end-of-GW
-- autosub processor confirms the final result and writes its audit trail.

create or replace function public.refresh_provisional_gameweek_autosubs(
  p_gameweek integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot record;
  v_effective integer[];
  v_effective_bench integer[];
  v_candidate integer[];
  v_starting_gk integer;
  v_bench_gk integer;
  v_bench_player integer;
  v_absent_starter integer;
  v_swap_count integer := 0;
  v_snapshot_count integer := 0;
begin
  if p_gameweek not between 1 and 38 then
    return pg_catalog.jsonb_build_object('success', false, 'error', 'INVALID_GAMEWEEK');
  end if;

  -- Missing fixture coverage must never be interpreted as every player having
  -- completed a blank. The live synchroniser populates this table first.
  if not exists (select 1 from public.fixtures fixture where fixture.gameweek = p_gameweek) then
    return pg_catalog.jsonb_build_object(
      'success', true,
      'gameweek', p_gameweek,
      'snapshots_refreshed', 0,
      'provisional_swaps', 0,
      'reason', 'FIXTURE_DATA_NOT_READY'
    );
  end if;

  perform public.capture_due_gameweek_lineups(p_gameweek);

  for v_snapshot in
    select snapshot.*
    from public.gameweek_lineup_snapshots snapshot
    where snapshot.gameweek = p_gameweek
      and snapshot.status = 'LOCKED'
    for update
  loop
    v_effective := v_snapshot.starting_player_ids;
    v_effective_bench := v_snapshot.bench_player_ids;

    select submitted.player_id into v_starting_gk
    from pg_catalog.unnest(v_snapshot.starting_player_ids) submitted(player_id)
    join public.players player on player.id = submitted.player_id
    where pg_catalog.upper(player.element_type::text) in ('GKP', 'GK', '1')
    limit 1;

    select submitted.player_id into v_bench_gk
    from pg_catalog.unnest(v_snapshot.bench_player_ids) submitted(player_id)
    join public.players player on player.id = submitted.player_id
    where pg_catalog.upper(player.element_type::text) in ('GKP', 'GK', '1')
    limit 1;

    -- A player is a confirmed non-player only when they have zero minutes and
    -- their club has no unfinished fixture left in this Gameweek. This keeps
    -- double-Gameweek players eligible until their final club fixture ends.
    if coalesce((
         select stats.minutes from public.player_gameweek_stats stats
         where stats.player_id = v_starting_gk and stats.gameweek = p_gameweek
       ), 0) = 0
       and not exists (
         select 1
         from public.fixtures fixture
         join public.players player on player.id = v_starting_gk
         where fixture.gameweek = p_gameweek
           and (fixture.home_team_id = player.team_id or fixture.away_team_id = player.team_id)
           and not coalesce(fixture.is_finished, false)
       ) then
      if coalesce((
           select stats.minutes from public.player_gameweek_stats stats
           where stats.player_id = v_bench_gk and stats.gameweek = p_gameweek
         ), 0) > 0
         or exists (
           select 1
           from public.fixtures fixture
           join public.players player on player.id = v_bench_gk
           where fixture.gameweek = p_gameweek
             and (fixture.home_team_id = player.team_id or fixture.away_team_id = player.team_id)
             and not coalesce(fixture.is_finished, false)
         ) then
        v_effective := pg_catalog.array_replace(v_effective, v_starting_gk, v_bench_gk);
        v_effective_bench := pg_catalog.array_replace(v_effective_bench, v_bench_gk, v_starting_gk);
        v_swap_count := v_swap_count + 1;
      end if;
    end if;

    -- Work through the outfield bench in its saved priority order. A substitute
    -- is provisionally eligible if they have played or can still play later.
    for v_bench_player in
      select submitted.player_id
      from pg_catalog.unnest(v_snapshot.bench_player_ids) with ordinality submitted(player_id, ordinality)
      join public.players player on player.id = submitted.player_id
      where pg_catalog.upper(player.element_type::text) not in ('GKP', 'GK', '1')
        and (
          coalesce((
            select stats.minutes from public.player_gameweek_stats stats
            where stats.player_id = submitted.player_id and stats.gameweek = p_gameweek
          ), 0) > 0
          or exists (
            select 1
            from public.fixtures fixture
            where fixture.gameweek = p_gameweek
              and (fixture.home_team_id = player.team_id or fixture.away_team_id = player.team_id)
              and not coalesce(fixture.is_finished, false)
          )
        )
      order by submitted.ordinality
    loop
      for v_absent_starter in
        select effective.player_id
        from pg_catalog.unnest(v_effective) with ordinality effective(player_id, ordinality)
        join public.players player on player.id = effective.player_id
        where pg_catalog.upper(player.element_type::text) not in ('GKP', 'GK', '1')
          and coalesce((
            select stats.minutes from public.player_gameweek_stats stats
            where stats.player_id = effective.player_id and stats.gameweek = p_gameweek
          ), 0) = 0
          and not exists (
            select 1
            from public.fixtures fixture
            where fixture.gameweek = p_gameweek
              and (fixture.home_team_id = player.team_id or fixture.away_team_id = player.team_id)
              and not coalesce(fixture.is_finished, false)
          )
        order by effective.ordinality
      loop
        v_candidate := pg_catalog.array_replace(v_effective, v_absent_starter, v_bench_player);
        if public.is_legal_starting_lineup(v_candidate) then
          v_effective := v_candidate;
          v_effective_bench := pg_catalog.array_replace(v_effective_bench, v_bench_player, v_absent_starter);
          v_swap_count := v_swap_count + 1;
          exit;
        end if;
      end loop;
    end loop;

    update public.gameweek_lineup_snapshots snapshot
    set effective_starting_player_ids = v_effective,
        effective_bench_player_ids = v_effective_bench
    where snapshot.id = v_snapshot.id;

    v_snapshot_count := v_snapshot_count + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'gameweek', p_gameweek,
    'snapshots_refreshed', v_snapshot_count,
    'provisional_swaps', v_swap_count
  );
end;
$$;

revoke all on function public.refresh_provisional_gameweek_autosubs(integer)
  from public, anon, authenticated;
grant execute on function public.refresh_provisional_gameweek_autosubs(integer)
  to service_role;

comment on function public.refresh_provisional_gameweek_autosubs(integer) is
  'Recomputes provisional effective lineups from completed club fixtures, bench priority and legal formation without finalising snapshots or writing final autosub audit entries.';

