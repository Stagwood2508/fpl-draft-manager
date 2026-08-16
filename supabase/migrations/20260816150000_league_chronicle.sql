-- Deterministic, league-scoped Gameweek stories generated only from finalized data.

create table if not exists public.league_chronicles (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  gameweek integer not null check (gameweek between 1 and 38),
  title text not null,
  summary text not null,
  featured_fixture jsonb not null default '{}'::jsonb,
  highlights jsonb not null default '[]'::jsonb,
  table_movements jsonb not null default '[]'::jsonb,
  sliding_doors jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, gameweek)
);

create index if not exists league_chronicles_archive_idx
  on public.league_chronicles (league_id, gameweek desc);

alter table public.league_chronicles enable row level security;

drop policy if exists "League members can read chronicles" on public.league_chronicles;
create policy "League members can read chronicles"
  on public.league_chronicles for select to authenticated
  using (
    exists (
      select 1 from public.league_members member
      where member.league_id = league_chronicles.league_id
        and member.user_id = auth.uid()
    )
  );

revoke all on table public.league_chronicles from public, anon;
grant select on table public.league_chronicles to authenticated;

create or replace function public.generate_league_chronicle(
  p_league_id uuid,
  p_gameweek integer,
  p_force boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chronicle_id uuid;
  v_fixture public.league_fixtures%rowtype;
  v_manager record;
  v_biggest record;
  v_closest record;
  v_bench record;
  v_upset record;
  v_title text;
  v_summary text;
  v_featured jsonb := '{}'::jsonb;
  v_highlights jsonb := '[]'::jsonb;
  v_movements jsonb := '[]'::jsonb;
  v_sliding jsonb := '{}'::jsonb;
begin
  if p_gameweek not between 1 and 38 then
    raise exception 'Gameweek must be between 1 and 38';
  end if;

  if not exists (
    select 1 from public.league_fixtures fixture
    where fixture.league_id = p_league_id and fixture.gameweek = p_gameweek
  ) or exists (
    select 1 from public.league_fixtures fixture
    where fixture.league_id = p_league_id
      and fixture.gameweek = p_gameweek
      and not coalesce(fixture.is_finished, false)
  ) then
    raise exception 'Chronicle generation requires a fully finalized Gameweek';
  end if;

  if not p_force then
    select chronicle.id into v_chronicle_id
    from public.league_chronicles chronicle
    where chronicle.league_id = p_league_id and chronicle.gameweek = p_gameweek;
    if v_chronicle_id is not null then return v_chronicle_id; end if;
  end if;

  select fixture.* into v_fixture
  from public.league_fixtures fixture
  where fixture.league_id = p_league_id and fixture.gameweek = p_gameweek
  order by greatest(coalesce(fixture.home_score, 0), coalesce(fixture.away_score, 0)) desc,
           (coalesce(fixture.home_score, 0) + coalesce(fixture.away_score, 0)) desc,
           fixture.id
  limit 1;

  if coalesce(v_fixture.home_score, 0) > coalesce(v_fixture.away_score, 0) then
    v_title := coalesce(v_fixture.home_team_name, 'The home side') || ' lead the GW' || p_gameweek || ' headlines';
    v_summary := coalesce(v_fixture.home_team_name, 'The home side') || ' beat ' || coalesce(v_fixture.away_team_name, 'League Average') ||
      ' ' || coalesce(v_fixture.home_score, 0) || '–' || coalesce(v_fixture.away_score, 0) || ' in the featured fixture.';
  elsif coalesce(v_fixture.away_score, 0) > coalesce(v_fixture.home_score, 0) then
    v_title := coalesce(v_fixture.away_team_name, 'League Average') || ' lead the GW' || p_gameweek || ' headlines';
    v_summary := coalesce(v_fixture.away_team_name, 'League Average') || ' beat ' || coalesce(v_fixture.home_team_name, 'The home side') ||
      ' ' || coalesce(v_fixture.away_score, 0) || '–' || coalesce(v_fixture.home_score, 0) || ' in the featured fixture.';
  else
    v_title := 'Nothing separates the headline acts in GW' || p_gameweek;
    v_summary := coalesce(v_fixture.home_team_name, 'The home side') || ' and ' || coalesce(v_fixture.away_team_name, 'League Average') ||
      ' finished level at ' || coalesce(v_fixture.home_score, 0) || '–' || coalesce(v_fixture.away_score, 0) || '.';
  end if;

  v_featured := jsonb_build_object(
    'fixture_id', v_fixture.id,
    'home_user_id', v_fixture.home_user_id,
    'away_user_id', v_fixture.away_user_id,
    'home_team_name', coalesce(v_fixture.home_team_name, 'Home'),
    'away_team_name', coalesce(v_fixture.away_team_name, 'League Average'),
    'home_score', coalesce(v_fixture.home_score, 0),
    'away_score', coalesce(v_fixture.away_score, 0),
    'is_league_average', coalesce(v_fixture.is_league_average, false)
  );

  with scores as (
    select fixture.home_user_id as user_id, fixture.home_team_name as team_name, coalesce(fixture.home_score, 0)::integer as score
    from public.league_fixtures fixture where fixture.league_id = p_league_id and fixture.gameweek = p_gameweek
    union all
    select fixture.away_user_id, fixture.away_team_name, coalesce(fixture.away_score, 0)::integer
    from public.league_fixtures fixture
    where fixture.league_id = p_league_id and fixture.gameweek = p_gameweek and fixture.away_user_id is not null
  )
  select scores.* into v_manager from scores order by score desc, team_name limit 1;

  select fixture.*,
         abs(coalesce(fixture.home_score, 0) - coalesce(fixture.away_score, 0))::integer as margin,
         case when coalesce(fixture.home_score, 0) >= coalesce(fixture.away_score, 0) then fixture.home_team_name else fixture.away_team_name end as winner_name
    into v_biggest
  from public.league_fixtures fixture
  where fixture.league_id = p_league_id and fixture.gameweek = p_gameweek
  order by margin desc, fixture.id limit 1;

  select fixture.*,
         abs(coalesce(fixture.home_score, 0) - coalesce(fixture.away_score, 0))::integer as margin
    into v_closest
  from public.league_fixtures fixture
  where fixture.league_id = p_league_id and fixture.gameweek = p_gameweek
  order by margin asc, fixture.id limit 1;

  with bench_scores as (
    select snapshot.user_id,
           member.team_name,
           sum(coalesce(stats.total_points, 0) + public.calculate_player_defcon_points(
             p_league_id, player.element_type::text, coalesce(stats.defensive_contribution, 0)::integer
           ))::integer as points
    from public.gameweek_lineup_snapshots snapshot
    join public.league_members member on member.league_id = snapshot.league_id and member.user_id = snapshot.user_id
    cross join lateral unnest(snapshot.effective_bench_player_ids) bench(player_id)
    join public.players player on player.id = bench.player_id
    left join public.player_gameweek_stats stats on stats.player_id = bench.player_id and stats.gameweek = snapshot.gameweek
    where snapshot.league_id = p_league_id and snapshot.gameweek = p_gameweek
    group by snapshot.user_id, member.team_name
  )
  select * into v_bench from bench_scores order by points desc, team_name limit 1;

  v_highlights := jsonb_build_array(
    jsonb_build_object('type', 'MANAGER', 'label', 'MANAGER OF THE WEEK', 'title', coalesce(v_manager.team_name, 'Manager'), 'value', coalesce(v_manager.score, 0) || ' pts', 'icon', 'trophy'),
    jsonb_build_object('type', 'MARGIN', 'label', 'BIGGEST WIN', 'title', coalesce(v_biggest.winner_name, 'Level contest'), 'value', coalesce(v_biggest.margin, 0) || ' pts', 'icon', 'trending-up'),
    jsonb_build_object('type', 'BENCH', 'label', 'BENCH HEARTBREAK', 'title', coalesce(v_bench.team_name, 'No bench data'), 'value', coalesce(v_bench.points, 0) || ' pts', 'icon', 'sad')
  );

  with results as (
    select fixture.gameweek, fixture.home_user_id as user_id, coalesce(fixture.home_score, 0)::integer as score,
      case when fixture.home_score > fixture.away_score then 3 when fixture.home_score = fixture.away_score then 1 else 0 end as league_points
    from public.league_fixtures fixture
    where fixture.league_id = p_league_id and fixture.gameweek <= p_gameweek
    union all
    select fixture.gameweek, fixture.away_user_id, coalesce(fixture.away_score, 0)::integer,
      case when fixture.away_score > fixture.home_score then 3 when fixture.away_score = fixture.home_score then 1 else 0 end
    from public.league_fixtures fixture
    where fixture.league_id = p_league_id and fixture.gameweek <= p_gameweek and fixture.away_user_id is not null
  ), totals as (
    select member.user_id, member.team_name,
      coalesce(sum(results.league_points) filter (where results.gameweek <= p_gameweek), 0) as current_lp,
      coalesce(sum(results.score) filter (where results.gameweek <= p_gameweek), 0) as current_pf,
      coalesce(sum(results.league_points) filter (where results.gameweek < p_gameweek), 0) as previous_lp,
      coalesce(sum(results.score) filter (where results.gameweek < p_gameweek), 0) as previous_pf
    from public.league_members member left join results on results.user_id = member.user_id
    where member.league_id = p_league_id group by member.user_id, member.team_name
  ), ranked as (
    select totals.*,
      row_number() over (order by current_lp desc, current_pf desc, team_name, user_id)::integer as current_rank,
      row_number() over (order by previous_lp desc, previous_pf desc, team_name, user_id)::integer as previous_rank
    from totals
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', ranked.user_id, 'team_name', ranked.team_name,
    'current_rank', ranked.current_rank, 'previous_rank', ranked.previous_rank,
    'change', ranked.previous_rank - ranked.current_rank
  ) order by abs(ranked.previous_rank - ranked.current_rank) desc, ranked.current_rank), '[]'::jsonb)
  into v_movements from ranked;

  if p_gameweek > 1 then
    with prior_results as (
      select fixture.home_user_id as user_id, coalesce(fixture.home_score, 0)::integer as score,
        case when fixture.home_score > fixture.away_score then 3 when fixture.home_score = fixture.away_score then 1 else 0 end as league_points
      from public.league_fixtures fixture where fixture.league_id = p_league_id and fixture.gameweek < p_gameweek
      union all
      select fixture.away_user_id, coalesce(fixture.away_score, 0)::integer,
        case when fixture.away_score > fixture.home_score then 3 when fixture.away_score = fixture.home_score then 1 else 0 end
      from public.league_fixtures fixture where fixture.league_id = p_league_id and fixture.gameweek < p_gameweek and fixture.away_user_id is not null
    ), prior_ranks as (
      select member.user_id, member.team_name,
        row_number() over (order by coalesce(sum(prior.league_points), 0) desc, coalesce(sum(prior.score), 0) desc, member.team_name)::integer as rank
      from public.league_members member left join prior_results prior on prior.user_id = member.user_id
      where member.league_id = p_league_id group by member.user_id, member.team_name
    ), upsets as (
      select fixture.id,
        case when fixture.home_score > fixture.away_score then fixture.home_team_name else fixture.away_team_name end as winner_name,
        case when fixture.home_score > fixture.away_score then home_rank.rank else away_rank.rank end as winner_rank,
        case when fixture.home_score > fixture.away_score then away_rank.rank else home_rank.rank end as loser_rank
      from public.league_fixtures fixture
      left join prior_ranks home_rank on home_rank.user_id = fixture.home_user_id
      left join prior_ranks away_rank on away_rank.user_id = fixture.away_user_id
      where fixture.league_id = p_league_id and fixture.gameweek = p_gameweek
        and fixture.away_user_id is not null and fixture.home_score <> fixture.away_score
    )
    select * into v_upset from upsets where winner_rank > loser_rank order by winner_rank - loser_rank desc limit 1;
  end if;

  if v_upset.id is not null then
    v_highlights := v_highlights || jsonb_build_array(jsonb_build_object(
      'type', 'UPSET', 'label', 'UPSET OF THE WEEK', 'title', v_upset.winner_name,
      'value', 'Beat a side ' || (v_upset.winner_rank - v_upset.loser_rank) || ' places higher', 'icon', 'flash'
    ));
  end if;

  v_sliding := jsonb_build_object(
    'fixture_id', v_closest.id,
    'title', case when v_closest.margin = 0 then 'Nothing could split them' else 'One moment changed the result' end,
    'body', case when v_closest.margin = 0
      then coalesce(v_closest.home_team_name, 'Home') || ' and ' || coalesce(v_closest.away_team_name, 'League Average') || ' shared the points.'
      else coalesce(v_closest.home_team_name, 'Home') || ' and ' || coalesce(v_closest.away_team_name, 'League Average') || ' were separated by only ' || v_closest.margin || ' point' || case when v_closest.margin = 1 then '' else 's' end || '.' end,
    'margin', v_closest.margin
  );

  insert into public.league_chronicles (
    league_id, gameweek, title, summary, featured_fixture, highlights, table_movements, sliding_doors, published_at, updated_at
  ) values (
    p_league_id, p_gameweek, v_title, v_summary, v_featured, v_highlights, v_movements, v_sliding, now(), now()
  )
  on conflict (league_id, gameweek) do update set
    title = excluded.title, summary = excluded.summary, featured_fixture = excluded.featured_fixture,
    highlights = excluded.highlights, table_movements = excluded.table_movements,
    sliding_doors = excluded.sliding_doors, published_at = excluded.published_at, updated_at = now()
  returning id into v_chronicle_id;

  insert into public.user_notifications (user_id, league_id, category, title, body, route, dedupe_key)
  select member.user_id, p_league_id, 'MATCH', 'The GW' || p_gameweek || ' Chronicle is ready', v_title,
    '/league-chronicle?leagueId=' || p_league_id || '&gameweek=' || p_gameweek,
    'chronicle:' || p_league_id || ':' || p_gameweek
  from public.league_members member
  left join public.notification_preferences preference on preference.user_id = member.user_id
  where member.league_id = p_league_id and coalesce(preference.match_updates_enabled, true)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;

  return v_chronicle_id;
end;
$$;

revoke all on function public.generate_league_chronicle(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.generate_league_chronicle(uuid, integer, boolean) to service_role;

create or replace function public.maybe_generate_league_chronicle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_finished, false)
     and not coalesce(old.is_finished, false)
     and not exists (
       select 1 from public.league_fixtures fixture
       where fixture.league_id = new.league_id and fixture.gameweek = new.gameweek
         and not coalesce(fixture.is_finished, false)
     ) then
    perform public.generate_league_chronicle(new.league_id, new.gameweek, false);
  end if;
  return new;
end;
$$;

drop trigger if exists league_fixture_chronicle_generation on public.league_fixtures;
create trigger league_fixture_chronicle_generation
  after update of is_finished on public.league_fixtures
  for each row execute function public.maybe_generate_league_chronicle();

-- Backfill already-completed Gameweeks. Failures are isolated so a partial historical
-- dataset cannot block deployment; the live trigger will cover future editions.
do $$
declare v_gameweek record;
begin
  for v_gameweek in
    select fixture.league_id, fixture.gameweek
    from public.league_fixtures fixture
    group by fixture.league_id, fixture.gameweek
    having bool_and(coalesce(fixture.is_finished, false))
  loop
    begin
      perform public.generate_league_chronicle(v_gameweek.league_id, v_gameweek.gameweek, false);
    exception when others then
      raise warning 'Chronicle backfill skipped for league %, GW%: %', v_gameweek.league_id, v_gameweek.gameweek, sqlerrm;
    end;
  end loop;
end;
$$;

