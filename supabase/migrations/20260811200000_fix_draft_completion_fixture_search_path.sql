-- The draft engine deliberately executes with an empty search_path. The legacy
-- completion trigger calls the fixture generator, whose body contains older
-- unqualified public table references (including league_members). Give only
-- those legacy functions an explicit, deterministic path so the 15th-round
-- transaction can generate fixtures and commit.

do $$
begin
  if pg_catalog.to_regprocedure('public.generate_league_fixtures(uuid)') is not null then
    alter function public.generate_league_fixtures(uuid)
      set search_path = pg_catalog, public;
  end if;

  if pg_catalog.to_regprocedure('public.trigger_generate_fixtures_on_completion()') is not null then
    alter function public.trigger_generate_fixtures_on_completion()
      set search_path = pg_catalog, public;
  end if;
end;
$$;

comment on function public.generate_league_fixtures(uuid) is
  'Generates league fixtures; explicit search path allows safe invocation from the hardened draft completion transaction.';
