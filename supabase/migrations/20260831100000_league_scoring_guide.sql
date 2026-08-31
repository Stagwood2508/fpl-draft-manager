-- A member-readable, league-scoped scoring guide. The function deliberately
-- exposes scoring configuration only after checking active league membership.

create or replace function public.get_league_scoring_guide(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.role() <> 'service_role' and not exists (
    select 1
    from public.league_members member
    where member.league_id = p_league_id
      and member.user_id = auth.uid()
  ) then
    raise exception 'LEAGUE_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;

  select pg_catalog.jsonb_build_object(
    'success', true,
    'league_id', league.id,
    'league_name', league.name,
    'points_goal_fwd', coalesce(settings.points_goal_fwd, 4),
    'points_goal_mid', coalesce(settings.points_goal_mid, 5),
    'points_goal_def', coalesce(settings.points_goal_def, 6),
    'points_assist', coalesce(settings.points_assist, 3),
    'points_clean_sheet_def', coalesce(settings.points_clean_sheet_def, 4),
    'points_clean_sheet_mid', coalesce(settings.points_clean_sheet_mid, 1),
    'points_yellow_card', coalesce(settings.points_yellow_card, -1),
    'points_red_card', coalesce(settings.points_red_card, -3),
    'points_own_goal', coalesce(settings.points_own_goal, -2),
    'points_penalty_save', coalesce(settings.points_penalty_save, 5),
    'points_penalty_miss', coalesce(settings.points_penalty_miss, -2),
    'defcon_thresholds_def', coalesce(settings.defcon_thresholds_def,
      '{"tier_1":{"threshold":4,"points":1},"tier_2":{"threshold":7,"points":2},"tier_3":{"threshold":10,"points":3}}'::jsonb),
    'defcon_thresholds_mid', coalesce(settings.defcon_thresholds_mid,
      '{"tier_1":{"threshold":4,"points":1},"tier_2":{"threshold":7,"points":2},"tier_3":{"threshold":10,"points":3}}'::jsonb),
    'defcon_thresholds_fwd', coalesce(settings.defcon_thresholds_fwd,
      '{"tier_1":{"threshold":4,"points":1},"tier_2":{"threshold":7,"points":2},"tier_3":{"threshold":10,"points":3}}'::jsonb)
  )
  into v_result
  from public.leagues league
  left join public.league_settings settings on settings.league_id = league.id
  where league.id = p_league_id;

  if v_result is null then
    raise exception 'LEAGUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_league_scoring_guide(uuid)
  from public, anon;
grant execute on function public.get_league_scoring_guide(uuid)
  to authenticated, service_role;

comment on function public.get_league_scoring_guide(uuid) is
  'Returns the selected league custom point values and all three DEFCON tiers to authenticated league members.';

