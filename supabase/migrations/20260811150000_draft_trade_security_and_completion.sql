-- Release hardening for draft completion, flexible rosters, trade packages,
-- and privileged RPC access. This migration also source-controls legacy live
-- objects that previously existed only in the hosted database.

-- Preserve any draft currently stalled while its final-roster trigger is
-- failing. Commissioners can resume it after this migration is installed.
update public.draft_sessions ds
set draft_status = 'PAUSED',
    pause_started_at = pg_catalog.now(),
    paused_seconds_remaining = greatest(
      0,
      coalesce(extract(epoch from (ds.pick_deadline - pg_catalog.now()))::integer, 0)
    ),
    pick_deadline = null,
    updated_at = pg_catalog.now()
where ds.draft_status in ('LIVE', 'DRAFTING')
  and ds.current_round = 15
  and (
    select count(*)
    from public.rosters r
    where r.league_id = ds.league_id
      and r.user_id = ds.current_picker_id
  ) = 14;

update public.leagues l
set draft_status = 'PAUSED'
where l.id in (
  select ds.league_id
  from public.draft_sessions ds
  where ds.draft_status = 'PAUSED'
    and ds.current_round = 15
    and ds.pause_started_at is not null
    and (
      select count(*)
      from public.rosters r
      where r.league_id = ds.league_id
        and r.user_id = ds.current_picker_id
    ) = 14
);

-- execute_draft_pick is the sole authority for advancing and completing a
-- draft. Remove two older triggers that independently changed the same state.
drop trigger if exists trg_league_draft_status on public.draft_picks;
drop trigger if exists draft_session_rotation_insforcer on public.draft_sessions;

alter table public.players add column if not exists is_active boolean not null default true;
create index if not exists players_active_rank_idx on public.players(is_active, draft_rank, total_points desc);

create or replace function public.validate_roster_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_roster_type text;
  v_position text;
  v_position_count integer;
  v_bypass boolean := coalesce(
    pg_catalog.current_setting('app.trade_roster_validation_bypass', true),
    'off'
  ) = 'on';
begin
  select upper(coalesce(ls.roster_type, l.roster_type, 'STRICT'))
  into v_roster_type
  from public.leagues l
  left join public.league_settings ls on ls.league_id = l.id
  where l.id = new.league_id;

  select case upper(p.element_type::text)
    when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
    when '2' then 'DEF' when 'DEF' then 'DEF'
    when '3' then 'MID' when 'MID' then 'MID'
    when '4' then 'FWD' when 'FWD' then 'FWD'
    else null end
  into v_position
  from public.players p
  where p.id = new.player_id;

  if v_position is null then
    raise exception 'INVALID_PLAYER_POSITION';
  end if;

  if not v_bypass then
    select count(*)
    into v_position_count
    from public.rosters r
    join public.players p on p.id = r.player_id
    where r.league_id = new.league_id
      and r.user_id = new.user_id
      and case upper(p.element_type::text)
        when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
        when '2' then 'DEF' when 'DEF' then 'DEF'
        when '3' then 'MID' when 'MID' then 'MID'
        when '4' then 'FWD' when 'FWD' then 'FWD'
      end = v_position
      and r.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if v_roster_type = 'STRICT' then
      if (v_position = 'GKP' and v_position_count >= 2)
         or (v_position = 'DEF' and v_position_count >= 5)
         or (v_position = 'MID' and v_position_count >= 5)
         or (v_position = 'FWD' and v_position_count >= 3) then
        raise exception 'STRICT_ROSTER_CAP:%', v_position;
      end if;
    else
      if (v_position = 'GKP' and v_position_count >= 2)
         or (v_position = 'DEF' and v_position_count >= 6)
         or (v_position = 'MID' and v_position_count >= 6)
         or (v_position = 'FWD' and v_position_count >= 4) then
        raise exception 'FLEXIBLE_ROSTER_CAP:%', v_position;
      end if;
    end if;
  end if;

  new.is_gk := v_position = 'GKP';

  if new.is_starting then
    new.bench_order := null;
  elsif v_position = 'GKP' then
    new.bench_order := 0;
  elsif new.bench_order not between 1 and 3 then
    raise exception 'INVALID_BENCH_ORDER: Outfield substitute must have bench_order between 1 and 3.';
  end if;

  return new;
end;
$$;

create or replace function public.set_placeholder_roster_slot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_position text;
begin
  select upper(p.element_type::text) into v_position
  from public.players p where p.id = new.player_id;
  new.is_starting := false;
  new.is_starter := false;
  new.is_gk := v_position in ('GKP', 'GK', '1');
  new.bench_order := case when new.is_gk then 0 else 1 end;
  return new;
end;
$$;

create or replace function public.auto_assign_starting_lineup(
  p_league_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_start_ids uuid[] := array[]::uuid[];
  v_candidate record;
  v_defenders integer := 0;
  v_midfielders integer := 0;
  v_forwards integer := 0;
  v_slots_remaining integer;
begin
  if (select count(*) from public.rosters r
      where r.league_id = p_league_id and r.user_id = p_user_id) <> 15 then
    raise exception 'ROSTER_REQUIRES_15_PLAYERS';
  end if;

  select coalesce(array_agg(seed.id), array[]::uuid[])
  into v_start_ids
  from (
    select ranked.id
    from (
      select r.id,
             case upper(p.element_type::text)
               when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
               when '2' then 'DEF' when 'DEF' then 'DEF'
               when '3' then 'MID' when 'MID' then 'MID'
               when '4' then 'FWD' when 'FWD' then 'FWD' end as position,
             row_number() over (
               partition by case upper(p.element_type::text)
                 when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
                 when '2' then 'DEF' when 'DEF' then 'DEF'
                 when '3' then 'MID' when 'MID' then 'MID'
                 when '4' then 'FWD' when 'FWD' then 'FWD' end
               order by coalesce(p.total_points, 0) desc,
                        coalesce(p.draft_rank, 999999), p.id
             ) as position_rank
      from public.rosters r
      join public.players p on p.id = r.player_id
      where r.league_id = p_league_id and r.user_id = p_user_id
    ) ranked
    where (ranked.position = 'GKP' and ranked.position_rank <= 1)
       or (ranked.position = 'DEF' and ranked.position_rank <= 3)
       or (ranked.position = 'MID' and ranked.position_rank <= 2)
       or (ranked.position = 'FWD' and ranked.position_rank <= 1)
  ) seed;

  select
    count(*) filter (where normalized.position = 'DEF'),
    count(*) filter (where normalized.position = 'MID'),
    count(*) filter (where normalized.position = 'FWD')
  into v_defenders, v_midfielders, v_forwards
  from (
    select case upper(p.element_type::text)
      when '2' then 'DEF' when 'DEF' then 'DEF'
      when '3' then 'MID' when 'MID' then 'MID'
      when '4' then 'FWD' when 'FWD' then 'FWD' end as position
    from public.rosters r
    join public.players p on p.id = r.player_id
    where r.id = any(v_start_ids)
  ) normalized;

  v_slots_remaining := 11 - cardinality(v_start_ids);

  for v_candidate in
    select r.id,
      case upper(p.element_type::text)
        when '2' then 'DEF' when 'DEF' then 'DEF'
        when '3' then 'MID' when 'MID' then 'MID'
        when '4' then 'FWD' when 'FWD' then 'FWD' end as position
    from public.rosters r
    join public.players p on p.id = r.player_id
    where r.league_id = p_league_id
      and r.user_id = p_user_id
      and r.id <> all(v_start_ids)
      and upper(p.element_type::text) in ('DEF', 'MID', 'FWD', '2', '3', '4')
    order by coalesce(p.total_points, 0) desc,
             coalesce(p.draft_rank, 999999), p.id
  loop
    exit when v_slots_remaining = 0;
    if v_candidate.position = 'DEF' and v_defenders < 5 then
      v_start_ids := array_append(v_start_ids, v_candidate.id);
      v_defenders := v_defenders + 1;
      v_slots_remaining := v_slots_remaining - 1;
    elsif v_candidate.position = 'MID' and v_midfielders < 5 then
      v_start_ids := array_append(v_start_ids, v_candidate.id);
      v_midfielders := v_midfielders + 1;
      v_slots_remaining := v_slots_remaining - 1;
    elsif v_candidate.position = 'FWD' and v_forwards < 3 then
      v_start_ids := array_append(v_start_ids, v_candidate.id);
      v_forwards := v_forwards + 1;
      v_slots_remaining := v_slots_remaining - 1;
    end if;
  end loop;

  if cardinality(v_start_ids) <> 11 then
    raise exception 'NO_VALID_STARTING_FORMATION';
  end if;

  with assignments as (
    select r.id,
           r.id = any(v_start_ids) as will_start,
           upper(p.element_type::text) in ('GKP', 'GK', '1') as is_goalkeeper,
           p.total_points,
           p.draft_rank,
           p.id as player_id
    from public.rosters r
    join public.players p on p.id = r.player_id
    where r.league_id = p_league_id and r.user_id = p_user_id
  ), ranked as (
    select assignments.*,
      case when not will_start and not is_goalkeeper then
        row_number() over (
          partition by (not will_start and not is_goalkeeper)
          order by coalesce(total_points, 0) desc,
                   coalesce(draft_rank, 999999), player_id
        )::integer
      end as outfield_bench_order
    from assignments
  )
  update public.rosters r
  set is_starting = ranked.will_start,
      is_starter = ranked.will_start,
      is_gk = ranked.is_goalkeeper,
      bench_order = case
        when ranked.will_start then null
        when ranked.is_goalkeeper then 0
        else ranked.outfield_bench_order
      end
  from ranked
  where r.id = ranked.id;
end;
$$;

create or replace function public.trg_check_squad_complete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.rosters r
      where r.league_id = new.league_id and r.user_id = new.user_id) = 15 then
    perform public.auto_assign_starting_lineup(new.league_id, new.user_id);
  end if;
  return new;
end;
$$;

create or replace function public.enforce_draft_position_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_roster_type text;
  v_position text;
  v_gkp integer;
  v_def integer;
  v_mid integer;
  v_fwd integer;
  v_total integer;
  v_remaining integer;
  v_required integer;
  v_existing_pick_id bigint;
begin
  v_existing_pick_id := case when tg_op = 'UPDATE' then old.id else null end;
  if v_actor_id is not null
     and v_actor_id <> new.user_id
     and not exists (
       select 1 from public.leagues l
       where l.id = new.league_id and l.commissioner_id = v_actor_id
     ) then
    raise exception 'UNAUTHORIZED_PICK_ACTOR';
  end if;

  select upper(coalesce(ls.roster_type, l.roster_type, 'STRICT'))
  into v_roster_type
  from public.leagues l
  left join public.league_settings ls on ls.league_id = l.id
  where l.id = new.league_id;

  select case upper(p.element_type::text)
    when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
    when '2' then 'DEF' when 'DEF' then 'DEF'
    when '3' then 'MID' when 'MID' then 'MID'
    when '4' then 'FWD' when 'FWD' then 'FWD' end
  into v_position
  from public.players p where p.id = new.player_id;

  if v_position is null then raise exception 'INVALID_PLAYER_POSITION'; end if;

  select
    count(*) filter (where normalized.position = 'GKP'),
    count(*) filter (where normalized.position = 'DEF'),
    count(*) filter (where normalized.position = 'MID'),
    count(*) filter (where normalized.position = 'FWD'),
    count(*)
  into v_gkp, v_def, v_mid, v_fwd, v_total
  from (
    select dp.id,
      case upper(p.element_type::text)
        when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
        when '2' then 'DEF' when 'DEF' then 'DEF'
        when '3' then 'MID' when 'MID' then 'MID'
        when '4' then 'FWD' when 'FWD' then 'FWD' end as position
    from public.draft_picks dp
    join public.players p on p.id = dp.player_id
    where dp.league_id = new.league_id
      and dp.user_id = new.user_id
      and (v_existing_pick_id is null or dp.id <> v_existing_pick_id)
  ) normalized;

  v_gkp := v_gkp + case when v_position = 'GKP' then 1 else 0 end;
  v_def := v_def + case when v_position = 'DEF' then 1 else 0 end;
  v_mid := v_mid + case when v_position = 'MID' then 1 else 0 end;
  v_fwd := v_fwd + case when v_position = 'FWD' then 1 else 0 end;
  v_total := v_total + 1;

  if v_total > 15 then raise exception 'ROSTER_FULL'; end if;

  if v_roster_type = 'STRICT' then
    if v_gkp > 2 or v_def > 5 or v_mid > 5 or v_fwd > 3 then
      raise exception 'POSITION_FULL:%', v_position;
    end if;
  else
    if v_gkp > 2 or v_def > 6 or v_mid > 6 or v_fwd > 4 then
      raise exception 'POSITION_FULL:%', v_position;
    end if;
    v_remaining := 15 - v_total;
    v_required := greatest(0, 2 - v_gkp)
                + greatest(0, 4 - v_def)
                + greatest(0, 4 - v_mid)
                + greatest(0, 2 - v_fwd);
    if v_required > v_remaining then
      raise exception 'POSITION_REQUIRED_FOR_VALID_FLEXIBLE_ROSTER';
    end if;
  end if;

  return new;
end;
$$;

-- Package-level audit for proposals and every status transition.
create table if not exists public.trade_package_audit (
  id bigint generated by default as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  package_id uuid not null,
  actor_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists trade_package_audit_league_created_idx
  on public.trade_package_audit(league_id, created_at desc);

alter table public.trade_package_audit enable row level security;
drop policy if exists "League members can view trade package audit" on public.trade_package_audit;
create policy "League members can view trade package audit"
  on public.trade_package_audit for select to authenticated
  using (exists (
    select 1 from public.league_members lm
    where lm.league_id = trade_package_audit.league_id and lm.user_id = auth.uid()
  ));

create or replace function public.validate_trade_package_selection(
  p_league_id uuid,
  p_sender_id uuid,
  p_receiver_id uuid,
  p_player_out_ids integer[],
  p_player_in_ids integer[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roster_type text;
  v_sender_counts jsonb;
  v_receiver_counts jsonb;
  v_out_counts jsonb;
  v_in_counts jsonb;
  v_position text;
  v_sender_final integer;
  v_receiver_final integer;
begin
  if p_sender_id is null or p_receiver_id is null or p_sender_id = p_receiver_id then
    raise exception 'INVALID_TRADE_PARTICIPANTS';
  end if;
  if cardinality(coalesce(p_player_out_ids, array[]::integer[])) = 0
     or cardinality(p_player_out_ids) <> cardinality(p_player_in_ids)
     or cardinality(p_player_out_ids) <> (select count(distinct id) from unnest(p_player_out_ids) ids(id))
     or cardinality(p_player_in_ids) <> (select count(distinct id) from unnest(p_player_in_ids) ids(id)) then
    raise exception 'INVALID_TRADE_PACKAGE';
  end if;
  if not exists (select 1 from public.league_members where league_id=p_league_id and user_id=p_sender_id)
     or not exists (select 1 from public.league_members where league_id=p_league_id and user_id=p_receiver_id) then
    raise exception 'TRADE_PARTICIPANT_NOT_IN_LEAGUE';
  end if;
  if (select count(*) from public.rosters where league_id=p_league_id and user_id=p_sender_id and player_id=any(p_player_out_ids)) <> cardinality(p_player_out_ids)
     or (select count(*) from public.rosters where league_id=p_league_id and user_id=p_receiver_id and player_id=any(p_player_in_ids)) <> cardinality(p_player_in_ids) then
    raise exception 'TRADE_PLAYER_OWNERSHIP_CHANGED';
  end if;

  select upper(coalesce(ls.roster_type, l.roster_type, 'STRICT')) into v_roster_type
  from public.leagues l left join public.league_settings ls on ls.league_id=l.id
  where l.id=p_league_id;

  with positions as (
    select case upper(p.element_type::text)
      when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
      when '2' then 'DEF' when 'DEF' then 'DEF'
      when '3' then 'MID' when 'MID' then 'MID'
      when '4' then 'FWD' when 'FWD' then 'FWD' end position
    from public.players p where p.id=any(p_player_out_ids)
  ) select jsonb_object_agg(position, amount) into v_out_counts
    from (select position,count(*) amount from positions group by position) grouped;
  with positions as (
    select case upper(p.element_type::text)
      when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
      when '2' then 'DEF' when 'DEF' then 'DEF'
      when '3' then 'MID' when 'MID' then 'MID'
      when '4' then 'FWD' when 'FWD' then 'FWD' end position
    from public.players p where p.id=any(p_player_in_ids)
  ) select jsonb_object_agg(position, amount) into v_in_counts
    from (select position,count(*) amount from positions group by position) grouped;

  v_out_counts := coalesce(v_out_counts, '{}'::jsonb);
  v_in_counts := coalesce(v_in_counts, '{}'::jsonb);
  if v_roster_type = 'STRICT' and v_out_counts <> v_in_counts then
    raise exception 'STRICT_TRADE_REQUIRES_MATCHING_POSITIONS';
  end if;
  if v_roster_type <> 'STRICT'
     and coalesce((v_out_counts->>'GKP')::integer,0) <> coalesce((v_in_counts->>'GKP')::integer,0) then
    raise exception 'GOALKEEPERS_CAN_ONLY_BE_SWAPPED_FOR_GOALKEEPERS';
  end if;

  with counts as (
    select r.user_id,
      case upper(p.element_type::text)
        when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
        when '2' then 'DEF' when 'DEF' then 'DEF'
        when '3' then 'MID' when 'MID' then 'MID'
        when '4' then 'FWD' when 'FWD' then 'FWD' end position,
      count(*) amount
    from public.rosters r join public.players p on p.id=r.player_id
    where r.league_id=p_league_id and r.user_id in (p_sender_id,p_receiver_id)
    group by r.user_id, position
  )
  select jsonb_object_agg(position,amount) filter (where user_id=p_sender_id),
         jsonb_object_agg(position,amount) filter (where user_id=p_receiver_id)
  into v_sender_counts,v_receiver_counts from counts;

  foreach v_position in array array['GKP','DEF','MID','FWD'] loop
    v_sender_final := coalesce((v_sender_counts->>v_position)::integer,0)
      - coalesce((v_out_counts->>v_position)::integer,0)
      + coalesce((v_in_counts->>v_position)::integer,0);
    v_receiver_final := coalesce((v_receiver_counts->>v_position)::integer,0)
      - coalesce((v_in_counts->>v_position)::integer,0)
      + coalesce((v_out_counts->>v_position)::integer,0);
    if v_roster_type = 'STRICT' then
      if (v_position='GKP' and (v_sender_final<>2 or v_receiver_final<>2))
         or (v_position='DEF' and (v_sender_final<>5 or v_receiver_final<>5))
         or (v_position='MID' and (v_sender_final<>5 or v_receiver_final<>5))
         or (v_position='FWD' and (v_sender_final<>3 or v_receiver_final<>3)) then
        raise exception 'TRADE_WOULD_CREATE_INVALID_STRICT_ROSTER';
      end if;
    else
      if (v_position='GKP' and (v_sender_final<>2 or v_receiver_final<>2))
         or (v_position='DEF' and (v_sender_final not between 4 and 6 or v_receiver_final not between 4 and 6))
         or (v_position='MID' and (v_sender_final not between 4 and 6 or v_receiver_final not between 4 and 6))
         or (v_position='FWD' and (v_sender_final not between 2 and 4 or v_receiver_final not between 2 and 4)) then
        raise exception 'TRADE_WOULD_CREATE_INVALID_FLEXIBLE_ROSTER';
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.create_trade_package(
  p_league_id uuid,
  p_receiver_id uuid,
  p_player_out_ids integer[],
  p_player_in_ids integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid := auth.uid();
  v_package_id uuid := gen_random_uuid();
  v_index integer;
begin
  if v_sender_id is null then return jsonb_build_object('success',false,'error','AUTH_REQUIRED'); end if;
  begin
    perform public.validate_trade_package_selection(p_league_id,v_sender_id,p_receiver_id,p_player_out_ids,p_player_in_ids);
    for v_index in 1..cardinality(p_player_out_ids) loop
      insert into public.transactions(
        league_id,sender_id,receiver_id,type,status,player_out_id,player_in_id,parent_transaction_id
      ) values (
        p_league_id,v_sender_id,p_receiver_id,'TRADE','PENDING',
        p_player_out_ids[v_index],p_player_in_ids[v_index],v_package_id
      );
    end loop;
    insert into public.trade_package_audit(league_id,package_id,actor_id,action,details)
    values(p_league_id,v_package_id,v_sender_id,'PROPOSED',jsonb_build_object('player_count',cardinality(p_player_out_ids)));
    return jsonb_build_object('success',true,'package_id',v_package_id);
  exception when others then
    return jsonb_build_object('success',false,'error',sqlerrm);
  end;
end;
$$;

create or replace function public.update_trade_package_status(
  p_transaction_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_package uuid;
  v_league_id uuid;
  v_sender_id uuid;
  v_receiver_id uuid;
  v_status text;
begin
  if v_actor is null then return jsonb_build_object('success',false,'error','AUTH_REQUIRED'); end if;
  select coalesce(t.parent_transaction_id,t.id),t.league_id,t.sender_id,t.receiver_id
  into v_package,v_league_id,v_sender_id,v_receiver_id
  from public.transactions t where t.id=p_transaction_id or t.parent_transaction_id=p_transaction_id
  order by t.created_at limit 1;
  if v_package is null then return jsonb_build_object('success',false,'error','TRANSACTION_NOT_FOUND'); end if;
  perform 1 from public.transactions t where t.id=v_package or t.parent_transaction_id=v_package for update;
  if exists(select 1 from public.transactions t where (t.id=v_package or t.parent_transaction_id=v_package) and t.status<>'PENDING') then
    return jsonb_build_object('success',false,'error','TRADE_IS_NO_LONGER_PENDING');
  end if;
  if upper(p_action)='REJECT' and v_actor=v_receiver_id then v_status:='REJECTED';
  elsif upper(p_action)='WITHDRAW' and v_actor=v_sender_id then v_status:='CANCELLED';
  else return jsonb_build_object('success',false,'error','NOT_AUTHORIZED_FOR_TRADE_ACTION'); end if;
  update public.transactions set status=v_status,updated_at=pg_catalog.now()
  where id=v_package or parent_transaction_id=v_package;
  insert into public.trade_package_audit(league_id,package_id,actor_id,action)
  values(v_league_id,v_package,v_actor,v_status);
  return jsonb_build_object('success',true,'status',v_status,'package_id',v_package);
end;
$$;

create or replace function public.counter_trade_package(
  p_transaction_id uuid,
  p_player_out_ids integer[],
  p_player_in_ids integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old_package uuid;
  v_league_id uuid;
  v_sender_id uuid;
  v_receiver_id uuid;
  v_new_package uuid := gen_random_uuid();
  v_index integer;
begin
  if v_actor is null then return jsonb_build_object('success',false,'error','AUTH_REQUIRED'); end if;
  begin
    select coalesce(t.parent_transaction_id,t.id),t.league_id,t.sender_id,t.receiver_id
    into v_old_package,v_league_id,v_sender_id,v_receiver_id
    from public.transactions t where t.id=p_transaction_id or t.parent_transaction_id=p_transaction_id
    order by t.created_at limit 1;
    if v_old_package is null then raise exception 'TRANSACTION_NOT_FOUND'; end if;
    perform 1 from public.transactions t where t.id=v_old_package or t.parent_transaction_id=v_old_package for update;
    if v_actor<>v_receiver_id then raise exception 'ONLY_RECEIVER_CAN_COUNTER'; end if;
    if exists(select 1 from public.transactions t where (t.id=v_old_package or t.parent_transaction_id=v_old_package) and t.status<>'PENDING') then
      raise exception 'TRADE_IS_NO_LONGER_PENDING';
    end if;
    perform public.validate_trade_package_selection(
      v_league_id,v_actor,v_sender_id,p_player_out_ids,p_player_in_ids
    );
    update public.transactions set status='COUNTERED',updated_at=pg_catalog.now()
    where id=v_old_package or parent_transaction_id=v_old_package;
    for v_index in 1..cardinality(p_player_out_ids) loop
      insert into public.transactions(
        league_id,sender_id,receiver_id,type,status,player_out_id,player_in_id,parent_transaction_id
      ) values (
        v_league_id,v_actor,v_sender_id,'TRADE','PENDING',
        p_player_out_ids[v_index],p_player_in_ids[v_index],v_new_package
      );
    end loop;
    insert into public.trade_package_audit(league_id,package_id,actor_id,action,details)
    values(v_league_id,v_new_package,v_actor,'COUNTERED',jsonb_build_object('original_package_id',v_old_package));
    return jsonb_build_object('success',true,'package_id',v_new_package);
  exception when others then
    return jsonb_build_object('success',false,'error',sqlerrm);
  end;
end;
$$;

drop function if exists public.accept_trade_transaction(uuid);

create function public.accept_trade_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
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
  v_involved integer[];
  v_sender_starters integer[];
  v_receiver_starters integer[];
begin
  if v_actor is null then return jsonb_build_object('success',false,'error','AUTH_REQUIRED'); end if;
  begin
    select coalesce(t.parent_transaction_id,t.id),t.league_id,t.sender_id,t.receiver_id
    into v_package,v_league_id,v_sender_id,v_receiver_id
    from public.transactions t where t.id=p_transaction_id or t.parent_transaction_id=p_transaction_id
    order by t.created_at limit 1;
    if v_package is null then raise exception 'TRANSACTION_NOT_FOUND'; end if;
    perform 1 from public.transactions t where t.id=v_package or t.parent_transaction_id=v_package for update;
    if v_actor<>v_receiver_id then raise exception 'ONLY_RECEIVER_CAN_ACCEPT'; end if;
    if exists(select 1 from public.transactions t where (t.id=v_package or t.parent_transaction_id=v_package) and t.status<>'PENDING') then
      raise exception 'TRADE_IS_NO_LONGER_PENDING';
    end if;
    if exists(select 1 from public.transactions t where (t.id=v_package or t.parent_transaction_id=v_package)
              and (t.league_id<>v_league_id or t.sender_id<>v_sender_id or t.receiver_id<>v_receiver_id or t.type<>'TRADE')) then
      raise exception 'INCONSISTENT_TRADE_PACKAGE';
    end if;
    select array_agg(t.player_out_id order by t.created_at,t.id),
           array_agg(t.player_in_id order by t.created_at,t.id)
    into v_out_ids,v_in_ids
    from public.transactions t where t.id=v_package or t.parent_transaction_id=v_package;
    perform public.validate_trade_package_selection(
      v_league_id,v_sender_id,v_receiver_id,v_out_ids,v_in_ids
    );
    perform 1 from public.rosters r where r.league_id=v_league_id
      and r.player_id=any(v_out_ids||v_in_ids) for update;
    perform pg_catalog.set_config('app.trade_roster_validation_bypass','on',true);
    for v_row in
      select t.player_out_id,t.player_in_id from public.transactions t
      where t.id=v_package or t.parent_transaction_id=v_package order by t.created_at,t.id
    loop
      select r.is_starting,r.bench_order into strict v_sender_start,v_sender_bench
      from public.rosters r where r.league_id=v_league_id and r.user_id=v_sender_id and r.player_id=v_row.player_out_id;
      select r.is_starting,r.bench_order into strict v_receiver_start,v_receiver_bench
      from public.rosters r where r.league_id=v_league_id and r.user_id=v_receiver_id and r.player_id=v_row.player_in_id;
      update public.rosters set user_id=v_receiver_id,
        is_starting=v_receiver_start,is_starter=v_receiver_start,
        bench_order=case when v_receiver_start then null else coalesce(v_receiver_bench,1) end,
        is_transfer_listed=false,trade_note=null,acquired_at=pg_catalog.now()
      where league_id=v_league_id and user_id=v_sender_id and player_id=v_row.player_out_id;
      update public.rosters set user_id=v_sender_id,
        is_starting=v_sender_start,is_starter=v_sender_start,
        bench_order=case when v_sender_start then null else coalesce(v_sender_bench,1) end,
        is_transfer_listed=false,trade_note=null,acquired_at=pg_catalog.now()
      where league_id=v_league_id and user_id=v_receiver_id and player_id=v_row.player_in_id;
    end loop;
    select array_agg(player_id order by player_id) filter(where is_starting)
      into v_sender_starters from public.rosters where league_id=v_league_id and user_id=v_sender_id;
    select array_agg(player_id order by player_id) filter(where is_starting)
      into v_receiver_starters from public.rosters where league_id=v_league_id and user_id=v_receiver_id;
    if not public.is_legal_starting_lineup(v_sender_starters)
       or not public.is_legal_starting_lineup(v_receiver_starters) then
      raise exception 'TRADE_WOULD_CREATE_INVALID_LINEUP';
    end if;
    v_involved := v_out_ids||v_in_ids;
    delete from public.waiver_claims where league_id=v_league_id and lower(status)='pending'
      and (player_to_drop=any(v_involved) or player_to_add=any(v_involved));
    update public.transactions set status='ACCEPTED',updated_at=pg_catalog.now()
    where id=v_package or parent_transaction_id=v_package;
    insert into public.trade_package_audit(league_id,package_id,actor_id,action,details)
    values(v_league_id,v_package,v_actor,'ACCEPTED',jsonb_build_object('player_count',cardinality(v_out_ids)));
    return jsonb_build_object('success',true,'package_id',v_package);
  exception when others then
    return jsonb_build_object('success',false,'error',sqlerrm);
  end;
end;
$$;

create or replace function public.reorder_watchlist(
  p_league_id uuid,
  p_player_ids integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then return jsonb_build_object('success',false,'error','AUTH_REQUIRED'); end if;
  if cardinality(coalesce(p_player_ids,array[]::integer[]))
       <> (select count(distinct id) from unnest(coalesce(p_player_ids,array[]::integer[])) ids(id))
     or cardinality(coalesce(p_player_ids,array[]::integer[]))
       <> (select count(*) from public.watchlists where league_id=p_league_id and user_id=v_actor)
     or exists(
       select 1 from unnest(coalesce(p_player_ids,array[]::integer[])) ids(id)
       where not exists(select 1 from public.watchlists w where w.league_id=p_league_id and w.user_id=v_actor and w.player_id=ids.id)
     ) then
    return jsonb_build_object('success',false,'error','WATCHLIST_MISMATCH');
  end if;

  update public.watchlists w
  set priority_order=ordered.ordinality
  from unnest(p_player_ids) with ordinality ordered(player_id,ordinality)
  where w.league_id=p_league_id and w.user_id=v_actor and w.player_id=ordered.player_id;

  return jsonb_build_object('success',true,'player_ids',to_jsonb(p_player_ids));
end;
$$;

-- Remove direct client mutation paths. All writes now go through the package RPCs.
revoke insert, update, delete on public.transactions from public, anon, authenticated;
grant select on public.transactions to authenticated;

revoke all on function public.execute_draft_pick(uuid,uuid,integer) from public, anon;
grant execute on function public.execute_draft_pick(uuid,uuid,integer) to authenticated, service_role;
drop function if exists public.process_league_waivers(uuid);
revoke all on function public.process_gameweek_autosubs(uuid,integer,boolean) from public, anon;
grant execute on function public.process_gameweek_autosubs(uuid,integer,boolean) to authenticated, service_role;
revoke all on function public.generate_league_fixtures(uuid) from public, anon, authenticated;
grant execute on function public.generate_league_fixtures(uuid) to service_role;
revoke all on function public.auto_assign_starting_lineup(uuid,uuid) from public, anon, authenticated;
grant execute on function public.auto_assign_starting_lineup(uuid,uuid) to service_role;
revoke all on function public.validate_trade_package_selection(uuid,uuid,uuid,integer[],integer[]) from public, anon, authenticated;

revoke all on function public.create_trade_package(uuid,uuid,integer[],integer[]) from public, anon;
revoke all on function public.update_trade_package_status(uuid,text) from public, anon;
revoke all on function public.counter_trade_package(uuid,integer[],integer[]) from public, anon;
revoke all on function public.accept_trade_transaction(uuid) from public, anon;
revoke all on function public.reorder_watchlist(uuid,integer[]) from public, anon;
grant execute on function public.create_trade_package(uuid,uuid,integer[],integer[]) to authenticated;
grant execute on function public.update_trade_package_status(uuid,text) to authenticated;
grant execute on function public.counter_trade_package(uuid,integer[],integer[]) to authenticated;
grant execute on function public.accept_trade_transaction(uuid) to authenticated;
grant execute on function public.reorder_watchlist(uuid,integer[]) to authenticated;
grant select on public.trade_package_audit to authenticated;

comment on function public.auto_assign_starting_lineup(uuid,uuid) is
  'Builds and applies a legal XI and ordered bench in one constraint-safe update when a draft roster reaches 15 players.';
comment on function public.accept_trade_transaction(uuid) is
  'Receiver-only, locked and atomic trade-package acceptance with ownership, roster, lineup and waiver validation.';
