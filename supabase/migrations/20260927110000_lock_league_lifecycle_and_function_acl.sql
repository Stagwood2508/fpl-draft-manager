-- Complete the browser-write lockdown with the remaining league lifecycle
-- tables, then make the public RPC surface explicitly allowlisted again.

-- Fixtures, standings and Gameweek schedules are server-owned. Managers can
-- read their own league only; scoring and scheduled routines write as elevated
-- server callers.
drop policy if exists "Allow league fixture modifications" on public.league_fixtures;
drop policy if exists "Allow members to view league fixtures" on public.league_fixtures;
drop policy if exists "Allow members to manage gameweek deadlines" on public.league_gameweeks;
drop policy if exists "Allow system updates on standings" on public.league_standings;
drop policy if exists "Allow members to view standings" on public.league_standings;
drop policy if exists league_members_read_league_fixtures on public.league_fixtures;
drop policy if exists league_members_read_league_gameweeks on public.league_gameweeks;
drop policy if exists league_members_read_league_standings on public.league_standings;

revoke insert, update, delete on table
  public.league_fixtures, public.league_gameweeks, public.league_standings
from anon, authenticated;

revoke all on table
  public.league_fixtures, public.league_gameweeks, public.league_standings
from anon;

grant select on table
  public.league_fixtures, public.league_gameweeks, public.league_standings
to authenticated;

create policy league_members_read_league_fixtures
  on public.league_fixtures
  for select to authenticated
  using (public.is_current_league_member(league_id));

create policy league_members_read_league_gameweeks
  on public.league_gameweeks
  for select to authenticated
  using (public.is_current_league_member(league_id));

create policy league_members_read_league_standings
  on public.league_standings
  for select to authenticated
  using (public.is_current_league_member(league_id));

-- Future migrations must explicitly grant every browser-callable RPC. Internal
-- trigger, cron and lifecycle functions continue to be service-role only.
do $$
declare
  v_routine record;
begin
  for v_routine in
    select p.oid::regprocedure as signature, p.prokind
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute pg_catalog.format(
      'revoke all on %s %s from public, anon, authenticated',
      case when v_routine.prokind = 'p' then 'procedure' else 'function' end,
      v_routine.signature
    );
    execute pg_catalog.format(
      'grant execute on %s %s to service_role',
      case when v_routine.prokind = 'p' then 'procedure' else 'function' end,
      v_routine.signature
    );
  end loop;
end;
$$;

do $$
declare
  v_routine record;
begin
  for v_routine in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname = any (array[
        'accept_trade_transaction', 'cancel_waiver_claim', 'can_view_profile',
        'change_my_team_name', 'claim_free_agent_with_history',
        'commissioner_assign_current_pick', 'commissioner_control_draft',
        'commissioner_correct_gameweek_lineup', 'commissioner_correct_latest_pick',
        'commissioner_reorder_draft', 'commissioner_restart_draft',
        'commissioner_undo_latest_pick', 'counter_trade_package',
        'create_league_atomic', 'create_single_knockout_cup',
        'create_test_push_notification', 'create_trade_package', 'delete_my_account',
        'delete_league_announcement',
        'disable_my_push_devices', 'get_cup_fixture_board',
        'get_gameweek_provisional_bonus_rankings',
        'get_league_gameweek_player_scores', 'get_league_live_fixture_scores',
        'get_league_luck_standings', 'get_league_scoring_guide',
        'get_league_standings_v2', 'get_league_stats_dashboard',
        'get_manager_h2h_matrix', 'get_manager_squad_breakdown',
        'get_manager_stats_profile', 'get_manager_trends_data',
        'get_my_squad_gameweek_scores', 'get_my_waiver_status',
        'get_player_gameweek_history', 'get_player_pool_current_stats',
        'get_trade_impact', 'is_current_league_member',
        'join_league_with_validation', 'mark_draft_manager_present',
        'register_push_device', 'remove_lounge_message', 'reorder_waiver_claims',
        'reorder_watchlist', 'resolve_lounge_message_reports',
        'save_league_player_position_override', 'save_league_settings',
        'save_league_announcement',
        'save_manager_lineup', 'set_draft_room_ready', 'set_lounge_message_pinned',
        'set_transfer_listing', 'submit_draft_pick', 'submit_waiver_claim',
        'update_trade_package_status'
      ])
  loop
    execute pg_catalog.format(
      'grant execute on function %s to authenticated', v_routine.signature
    );
  end loop;
end;
$$;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
