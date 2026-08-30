-- Operator-only repair: ask the protected live-scoring Edge Function to
-- refresh every Gameweek whose deadline has passed. The secret remains in
-- Vault and is never returned to the client.

do $$
declare
  v_gameweek integer;
  v_cron_secret text;
  v_request_id bigint;
begin
  select decrypted_secret
  into v_cron_secret
  from vault.decrypted_secrets
  where name = 'live_stats_cron_secret'
  limit 1;

  if nullif(v_cron_secret, '') is null then
    raise exception 'live_stats_cron_secret is not configured';
  end if;

  for v_gameweek in
    select gameweek_number
    from public.gameweeks
    where fpl_deadline_time <= pg_catalog.now()
    order by gameweek_number
  loop
    select net.http_get(
      url := 'https://fnysbiwhwcqqqdwvhkau.supabase.co/functions/v1/sync-live-stats?gameweek=' || v_gameweek,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', v_cron_secret
      )
    ) into v_request_id;
  end loop;
end;
$$;
