begin;

do $$
begin
  if not (
    select c.relrowsecurity and c.relforcerowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'profiles'
  ) then
    raise exception 'profiles RLS is not enabled and forced';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.profiles', 'UPDATE') then
    raise exception 'anon still has profiles access';
  end if;

  if pg_catalog.has_column_privilege(
       'authenticated', 'public.profiles', 'email', 'SELECT'
     ) or pg_catalog.has_column_privilege(
       'authenticated', 'public.profiles', 'expo_push_token', 'SELECT'
     ) then
    raise exception 'authenticated can still read sensitive profile columns';
  end if;

  if pg_catalog.to_regprocedure(
       'public.join_league_with_validation(uuid,uuid,text)'
     ) is not null then
    raise exception 'unsafe league join signature still exists';
  end if;

  if pg_catalog.to_regprocedure(
       'public.join_league_with_validation(uuid,text)'
     ) is null then
    raise exception 'secure league join signature is missing';
  end if;

  if pg_catalog.has_function_privilege(
       'anon', 'public.join_league_with_validation(uuid,text)', 'EXECUTE'
     ) then
    raise exception 'anon can execute league joins';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated', 'public.join_league_with_validation(uuid,text)', 'EXECUTE'
     ) then
    raise exception 'authenticated cannot execute league joins';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = 'public.league_active_players_view'::pg_catalog.regclass
      and coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true']
  ) then
    raise exception 'league_active_players_view is not security invoker';
  end if;

  if pg_catalog.has_table_privilege(
       'anon', 'public.league_active_players_view', 'SELECT'
     ) then
    raise exception 'anon can still read league_active_players_view';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
      and (
        pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) then
    raise exception 'a public trigger function is still directly executable';
  end if;
end;
$$;

rollback;
