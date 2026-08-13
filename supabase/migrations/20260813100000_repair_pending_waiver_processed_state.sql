-- A future waiver window cannot be processed while it still contains pending
-- claims. This can occur when a rehearsal rollback restores claims and schedule
-- state from different points in the lifecycle. Repair the invariant before
-- deciding whether the active market is waivers or free agency.

create or replace function public.repair_pending_waiver_processed_state(
  p_league_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  with active_window as (
    select distinct on (candidate.league_id)
      candidate.league_id,
      candidate.gameweek
    from public.league_gameweeks candidate
    left join public.gameweek_simulation_runs run
      on run.league_id = candidate.league_id
     and run.gameweek = candidate.gameweek
     and run.status = 'ACTIVE'
     and run.expires_at > pg_catalog.now()
    where (p_league_id is null or candidate.league_id = p_league_id)
      and candidate.gw_deadline > pg_catalog.now()
      and not coalesce(candidate.is_finished, false)
    order by candidate.league_id,
             case when run.id is not null then 0 else 1 end,
             candidate.gw_deadline,
             candidate.gameweek
  )
  update public.league_gameweeks gameweek
  set is_waiver_processed = false,
      waiver_processed_at = null,
      status = 'WAIVERS_OPEN'
  from active_window active
  where gameweek.league_id = active.league_id
    and gameweek.gameweek = active.gameweek
    and gameweek.waiver_deadline > pg_catalog.now()
    and gameweek.gw_deadline > pg_catalog.now()
    and not coalesce(gameweek.is_finished, false)
    and (
      coalesce(gameweek.is_waiver_processed, false)
      or upper(coalesce(gameweek.status::text, '')) = 'FREE_AGENCY'
    )
    and exists (
      select 1
      from public.waiver_claims claim
      where claim.league_id = gameweek.league_id
        and lower(coalesce(claim.status::text, 'pending')) = 'pending'
    );

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- Keep the repair at the beginning of the existing normaliser so every
-- scheduled lifecycle refresh maintains the invariant.
create or replace function public.normalise_league_waiver_windows(
  p_league_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  perform public.repair_pending_waiver_processed_state(p_league_id);

  with active_window as (
    select distinct on (lg.league_id)
      lg.league_id,
      lg.gameweek
    from public.league_gameweeks lg
    where (p_league_id is null or lg.league_id = p_league_id)
      and not coalesce(lg.is_finished, false)
      and lg.gw_deadline > pg_catalog.now()
      and not exists (
        select 1
        from public.gameweek_simulation_runs run
        where run.league_id = lg.league_id
          and run.status = 'ACTIVE'
          and run.expires_at > pg_catalog.now()
      )
    order by lg.league_id, lg.gw_deadline, lg.gameweek
  )
  update public.league_gameweeks lg
  set status = case
    when coalesce(lg.is_finished, false) then 'FINISHED'
    when lg.gw_deadline <= pg_catalog.now() then 'IN_PLAY'
    when active.gameweek is null then lg.status
    when lg.gameweek <> active.gameweek then 'SCHEDULED'
    when coalesce(lg.is_waiver_processed, false) then 'FREE_AGENCY'
    when lg.waiver_deadline is null or lg.waiver_deadline <= pg_catalog.now()
      then 'WAIVERS_CLOSED'
    else 'WAIVERS_OPEN'
  end
  from active_window active
  where lg.league_id = active.league_id
    and lg.status is distinct from case
      when coalesce(lg.is_finished, false) then 'FINISHED'
      when lg.gw_deadline <= pg_catalog.now() then 'IN_PLAY'
      when active.gameweek is null then lg.status
      when lg.gameweek <> active.gameweek then 'SCHEDULED'
      when coalesce(lg.is_waiver_processed, false) then 'FREE_AGENCY'
      when lg.waiver_deadline is null or lg.waiver_deadline <= pg_catalog.now()
        then 'WAIVERS_CLOSED'
      else 'WAIVERS_OPEN'
    end;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

select public.repair_pending_waiver_processed_state(null);
select public.normalise_league_waiver_windows(null);
select public.reconcile_pending_waiver_claims(null);

revoke all on function public.repair_pending_waiver_processed_state(uuid)
  from public, anon, authenticated;
grant execute on function public.repair_pending_waiver_processed_state(uuid)
  to service_role;

comment on function public.repair_pending_waiver_processed_state(uuid) is
  'Reopens a future waiver window when pending claims prove its processed flag is stale.';
