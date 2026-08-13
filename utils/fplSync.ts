import { Platform } from 'react-native';
import { supabase } from './supabase';

// Official FPL API Endpoints
const FPL_DRAFT_BOOTSTRAP_API = 'https://draft.premierleague.com/api/bootstrap-static';
const FPL_FIXTURES_API = 'https://fantasy.premierleague.com/api/fixtures/';

interface FPLRawElement {
  id: number;
  first_name: string;
  second_name: string;
  element_type: number; // 1: GKP, 2: DEF, 3: MID, 4: FWD
  team: number;         // Draft team ID
  web_name: string;
  total_points: number;
  draft_rank?: number;
  code?: number;
}

interface FPLRawTeam {
  id: number;
  code: number;
  name: string;
  short_name?: string;
}

interface FPLRawFixture {
  id: number;
  event: number | null; // Gameweek round
  team_h: number;       // Team ID in standard FPL
  team_a: number;       // Team ID in standard FPL
  team_h_score: number | null;
  team_a_score: number | null;
  finished: boolean;
  kickoff_time: string;
  team_h_difficulty: number;
  team_a_difficulty: number;
}

const POSITION_MAP: Record<number, string> = {
  1: 'GKP',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

// Reliable static mapping to override unrefreshed Draft API team index data
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

/**
 * Platform-Aware API Dispatcher
 * On Web browsers, routes calls through the Supabase `fpl-proxy` Edge Function to bypass CORS.
 * On Native iOS/Android apps, fetches directly from official FPL endpoints.
 */
async function fetchFplEndpoint(endpointKey: string, nativeUrl: string) {
  if (Platform.OS === 'web') {
    const { data, error } = await supabase.functions.invoke('fpl-proxy', {
      body: { endpoint: endpointKey },
    });
    if (error) throw new Error(`Supabase Edge Proxy Error (${endpointKey}): ${error.message}`);
    return data;
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Custom FPL Draft App Sync Engine)',
    'Accept': 'application/json',
  };

  const response = await fetch(nativeUrl, { method: 'GET', headers });
  if (!response.ok) {
    throw new Error(`FPL API Endpoint rejected connection. Status: ${response.status}`);
  }
  return await response.json();
}

/**
 * Orchestrates a complete real-time ingestion loop, pulling data from official 
 * FPL Draft & FPL Fixtures endpoints and committing clean upserts into PostgreSQL.
 */
export async function synchronizeFplPlayerPool(): Promise<{ success: boolean; count: number; error?: string }> {
  console.log('[FPL-SYNC] Initializing executive data synchronization sequence...');

  try {
    // 1. Fetch live payload configurations in parallel
    const [data, fixturesData] = await Promise.all([
      fetchFplEndpoint('bootstrap-static', FPL_DRAFT_BOOTSTRAP_API),
      fetchFplEndpoint('fixtures', FPL_FIXTURES_API) as Promise<FPLRawFixture[]>,
    ]);

    const rawElements: FPLRawElement[] = data.elements || [];
    const rawTeams: FPLRawTeam[] = data.teams || [];

    if (rawElements.length === 0) {
      throw new Error('Ingested payload contains an empty player matrix.');
    }

    // 2. Build Team Lookup Dictionaries
    const teamLookupById: Record<number, { id: number; code: number; name: string; short: string }> = {};

    rawTeams.forEach((t: FPLRawTeam) => {
      teamLookupById[t.id] = {
        id: t.id,
        code: t.code,
        name: t.name,
        short: t.short_name || 'UNK',
      };
    });

    console.log(`[FPL-SYNC] Successfully fetched ${rawElements.length} raw records from FPL. Mapping schema...`);

    // 3. Map players using PL_TEAMS_STATIC as primary source to prevent unrefreshed API team leaks
    const mappedPlayers = rawElements.map((player) => {
      const teamIdNum = Number(player.team);
      const teamInfo =  teamLookupById[teamIdNum] || PL_TEAMS_STATIC[teamIdNum] || { id: teamIdNum, code: 0, name: 'Unknown Club', short: 'UNK' };

      return {
        id: player.id,
        code: player.code,
        first_name: player.first_name,
        second_name: player.second_name,
        web_name: player.web_name,
        photo_code: player.code,
        team_id: teamInfo.id,
        team_name: teamInfo.name,        // Explicit verified club name
        team_short_name: teamInfo.short, // Explicit verified short tag
        element_type: POSITION_MAP[player.element_type] || 'MID',
        total_points: player.total_points || 0,
        draft_rank: player.draft_rank || 999,
        is_active: true,
        updated_at: new Date().toISOString(),
      };
    });

    // 4. Map Fixtures using PL_TEAMS_STATIC
    const mappedFixtures = (fixturesData || [])
      .filter((f) => f.event !== null)
      .map((f) => {
        const homeTeam = teamLookupById[f.team_h] || PL_TEAMS_STATIC[f.team_h] ||  { id: f.team_h, name: 'Unknown', short: 'UNK' };
        const awayTeam = teamLookupById[f.team_a] || PL_TEAMS_STATIC[f.team_a] ||  { id: f.team_a, name: 'Unknown', short: 'UNK' };
        
        return {
          id: f.id,
          gameweek: f.event,
          home_team_id: homeTeam.id,       // Explicit Home Team ID
          away_team_id: awayTeam.id,       // Explicit Away Team ID
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

    // 5. Batch Upsert Players
    const BATCH_SIZE = 200;
    let successfulSyncCount = 0;

    for (let i = 0; i < mappedPlayers.length; i += BATCH_SIZE) {
      const chunk = mappedPlayers.slice(i, i + BATCH_SIZE);

      const { error: upsertError } = await supabase
        .from('players')
        .upsert(chunk, { onConflict: 'id' });

      if (upsertError) {
        console.error(`[FPL-SYNC] Database collision error on players batch block:`, upsertError);
        throw upsertError;
      }

      successfulSyncCount += chunk.length;
    }

    // 6. Upsert Fixtures
    if (mappedFixtures.length > 0) {
      const { error: fixturesError } = await supabase
        .from('fixtures')
        .upsert(mappedFixtures, { onConflict: 'id' });
        
      if (fixturesError) {
        console.warn('[FPL-SYNC] Fixtures upsert alert:', fixturesError.message);
      }
    }

    // 7. Resolve Current Active Gameweek cleanly
    let currentGameweek = 1;
    if (data.events && Array.isArray(data.events)) {
      const currentEvent = data.events.find((e: any) => e.is_current || e.is_next);
      if (currentEvent) currentGameweek = currentEvent.id;
    } else if (typeof data.current_event === 'number') {
      currentGameweek = data.current_event;
    }

    console.log(`[FPL-SYNC] Synchronizing matchday performance logs up to GW ${currentGameweek}...`);

    // 8. Fetch Matchday Live Stats Logs
    const activeGameweeks = Array.from({ length: currentGameweek }, (_, i) => i + 1);
    const CHUNK_SIZE = 3;

    for (let c = 0; c < activeGameweeks.length; c += CHUNK_SIZE) {
      const currentChunkGws = activeGameweeks.slice(c, c + CHUNK_SIZE);

      await Promise.all(
        currentChunkGws.map(async (gw) => {
          try {
            const endpointKey = `event/${gw}/live`;
            const nativeUrl = `https://draft.premierleague.com/api/event/${gw}/live`;
            
            const liveData = await fetchFplEndpoint(endpointKey, nativeUrl);
            const elementsMap = liveData?.elements || {};
            const elementKeys = Object.keys(elementsMap);

            if (elementKeys.length === 0) return;

            const mappedStats: any[] = [];

            for (const player of mappedPlayers) {
              const livePlayerRecord = elementsMap[player.id] || elementsMap[String(player.id)];
              if (!livePlayerRecord) continue;

              const stats = livePlayerRecord.stats || {};
              const explainArray = livePlayerRecord.explain || [];

              // Defensive stats parsing
              let clearances = stats.clearances || 0;
              let blocks = stats.blocks || 0;
              let interceptions = stats.interceptions || 0;
              let tackles = stats.tackles || 0;
              let ballRecoveries = stats.ball_recoveries || 0;

              // Fallback deep inspection if explain breakdown array exists
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
                  minutes: stats.minutes ?? 0,
                  starts: stats.starts ?? 0,
                  goals_scored: stats.goals_scored ?? 0,
                  assists: stats.assists ?? 0,
                  clean_sheets: stats.clean_sheets ?? 0,
                  goals_conceded: stats.goals_conceded ?? 0,
                  yellow_cards: stats.yellow_cards ?? 0,
                  red_cards: stats.red_cards ?? 0,
                  own_goals: stats.own_goals ?? 0,
                  saves: stats.saves ?? 0,
                  penalties_saved: stats.penalties_saved ?? 0,
                  expected_goals: Number(stats.expected_goals || 0),
                  expected_assists: Number(stats.expected_assists || 0),
                  expected_goal_involvements: Number(stats.expected_goal_involvements || 0),
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

              if (statsError) {
                console.error(`[FPL-SYNC] Error writing statistics for GW ${gw}:`, statsError.message);
              }
            }
          } catch (gwErr) {
            console.warn(`[FPL-SYNC] Failed parsing Live API entries for GW ${gw}:`, gwErr);
          }
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    console.log(`[FPL-SYNC] SUCCESS. Processed ${successfulSyncCount} players.`);
    return { success: true, count: successfulSyncCount };

  } catch (err: any) {
    const errorMessage = err.message || 'Unknown processing runtime failure.';
    console.error(`[FPL-SYNC] Executive script operation aborted: ${errorMessage}`);
    return { success: false, count: 0, error: errorMessage };
  }
}
