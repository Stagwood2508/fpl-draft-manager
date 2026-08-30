-- GW1 autosubs were processed before the official player-minute feed had been
-- populated. Repair only leagues with that unmistakable signature: every
-- lineup processed, no swaps, and roughly every starter logged as absent.

do $$
declare
  v_league record;
  v_result jsonb;
  v_affected uuid[] := array[]::uuid[];
  v_league_id uuid;
begin
  for v_league in
    with snapshot_counts as (
      select
        s.league_id,
        count(*) as snapshots,
        count(*) filter (where s.status = 'PROCESSED') as processed
      from public.gameweek_lineup_snapshots s
      where s.gameweek = 1
      group by s.league_id
    ), audit_counts as (
      select
        a.league_id,
        count(*) filter (where a.action_type = 'SWAP') as swaps,
        count(*) filter (where a.action_type = 'SKIPPED') as skipped
      from public.gameweek_autosub_audit a
      where a.gameweek = 1
      group by a.league_id
    )
    select snapshots.league_id
    from snapshot_counts snapshots
    join audit_counts audit on audit.league_id = snapshots.league_id
    where snapshots.snapshots > 0
      and snapshots.processed = snapshots.snapshots
      and audit.swaps = 0
      and audit.skipped >= snapshots.snapshots * 10
      and exists (
        select 1 from public.player_gameweek_stats stats
        where stats.gameweek = 1 and stats.minutes > 0
      )
  loop
    delete from public.gameweek_autosub_audit audit
    where audit.league_id = v_league.league_id
      and audit.gameweek = 1;

    update public.gameweek_lineup_snapshots snapshot
    set effective_starting_player_ids = snapshot.starting_player_ids,
        effective_bench_player_ids = snapshot.bench_player_ids,
        status = 'LOCKED',
        processed_at = null
    where snapshot.league_id = v_league.league_id
      and snapshot.gameweek = 1
      and snapshot.status = 'PROCESSED';

    v_result := public.process_gameweek_autosubs(v_league.league_id, 1, true);

    if exists (
      select 1
      from public.gameweek_lineup_snapshots snapshot
      where snapshot.league_id = v_league.league_id
        and snapshot.gameweek = 1
        and not public.is_legal_starting_lineup(snapshot.effective_starting_player_ids)
    ) then
      raise exception 'GW1 autosub repair created an illegal lineup for league %', v_league.league_id;
    end if;

    if exists (
      select 1
      from public.gameweek_autosub_audit audit
      left join public.player_gameweek_stats outgoing
        on outgoing.player_id = audit.subbed_out_player_id and outgoing.gameweek = 1
      left join public.player_gameweek_stats incoming
        on incoming.player_id = audit.subbed_in_player_id and incoming.gameweek = 1
      where audit.league_id = v_league.league_id
        and audit.gameweek = 1
        and audit.action_type = 'SWAP'
        and (coalesce(outgoing.minutes, 0) > 0 or coalesce(incoming.minutes, 0) = 0)
    ) then
      raise exception 'GW1 autosub repair failed the minutes validation for league %', v_league.league_id;
    end if;

    v_affected := pg_catalog.array_append(v_affected, v_league.league_id);
  end loop;

  if pg_catalog.cardinality(v_affected) > 0 then
    perform public.finalize_gameweek_fixture_scores(1);
    perform public.finalize_cup_gameweek(1);

    foreach v_league_id in array v_affected
    loop
      perform public.generate_league_chronicle(v_league_id, 1, true);
    end loop;
  end if;
end;
$$;

