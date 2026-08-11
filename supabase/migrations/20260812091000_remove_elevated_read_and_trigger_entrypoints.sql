-- Remove two classes of unnecessary elevated API surface identified by the
-- production security advisor.

-- This view previously evaluated its underlying RLS policies as the view
-- owner. It is read-only app data, so make it obey the caller's permissions.
alter view public.league_active_players_view
set (security_invoker = true);

revoke all on table public.league_active_players_view
from public, anon, authenticated;
grant select on table public.league_active_players_view to authenticated;
grant all on table public.league_active_players_view to service_role;

-- Trigger functions are invoked by PostgreSQL through their triggers and do
-- not need to be callable as public REST RPCs.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
  loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated',
      v_function.signature
    );
  end loop;
end;
$$;

-- These legacy mutation functions have no callers in the current app. The
-- supported paths are execute_draft_pick() and save_manager_lineup().
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
        'make_draft_pick',
        'process_manual_pick',
        'submit_validated_draft_pick',
        'swap_roster_players'
      ])
  loop
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated',
      v_function.signature
    );
  end loop;
end;
$$;

