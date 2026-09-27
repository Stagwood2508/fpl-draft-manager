-- This helper is evaluated by the transactions SELECT RLS policy. It does not
-- mutate data; authenticated managers need EXECUTE permission for Postgres to
-- evaluate the policy when loading their dashboard and trade views.
grant execute on function public.can_view_trade_transaction(uuid, text, uuid, uuid)
  to authenticated, service_role;
