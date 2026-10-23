# Production security audit — 23 October 2026

## Scope and method

This is a production configuration and source-boundary audit, not a penetration
test. It used the linked production Supabase project, the Supabase Advisor, and
the repository's migrations, Edge Functions and existing SQL test suites. No
application data or user records were changed. Following the audit, the
anonymous table grants in Finding 1 were removed through a reviewed, versioned
migration and verified in production.

## Executive summary

The application has a sound server-authoritative design: all live public tables
have Row Level Security (RLS) enabled, anonymous callers cannot execute public
database functions, and every checked `SECURITY DEFINER` function has a fixed
search path. The migration history is also fully reconciled.

The main hardening gap is least-privilege table access. Twenty-two tables still
have underlying grants for the anonymous role. RLS currently blocks unauthorised
rows, so this is not proof that data is exposed; however, revoking those grants
will remove an unnecessary second attack path and prevent a future policy mistake
from becoming anonymous access.

Supabase also reports that leaked-password protection is disabled. The dashboard
confirms this control is only available on Supabase Pro and above; it cannot be
enabled without an explicit subscription change.

## Evidence collected

| Check | Result | Evidence |
| --- | --- | --- |
| Local and production migrations | Pass | `supabase migration list`: every migration from `20260807090000` through `20261023090000` matched locally and remotely. |
| Public table inventory | Pass | Production catalog query returned 56 ordinary/partitioned tables in `public`. |
| RLS coverage | Pass | 56/56 public tables have `relrowsecurity = true`; zero tables were returned without RLS. |
| Anonymous public-function access | Pass | Production catalog query returned 0 public functions executable by `anon`. |
| `SECURITY DEFINER` hardening | Pass | Production catalog query returned 0 public security-definer functions without a fixed `search_path`. |
| Anonymous table grants | Resolved | Grants were revoked through migration `20261023100000`; production now returns zero direct `anon` table grants. |
| Authentication protection | Subscription decision required | Leaked-password protection is disabled and available only on Supabase Pro and above. |
| Existing regression tests | Present, not run locally | Security SQL tests exist, but local execution is blocked because Docker Desktop is not installed on this machine. |

## Findings

### 1. Anonymous role has unnecessary table grants

**Priority: High-priority hardening**

All affected tables have RLS enabled, which is the immediate protection. The
issue is that the anonymous database role still holds one or more underlying
table grants. RLS and table grants are separate layers: keeping both restrictive
is the safer production posture.

Affected tables:

```text
cup_audit_log, cup_configurations, cup_entries, cup_fixtures, cup_rounds,
cups, draft_autopick_debug, draft_manager_autopick_state, draft_pick_audit,
draft_room_readiness, free_agent_transactions, gameweek_autosub_audit,
gameweek_lineup_snapshots, gameweeks, league_waiver_priorities,
lineup_change_audit, player_position_overrides, player_season_stats,
trade_package_audit, transactions, waiver_claims, waiver_player_locks
```

Some of these are sensitive operational tables, notably transactions, waiver
claims, draft state and audit records. Anonymous users do not need direct access
to any of them.

**Deployment status: resolved 23 October 2026**

Migration `20261023100000_revoke_anon_operational_table_grants.sql` was applied
to production. A follow-up production catalog query returned **0** anonymous
table-grant rows.

**Remediation applied**

1. Added a migration that explicitly revokes all privileges from `anon` on the
   affected tables.
2. Preserved the existing server-side and authenticated RPC paths.
3. Added a regression test that fails if any of these tables retain an
   anonymous privilege.
4. Re-ran the production catalog query, which returned zero anonymous grants.

No grant should be removed ad hoc in the dashboard; the change must be versioned
as a migration and verified against the app flows.

### 2. Leaked-password protection is disabled

**Priority: High before wider release**

Supabase Advisor reports that leaked-password protection is disabled. This allows
users to choose passwords that are known to have appeared in public breach data.

**Current status: subscription decision required**

The live dashboard confirms that Supabase offers this feature only on its Pro
plan and above. Enabling it would require a paid-plan change, which has not been
made as part of this audit.

**Recommended remediation**

If the project is upgraded to a plan that supports it, enable leaked-password
protection in Supabase Authentication settings, then test registration, password
reset and password change with a deliberately breached test password. This is a
dashboard configuration change, not a database migration.

### 3. Email confirmation is not yet verified as enabled

**Priority: High before public sign-up**

The audit could confirm the Advisor's password-protection setting but has not
yet established the live email-confirmation, redirect URL and SMTP
configuration. New users should confirm the email address they control before a
session is created.

**Recommended remediation**

- Enable Confirm Email.
- Configure the Vercel URL and the Android deep-link redirect URL.
- Add/verify the app's confirmation-pending and resend-email experience.
- Use a custom SMTP sender before inviting non-team users.

### 4. RLS policy initialization-plan warnings

**Priority: Medium — performance and maintainability**

Supabase Advisor reports policies such as `watchlist_members_read` that call
`auth.uid()` or `current_setting()` per candidate row. This is a performance
warning rather than evidence of unauthorised access.

**Recommended remediation**

Where semantically identical, rewrite expressions from `auth.uid()` to
`(select auth.uid())` and similarly wrap stable auth helpers in a subselect.
Each policy change must retain its existing owner/league-membership predicate
and be accompanied by a regression test.

### 5. Multiple permissive RLS policies need a rule-by-rule review

**Priority: Medium**

The Advisor flags multiple permissive policies on tables including draft picks,
draft sessions, fixtures, league members, rosters, player data, team fixtures
and waiver claims. Permissive policies combine with logical **OR**. This can be
intentional, but only if every policy independently grants an acceptable level
of access.

**Recommended remediation**

Build a policy matrix for each flagged table listing every `SELECT`, `INSERT`,
`UPDATE` and `DELETE` policy, its intended caller, and its membership/ownership
condition. Consolidate overlapping policies where practical; use restrictive
policies where a rule must always apply.

### 6. `pg_net` remains installed in the exposed `public` schema

**Priority: Low / review**

The Advisor flags the `pg_net` extension in `public`. The repository already
revokes browser execution on functions in the `net` schema and the audit found
no anonymous public function execution. This is therefore not currently
evidence of a browser-callable outbound request path.

**Recommended remediation**

Confirm the extension is required for scheduled/server jobs. If it is, move it
to a non-exposed schema where Supabase supports that configuration; otherwise
remove it during a maintenance window. Do not change it until dependent cron
jobs have been checked.

## Server and secret-boundary review

### What is in good shape

- The web/mobile client uses only `EXPO_PUBLIC_SUPABASE_URL` and the
  publishable key. No service-role secret was found in app source.
- Service-role credentials are read from Edge Function environment variables.
- `send-push-notification` requires either the service-role bearer credential
  or a separate webhook secret.
- The trade-action endpoint receives a format-checked, high-entropy capability
  token and passes only its SHA-256 hash to the database. It returns no player
  or manager data on a rejected action.
- The FPL player-pool sync has an existing `APP_OWNER_USER_ID` server-side
  check for calls from an app session.

### Items that require dynamic tests in phase 2

- Confirm trade-action capabilities expire, are single-use and cannot affect a
  different trade or manager.
- Confirm every Edge Function deployment has JWT verification/configuration
  matching its own explicit checks.
- Confirm the push webhook secret and Firebase credential are present only in
  Supabase Edge Function secrets, never Vercel, Git, Expo updates or the app.
- Review the FPL proxy's broad CORS header. It currently requires a valid app
  session and returns only upstream football data, so it is lower risk, but it
  should be rate-limited if public traffic grows.

## Existing automated security coverage

The repository already contains useful SQL checks:

- `supabase/tests/beta_security_lockdown_test.sql`
- `supabase/tests/explicit_rpc_allowlist_test.sql`
- `supabase/tests/network_surface_security_test.sql`
- `supabase/tests/push_notifications_security_test.sql`
- `supabase/tests/prelaunch_transaction_hardening_rollback_test.sql`

These check key controls such as direct table mutation, RPC allowlists,
security-invoker views, realtime exposure and push-device ownership. They should
be promoted into a repeatable pre-release security command once Docker or a CI
database test environment is available.

## Remediation plan

### Phase 1 — resolve before wider beta

1. Completed: remove anonymous grants from the 22 operational tables and add
   a regression test.
2. Make a subscription decision on leaked-password protection; enable and test
   it if the project moves to Supabase Pro or above.
3. Configure and test email confirmation, redirect URLs and custom SMTP.
4. Add a release gate that fails if migration history is out of sync.

### Phase 2 — authorisation proof

1. Build the policy matrix for every multi-policy table.
2. Run two-account, two-league isolation tests against production-like data.
3. Test all trade, waiver, draft, commissioner and push-action negative cases.
4. Review every browser-callable security-definer RPC against an explicit
   authorisation checklist.

### Phase 3 — operational security

1. Create a separate non-playing app-owner account and set its UUID as
   `APP_OWNER_USER_ID` only after its scope is designed and tested.
2. Protect the Supabase, GitHub, Vercel, Expo and Google/Firebase owner
   accounts with MFA; add a recovery owner where supported.
3. Establish secret rotation and incident-response steps.
4. Repeat this audit before public launch and at least every major season
   release.

## Audit limitations

- This audit did not attempt exploitation against real user accounts. It did
  apply the narrowly scoped, versioned database hardening migration documented
  in Finding 1.
- The local SQL regression suite was not executed because Docker Desktop is
  unavailable on this computer.
- Supabase Auth configuration beyond the Advisor finding (confirmation state,
  SMTP, CAPTCHA, MFA and redirect URLs) still needs a dedicated dashboard
  review.
- This is not a substitute for an independent professional penetration test
  before a large public launch.
