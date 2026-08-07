create table if not exists public.free_agent_transactions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  gameweek integer not null check (gameweek between 1 and 38),
  player_in_id integer not null references public.players(id),
  player_out_id integer not null references public.players(id),
  completed_at timestamptz not null default pg_catalog.now(),
  unique (league_id, user_id, gameweek, player_in_id, player_out_id)
);

create index if not exists free_agent_transactions_league_completed_idx
  on public.free_agent_transactions (league_id, completed_at desc);

alter table public.free_agent_transactions enable row level security;

drop policy if exists "League members can view free agent history" on public.free_agent_transactions;
create policy "League members can view free agent history"
  on public.free_agent_transactions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.league_members lm
      where lm.league_id = free_agent_transactions.league_id
        and lm.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.free_agent_transactions from anon, authenticated;
grant select on public.free_agent_transactions to authenticated;

create or replace function public.claim_free_agent_with_history(
  p_league_id uuid,
  p_add_player_id integer,
  p_drop_player_id integer,
  p_gameweek integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = v_user_id
  ) then
    raise exception 'You are not a member of this league.' using errcode = '42501';
  end if;

  v_result := public.claim_free_agent(
    p_league_id := p_league_id,
    p_add_player_id := p_add_player_id,
    p_drop_player_id := p_drop_player_id,
    p_gameweek := p_gameweek
  )::jsonb;

  if pg_catalog.coalesce((v_result ->> 'success')::boolean, false) then
    insert into public.free_agent_transactions (
      league_id,
      user_id,
      gameweek,
      player_in_id,
      player_out_id
    ) values (
      p_league_id,
      v_user_id,
      p_gameweek,
      p_add_player_id,
      p_drop_player_id
    )
    on conflict (league_id, user_id, gameweek, player_in_id, player_out_id) do nothing;
  end if;

  return v_result;
end;
$$;

revoke all on function public.claim_free_agent_with_history(uuid, integer, integer, integer) from public, anon;
grant execute on function public.claim_free_agent_with_history(uuid, integer, integer, integer) to authenticated;

