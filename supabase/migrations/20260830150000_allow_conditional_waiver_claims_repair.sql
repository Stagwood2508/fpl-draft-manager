-- Keep exact duplicate claims out, while allowing alternative outgoing players
-- for the same desired player. This is idempotent across databases where the
-- original conditional-claims migration was or was not applied.

do $$
declare
  v_definition text;
  v_old_fragment constant text := $fragment$
      and wc.player_to_add = p_add_player_id
      and lower(coalesce(wc.status::text, 'pending')) = 'pending'
$fragment$;
  v_new_fragment constant text := $fragment$
      and wc.player_to_add = p_add_player_id
      and wc.player_to_drop = p_drop_player_id
      and lower(coalesce(wc.status::text, 'pending')) = 'pending'
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.submit_waiver_claim(uuid,integer,integer,integer)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, v_new_fragment) > 0 then
    return;
  end if;

  if pg_catalog.strpos(v_definition, v_old_fragment) = 0 then
    raise exception 'submit_waiver_claim duplicate check did not match an expected definition';
  end if;

  execute pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
end;
$$;

revoke all on function public.submit_waiver_claim(uuid,integer,integer,integer)
  from public, anon;
grant execute on function public.submit_waiver_claim(uuid,integer,integer,integer)
  to authenticated;

