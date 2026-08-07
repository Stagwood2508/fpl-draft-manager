-- Once a deadline snapshot exists, league members may view it for transparent live scoring.

drop policy if exists "League members can view deadline lineups" on public.gameweek_lineup_snapshots;
create policy "League members can view deadline lineups"
  on public.gameweek_lineup_snapshots for select to authenticated
  using (
    exists (
      select 1 from public.league_members member
      where member.league_id = gameweek_lineup_snapshots.league_id
        and member.user_id = auth.uid()
    )
  );
