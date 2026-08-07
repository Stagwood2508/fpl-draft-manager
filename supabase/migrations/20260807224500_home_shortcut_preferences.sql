create table if not exists public.home_shortcut_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  shortcut_ids text[] not null default array[
    'trade_offers',
    'live_matches',
    'waivers',
    'transaction_history'
  ]::text[],
  updated_at timestamptz not null default now(),
  constraint home_shortcut_preferences_four_items check (cardinality(shortcut_ids) = 4),
  constraint home_shortcut_preferences_known_items check (
    shortcut_ids <@ array[
      'trade_offers',
      'live_matches',
      'waivers',
      'transaction_history',
      'watchlist',
      'scout_players',
      'league_table',
      'my_squad'
    ]::text[]
  )
);

alter table public.home_shortcut_preferences enable row level security;

drop policy if exists "Managers can read their home shortcuts" on public.home_shortcut_preferences;
create policy "Managers can read their home shortcuts"
  on public.home_shortcut_preferences for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Managers can create their home shortcuts" on public.home_shortcut_preferences;
create policy "Managers can create their home shortcuts"
  on public.home_shortcut_preferences for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Managers can update their home shortcuts" on public.home_shortcut_preferences;
create policy "Managers can update their home shortcuts"
  on public.home_shortcut_preferences for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on table public.home_shortcut_preferences from public, anon;
grant select, insert, update on table public.home_shortcut_preferences to authenticated;
