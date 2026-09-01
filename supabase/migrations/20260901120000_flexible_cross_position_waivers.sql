-- Flexible leagues may exchange outfield positions through waivers, provided
-- the completed 15-player roster still satisfies every flexible min/max rule.

create or replace function public.waiver_swap_preserves_roster(
  p_league_id uuid,
  p_user_id uuid,
  p_add_player_id integer,
  p_drop_player_id integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with settings as (
    select upper(coalesce(ls.roster_type, l.roster_type, 'STRICT')) as roster_type
    from public.leagues l
    left join public.league_settings ls on ls.league_id = l.id
    where l.id = p_league_id
  ), projected_players as (
    select r.player_id
    from public.rosters r
    where r.league_id = p_league_id
      and r.user_id = p_user_id
      and r.player_id <> p_drop_player_id
    union all
    select p_add_player_id
  ), projected_positions as (
    select case upper(coalesce(lpo.custom_position, p.element_type::text))
      when '1' then 'GKP' when 'GK' then 'GKP' when 'GKP' then 'GKP'
      when '2' then 'DEF' when 'DEF' then 'DEF'
      when '3' then 'MID' when 'MID' then 'MID'
      when '4' then 'FWD' when 'FWD' then 'FWD'
      else null end as position
    from projected_players projected
    join public.players p on p.id = projected.player_id
    left join public.league_player_overrides lpo
      on lpo.league_id = p_league_id and lpo.player_id = p.id
  ), counts as (
    select
      count(*)::integer as total,
      count(*) filter (where position = 'GKP')::integer as gkp,
      count(*) filter (where position = 'DEF')::integer as def,
      count(*) filter (where position = 'MID')::integer as mid,
      count(*) filter (where position = 'FWD')::integer as fwd,
      count(*) filter (where position is null)::integer as invalid
    from projected_positions
  )
  select coalesce(
    case
      when settings.roster_type = 'STRICT' then
        counts.total = 15 and counts.invalid = 0
        and counts.gkp = 2 and counts.def = 5 and counts.mid = 5 and counts.fwd = 3
      else
        counts.total = 15 and counts.invalid = 0
        and counts.gkp = 2
        and counts.def between 4 and 6
        and counts.mid between 4 and 6
        and counts.fwd between 2 and 4
    end,
    false
  )
  from settings cross join counts;
$$;

revoke all on function public.waiver_swap_preserves_roster(uuid,uuid,integer,integer)
  from public, anon, authenticated;

do $$
declare
  v_definition text;
  v_old_fragment constant text := $fragment$
  if (v_roster_type = 'STRICT' and v_add_position <> v_drop_position)
     or (v_roster_type <> 'STRICT'
         and ((v_add_position = 'GKP') <> (v_drop_position = 'GKP'))) then
    return jsonb_build_object('success', false, 'error', 'POSITION_MISMATCH');
  end if;
$fragment$;
  v_new_fragment constant text := $fragment$
  if (v_roster_type = 'STRICT' and v_add_position <> v_drop_position)
     or (v_roster_type <> 'STRICT'
         and ((v_add_position = 'GKP') <> (v_drop_position = 'GKP'))) then
    return jsonb_build_object('success', false, 'error', 'POSITION_MISMATCH');
  end if;

  if not public.waiver_swap_preserves_roster(
    p_league_id,
    v_actor_id,
    p_add_player_id,
    p_drop_player_id
  ) then
    return jsonb_build_object('success', false, 'error', 'INVALID_ROSTER');
  end if;
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.submit_waiver_claim(uuid,integer,integer,integer)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'public.waiver_swap_preserves_roster(') = 0 then
    if pg_catalog.strpos(v_definition, v_old_fragment) = 0 then
      raise exception 'submit_waiver_claim roster validation did not match the expected definition';
    end if;
    execute pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
  end if;
end;
$$;

do $$
declare
  v_definition text;
  v_old_fragment constant text := $fragment$
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
$fragment$;
  v_new_fragment constant text := $fragment$
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

        if not public.waiver_swap_preserves_roster(
          p_league_id,
          v_manager.user_id,
          v_claim.player_to_add,
          v_claim.player_to_drop
        ) then
          update public.waiver_claims
          set status = 'failed',
              failure_reason = 'INVALID_ROSTER',
              processed_at = pg_catalog.now(),
              gameweek = p_gameweek
          where id = v_claim.id;
          v_failure_count := v_failure_count + 1;
          continue;
        end if;
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.process_league_waivers(uuid,integer)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'public.waiver_swap_preserves_roster(') = 0 then
    if pg_catalog.strpos(v_definition, v_old_fragment) = 0 then
      raise exception 'process_league_waivers roster validation did not match the expected definition';
    end if;
    execute pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
  end if;
end;
$$;

revoke all on function public.submit_waiver_claim(uuid,integer,integer,integer)
  from public, anon;
grant execute on function public.submit_waiver_claim(uuid,integer,integer,integer)
  to authenticated;

comment on function public.waiver_swap_preserves_roster(uuid,uuid,integer,integer) is
  'Checks the completed 15-player roster for a proposed waiver swap, including flexible position minimums and maximums.';
