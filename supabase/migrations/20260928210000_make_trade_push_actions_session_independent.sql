-- Native notification buttons run while the app may be terminated. Execute
-- their already-authorised receiver action directly, rather than relying on a
-- background client session being restored in time.

create or replace function public.accept_trade_push_action(
  p_transaction_id uuid,
  p_receiver_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package uuid;
  v_league_id uuid;
  v_sender_id uuid;
  v_receiver_id uuid;
  v_out_ids integer[];
  v_in_ids integer[];
  v_row record;
  v_sender_start boolean;
  v_sender_bench integer;
  v_receiver_start boolean;
  v_receiver_bench integer;
  v_sender_starters integer[];
  v_receiver_starters integer[];
  v_involved integer[];
begin
  select coalesce(t.parent_transaction_id, t.id), t.league_id, t.sender_id, t.receiver_id
  into v_package, v_league_id, v_sender_id, v_receiver_id
  from public.transactions t
  where t.id = p_transaction_id or t.parent_transaction_id = p_transaction_id
  order by t.created_at
  limit 1;

  if v_package is null then return jsonb_build_object('success', false, 'error', 'TRANSACTION_NOT_FOUND'); end if;
  perform 1 from public.transactions t
  where t.id = v_package or t.parent_transaction_id = v_package
  for update;
  if p_receiver_id <> v_receiver_id then return jsonb_build_object('success', false, 'error', 'ONLY_RECEIVER_CAN_ACCEPT'); end if;
  if exists (
    select 1 from public.transactions t
    where (t.id = v_package or t.parent_transaction_id = v_package) and t.status <> 'PENDING'
  ) then return jsonb_build_object('success', false, 'error', 'TRADE_IS_NO_LONGER_PENDING'); end if;
  if exists (
    select 1 from public.transactions t
    where (t.id = v_package or t.parent_transaction_id = v_package)
      and (t.league_id <> v_league_id or t.sender_id <> v_sender_id or t.receiver_id <> v_receiver_id or t.type <> 'TRADE')
  ) then return jsonb_build_object('success', false, 'error', 'INCONSISTENT_TRADE_PACKAGE'); end if;

  select array_agg(t.player_out_id order by t.created_at, t.id),
         array_agg(t.player_in_id order by t.created_at, t.id)
  into v_out_ids, v_in_ids
  from public.transactions t
  where t.id = v_package or t.parent_transaction_id = v_package;

  perform public.validate_trade_package_selection(v_league_id, v_sender_id, v_receiver_id, v_out_ids, v_in_ids);
  perform 1 from public.rosters r
  where r.league_id = v_league_id and r.player_id = any(v_out_ids || v_in_ids)
  for update;
  perform pg_catalog.set_config('app.trade_roster_validation_bypass', 'on', true);

  for v_row in
    select t.player_out_id, t.player_in_id from public.transactions t
    where t.id = v_package or t.parent_transaction_id = v_package
    order by t.created_at, t.id
  loop
    select r.is_starting, r.bench_order into strict v_sender_start, v_sender_bench
    from public.rosters r where r.league_id = v_league_id and r.user_id = v_sender_id and r.player_id = v_row.player_out_id;
    select r.is_starting, r.bench_order into strict v_receiver_start, v_receiver_bench
    from public.rosters r where r.league_id = v_league_id and r.user_id = v_receiver_id and r.player_id = v_row.player_in_id;
    update public.rosters set user_id = v_receiver_id,
      is_starting = v_receiver_start, is_starter = v_receiver_start,
      bench_order = case when v_receiver_start then null else coalesce(v_receiver_bench, 1) end,
      is_transfer_listed = false, trade_note = null, acquired_at = pg_catalog.now()
    where league_id = v_league_id and user_id = v_sender_id and player_id = v_row.player_out_id;
    update public.rosters set user_id = v_sender_id,
      is_starting = v_sender_start, is_starter = v_sender_start,
      bench_order = case when v_sender_start then null else coalesce(v_sender_bench, 1) end,
      is_transfer_listed = false, trade_note = null, acquired_at = pg_catalog.now()
    where league_id = v_league_id and user_id = v_receiver_id and player_id = v_row.player_in_id;
  end loop;

  select array_agg(player_id order by player_id) filter(where is_starting)
  into v_sender_starters from public.rosters where league_id = v_league_id and user_id = v_sender_id;
  select array_agg(player_id order by player_id) filter(where is_starting)
  into v_receiver_starters from public.rosters where league_id = v_league_id and user_id = v_receiver_id;
  if not public.is_legal_starting_lineup(v_sender_starters)
     or not public.is_legal_starting_lineup(v_receiver_starters) then
    raise exception 'TRADE_WOULD_CREATE_INVALID_LINEUP';
  end if;

  v_involved := v_out_ids || v_in_ids;
  delete from public.waiver_claims
  where league_id = v_league_id and lower(status) = 'pending'
    and (player_to_drop = any(v_involved) or player_to_add = any(v_involved));
  update public.transactions set status = 'ACCEPTED', updated_at = pg_catalog.now()
  where id = v_package or parent_transaction_id = v_package;
  insert into public.trade_package_audit(league_id, package_id, actor_id, action, details)
  values(v_league_id, v_package, p_receiver_id, 'ACCEPTED', jsonb_build_object('player_count', cardinality(v_out_ids)));
  return jsonb_build_object('success', true, 'package_id', v_package);
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$$;

create or replace function public.execute_trade_push_action(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.trade_push_actions%rowtype;
  v_package uuid;
  v_league_id uuid;
  v_sender_id uuid;
  v_receiver_id uuid;
  v_result jsonb;
begin
  if pg_catalog.coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('success', false, 'error', 'INVALID_ACTION');
  end if;
  select * into v_action from public.trade_push_actions
  where token_hash = pg_catalog.lower(p_token_hash)
  for update;
  if not found or v_action.consumed_at is not null or v_action.expires_at <= pg_catalog.now() then
    return jsonb_build_object('success', false, 'error', 'ACTION_EXPIRED');
  end if;

  if v_action.action = 'ACCEPT' then
    v_result := public.accept_trade_push_action(v_action.package_id, v_action.user_id);
  else
    select coalesce(t.parent_transaction_id, t.id), t.league_id, t.sender_id, t.receiver_id
    into v_package, v_league_id, v_sender_id, v_receiver_id
    from public.transactions t
    where t.id = v_action.package_id or t.parent_transaction_id = v_action.package_id
    order by t.created_at
    limit 1;
    if v_package is null or v_receiver_id <> v_action.user_id then
      v_result := jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED_FOR_TRADE_ACTION');
    else
      perform 1 from public.transactions t
      where t.id = v_package or t.parent_transaction_id = v_package
      for update;
      if exists (
        select 1 from public.transactions t
        where (t.id = v_package or t.parent_transaction_id = v_package) and t.status <> 'PENDING'
      ) then
        v_result := jsonb_build_object('success', false, 'error', 'TRADE_IS_NO_LONGER_PENDING');
      else
        update public.transactions set status = 'REJECTED', updated_at = pg_catalog.now()
        where id = v_package or parent_transaction_id = v_package;
        insert into public.trade_package_audit(league_id, package_id, actor_id, action)
        values(v_league_id, v_package, v_action.user_id, 'REJECTED');
        v_result := jsonb_build_object('success', true, 'status', 'REJECTED', 'package_id', v_package);
      end if;
    end if;
  end if;

  if pg_catalog.coalesce((v_result->>'success')::boolean, false) then
    update public.trade_push_actions set consumed_at = pg_catalog.now() where id = v_action.id;
  end if;
  return v_result;
end;
$$;

revoke all on function public.accept_trade_push_action(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_trade_push_action(uuid, uuid) to service_role;
revoke all on function public.execute_trade_push_action(text) from public, anon, authenticated;
grant execute on function public.execute_trade_push_action(text) to service_role;
