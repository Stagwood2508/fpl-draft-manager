-- Authoritative league schedule generation for even and odd manager counts.
-- Odd leagues play one explicit LEAGUE AVERAGE fixture per gameweek. The
-- average is not represented by an auth user or league member.

alter table public.league_fixtures
  add column if not exists is_league_average boolean not null default false;

alter table public.league_fixtures
  alter column away_user_id drop not null;

alter table public.league_fixtures
  drop constraint if exists league_fixtures_valid_opponent_check;

alter table public.league_fixtures
  add constraint league_fixtures_valid_opponent_check check (
    home_user_id is not null
    and (
      (is_league_average and away_user_id is null)
      or
      (not is_league_average and away_user_id is not null and away_user_id <> home_user_id)
    )
  );

create or replace function public.build_league_fixture_pairings(
  p_manager_ids uuid[],
  p_gameweeks integer default 38
)
returns table (
  gameweek integer,
  home_user_id uuid,
  away_user_id uuid,
  is_league_average boolean
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rotation uuid[] := coalesce(p_manager_ids, array[]::uuid[]);
  v_next_rotation uuid[];
  v_slot_count integer;
  v_rounds integer;
  v_matches_per_round integer;
  v_gameweek integer;
  v_cycle integer;
  v_round integer;
  v_pair integer;
  v_index integer;
  v_first uuid;
  v_second uuid;
begin
  if p_gameweeks is null or p_gameweeks < 1 then
    raise exception 'INVALID_GAMEWEEK_COUNT';
  end if;

  if cardinality(v_rotation) < 2 then
    raise exception 'AT_LEAST_TWO_MANAGERS_REQUIRED';
  end if;

  if cardinality(v_rotation) <> cardinality(array(
    select distinct manager.manager_id
    from unnest(v_rotation) as manager(manager_id)
  )) then
    raise exception 'DUPLICATE_MANAGER_ID';
  end if;

  if exists (
    select 1 from unnest(v_rotation) as manager(manager_id)
    where manager.manager_id is null
  ) then
    raise exception 'NULL_MANAGER_ID';
  end if;

  if cardinality(v_rotation) % 2 = 1 then
    v_rotation := array_append(v_rotation, null::uuid);
  end if;

  v_slot_count := cardinality(v_rotation);
  v_rounds := v_slot_count - 1;
  v_matches_per_round := v_slot_count / 2;

  for v_gameweek in 1..p_gameweeks loop
    v_cycle := (v_gameweek - 1) / v_rounds;
    v_round := (v_gameweek - 1) % v_rounds;

    for v_pair in 1..v_matches_per_round loop
      v_first := v_rotation[v_pair];
      v_second := v_rotation[v_slot_count - v_pair + 1];

      gameweek := v_gameweek;

      if v_first is null or v_second is null then
        home_user_id := coalesce(v_first, v_second);
        away_user_id := null;
        is_league_average := true;
      elsif (
        (
          case when v_pair = 1 then v_round % 2 else v_pair % 2 end
          + v_cycle % 2
        ) % 2
      ) = 1 then
        home_user_id := v_second;
        away_user_id := v_first;
        is_league_average := false;
      else
        home_user_id := v_first;
        away_user_id := v_second;
        is_league_average := false;
      end if;

      return next;
    end loop;

    -- Circle method: hold the first slot, move the final slot into position
    -- two, and shift every other slot one place to the right.
    v_next_rotation := array[v_rotation[1], v_rotation[v_slot_count]];
    if v_slot_count > 2 then
      for v_index in 2..v_slot_count - 1 loop
        v_next_rotation := array_append(v_next_rotation, v_rotation[v_index]);
      end loop;
    end if;
    v_rotation := v_next_rotation;
  end loop;
end;
$$;

revoke all on function public.build_league_fixture_pairings(uuid[], integer)
  from public, anon, authenticated;
grant execute on function public.build_league_fixture_pairings(uuid[], integer)
  to service_role;

create or replace function public.validate_league_fixture_pairing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.home_user_id is null then
    raise exception 'FIXTURE_HOME_MANAGER_REQUIRED';
  end if;

  if new.is_league_average then
    if new.away_user_id is not null then
      raise exception 'LEAGUE_AVERAGE_MUST_NOT_HAVE_USER';
    end if;
    new.away_team_name := 'League Average';
  elsif new.away_user_id is null or new.away_user_id = new.home_user_id then
    raise exception 'INVALID_HEAD_TO_HEAD_OPPONENT';
  end if;

  if not exists (
    select 1 from public.league_members member
    where member.league_id = new.league_id
      and member.user_id = new.home_user_id
  ) then
    raise exception 'HOME_MANAGER_NOT_IN_LEAGUE';
  end if;

  if new.away_user_id is not null and not exists (
    select 1 from public.league_members member
    where member.league_id = new.league_id
      and member.user_id = new.away_user_id
  ) then
    raise exception 'AWAY_MANAGER_NOT_IN_LEAGUE';
  end if;

  if exists (
    select 1
    from public.league_fixtures fixture
    where fixture.league_id = new.league_id
      and fixture.gameweek = new.gameweek
      and fixture.id is distinct from new.id
      and (
        new.home_user_id in (fixture.home_user_id, fixture.away_user_id)
        or (
          new.away_user_id is not null
          and new.away_user_id in (fixture.home_user_id, fixture.away_user_id)
        )
      )
  ) then
    raise exception 'MANAGER_ALREADY_HAS_GAMEWEEK_FIXTURE';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_league_fixture_pairing_trigger
  on public.league_fixtures;
create trigger validate_league_fixture_pairing_trigger
before insert or update of
  league_id, gameweek, home_user_id, away_user_id, is_league_average
on public.league_fixtures
for each row execute function public.validate_league_fixture_pairing();

create or replace function public.generate_league_fixtures(p_league_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager_ids uuid[];
  v_manager_count integer;
  v_expected_fixtures integer;
  v_existing_fixtures integer;
  v_inserted integer := 0;
begin
  perform 1 from public.leagues league
  where league.id = p_league_id
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'LEAGUE_NOT_FOUND');
  end if;

  select array_agg(member.user_id order by member.draft_order nulls last, member.user_id)
  into v_manager_ids
  from public.league_members member
  where member.league_id = p_league_id;

  v_manager_count := cardinality(coalesce(v_manager_ids, array[]::uuid[]));
  if v_manager_count < 2 then
    return json_build_object('success', false, 'error', 'AT_LEAST_TWO_MANAGERS_REQUIRED');
  end if;

  v_expected_fixtures := 38 * ((v_manager_count + 1) / 2);

  select count(*) into v_existing_fixtures
  from public.league_fixtures fixture
  where fixture.league_id = p_league_id;

  if v_existing_fixtures = v_expected_fixtures
     and not exists (
       with appearances as (
         select fixture.gameweek, fixture.home_user_id as user_id
         from public.league_fixtures fixture
         where fixture.league_id = p_league_id
         union all
         select fixture.gameweek, fixture.away_user_id
         from public.league_fixtures fixture
         where fixture.league_id = p_league_id
           and fixture.away_user_id is not null
       )
       select 1
       from generate_series(1, 38) as expected_gameweek(gameweek)
       cross join unnest(v_manager_ids) manager(user_id)
       left join appearances appearance
         on appearance.gameweek = gameweek
        and appearance.user_id = manager.user_id
       group by gameweek, manager.user_id
       having count(appearance.user_id) <> 1
     )
     and not exists (
       select 1
       from public.league_fixtures fixture
       where fixture.league_id = p_league_id
       group by fixture.gameweek
       having count(*) filter (where fixture.is_league_average)
         <> case when v_manager_count % 2 = 1 then 1 else 0 end
     ) then
    return json_build_object(
      'success', true,
      'fixtures_created', 0,
      'fixtures_existing', v_existing_fixtures,
      'gameweeks', 38,
      'reused', true
    );
  end if;

  if v_existing_fixtures > 0
     and public.draft_has_official_activity(p_league_id) then
    return json_build_object('success', false, 'error', 'FIXTURE_REGENERATION_LOCKED');
  end if;

  delete from public.league_fixtures fixture
  where fixture.league_id = p_league_id;

  insert into public.league_fixtures (
    league_id,
    gameweek,
    home_user_id,
    away_user_id,
    home_team_name,
    away_team_name,
    is_league_average
  )
  select
    p_league_id,
    pairing.gameweek,
    pairing.home_user_id,
    pairing.away_user_id,
    coalesce(home_member.team_name, 'FC Manager'),
    case
      when pairing.is_league_average then 'League Average'
      else coalesce(away_member.team_name, 'FC Manager')
    end,
    pairing.is_league_average
  from public.build_league_fixture_pairings(v_manager_ids, 38) pairing
  join public.league_members home_member
    on home_member.league_id = p_league_id
   and home_member.user_id = pairing.home_user_id
  left join public.league_members away_member
    on away_member.league_id = p_league_id
   and away_member.user_id = pairing.away_user_id;

  get diagnostics v_inserted = row_count;

  if v_inserted <> v_expected_fixtures then
    raise exception 'FIXTURE_COUNT_VALIDATION_FAILED:%/%', v_inserted, v_expected_fixtures;
  end if;

  if exists (
    with appearances as (
      select fixture.gameweek, fixture.home_user_id as user_id
      from public.league_fixtures fixture
      where fixture.league_id = p_league_id
      union all
      select fixture.gameweek, fixture.away_user_id
      from public.league_fixtures fixture
      where fixture.league_id = p_league_id
        and fixture.away_user_id is not null
    )
    select 1
    from generate_series(1, 38) as expected_gameweek(gameweek)
    cross join unnest(v_manager_ids) manager(user_id)
    left join appearances appearance
      on appearance.gameweek = gameweek
     and appearance.user_id = manager.user_id
    group by gameweek, manager.user_id
    having count(appearance.user_id) <> 1
  ) then
    raise exception 'MANAGER_GAMEWEEK_COVERAGE_VALIDATION_FAILED';
  end if;

  return json_build_object(
    'success', true,
    'fixtures_created', v_inserted,
    'gameweeks', 38,
    'league_average_fixtures', case when v_manager_count % 2 = 1 then 38 else 0 end,
    'reused', false
  );
end;
$$;

revoke all on function public.generate_league_fixtures(uuid)
  from public, anon, authenticated;
grant execute on function public.generate_league_fixtures(uuid)
  to service_role;

comment on function public.generate_league_fixtures(uuid) is
  'Repeat-safe 38-gameweek schedule generator. Every manager plays once per gameweek; odd leagues face an explicit rotating league-average opponent.';

create or replace function public.calculate_player_defcon_points(
  p_league_id uuid,
  p_position text,
  p_defensive_contribution integer
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when upper(coalesce(p_position, '')) in ('1', 'GKP', 'GK') then 0
    when coalesce(p_defensive_contribution, 0) >= coalesce(
      case
        when upper(p_position) in ('2', 'DEF') then (settings.defcon_thresholds_def->'tier_3'->>'threshold')::integer
        when upper(p_position) in ('3', 'MID') then (settings.defcon_thresholds_mid->'tier_3'->>'threshold')::integer
        when upper(p_position) in ('4', 'FWD') then (settings.defcon_thresholds_fwd->'tier_3'->>'threshold')::integer
      end, 30
    ) then coalesce(
      case
        when upper(p_position) in ('2', 'DEF') then (settings.defcon_thresholds_def->'tier_3'->>'points')::integer
        when upper(p_position) in ('3', 'MID') then (settings.defcon_thresholds_mid->'tier_3'->>'points')::integer
        when upper(p_position) in ('4', 'FWD') then (settings.defcon_thresholds_fwd->'tier_3'->>'points')::integer
      end, 10
    )
    when coalesce(p_defensive_contribution, 0) >= coalesce(
      case
        when upper(p_position) in ('2', 'DEF') then (settings.defcon_thresholds_def->'tier_2'->>'threshold')::integer
        when upper(p_position) in ('3', 'MID') then (settings.defcon_thresholds_mid->'tier_2'->>'threshold')::integer
        when upper(p_position) in ('4', 'FWD') then (settings.defcon_thresholds_fwd->'tier_2'->>'threshold')::integer
      end, 20
    ) then coalesce(
      case
        when upper(p_position) in ('2', 'DEF') then (settings.defcon_thresholds_def->'tier_2'->>'points')::integer
        when upper(p_position) in ('3', 'MID') then (settings.defcon_thresholds_mid->'tier_2'->>'points')::integer
        when upper(p_position) in ('4', 'FWD') then (settings.defcon_thresholds_fwd->'tier_2'->>'points')::integer
      end, 5
    )
    when coalesce(p_defensive_contribution, 0) >= coalesce(
      case
        when upper(p_position) in ('2', 'DEF') then (settings.defcon_thresholds_def->'tier_1'->>'threshold')::integer
        when upper(p_position) in ('3', 'MID') then (settings.defcon_thresholds_mid->'tier_1'->>'threshold')::integer
        when upper(p_position) in ('4', 'FWD') then (settings.defcon_thresholds_fwd->'tier_1'->>'threshold')::integer
      end, 10
    ) then coalesce(
      case
        when upper(p_position) in ('2', 'DEF') then (settings.defcon_thresholds_def->'tier_1'->>'points')::integer
        when upper(p_position) in ('3', 'MID') then (settings.defcon_thresholds_mid->'tier_1'->>'points')::integer
        when upper(p_position) in ('4', 'FWD') then (settings.defcon_thresholds_fwd->'tier_1'->>'points')::integer
      end, 2
    )
    else 0
  end
  from (select 1) seed
  left join public.league_settings settings on settings.league_id = p_league_id;
$$;

revoke all on function public.calculate_player_defcon_points(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.calculate_player_defcon_points(uuid, text, integer)
  to service_role;

-- Live score calculation includes a synthetic opponent only at query time.
-- The average excludes the manager playing against it. FPL and DEFCON means
-- are rounded independently to the nearest integer, then added together.
create or replace function public.get_live_fixture_scores(p_gameweek integer)
returns table(
  fixture_id uuid,
  league_id uuid,
  gameweek integer,
  home_user_id uuid,
  home_score integer,
  home_fpl_points integer,
  home_defcon_points integer,
  away_user_id uuid,
  away_score integer,
  away_fpl_points integer,
  away_defcon_points integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with selected_players as (
    select
      snapshot.league_id,
      snapshot.user_id,
      selected.player_id
    from public.gameweek_lineup_snapshots snapshot
    cross join lateral unnest(snapshot.effective_starting_player_ids) selected(player_id)
    where snapshot.gameweek = p_gameweek

    union all

    select roster.league_id, roster.user_id, roster.player_id
    from public.rosters roster
    where roster.is_starting
      and not exists (
        select 1
        from public.gameweek_lineup_snapshots snapshot
        where snapshot.league_id = roster.league_id
          and snapshot.user_id = roster.user_id
          and snapshot.gameweek = p_gameweek
      )
  ),
  player_scores as (
    select
      selected.league_id,
      selected.user_id,
      coalesce(stats.total_points, 0) as fpl_points,
      public.calculate_player_defcon_points(
        selected.league_id,
        player.element_type::text,
        coalesce(stats.defensive_contribution, 0)::integer
      ) as defcon_points
    from selected_players selected
    join public.players player on player.id = selected.player_id
    left join public.player_gameweek_stats stats
      on stats.player_id = selected.player_id
     and stats.gameweek = p_gameweek
  ),
  player_totals as (
    select
      scores.league_id,
      scores.user_id,
      sum(scores.fpl_points)::integer as fpl_points,
      sum(scores.defcon_points)::integer as defcon_points
    from player_scores scores
    group by scores.league_id, scores.user_id
  ),
  manager_totals as (
    select
      member.league_id,
      member.user_id,
      coalesce(total.fpl_points, 0)::integer as fpl_points,
      coalesce(total.defcon_points, 0)::integer as defcon_points
    from public.league_members member
    left join player_totals total
      on total.league_id = member.league_id
     and total.user_id = member.user_id
  )
  select
    fixture.id,
    fixture.league_id,
    fixture.gameweek,
    fixture.home_user_id,
    (coalesce(home.fpl_points, 0) + coalesce(home.defcon_points, 0))::integer,
    coalesce(home.fpl_points, 0)::integer,
    coalesce(home.defcon_points, 0)::integer,
    fixture.away_user_id,
    case
      when fixture.is_league_average then
        (coalesce(average_score.fpl_points, 0) + coalesce(average_score.defcon_points, 0))::integer
      else (coalesce(away.fpl_points, 0) + coalesce(away.defcon_points, 0))::integer
    end,
    case when fixture.is_league_average
      then coalesce(average_score.fpl_points, 0)
      else coalesce(away.fpl_points, 0)
    end::integer,
    case when fixture.is_league_average
      then coalesce(average_score.defcon_points, 0)
      else coalesce(away.defcon_points, 0)
    end::integer
  from public.league_fixtures fixture
  left join manager_totals home
    on home.league_id = fixture.league_id
   and home.user_id = fixture.home_user_id
  left join manager_totals away
    on away.league_id = fixture.league_id
   and away.user_id = fixture.away_user_id
  left join lateral (
    select
      round(avg(peer.fpl_points))::integer as fpl_points,
      round(avg(peer.defcon_points))::integer as defcon_points
    from manager_totals peer
    where peer.league_id = fixture.league_id
      and peer.user_id <> fixture.home_user_id
  ) average_score on fixture.is_league_average
  where fixture.gameweek = p_gameweek;
$$;

revoke all on function public.get_live_fixture_scores(integer) from public, anon;
grant execute on function public.get_live_fixture_scores(integer)
  to authenticated, service_role;

create or replace function public.finalize_gameweek_fixture_scores(p_gameweek integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  if not exists (
    select 1 from public.gameweeks gameweek
    where gameweek.gameweek_number = p_gameweek
      and coalesce(gameweek.is_finished, false)
  ) then
    return jsonb_build_object('success', false, 'error', 'GAMEWEEK_NOT_FINISHED');
  end if;

  with scores as (
    select * from public.get_live_fixture_scores(p_gameweek)
  )
  update public.league_fixtures fixture
  set
    home_score = scores.home_score,
    home_fpl_points = scores.home_fpl_points,
    home_defcon_points = scores.home_defcon_points,
    away_score = scores.away_score,
    away_fpl_points = scores.away_fpl_points,
    away_defcon_points = scores.away_defcon_points,
    is_finished = true
  from scores
  where fixture.id = scores.fixture_id
    and fixture.gameweek = p_gameweek;

  get diagnostics v_updated = row_count;
  return jsonb_build_object(
    'success', true,
    'gameweek', p_gameweek,
    'fixtures_finalized', v_updated
  );
end;
$$;

revoke all on function public.finalize_gameweek_fixture_scores(integer)
  from public, anon, authenticated;
grant execute on function public.finalize_gameweek_fixture_scores(integer)
  to service_role;

create or replace function public.get_league_standings_v2(
  p_league_id uuid,
  p_gameweek integer,
  p_is_live boolean default false
)
returns table (
  rank bigint,
  user_id uuid,
  team_name text,
  played bigint,
  won bigint,
  drawn bigint,
  lost bigint,
  points bigint,
  total_h2h_score bigint,
  total_fpl_points bigint,
  total_defcon_points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with official_scores as (
    select
      fixture.id as fixture_id,
      fixture.gameweek,
      fixture.home_user_id,
      fixture.away_user_id,
      coalesce(fixture.home_score, 0)::integer as home_score,
      coalesce(fixture.home_fpl_points, 0)::integer as home_fpl_points,
      coalesce(fixture.home_defcon_points, 0)::integer as home_defcon_points,
      coalesce(fixture.away_score, 0)::integer as away_score,
      coalesce(fixture.away_fpl_points, 0)::integer as away_fpl_points,
      coalesce(fixture.away_defcon_points, 0)::integer as away_defcon_points
    from public.league_fixtures fixture
    where fixture.league_id = p_league_id
      and fixture.gameweek <= p_gameweek
      and coalesce(fixture.is_finished, false)
      and not (coalesce(p_is_live, false) and fixture.gameweek = p_gameweek)
  ),
  live_scores as (
    select
      scores.fixture_id,
      scores.gameweek,
      scores.home_user_id,
      scores.away_user_id,
      scores.home_score,
      scores.home_fpl_points,
      scores.home_defcon_points,
      scores.away_score,
      scores.away_fpl_points,
      scores.away_defcon_points
    from public.get_live_fixture_scores(p_gameweek) scores
    where coalesce(p_is_live, false)
      and scores.league_id = p_league_id
  ),
  fixture_scores as (
    select * from official_scores
    union all
    select * from live_scores
  ),
  manager_results as (
    select
      scores.home_user_id as user_id,
      scores.home_score as own_score,
      scores.home_fpl_points as own_fpl_points,
      scores.home_defcon_points as own_defcon_points,
      scores.away_score as opponent_score
    from fixture_scores scores

    union all

    select
      scores.away_user_id,
      scores.away_score,
      scores.away_fpl_points,
      scores.away_defcon_points,
      scores.home_score
    from fixture_scores scores
    where scores.away_user_id is not null
  ),
  totals as (
    select
      result.user_id,
      count(*)::bigint as played,
      count(*) filter (where result.own_score > result.opponent_score)::bigint as won,
      count(*) filter (where result.own_score = result.opponent_score)::bigint as drawn,
      count(*) filter (where result.own_score < result.opponent_score)::bigint as lost,
      sum(
        case
          when result.own_score > result.opponent_score then 3
          when result.own_score = result.opponent_score then 1
          else 0
        end
      )::bigint as points,
      sum(result.own_score)::bigint as total_h2h_score,
      sum(result.own_fpl_points)::bigint as total_fpl_points,
      sum(result.own_defcon_points)::bigint as total_defcon_points
    from manager_results result
    group by result.user_id
  ),
  ranked as (
    select
      member.user_id,
      coalesce(member.team_name, 'FC Manager') as team_name,
      coalesce(total.played, 0)::bigint as played,
      coalesce(total.won, 0)::bigint as won,
      coalesce(total.drawn, 0)::bigint as drawn,
      coalesce(total.lost, 0)::bigint as lost,
      coalesce(total.points, 0)::bigint as points,
      coalesce(total.total_h2h_score, 0)::bigint as total_h2h_score,
      coalesce(total.total_fpl_points, 0)::bigint as total_fpl_points,
      coalesce(total.total_defcon_points, 0)::bigint as total_defcon_points
    from public.league_members member
    left join totals total on total.user_id = member.user_id
    where member.league_id = p_league_id
  )
  select
    rank() over (
      order by ranked.points desc, ranked.total_h2h_score desc,
        ranked.total_fpl_points desc, ranked.team_name, ranked.user_id
    )::bigint,
    ranked.user_id,
    ranked.team_name,
    ranked.played,
    ranked.won,
    ranked.drawn,
    ranked.lost,
    ranked.points,
    ranked.total_h2h_score,
    ranked.total_fpl_points,
    ranked.total_defcon_points
  from ranked
  where exists (
    select 1 from public.league_members viewer
    where viewer.league_id = p_league_id
      and viewer.user_id = auth.uid()
  )
  or auth.role() = 'service_role'
  order by 1, ranked.team_name;
$$;

revoke all on function public.get_league_standings_v2(uuid, integer, boolean)
  from public, anon;
grant execute on function public.get_league_standings_v2(uuid, integer, boolean)
  to authenticated, service_role;

comment on function public.get_league_standings_v2(uuid, integer, boolean) is
  'League standings including explicit manager-versus-league-average fixtures. Exact equal scores are draws.';

-- Waiver priority is based on the completed league table after the opening
-- window. Retarget the existing hardened functions without copying their
-- transaction logic into this migration, so they include league-average
-- results while retaining every later waiver fix already applied.
do $$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.get_my_waiver_status(uuid)'::regprocedure,
    'public.process_league_waivers(uuid,integer)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_signature::oid) into v_definition;

    if position('public.get_league_standings_v2(' in v_definition) = 0 then
      if position('public.get_league_standings(' in v_definition) = 0 then
        raise exception 'WAIVER_STANDINGS_REFERENCE_NOT_FOUND:%', v_signature::text;
      end if;

      v_definition := replace(
        v_definition,
        'public.get_league_standings(',
        'public.get_league_standings_v2('
      );
      execute v_definition;
    end if;
  end loop;
end;
$$;
