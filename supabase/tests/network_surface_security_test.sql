begin;

do $$
declare
  v_exposed_net_function text;
begin
  select p.oid::regprocedure::text
    into v_exposed_net_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'net'
    and (
      pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
  limit 1;

  if v_exposed_net_function is not null then
    raise exception 'Browser roles must not execute pg_net function: %', v_exposed_net_function;
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_lounge_reads'
  ) then
    raise exception 'league_lounge_reads must not be published to Realtime';
  end if;
end;
$$;

rollback;
