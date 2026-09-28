-- Notification actions are allowed to outlive the initial delivery window.
-- They remain one-time and trade-state-checked, so extending this interval
-- does not make a withdrawn or completed offer actionable.
update public.trade_push_actions
set expires_at = created_at + interval '24 hours'
where consumed_at is null
  and expires_at < created_at + interval '24 hours';

create or replace function public.execute_trade_push_action(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.trade_push_actions%rowtype;
  v_result jsonb;
begin
  if pg_catalog.coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('success', false, 'error', 'INVALID_ACTION');
  end if;

  select * into v_action
  from public.trade_push_actions
  where token_hash = pg_catalog.lower(p_token_hash)
  for update;

  if not found or v_action.consumed_at is not null or v_action.expires_at <= pg_catalog.now() then
    return jsonb_build_object('success', false, 'error', 'ACTION_EXPIRED');
  end if;

  -- Provide both Supabase JWT claim forms. Depending on the database runtime,
  -- auth.uid() may read either the compact sub setting or the full claims
  -- document. Both values come exclusively from the locked action record.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_action.user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_action.user_id::text, 'role', 'authenticated')::text,
    true
  );

  if v_action.action = 'ACCEPT' then
    v_result := public.accept_trade_transaction(v_action.package_id);
  else
    v_result := public.update_trade_package_status(v_action.package_id, 'REJECT');
  end if;

  if pg_catalog.coalesce((v_result->>'success')::boolean, false) then
    update public.trade_push_actions
    set consumed_at = pg_catalog.now()
    where id = v_action.id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.execute_trade_push_action(text) from public, anon, authenticated;
grant execute on function public.execute_trade_push_action(text) to service_role;
