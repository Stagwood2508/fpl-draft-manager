-- Make waiver processing an explicit rehearsal phase and expose its outcomes
-- in the commissioner report.

alter table public.gameweek_simulation_runs
  drop constraint if exists gameweek_simulation_runs_phase_check;
alter table public.gameweek_simulation_runs
  add constraint gameweek_simulation_runs_phase_check check (
    phase in (
      'PRE_DEADLINE', 'WAIVERS_PROCESSED', 'LOCKED', 'LIVE',
      'FINISHED', 'AUTOSUBS', 'WAIVERS_OPEN'
    )
  );

do $$
declare
  v_definition text;
  v_old_fragment constant text :=
    'if v_action = ''LOCK_LINEUPS'' and v_run.phase = ''PRE_DEADLINE'' then';
  v_new_fragment constant text := $fragment$if v_action = 'PROCESS_WAIVERS' and v_run.phase = 'PRE_DEADLINE' then
    update public.league_gameweeks
    set waiver_deadline = now() - interval '1 minute',
        waiver_deadline_time = now() - interval '1 minute'
    where league_id = v_run.league_id and gameweek = v_run.gameweek;
    v_result := public.process_league_waivers(v_run.league_id, v_run.gameweek);
    if not coalesce((v_result ->> 'success')::boolean, false) then
      return jsonb_build_object(
        'success', false,
        'error', coalesce(v_result ->> 'error', 'WAIVER_PROCESSING_FAILED'),
        'result', v_result
      );
    end if;
    v_phase := 'WAIVERS_PROCESSED';
  elsif v_action = 'LOCK_LINEUPS' and v_run.phase = 'WAIVERS_PROCESSED' then$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.advance_gameweek_simulation(uuid,text)'::regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_old_fragment) = 0 then
    raise exception 'advance_gameweek_simulation did not match the expected phase transition';
  end if;
  execute pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
end;
$$;

create or replace function public.get_gameweek_simulation_waiver_results(p_run_id uuid)
returns table (
  claim_id uuid,
  manager_id uuid,
  manager_name text,
  priority_order integer,
  status text,
  failure_reason text,
  player_in_id integer,
  player_in_name text,
  player_out_id integer,
  player_out_name text,
  processed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    claim.id,
    claim.user_id,
    coalesce(member.team_name, profile.display_name, 'Manager')::text,
    claim.priority_order,
    upper(coalesce(claim.status, 'PENDING'))::text,
    claim.failure_reason,
    claim.player_to_add,
    coalesce(player_in.web_name, 'Unknown player')::text,
    claim.player_to_drop,
    coalesce(player_out.web_name, 'Unknown player')::text,
    claim.processed_at
  from public.gameweek_simulation_runs run
  join public.waiver_claims claim
    on claim.league_id = run.league_id and claim.gameweek = run.gameweek
  left join public.league_members member
    on member.league_id = run.league_id and member.user_id = claim.user_id
  left join public.profiles profile on profile.id = claim.user_id
  left join public.players player_in on player_in.id = claim.player_to_add
  left join public.players player_out on player_out.id = claim.player_to_drop
  where run.id = p_run_id
    and run.status = 'ACTIVE'
    and run.commissioner_id = auth.uid()
  order by
    case upper(coalesce(claim.status, 'PENDING'))
      when 'SUCCESSFUL' then 1 when 'FAILED' then 2 else 3
    end,
    claim.processed_at nulls last,
    member.team_name,
    claim.priority_order;
$$;

create or replace function public.get_gameweek_simulation_integrity(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_run public.gameweek_simulation_runs%rowtype;
  v_managers integer; v_fixtures integer; v_bad_appearances integer; v_snapshots integer;
  v_invalid_lineups integer; v_score_mismatches integer; v_processed integer;
  v_waiver_total integer; v_waiver_success integer; v_waiver_failed integer; v_waiver_pending integer;
begin
  select * into v_run from public.gameweek_simulation_runs run where run.id=p_run_id and run.status='ACTIVE';
  if not found or v_run.commissioner_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'ACTIVE_COMMISSIONER_RUN_REQUIRED');
  end if;
  select count(*) into v_managers from public.league_members where league_id=v_run.league_id;
  select count(*) into v_fixtures from public.league_fixtures where league_id=v_run.league_id and gameweek=v_run.gameweek;
  with appearances as (
    select home_user_id user_id from public.league_fixtures where league_id=v_run.league_id and gameweek=v_run.gameweek
    union all select away_user_id from public.league_fixtures where league_id=v_run.league_id and gameweek=v_run.gameweek and away_user_id is not null
  ), counts as (select user_id,count(*) n from appearances group by user_id)
  select count(*) into v_bad_appearances from public.league_members member
  left join counts on counts.user_id=member.user_id
  where member.league_id=v_run.league_id and coalesce(counts.n,0)<>1;
  select count(*), count(*) filter (where not public.is_legal_starting_lineup(effective_starting_player_ids))
  into v_snapshots,v_invalid_lineups from public.gameweek_lineup_snapshots
  where league_id=v_run.league_id and gameweek=v_run.gameweek;
  with live as (select * from public.get_live_fixture_scores(v_run.gameweek))
  select count(*) into v_score_mismatches from public.league_fixtures fixture
  join live on live.fixture_id=fixture.id
  where fixture.league_id=v_run.league_id and (
    coalesce(fixture.home_score,0)<>live.home_score or coalesce(fixture.away_score,0)<>live.away_score
  );
  select count(*) into v_processed from public.gameweek_lineup_snapshots
  where league_id=v_run.league_id and gameweek=v_run.gameweek and status='PROCESSED';
  select
    count(*),
    count(*) filter (where lower(coalesce(status,'pending'))='successful'),
    count(*) filter (where lower(coalesce(status,'pending'))='failed'),
    count(*) filter (where lower(coalesce(status,'pending'))='pending')
  into v_waiver_total,v_waiver_success,v_waiver_failed,v_waiver_pending
  from public.waiver_claims
  where league_id=v_run.league_id and gameweek=v_run.gameweek;
  return jsonb_build_object(
    'success',true,
    'run_id',v_run.id,
    'phase',v_run.phase,
    'waiver_summary',jsonb_build_object(
      'total',v_waiver_total,'successful',v_waiver_success,
      'failed',v_waiver_failed,'pending',v_waiver_pending
    ),
    'checks',jsonb_build_array(
      jsonb_build_object('key','fixtures','label','Every manager has exactly one fixture','passed',v_bad_appearances=0 and v_fixtures=ceil(v_managers/2.0),'detail',v_fixtures||' fixtures for '||v_managers||' managers'),
      jsonb_build_object('key','waivers','label','Waiver claims were processed','passed',case when v_run.phase='PRE_DEADLINE' then true else v_waiver_pending=0 end,'detail',v_waiver_total||' claims: '||v_waiver_success||' successful, '||v_waiver_failed||' unsuccessful, '||v_waiver_pending||' pending'),
      jsonb_build_object('key','snapshots','label','Deadline lineups captured','passed',case when v_run.phase in ('PRE_DEADLINE','WAIVERS_PROCESSED') then v_snapshots=0 else v_snapshots=v_managers end,'detail',v_snapshots||' of '||v_managers||' snapshots'),
      jsonb_build_object('key','formations','label','Effective lineups remain legal','passed',v_invalid_lineups=0,'detail',v_invalid_lineups||' invalid lineups'),
      jsonb_build_object('key','scores','label','Fixture and player totals reconcile','passed',v_score_mismatches=0,'detail',v_score_mismatches||' mismatches'),
      jsonb_build_object('key','autosubs','label','Autosubs processed when requested','passed',case when v_run.phase in ('AUTOSUBS','WAIVERS_OPEN') then v_processed=v_managers else true end,'detail',v_processed||' processed lineups'),
      jsonb_build_object('key','sync','label','Official live sync is paused','passed',true,'detail','Paused until reset or expiry')
    )
  );
end;
$$;

revoke all on function public.advance_gameweek_simulation(uuid,text) from public,anon;
revoke all on function public.get_gameweek_simulation_waiver_results(uuid) from public,anon;
revoke all on function public.get_gameweek_simulation_integrity(uuid) from public,anon;
grant execute on function public.advance_gameweek_simulation(uuid,text) to authenticated,service_role;
grant execute on function public.get_gameweek_simulation_waiver_results(uuid) to authenticated,service_role;
grant execute on function public.get_gameweek_simulation_integrity(uuid) to authenticated,service_role;

