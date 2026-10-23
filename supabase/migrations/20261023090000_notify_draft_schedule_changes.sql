-- Notify league managers as soon as a commissioner schedules or reschedules a draft.
-- Draft reminders closer to kick-off are handled separately by
-- enqueue_due_draft_notifications().

create or replace function public.notify_draft_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_name text;
  v_scheduled_for text;
  v_actor_id uuid := auth.uid();
begin
  -- A cleared schedule is not an actionable event. Re-saving the same time
  -- should not create another notification either.
  if new.draft_start_time is null
    or new.draft_start_time is not distinct from old.draft_start_time then
    return new;
  end if;

  select league.name
    into v_league_name
  from public.leagues league
  where league.id = new.league_id;

  -- The app's leagues currently use UK time. State that explicitly so the
  -- recipient can interpret the date consistently around daylight-saving.
  v_scheduled_for := to_char(
    new.draft_start_time at time zone 'Europe/London',
    'FMDay, FMDD Mon YYYY at HH24:MI'
  ) || ' UK time';

  insert into public.user_notifications (
    user_id, league_id, category, title, body, route, dedupe_key
  )
  select
    member.user_id,
    new.league_id,
    'SYSTEM',
    case
      when old.draft_start_time is null then 'Draft date confirmed'
      else 'Draft date changed'
    end,
    coalesce(v_league_name, 'Your league') || ' draft is scheduled for ' || v_scheduled_for || '.',
    '/draft-room?leagueId=' || new.league_id,
    'draft-scheduled:' || new.league_id || ':'
      || extract(epoch from new.draft_start_time)::bigint || ':'
      || to_char(new.updated_at, 'YYYYMMDDHH24MISSUS')
  from public.league_members member
  left join public.notification_preferences preference
    on preference.user_id = member.user_id
  where member.league_id = new.league_id
    -- The commissioner has just received the save confirmation in the app;
    -- everyone else needs the new schedule communicated to them.
    and (v_actor_id is null or member.user_id <> v_actor_id)
    and coalesce(preference.draft_enabled, true)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

drop trigger if exists draft_schedule_change_notification on public.league_settings;
create trigger draft_schedule_change_notification
  after update of draft_start_time on public.league_settings
  for each row execute function public.notify_draft_schedule_change();

revoke all on function public.notify_draft_schedule_change() from public, anon, authenticated;
