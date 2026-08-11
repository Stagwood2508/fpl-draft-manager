// Supabase Edge Function: sync-fpl-player-pool
//
// Pulls fresh player, team, fixture, and live-stats data from the official
// FPL Draft API and upserts it into Postgres. Players no longer returned by
// FPL are marked inactive so historical draft, roster and scoring links remain.
//
// ACCESS CONTROL:
// - Callable via the Supabase Dashboard "Invoke" button or the Supabase CLI
//   (both authenticate with the service role key, which is always allowed).
// - Callable from the app ONLY if the logged-in user's ID matches the
//   APP_OWNER_USER_ID Edge Function secret.
// - All other callers receive a 403.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ⚠️ Replace with your actual Supabase auth user UUID (Authentication → Users)
const FPL_DRAFT_BOOTSTRAP_API = 'https://draft.premierleague.com/api/bootstrap-static';
const FPL_FIXTURES_API = 'https://fantasy.premierleague.com/api/fixtures/';

const POSITION_MAP: Record<number, string> = {
  1: 'GKP',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

// Fallback only — used only if the live API response is somehow missing a team.
// The live API's own team list always takes priority over this.
const PL_TEAMS_STATIC: Record<number, { id: number; name: string; short: string }> = {
  1:  { id: 1,  name: 'Arsenal',                short: 'ARS' },
  2:  { id: 2,  name: 'Aston Villa',            short: 'AVL' },
  3:  { id: 3,  name: 'Bournemouth',            short: 'BOU' },
  4:  { id: 4,  name: 'Brentford',              short: 'BRE' },
  5:  { id: 5,  name: 'Brighton & Hove Albion', short: 'BHA' },
  6:  { id: 6,  name: 'Chelsea',                short: 'CHE' },
  7:  { id: 7,  name: 'Coventry City',          short: 'COV' },
  8:  { id: 8,  name: 'Crystal Palace',         short: 'CRY' },
  9:  { id: 9,  name: 'Everton',                short: 'EVE' },
  10: { id: 10, name: 'Fulham',                 short: 'FUL' },
  11: { id: 11, name: 'Hull City',              short: 'HUL' },
  12: { id: 12, name: 'Ipswich Town',           short: 'IPS' },
  13: { id: 13, name: 'Leeds United',           short: 'LEE' },
  14: { id: 14, name: 'Liverpool',              short: 'LIV' },
  15: { id: 15, name: 'Manchester City',        short: 'MCI' },
  16: { id: 16, name: 'Manchester United',      short: 'MUN' },
  17: { id: 17, name: 'Newcastle United',       short: 'NCL' },
  18: { id: 18, name: 'Nottingham Forest',      short: 'NFO' },
  19: { id: 19, name: 'Sunderland',             short: 'SUN' },
  20: { id: 20, name: 'Tottenham Hotspur',      short: 'TOT' },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const appOwnerUserId = Deno.env.get('APP_OWNER_USER_ID');

  // --- ACCESS CONTROL ---
  const authHeader = req.headers.get('Authorization') || '';
  const bearerToken = authHeader.replace('Bearer ', '').trim();

  const isServiceRoleCall = bearerToken === serviceRoleKey;

  if (!isServiceRoleCall) {
    // Not called with the service role key — check if it's the app owner's own session.
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await callerClient.auth.getUser();

    if (userError || !user || !appOwnerUserId || user.id !== appOwnerUserId) {
      return jsonResponse({ success: false, error: 'FORBIDDEN: Only the app owner can trigger this sync.' }, 403);
    }
  }

  // --- SYNC LOGIC (runs with full service-role permissions) ---
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    console.log('[FPL-SYNC] Starting sync...');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (FPL Draft Manager Sync Engine)',
      'Accept': 'application/json',
    };

    const [bootstrapRes, fixturesRes] = await Promise.all([
      fetch(FPL_DRAFT_BOOTSTRAP_API, { headers }),
      fetch(FPL_FIXTURES_API, { headers }),
    ]);

    if (!bootstrapRes.ok || !fixturesRes.ok) {
      throw new Error(`FPL API rejected the request. Bootstrap: ${bootstrapRes.status}, Fixtures: ${fixturesRes.status}`);
    }

    const data = await bootstrapRes.json();
    const fixturesData = await fixturesRes.json();

    const rawElements = data.elements || [];
    const rawTeams = data.teams || [];

    if (rawElements.length === 0) {
      throw new Error('FPL API returned an empty player list — aborting to avoid wiping the player pool.');
    }

    // Safety threshold: the Premier League always has 20 clubs and several hundred
    // registered players. If the API returns suspiciously few, abort before any delete runs.
    if (rawElements.length < 300) {
      throw new Error(`FPL API returned only ${rawElements.length} players — this looks incomplete. Aborting before any changes are made.`);
    }

    // Build team lookup from THIS sync's live data — takes priority over the static fallback.
    const teamLookupById: Record<number, { id: number; name: string; short: string }> = {};
    rawTeams.forEach((t: any) => {
      teamLookupById[t.id] = { id: t.id, name: t.name, short: t.short_name || 'UNK' };
    });

    const mappedPlayers = rawElements.map((player: any) => {
      const teamIdNum = Number(player.team);
      // Live API data first, static map only as a last-resort fallback.
      const teamInfo = teamLookupById[teamIdNum] || PL_TEAMS_STATIC[teamIdNum] || { id: teamIdNum, name: 'Unknown Club', short: 'UNK' };

      return {
        id: player.id,
        code: player.code,
        first_name: player.first_name,
        second_name: player.second_name,
        web_name: player.web_name,
        photo_code: player.code,
        team_id: teamInfo.id,
        team_name: teamInfo.name,
        team_short_name: teamInfo.short,
        element_type: POSITION_MAP[player.element_type] || 'MID',
        total_points: player.total_points || 0,
        draft_rank: player.draft_rank || 999,
        is_active: true,
        updated_at: new Date().toISOString(),
      };
    });

    const mappedFixtures = (fixturesData || [])
      .filter((f: any) => f.event !== null)
      .map((f: any) => {
        const homeTeam = teamLookupById[f.team_h] || PL_TEAMS_STATIC[f.team_h] || { id: f.team_h, name: 'Unknown', short: 'UNK' };
        const awayTeam = teamLookupById[f.team_a] || PL_TEAMS_STATIC[f.team_a] || { id: f.team_a, name: 'Unknown', short: 'UNK' };

        return {
          id: f.id,
          gameweek: f.event,
          home_team_id: homeTeam.id,
          away_team_id: awayTeam.id,
          home_team_name: homeTeam.name,
          away_team_name: awayTeam.name,
          home_team_short: homeTeam.short,
          away_team_short: awayTeam.short,
          home_score: f.team_h_score,
          away_score: f.team_a_score,
          kickoff_time: f.kickoff_time,
          home_difficulty: f.team_h_difficulty,
          away_difficulty: f.team_a_difficulty,
          is_finished: f.finished,
        };
      });

    // Batch upsert players
    const BATCH_SIZE = 200;
    let successfulSyncCount = 0;

    for (let i = 0; i < mappedPlayers.length; i += BATCH_SIZE) {
      const chunk = mappedPlayers.slice(i, i + BATCH_SIZE);
      const { error: upsertError } = await supabase.from('players').upsert(chunk, { onConflict: 'id' });
      if (upsertError) throw upsertError;
      successfulSyncCount += chunk.length;
    }

    // Preserve historical roster and draft references while removing stale
    // players from all future player-selection pools.
    const currentPlayerIds = mappedPlayers.map((p: any) => p.id);
    const { error: cleanupError, count: deactivatedCount } = await supabase
      .from('players')
      .update({ is_active: false, updated_at: new Date().toISOString() }, { count: 'exact' })
      .eq('is_active', true)
      .not('id', 'in', `(${currentPlayerIds.join(',')})`);

    if (cleanupError) {
      console.warn('[FPL-SYNC] Cleanup of stale players failed:', cleanupError.message);
    } else {
      console.log(`[FPL-SYNC] Deactivated ${deactivatedCount ?? 0} stale players.`);
    }

    // Upsert fixtures
    if (mappedFixtures.length > 0) {
      const { error: fixturesError } = await supabase.from('fixtures').upsert(mappedFixtures, { onConflict: 'id' });
      if (fixturesError) console.warn('[FPL-SYNC] Fixtures upsert warning:', fixturesError.message);
    }

    // Resolve current gameweek
    let currentGameweek = 1;
    if (data.events && Array.isArray(data.events)) {
      const currentEvent = data.events.find((e: any) => e.is_current || e.is_next);
      if (currentEvent) currentGameweek = currentEvent.id;
    } else if (typeof data.current_event === 'number') {
      currentGameweek = data.current_event;
    }

    // Sync live gameweek stats
    const activeGameweeks = Array.from({ length: currentGameweek }, (_, i) => i + 1);
    const CHUNK_SIZE = 3;

    for (let c = 0; c < activeGameweeks.length; c += CHUNK_SIZE) {
      const currentChunkGws = activeGameweeks.slice(c, c + CHUNK_SIZE);

      await Promise.all(
        currentChunkGws.map(async (gw) => {
          try {
            const liveRes = await fetch(`https://draft.premierleague.com/api/event/${gw}/live`, { headers });
            if (!liveRes.ok) return;
            const liveData = await liveRes.json();
            const elementsMap = liveData?.elements || {};

            const mappedStats: any[] = [];

            for (const player of mappedPlayers) {
              const livePlayerRecord = elementsMap[player.id] || elementsMap[String(player.id)];
              if (!livePlayerRecord) continue;

              const stats = livePlayerRecord.stats || {};
              const explainArray = livePlayerRecord.explain || [];

              let clearances = stats.clearances || 0;
              let blocks = stats.blocks || 0;
              let interceptions = stats.interceptions || 0;
              let tackles = stats.tackles || 0;
              let ballRecoveries = stats.ball_recoveries || 0;

              if (Array.isArray(explainArray)) {
                explainArray.forEach((match: any) => {
                  if (match && Array.isArray(match.stats)) {
                    match.stats.forEach((s: any) => {
                      if (s.identifier === 'clearances') clearances = Math.max(clearances, s.value || 0);
                      if (s.identifier === 'blocks') blocks = Math.max(blocks, s.value || 0);
                      if (s.identifier === 'interceptions') interceptions = Math.max(interceptions, s.value || 0);
                      if (s.identifier === 'tackles') tackles = Math.max(tackles, s.value || 0);
                      if (s.identifier === 'ball_recoveries') ballRecoveries = Math.max(ballRecoveries, s.value || 0);
                    });
                  }
                });
              }

              if ((stats.minutes || 0) > 0 || (stats.total_points || 0) !== 0 || clearances > 0 || tackles > 0 || ballRecoveries > 0) {
                mappedStats.push({
                  player_id: player.id,
                  gameweek: gw,
                  minutes_played: stats.minutes ?? 0,
                  goals_scored: stats.goals_scored ?? 0,
                  assists: stats.assists ?? 0,
                  clean_sheets: stats.clean_sheets ?? 0,
                  goals_conceded: stats.goals_conceded ?? 0,
                  yellow_cards: stats.yellow_cards ?? 0,
                  red_cards: stats.red_cards ?? 0,
                  own_goals: stats.own_goals ?? 0,
                  saves: stats.saves ?? 0,
                  penalties_saved: stats.penalties_saved ?? 0,
                  clearances,
                  blocks,
                  interceptions,
                  tackles,
                  ball_recoveries: ballRecoveries,
                  total_points: stats.total_points ?? 0,
                  bonus: stats.bonus ?? 0,
                });
              }
            }

            if (mappedStats.length > 0) {
              const { error: statsError } = await supabase
                .from('player_gameweek_stats')
                .upsert(mappedStats, { onConflict: 'player_id,gameweek' });
              if (statsError) console.error(`[FPL-SYNC] Stats write error GW ${gw}:`, statsError.message);
            }
          } catch (gwErr) {
            console.warn(`[FPL-SYNC] Failed GW ${gw}:`, gwErr);
          }
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    console.log(`[FPL-SYNC] SUCCESS. Processed ${successfulSyncCount} players. Deactivated ${deactivatedCount ?? 0} stale.`);

    return jsonResponse({
      success: true,
      count: successfulSyncCount,
      deactivated: deactivatedCount ?? 0,
    });
  } catch (err: any) {
    console.error('[FPL-SYNC] Failed:', err.message);
    return jsonResponse({ success: false, error: err.message || 'Unknown sync failure.' }, 500);
  }
});
