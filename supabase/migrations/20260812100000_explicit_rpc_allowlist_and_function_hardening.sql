-- Replace inherited RPC execution with a deliberate app allow-list, fix all
-- remaining mutable search paths, and keep draft startup server-owned.

create or replace procedure public.auto_initialize_drafts()
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league record;
  v_member_count integer;
  v_order_count integer;
  v_min_order integer;
  v_max_order integer;
  v_first_picker uuid;
  v_turn_duration integer;
begin
  for v_league in
    select settings.league_id, settings.draft_start_time
    from public.league_settings settings
    join public.leagues league on league.id = settings.league_id
    where settings.draft_start_time <= pg_catalog.now()
      and pg_catalog.upper(coalesce(league.draft_status, league.status, 'PRE_DRAFT'))
        in ('PRE_DRAFT', 'WAITING_ROOM', 'NOT_STARTED', 'WAITING')
      and not exists (
        select 1 from public.draft_picks pick
        where pick.league_id = settings.league_id
      )
      and not exists (
        select 1 from public.draft_sessions session
        where session.league_id = settings.league_id
          and pg_catalog.upper(coalesce(session.draft_status, ''))
            in ('LIVE', 'DRAFTING', 'COMPLETED')
      )
    order by settings.draft_start_time
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_league.league_id::text, 12100020260812)
    );

    select
      pg_catalog.count(*)::integer,
      pg_catalog.count(distinct member.draft_order)::integer,
      pg_catalog.min(member.draft_order),
      pg_catalog.max(member.draft_order)
    into v_member_count, v_order_count, v_min_order, v_max_order
    from public.league_members member
    where member.league_id = v_league.league_id;

    if v_member_count = 0 then
      continue;
    end if;

    -- Preserve a complete commissioner-defined order. Only randomize missing,
    -- duplicated or incomplete stored order values.
    if v_order_count <> v_member_count
       or v_min_order <> 1
       or v_max_order <> v_member_count then
      with randomized as (
        select
          member.user_id,
          pg_catalog.row_number() over (order by pg_catalog.random())::integer as new_order
        from public.league_members member
        where member.league_id = v_league.league_id
      )
      update public.league_members member
      set draft_order = randomized.new_order
      from randomized
      where member.league_id = v_league.league_id
        and member.user_id = randomized.user_id;
    end if;

    select member.user_id
    into v_first_picker
    from public.league_members member
    where member.league_id = v_league.league_id
    order by member.draft_order, member.user_id
    limit 1;

    select coalesce(settings.draft_clock_duration, 60)
    into v_turn_duration
    from public.league_settings settings
    where settings.league_id = v_league.league_id;

    insert into public.draft_sessions (
      league_id, current_round, current_pick_index, current_picker_id,
      pick_deadline, draft_status
    ) values (
      v_league.league_id, 1, 1, v_first_picker,
      pg_catalog.now() + (coalesce(v_turn_duration, 60) || ' seconds')::interval,
      'LIVE'
    )
    on conflict (league_id)
    do update set
      current_round = 1,
      current_pick_index = 1,
      current_picker_id = excluded.current_picker_id,
      pick_deadline = excluded.pick_deadline,
      draft_status = 'LIVE';

    update public.leagues league
    set draft_status = 'DRAFTING', status = 'DRAFTING'
    where league.id = v_league.league_id;
  end loop;
end;
$$;

-- Fix the search path on every existing public routine. Browser roles cannot
-- create objects in public, and pg_catalog is resolved first.
do $$
declare
  v_routine record;
begin
  for v_routine in
    select p.oid::regprocedure as signature, p.prokind
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1
        from pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  loop
    execute pg_catalog.format(
      'alter %s %s set search_path = pg_catalog, public',
      case when v_routine.prokind = 'p' then 'procedure' else 'function' end,
      v_routine.signature
    );
  end loop;
end;
$$;

-- Remove every inherited browser grant first. Internal callers and triggers do
-- not require browser EXECUTE permission.
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

-- Grant only RPCs called by the current signed-in client. Each function still
-- enforces its own membership, ownership or commissioner checks.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname = any (array[
        'accept_trade_transaction', 'cancel_waiver_claim', 'can_view_profile',
        'claim_free_agent_with_history', 'commissioner_assign_current_pick',
        'commissioner_control_draft', 'commissioner_correct_gameweek_lineup',
        'commissioner_correct_latest_pick', 'commissioner_reorder_draft',
        'commissioner_restart_draft', 'counter_trade_package',
        'create_trade_package', 'execute_draft_pick',
        'get_league_gameweek_player_scores', 'get_league_live_fixture_scores',
        'get_league_luck_standings', 'get_league_standings_v2',
        'get_manager_h2h_matrix', 'get_manager_squad_breakdown',
        'get_manager_trends_data', 'get_my_waiver_status',
        'join_league_with_validation', 'mark_draft_manager_present',
        'reorder_waiver_claims', 'reorder_watchlist', 'save_manager_lineup',
        'set_draft_room_ready', 'set_transfer_listing', 'submit_waiver_claim',
        'update_trade_package_status'
      ])
  loop
    execute pg_catalog.format(
      'grant execute on function %s to authenticated',
      v_function.signature
    );
  end loop;
end;
$$;

alter default privileges for role postgres in schema public
revoke execute on functions from public;
