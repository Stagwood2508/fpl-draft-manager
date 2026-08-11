-- Beta security lockdown
--
-- 1. Profiles may only be read by their owner or managers who share a league.
-- 2. Sensitive profile columns (email and push token) are never client-readable.
-- 3. Profile writes are owner-only and limited to approved columns.
-- 4. League joins derive the user from auth.uid() and serialize capacity checks.

create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_profile_id = auth.uid()
    or exists (
      select 1
      from public.league_members viewer_membership
      join public.league_members target_membership
        on target_membership.league_id = viewer_membership.league_id
      where viewer_membership.user_id = auth.uid()
        and target_membership.user_id = p_profile_id
    );
$$;

revoke all on function public.can_view_profile(uuid) from public, anon;
grant execute on function public.can_view_profile(uuid) to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
  loop
    execute pg_catalog.format(
      'drop policy %I on public.profiles',
      v_policy.policyname
    );
  end loop;
end;
$$;

create policy profiles_shared_league_read
on public.profiles
for select
to authenticated
using (public.can_view_profile(id));

create policy profiles_owner_insert
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy profiles_owner_update
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

revoke all on table public.profiles from public, anon, authenticated;

grant select (
  id,
  display_name,
  team_name,
  avatar_url,
  first_name,
  last_name,
  created_at
) on public.profiles to authenticated;

grant insert (
  id,
  display_name,
  team_name,
  avatar_url,
  first_name,
  last_name,
  expo_push_token
) on public.profiles to authenticated;

grant update (
  display_name,
  team_name,
  avatar_url,
  first_name,
  last_name,
  expo_push_token
) on public.profiles to authenticated;

grant all on table public.profiles to service_role;

-- Remove the legacy signature. It trusted a caller-controlled p_user_id and
-- inherited EXECUTE from PUBLIC, allowing an anonymous caller to add any user.
revoke all on function public.join_league_with_validation(uuid, uuid, text)
from public, anon, authenticated;

drop function public.join_league_with_validation(uuid, uuid, text);

create function public.join_league_with_validation(
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

  -- Lock the league while checking capacity so two simultaneous joins cannot
  -- both claim the final available place.
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

  -- Retried requests from an existing member are safe and idempotent.
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

  select pg_catalog.count(*)::integer
  into v_current_count
  from public.league_members lm
  where lm.league_id = p_league_id;

  if v_current_count >= coalesce(v_max_size, 8) then
    return jsonb_build_object('success', false, 'error', 'LEAGUE_FULL');
  end if;

  insert into public.league_members (
    league_id,
    user_id,
    team_name,
    role
  ) values (
    p_league_id,
    v_user_id,
    v_team_name,
    'MEMBER'
  );

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

