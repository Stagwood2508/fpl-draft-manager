-- COALESCE is SQL syntax, not a pg_catalog function. Qualifying it causes
-- every Android notification action to fail before the token is checked.
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
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('success', false, 'error', 'INVALID_ACTION');
  end if;

  select * into v_action
  from public.trade_push_actions
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
        where (t.id = v_package or t.parent_transaction_id = v_package)
          and t.status <> 'PENDING'
      ) then
        v_result := jsonb_build_object('success', false, 'error', 'TRADE_IS_NO_LONGER_PENDING');
      else
        update public.transactions
        set status = 'REJECTED', updated_at = pg_catalog.now()
        where id = v_package or parent_transaction_id = v_package;

        insert into public.trade_package_audit(league_id, package_id, actor_id, action)
        values(v_league_id, v_package, v_action.user_id, 'REJECTED');

        v_result := jsonb_build_object('success', true, 'status', 'REJECTED', 'package_id', v_package);
      end if;
    end if;
  end if;

  if coalesce((v_result->>'success')::boolean, false) then
    update public.trade_push_actions
    set consumed_at = pg_catalog.now()
    where id = v_action.id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.execute_trade_push_action(text) from public, anon, authenticated;
grant execute on function public.execute_trade_push_action(text) to service_role;
