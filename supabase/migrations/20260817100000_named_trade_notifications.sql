-- Give trade notifications useful context by naming the manager responsible
-- for the action. Prefer the manager's profile name and only fall back to the
-- league team name when a profile name has not been set.

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
  v_actor uuid;
  v_actor_name text;
  v_title text;
  v_body text;
begin
  if v_type <> 'TRADE' then
    return new;
  end if;

  if tg_op = 'INSERT' and v_status = 'PENDING' and new.receiver_id is not null then
    v_target := new.receiver_id;
    v_actor := new.sender_id;
  elsif tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and v_status in ('ACCEPTED', 'REJECTED', 'COUNTERED') then
    v_target := new.sender_id;
    v_actor := new.receiver_id;
  elsif tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and v_status = 'CANCELLED' then
    v_target := new.receiver_id;
    v_actor := new.sender_id;
  else
    return new;
  end if;

  if v_target is null or v_actor is null then
    return new;
  end if;

  select coalesce(
    nullif(pg_catalog.btrim(profile.display_name), ''),
    nullif(
      pg_catalog.btrim(
        pg_catalog.concat_ws(' ', profile.first_name, profile.last_name)
      ),
      ''
    ),
    nullif(pg_catalog.btrim(member.team_name), ''),
    'A manager'
  )
  into v_actor_name
  from public.league_members member
  left join public.profiles profile
    on profile.id = member.user_id
  where member.league_id = new.league_id
    and member.user_id = v_actor
  limit 1;

  v_actor_name := coalesce(v_actor_name, 'A manager');

  case v_status
    when 'PENDING' then
      v_title := 'Trade offer from ' || v_actor_name;
      v_body := v_actor_name || ' has sent you a trade offer.';
    when 'ACCEPTED' then
      v_title := v_actor_name || ' accepted your trade offer';
      v_body := 'Your trade offer to ' || v_actor_name || ' has been accepted.';
    when 'REJECTED' then
      v_title := v_actor_name || ' rejected your trade offer';
      v_body := 'Your trade offer to ' || v_actor_name || ' has been rejected.';
    when 'COUNTERED' then
      v_title := v_actor_name || ' countered your trade offer';
      v_body := v_actor_name || ' has sent you a counter-offer.';
    when 'CANCELLED' then
      v_title := v_actor_name || ' withdrew a trade offer';
      v_body := v_actor_name || ' has withdrawn their trade offer.';
    else
      return new;
  end case;

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

comment on function public.notify_trade_activity() is
  'Queues private, manager-named trade notifications without allowing notification failures to roll back trade writes.';

revoke all on function public.notify_trade_activity() from public, anon, authenticated;
