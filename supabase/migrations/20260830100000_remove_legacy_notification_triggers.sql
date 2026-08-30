-- The old notification centre used public.notifications. That table was
-- replaced by public.user_notifications, but database drift can leave trigger
-- functions attached to unrelated tables (including rosters). Any write that
-- fires one of those triggers is rolled back before the application RPC can
-- return successfully.
--
-- Current notification functions explicitly write to user_notifications, so
-- remove only triggers whose function still targets the retired table. This
-- deliberately does not remove or alter any current notification trigger.

do $$
declare
  v_trigger record;
  v_function_definition text;
begin
  for v_trigger in
    select
      trigger_row.oid as trigger_oid,
      trigger_row.tgname as trigger_name,
      trigger_row.tgrelid,
      table_namespace.nspname as table_schema,
      table_class.relname as table_name,
      trigger_function.oid as function_oid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class table_class
      on table_class.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_class.relnamespace
    join pg_catalog.pg_proc trigger_function
      on trigger_function.oid = trigger_row.tgfoid
    where not trigger_row.tgisinternal
      and table_namespace.nspname = 'public'
  loop
    v_function_definition := lower(
      pg_catalog.pg_get_functiondef(v_trigger.function_oid)
    );

    if pg_catalog.strpos(v_function_definition, 'user_notifications') > 0 then
      continue;
    end if;

    if
      pg_catalog.strpos(v_function_definition, 'public.notifications') > 0
      or v_function_definition ~ 'insert[[:space:]]+into[[:space:]]+notifications([[:space:](]|$)'
    then
      raise notice 'Removing legacy notification trigger %.% on %.%',
        v_trigger.table_schema,
        v_trigger.trigger_name,
        v_trigger.table_schema,
        v_trigger.table_name;

      execute pg_catalog.format(
        'drop trigger if exists %I on %I.%I',
        v_trigger.trigger_name,
        v_trigger.table_schema,
        v_trigger.table_name
      );
    end if;
  end loop;
end;
$$;

-- Fail the migration if an obsolete trigger remains, rather than allowing the
-- deployment to appear successful while writes can still be rolled back.
do $$
declare
  v_remaining text;
begin
  select pg_catalog.string_agg(
    pg_catalog.format('%I.%I on %I.%I',
      function_namespace.nspname,
      trigger_function.proname,
      table_namespace.nspname,
      table_class.relname
    ),
    ', '
  )
  into v_remaining
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class table_class
    on table_class.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace table_namespace
    on table_namespace.oid = table_class.relnamespace
  join pg_catalog.pg_proc trigger_function
    on trigger_function.oid = trigger_row.tgfoid
  join pg_catalog.pg_namespace function_namespace
    on function_namespace.oid = trigger_function.pronamespace
  where not trigger_row.tgisinternal
    and table_namespace.nspname = 'public'
    and pg_catalog.strpos(
      lower(pg_catalog.pg_get_functiondef(trigger_function.oid)),
      'user_notifications'
    ) = 0
    and (
      pg_catalog.strpos(
        lower(pg_catalog.pg_get_functiondef(trigger_function.oid)),
        'public.notifications'
      ) > 0
      or lower(pg_catalog.pg_get_functiondef(trigger_function.oid))
        ~ 'insert[[:space:]]+into[[:space:]]+notifications([[:space:](]|$)'
    );

  if v_remaining is not null then
    raise exception 'Legacy notification triggers remain: %', v_remaining;
  end if;
end;
$$;

comment on function public.set_transfer_listing(uuid, uuid, boolean, text) is
  'Owner-only transfer-list update. Legacy notification triggers targeting public.notifications are removed separately so listing writes cannot be rolled back.';
