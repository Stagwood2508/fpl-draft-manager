-- Manager actions are already performed by checked RPCs. Remove the legacy
-- browser table-write paths that could bypass deadlines, roster validation,
-- trade state transitions, and league-capacity checks.

-- Joining must go through join_league_with_validation(), which validates the
-- league state, capacity, and team-name rules atomically.
drop policy if exists "Users can join leagues" on public.league_members;

-- Lineup, transfer-listing, free-agent, waiver, and trade functions are the
-- only allowed mutation paths for these server-owned records.
drop policy if exists "Managers can insert into their own roster" on public.rosters;
drop policy if exists "Users can update their own roster slots" on public.rosters;

drop policy if exists "Users can insert their own waiver claims" on public.waiver_claims;
drop policy if exists "Users can update their own waiver claims" on public.waiver_claims;
drop policy if exists "Users can delete their own waiver claims" on public.waiver_claims;

drop policy if exists "Allow players involved to update transaction statuses" on public.transactions;
drop policy if exists "Allow users to insert their own transactions" on public.transactions;
drop policy if exists "Enable insert for authenticated users" on public.transactions;

revoke insert, update, delete on table
  public.league_members,
  public.rosters,
  public.waiver_claims,
  public.transactions
from public, anon, authenticated;
