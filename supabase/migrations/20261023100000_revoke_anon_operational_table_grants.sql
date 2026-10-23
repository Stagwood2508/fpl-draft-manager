-- Anonymous visitors never need direct access to league, draft, waiver, trade
-- or audit data. RLS remains enabled as a second guard, but removing these
-- grants makes the database deny access by default before policy evaluation.

revoke all on table
  public.cup_audit_log,
  public.cup_configurations,
  public.cup_entries,
  public.cup_fixtures,
  public.cup_rounds,
  public.cups,
  public.draft_autopick_debug,
  public.draft_manager_autopick_state,
  public.draft_pick_audit,
  public.draft_room_readiness,
  public.free_agent_transactions,
  public.gameweek_autosub_audit,
  public.gameweek_lineup_snapshots,
  public.gameweeks,
  public.league_waiver_priorities,
  public.lineup_change_audit,
  public.player_position_overrides,
  public.player_season_stats,
  public.trade_package_audit,
  public.transactions,
  public.waiver_claims,
  public.waiver_player_locks
from anon;
