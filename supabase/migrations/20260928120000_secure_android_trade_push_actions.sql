-- Android notification actions use one-time, short-lived tokens. The native
-- receiver can therefore complete a trade response without exposing a user
-- session or giving the device broad database access.

alter table public.push_device_tokens
  add column if not exists fcm_push_token text;

create unique index if not exists push_device_tokens_fcm_token_idx
  on public.push_device_tokens (fcm_push_token)
  where fcm_push_token is not null;

create or replace function public.register_push_device(
  p_expo_push_token text,
  p_platform text,
  p_device_name text default null,
  p_fcm_push_token text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_token text := pg_catalog.btrim(coalesce(p_expo_push_token, ''));
  v_platform text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_platform, '')));
  v_fcm_token text := nullif(pg_catalog.btrim(coalesce(p_fcm_push_token, '')), '');
  v_token_id uuid;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_platform not in ('ANDROID', 'IOS') then raise exception 'INVALID_PLATFORM'; end if;
  if v_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$' then raise exception 'INVALID_EXPO_PUSH_TOKEN'; end if;
  if v_fcm_token is not null and (v_platform <> 'ANDROID' or pg_catalog.length(v_fcm_token) > 512) then
    raise exception 'INVALID_FCM_PUSH_TOKEN';
  end if;

  insert into public.push_device_tokens (
    user_id, expo_push_token, fcm_push_token, platform, device_name, enabled,
    last_registered_at, last_error, failure_count, updated_at
  ) values (
    v_user_id, v_token, v_fcm_token, v_platform,
    nullif(pg_catalog.btrim(coalesce(p_device_name, '')), ''), true,
    pg_catalog.now(), null, 0, pg_catalog.now()
  )
  on conflict (expo_push_token) do update set
    user_id = excluded.user_id,
    fcm_push_token = excluded.fcm_push_token,
    platform = excluded.platform,
    device_name = excluded.device_name,
    enabled = true,
    last_registered_at = pg_catalog.now(),
    last_error = null,
    failure_count = 0,
    updated_at = pg_catalog.now()
  returning id into v_token_id;

  insert into public.notification_preferences (user_id, push_enabled, updated_at)
  values (v_user_id, true, pg_catalog.now())
  on conflict (user_id) do update set push_enabled = true, updated_at = pg_catalog.now();
  return v_token_id;
end;
$$;

revoke all on function public.register_push_device(text, text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text, text) to authenticated;

create table if not exists public.trade_push_actions (
  id uuid primary key default gen_random_uuid(),
  notification_id bigint not null references public.user_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  package_id uuid not null,
  action text not null check (action in ('ACCEPT', 'REJECT')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists trade_push_actions_lookup_idx
  on public.trade_push_actions (token_hash, expires_at)
  where consumed_at is null;

alter table public.trade_push_actions enable row level security;
revoke all on table public.trade_push_actions from public, anon, authenticated;
grant all on table public.trade_push_actions to service_role;

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

  -- The called RPCs deliberately authorise through auth.uid(). This value is
  -- taken only from the locked server-side action record, never from the
  -- device request, so the existing receiver-only trade protections remain.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_action.user_id::text, true);
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

comment on function public.execute_trade_push_action(text) is
  'Consumes a one-time Android trade notification action after applying the same receiver-only acceptance/rejection rules as the app.';
