-- A trade proposal belongs to one Gameweek. It expires at that league's trade
-- cutoff and is voided immediately if any included player changes ownership.

alter table public.transactions
  add column if not exists valid_gameweek integer,
  add column if not exists expires_at timestamptz,
  add column if not exists void_reason text;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.transactions'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%status%'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%PENDING%'
  loop
    execute pg_catalog.format(
      'alter table public.transactions drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

alter table public.transactions
  add constraint transactions_status_check
  check (upper(status::text) in (
    'PENDING', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'CANCELLED', 'VOIDED'
  ));

create index if not exists transactions_pending_expiry_idx
  on public.transactions(expires_at)
  where upper(status::text) = 'PENDING';

create or replace function public.set_trade_offer_validity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule text;
  v_window record;
begin
  if upper(coalesce(new.type::text, '')) <> 'TRADE' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if upper(coalesce(old.status::text, '')) = 'PENDING'
       and upper(coalesce(new.status::text, '')) in ('ACCEPTED', 'COUNTERED')
       and old.expires_at is not null
       and pg_catalog.now() >= old.expires_at then
      raise exception 'TRADE_OFFER_EXPIRED';
    end if;
    return new;
  end if;

  select upper(coalesce(ls.trade_cutoff_rule, 'WAIVER_DEADLINE'))
  into v_rule
  from public.league_settings ls
  where ls.league_id = new.league_id;

  select
    lg.gameweek,
    case
      when v_rule = 'GAMEWEEK_DEADLINE' then lg.gw_deadline
      else lg.waiver_deadline
    end as cutoff
  into v_window
  from public.league_gameweeks lg
  where lg.league_id = new.league_id
    and lg.gw_deadline > coalesce(new.created_at, pg_catalog.now())
  order by lg.gw_deadline
  limit 1;

  if v_window.gameweek is null
     or v_window.cutoff is null
     or pg_catalog.now() >= v_window.cutoff then
    raise exception 'TRADE_WINDOW_CLOSED';
  end if;

  new.valid_gameweek := v_window.gameweek;
  new.expires_at := v_window.cutoff;
  new.void_reason := null;
  return new;
end;
$$;

drop trigger if exists assign_trade_offer_validity on public.transactions;
create trigger assign_trade_offer_validity
before insert or update of status on public.transactions
for each row execute function public.set_trade_offer_validity();

-- Assign the original window to historical packages. The first deadline after
-- creation is authoritative, not whichever window happens to be open now.
with validity as (
  select
    transaction.id,
    target_window.gameweek,
    target_window.cutoff
  from public.transactions transaction
  cross join lateral (
    select
      lg.gameweek,
      case
        when upper(coalesce(ls.trade_cutoff_rule, 'WAIVER_DEADLINE')) = 'GAMEWEEK_DEADLINE'
          then lg.gw_deadline
        else lg.waiver_deadline
      end as cutoff
    from public.league_gameweeks lg
    left join public.league_settings ls on ls.league_id = lg.league_id
    where lg.league_id = transaction.league_id
      and lg.gw_deadline > transaction.created_at
    order by lg.gw_deadline
    limit 1
  ) target_window
  where upper(transaction.type::text) = 'TRADE'
    and (transaction.valid_gameweek is null or transaction.expires_at is null)
)
update public.transactions transaction
set valid_gameweek = validity.gameweek,
    expires_at = validity.cutoff
from validity
where validity.id = transaction.id;

create or replace function public.void_invalid_trade_packages(p_league_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package record;
  v_rows integer := 0;
  v_packages integer := 0;
  v_reason text;
begin
  for v_package in
    select distinct
      coalesce(t.parent_transaction_id, t.id) as package_id,
      t.league_id,
      min(t.expires_at) as expires_at
    from public.transactions t
    where upper(t.type::text) = 'TRADE'
      and upper(t.status::text) = 'PENDING'
      and (p_league_id is null or t.league_id = p_league_id)
    group by coalesce(t.parent_transaction_id, t.id), t.league_id
  loop
    v_reason := null;

    if v_package.expires_at is null or pg_catalog.now() >= v_package.expires_at then
      v_reason := 'TRADE_DEADLINE_PASSED';
    elsif exists (
      select 1
      from public.transactions item
      where (item.id = v_package.package_id or item.parent_transaction_id = v_package.package_id)
        and (
          not exists (
            select 1 from public.rosters roster
            where roster.league_id = item.league_id
              and roster.user_id = item.sender_id
              and roster.player_id = item.player_out_id
          )
          or not exists (
            select 1 from public.rosters roster
            where roster.league_id = item.league_id
              and roster.user_id = item.receiver_id
              and roster.player_id = item.player_in_id
          )
        )
    ) then
      v_reason := 'PLAYER_OWNERSHIP_CHANGED';
    end if;

    if v_reason is not null then
      update public.transactions item
      set status = 'VOIDED',
          void_reason = v_reason,
          updated_at = pg_catalog.now()
      where (item.id = v_package.package_id or item.parent_transaction_id = v_package.package_id)
        and upper(item.status::text) = 'PENDING';
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_packages := v_packages + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'packages_voided', v_packages);
end;
$$;

create or replace function public.void_trades_after_roster_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('app.trade_roster_validation_bypass', true), 'off') = 'on' then
    return new;
  end if;

  if old.user_id is distinct from new.user_id
     or old.player_id is distinct from new.player_id then
    perform public.void_invalid_trade_packages(new.league_id);
  end if;
  return new;
end;
$$;

drop trigger if exists void_trades_after_roster_change on public.rosters;
create trigger void_trades_after_roster_change
after update of user_id, player_id on public.rosters
for each row execute function public.void_trades_after_roster_change();

-- VOIDED proposals remain private, just like active negotiations.
create or replace function public.can_view_trade_transaction(
  p_league_id uuid,
  p_status text,
  p_sender_id uuid,
  p_receiver_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.league_members membership
      where membership.league_id = p_league_id
        and membership.user_id = auth.uid()
    )
    and (
      upper(coalesce(p_status, '')) not in ('PENDING', 'VOIDED')
      or auth.uid() = p_sender_id
      or auth.uid() = p_receiver_id
    );
$$;

revoke all on function public.void_invalid_trade_packages(uuid) from public, anon, authenticated;
grant execute on function public.void_invalid_trade_packages(uuid) to service_role;

select public.void_invalid_trade_packages(null);

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'void-expired-trade-offers';

    perform cron.schedule(
      'void-expired-trade-offers',
      '* * * * *',
      'select public.void_invalid_trade_packages(null);'
    );
  end if;
end;
$$;

comment on function public.void_invalid_trade_packages(uuid) is
  'Voids complete pending trade packages after their original Gameweek cutoff or when any stored player changes owner.';
