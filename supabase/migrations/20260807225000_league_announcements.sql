create table if not exists public.league_announcements (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 80),
  body text not null check (char_length(trim(body)) between 1 and 1000),
  priority text not null default 'NORMAL' check (priority in ('NORMAL', 'URGENT')),
  is_pinned boolean not null default false,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint league_announcements_expiry_after_publication check (
    expires_at is null or expires_at > published_at
  )
);

create index if not exists league_announcements_home_idx
  on public.league_announcements (league_id, is_pinned desc, published_at desc);

alter table public.league_announcements enable row level security;

drop policy if exists "League members can read announcements" on public.league_announcements;
create policy "League members can read announcements"
  on public.league_announcements for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members member
      where member.league_id = league_announcements.league_id
        and member.user_id = auth.uid()
    )
  );

drop policy if exists "Commissioners can create announcements" on public.league_announcements;
create policy "Commissioners can create announcements"
  on public.league_announcements for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.leagues league
      where league.id = league_announcements.league_id
        and league.commissioner_id = auth.uid()
    )
  );

drop policy if exists "Commissioners can update announcements" on public.league_announcements;
create policy "Commissioners can update announcements"
  on public.league_announcements for update
  to authenticated
  using (
    exists (
      select 1 from public.leagues league
      where league.id = league_announcements.league_id
        and league.commissioner_id = auth.uid()
    )
  )
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.leagues league
      where league.id = league_announcements.league_id
        and league.commissioner_id = auth.uid()
    )
  );

drop policy if exists "Commissioners can delete announcements" on public.league_announcements;
create policy "Commissioners can delete announcements"
  on public.league_announcements for delete
  to authenticated
  using (
    exists (
      select 1 from public.leagues league
      where league.id = league_announcements.league_id
        and league.commissioner_id = auth.uid()
    )
  );

revoke all on table public.league_announcements from public, anon;
grant select, insert, update, delete on table public.league_announcements to authenticated;
