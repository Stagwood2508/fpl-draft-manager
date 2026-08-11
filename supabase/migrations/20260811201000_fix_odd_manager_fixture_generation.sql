-- Generate one round-robin fixture per available pairing. Odd-sized leagues
-- receive one rotating bye; no manager can appear twice in a gameweek.

create or replace function public.generate_league_fixtures(p_league_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rotation uuid[];
  v_next_rotation uuid[];
  v_count integer;
  v_rounds integer;
  v_matches_per_round integer;
  v_gameweek integer;
  v_round_index integer;
  v_cycle integer;
  v_pair integer;
  v_index integer;
  v_first uuid;
  v_second uuid;
  v_home uuid;
  v_away uuid;
  v_home_name text;
  v_away_name text;
  v_inserted integer := 0;
begin
  if not exists (
    select 1 from public.leagues l where l.id = p_league_id
  ) then
    return json_build_object('success', false, 'error', 'LEAGUE_NOT_FOUND');
  end if;

  select array_agg(lm.user_id order by lm.draft_order nulls last, lm.user_id)
  into v_rotation
  from public.league_members lm
  where lm.league_id = p_league_id;

  v_count := cardinality(coalesce(v_rotation, array[]::uuid[]));
  if v_count < 2 then
    return json_build_object('success', false, 'error', 'AT_LEAST_TWO_MANAGERS_REQUIRED');
  end if;

  if v_count % 2 = 1 then
    v_rotation := array_append(v_rotation, null::uuid);
    v_count := v_count + 1;
  end if;

  v_rounds := v_count - 1;
  v_matches_per_round := v_count / 2;

  delete from public.league_fixtures f where f.league_id = p_league_id;

  for v_gameweek in 1..38 loop
    v_round_index := (v_gameweek - 1) % v_rounds;
    v_cycle := (v_gameweek - 1) / v_rounds;

    for v_pair in 1..v_matches_per_round loop
      v_first := v_rotation[v_pair];
      v_second := v_rotation[v_count - v_pair + 1];

      if v_first is not null and v_second is not null then
        if (v_round_index + v_pair + v_cycle) % 2 = 0 then
          v_home := v_first;
          v_away := v_second;
        else
          v_home := v_second;
          v_away := v_first;
        end if;

        select coalesce(lm.team_name, 'FC Manager') into v_home_name
        from public.league_members lm
        where lm.league_id = p_league_id and lm.user_id = v_home;

        select coalesce(lm.team_name, 'FC Manager') into v_away_name
        from public.league_members lm
        where lm.league_id = p_league_id and lm.user_id = v_away;

        insert into public.league_fixtures (
          league_id, gameweek, home_user_id, away_user_id,
          home_team_name, away_team_name
        ) values (
          p_league_id, v_gameweek, v_home, v_away,
          v_home_name, v_away_name
        );
        v_inserted := v_inserted + 1;
      end if;
    end loop;

    -- Circle-method rotation: keep the first manager fixed, move the last
    -- slot into position two, and shift the remaining slots right.
    v_next_rotation := array[v_rotation[1], v_rotation[v_count]];
    if v_count > 2 then
      for v_index in 2..v_count - 1 loop
        v_next_rotation := array_append(v_next_rotation, v_rotation[v_index]);
      end loop;
    end if;
    v_rotation := v_next_rotation;
  end loop;

  return json_build_object(
    'success', true,
    'fixtures_created', v_inserted,
    'gameweeks', 38
  );
end;
$$;

revoke all on function public.generate_league_fixtures(uuid) from public, anon, authenticated;
grant execute on function public.generate_league_fixtures(uuid) to service_role;

comment on function public.generate_league_fixtures(uuid) is
  'Generates a 38-gameweek round robin with a rotating bye for odd-sized leagues.';
