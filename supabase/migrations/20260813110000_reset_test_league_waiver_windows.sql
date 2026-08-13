-- The current leagues are test leagues and should all begin from the same
-- authoritative FPL schedule. Reset every unplayed waiver lifecycle, open only
-- the earliest upcoming Gameweek, and retain managers' pending claim intent.

do $$
declare
  v_active_gameweek integer;
  v_run record;
begin
  -- End any controlled rehearsal first; otherwise its later rollback could
  -- restore the stale waiver flags after this reset.
  for v_run in
    select run.id
    from public.gameweek_simulation_runs run
    where run.status = 'ACTIVE'
    order by run.started_at
  loop
    perform public.restore_gameweek_simulation_internal(v_run.id, 'RESET');
  end loop;

  select gameweek.gameweek_number
  into v_active_gameweek
  from public.gameweeks gameweek
  where not coalesce(gameweek.is_finished, false)
    and gameweek.fpl_deadline_time > pg_catalog.now()
  order by gameweek.fpl_deadline_time, gameweek.gameweek_number
  limit 1;

  if v_active_gameweek is null then
    raise exception 'No upcoming authoritative Gameweek was found';
  end if;

  update public.league_gameweeks league_gameweek
  set gw_deadline = gameweek.fpl_deadline_time,
      waiver_deadline = gameweek.fpl_deadline_time - interval '24 hours',
      waiver_deadline_time = gameweek.fpl_deadline_time - interval '24 hours',
      is_current = gameweek.gameweek_number = v_active_gameweek,
      is_finished = coalesce(gameweek.is_finished, false),
      is_waiver_processed = false,
      waiver_processed_at = null,
      status = case
        when coalesce(gameweek.is_finished, false) then 'FINISHED'
        when gameweek.fpl_deadline_time <= pg_catalog.now() then 'IN_PLAY'
        when gameweek.gameweek_number <> v_active_gameweek then 'SCHEDULED'
        when gameweek.fpl_deadline_time - interval '24 hours' > pg_catalog.now()
          then 'WAIVERS_OPEN'
        else 'WAIVERS_CLOSED'
      end
  from public.gameweeks gameweek
  where league_gameweek.gameweek = gameweek.gameweek_number;

  -- Claims created against a later test Gameweek belong to the reset active
  -- window. Preserve distinct claims and leave any exact collision untouched.
  update public.waiver_claims claim
  set gameweek = v_active_gameweek
  where lower(coalesce(claim.status::text, 'pending')) = 'pending'
    and claim.gameweek is distinct from v_active_gameweek
    and not exists (
      select 1
      from public.waiver_claims existing
      where existing.id <> claim.id
        and existing.league_id = claim.league_id
        and existing.user_id = claim.user_id
        and existing.player_to_add = claim.player_to_add
        and existing.player_to_drop = claim.player_to_drop
        and existing.gameweek = v_active_gameweek
    );

  -- Rebuild each manager's priority queue after moving the pending claims.
  with ordered as (
    select
      claim.id,
      row_number() over (
        partition by claim.league_id, claim.user_id, claim.gameweek
        order by claim.priority_order, claim.created_at, claim.id
      )::integer as next_priority
    from public.waiver_claims claim
    where lower(coalesce(claim.status::text, 'pending')) = 'pending'
      and claim.gameweek = v_active_gameweek
  )
  update public.waiver_claims claim
  set priority_order = ordered.next_priority
  from ordered
  where claim.id = ordered.id;
end;
$$;

select public.normalise_league_waiver_windows(null);
select public.reconcile_pending_waiver_claims(null);
