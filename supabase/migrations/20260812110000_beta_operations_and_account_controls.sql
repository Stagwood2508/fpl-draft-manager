-- Beta operations: atomic league creation, crash/feedback capture and safe
-- authenticated account deletion.

create or replace function public.create_league_atomic(
  p_name text,
  p_team_name text,
  p_max_size integer,
  p_roster_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := nullif(pg_catalog.btrim(coalesce(p_name, '')), '');
  v_team_name text := nullif(pg_catalog.btrim(coalesce(p_team_name, '')), '');
  v_roster_type text := pg_catalog.upper(coalesce(p_roster_type, 'STRICT'));
  v_league_id uuid;
  v_invite_code text;
  v_attempt integer := 0;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if v_name is null or pg_catalog.char_length(v_name) > 80 then
    return jsonb_build_object('success', false, 'error', 'INVALID_LEAGUE_NAME');
  end if;

  if v_team_name is null or pg_catalog.char_length(v_team_name) > 50 then
    return jsonb_build_object('success', false, 'error', 'INVALID_TEAM_NAME');
  end if;

  if p_max_size is null or p_max_size < 2 or p_max_size > 20 then
    return jsonb_build_object('success', false, 'error', 'INVALID_LEAGUE_SIZE');
  end if;

  if v_roster_type not in ('STRICT', 'FLEXIBLE') then
    return jsonb_build_object('success', false, 'error', 'INVALID_ROSTER_TYPE');
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_invite_code := pg_catalog.upper(
      pg_catalog.substr(
        pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
        1,
        6
      )
    );

    begin
      insert into public.leagues (
        name, commissioner_id, draft_status, status, invite_code,
        max_size, roster_type
      ) values (
        v_name, v_user_id, 'PRE_DRAFT', 'PRE_DRAFT', v_invite_code,
        p_max_size, v_roster_type
      )
      returning id into v_league_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.league_members (
    league_id, user_id, team_name, role, draft_order
  ) values (
    v_league_id, v_user_id, v_team_name, 'COMMISSIONER', 1
  );

  insert into public.league_settings (
    league_id, draft_clock_duration, roster_type, trade_cutoff_rule,
    dropped_player_rule, initial_waiver_order_rule
  ) values (
    v_league_id, 60, v_roster_type, 'WAIVER_DEADLINE',
    'NEXT_WAIVER', 'REVERSE_DRAFT'
  );

  insert into public.draft_sessions (
    league_id, draft_status, current_round, current_pick_index,
    current_picker_id, pick_deadline
  ) values (
    v_league_id, 'WAITING_ROOM', 1, 1, v_user_id, null
  );

  return jsonb_build_object(
    'success', true,
    'league_id', v_league_id,
    'invite_code', v_invite_code
  );
exception when others then
  raise;
end;
$$;

revoke all on function public.create_league_atomic(text, text, integer, text)
from public, anon;
grant execute on function public.create_league_atomic(text, text, integer, text)
to authenticated, service_role;

create table if not exists public.app_error_reports (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  league_id uuid references public.leagues(id) on delete set null,
  error_type text not null default 'UNHANDLED',
  message text not null,
  stack text,
  route text,
  platform text,
  app_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now()
);

alter table public.app_error_reports enable row level security;
alter table public.app_error_reports force row level security;

create policy app_error_reports_owner_insert
on public.app_error_reports for insert to authenticated
with check (user_id = auth.uid());

create policy app_error_reports_owner_read
on public.app_error_reports for select to authenticated
using (user_id = auth.uid());

revoke all on table public.app_error_reports from public, anon, authenticated;
grant select, insert on table public.app_error_reports to authenticated;
grant all on table public.app_error_reports to service_role;

create table if not exists public.tester_feedback (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  league_id uuid references public.leagues(id) on delete set null,
  category text not null check (category in ('BUG', 'IDEA', 'USABILITY', 'OTHER')),
  message text not null check (
    pg_catalog.char_length(pg_catalog.btrim(message)) between 10 and 2000
  ),
  route text,
  platform text,
  app_version text,
  status text not null default 'NEW' check (status in ('NEW', 'REVIEWED', 'RESOLVED')),
  created_at timestamptz not null default pg_catalog.now()
);

alter table public.tester_feedback enable row level security;
alter table public.tester_feedback force row level security;

create policy tester_feedback_owner_insert
on public.tester_feedback for insert to authenticated
with check (user_id = auth.uid());

create policy tester_feedback_owner_read
on public.tester_feedback for select to authenticated
using (user_id = auth.uid());

revoke all on table public.tester_feedback from public, anon, authenticated;
grant select, insert on table public.tester_feedback to authenticated;
grant all on table public.tester_feedback to service_role;

create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_blocking_leagues jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  select jsonb_agg(jsonb_build_object('id', league.id, 'name', league.name))
  into v_blocking_leagues
  from public.leagues league
  where league.commissioner_id = v_user_id
    and (
      select pg_catalog.count(*)
      from public.league_members member
      where member.league_id = league.id
        and member.user_id <> v_user_id
    ) > 0;

  if v_blocking_leagues is not null then
    return jsonb_build_object(
      'success', false,
      'error', 'COMMISSIONER_TRANSFER_REQUIRED',
      'leagues', v_blocking_leagues
    );
  end if;

  -- Owned leagues with no other managers can be removed safely.
  delete from public.leagues league
  where league.commissioner_id = v_user_id;

  update public.draft_sessions
  set current_picker_id = null
  where current_picker_id = v_user_id;

  update public.draft_sessions
  set paused_by = null
  where paused_by = v_user_id;

  update public.gameweek_lineup_snapshots
  set corrected_by = null
  where corrected_by = v_user_id;

  update public.draft_pick_audit
  set actor_user_id = null
  where actor_user_id = v_user_id;

  update public.draft_pick_audit
  set user_id = null
  where user_id = v_user_id;

  delete from public.transactions
  where sender_id = v_user_id or receiver_id = v_user_id;
  delete from public.lineup_change_audit where user_id = v_user_id;
  delete from public.watchlists where user_id = v_user_id;
  delete from public.rosters where user_id = v_user_id;
  delete from public.draft_manager_autopick_state where user_id = v_user_id;
  delete from public.draft_autopick_debug where user_id = v_user_id;
  delete from public.draft_picks where user_id = v_user_id;
  delete from public.league_members where user_id = v_user_id;

  -- Remaining user-linked tables either cascade or set null from auth.users.
  delete from auth.users where id = v_user_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated, service_role;
