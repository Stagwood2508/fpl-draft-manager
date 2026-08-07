-- Keep free-agent swaps atomic and preserve the outgoing player's lineup slot.
create or replace function public.claim_free_agent(
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
  v_window public.league_gameweeks%rowtype;
  v_roster_type text;
  v_add_position text;
  v_drop_position text;
  v_updated integer;
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if p_gameweek not between 1 and 38 then
    return jsonb_build_object('success', false, 'error', 'INVALID_GAMEWEEK');
  end if;

  if not exists (
    select 1 from public.league_members lm
    where lm.league_id = p_league_id and lm.user_id = v_user_id
  ) then
    return jsonb_build_object('success', false, 'error', 'NOT_LEAGUE_MEMBER');
  end if;

  select * into v_window
  from public.league_gameweeks lg
  where lg.league_id = p_league_id and lg.gameweek = p_gameweek
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'GAMEWEEK_NOT_FOUND');
  end if;

  if not coalesce(v_window.is_waiver_processed, false) then
    return jsonb_build_object('success', false, 'error', 'WAIVERS_NOT_PROCESSED');
  end if;

  if v_window.gw_deadline <= pg_catalog.now() then
    return jsonb_build_object('success', false, 'error', 'FREE_AGENT_WINDOW_CLOSED');
  end if;

  perform 1
  from public.rosters r
  where r.league_id = p_league_id and r.user_id = v_user_id
  for update;

  if not exists (
    select 1 from public.rosters r
    where r.league_id = p_league_id
      and r.user_id = v_user_id
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

  select upper(coalesce(lpo.custom_position, p.element_type::text))
  into v_add_position
  from public.players p
  left join public.league_player_overrides lpo
    on lpo.league_id = p_league_id and lpo.player_id = p.id
  where p.id = p_add_player_id;

  select upper(coalesce(lpo.custom_position, p.element_type::text))
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
     or (
       v_roster_type <> 'STRICT'
       and ((v_add_position in ('GKP', 'GK', '1')) <> (v_drop_position in ('GKP', 'GK', '1')))
     ) then
    return jsonb_build_object('success', false, 'error', 'POSITION_MISMATCH');
  end if;

  begin
    update public.rosters
    set player_id = p_add_player_id,
        is_gk = v_add_position in ('GKP', 'GK', '1'),
        is_transfer_listed = false,
        trade_note = null,
        acquired_at = pg_catalog.now()
    where league_id = p_league_id
      and user_id = v_user_id
      and player_id = p_drop_player_id;

    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'ROSTER_SWAP_FAILED';
    end if;
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'error', 'TARGET_PLAYER_TAKEN');
  end;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.claim_free_agent(uuid, integer, integer, integer) from public, anon;
grant execute on function public.claim_free_agent(uuid, integer, integer, integer) to authenticated;
