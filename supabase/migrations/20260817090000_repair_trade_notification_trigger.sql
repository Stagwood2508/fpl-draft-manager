-- Repair database drift where a legacy transaction trigger still writes to the
-- removed public.notifications table. Trade notifications are ancillary: a
-- notification fault must never roll back an otherwise valid trade offer.

do $$
declare
  v_trigger record;
begin
  for v_trigger in
    select trigger_row.tgname
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_proc trigger_function
      on trigger_function.oid = trigger_row.tgfoid
    where trigger_row.tgrelid = 'public.transactions'::regclass
      and not trigger_row.tgisinternal
      and pg_catalog.strpos(
        lower(pg_catalog.pg_get_functiondef(trigger_function.oid)),
        'public.notifications'
      ) > 0
  loop
    execute pg_catalog.format(
      'drop trigger if exists %I on public.transactions',
      v_trigger.tgname
    );
  end loop;
end;
$$;

create or replace function public.notify_trade_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := upper(new.status::text);
  v_type text := upper(new.type::text);
  v_package_key text := coalesce(new.parent_transaction_id::text, new.id::text);
  v_target uuid;
  v_title text;
  v_body text;
begin
  if v_type <> 'TRADE' then
    return new;
  end if;

  if tg_op = 'INSERT' and v_status = 'PENDING' and new.receiver_id is not null then
    v_target := new.receiver_id;
    v_title := 'New trade offer';
    v_body := 'A manager has sent you a trade offer.';
  elsif tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and v_status in ('ACCEPTED', 'REJECTED', 'COUNTERED', 'CANCELLED') then
    v_target := new.sender_id;
    v_title := 'Trade offer ' || lower(v_status);
    v_body := 'One of your trade offers has been ' || lower(v_status) || '.';
  else
    return new;
  end if;

  if v_target is null then
    return new;
  end if;

  begin
    if not coalesce(
      (
        select preferences.trades_enabled
        from public.notification_preferences preferences
        where preferences.user_id = v_target
      ),
      true
    ) then
      return new;
    end if;

    insert into public.user_notifications (
      user_id,
      league_id,
      category,
      title,
      body,
      route,
      dedupe_key
    ) values (
      v_target,
      new.league_id,
      'TRADE',
      v_title,
      v_body,
      '/(tabs)/market/waivers-trades?tab=OFFERS',
      'trade:' || v_package_key || ':' || v_status
    )
    on conflict (user_id, dedupe_key)
      where dedupe_key is not null
      do nothing;
  exception
    when others then
      raise warning 'Trade notification could not be queued for transaction %: %',
        new.id,
        sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists transaction_notification on public.transactions;
create trigger transaction_notification
  after insert or update of status on public.transactions
  for each row execute function public.notify_trade_activity();

comment on function public.notify_trade_activity() is
  'Queues private trade notifications in user_notifications without allowing notification failures to roll back trade writes.';

revoke all on function public.notify_trade_activity() from public, anon, authenticated;
