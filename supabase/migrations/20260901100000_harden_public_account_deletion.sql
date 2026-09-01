-- Keep public account deletion functional as newer competition features add
-- user references. Historical competition records remain, but their creator
-- and rehearsal actor links are anonymised when the auth account is removed.

alter table if exists public.cups
  alter column created_by drop not null;

alter table if exists public.cups
  drop constraint if exists cups_created_by_fkey;

alter table if exists public.cups
  add constraint cups_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table if exists public.gameweek_simulation_runs
  alter column commissioner_id drop not null;

alter table if exists public.gameweek_simulation_runs
  drop constraint if exists gameweek_simulation_runs_commissioner_id_fkey;

alter table if exists public.gameweek_simulation_runs
  add constraint gameweek_simulation_runs_commissioner_id_fkey
  foreign key (commissioner_id) references auth.users(id) on delete set null;

alter table if exists public.gameweek_simulation_audit
  drop constraint if exists gameweek_simulation_audit_actor_id_fkey;

alter table if exists public.gameweek_simulation_audit
  add constraint gameweek_simulation_audit_actor_id_fkey
  foreign key (actor_id) references auth.users(id) on delete set null;

comment on function public.delete_my_account() is
  'Deletes the authenticated account and directly associated personal data; commissioner transfer is required before deletion when other league members remain.';
