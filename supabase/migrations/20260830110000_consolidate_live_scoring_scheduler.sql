-- Consolidate historical live-stat jobs into the single lifecycle worker.
-- Multiple legacy schedules were independently calling the same Edge Function,
-- creating duplicate requests and making production failures harder to assess.

do $$
declare
  v_job record;
begin
  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) then
    raise warning 'pg_cron is not installed; live-scoring schedule was not changed';
    return;
  end if;

  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'sync-live-stats-every-2-mins',
      'process-gameweek-state-transitions-job',
      'gameweek-lineup-lifecycle'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'gameweek-lineup-lifecycle',
    '* * * * *',
    'select public.run_gameweek_lineup_lifecycle();'
  );
end;
$$;

do $$
declare
  v_authoritative_jobs integer;
  v_legacy_jobs integer;
begin
  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) then
    return;
  end if;

  select count(*) into v_authoritative_jobs
  from cron.job
  where jobname = 'gameweek-lineup-lifecycle'
    and active;

  select count(*) into v_legacy_jobs
  from cron.job
  where jobname in (
    'sync-live-stats-every-2-mins',
    'process-gameweek-state-transitions-job'
  );

  if v_authoritative_jobs <> 1 or v_legacy_jobs <> 0 then
    raise exception
      'Live-scoring scheduler consolidation failed (authoritative %, legacy %)',
      v_authoritative_jobs,
      v_legacy_jobs;
  end if;
end;
$$;

comment on function public.run_gameweek_lineup_lifecycle() is
  'Single authoritative minute worker for schedule refresh, deadline snapshots, autosubs and official live-stat ingestion.';
