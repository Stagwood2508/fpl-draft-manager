-- Pre-launch hardening for manager-authored draft and market mutations.
-- Client applications retain read access, but authoritative writes are routed
-- through locked SECURITY DEFINER functions.

create or replace function public.submit_waiver_claim(
  p_league_id uuid,
  p_add_player_id integer,
  p_drop_player_id integer,
  p_gameweek integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_window public.league_gameweeks%rowtype;
  v_add_position text;
  v_drop_position text;
  v_roster_type text;
  v_priority integer;
  v_claim_id uuid;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if p_add_player_id is null or p_drop_player_id is null
     or p_add_player_id = p_drop_player_id then
    return jsonb_build_object('success', false, 'error', 'INVALID_PLAYER_SWAP');
  end if;

  if not exists (
    select 1 from public.league_members lm
    where lm.league_id = p_league_id and lm.user_id = v_actor_id
  ) then
    return jsonb_build_object('success', false, 'error', 'NOT_LEAGUE_MEMBER');
  end if;

  -- Serialise submissions, cancellations, reorders and processing per league.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_league_id::text, 91420260811)
  );

  select lg.* into v_window
  from public.league_gameweeks lg
  where lg.league_id = p_league_id
    and (p_gameweek is null or lg.gameweek = p_gameweek)
    and not coalesce(lg.is_waiver_processed, false)
  order by
    case when p_gameweek is not null then 0 else 1 end,
    lg.waiver_deadline nulls last,
    lg.gameweek
  limit 1
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'WAIVER_WINDOW_NOT_FOUND');
  end if;

  if v_window.waiver_deadline is null
     or pg_catalog.now() >= v_window.waiver_deadline
     or upper(coalesce(v_window.status::text, '')) <> 'WAIVERS_OPEN' then
    return jsonb_build_object('success', false, 'error', 'WAIVER_WINDOW_CLOSED');
  end if;

  perform 1 from public.rosters r
  where r.league_id = p_league_id
  for update;

  if not exists (
    select 1 from public.rosters r
    where r.league_id = p_league_id
      and r.user_id = v_actor_id
      and r.player_id = p_drop_player_id
  ) then
    return jsonb_build_object('success', false, 'error', 'DROP_PLAYER_NOT_OWNED');
  end if;

  if exists (
    select 1 from public.rosters r
    where r.league_id = p_league_id and r.player_id = p_add_player_id
  ) then
    return jsonb_build_object('success', false, 'error', 'TARGET_PLAYER_TAKEN');
  end if;

  if exists (
    select 1 from public.waiver_claims wc
    where wc.league_id = p_league_id
      and wc.user_id = v_actor_id
      and wc.player_to_add = p_add_player_id
      and lower(coalesce(wc.status::text, 'pending')) = 'pending'
      and coalesce(wc.gameweek, v_window.gameweek) = v_window.gameweek
  ) then
    return jsonb_build_object('success', false, 'error', 'DUPLICATE_PENDING_CLAIM');
  end if;

  select case upper(coalesce(lpo.custom_position, p.element_type::text))
    when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
    when '2' then 'DEF' when 'DEF' then 'DEF'
    when '3' then 'MID' when 'MID' then 'MID'
    when '4' then 'FWD' when 'FWD' then 'FWD' end
  into v_add_position
  from public.players p
  left join public.league_player_overrides lpo
    on lpo.league_id = p_league_id and lpo.player_id = p.id
  where p.id = p_add_player_id and coalesce(p.is_active, true);

  select case upper(coalesce(lpo.custom_position, p.element_type::text))
    when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
    when '2' then 'DEF' when 'DEF' then 'DEF'
    when '3' then 'MID' when 'MID' then 'MID'
    when '4' then 'FWD' when 'FWD' then 'FWD' end
  into v_drop_position
  from public.players p
  left join public.league_player_overrides lpo
    on lpo.league_id = p_league_id and lpo.player_id = p.id
  where p.id = p_drop_player_id;

  select upper(coalesce(ls.roster_type, l.roster_type, 'STRICT'))
  into v_roster_type
  from public.leagues l
  left join public.league_settings ls on ls.league_id = l.id
  where l.id = p_league_id;

  if v_add_position is null or v_drop_position is null then
    return jsonb_build_object('success', false, 'error', 'PLAYER_NOT_FOUND');
  end if;

  if (v_roster_type = 'STRICT' and v_add_position <> v_drop_position)
     or (v_roster_type <> 'STRICT'
         and ((v_add_position = 'GKP') <> (v_drop_position = 'GKP'))) then
    return jsonb_build_object('success', false, 'error', 'POSITION_MISMATCH');
  end if;

  select coalesce(max(wc.priority_order), 0) + 1
  into v_priority
  from public.waiver_claims wc
  where wc.league_id = p_league_id
    and wc.user_id = v_actor_id
    and lower(coalesce(wc.status::text, 'pending')) = 'pending'
    and coalesce(wc.gameweek, v_window.gameweek) = v_window.gameweek;

  insert into public.waiver_claims (
    league_id, user_id, player_to_add, player_to_drop,
    priority_order, gameweek
  ) values (
    p_league_id, v_actor_id, p_add_player_id, p_drop_player_id,
    v_priority, v_window.gameweek
  ) returning id into v_claim_id;

  return jsonb_build_object(
    'success', true,
    'claim_id', v_claim_id,
    'priority_order', v_priority,
    'gameweek', v_window.gameweek
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'error', 'CLAIM_CONFLICT');
end;
$$;

create or replace function public.reorder_waiver_claims(
  p_league_id uuid,
  p_claim_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_window public.league_gameweeks%rowtype;
  v_expected integer;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if not exists (
    select 1 from public.league_members lm
    where lm.league_id = p_league_id and lm.user_id = v_actor_id
  ) then
    return jsonb_build_object('success', false, 'error', 'NOT_LEAGUE_MEMBER');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_league_id::text, 91420260811)
  );

  select lg.* into v_window
  from public.league_gameweeks lg
  where lg.league_id = p_league_id
    and not coalesce(lg.is_waiver_processed, false)
    and lg.waiver_deadline > pg_catalog.now()
    and upper(coalesce(lg.status::text, '')) = 'WAIVERS_OPEN'
  order by lg.waiver_deadline, lg.gameweek
  limit 1
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'WAIVER_WINDOW_CLOSED');
  end if;

  select count(*) into v_expected
  from public.waiver_claims wc
  where wc.league_id = p_league_id
    and wc.user_id = v_actor_id
    and lower(coalesce(wc.status::text, 'pending')) = 'pending'
    and coalesce(wc.gameweek, v_window.gameweek) = v_window.gameweek;

  if cardinality(coalesce(p_claim_ids, array[]::uuid[])) <> v_expected
     or cardinality(coalesce(p_claim_ids, array[]::uuid[]))
        <> (select count(distinct claim_id) from unnest(coalesce(p_claim_ids, array[]::uuid[])) ids(claim_id))
     or exists (
       select 1 from unnest(coalesce(p_claim_ids, array[]::uuid[])) ids(claim_id)
       where not exists (
         select 1 from public.waiver_claims wc
         where wc.id = ids.claim_id
           and wc.league_id = p_league_id
           and wc.user_id = v_actor_id
           and lower(coalesce(wc.status::text, 'pending')) = 'pending'
           and coalesce(wc.gameweek, v_window.gameweek) = v_window.gameweek
       )
     ) then
    return jsonb_build_object('success', false, 'error', 'CLAIM_ORDER_MISMATCH');
  end if;

  perform 1 from public.waiver_claims wc
  where wc.league_id = p_league_id
    and wc.user_id = v_actor_id
    and lower(coalesce(wc.status::text, 'pending')) = 'pending'
    and coalesce(wc.gameweek, v_window.gameweek) = v_window.gameweek
  for update;

  update public.waiver_claims wc
  set priority_order = wc.priority_order + 1000000
  where wc.league_id = p_league_id
    and wc.user_id = v_actor_id
    and lower(coalesce(wc.status::text, 'pending')) = 'pending'
    and coalesce(wc.gameweek, v_window.gameweek) = v_window.gameweek;

  update public.waiver_claims wc
  set priority_order = ordered.ordinality
  from unnest(coalesce(p_claim_ids, array[]::uuid[]))
       with ordinality ordered(claim_id, ordinality)
  where wc.id = ordered.claim_id;

  return jsonb_build_object(
    'success', true,
    'claim_ids', to_jsonb(p_claim_ids),
    'gameweek', v_window.gameweek
  );
end;
$$;

create or replace function public.cancel_waiver_claim(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_claim record;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  select wc.id, wc.league_id into v_claim
  from public.waiver_claims wc where wc.id = p_claim_id;

  if v_claim.id is null then
    return jsonb_build_object('success', false, 'error', 'CLAIM_NOT_FOUND');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_claim.league_id::text, 91420260811)
  );

  select wc.id, wc.league_id, wc.user_id, wc.gameweek, wc.status,
         lg.waiver_deadline, lg.is_waiver_processed
  into v_claim
  from public.waiver_claims wc
  left join public.league_gameweeks lg
    on lg.league_id = wc.league_id and lg.gameweek = wc.gameweek
  where wc.id = p_claim_id
  for update of wc;

  if v_claim.user_id <> v_actor_id then
    return jsonb_build_object('success', false, 'error', 'CLAIM_OWNER_REQUIRED');
  end if;
  if lower(coalesce(v_claim.status::text, 'pending')) <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'CLAIM_ALREADY_PROCESSED');
  end if;
  if coalesce(v_claim.is_waiver_processed, false)
     or v_claim.waiver_deadline is null
     or pg_catalog.now() >= v_claim.waiver_deadline then
    return jsonb_build_object('success', false, 'error', 'WAIVER_WINDOW_CLOSED');
  end if;

  delete from public.waiver_claims where id = p_claim_id;

  with ordered as (
    select wc.id, row_number() over (
      order by wc.priority_order, wc.created_at, wc.id
    )::integer as next_priority
    from public.waiver_claims wc
    where wc.league_id = v_claim.league_id
      and wc.user_id = v_actor_id
      and lower(coalesce(wc.status::text, 'pending')) = 'pending'
      and wc.gameweek is not distinct from v_claim.gameweek
  )
  update public.waiver_claims wc
  set priority_order = ordered.next_priority
  from ordered where wc.id = ordered.id;

  return jsonb_build_object(
    'success', true,
    'claim_id', p_claim_id,
    'remaining_claims', (
      select count(*) from public.waiver_claims wc
      where wc.league_id = v_claim.league_id
        and wc.user_id = v_actor_id
        and lower(coalesce(wc.status::text, 'pending')) = 'pending'
        and wc.gameweek is not distinct from v_claim.gameweek
    )
  );
end;
$$;

-- Repair the current XI atomically when a flexible waiver changes a starter's
-- position and leaves the saved formation illegal.
create or replace function public.repair_lineup_after_successful_waiver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starters integer[];
begin
  if lower(coalesce(old.status::text, '')) = lower(coalesce(new.status::text, ''))
     or lower(coalesce(new.status::text, '')) not in ('successful', 'accepted', 'completed') then
    return new;
  end if;

  if (select count(*) from public.rosters r
      where r.league_id = new.league_id and r.user_id = new.user_id) = 15 then
    select array_agg(r.player_id order by r.player_id) filter (where r.is_starting)
    into v_starters
    from public.rosters r
    where r.league_id = new.league_id and r.user_id = new.user_id;

    if not public.is_legal_starting_lineup(v_starters) then
      perform public.auto_assign_starting_lineup(new.league_id, new.user_id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists repair_lineup_after_successful_waiver_trigger
  on public.waiver_claims;
create trigger repair_lineup_after_successful_waiver_trigger
after update of status on public.waiver_claims
for each row execute function public.repair_lineup_after_successful_waiver();

create or replace function public.claim_free_agent_with_history(
  p_league_id uuid,
  p_add_player_id integer,
  p_drop_player_id integer,
  p_gameweek integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
  v_starters integer[];
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if not exists (
    select 1 from public.league_members lm
    where lm.league_id = p_league_id and lm.user_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'error', 'NOT_LEAGUE_MEMBER');
  end if;

  if exists (
    select 1 from public.waiver_player_locks wpl
    where wpl.league_id = p_league_id
      and wpl.player_id = p_add_player_id
      and p_gameweek < wpl.available_gameweek
  ) then
    return jsonb_build_object(
      'success', false, 'error', 'PLAYER_WAIVER_LOCKED',
      'available_gameweek', (
        select wpl.available_gameweek from public.waiver_player_locks wpl
        where wpl.league_id = p_league_id and wpl.player_id = p_add_player_id
      )
    );
  end if;

  v_result := public.claim_free_agent(
    p_league_id, p_add_player_id, p_drop_player_id, p_gameweek
  )::jsonb;

  if coalesce((v_result ->> 'success')::boolean, false) then
    select array_agg(r.player_id order by r.player_id) filter (where r.is_starting)
    into v_starters
    from public.rosters r
    where r.league_id = p_league_id and r.user_id = v_user_id;

    if not public.is_legal_starting_lineup(v_starters) then
      perform public.auto_assign_starting_lineup(p_league_id, v_user_id);
    end if;

    insert into public.free_agent_transactions (
      league_id, user_id, gameweek, player_in_id, player_out_id
    ) values (
      p_league_id, v_user_id, p_gameweek, p_add_player_id, p_drop_player_id
    ) on conflict (league_id, user_id, gameweek, player_in_id, player_out_id)
      do nothing;
  end if;

  return v_result;
end;
$$;

create or replace function public.set_transfer_listing(
  p_league_id uuid,
  p_roster_id uuid,
  p_is_listed boolean,
  p_trade_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_note text := nullif(pg_catalog.btrim(coalesce(p_trade_note, '')), '');
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;
  if v_note is not null and char_length(v_note) > 240 then
    return jsonb_build_object('success', false, 'error', 'TRADE_NOTE_TOO_LONG');
  end if;

  update public.rosters r
  set is_transfer_listed = coalesce(p_is_listed, false),
      trade_note = case when coalesce(p_is_listed, false) then v_note else null end
  where r.id = p_roster_id
    and r.league_id = p_league_id
    and r.user_id = v_actor_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'ROSTER_PLAYER_NOT_OWNED');
  end if;

  return jsonb_build_object('success', true, 'roster_id', p_roster_id);
end;
$$;

-- A manual click arriving after the authoritative deadline must lose to the
-- server timeout. Server/service auto-picks and commissioner recovery actions
-- do not impersonate the current manager and remain available.
create or replace function public.enforce_manual_draft_pick_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_deadline timestamptz;
begin
  if upper(coalesce(new.pick_source, 'MANUAL')) = 'MANUAL'
     and v_actor_id is not null
     and v_actor_id = new.user_id then
    select ds.pick_deadline into v_deadline
    from public.draft_sessions ds
    where ds.league_id = new.league_id;

    if v_deadline is null or pg_catalog.now() >= v_deadline then
      raise exception 'PICK_DEADLINE_EXPIRED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_manual_draft_pick_deadline_trigger
  on public.draft_picks;
create trigger enforce_manual_draft_pick_deadline_trigger
before insert on public.draft_picks
for each row execute function public.enforce_manual_draft_pick_deadline();

drop policy if exists "Allow members to manage their claims" on public.waiver_claims;
drop policy if exists "League members can view waiver claims" on public.waiver_claims;
create policy "League members can view waiver claims"
on public.waiver_claims for select to authenticated
using (exists (
  select 1 from public.league_members lm
  where lm.league_id = waiver_claims.league_id and lm.user_id = auth.uid()
));

revoke insert, update, delete on public.waiver_claims from public, anon, authenticated;
revoke insert, update, delete on public.draft_picks from public, anon, authenticated;
revoke insert, update, delete on public.rosters from public, anon, authenticated;

revoke all on function public.submit_waiver_claim(uuid,integer,integer,integer) from public, anon;
revoke all on function public.reorder_waiver_claims(uuid,uuid[]) from public, anon;
revoke all on function public.cancel_waiver_claim(uuid) from public, anon;
revoke all on function public.claim_free_agent(uuid,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.claim_free_agent_with_history(uuid,integer,integer,integer) from public, anon;
revoke all on function public.set_transfer_listing(uuid,uuid,boolean,text) from public, anon;

grant execute on function public.submit_waiver_claim(uuid,integer,integer,integer) to authenticated;
grant execute on function public.reorder_waiver_claims(uuid,uuid[]) to authenticated;
grant execute on function public.cancel_waiver_claim(uuid) to authenticated;
grant execute on function public.claim_free_agent(uuid,integer,integer,integer) to service_role;
grant execute on function public.claim_free_agent_with_history(uuid,integer,integer,integer) to authenticated;
grant execute on function public.set_transfer_listing(uuid,uuid,boolean,text) to authenticated;

comment on function public.submit_waiver_claim(uuid,integer,integer,integer) is
  'Atomically validates and submits the authenticated manager waiver claim before the server deadline.';
comment on function public.reorder_waiver_claims(uuid,uuid[]) is
  'Atomically replaces the authenticated manager complete pending waiver order before the server deadline.';
comment on function public.set_transfer_listing(uuid,uuid,boolean,text) is
  'Owner-only transfer-list metadata update used instead of direct roster writes.';
