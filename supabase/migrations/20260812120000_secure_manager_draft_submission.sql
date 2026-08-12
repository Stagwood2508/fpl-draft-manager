-- Keep the authoritative draft engine internal. A signed-in manager submits a
-- pick through a wrapper that derives the manager identity from auth.uid(), so
-- a client can never choose another manager's user id.

create or replace function public.submit_draft_pick(
  p_league_id uuid,
  p_player_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if not exists (
    select 1
    from public.league_members member
    where member.league_id = p_league_id
      and member.user_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'error', 'LEAGUE_MEMBERSHIP_REQUIRED');
  end if;

  return public.execute_draft_pick(p_league_id, v_user_id, p_player_id);
end;
$$;

revoke all on function public.execute_draft_pick(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.execute_draft_pick(uuid, uuid, integer)
  to service_role;

revoke all on function public.submit_draft_pick(uuid, integer)
  from public, anon;
grant execute on function public.submit_draft_pick(uuid, integer)
  to authenticated, service_role;

comment on function public.submit_draft_pick(uuid, integer) is
  'Submits a manual pick for auth.uid(); clients cannot supply a manager identity.';

comment on function public.execute_draft_pick(uuid, uuid, integer) is
  'Internal draft engine used by protected autopick and commissioner workflows; not browser-executable.';
