-- Replace inherited broad table-write policies with controlled RPC and
-- service-role paths. Existing server-side draft, roster, and waiver RPCs
-- remain the only supported mutation paths for their tables.

create or replace function public.is_current_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.league_members member
       where member.league_id = p_league_id
         and member.user_id = auth.uid()
     );
$$;

revoke all on function public.is_current_league_member(uuid) from public, anon;
grant execute on function public.is_current_league_member(uuid) to authenticated, service_role;

create or replace function public.save_league_settings(
  p_league_id uuid,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_status text;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  select upper(coalesce(league.draft_status, league.status, 'PRE_DRAFT'))
  into v_status
  from public.leagues league
  where league.id = p_league_id
    and league.commissioner_id = v_actor_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'COMMISSIONER_REQUIRED');
  end if;

  if v_status not in ('PRE_DRAFT', 'WAITING_ROOM', 'NOT_STARTED', 'WAITING') then
    return jsonb_build_object('success', false, 'error', 'DRAFT_ALREADY_STARTED');
  end if;

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    return jsonb_build_object('success', false, 'error', 'INVALID_SETTINGS');
  end if;

  insert into public.league_settings (league_id)
  values (p_league_id)
  on conflict (league_id) do nothing;

  update public.leagues
  set roster_type = coalesce(nullif(p_settings ->> 'roster_type', ''), roster_type)
  where id = p_league_id;

  update public.league_settings settings
  set
    roster_type = coalesce(nullif(p_settings ->> 'roster_type', ''), settings.roster_type),
    draft_clock_duration = coalesce((p_settings ->> 'draft_clock_duration')::integer, settings.draft_clock_duration),
    draft_start_time = case when p_settings ? 'draft_start_time'
      then nullif(p_settings ->> 'draft_start_time', '')::timestamptz
      else settings.draft_start_time end,
    points_goal_fwd = coalesce((p_settings ->> 'points_goal_fwd')::integer, settings.points_goal_fwd),
    points_goal_mid = coalesce((p_settings ->> 'points_goal_mid')::integer, settings.points_goal_mid),
    points_goal_def = coalesce((p_settings ->> 'points_goal_def')::integer, settings.points_goal_def),
    points_assist = coalesce((p_settings ->> 'points_assist')::integer, settings.points_assist),
    points_clean_sheet_def = coalesce((p_settings ->> 'points_clean_sheet_def')::integer, settings.points_clean_sheet_def),
    points_clean_sheet_mid = coalesce((p_settings ->> 'points_clean_sheet_mid')::integer, settings.points_clean_sheet_mid),
    points_yellow_card = coalesce((p_settings ->> 'points_yellow_card')::integer, settings.points_yellow_card),
    points_red_card = coalesce((p_settings ->> 'points_red_card')::integer, settings.points_red_card),
    points_own_goal = coalesce((p_settings ->> 'points_own_goal')::integer, settings.points_own_goal),
    points_penalty_save = coalesce((p_settings ->> 'points_penalty_save')::integer, settings.points_penalty_save),
    points_penalty_miss = coalesce((p_settings ->> 'points_penalty_miss')::integer, settings.points_penalty_miss),
    trade_cutoff_rule = coalesce(nullif(p_settings ->> 'trade_cutoff_rule', ''), settings.trade_cutoff_rule),
    dropped_player_rule = coalesce(nullif(p_settings ->> 'dropped_player_rule', ''), settings.dropped_player_rule),
    initial_waiver_order_rule = coalesce(nullif(p_settings ->> 'initial_waiver_order_rule', ''), settings.initial_waiver_order_rule),
    defcon_thresholds_def = coalesce(p_settings -> 'defcon_thresholds_def', settings.defcon_thresholds_def),
    defcon_thresholds_mid = coalesce(p_settings -> 'defcon_thresholds_mid', settings.defcon_thresholds_mid),
    defcon_thresholds_fwd = coalesce(p_settings -> 'defcon_thresholds_fwd', settings.defcon_thresholds_fwd),
    updated_at = pg_catalog.now()
  where settings.league_id = p_league_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.save_league_settings(uuid, jsonb) from public, anon;
grant execute on function public.save_league_settings(uuid, jsonb) to authenticated, service_role;

-- Remove every unconditional write policy discovered by the production audit.
drop policy if exists "Allow authenticated users to submit draft choices" on public.draft_picks;
drop policy if exists "Allow authenticated users to manage draft room sessions" on public.draft_sessions;
drop policy if exists "Allow members to activate draft session" on public.draft_sessions;
drop policy if exists "Allow write access to fixtures" on public.fixtures;
drop policy if exists "Allow authenticated membership entries" on public.league_members;
drop policy if exists "Allow authenticated managers full override access" on public.league_player_overrides;
drop policy if exists "Allow authenticated settings entries" on public.league_settings;
drop policy if exists "Allow system updates on standings" on public.league_standings;
drop policy if exists "Allow authenticated users to create leagues" on public.leagues;
drop policy if exists "Allow write access to gameweek stats" on public.player_gameweek_stats;
drop policy if exists "Allow authenticated upserts to player pool" on public.players;
drop policy if exists "Allow authenticated users full access to rosters" on public.rosters;
drop policy if exists "Allow authenticated upsert fixtures access" on public.team_fixtures;
drop policy if exists "Allow public read/write fixtures" on public.team_fixtures;

revoke insert, update, delete on table
  public.draft_picks, public.draft_sessions, public.fixtures,
  public.league_members, public.league_player_overrides,
  public.league_settings, public.league_standings, public.leagues,
  public.player_gameweek_stats, public.players, public.rosters,
  public.team_fixtures
from anon, authenticated;

revoke all on table
  public.draft_picks, public.draft_sessions, public.fixtures,
  public.league_members, public.league_player_overrides,
  public.league_settings, public.league_standings, public.leagues,
  public.player_gameweek_stats, public.players, public.rosters,
  public.team_fixtures
from anon;

grant select on table
  public.draft_picks, public.draft_sessions, public.fixtures,
  public.league_members, public.league_player_overrides,
  public.league_settings, public.league_standings, public.leagues,
  public.player_gameweek_stats, public.players, public.rosters,
  public.team_fixtures
to authenticated;

-- Official FPL reference data remains readable by signed-in users.
drop policy if exists authenticated_read_fpl_reference_data on public.players;
create policy authenticated_read_fpl_reference_data on public.players
for select to authenticated using (true);

drop policy if exists authenticated_read_fixtures on public.fixtures;
create policy authenticated_read_fixtures on public.fixtures
for select to authenticated using (true);

drop policy if exists authenticated_read_gameweek_stats on public.player_gameweek_stats;
create policy authenticated_read_gameweek_stats on public.player_gameweek_stats
for select to authenticated using (true);

drop policy if exists authenticated_read_team_fixtures on public.team_fixtures;
create policy authenticated_read_team_fixtures on public.team_fixtures
for select to authenticated using (true);

-- League-specific records are readable only by a manager in the same league.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'league_members', 'rosters', 'draft_picks', 'draft_sessions',
    'league_settings', 'league_standings', 'league_player_overrides'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'league_members_read_' || v_table, v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_current_league_member(league_id))',
      'league_members_read_' || v_table, v_table
    );
  end loop;
end;
$$;

-- Trigger functions are invoked internally and must not be public RPC endpoints.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function.signature);
  end loop;
end;
$$;
