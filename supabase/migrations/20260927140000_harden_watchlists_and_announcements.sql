-- Watchlists stay browser-managed, but only within a league the manager
-- currently belongs to. Ordering remains an authenticated RPC-only action.
drop policy if exists "Allow authenticated user multi-league watchlist management" on public.watchlists;
drop policy if exists "Allow users to handle their own watchlists" on public.watchlists;

revoke all on table public.watchlists from public, anon;
revoke update on table public.watchlists from authenticated;
grant select, insert, delete on table public.watchlists to authenticated;

create policy watchlist_members_read
  on public.watchlists for select to authenticated
  using (user_id = auth.uid() and public.is_current_league_member(league_id));

create policy watchlist_members_insert
  on public.watchlists for insert to authenticated
  with check (user_id = auth.uid() and public.is_current_league_member(league_id));

create policy watchlist_members_delete
  on public.watchlists for delete to authenticated
  using (user_id = auth.uid() and public.is_current_league_member(league_id));

create or replace function public.reorder_watchlist(
  p_league_id uuid,
  p_player_ids integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if not public.is_current_league_member(p_league_id) then
    return jsonb_build_object('success', false, 'error', 'NOT_LEAGUE_MEMBER');
  end if;

  if cardinality(coalesce(p_player_ids, array[]::integer[]))
       <> (select count(distinct id) from unnest(coalesce(p_player_ids, array[]::integer[])) ids(id))
     or cardinality(coalesce(p_player_ids, array[]::integer[]))
       <> (select count(*) from public.watchlists where league_id = p_league_id and user_id = v_actor)
     or exists (
       select 1 from unnest(coalesce(p_player_ids, array[]::integer[])) ids(id)
       where not exists (
         select 1 from public.watchlists w
         where w.league_id = p_league_id and w.user_id = v_actor and w.player_id = ids.id
       )
     ) then
    return jsonb_build_object('success', false, 'error', 'WATCHLIST_MISMATCH');
  end if;

  update public.watchlists w
  set priority_order = ordered.ordinality
  from unnest(p_player_ids) with ordinality ordered(player_id, ordinality)
  where w.league_id = p_league_id and w.user_id = v_actor and w.player_id = ordered.player_id;

  return jsonb_build_object('success', true, 'player_ids', to_jsonb(p_player_ids));
end;
$$;

-- Announcements are commissioner actions. Their audit history intentionally
-- retains a snapshot even after the announcement itself is deleted.
create table if not exists public.league_announcement_audit (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  announcement_id uuid not null,
  actor_id uuid not null,
  action text not null check (action in ('CREATED', 'UPDATED', 'DELETED')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists league_announcement_audit_league_created_idx
  on public.league_announcement_audit (league_id, created_at desc);

alter table public.league_announcement_audit enable row level security;
revoke all on table public.league_announcement_audit from public, anon, authenticated;
grant select on table public.league_announcement_audit to authenticated;

create policy commissioners_read_announcement_audit
  on public.league_announcement_audit for select to authenticated
  using (exists (
    select 1 from public.leagues league
    where league.id = league_announcement_audit.league_id
      and league.commissioner_id = auth.uid()
  ));

drop policy if exists "Commissioners can create announcements" on public.league_announcements;
drop policy if exists "Commissioners can update announcements" on public.league_announcements;
drop policy if exists "Commissioners can delete announcements" on public.league_announcements;

revoke all on table public.league_announcements from public, anon;
revoke insert, update, delete on table public.league_announcements from authenticated;
grant select on table public.league_announcements to authenticated;

create or replace function public.save_league_announcement(
  p_league_id uuid,
  p_announcement_id uuid,
  p_title text,
  p_body text,
  p_priority text,
  p_is_pinned boolean,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_priority text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_priority, 'NORMAL')));
  v_now timestamptz := pg_catalog.now();
  v_before jsonb;
  v_after jsonb;
  v_announcement_id uuid;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if not exists (
    select 1 from public.leagues league
    where league.id = p_league_id and league.commissioner_id = v_actor_id
  ) then
    return jsonb_build_object('success', false, 'error', 'COMMISSIONER_REQUIRED');
  end if;

  if char_length(v_title) not between 1 and 80
     or char_length(v_body) not between 1 and 1000
     or v_priority not in ('NORMAL', 'URGENT')
     or (p_expires_at is not null and p_expires_at <= v_now) then
    return jsonb_build_object('success', false, 'error', 'INVALID_ANNOUNCEMENT');
  end if;

  if p_announcement_id is null then
    insert into public.league_announcements (
      league_id, author_id, title, body, priority, is_pinned, published_at, expires_at, updated_at
    ) values (
      p_league_id, v_actor_id, v_title, v_body, v_priority, coalesce(p_is_pinned, false), v_now, p_expires_at, v_now
    ) returning id into v_announcement_id;

    select to_jsonb(announcement) into v_after
    from public.league_announcements announcement
    where announcement.id = v_announcement_id;

    insert into public.league_announcement_audit (
      league_id, announcement_id, actor_id, action, after_data
    ) values (p_league_id, v_announcement_id, v_actor_id, 'CREATED', v_after);
  else
    select to_jsonb(announcement) into v_before
    from public.league_announcements announcement
    where announcement.id = p_announcement_id
      and announcement.league_id = p_league_id
      and announcement.author_id = v_actor_id
    for update;

    if not found then
      return jsonb_build_object('success', false, 'error', 'ANNOUNCEMENT_NOT_FOUND');
    end if;

    update public.league_announcements announcement
    set title = v_title,
        body = v_body,
        priority = v_priority,
        is_pinned = coalesce(p_is_pinned, false),
        published_at = v_now,
        expires_at = p_expires_at,
        updated_at = v_now
    where announcement.id = p_announcement_id
    returning id into v_announcement_id;

    select to_jsonb(announcement) into v_after
    from public.league_announcements announcement
    where announcement.id = v_announcement_id;

    insert into public.league_announcement_audit (
      league_id, announcement_id, actor_id, action, before_data, after_data
    ) values (p_league_id, v_announcement_id, v_actor_id, 'UPDATED', v_before, v_after);
  end if;

  return jsonb_build_object('success', true, 'announcement_id', v_announcement_id);
end;
$$;

create or replace function public.delete_league_announcement(
  p_league_id uuid,
  p_announcement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_before jsonb;
begin
  if v_actor_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if not exists (
    select 1 from public.leagues league
    where league.id = p_league_id and league.commissioner_id = v_actor_id
  ) then
    return jsonb_build_object('success', false, 'error', 'COMMISSIONER_REQUIRED');
  end if;

  select to_jsonb(announcement) into v_before
  from public.league_announcements announcement
  where announcement.id = p_announcement_id
    and announcement.league_id = p_league_id
    and announcement.author_id = v_actor_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'ANNOUNCEMENT_NOT_FOUND');
  end if;

  delete from public.league_announcements
  where id = p_announcement_id and league_id = p_league_id;

  insert into public.league_announcement_audit (
    league_id, announcement_id, actor_id, action, before_data
  ) values (p_league_id, p_announcement_id, v_actor_id, 'DELETED', v_before);

  return jsonb_build_object('success', true, 'announcement_id', p_announcement_id);
end;
$$;

revoke all on function public.save_league_announcement(uuid,uuid,text,text,text,boolean,timestamptz)
  from public, anon;
revoke all on function public.delete_league_announcement(uuid,uuid)
  from public, anon;
grant execute on function public.save_league_announcement(uuid,uuid,text,text,text,boolean,timestamptz)
  to authenticated, service_role;
grant execute on function public.delete_league_announcement(uuid,uuid)
  to authenticated, service_role;
