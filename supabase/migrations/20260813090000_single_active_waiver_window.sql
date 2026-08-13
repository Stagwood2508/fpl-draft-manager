-- Keep every waiver surface on one authoritative league window. Future
-- Gameweeks are scheduled, not concurrently open, and pending claims restored
-- from a rehearsal or older client are moved back to the active window.

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

-- Schedule refreshes used to label every future row WAIVERS_OPEN. Normalise
-- immediately after each refresh so only the next window remains actionable.
do $$
declare
  v_definition text;
  v_marker constant text := '  get diagnostics v_count = row_count;';
begin
  select pg_catalog.pg_get_functiondef(
    'public.refresh_league_gameweek_schedule()'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'normalise_league_waiver_windows') = 0 then
    if pg_catalog.strpos(v_definition, v_marker) = 0 then
      raise exception 'refresh_league_gameweek_schedule insertion point was not found';
    end if;
    v_definition := pg_catalog.replace(
      v_definition,
      v_marker,
      '  perform public.normalise_league_waiver_windows(null);' || chr(10) || chr(10) || v_marker
    );
    execute v_definition;
  end if;
end;
$$;

select public.normalise_league_waiver_windows(null);

-- A controlled rehearsal may deliberately target a later Gameweek. When it
-- opens that test window, temporarily schedule every other open row so all
-- production and rehearsal readers still see one authoritative window.
do $$
declare
  v_definition text;
  v_replaced text;
  v_status_pattern constant text := $pattern$status[[:space:]]*=[[:space:]]*case[[:space:]]+when[[:space:]]+gameweek[[:space:]]*=[[:space:]]*p_gameweek[[:space:]]+then[[:space:]]+'WAIVERS_(OPEN|CLOSED)'[[:space:]]+else[[:space:]]+status[[:space:]]+end$pattern$;
  v_new_fragment constant text := $fragment$status = case
        when gameweek = p_gameweek then 'WAIVERS_OPEN'
        when upper(coalesce(status::text, '')) = 'WAIVERS_OPEN' then 'SCHEDULED'
        else status
      end$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.start_gameweek_simulation(uuid,integer,integer)'::regprocedure
  ) into v_definition;

  v_replaced := pg_catalog.regexp_replace(
    v_definition,
    v_status_pattern,
    v_new_fragment,
    'in'
  );

  if v_replaced = v_definition then
    if pg_catalog.strpos(v_definition, 'SCHEDULED') = 0 then
      raise notice 'start_gameweek_simulation uses an unrecognised status expression; production waiver normalisation will still be installed';
    end if;
  else
    execute v_replaced;
  end if;
end;
$$;

-- The secured submission and reorder functions must resolve ties by Gameweek,
-- rather than trusting potentially inconsistent historical deadline ordering.
do $$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.submit_waiver_claim(uuid,integer,integer,integer)'::regprocedure,
    'public.reorder_waiver_claims(uuid,uuid[])'::regprocedure
  ]
  loop
    select pg_catalog.pg_get_functiondef(v_signature) into v_definition;
    v_definition := pg_catalog.replace(
      v_definition,
      'ORDER BY lg.waiver_deadline, lg.gameweek',
      'ORDER BY lg.gameweek, lg.waiver_deadline'
    );
    v_definition := pg_catalog.replace(
      v_definition,
      'order by lg.waiver_deadline, lg.gameweek',
      'order by lg.gameweek, lg.waiver_deadline'
    );
    execute v_definition;
  end loop;
end;
$$;

-- Repair pending rows which were filed against a later Gameweek. Exact
-- duplicates are left untouched so this routine never deletes user intent.
create or replace function public.reconcile_pending_waiver_claims(
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
  with active_windows as (
    select distinct on (lg.league_id)
      lg.league_id,
      lg.gameweek
    from public.league_gameweeks lg
    left join public.gameweek_simulation_runs run
      on run.league_id = lg.league_id
     and run.gameweek = lg.gameweek
     and run.status = 'ACTIVE'
     and run.expires_at > pg_catalog.now()
    where (p_league_id is null or lg.league_id = p_league_id)
      and upper(coalesce(lg.status::text, '')) = 'WAIVERS_OPEN'
      and not coalesce(lg.is_waiver_processed, false)
      and not coalesce(lg.is_finished, false)
      and lg.waiver_deadline > pg_catalog.now()
    order by lg.league_id, case when run.id is not null then 0 else 1 end,
             lg.gameweek, lg.waiver_deadline
  )
  update public.waiver_claims claim
  set gameweek = active.gameweek
  from active_windows active
  where claim.league_id = active.league_id
    and lower(coalesce(claim.status::text, 'pending')) = 'pending'
    and claim.gameweek is distinct from active.gameweek
    and not exists (
      select 1
      from public.waiver_claims existing
      where existing.id <> claim.id
        and existing.league_id = claim.league_id
        and existing.user_id = claim.user_id
        and existing.player_to_add = claim.player_to_add
        and existing.player_to_drop = claim.player_to_drop
        and existing.gameweek = active.gameweek
    );

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

select public.reconcile_pending_waiver_claims(null);

-- Rollback restores table snapshots verbatim. Normalise and reconcile after
-- the run is marked inactive so an older backup cannot reintroduce ambiguity.
do $$
declare
  v_definition text;
  v_marker constant text := $fragment$
  insert into public.gameweek_simulation_audit(run_id, actor_id, action, details)
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.restore_gameweek_simulation_internal(uuid,text)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'reconcile_pending_waiver_claims') = 0 then
    if pg_catalog.strpos(v_definition, v_marker) = 0 then
      raise notice 'restore_gameweek_simulation_internal insertion point was not found; the production waiver repair remains active';
    else
      v_definition := pg_catalog.replace(
        v_definition,
        v_marker,
        '  perform public.normalise_league_waiver_windows(v_run.league_id);' || chr(10) ||
        '  perform public.reconcile_pending_waiver_claims(v_run.league_id);' || chr(10) || chr(10) ||
        v_marker
      );
      execute v_definition;
    end if;
  end if;
end;
$$;

revoke all on function public.normalise_league_waiver_windows(uuid)
  from public, anon, authenticated;
grant execute on function public.normalise_league_waiver_windows(uuid)
  to service_role;
revoke all on function public.reconcile_pending_waiver_claims(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_pending_waiver_claims(uuid)
  to service_role;

comment on function public.normalise_league_waiver_windows(uuid) is
  'Marks exactly one upcoming waiver window per league as active and all later windows as scheduled.';
comment on function public.reconcile_pending_waiver_claims(uuid) is
  'Moves pending claims into the authoritative open window without deleting conflicting user intent.';
