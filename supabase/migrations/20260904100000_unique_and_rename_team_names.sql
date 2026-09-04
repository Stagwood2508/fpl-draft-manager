-- Keep team names unique within each league and allow a manager to rename
-- their team up to three times during that league season.

alter table public.league_members
  add column if not exists team_name_change_count integer not null default 0,
  add column if not exists team_name_changed_at timestamptz;

alter table public.league_members
  drop constraint if exists league_members_team_name_change_count_check;

alter table public.league_members
  add constraint league_members_team_name_change_count_check
  check (team_name_change_count between 0 and 3);

-- Refuse to guess which existing manager should keep a duplicated name. This
-- gives the commissioner a clear data issue to resolve before the unique index
-- is installed.
do $$
declare
  v_duplicate record;
begin
  select
    lm.league_id,
    pg_catalog.lower(pg_catalog.btrim(lm.team_name)) as normalized_name,
    pg_catalog.count(*) as duplicate_count
  into v_duplicate
  from public.league_members lm
  group by lm.league_id, pg_catalog.lower(pg_catalog.btrim(lm.team_name))
  having pg_catalog.count(*) > 1
  limit 1;

  if found then
    raise exception
      'Duplicate team name "%" exists % times in league %. Rename one duplicate before applying this migration.',
      v_duplicate.normalized_name,
      v_duplicate.duplicate_count,
      v_duplicate.league_id;
  end if;
end;
$$;

create unique index if not exists league_members_league_team_name_unique
  on public.league_members (
    league_id,
    pg_catalog.lower(pg_catalog.btrim(team_name))
  );

create or replace function public.enforce_league_member_team_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text := nullif(pg_catalog.btrim(coalesce(new.team_name, '')), '');
begin
  if v_team_name is null or pg_catalog.char_length(v_team_name) > 50 then
    raise exception 'INVALID_TEAM_NAME' using errcode = '22023';
  end if;

  new.team_name := v_team_name;

  if tg_op = 'INSERT' then
    new.team_name_change_count := 0;
    new.team_name_changed_at := null;
    return new;
  end if;

  if new.team_name is distinct from old.team_name then
    if old.team_name_change_count >= 3 and auth.role() <> 'service_role' then
      raise exception 'TEAM_NAME_CHANGE_LIMIT_REACHED' using errcode = 'P0001';
    end if;

    new.team_name_change_count := old.team_name_change_count + 1;
    new.team_name_changed_at := pg_catalog.now();
  else
    -- These values are controlled by the database, not by client updates.
    new.team_name_change_count := old.team_name_change_count;
    new.team_name_changed_at := old.team_name_changed_at;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_league_member_team_name_trigger
  on public.league_members;

create trigger enforce_league_member_team_name_trigger
before insert or update of team_name, team_name_change_count, team_name_changed_at
on public.league_members
for each row execute function public.enforce_league_member_team_name();

create or replace function public.join_league_with_validation(
  p_league_id uuid,
  p_team_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_name text := nullif(pg_catalog.btrim(coalesce(p_team_name, '')), '');
  v_current_count integer;
  v_max_size integer;
  v_status text;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if p_league_id is null then
    return jsonb_build_object('success', false, 'error', 'LEAGUE_NOT_FOUND');
  end if;

  if v_team_name is null or pg_catalog.char_length(v_team_name) > 50 then
    return jsonb_build_object('success', false, 'error', 'INVALID_TEAM_NAME');
  end if;

  select
    l.max_size,
    pg_catalog.upper(coalesce(l.draft_status, l.status, 'PRE_DRAFT'))
  into v_max_size, v_status
  from public.leagues l
  where l.id = p_league_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'LEAGUE_NOT_FOUND');
  end if;

  if exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = v_user_id
  ) then
    return jsonb_build_object('success', true, 'already_member', true);
  end if;

  if v_status not in ('PRE_DRAFT', 'WAITING_ROOM', 'NOT_STARTED', 'WAITING') then
    return jsonb_build_object('success', false, 'error', 'DRAFT_ALREADY_STARTED');
  end if;

  if exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and pg_catalog.lower(pg_catalog.btrim(lm.team_name)) =
          pg_catalog.lower(v_team_name)
  ) then
    return jsonb_build_object('success', false, 'error', 'TEAM_NAME_TAKEN');
  end if;

  select pg_catalog.count(*)::integer
  into v_current_count
  from public.league_members lm
  where lm.league_id = p_league_id;

  if v_current_count >= coalesce(v_max_size, 8) then
    return jsonb_build_object('success', false, 'error', 'LEAGUE_FULL');
  end if;

  insert into public.league_members (league_id, user_id, team_name, role)
  values (p_league_id, v_user_id, v_team_name, 'MEMBER');

  return jsonb_build_object('success', true);
exception
  when unique_violation then
    if exists (
      select 1
      from public.league_members lm
      where lm.league_id = p_league_id
        and lm.user_id = v_user_id
    ) then
      return jsonb_build_object('success', true, 'already_member', true);
    end if;

    return jsonb_build_object('success', false, 'error', 'TEAM_NAME_TAKEN');
end;
$$;

revoke all on function public.join_league_with_validation(uuid, text)
from public, anon;
grant execute on function public.join_league_with_validation(uuid, text)
to authenticated, service_role;

create or replace function public.change_my_team_name(
  p_league_id uuid,
  p_team_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_name text := nullif(pg_catalog.btrim(coalesce(p_team_name, '')), '');
  v_member public.league_members%rowtype;
  v_change_count integer;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if v_team_name is null or pg_catalog.char_length(v_team_name) > 50 then
    return jsonb_build_object('success', false, 'error', 'INVALID_TEAM_NAME');
  end if;

  select lm.*
  into v_member
  from public.league_members lm
  where lm.league_id = p_league_id
    and lm.user_id = v_user_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'NOT_LEAGUE_MEMBER');
  end if;

  if v_team_name = v_member.team_name then
    return jsonb_build_object(
      'success', true,
      'unchanged', true,
      'team_name', v_member.team_name,
      'changes_used', v_member.team_name_change_count,
      'changes_remaining', 3 - v_member.team_name_change_count
    );
  end if;

  if v_member.team_name_change_count >= 3 then
    return jsonb_build_object(
      'success', false,
      'error', 'TEAM_NAME_CHANGE_LIMIT_REACHED'
    );
  end if;

  if exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id <> v_user_id
      and pg_catalog.lower(pg_catalog.btrim(lm.team_name)) =
          pg_catalog.lower(v_team_name)
  ) then
    return jsonb_build_object('success', false, 'error', 'TEAM_NAME_TAKEN');
  end if;

  update public.league_members
  set team_name = v_team_name
  where league_id = p_league_id
    and user_id = v_user_id
  returning team_name_change_count into v_change_count;

  -- League fixtures cache team names for display, so keep those labels aligned
  -- without changing the fixture participants or scores.
  update public.league_fixtures
  set
    home_team_name = case
      when home_user_id = v_user_id then v_team_name
      else home_team_name
    end,
    away_team_name = case
      when away_user_id = v_user_id then v_team_name
      else away_team_name
    end
  where league_id = p_league_id
    and (home_user_id = v_user_id or away_user_id = v_user_id);

  return jsonb_build_object(
    'success', true,
    'team_name', v_team_name,
    'changes_used', v_change_count,
    'changes_remaining', 3 - v_change_count
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'error', 'TEAM_NAME_TAKEN');
  when check_violation then
    return jsonb_build_object('success', false, 'error', 'TEAM_NAME_CHANGE_LIMIT_REACHED');
end;
$$;

revoke all on function public.change_my_team_name(uuid, text)
from public, anon;
grant execute on function public.change_my_team_name(uuid, text)
to authenticated, service_role;

