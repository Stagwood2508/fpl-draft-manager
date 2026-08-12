-- An identical add/drop pairing is only a duplicate within one waiver window.
-- Managers must be able to submit the same pairing again in a later Gameweek.

alter table public.waiver_claims
  drop constraint if exists unique_user_waiver_swap;

create unique index if not exists unique_user_waiver_swap_gameweek
  on public.waiver_claims (
    league_id,
    user_id,
    player_to_add,
    player_to_drop,
    gameweek
  );
