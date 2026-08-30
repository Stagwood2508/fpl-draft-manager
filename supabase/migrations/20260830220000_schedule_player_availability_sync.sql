-- Player injury, suspension and selection news changes between fixtures, so it
-- must not depend on the in-play scoring worker being active.

create or replace function public.trigger_player_availability_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cron_secret text;
  v_request_id bigint;
begin
  select secret.decrypted_secret into v_cron_secret
  from vault.decrypted_secrets secret
  where secret.name = 'live_stats_cron_secret'
  limit 1;

  if nullif(v_cron_secret, '') is null then
    raise warning 'live_stats_cron_secret is not configured; player availability sync skipped';
    return;
  end if;

  select net.http_get(
    url := 'https://fnysbiwhwcqqqdwvhkau.supabase.co/functions/v1/sync-live-stats?mode=players',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_cron_secret
    )
  ) into v_request_id;
end;
$$;

revoke all on function public.trigger_player_availability_sync() from public, anon, authenticated;
grant execute on function public.trigger_player_availability_sync() to service_role;

do $$
declare
  v_job record;
begin
  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) then
    raise warning 'pg_cron is not installed; player availability schedule was not created';
    return;
  end if;

  for v_job in
    select jobid from cron.job where jobname = 'sync-player-availability'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'sync-player-availability',
    '*/30 * * * *',
    'select public.trigger_player_availability_sync();'
  );

  -- Populate the status fields immediately rather than waiting for the next
  -- half-hour boundary. pg_net performs the request asynchronously.
  perform public.trigger_player_availability_sync();
end;
$$;

comment on function public.trigger_player_availability_sync() is
  'Queues the secured player-pool availability refresh independently of live scoring.';
