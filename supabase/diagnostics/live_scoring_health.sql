-- Read-only production health check for the deadline and live-scoring pipeline.
-- Secret values and manager-identifying data are deliberately excluded.

select
  gameweek_number,
  fpl_deadline_time,
  is_current,
  is_finished
from public.gameweeks
where is_current
   or not coalesce(is_finished, false)
order by gameweek_number
limit 5;

select
  gameweek,
  count(*) as league_rows,
  count(*) filter (where is_current) as current_rows,
  count(*) filter (where is_finished) as finished_rows,
  pg_catalog.min(status::text) as minimum_status,
  pg_catalog.max(status::text) as maximum_status,
  pg_catalog.min(gw_deadline) as earliest_deadline,
  pg_catalog.max(gw_deadline) as latest_deadline
from public.league_gameweeks
where is_current
   or not coalesce(is_finished, false)
group by gameweek
order by gameweek
limit 5;

select
  gameweek,
  count(*) as stat_rows,
  count(*) filter (where total_points <> 0 or minutes <> 0) as active_stat_rows,
  pg_catalog.max(updated_at) as latest_update
from public.player_gameweek_stats
group by gameweek
order by gameweek desc
limit 5;

select
  gameweek,
  count(*) as snapshot_rows,
  count(*) filter (where status = 'CAPTURED') as captured_rows,
  count(*) filter (where status = 'PROCESSED') as processed_rows,
  pg_catalog.max(deadline_at) as latest_deadline
from public.gameweek_lineup_snapshots
group by gameweek
order by gameweek desc
limit 5;

select
  exists (
    select 1
    from vault.decrypted_secrets
    where name = 'live_stats_cron_secret'
      and nullif(decrypted_secret, '') is not null
  ) as database_cron_secret_configured;

select
  jobid,
  jobname,
  schedule,
  active,
  command
from cron.job
where jobname = 'gameweek-lineup-lifecycle';

select
  status,
  start_time,
  end_time,
  return_message
from cron.job_run_details
where jobid in (
  select jobid from cron.job where jobname = 'gameweek-lineup-lifecycle'
)
order by start_time desc
limit 10;

select
  count(*) filter (where status = 'ACTIVE' and expires_at > pg_catalog.now())
    as active_simulation_locks,
  pg_catalog.max(expires_at) filter (where status = 'ACTIVE')
    as latest_active_expiry
from public.gameweek_simulation_runs;

select
  id,
  status_code,
  created,
  left(content::text, 500) as response_preview
from net._http_response
where content::text ilike '%gameweek%'
   or content::text ilike '%unauthorized%'
   or content::text ilike '%live stats%'
order by created desc
limit 10;

-- Consolidated result for command-line clients that display only the final
-- result set when a file contains several read-only checks.
select pg_catalog.jsonb_build_object(
  'current_gameweek', (
    select to_jsonb(current_gameweek)
    from (
      select gameweek_number, fpl_deadline_time, is_current, is_finished
      from public.gameweeks
      where is_current
         or (not coalesce(is_finished, false) and fpl_deadline_time <= pg_catalog.now())
      order by coalesce(is_current, false) desc, gameweek_number desc
      limit 1
    ) current_gameweek
  ),
  'deadline_snapshots', (
    select coalesce(pg_catalog.jsonb_agg(to_jsonb(snapshot_summary)), '[]'::jsonb)
    from (
      select
        gameweek,
        count(*) as total,
        count(*) filter (where status = 'LOCKED') as locked,
        count(*) filter (where status = 'PROCESSED') as processed,
        max(deadline_at) as deadline_at
      from public.gameweek_lineup_snapshots
      group by gameweek
      order by gameweek desc
      limit 3
    ) snapshot_summary
  ),
  'players', (
    select pg_catalog.jsonb_build_object(
      'total', count(*),
      'active', count(*) filter (where is_active)
    )
    from public.players
  ),
  'gameweek_stats', (
    select coalesce(
      pg_catalog.jsonb_agg(to_jsonb(stat_summary) order by stat_summary.gameweek),
      '[]'::jsonb
    )
    from (
      select
        gameweek,
        count(*) as stat_rows,
        count(*) filter (where minutes > 0) as played_rows,
        count(*) filter (where total_points <> 0) as scored_rows,
        sum(total_points) as total_player_points,
        max(updated_at) as latest_update
      from public.player_gameweek_stats
      group by gameweek
    ) stat_summary
  ),
  'schedules', (
    select coalesce(pg_catalog.jsonb_agg(to_jsonb(schedule_summary)), '[]'::jsonb)
    from (
      select jobid, jobname, schedule, active, command
      from cron.job
      where jobname in (
        'sync-live-stats-every-2-mins',
        'process-gameweek-state-transitions-job',
        'gameweek-lineup-lifecycle'
      )
      order by jobid
    ) schedule_summary
  ),
  'recent_scheduler_runs', (
    select coalesce(pg_catalog.jsonb_agg(to_jsonb(run_summary)), '[]'::jsonb)
    from (
      select status, start_time, end_time, return_message
      from cron.job_run_details
      where jobid in (
        select jobid from cron.job where jobname = 'gameweek-lineup-lifecycle'
      )
      order by start_time desc
      limit 5
    ) run_summary
  ),
  'latest_http', (
    select coalesce(pg_catalog.jsonb_agg(to_jsonb(http_summary)), '[]'::jsonb)
    from (
      select id, status_code, created, left(content::text, 1200) as response
      from net._http_response
      order by created desc
      limit 5
    ) http_summary
  ),
  'live_fixture_totals', (
    select pg_catalog.jsonb_build_object(
      'fixtures', count(*),
      'home_points', coalesce(sum(home_score), 0),
      'away_points', coalesce(sum(away_score), 0)
    )
    from public.get_live_fixture_scores(
      (
        select gameweek_number
        from public.gameweeks
        where not coalesce(is_finished, false)
          and fpl_deadline_time <= pg_catalog.now()
        order by coalesce(is_current, false) desc, gameweek_number desc
        limit 1
      )
    )
  )
) as health;
