begin;

do $$
declare
  v_table regclass;
  v_tables constant regclass[] := array[
    'public.cup_audit_log'::regclass,
    'public.cup_configurations'::regclass,
    'public.cup_entries'::regclass,
    'public.cup_fixtures'::regclass,
    'public.cup_rounds'::regclass,
    'public.cups'::regclass,
    'public.draft_autopick_debug'::regclass,
    'public.draft_manager_autopick_state'::regclass,
    'public.draft_pick_audit'::regclass,
    'public.draft_room_readiness'::regclass,
    'public.free_agent_transactions'::regclass,
    'public.gameweek_autosub_audit'::regclass,
    'public.gameweek_lineup_snapshots'::regclass,
    'public.gameweeks'::regclass,
    'public.league_waiver_priorities'::regclass,
    'public.lineup_change_audit'::regclass,
    'public.player_position_overrides'::regclass,
    'public.player_season_stats'::regclass,
    'public.trade_package_audit'::regclass,
    'public.transactions'::regclass,
    'public.waiver_claims'::regclass,
    'public.waiver_player_locks'::regclass
  ];
begin
  foreach v_table in array v_tables loop
    if pg_catalog.has_table_privilege(
      'anon',
      v_table,
      'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
    ) then
      raise exception 'anon retains an operational table grant: %', v_table;
    end if;
  end loop;
end;
$$;

rollback;
