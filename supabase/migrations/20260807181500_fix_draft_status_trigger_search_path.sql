-- The legacy draft-pick trigger uses unqualified table names. Draft picks now
-- execute through hardened functions with an empty search_path, so give the
-- trigger its own safe, explicit lookup path.

alter function public.update_league_draft_status()
  set search_path = public, pg_catalog;

comment on function public.update_league_draft_status() is
  'Maintains league draft status after picks; uses an explicit safe search path for trigger execution.';
