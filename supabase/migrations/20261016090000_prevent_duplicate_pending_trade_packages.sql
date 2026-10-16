-- Prevent a manager from submitting the same still-pending trade package twice.
-- The lock makes the check safe when two browser/device requests arrive together.

create or replace function public.create_trade_package(
  p_league_id uuid,
  p_receiver_id uuid,
  p_player_out_ids integer[],
  p_player_in_ids integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid := auth.uid();
  v_package_id uuid := gen_random_uuid();
  v_index integer;
  v_normalized_player_out_ids integer[];
  v_normalized_player_in_ids integer[];
begin
  if v_sender_id is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  begin
    perform public.validate_trade_package_selection(
      p_league_id,
      v_sender_id,
      p_receiver_id,
      p_player_out_ids,
      p_player_in_ids
    );

    -- Serialize proposals between this pair of managers in this league. This
    -- closes the race where identical requests are submitted at the same time.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(
        p_league_id::text || ':' || v_sender_id::text || ':' || p_receiver_id::text
      )
    );

    select coalesce(array_agg(player_id order by player_id), '{}'::integer[])
    into v_normalized_player_out_ids
    from unnest(p_player_out_ids) as selected(player_id);

    select coalesce(array_agg(player_id order by player_id), '{}'::integer[])
    into v_normalized_player_in_ids
    from unnest(p_player_in_ids) as selected(player_id);

    if exists (
      select 1
      from public.transactions transaction
      where transaction.league_id = p_league_id
        and transaction.sender_id = v_sender_id
        and transaction.receiver_id = p_receiver_id
        and upper(transaction.type::text) = 'TRADE'
        and upper(transaction.status::text) = 'PENDING'
      group by coalesce(transaction.parent_transaction_id, transaction.id)
      having
        array_agg(transaction.player_out_id order by transaction.player_out_id) = v_normalized_player_out_ids
        and array_agg(transaction.player_in_id order by transaction.player_in_id) = v_normalized_player_in_ids
    ) then
      return jsonb_build_object('success', false, 'error', 'DUPLICATE_TRADE_OFFER');
    end if;

    for v_index in 1..cardinality(p_player_out_ids) loop
      insert into public.transactions(
        league_id, sender_id, receiver_id, type, status,
        player_out_id, player_in_id, parent_transaction_id
      ) values (
        p_league_id, v_sender_id, p_receiver_id, 'TRADE', 'PENDING',
        p_player_out_ids[v_index], p_player_in_ids[v_index], v_package_id
      );
    end loop;

    insert into public.trade_package_audit(league_id, package_id, actor_id, action, details)
    values (
      p_league_id,
      v_package_id,
      v_sender_id,
      'PROPOSED',
      jsonb_build_object('player_count', cardinality(p_player_out_ids))
    );

    return jsonb_build_object('success', true, 'package_id', v_package_id);
  exception when others then
