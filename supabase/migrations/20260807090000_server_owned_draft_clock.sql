-- Process expired draft turns entirely inside Postgres so drafts continue even
-- when every manager has disconnected. The existing execute_draft_autopick
-- function already locks and validates the current picker and pick number.

create or replace function public.process_expired_draft_sessions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_processed integer := 0;
begin
  for v_session in
    select
      ds.league_id,
      ds.current_picker_id,
      ds.current_pick_index
    from public.draft_sessions ds
    where ds.draft_status in ('LIVE', 'DRAFTING')
      and ds.current_picker_id is not null
      and ds.pick_deadline is not null
      and ds.pick_deadline <= pg_catalog.now()
    order by ds.pick_deadline asc
    for update skip locked
  loop
    begin
      v_result := public.execute_draft_autopick(
        v_session.league_id,
        v_session.current_picker_id,
        v_session.current_pick_index
      );
    exception
      when others then
        v_result := jsonb_build_object(
          'success', false,
          'error', 'AUTOPICK_EXCEPTION',
          'message', sqlerrm
        );
    end;

    if coalesce((v_result ->> 'success')::boolean, false) then
      v_processed := v_processed + 1;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'league_id', v_session.league_id,
        'pick_number', v_session.current_pick_index,
        'result', v_result
      )
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'sessions', v_results,
    'checked_at', pg_catalog.now()
  );
end;
$$;

comment on function public.process_expired_draft_sessions() is
  'Server-owned draft ticker: atomically auto-picks every expired active draft turn.';

-- Auto-picks must only be initiated by trusted server processes. Manual picks
-- remain available to authenticated clients through execute_draft_pick.
revoke all on function public.execute_draft_autopick(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.execute_draft_autopick(uuid, uuid, integer)
  to service_role;

revoke all on function public.process_expired_draft_sessions()
  from public, anon, authenticated;
grant execute on function public.process_expired_draft_sessions()
  to service_role;

-- Replace the old minute-based HTTP ticker (which embedded a privileged token)
-- with a direct database job. A five-second cadence keeps the UI responsive
-- without maintaining a long-running Edge Function invocation.
do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'draft-room-ticker'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'draft-room-ticker',
    '5 seconds',
    'select public.process_expired_draft_sessions();'
  );
end;
$$;

-- Retain two days of the frequent ticker run records.
do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'cleanup-draft-ticker-history'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'cleanup-draft-ticker-history',
    '15 4 * * *',
    $cleanup$
      delete from cron.job_run_details
      where jobid in (
        select jobid from cron.job where jobname = 'draft-room-ticker'
      )
        and end_time < now() - interval '2 days';
    $cleanup$
  );
end;
$$;
