begin;

do $$
declare
  v_exposed_wrapper text;
begin
  -- The pg_net extension is owned and maintained by Supabase, outside the
  -- PostgREST-exposed schemas. The meaningful application boundary is that no
  -- browser-callable public function may wrap its outbound HTTP capabilities.
  select p.oid::regprocedure::text
    into v_exposed_wrapper
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
    and pg_get_functiondef(p.oid) ilike '%net.http%'
  limit 1;

  if v_exposed_wrapper is not null then
    raise exception 'Browser roles must not execute a public pg_net wrapper: %', v_exposed_wrapper;
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
