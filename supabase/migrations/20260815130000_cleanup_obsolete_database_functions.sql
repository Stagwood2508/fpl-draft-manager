-- Remove retired server functions which reference superseded tables and columns.
-- Refuse the cleanup if a hosted cron job still names one of them so deployment
-- fails safely rather than silently breaking an external schedule.

do $$
declare
  v_scheduled_jobs integer := 0;
  v_pattern constant text := '(get_manager_luck_analysis|get_manager_luck_index|process_weekly_waiver_claims|check_and_process_all_leagues|execute_auto_pick|simulate_single_gameweek|simulate_full_season)';
begin
  if pg_catalog.to_regclass('cron.job') is not null then
    execute 'select count(*)::integer from cron.job where command ~* $1'
      into v_scheduled_jobs
      using v_pattern;
  end if;

  if v_scheduled_jobs > 0 then
    raise exception 'OBSOLETE_FUNCTION_STILL_SCHEDULED:%', v_scheduled_jobs;
  end if;
end;
$$;

-- Preserve the active waiver algorithm while replacing its session-local table
-- with an in-memory UUID array. Static checking can then validate the whole
-- function, and concurrent waiver runs remain isolated by ordinary variables.
do $$
declare
  v_signature regprocedure := pg_catalog.to_regprocedure('public.process_league_waivers(uuid,integer)');
  v_definition text;
  v_block_start integer;
  v_block_end_offset integer;
  v_block_length integer;
  v_order_block constant text := $replacement$  if v_is_first_window then
    select pg_catalog.array_agg(
      lm.user_id order by
        case when v_settings.initial_waiver_order_rule = 'DRAFT_ORDER' then lm.draft_order end asc nulls last,
        case when v_settings.initial_waiver_order_rule = 'REVERSE_DRAFT' then lm.draft_order end desc nulls last,
        lm.user_id
    )
    into v_manager_order
    from public.league_members lm
    where lm.league_id = p_league_id;
  else
    with standings_order as (
      select
        standings.user_id,
        row_number() over (order by standings.rank desc, standings.user_id)::integer as processing_position
      from public.get_league_standings_v2(
        p_league_id,
        greatest(p_gameweek - 1, 1),
        false
      ) standings
    ),
    complete_order as (
      select ordered.user_id, ordered.processing_position
      from standings_order ordered
      union all
      select
        lm.user_id,
        coalesce((select max(ordered.processing_position) from standings_order ordered), 0)
          + row_number() over (order by lm.draft_order desc nulls last, lm.user_id)::integer
      from public.league_members lm
      where lm.league_id = p_league_id
        and not exists (
          select 1 from standings_order ordered where ordered.user_id = lm.user_id
        )
    )
    select pg_catalog.array_agg(ordered.user_id order by ordered.processing_position)
    into v_manager_order
    from complete_order ordered;
  end if;$replacement$;
begin
  if v_signature is null then
    raise exception 'ACTIVE_WAIVER_PROCESSOR_NOT_FOUND';
  end if;

  select pg_catalog.pg_get_functiondef(v_signature::oid)
    into v_definition;

  if pg_catalog.strpos(v_definition, 'v_manager_order uuid[];') = 0 then
    v_definition := pg_catalog.replace(
      v_definition,
      '  v_is_first_window boolean;',
      E'  v_is_first_window boolean;\n  v_manager_order uuid[];'
    );

    if pg_catalog.strpos(v_definition, 'v_manager_order uuid[];') = 0 then
      raise exception 'ACTIVE_WAIVER_PROCESSOR_DECLARATION_PATTERN_NOT_FOUND';
    end if;

    v_block_start := pg_catalog.strpos(
      v_definition,
      '  drop table if exists pg_temp.waiver_manager_order;'
    );
    if v_block_start = 0 then
      raise exception 'ACTIVE_WAIVER_PROCESSOR_ORDER_BLOCK_NOT_FOUND';
    end if;

    v_block_end_offset := pg_catalog.strpos(
      pg_catalog.substr(v_definition, v_block_start),
      '  end if;'
    );
    if v_block_end_offset = 0 then
      raise exception 'ACTIVE_WAIVER_PROCESSOR_ORDER_BLOCK_END_NOT_FOUND';
    end if;

    v_block_length := v_block_end_offset + pg_catalog.length('  end if;') - 1;
    v_definition := pg_catalog.overlay(
      v_definition,
      v_order_block,
      v_block_start,
      v_block_length
    );

    v_definition := pg_catalog.replace(
      v_definition,
      '      select * from waiver_manager_order order by processing_position',
      E'      select manager.user_id\n      from pg_catalog.unnest(coalesce(v_manager_order, array[]::uuid[]))\n        with ordinality as manager(user_id, processing_position)\n      order by manager.processing_position'
    );

    if pg_catalog.strpos(v_definition, 'waiver_manager_order') > 0 then
      raise exception 'ACTIVE_WAIVER_PROCESSOR_TEMP_TABLE_REFERENCE_REMAINS';
    end if;

    execute v_definition;
  end if;
end;
$$;

do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'get_manager_luck_analysis',
        'get_manager_luck_index',
        'process_weekly_waiver_claims',
        'check_and_process_all_leagues',
        'execute_auto_pick',
        'simulate_single_gameweek',
        'simulate_full_season'
      ])
  loop
    execute pg_catalog.format('drop function %s', v_function.signature);
  end loop;
end;
$$;

comment on function public.process_league_waivers(uuid, integer) is
  'Authoritative weekly waiver processor using an isolated in-memory manager order for each run.';
