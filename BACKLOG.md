# Change Backlog

_Last reconciled with the codebase: 15 August 2026._

## Current beta-readiness snapshot

The planned V1 product is feature-complete for a **controlled beta**. Drafting,
rosters, lineups, waivers, free agents, trades, fixtures, live scoring and the
manager-facing Home/League/Market/Squad workflows are implemented. The remaining
launch gates are deployment verification and realistic multi-manager rehearsals,
not major missing feature screens.

### Completed since the previous backlog refresh

- [x] Harden beta security and remove elevated browser-accessible mutation routes.
  - Profile data is restricted to the owner and shared-league managers.
  - Direct table writes are removed for protected draft and transaction changes.
  - The authenticated RPC surface is explicitly allowlisted and regression-tested.
  - Draft submissions, including the legacy compatibility route, enforce the same server checks.
- [x] Make league creation atomic and repair multi-league startup routing.
- [x] Add beta operations and account-management essentials.
  - Password reset works on web and installed builds through the recovery deep link.
  - Crash/error reports and tester feedback are recorded with account-scoped access.
  - Privacy information and permanent account deletion are available in Settings.
- [x] Add a controlled Gameweek rehearsal harness with one-tap restoration.
  - Commissioners can start, advance, inspect and roll back a rehearsal.
  - The report includes scoring integrity, waiver processing and reconciliation results.
  - Later fixes align rehearsal waiver deadlines, preserve the correct open window,
    process waivers before free agency, rerun totals after autosubs and repair rollback state.
- [x] Harden waiver creation and management.
  - Managers can create conditional claims for the same target player with different drops.
  - Claim uniqueness is scoped to the league, manager and Gameweek rather than the target alone.
  - Pending claims can be reordered and cancelled through server-authoritative functions.
  - Only one authoritative waiver window is active, and stale processed-state flags can be repaired.
- [x] Separate current-season and previous-season player statistics.
  - Current points come only from Gameweek stat rows and never fall back to the Draft bootstrap total.
  - Previous-season history remains available as an explicit scouting period.
  - Player-pool sorting includes Draft Rank (the current default), current/previous points,
    form, starts, minutes, goals, assists, clean sheets, saves, bonus, DEFCON, ICT and expected returns.
  - The player card uses the same selected/current season rather than displaying last season as current.
- [x] Complete the latest trade-workspace refinements.
  - Mobile offer and counteroffer builders show both 15-player squads at once and use the full screen height.
  - Player names, clubs and coloured positions remain visible in compact rows.
  - Pending negotiations are private to the sender and receiver; completed outcomes are league-visible.
- [x] Complete the cross-platform mobile compatibility pass.
  - Primary screens, modals and forms respect notches, home indicators and mobile keyboards.
  - Squad, Match Centre, player cards, transaction tools and authentication flows adapt to small screens.
  - Light and dark appearance modes use the shared application theme.
- [x] Add installable-build and launch presentation support.
  - EAS preview-build configuration and required Expo dependencies are present.
  - Native adaptive icon and splash assets are high resolution.
  - The branded loading screen bridges native startup and session initialization.
  - The web build now copies and injects the PWA manifest and high-resolution launcher icons into Vercel output.

### Outstanding before opening the controlled beta

- [ ] Deploy and verify the latest database migrations in the target Supabase environment.
  - Confirm `20260813200000_player_pool_current_season_stats.sql` and
    `20260813203000_remove_previous_season_player_pool_fallback.sql` are applied.
  - Apply `20260814010000_private_pending_trade_offers.sql` and verify a third manager
    cannot read a pending offer but can see its accepted or rejected outcome.
- [ ] Redeploy the latest web build and verify the production PWA output.
  - Confirm `/manifest.webmanifest` returns the manifest rather than the app HTML.
  - Confirm the 1024px maskable icon is served, then reinstall after clearing the old site data.
  - Confirm Draft Rank is the player-list default and current totals start at zero when no Gameweek data exists.
- [ ] Produce one fresh Android preview build after the final mobile, trade, player-card and splash changes.
- [ ] Run one final realistic draft rehearsal with concurrent managers through all 15 rounds.
  - Verify snake order, timeout/away auto-picks, reconnects, completion, legal 15-player rosters and fixture creation.
- [ ] Run a complete controlled Gameweek rehearsal from pre-deadline through finalisation.
  - Cover lineup locking, live points, provisional/final bonus, DEFCON, autosubs, waiver processing,
    free-agent availability, trades, standings, fixture totals and rollback reconciliation.
- [ ] Repeat fixture checks with at least one even-manager and one odd-manager league.
  - Confirm one fixture per manager per Gameweek and the rotating league-average opponent.
- [ ] Run the existing security and lifecycle regression SQL tests against the deployed beta schema.
- [ ] Record the beta operating procedure: tester cohort, support/feedback route, backup point,
  rollback owner and what data may be reset during the controlled test.

### Explicitly deferred until after the controlled beta

- [ ] Native push notifications. The in-app notification centre is complete; remote push delivery is deferred.
- [ ] League Lounge, direct/group messaging and podcast publishing/alerts.
- [ ] Draft grades or AI-generated squad analysis.
- [ ] Broader App Store distribution, marketing and public onboarding polish.

## High priority

- [x] Make draft progression fully server-controlled so it continues when every manager disconnects or leaves the draft room.
  - A Postgres cron job processes expired `LIVE` and `DRAFTING` sessions every five seconds.
  - The database clock and locked session row are authoritative for expiry and pick identity.
  - Browser roles cannot invoke the auto-pick RPC directly.
  - The client countdown is presentation-only and waits for the Realtime session update.
  - Stale and duplicate auto-picks are rejected by the locked pick-number checks.

- [x] Migrate off the Supabase legacy JWT credentials and revoke them.
  - The app and production web build now use `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  - Deployed server functions now use the protected Supabase secret-key store.
  - The legacy `anon` and `service_role` API keys are disabled.
  - The previous shared HS256 JWT signing key is revoked; the project uses an asymmetric ECC signing key.

## Draft room roadmap

### 1. Better live-turn feedback

- [x] Add an animated pulse when it becomes your turn.
- [x] Strengthen the overall "your turn" visual state.
- [x] Show escalating visual timer warnings as a turn expires.
- [x] Make player controls clearly disabled while another manager is picking.
- [x] Automatically scroll the draft tracker to the active manager.
- [x] Briefly highlight the tracker when the active picker changes.
- [x] Add optional vibration/haptic feedback on supported mobile devices.

### 2. Better player interaction

- [x] Support Draft Rank and previous-season statistical sorting.
  - The compact selector includes points, goals, assists, clean sheets, starts, minutes, bonus, ICT, xG, xA, defensive contributions, CBI, recoveries, tackles and saves.
  - The selected measure is shown on every player row, with players lacking previous-season history placed below players with genuine data.
- [x] Expand the player detail view with richer draft-relevant information, including a previous-season scouting card.
  - Official 2025/26 FPL history is stored separately from current-season totals and matched to Draft players by stable player code.
  - The card adapts its metrics by position and includes ICT, expected returns, defensive contributions, CBI, recoveries and tackles where relevant.
  - New and promoted players receive an explicit no-history state instead of misleading zero or current-season figures.
- [x] Add web hover states.
- [x] Make draft and watchlist actions more distinct.
- [x] Add a quick Select action that still requires confirmation.
- [x] Improve the confirmation panel shown before a pick is submitted.
- [x] Keep already-drafted players and players from full positions out of the selectable pool.

### 3. Draft-pick feedback

- [x] Show a confirmation animation after the user's successful pick.
- [x] Include player name, club and position in the confirmation.
- [x] Include manager, round and overall pick number in the confirmation.
- [x] Add an optional draft sound setting with distinct pick-confirmed and watchlist-alert sounds.
- [x] Notify a manager when another manager drafts someone from their watchlist.

### 4. Draft history

- [x] Add a full draft board.
- [x] Add a manager-by-round grid.
- [x] Add a complete chronological pick list.
- [x] Show recent picks during the live draft.
- [x] Add individual manager draft histories.
- [x] Add manager, round, club and position filters.

### 5. Draft completion

- [x] Show a dedicated Draft Complete panel.
- [x] Provide a View My Squad action.
- [x] Provide a View Full Draft Results action.
- [x] Provide an Enter League Hub action.
- [x] Show summaries for every manager's completed squad.
- [x] Validate and repair the user's initial starting formation.

Draft grading and AI-generated post-draft analysis are intentionally outside the V1 scope. They are tracked under **V2 / future development** below.

### 6. Draft reliability

- [x] Continue and auto-pick from the server when every client disconnects.
- [x] Show a Realtime connection indicator.
- [x] Show a reconnecting/reconnected banner.
- [x] Automatically perform a full state resync after reconnecting.
- [x] Add a clear retry state for failed manual picks.
- [x] Reject stale pick and stale-session submissions on the server.
- [x] Verify the authoritative turn immediately before each manual pick.
- [x] Recover safely when a pick succeeds but its response is lost.
- [x] Clear stale manual selections whenever a turn advances or an auto-pick removes the player.
- [x] Prevent duplicate timeout auto-picks with locked pick-number checks.
- [x] Display and persist the reason and source for every auto-pick.
- [x] Put managers into away mode after two consecutive timer auto-picks.
- [x] Auto-pick away managers on the next server ticker pass instead of waiting for the full clock.
- [x] Let a returning manager clear away mode and restore a full current-turn clock.
- [x] Add commissioner pause, resume, timer-extension and forced auto-pick recovery controls.
- [x] Record new picks in the server-side draft audit trail.
- [x] Enforce 2 GKP / 5 DEF / 5 MID / 3 FWD quotas on the server for every draft-pick route.
- [x] Add the full commissioner-visible audit-trail view for picks and corrections.

### 7. Commissioner draft controls

- [x] Pause the draft while preserving the current manager and remaining time.
- [x] Resume the draft with the preserved clock.
- [x] Extend the current timer by 30 seconds.
- [x] Auto-pick immediately for a disconnected or absent manager, with confirmation.
- [x] Assign a player manually.
- [x] Undo the latest pick safely.
- [x] Correct an invalid pick with an audit record.
- [x] Reorder managers before the draft begins.
- [x] Restart the draft before official season activity begins.

## Original V1 draft-room completion checklist

### Security before production

- [x] Replace and revoke the Supabase legacy credentials, as detailed in **High priority**.

### Draft completion

- [x] Show a compact completed-squad summary for every manager.

### Commissioner controls and recovery

- [x] Add a commissioner control panel with pause, resume and timer extension actions.
- [x] Allow the commissioner to auto-pick for a disconnected manager.
- [x] Allow the commissioner to assign a player manually.
- [x] Add safe undo and invalid-pick correction workflows.
- [x] Allow draft-order changes before the draft begins.
- [x] Allow a draft restart before official season activity begins.

### Audit visibility

- [x] Add the full commissioner-visible audit-trail screen for picks, auto-picks, corrections and reversals.

## V1 draft-room status

The planned V1 draft-room feature set is complete. Remaining ideas below are intentionally deferred rather than required for launch.

## In-season squad management

### Squad page bundle 1 — lineup and substitute priority

- [x] Restyle the squad page to use the same dark surfaces, spacing, typography and accent treatment as the Market tab.
- [x] Add a responsive squad overview with team, league, gameweek, formation and roster summaries.
- [x] Render the starting XI by formation and keep the full squad usable on smaller screens.
- [x] Separate normal squad browsing from an explicit Edit Lineup mode.
- [x] Open the existing rich player card from the squad, including recent scores and upcoming fixtures.
- [x] Show player availability flags, news, watchlist state and transfer-list state.
- [x] Show each player's next unfinished Premier League fixture beside their position, including home/away venue.
- [x] Let managers add, update or remove a transfer listing directly from the squad player-details card.
- [x] Show roster position limits and formation warnings.
- [x] Allow valid cross-position starter/substitute swaps when the resulting XI remains legal.
- [x] Keep goalkeeper changes restricted to the goalkeeper slot.
- [x] Save the complete lineup atomically on the server instead of applying partial player updates.
- [x] Enforce a legal XI on the server: 1 GKP, 3–5 DEF, 2–5 MID and 1–3 FWD.
- [x] Store the substitute goalkeeper at priority 0 and the three outfield substitutes at priorities 1–3.
- [x] Let managers reorder outfield substitute priority before saving.
- [x] Record saved lineup changes in a server-side audit trail.
- [x] Keep the selected league synchronised across the dashboard, squad page and shared app session.

### Later squad-page bundles

- [x] Verify the in-season transaction and lineup lifecycle against the deployed production schema.
  - Deployed free-agent history, waiver priority and configurable market-rule migrations.
  - Verified reverse-draft first-window ordering and bottom-to-top later-window ordering.
  - Verified repeated waiver passes, competing claims and both dropped-player availability rules.
  - Verified atomic free-agent swaps, transaction history, position validation and waiver locks.
  - Verified pre-deadline lineup saves, post-deadline locking and deadline snapshots.
  - Verified goalkeeper and priority-ordered outfield autosubs, legal formations and repeat-safe processing.
  - The automated smoke-test league and all fixture data are rolled back before the test completes.

- [x] Add a manager-facing transaction history covering transfers, waivers and trades.
  - Market history now combines processed waivers, atomic free-agent signing records and grouped trade packages.
  - Managers can switch between their own activity and the whole league, then filter by transaction type.
  - The Squad page links to the unified ledger without moving market activity into the lineup workspace.
- [x] Show current waiver priority and the next relevant waiver deadline.
  - The Market workspace shows the manager's league-wide queue position, next processing deadline and active market rules.
  - The first-window order is configurable as reverse draft order or draft order before drafting starts.
  - From the second waiver window onward, priority is recalculated from the completed league table, bottom to top.
  - Waiver processing must run in repeated bottom-to-top passes, allowing at most one successful claim per manager per pass while skipping failed ranked preferences.
  - Commissioners can choose whether trades close at the waiver deadline or the Gameweek deadline before drafting starts.
  - Commissioners can choose whether waiver-dropped players are protected until the next waiver round or become immediate free agents.
- [x] Add gameweek deadline locking to prevent lineup edits after the official cutoff.
  - The official FPL deadline schedule is ingested by the secured stats worker.
  - A server lifecycle job snapshots every manager's XI and ordered bench at the deadline.
  - The lineup-save RPC rejects changes while the gameweek is in progress.
- [x] Implement gameweek autosubs using the saved goalkeeper and outfield substitute priority.
  - Goalkeeper replacements remain goalkeeper-for-goalkeeper.
  - Playing outfield substitutes are considered in priority order while preserving a legal formation.
  - Processing waits until the gameweek is finished, is repeat-safe and never mutates the manager's current roster.
  - Live fixtures and standings score the immutable deadline/effective lineup rather than the mutable current XI.
- [x] Explain autosub outcomes to managers with applied and skipped substitution audit entries.
- [x] Add commissioner visibility and correction tools for invalid or disputed lineups.
  - Corrections require a legal XI and a recorded reason.

## Home dashboard

### Home bundle 1 — in-season overview

- [x] Use the shared signed-in session and selected league rather than maintaining separate Home-screen league state.
- [x] Match the responsive dark theme and visual language already used by the Market and Squad tabs.
- [x] Show the current or next head-to-head fixture with a direct Match Centre action.
- [x] Show the authoritative Gameweek deadline and a live countdown with an Edit Lineup action.
- [x] Show compact lineup, waiver and trade status cards without duplicating their full feature screens.
- [x] Show a compact top-three league table with a direct link to the full standings.
- [x] Preserve league switching, commissioner settings and pre-draft/live-draft entry points.
- [x] Scope live fixture scoring to the selected league and require league membership on the server.
- [x] Refresh Home automatically when relevant fixtures, rosters, waivers or transactions change.
- [x] Remove the development-only player-sync panel and legacy duplicate dashboard data paths.
- [x] Add the compact Balanced mobile layout selected during design review.
  - The fixture and lineup deadline share one compact card.
  - Lineup, waiver and trade status use a single horizontal strip.
  - Standings and activity reuse one switchable panel instead of extending the page.
  - Desktop retains its fuller side-by-side dashboard layout.
- [x] Add four account-synced, manager-controlled Home shortcuts.
  - Managers can choose and reorder their routes, or restore the recommended defaults.
  - The default routes are Trade Offers, Live Matches, Waivers and Transaction History.
  - Pending trade, waiver and live-match badges highlight action without moving shortcuts.
  - Direct links open the correct Waivers or Trade Offers section.

### Later Home bundles

- [x] Add a compact recent league activity feed using the existing transaction records.
  - Home shows the five latest waivers, free-agent signings and trades.
  - The compact feed and full Market transaction history share one activity source and formatting model.
  - Each Home entry links to the full filterable transaction history.
- [x] Add commissioner announcements with league-member visibility and commissioner-only management.
  - Commissioners can publish, edit, pin, mark urgent, expire and remove announcements.
  - Home uses a single compact announcement strip and opens the full message on demand.
  - The strip disappears when there is no active announcement, returning the space to Table/Activity.
  - The mobile Table/Activity panel expands into remaining screen height and shows more rows on taller phones.
- [x] Add an app-wide notification centre with manager preferences.
  - A bell and unread count are available from every main tab without increasing Home page length.
  - The inbox supports All/Unread filters, mark-all-read, clearing read items and deep links.
  - Database triggers create deduplicated notifications for commissioner announcements, trade activity and waiver outcomes.
  - Managers can independently enable or disable announcement, trade, waiver and future match notifications.
  - Inbox data and preferences are account-scoped and protected by row-level access rules.

## Pre-launch hardening

### Draft and transaction integrity

- [x] Secure waiver submission and waiver-priority reordering entirely on the server.
- [x] Guarantee a legal starting lineup after every flexible waiver or free-agent roster change.
- [x] Reject manual draft picks submitted after the authoritative server deadline.
- [x] Remove legacy client-side and direct-write fallback paths for draft and transaction changes.
- [x] Add repeatable lifecycle and concurrency regression tests for drafts, waivers, free agents, trades, lineups and autosubs.
  - Added a rollback-safe transaction hardening test for waiver ordering, cancellation, stale-order rejection, privilege boundaries and flexible-lineup repair.
  - Existing rollback tests continue to cover lineup deadlines and repeat-safe autosubs.
- [ ] Complete full pre-launch dress rehearsals using realistic leagues and concurrent managers.

### League fixture generation and league-average opponent

The implementation is complete in the working tree. Deployment and a realistic dress rehearsal remain outstanding.

- [x] Audit every fixture-generation entry point and consolidate generation behind one authoritative server function.
- [x] Guarantee that every real manager has exactly one fixture in every Gameweek.
- [x] For even-sized leagues, generate complete head-to-head rounds with no duplicate or self fixtures.
- [x] For odd-sized leagues, replace the rotating bye with exactly one manager-versus-league-average fixture per Gameweek.
- [x] Rotate the league-average opponent fairly so each manager faces it as evenly as the season length permits.
- [x] Define the league-average score as the mean of the other managers' scores, excluding the manager playing against it, so their own score cannot influence their opponent.
- [x] Define and consistently apply score precision, rounding and drawn-match rules for the league-average fixture.
  - FPL and DEFCON averages are rounded separately to the nearest whole point, then combined. Exact equal totals are draws.
- [x] Represent the league-average opponent explicitly without creating a fake user or league member.
- [x] Ensure live scoring, Match Centre, completed results, league standings and later waiver priority handle league-average fixtures correctly.
- [x] Balance repeated home and away assignments across the season where the schedule permits.
- [x] Make fixture generation repeat-safe and prevent regeneration after official season activity begins unless an authorised recovery action is used.
- [x] Add database validation and rollback-safe tests covering league sizes from 2 to 12, all Gameweeks, opponent rotation, home/away balance, invalid fixtures and manager double-booking.
- [x] Apply the fixture migration and deploy the updated live-stat synchronization function.
- [ ] Complete even- and odd-manager fixture dress rehearsals against the deployed environment.

### Live Gameweek and Match Centre

The implementation is complete in the working tree. It shares the fixture-generation deployment and still requires a live-data dress rehearsal.

- [x] Show every Gameweek fixture to every authenticated member of the league.
- [x] Let managers open any fixture and inspect both effective starting lineups.
  - Mobile uses a two-team lineup switcher with tappable team tabs and horizontal swiping, while desktop retains the side-by-side comparison.
- [x] Let managers open any player for a complete, reconciled live scoring breakdown.
  - The breakdown covers appearance, goals, assists, position-relevant clean-sheet and goals-conceded scoring, saves, penalties, cards, own goals, bonus and any official live adjustment.
  - FPL, DEFCON and combined totals are shown separately and reconcile to the fixture score.
  - DEFCON shows total defensive contributions plus CBI, recoveries and tackles.
- [x] Use the authoritative league Gameweek schedule instead of inferring the active Gameweek from player-stat rows.
- [x] Poll Match Centre and live standings every 30 seconds while a Gameweek is in play.
- [x] Trigger the server live-stat refresh every minute during an unfinished in-play Gameweek.
- [x] Show data freshness, stale-data warnings, retry states and provisional autosub messaging.
- [x] Show each manager's current-Gameweek score in the live standings table, with rank movement from the official table.
- [x] Preserve league-average fixture handling without creating a synthetic player lineup.
- [x] Apply the database migrations and deploy the updated live-stat synchronization function.
- [ ] Run a live dress rehearsal covering stat updates, provisional bonus, DEFCON, stale recovery, completed results, autosubs and standings finalisation.

## V2 / future development

- [ ] Explore draft grades and post-draft analysis after the V1 draft flow is established.
  - Decide whether analysis should be rules-based, AI-generated or a combination of both.
  - Define the grading criteria, data inputs, cost limits and how subjective results should be explained to managers.
  - Treat this as an optional enhancement rather than a launch requirement.
- [ ] Add native push delivery after notification categories and beta behaviour are proven.
  - Start with commissioner announcements, trade offers, waiver outcomes and draft reminders.
  - Keep granular manager preferences and avoid duplicate in-app/push alerts.
- [ ] Design a prominent League Lounge rather than hiding social features deep in League settings.
  - Include league messaging, commissioner moderation and unread state.
  - Add commissioner-managed podcast episodes or external links with optional notifications.
  - Decide retention, reporting and moderation rules before replacing existing league chat channels.
