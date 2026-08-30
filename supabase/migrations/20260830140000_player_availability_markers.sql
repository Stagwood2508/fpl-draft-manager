-- Persist the official FPL availability fields used by squad and player cards.

alter table public.players
  add column if not exists status text not null default 'a',
  add column if not exists news text not null default '',
  add column if not exists chance_of_playing_this_round integer,
  add column if not exists chance_of_playing_next_round integer,
  add column if not exists news_added timestamptz;

alter table public.players
  drop constraint if exists players_chance_this_round_check,
  drop constraint if exists players_chance_next_round_check;

alter table public.players
  add constraint players_chance_this_round_check
    check (chance_of_playing_this_round is null or chance_of_playing_this_round between 0 and 100),
  add constraint players_chance_next_round_check
    check (chance_of_playing_next_round is null or chance_of_playing_next_round between 0 and 100);

comment on column public.players.status is
  'Official FPL availability code: a available, d doubtful, i injured, s suspended, n/u unavailable.';
comment on column public.players.news is
  'Official FPL player availability explanation.';

