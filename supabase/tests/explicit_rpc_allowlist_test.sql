begin;

do $$
declare
  v_expected_name text;
  v_expected_names constant text[] := array[
    'accept_trade_transaction', 'cancel_waiver_claim', 'can_view_profile',
    'create_league_atomic', 'delete_my_account',
    'claim_free_agent_with_history', 'commissioner_assign_current_pick',
    'commissioner_control_draft', 'commissioner_correct_gameweek_lineup',
    'commissioner_correct_latest_pick', 'commissioner_reorder_draft',
    'commissioner_restart_draft', 'counter_trade_package',
    'create_trade_package', 'execute_draft_pick', 'submit_draft_pick',
    'get_league_gameweek_player_scores', 'get_league_live_fixture_scores',
    'get_league_luck_standings', 'get_league_standings_v2',
    'get_manager_h2h_matrix', 'get_manager_squad_breakdown',
    'get_manager_trends_data', 'get_my_waiver_status',
    'join_league_with_validation', 'mark_draft_manager_present',
    'reorder_waiver_claims', 'reorder_watchlist', 'save_manager_lineup',
    'set_draft_room_ready', 'set_transfer_listing', 'submit_waiver_claim',
    'update_trade_package_status'
  ];
begin
  if pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')
     or pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'a browser role can create objects in public';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1
        from pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ) then
    raise exception 'a public routine still has a mutable search path';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'anon can still execute a public routine';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.proname <> all (v_expected_names)
  ) then
    raise exception 'authenticated can execute a routine outside the app allow-list';
  end if;

  foreach v_expected_name in array v_expected_names
  loop
    if not exists (
      select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = v_expected_name
        and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) then
      raise exception 'required app RPC is missing or blocked: %', v_expected_name;
    end if;
  end loop;

  if pg_catalog.has_function_privilege(
       'authenticated', 'public.auto_initialize_drafts()', 'EXECUTE'
     ) then
    raise exception 'the server-owned draft starter is browser-executable';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.execute_draft_pick_internal(uuid,uuid,integer)',
       'EXECUTE'
     ) then
    raise exception 'authenticated can execute the internal draft engine';
  end if;

  if pg_catalog.to_regprocedure(
       'public.submit_draft_pick(uuid,integer)'
     ) is null then
    raise exception 'secure manager draft submission RPC is missing';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated',
       'public.submit_draft_pick(uuid,integer)',
       'EXECUTE'
     ) then
    raise exception 'authenticated cannot submit their own draft pick';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'auto-start-drafts' and active
  ) then
    raise exception 'the server-owned draft start schedule is not active';
  end if;
end;
$$;

rollback;
