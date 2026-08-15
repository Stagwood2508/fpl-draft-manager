-- Keep commissioner DEFCON settings and the scoring engine on one canonical
-- JSON shape. Older app builds wrote arrays while scoring expects tier_1 keys.

create or replace function public.normalise_defcon_tier_config(p_config jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_defaults constant jsonb := jsonb_build_object(
    'tier_1', jsonb_build_object('threshold', 4, 'points', 1),
    'tier_2', jsonb_build_object('threshold', 7, 'points', 2),
    'tier_3', jsonb_build_object('threshold', 10, 'points', 3)
  );
  v_result jsonb := '{}'::jsonb;
  v_tier jsonb;
  v_threshold integer;
  v_points integer;
  v_index integer;
begin
  for v_index in 1..3 loop
    v_tier := null;

    if jsonb_typeof(p_config) = 'object' then
      v_tier := p_config -> ('tier_' || v_index::text);
    elsif jsonb_typeof(p_config) = 'array' then
      select item.value - 'tier'
      into v_tier
      from jsonb_array_elements(p_config) as item(value)
      where item.value ->> 'tier' = v_index::text
      limit 1;
    end if;

    if jsonb_typeof(v_tier) <> 'object' or v_tier is null then
      v_tier := v_defaults -> ('tier_' || v_index::text);
    end if;

    begin
      v_threshold := (v_tier ->> 'threshold')::integer;
    exception when others then
      v_threshold := (v_defaults -> ('tier_' || v_index::text) ->> 'threshold')::integer;
    end;

    begin
      v_points := (v_tier ->> 'points')::integer;
    exception when others then
      v_points := (v_defaults -> ('tier_' || v_index::text) ->> 'points')::integer;
    end;

    if v_threshold < 0 or v_points < 0 then
      v_threshold := (v_defaults -> ('tier_' || v_index::text) ->> 'threshold')::integer;
      v_points := (v_defaults -> ('tier_' || v_index::text) ->> 'points')::integer;
    end if;

    v_result := v_result || jsonb_build_object(
      'tier_' || v_index::text,
      jsonb_build_object('threshold', v_threshold, 'points', v_points)
    );
  end loop;

  -- Invalid ordering is reset as a group so the highest-tier-first scoring
  -- calculation always has deterministic boundaries.
  if (v_result -> 'tier_2' ->> 'threshold')::integer
       <= (v_result -> 'tier_1' ->> 'threshold')::integer
     or (v_result -> 'tier_3' ->> 'threshold')::integer
       <= (v_result -> 'tier_2' ->> 'threshold')::integer then
    return v_defaults;
  end if;

  return v_result;
end;
$$;

update public.league_settings
set
  defcon_thresholds_def = public.normalise_defcon_tier_config(defcon_thresholds_def),
  defcon_thresholds_mid = public.normalise_defcon_tier_config(defcon_thresholds_mid),
  defcon_thresholds_fwd = public.normalise_defcon_tier_config(defcon_thresholds_fwd);

alter table public.league_settings
  alter column defcon_thresholds_def set default
    '{"tier_1":{"threshold":4,"points":1},"tier_2":{"threshold":7,"points":2},"tier_3":{"threshold":10,"points":3}}'::jsonb,
  alter column defcon_thresholds_mid set default
    '{"tier_1":{"threshold":4,"points":1},"tier_2":{"threshold":7,"points":2},"tier_3":{"threshold":10,"points":3}}'::jsonb,
  alter column defcon_thresholds_fwd set default
    '{"tier_1":{"threshold":4,"points":1},"tier_2":{"threshold":7,"points":2},"tier_3":{"threshold":10,"points":3}}'::jsonb,
  alter column defcon_thresholds_def set not null,
  alter column defcon_thresholds_mid set not null,
  alter column defcon_thresholds_fwd set not null;

alter table public.league_settings
  drop constraint if exists league_settings_defcon_def_shape_check,
  drop constraint if exists league_settings_defcon_mid_shape_check,
  drop constraint if exists league_settings_defcon_fwd_shape_check;

alter table public.league_settings
  add constraint league_settings_defcon_def_shape_check check (
    jsonb_typeof(defcon_thresholds_def) = 'object'
    and defcon_thresholds_def ?& array['tier_1', 'tier_2', 'tier_3']
    and (defcon_thresholds_def -> 'tier_1') ?& array['threshold', 'points']
    and (defcon_thresholds_def -> 'tier_2') ?& array['threshold', 'points']
    and (defcon_thresholds_def -> 'tier_3') ?& array['threshold', 'points']
    and jsonb_typeof(defcon_thresholds_def -> 'tier_1' -> 'threshold') = 'number'
    and jsonb_typeof(defcon_thresholds_def -> 'tier_1' -> 'points') = 'number'
    and jsonb_typeof(defcon_thresholds_def -> 'tier_2' -> 'threshold') = 'number'
    and jsonb_typeof(defcon_thresholds_def -> 'tier_2' -> 'points') = 'number'
    and jsonb_typeof(defcon_thresholds_def -> 'tier_3' -> 'threshold') = 'number'
    and jsonb_typeof(defcon_thresholds_def -> 'tier_3' -> 'points') = 'number'
    and (defcon_thresholds_def -> 'tier_1' ->> 'threshold')::integer
      < (defcon_thresholds_def -> 'tier_2' ->> 'threshold')::integer
    and (defcon_thresholds_def -> 'tier_2' ->> 'threshold')::integer
      < (defcon_thresholds_def -> 'tier_3' ->> 'threshold')::integer
  ),
  add constraint league_settings_defcon_mid_shape_check check (
    jsonb_typeof(defcon_thresholds_mid) = 'object'
    and defcon_thresholds_mid ?& array['tier_1', 'tier_2', 'tier_3']
    and (defcon_thresholds_mid -> 'tier_1') ?& array['threshold', 'points']
    and (defcon_thresholds_mid -> 'tier_2') ?& array['threshold', 'points']
    and (defcon_thresholds_mid -> 'tier_3') ?& array['threshold', 'points']
    and jsonb_typeof(defcon_thresholds_mid -> 'tier_1' -> 'threshold') = 'number'
    and jsonb_typeof(defcon_thresholds_mid -> 'tier_1' -> 'points') = 'number'
    and jsonb_typeof(defcon_thresholds_mid -> 'tier_2' -> 'threshold') = 'number'
    and jsonb_typeof(defcon_thresholds_mid -> 'tier_2' -> 'points') = 'number'
    and jsonb_typeof(defcon_thresholds_mid -> 'tier_3' -> 'threshold') = 'number'
    and jsonb_typeof(defcon_thresholds_mid -> 'tier_3' -> 'points') = 'number'
    and (defcon_thresholds_mid -> 'tier_1' ->> 'threshold')::integer
      < (defcon_thresholds_mid -> 'tier_2' ->> 'threshold')::integer
    and (defcon_thresholds_mid -> 'tier_2' ->> 'threshold')::integer
      < (defcon_thresholds_mid -> 'tier_3' ->> 'threshold')::integer
  ),
  add constraint league_settings_defcon_fwd_shape_check check (
    jsonb_typeof(defcon_thresholds_fwd) = 'object'
    and defcon_thresholds_fwd ?& array['tier_1', 'tier_2', 'tier_3']
    and (defcon_thresholds_fwd -> 'tier_1') ?& array['threshold', 'points']
    and (defcon_thresholds_fwd -> 'tier_2') ?& array['threshold', 'points']
    and (defcon_thresholds_fwd -> 'tier_3') ?& array['threshold', 'points']
    and jsonb_typeof(defcon_thresholds_fwd -> 'tier_1' -> 'threshold') = 'number'
    and jsonb_typeof(defcon_thresholds_fwd -> 'tier_1' -> 'points') = 'number'
    and jsonb_typeof(defcon_thresholds_fwd -> 'tier_2' -> 'threshold') = 'number'
    and jsonb_typeof(defcon_thresholds_fwd -> 'tier_2' -> 'points') = 'number'
    and jsonb_typeof(defcon_thresholds_fwd -> 'tier_3' -> 'threshold') = 'number'
    and jsonb_typeof(defcon_thresholds_fwd -> 'tier_3' -> 'points') = 'number'
    and (defcon_thresholds_fwd -> 'tier_1' ->> 'threshold')::integer
      < (defcon_thresholds_fwd -> 'tier_2' ->> 'threshold')::integer
    and (defcon_thresholds_fwd -> 'tier_2' ->> 'threshold')::integer
      < (defcon_thresholds_fwd -> 'tier_3' ->> 'threshold')::integer
  );

drop function public.normalise_defcon_tier_config(jsonb);

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
  with tier_config as (
    select case
      when upper(coalesce(p_position, '')) in ('2', 'DEF') then coalesce(settings.defcon_thresholds_def,
        '{"tier_1":{"threshold":4,"points":1},"tier_2":{"threshold":7,"points":2},"tier_3":{"threshold":10,"points":3}}'::jsonb)
      when upper(coalesce(p_position, '')) in ('3', 'MID') then coalesce(settings.defcon_thresholds_mid,
        '{"tier_1":{"threshold":4,"points":1},"tier_2":{"threshold":7,"points":2},"tier_3":{"threshold":10,"points":3}}'::jsonb)
      when upper(coalesce(p_position, '')) in ('4', 'FWD') then coalesce(settings.defcon_thresholds_fwd,
        '{"tier_1":{"threshold":4,"points":1},"tier_2":{"threshold":7,"points":2},"tier_3":{"threshold":10,"points":3}}'::jsonb)
      else '{}'::jsonb
    end as tiers
    from (select 1) seed
    left join public.league_settings settings on settings.league_id = p_league_id
  )
  select case
    when upper(coalesce(p_position, '')) not in ('2', 'DEF', '3', 'MID', '4', 'FWD') then 0
    when coalesce(p_defensive_contribution, 0) >= (tiers -> 'tier_3' ->> 'threshold')::integer
      then (tiers -> 'tier_3' ->> 'points')::integer
    when coalesce(p_defensive_contribution, 0) >= (tiers -> 'tier_2' ->> 'threshold')::integer
      then (tiers -> 'tier_2' ->> 'points')::integer
    when coalesce(p_defensive_contribution, 0) >= (tiers -> 'tier_1' ->> 'threshold')::integer
      then (tiers -> 'tier_1' ->> 'points')::integer
    else 0
  end
  from tier_config;
$$;

revoke all on function public.calculate_player_defcon_points(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.calculate_player_defcon_points(uuid, text, integer)
  to service_role;

comment on function public.calculate_player_defcon_points(uuid, text, integer) is
  'Awards the points from the highest configured DEFCON tier reached for the player position; goalkeepers are ineligible.';
