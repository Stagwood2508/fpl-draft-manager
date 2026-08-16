begin;

do $$
begin
  if has_table_privilege('anon', 'public.push_device_tokens', 'SELECT')
     or has_table_privilege('anon', 'public.push_device_tokens', 'INSERT') then
    raise exception 'anonymous push-device access is not locked down';
  end if;

  if not has_table_privilege('authenticated', 'public.push_device_tokens', 'SELECT')
     or has_table_privilege('authenticated', 'public.push_device_tokens', 'INSERT')
     or has_table_privilege('authenticated', 'public.push_device_tokens', 'UPDATE') then
    raise exception 'push-device table privileges do not match the RPC-only write model';
  end if;

  if has_table_privilege('authenticated', 'public.push_delivery_attempts', 'SELECT')
     or has_table_privilege('authenticated', 'public.push_delivery_attempts', 'INSERT') then
    raise exception 'push-delivery audit is exposed to application users';
  end if;

  if not has_function_privilege('authenticated', 'public.register_push_device(text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.disable_my_push_devices()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_test_push_notification()', 'EXECUTE') then
    raise exception 'manager push-control RPC grants are incomplete';
  end if;

  if has_function_privilege('authenticated', 'public.enqueue_due_draft_notifications()', 'EXECUTE') then
    raise exception 'server-owned draft notification queue is callable by managers';
  end if;
end;
$$;

rollback;

