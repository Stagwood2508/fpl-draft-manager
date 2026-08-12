-- Keep already-installed clients working during rollout without trusting the
-- p_user_id they send. The original engine becomes service-only; the legacy
-- signature is recreated as an authenticated identity gate.

alter function public.execute_draft_pick(uuid, uuid, integer)
  rename to execute_draft_pick_internal;

create function public.execute_draft_pick(
  p_league_id uuid,
  p_user_id uuid,
  p_player_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is not null
     and v_actor_id is distinct from p_user_id
     and not exists (
       select 1
       from public.leagues league
       where league.id = p_league_id
         and league.commissioner_id = v_actor_id
     ) then
    return jsonb_build_object(
      'success', false,
      'error', 'CALLER_IDENTITY_MISMATCH'
    );
  end if;

  return public.execute_draft_pick_internal(
    p_league_id,
    p_user_id,
    p_player_id
  );
end;
$$;

-- Point the new identity-derived endpoint straight at the protected engine.
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

  return public.execute_draft_pick_internal(
    p_league_id,
    v_user_id,
    p_player_id
  );
end;
$$;

revoke all on function public.execute_draft_pick_internal(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.execute_draft_pick_internal(uuid, uuid, integer)
  to service_role;

revoke all on function public.execute_draft_pick(uuid, uuid, integer)
  from public, anon;
grant execute on function public.execute_draft_pick(uuid, uuid, integer)
  to authenticated, service_role;

revoke all on function public.submit_draft_pick(uuid, integer)
  from public, anon;
grant execute on function public.submit_draft_pick(uuid, integer)
  to authenticated, service_role;

comment on function public.execute_draft_pick(uuid, uuid, integer) is
  'Temporary backwards-compatible draft submission gate; rejects a non-commissioner caller whose auth.uid() differs from p_user_id.';

comment on function public.execute_draft_pick_internal(uuid, uuid, integer) is
  'Protected authoritative draft engine for identity-derived, autopick and commissioner workflows.';
