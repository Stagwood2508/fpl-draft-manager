begin;

do $$
declare
  v_user_id uuid;
  v_result jsonb;
  v_league_id uuid;
begin
  if pg_catalog.to_regprocedure(
       'public.create_league_atomic(text,text,integer,text)'
     ) is null then
    raise exception 'atomic league creation RPC is missing';
  end if;

  if pg_catalog.has_function_privilege(
       'anon', 'public.create_league_atomic(text,text,integer,text)', 'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'anon', 'public.delete_my_account()', 'EXECUTE'
     ) then
    raise exception 'anon can execute an account operation';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated', 'public.create_league_atomic(text,text,integer,text)', 'EXECUTE'
     ) or not pg_catalog.has_function_privilege(
       'authenticated', 'public.delete_my_account()', 'EXECUTE'
     ) then
    raise exception 'authenticated account operations are blocked';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'app_error_reports'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'app_error_reports is not protected by RLS';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tester_feedback'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'tester_feedback is not protected by RLS';
  end if;

  select id into v_user_id from auth.users order by created_at limit 1;
  if v_user_id is null then
    raise exception 'an authenticated fixture user is required';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := public.create_league_atomic(
    'CODEX ATOMIC LEAGUE TEST',
    'CODEX TEST TEAM',
    4,
    'STRICT'
  );

  if not coalesce((v_result ->> 'success')::boolean, false) then
    raise exception 'atomic league creation returned failure: %', v_result;
  end if;

  v_league_id := (v_result ->> 'league_id')::uuid;
  if not exists (select 1 from public.leagues where id = v_league_id)
     or not exists (select 1 from public.league_members where league_id = v_league_id and user_id = v_user_id)
     or not exists (select 1 from public.league_settings where league_id = v_league_id)
     or not exists (select 1 from public.draft_sessions where league_id = v_league_id) then
    raise exception 'atomic league creation did not create all four records';
  end if;
end;
$$;

rollback;
