alter table public.league_settings
  add column if not exists trade_cutoff_rule text not null default 'WAIVER_DEADLINE',
  add column if not exists dropped_player_rule text not null default 'NEXT_WAIVER',
  add column if not exists initial_waiver_order_rule text not null default 'REVERSE_DRAFT';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'league_settings_trade_cutoff_rule_check'
  ) then
    alter table public.league_settings
      add constraint league_settings_trade_cutoff_rule_check
      check (trade_cutoff_rule in ('WAIVER_DEADLINE', 'GAMEWEEK_DEADLINE'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'league_settings_dropped_player_rule_check'
  ) then
    alter table public.league_settings
      add constraint league_settings_dropped_player_rule_check
      check (dropped_player_rule in ('NEXT_WAIVER', 'IMMEDIATE_FREE_AGENT'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'league_settings_initial_waiver_order_rule_check'
  ) then
    alter table public.league_settings
      add constraint league_settings_initial_waiver_order_rule_check
      check (initial_waiver_order_rule in ('REVERSE_DRAFT', 'DRAFT_ORDER'));
  end if;
end;
$$;

create or replace function public.lock_pre_draft_market_rules()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_draft_status text;
begin
  if new.trade_cutoff_rule is not distinct from old.trade_cutoff_rule
     and new.dropped_player_rule is not distinct from old.dropped_player_rule
     and new.initial_waiver_order_rule is not distinct from old.initial_waiver_order_rule then
    return new;
  end if;

  select coalesce(l.draft_status, l.status, 'PRE_DRAFT')
  into v_draft_status
  from public.leagues l
  where l.id = new.league_id;

  if upper(coalesce(v_draft_status, '')) not in ('PRE_DRAFT', 'WAITING_ROOM', 'NOT_STARTED') then
    raise exception 'MARKET_RULES_LOCKED_AFTER_DRAFT';
  end if;

  return new;
end;
$$;

drop trigger if exists lock_pre_draft_market_rules_trigger on public.league_settings;
create trigger lock_pre_draft_market_rules_trigger
before update of trade_cutoff_rule, dropped_player_rule, initial_waiver_order_rule on public.league_settings
for each row execute function public.lock_pre_draft_market_rules();

create table if not exists public.league_waiver_priorities (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  priority_position integer not null check (priority_position > 0),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (league_id, user_id),
  constraint league_waiver_priorities_position_unique
    unique (league_id, priority_position) deferrable initially deferred
);

alter table public.league_waiver_priorities enable row level security;

drop policy if exists "League members can view waiver priority" on public.league_waiver_priorities;
create policy "League members can view waiver priority"
  on public.league_waiver_priorities
  for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = league_waiver_priorities.league_id
        and lm.user_id = auth.uid()
    )
  );

grant select on public.league_waiver_priorities to authenticated;
revoke insert, update, delete on public.league_waiver_priorities from anon, authenticated;

create or replace function public.refresh_league_waiver_priorities(p_league_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inserted integer;
begin
  insert into public.league_waiver_priorities (league_id, user_id, priority_position)
  select
    lm.league_id,
    lm.user_id,
    coalesce(existing.maximum_position, 0)
      + row_number() over (order by lm.draft_order desc nulls last, lm.user_id)::integer
  from public.league_members lm
  cross join lateral (
    select max(lwp.priority_position) as maximum_position
    from public.league_waiver_priorities lwp
    where lwp.league_id = p_league_id
  ) existing
  where lm.league_id = p_league_id
    and not exists (
      select 1 from public.league_waiver_priorities current_order
      where current_order.league_id = lm.league_id
        and current_order.user_id = lm.user_id
    );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

select public.refresh_league_waiver_priorities(l.id)
from public.leagues l;

create table if not exists public.waiver_player_locks (
  league_id uuid not null references public.leagues(id) on delete cascade,
  player_id integer not null references public.players(id) on delete cascade,
  dropped_by_user_id uuid not null references auth.users(id) on delete cascade,
  dropped_in_gameweek integer not null check (dropped_in_gameweek between 1 and 38),
  available_gameweek integer not null check (available_gameweek between 1 and 39),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (league_id, player_id)
);

alter table public.waiver_player_locks enable row level security;

drop policy if exists "League members can view waiver player locks" on public.waiver_player_locks;
create policy "League members can view waiver player locks"
  on public.waiver_player_locks
  for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = waiver_player_locks.league_id
        and lm.user_id = auth.uid()
    )
  );

grant select on public.waiver_player_locks to authenticated;
revoke insert, update, delete on public.waiver_player_locks from anon, authenticated;

create or replace function public.record_successful_waiver_outcome()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_dropped_rule text;
begin
  if lower(coalesce(old.status::text, '')) = lower(coalesce(new.status::text, ''))
     or lower(coalesce(new.status::text, '')) not in ('successful', 'accepted', 'completed') then
    return new;
  end if;

  select coalesce(ls.dropped_player_rule, 'NEXT_WAIVER')
  into v_dropped_rule
  from public.league_settings ls
  where ls.league_id = new.league_id;

  if v_dropped_rule = 'NEXT_WAIVER' and new.player_to_drop is not null then
    insert into public.waiver_player_locks (
      league_id, player_id, dropped_by_user_id,
      dropped_in_gameweek, available_gameweek
    ) values (
      new.league_id, new.player_to_drop, new.user_id,
      coalesce(new.gameweek, 1),
      least(coalesce(new.gameweek, 1) + 1, 39)
    )
    on conflict (league_id, player_id) do update
    set dropped_by_user_id = excluded.dropped_by_user_id,
        dropped_in_gameweek = excluded.dropped_in_gameweek,
        available_gameweek = excluded.available_gameweek,
        created_at = pg_catalog.now();
  end if;

  return new;
end;
$$;

drop trigger if exists record_successful_waiver_outcome_trigger on public.waiver_claims;
create trigger record_successful_waiver_outcome_trigger
after update of status on public.waiver_claims
for each row execute function public.record_successful_waiver_outcome();

create or replace function public.enforce_trade_cutoff()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rule text;
  v_cutoff timestamptz;
begin
  if upper(coalesce(new.type::text, '')) <> 'TRADE' then
    return new;
  end if;

  if tg_op = 'UPDATE' and upper(coalesce(new.status::text, '')) not in ('ACCEPTED', 'COMPLETED') then
    return new;
  end if;

  select coalesce(ls.trade_cutoff_rule, 'WAIVER_DEADLINE')
  into v_rule
  from public.league_settings ls
  where ls.league_id = new.league_id;

  select case
    when v_rule = 'GAMEWEEK_DEADLINE' then lg.gw_deadline
    else lg.waiver_deadline
  end
  into v_cutoff
  from public.league_gameweeks lg
  where lg.league_id = new.league_id
    and not coalesce(lg.is_finished, false)
    and lg.gw_deadline > pg_catalog.now()
  order by lg.gw_deadline
  limit 1;

  if v_cutoff is null or pg_catalog.now() >= v_cutoff then
    raise exception 'TRADE_WINDOW_CLOSED';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_trade_cutoff_trigger on public.transactions;
create trigger enforce_trade_cutoff_trigger
before insert or update of status on public.transactions
for each row execute function public.enforce_trade_cutoff();

create or replace function public.claim_free_agent_with_history(
  p_league_id uuid,
  p_add_player_id integer,
  p_drop_player_id integer,
  p_gameweek integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.league_members lm
    where lm.league_id = p_league_id and lm.user_id = v_user_id
  ) then
    raise exception 'You are not a member of this league.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.waiver_player_locks wpl
    where wpl.league_id = p_league_id
      and wpl.player_id = p_add_player_id
      and p_gameweek < wpl.available_gameweek
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'PLAYER_WAIVER_LOCKED',
      'available_gameweek', (
        select wpl.available_gameweek
        from public.waiver_player_locks wpl
        where wpl.league_id = p_league_id and wpl.player_id = p_add_player_id
      )
    );
  end if;

  v_result := public.claim_free_agent(
    p_league_id := p_league_id,
    p_add_player_id := p_add_player_id,
    p_drop_player_id := p_drop_player_id,
    p_gameweek := p_gameweek
  )::jsonb;

  if coalesce((v_result ->> 'success')::boolean, false) then
    insert into public.free_agent_transactions (
      league_id, user_id, gameweek, player_in_id, player_out_id
    ) values (
      p_league_id, v_user_id, p_gameweek, p_add_player_id, p_drop_player_id
    )
    on conflict (league_id, user_id, gameweek, player_in_id, player_out_id) do nothing;
  end if;

  return v_result;
end;
$$;

create or replace function public.get_my_waiver_status(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_priority integer;
  v_manager_count integer;
  v_gameweek record;
  v_settings record;
  v_draft_order integer;
  v_league_rank integer;
  v_priority_source text;
  v_is_first_window boolean;
begin
  if v_user_id is null or not exists (
    select 1 from public.league_members lm
    where lm.league_id = p_league_id and lm.user_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'error', 'LEAGUE_ACCESS_REQUIRED');
  end if;

  perform public.refresh_league_waiver_priorities(p_league_id);

  select count(*) into v_manager_count
  from public.league_members where league_id = p_league_id;

  select gameweek, waiver_deadline, gw_deadline, status
  into v_gameweek
  from public.league_gameweeks
  where league_id = p_league_id
    and not coalesce(is_finished, false)
    and gw_deadline > pg_catalog.now()
  order by gw_deadline
  limit 1;

  select trade_cutoff_rule, dropped_player_rule, initial_waiver_order_rule
  into v_settings
  from public.league_settings where league_id = p_league_id;

  v_is_first_window := not exists (
    select 1 from public.league_gameweeks previous_window
    where previous_window.league_id = p_league_id
      and previous_window.gameweek < coalesce(v_gameweek.gameweek, 1)
      and coalesce(previous_window.is_waiver_processed, false)
  );

  if v_is_first_window then
    select lm.draft_order into v_draft_order
    from public.league_members lm
    where lm.league_id = p_league_id and lm.user_id = v_user_id;

    if coalesce(v_settings.initial_waiver_order_rule, 'REVERSE_DRAFT') = 'DRAFT_ORDER' then
      v_priority := v_draft_order;
      v_priority_source := 'DRAFT_ORDER';
    else
      v_priority := case
        when v_draft_order is null then null
        else v_manager_count - v_draft_order + 1
      end;
      v_priority_source := 'REVERSE_DRAFT';
    end if;
  else
    select standings.rank into v_league_rank
    from public.get_league_standings(
      p_league_id,
      greatest(v_gameweek.gameweek - 1, 1),
      false
    ) standings
    where standings.user_id = v_user_id;

    v_priority := case
      when v_league_rank is null then null
      else v_manager_count - v_league_rank + 1
    end;
    v_priority_source := 'LEAGUE_POSITION';
  end if;

  return jsonb_build_object(
    'success', true,
    'priority', v_priority,
    'priority_source', v_priority_source,
    'manager_count', v_manager_count,
    'gameweek', v_gameweek.gameweek,
    'waiver_deadline', v_gameweek.waiver_deadline,
    'gameweek_deadline', v_gameweek.gw_deadline,
    'market_status', v_gameweek.status,
    'trade_cutoff_rule', coalesce(v_settings.trade_cutoff_rule, 'WAIVER_DEADLINE'),
    'dropped_player_rule', coalesce(v_settings.dropped_player_rule, 'NEXT_WAIVER')
  );
end;
$$;

revoke all on function public.refresh_league_waiver_priorities(uuid) from public, anon, authenticated;
revoke all on function public.get_my_waiver_status(uuid) from public, anon;
grant execute on function public.get_my_waiver_status(uuid) to authenticated;

-- The legacy processor used the same arguments but returned a different type.
-- PostgreSQL cannot change a function return type with CREATE OR REPLACE, so
-- replace that exact signature transactionally before installing the JSON API.
drop function if exists public.process_league_waivers(uuid, integer);

create or replace function public.process_league_waivers(
  p_league_id uuid,
  p_gameweek integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_gameweek_row record;
  v_settings record;
  v_manager record;
  v_claim record;
  v_add_position text;
  v_drop_position text;
  v_updated integer;
  v_pass_number integer := 0;
  v_pass_success boolean;
  v_manager_success boolean;
  v_success_count integer := 0;
  v_failure_count integer := 0;
  v_is_first_window boolean;
begin
  if v_actor_id is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not exists (
       select 1 from public.leagues l
       where l.id = p_league_id and l.commissioner_id = v_actor_id
     ) then
    return jsonb_build_object('success', false, 'error', 'COMMISSIONER_REQUIRED');
  end if;

  select * into v_gameweek_row
  from public.league_gameweeks lg
  where lg.league_id = p_league_id and lg.gameweek = p_gameweek
  for update;

  if v_gameweek_row is null then
    return jsonb_build_object('success', false, 'error', 'GAMEWEEK_NOT_FOUND');
  end if;

  if coalesce(v_gameweek_row.is_waiver_processed, false) then
    return jsonb_build_object(
      'success', true,
      'already_processed', true,
      'gameweek', p_gameweek,
      'successful_claims', 0,
      'failed_claims', 0
    );
  end if;

  if v_gameweek_row.waiver_deadline is not null
     and pg_catalog.now() < v_gameweek_row.waiver_deadline then
    return jsonb_build_object('success', false, 'error', 'WAIVER_DEADLINE_NOT_REACHED');
  end if;

  select
    coalesce(ls.initial_waiver_order_rule, 'REVERSE_DRAFT') as initial_waiver_order_rule,
    coalesce(ls.roster_type, l.roster_type, 'STRICT') as roster_type
  into v_settings
  from public.leagues l
  left join public.league_settings ls on ls.league_id = l.id
  where l.id = p_league_id;

  v_is_first_window := not exists (
    select 1 from public.league_gameweeks previous_window
    where previous_window.league_id = p_league_id
      and previous_window.gameweek < p_gameweek
      and coalesce(previous_window.is_waiver_processed, false)
  );

  drop table if exists pg_temp.waiver_manager_order;
  create temporary table waiver_manager_order (
    user_id uuid primary key,
    processing_position integer not null
  ) on commit drop;

  if v_is_first_window then
    insert into waiver_manager_order (user_id, processing_position)
    select
      lm.user_id,
      row_number() over (
        order by
          case when v_settings.initial_waiver_order_rule = 'DRAFT_ORDER' then lm.draft_order end asc nulls last,
          case when v_settings.initial_waiver_order_rule = 'REVERSE_DRAFT' then lm.draft_order end desc nulls last,
          lm.user_id
      )::integer
    from public.league_members lm
    where lm.league_id = p_league_id;
  else
    insert into waiver_manager_order (user_id, processing_position)
    select
      standings.user_id,
      row_number() over (order by standings.rank desc, standings.user_id)::integer
    from public.get_league_standings(
      p_league_id,
      greatest(p_gameweek - 1, 1),
      false
    ) standings;

    insert into waiver_manager_order (user_id, processing_position)
    select
      lm.user_id,
      coalesce((select max(wmo.processing_position) from waiver_manager_order wmo), 0)
        + row_number() over (order by lm.draft_order desc nulls last, lm.user_id)::integer
    from public.league_members lm
    where lm.league_id = p_league_id
      and not exists (
        select 1 from waiver_manager_order wmo where wmo.user_id = lm.user_id
      );
  end if;

  loop
    v_pass_number := v_pass_number + 1;
    v_pass_success := false;

    for v_manager in
      select * from waiver_manager_order order by processing_position
    loop
      v_manager_success := false;

      for v_claim in
        select wc.*
        from public.waiver_claims wc
        where wc.league_id = p_league_id
          and wc.user_id = v_manager.user_id
          and lower(coalesce(wc.status::text, 'pending')) = 'pending'
          and coalesce(wc.gameweek, p_gameweek) = p_gameweek
        order by wc.priority_order, wc.id
        for update
      loop
        if exists (
          select 1 from public.rosters r
          where r.league_id = p_league_id and r.player_id = v_claim.player_to_add
        ) then
          update public.waiver_claims
          set status = 'failed',
              failure_reason = 'PLAYER_UNAVAILABLE',
              processed_at = pg_catalog.now(),
              gameweek = p_gameweek
          where id = v_claim.id;
          v_failure_count := v_failure_count + 1;
          continue;
        end if;

        if not exists (
          select 1 from public.rosters r
          where r.league_id = p_league_id
            and r.user_id = v_manager.user_id
            and r.player_id = v_claim.player_to_drop
        ) then
          update public.waiver_claims
          set status = 'failed',
              failure_reason = 'DROPPED_PLAYER_NOT_OWNED',
              processed_at = pg_catalog.now(),
              gameweek = p_gameweek
          where id = v_claim.id;
          v_failure_count := v_failure_count + 1;
          continue;
        end if;

        select upper(coalesce(lpo.custom_position, p.element_type::text))
        into v_add_position
        from public.players p
        left join public.league_player_overrides lpo
          on lpo.league_id = p_league_id and lpo.player_id = p.id
        where p.id = v_claim.player_to_add;

        select upper(coalesce(lpo.custom_position, p.element_type::text))
        into v_drop_position
        from public.players p
        left join public.league_player_overrides lpo
          on lpo.league_id = p_league_id and lpo.player_id = p.id
        where p.id = v_claim.player_to_drop;

        if v_add_position is null
           or v_drop_position is null
           or (v_settings.roster_type = 'STRICT' and v_add_position <> v_drop_position)
           or (v_settings.roster_type <> 'STRICT' and ((v_add_position in ('GKP', 'GK', '1')) <> (v_drop_position in ('GKP', 'GK', '1')))) then
          update public.waiver_claims
          set status = 'failed',
              failure_reason = 'POSITION_MISMATCH',
              processed_at = pg_catalog.now(),
              gameweek = p_gameweek
          where id = v_claim.id;
          v_failure_count := v_failure_count + 1;
          continue;
        end if;

        begin
          update public.rosters
          set player_id = v_claim.player_to_add,
              is_transfer_listed = false,
              trade_note = null
          where league_id = p_league_id
            and user_id = v_manager.user_id
            and player_id = v_claim.player_to_drop;

          get diagnostics v_updated = row_count;
          if v_updated <> 1 then
            raise exception 'ROSTER_SWAP_FAILED';
          end if;

          update public.waiver_claims
          set status = 'successful',
              failure_reason = null,
              processed_at = pg_catalog.now(),
              gameweek = p_gameweek
          where id = v_claim.id;

          v_success_count := v_success_count + 1;
          v_manager_success := true;
          v_pass_success := true;
        exception
          when unique_violation then
            update public.waiver_claims
            set status = 'failed',
                failure_reason = 'PLAYER_UNAVAILABLE',
                processed_at = pg_catalog.now(),
                gameweek = p_gameweek
            where id = v_claim.id;
            v_failure_count := v_failure_count + 1;
        end;

        if v_manager_success then
          exit;
        end if;
      end loop;
    end loop;

    exit when not v_pass_success;
  end loop;

  update public.league_gameweeks
  set is_waiver_processed = true,
      status = case
        when gw_deadline > pg_catalog.now() then 'FREE_AGENCY'
        else 'IN_PLAY'
      end
  where league_id = p_league_id and gameweek = p_gameweek;

  return jsonb_build_object(
    'success', true,
    'already_processed', false,
    'gameweek', p_gameweek,
    'passes_completed', v_pass_number,
    'successful_claims', v_success_count,
    'failed_claims', v_failure_count
  );
end;
$$;

create or replace function public.process_due_league_waivers()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_due record;
  v_result jsonb;
  v_processed integer := 0;
begin
  for v_due in
    select lg.league_id, lg.gameweek
    from public.league_gameweeks lg
    where not coalesce(lg.is_waiver_processed, false)
      and lg.waiver_deadline <= pg_catalog.now()
      and not coalesce(lg.is_finished, false)
    order by lg.waiver_deadline
  loop
    v_result := public.process_league_waivers(v_due.league_id, v_due.gameweek);
    if coalesce((v_result ->> 'success')::boolean, false) then
      v_processed := v_processed + 1;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'windows_processed', v_processed);
end;
$$;

create or replace function public.run_gameweek_lineup_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_schedule jsonb;
  v_waivers jsonb;
  v_snapshots jsonb;
  v_autosubs jsonb;
begin
  v_schedule := public.refresh_league_gameweek_schedule();
  v_waivers := public.process_due_league_waivers();
  v_snapshots := public.capture_due_gameweek_lineups(null);
  v_autosubs := public.process_due_gameweek_autosubs(null);
  return jsonb_build_object(
    'success', true,
    'schedule', v_schedule,
    'waivers', v_waivers,
    'snapshots', v_snapshots,
    'autosubs', v_autosubs
  );
end;
$$;

revoke all on function public.process_league_waivers(uuid, integer) from public, anon;
revoke all on function public.process_due_league_waivers() from public, anon, authenticated;
grant execute on function public.process_league_waivers(uuid, integer) to authenticated, service_role;
grant execute on function public.process_due_league_waivers() to service_role;
