-- A lightweight, league-scoped social lounge. Messages remain private to
-- league members, while commissioner moderation and user safety controls are
-- enforced in the database rather than trusted to the client.

alter table public.home_shortcut_preferences
  drop constraint if exists home_shortcut_preferences_known_items;
alter table public.home_shortcut_preferences
  add constraint home_shortcut_preferences_known_items check (
    shortcut_ids <@ array[
      'trade_offers', 'live_matches', 'waivers', 'transaction_history',
      'watchlist', 'scout_players', 'league_table', 'my_squad', 'league_lounge'
    ]::text[]
  );

create table if not exists public.league_lounge_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  is_pinned boolean not null default false,
  pinned_at timestamptz,
  pinned_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lounge_pin_state_consistent check (
    (is_pinned and pinned_at is not null and pinned_by is not null)
    or (not is_pinned and pinned_at is null and pinned_by is null)
  )
);

create index if not exists league_lounge_messages_feed_idx
  on public.league_lounge_messages (league_id, created_at desc);
create index if not exists league_lounge_messages_pinned_idx
  on public.league_lounge_messages (league_id, pinned_at desc)
  where is_pinned and deleted_at is null;

create table if not exists public.league_lounge_reactions (
  message_id uuid not null references public.league_lounge_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '😂', '⚽')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.league_lounge_reads (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists public.league_lounge_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.league_lounge_messages(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  status text not null default 'OPEN' check (status in ('OPEN', 'REVIEWED', 'DISMISSED', 'ACTIONED')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique (message_id, reporter_id)
);

create table if not exists public.league_lounge_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  constraint lounge_cannot_block_self check (blocker_id <> blocked_user_id)
);

create table if not exists public.league_lounge_policy_acceptances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  policy_version text not null,
  accepted_at timestamptz not null default now()
);

alter table public.league_lounge_messages enable row level security;
alter table public.league_lounge_reactions enable row level security;
alter table public.league_lounge_reads enable row level security;
alter table public.league_lounge_reports enable row level security;
alter table public.league_lounge_blocks enable row level security;
alter table public.league_lounge_policy_acceptances enable row level security;

drop policy if exists lounge_members_read_messages on public.league_lounge_messages;
create policy lounge_members_read_messages
  on public.league_lounge_messages for select to authenticated
  using (
    exists (
      select 1 from public.league_members member
      where member.league_id = league_lounge_messages.league_id
        and member.user_id = auth.uid()
    )
    and not exists (
      select 1 from public.league_lounge_blocks block
      where block.blocker_id = auth.uid()
        and block.blocked_user_id = league_lounge_messages.author_id
    )
  );

drop policy if exists lounge_members_create_messages on public.league_lounge_messages;
create policy lounge_members_create_messages
  on public.league_lounge_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and not is_pinned
    and pinned_at is null
    and pinned_by is null
    and deleted_at is null
    and deleted_by is null
    and exists (
      select 1 from public.league_members member
      where member.league_id = league_lounge_messages.league_id
        and member.user_id = auth.uid()
    )
  );

drop policy if exists lounge_members_read_reactions on public.league_lounge_reactions;
create policy lounge_members_read_reactions
  on public.league_lounge_reactions for select to authenticated
  using (
    exists (
      select 1
      from public.league_lounge_messages message
      join public.league_members member on member.league_id = message.league_id
      where message.id = league_lounge_reactions.message_id
        and member.user_id = auth.uid()
    )
  );

drop policy if exists lounge_members_add_reactions on public.league_lounge_reactions;
create policy lounge_members_add_reactions
  on public.league_lounge_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.league_lounge_messages message
      join public.league_members member on member.league_id = message.league_id
      where message.id = league_lounge_reactions.message_id
        and message.deleted_at is null
        and member.user_id = auth.uid()
    )
  );

drop policy if exists lounge_members_remove_own_reactions on public.league_lounge_reactions;
create policy lounge_members_remove_own_reactions
  on public.league_lounge_reactions for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists lounge_members_manage_own_reads on public.league_lounge_reads;
create policy lounge_members_manage_own_reads
  on public.league_lounge_reads for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.league_members member
      where member.league_id = league_lounge_reads.league_id
        and member.user_id = auth.uid()
    )
  );

drop policy if exists lounge_members_create_reports on public.league_lounge_reports;
create policy lounge_members_create_reports
  on public.league_lounge_reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and exists (
      select 1
      from public.league_lounge_messages message
      join public.league_members member on member.league_id = message.league_id
      where message.id = league_lounge_reports.message_id
        and message.league_id = league_lounge_reports.league_id
        and message.author_id <> auth.uid()
        and member.user_id = auth.uid()
    )
  );

drop policy if exists lounge_reports_visible_to_reporter_or_commissioner on public.league_lounge_reports;
create policy lounge_reports_visible_to_reporter_or_commissioner
  on public.league_lounge_reports for select to authenticated
  using (
    reporter_id = auth.uid()
    or exists (
      select 1 from public.leagues league
      where league.id = league_lounge_reports.league_id
        and league.commissioner_id = auth.uid()
    )
  );

drop policy if exists lounge_users_manage_own_blocks on public.league_lounge_blocks;
create policy lounge_users_manage_own_blocks
  on public.league_lounge_blocks for all to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

drop policy if exists lounge_users_manage_own_policy_acceptance on public.league_lounge_policy_acceptances;
create policy lounge_users_manage_own_policy_acceptance
  on public.league_lounge_policy_acceptances for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.league_lounge_messages from public, anon, authenticated;
revoke all on table public.league_lounge_reactions from public, anon, authenticated;
revoke all on table public.league_lounge_reads from public, anon, authenticated;
revoke all on table public.league_lounge_reports from public, anon, authenticated;
revoke all on table public.league_lounge_blocks from public, anon, authenticated;
revoke all on table public.league_lounge_policy_acceptances from public, anon, authenticated;

grant select, insert on table public.league_lounge_messages to authenticated;
grant select, insert, delete on table public.league_lounge_reactions to authenticated;
grant select, insert, update, delete on table public.league_lounge_reads to authenticated;
grant select, insert on table public.league_lounge_reports to authenticated;
grant select, insert, delete on table public.league_lounge_blocks to authenticated;
grant select, insert, update on table public.league_lounge_policy_acceptances to authenticated;

create or replace function public.set_lounge_message_pinned(
  p_message_id uuid,
  p_pinned boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_league_id uuid;
begin
  select message.league_id into v_league_id
  from public.league_lounge_messages message
  where message.id = p_message_id and message.deleted_at is null;

  if v_league_id is null then
    return jsonb_build_object('success', false, 'error', 'MESSAGE_NOT_FOUND');
  end if;
  if not exists (
    select 1 from public.leagues league
    where league.id = v_league_id and league.commissioner_id = auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'COMMISSIONER_REQUIRED');
  end if;

  update public.league_lounge_messages
  set is_pinned = p_pinned,
      pinned_at = case when p_pinned then now() else null end,
      pinned_by = case when p_pinned then auth.uid() else null end,
      updated_at = now()
  where id = p_message_id;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.remove_lounge_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_message public.league_lounge_messages%rowtype;
begin
  select * into v_message from public.league_lounge_messages where id = p_message_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'MESSAGE_NOT_FOUND');
  end if;
  if v_message.author_id <> auth.uid() and not exists (
    select 1 from public.leagues league
    where league.id = v_message.league_id and league.commissioner_id = auth.uid()
  ) then
    return jsonb_build_object('success', false, 'error', 'MESSAGE_CONTROL_REQUIRED');
  end if;

  update public.league_lounge_messages
  set deleted_at = now(), deleted_by = auth.uid(), is_pinned = false,
      pinned_at = null, pinned_by = null, updated_at = now()
  where id = p_message_id and deleted_at is null;
  update public.league_lounge_reports
  set status = 'ACTIONED', reviewed_at = now(), reviewed_by = auth.uid()
  where message_id = p_message_id and status = 'OPEN';
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.notify_lounge_report()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_commissioner uuid;
begin
  select league.commissioner_id into v_commissioner
  from public.leagues league where league.id = new.league_id;
  if v_commissioner is not null and v_commissioner <> new.reporter_id then
    insert into public.user_notifications (
      user_id, league_id, category, title, body, route, dedupe_key
    ) values (
      v_commissioner, new.league_id, 'SYSTEM', 'Lounge message reported',
      'A league manager has reported a Lounge message for review.',
      '/league-lounge', 'lounge-report:' || new.id::text
    ) on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.resolve_lounge_message_reports(
  p_message_id uuid,
  p_status text default 'DISMISSED'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_league_id uuid;
  v_status text := upper(btrim(coalesce(p_status, '')));
begin
  select message.league_id into v_league_id
  from public.league_lounge_messages message where message.id = p_message_id;
  if v_league_id is null then return jsonb_build_object('success', false, 'error', 'MESSAGE_NOT_FOUND'); end if;
  if v_status not in ('REVIEWED', 'DISMISSED') then return jsonb_build_object('success', false, 'error', 'INVALID_REPORT_STATUS'); end if;
  if not exists (
    select 1 from public.leagues league
    where league.id = v_league_id and league.commissioner_id = auth.uid()
  ) then return jsonb_build_object('success', false, 'error', 'COMMISSIONER_REQUIRED'); end if;

  update public.league_lounge_reports
  set status = v_status, reviewed_at = now(), reviewed_by = auth.uid()
  where message_id = p_message_id and status = 'OPEN';
  return jsonb_build_object('success', true);
end;
$$;

drop trigger if exists league_lounge_report_notification on public.league_lounge_reports;
create trigger league_lounge_report_notification
  after insert on public.league_lounge_reports
  for each row execute function public.notify_lounge_report();

revoke all on function public.set_lounge_message_pinned(uuid, boolean) from public, anon;
revoke all on function public.remove_lounge_message(uuid) from public, anon;
grant execute on function public.set_lounge_message_pinned(uuid, boolean) to authenticated;
grant execute on function public.remove_lounge_message(uuid) to authenticated;
revoke all on function public.notify_lounge_report() from public, anon, authenticated;
revoke all on function public.resolve_lounge_message_reports(uuid, text) from public, anon;
grant execute on function public.resolve_lounge_message_reports(uuid, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'league_lounge_messages'
  ) then
    alter publication supabase_realtime add table public.league_lounge_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'league_lounge_reactions'
  ) then
    alter publication supabase_realtime add table public.league_lounge_reactions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'league_lounge_reads'
  ) then
    alter publication supabase_realtime add table public.league_lounge_reads;
  end if;
end;
$$;
