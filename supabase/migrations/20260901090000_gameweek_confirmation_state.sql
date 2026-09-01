alter table public.fixtures
  add column if not exists is_finished_provisional boolean not null default false;

comment on column public.fixtures.is_finished_provisional is
  'True once the Premier League fixture has ended provisionally, before FPL finalises the Gameweek.';

