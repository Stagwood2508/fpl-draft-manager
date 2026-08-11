-- Keep waiver cancellation atomic, owner-only and unavailable once processing starts.
-- The RPC also closes priority gaps after a cancellation.

drop policy if exists "Allow members to manage their claims" on public.waiver_claims;

create or replace function public.cancel_waiver_claim(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_claim record;
  v_priority integer := 1;
  v_remaining record;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  select
    wc.id,
    wc.league_id,
    wc.user_id,
    wc.gameweek,
    wc.status,
    lg.waiver_deadline,
    lg.is_waiver_processed
  into v_claim
  from public.waiver_claims wc
  left join public.league_gameweeks lg
    on lg.league_id = wc.league_id
   and lg.gameweek = wc.gameweek
  where wc.id = p_claim_id
  for update of wc;

  if v_claim.id is null then
    return jsonb_build_object('success', false, 'error', 'CLAIM_NOT_FOUND');
  end if;

  if v_claim.user_id <> v_actor_id then
    return jsonb_build_object('success', false, 'error', 'CLAIM_OWNER_REQUIRED');
  end if;

  if lower(coalesce(v_claim.status::text, 'pending')) <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'CLAIM_ALREADY_PROCESSED');
  end if;

  if coalesce(v_claim.is_waiver_processed, false)
     or (v_claim.waiver_deadline is not null and pg_catalog.now() >= v_claim.waiver_deadline) then
    return jsonb_build_object('success', false, 'error', 'WAIVER_WINDOW_CLOSED');
  end if;

  delete from public.waiver_claims
  where id = p_claim_id
    and user_id = v_actor_id;

  -- Preserve the manager's displayed claim order after removing an item.
  for v_remaining in
    select wc.id
    from public.waiver_claims wc
    where wc.league_id = v_claim.league_id
      and wc.user_id = v_actor_id
      and lower(coalesce(wc.status::text, 'pending')) = 'pending'
      and wc.gameweek is not distinct from v_claim.gameweek
    order by wc.priority_order, wc.created_at, wc.id
    for update
  loop
    update public.waiver_claims
    set priority_order = v_priority
    where id = v_remaining.id;
    v_priority := v_priority + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'claim_id', p_claim_id,
    'remaining_claims', v_priority - 1
  );
end;
$$;

revoke all on function public.cancel_waiver_claim(uuid) from public, anon;
grant execute on function public.cancel_waiver_claim(uuid) to authenticated;

comment on function public.cancel_waiver_claim(uuid) is
  'Atomically cancels the authenticated manager pending waiver claim before its deadline and compacts their priority order.';
