# Change Backlog

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

- [x] Support rank and points sorting.
- [x] Expand the player detail view with richer draft-relevant information, including a previous-season scouting card.
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

## Remaining work for V1

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

This bundle follows the draft and transaction integrity work above. The existing odd-manager bye behaviour is temporary; the intended rule is a fixture against the league average.

- [ ] Audit every fixture-generation entry point and consolidate generation behind one authoritative server function.
- [ ] Guarantee that every real manager has exactly one fixture in every Gameweek.
- [ ] For even-sized leagues, generate complete head-to-head rounds with no duplicate or self fixtures.
- [ ] For odd-sized leagues, replace the rotating bye with exactly one manager-versus-league-average fixture per Gameweek.
- [ ] Rotate the league-average opponent fairly so each manager faces it as evenly as the season length permits.
- [ ] Define the league-average score as the mean of the other managers' scores, excluding the manager playing against it, so their own score cannot influence their opponent.
- [ ] Define and consistently apply score precision, rounding and drawn-match rules for the league-average fixture.
- [ ] Represent the league-average opponent explicitly without creating a fake user or league member.
- [ ] Ensure live scoring, Match Centre, completed results and league standings all handle league-average fixtures correctly.
- [ ] Balance home and away assignments across the season where the schedule permits.
- [ ] Make fixture generation repeat-safe and prevent regeneration after official season activity begins unless an authorised recovery action is used.
- [ ] Add database validation and automated tests covering even and odd league sizes, all Gameweeks, duplicate fixtures, missing fixtures and manager double-booking.

## V2 / future development

- [ ] Explore draft grades and post-draft analysis after the V1 draft flow is established.
  - Decide whether analysis should be rules-based, AI-generated or a combination of both.
  - Define the grading criteria, data inputs, cost limits and how subjective results should be explained to managers.
  - Treat this as an optional enhancement rather than a launch requirement.
