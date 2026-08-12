-- Managers may submit alternative conditional claims for the same available
-- player when each claim drops a different roster player. Only an identical
-- add/drop pairing is a duplicate.

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

  if pg_catalog.strpos(v_definition, v_old_fragment) = 0 then
    raise exception 'submit_waiver_claim duplicate check did not match the expected secured definition';
  end if;

  execute pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
end;
$$;

revoke all on function public.submit_waiver_claim(uuid,integer,integer,integer)
  from public, anon;
grant execute on function public.submit_waiver_claim(uuid,integer,integer,integer)
  to authenticated;

comment on function public.submit_waiver_claim(uuid,integer,integer,integer) is
  'Submits a server-validated waiver claim. Alternative claims for the same target are allowed when the outgoing player differs.';
