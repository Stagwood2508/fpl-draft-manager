-- Keep database-originated HTTP available only to trusted server-owned jobs.
-- Browser roles must never be able to queue arbitrary outbound network requests.
revoke all on all functions in schema net from public, anon, authenticated;

-- The lounge uses this table for ordinary reads and writes, but it does not
-- subscribe to changes from it. Removing it narrows the Realtime publication
-- without changing lounge behaviour.
do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_lounge_reads'
  ) then
    alter publication supabase_realtime drop table public.league_lounge_reads;
  end if;
end;
$$;
