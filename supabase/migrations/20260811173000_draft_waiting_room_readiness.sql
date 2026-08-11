-- Realtime manager readiness for the ten-minute pre-draft waiting room.

create table if not exists public.draft_room_readiness (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_start_time timestamptz not null,
  is_ready boolean not null default false,
  ready_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (league_id, user_id)
);

create index if not exists draft_room_readiness_league_idx
  on public.draft_room_readiness(league_id, is_ready, updated_at desc);

alter table public.draft_room_readiness enable row level security;

drop policy if exists "League members can view draft readiness" on public.draft_room_readiness;
create policy "League members can view draft readiness"
  on public.draft_room_readiness
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.league_members lm
      where lm.league_id = draft_room_readiness.league_id
        and lm.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.draft_room_readiness
  from public, anon, authenticated;
grant select on public.draft_room_readiness to authenticated;

create or replace function public.set_draft_room_ready(
  p_league_id uuid,
  p_is_ready boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_start_time timestamptz;
  v_status text;
begin
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  if not exists (
    select 1 from public.league_members lm
    where lm.league_id = p_league_id and lm.user_id = v_actor
  ) then
    return jsonb_build_object('success', false, 'error', 'LEAGUE_MEMBERSHIP_REQUIRED');
  end if;

  select ls.draft_start_time
  into v_start_time
  from public.league_settings ls
  where ls.league_id = p_league_id;

  if v_start_time is null then
    return jsonb_build_object('success', false, 'error', 'DRAFT_NOT_SCHEDULED');
  end if;

  select ds.draft_status
  into v_status
  from public.draft_sessions ds
  where ds.league_id = p_league_id;

  if upper(coalesce(v_status, 'WAITING_ROOM')) in ('LIVE', 'DRAFTING', 'PAUSED', 'COMPLETED') then
    return jsonb_build_object('success', false, 'error', 'DRAFT_ALREADY_STARTED');
  end if;

  if pg_catalog.now() < v_start_time - interval '10 minutes' then
    return jsonb_build_object(
      'success', false,
      'error', 'WAITING_ROOM_NOT_OPEN',
      'opens_at', v_start_time - interval '10 minutes'
    );
  end if;

  insert into public.draft_room_readiness(
    league_id, user_id, draft_start_time, is_ready, ready_at, updated_at
  ) values (
    p_league_id,
    v_actor,
    v_start_time,
    p_is_ready,
    case when p_is_ready then pg_catalog.now() else null end,
    pg_catalog.now()
  )
  on conflict (league_id, user_id) do update
  set draft_start_time = excluded.draft_start_time,
      is_ready = excluded.is_ready,
      ready_at = excluded.ready_at,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'success', true,
    'league_id', p_league_id,
    'user_id', v_actor,
    'is_ready', p_is_ready,
    'draft_start_time', v_start_time
  );
end;
$$;

revoke all on function public.set_draft_room_ready(uuid, boolean) from public, anon;
grant execute on function public.set_draft_room_ready(uuid, boolean) to authenticated;

alter table public.draft_room_readiness replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'draft_room_readiness'
  ) then
    alter publication supabase_realtime add table public.draft_room_readiness;
  end if;
end;
$$;

comment on table public.draft_room_readiness is
  'Manager ready state for the currently scheduled draft waiting room. A changed draft_start_time invalidates previous readiness.';

