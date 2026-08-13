-- Pending trade negotiations are private to their sender and receiver.
-- Once a proposal leaves PENDING, it becomes part of the league activity log.

create or replace function public.can_view_trade_transaction(
  p_league_id uuid,
  p_status text,
  p_sender_id uuid,
  p_receiver_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.league_members membership
      where membership.league_id = p_league_id
        and membership.user_id = auth.uid()
    )
    and (
      upper(coalesce(p_status, '')) <> 'PENDING'
      or auth.uid() = p_sender_id
      or auth.uid() = p_receiver_id
    );
$$;

revoke all on function public.can_view_trade_transaction(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.can_view_trade_transaction(uuid, text, uuid, uuid) to authenticated, service_role;

alter table public.transactions enable row level security;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'transactions'
      and cmd in ('SELECT', 'ALL')
  loop
    execute pg_catalog.format(
      'drop policy %I on public.transactions',
      v_policy.policyname
    );
  end loop;
end;
$$;

create policy transactions_league_visibility
on public.transactions
for select
to authenticated
using (
  public.can_view_trade_transaction(
    league_id,
    status::text,
    sender_id,
    receiver_id
  )
);

revoke select on public.transactions from public, anon;
grant select on public.transactions to authenticated, service_role;

comment on function public.can_view_trade_transaction(uuid, text, uuid, uuid) is
  'Allows league-wide visibility for completed transactions while keeping pending trades private to their two participants.';
