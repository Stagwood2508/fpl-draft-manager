import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const requestHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
};

const positionByElementType: Record<number, string> = {
  1: "GKP",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

const flattenExplanationStats = (value: unknown): any[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenExplanationStats(entry));
  }

  if (!value || typeof value !== "object") return [];

  const entry = value as Record<string, unknown>;
  const isScoringEntry = typeof entry.stat === "string" ||
    typeof entry.identifier === "string";

  return [
    ...(isScoringEntry ? [entry] : []),
    ...Object.values(entry).flatMap((child) => flattenExplanationStats(child)),
  ];
};

const previousSeasonLabel = () => {
  const now = new Date();
  const endingYear = now.getUTCMonth() >= 6
    ? now.getUTCFullYear()
    : now.getUTCFullYear() - 1;
  return `${endingYear - 1}/${String(endingYear).slice(-2)}`;
};

const fetchJsonWithRetry = async (url: string, attempts = 4): Promise<any> => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: requestHeaders });
      if (response.ok) return await response.json();
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`FPL API responded with status ${response.status}`);
      }
      lastError = new Error(`FPL API responded with status ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 350));
    }
  }

  throw lastError || new Error("FPL API request failed");
};

const syncSeasonHistory = async (
  supabase: ReturnType<typeof createClient>,
  seasonName: string,
) => {
  const [draftBootstrap, standardBootstrap] = await Promise.all([
    fetchJsonWithRetry("https://draft.premierleague.com/api/bootstrap-static"),
    fetchJsonWithRetry("https://fantasy.premierleague.com/api/bootstrap-static/"),
  ]);

  const draftPlayers = Array.isArray(draftBootstrap?.elements)
    ? draftBootstrap.elements
    : [];
  const standardPlayers = Array.isArray(standardBootstrap?.elements)
    ? standardBootstrap.elements
    : [];
  const standardByCode = new Map<number, any>(
    standardPlayers.map((player: any) => [Number(player.code), player]),
  );

  let imported = 0;
  let noHistory = 0;
  let failed = 0;
  const failures: Array<{ player_code: number; reason: string }> = [];
  const batchSize = 10;

  for (let offset = 0; offset < draftPlayers.length; offset += batchSize) {
    const batch = draftPlayers.slice(offset, offset + batchSize);
    const results = await Promise.all(batch.map(async (draftPlayer: any) => {
      const playerCode = Number(draftPlayer.code);
      const standardPlayer = standardByCode.get(playerCode);
      if (!standardPlayer) {
        return { status: "failed", playerCode, reason: "No standard FPL code match" };
      }

      try {
        const summary = await fetchJsonWithRetry(
          `https://fantasy.premierleague.com/api/element-summary/${standardPlayer.id}/`,
        );
        const history = (Array.isArray(summary?.history_past) ? summary.history_past : [])
          .find((row: any) => row.season_name === seasonName);

        if (!history) return { status: "no_history", playerCode };

        return {
          status: "ready",
          row: {
            player_code: playerCode,
            current_player_id: Number(draftPlayer.id),
            standard_fpl_element_id: Number(standardPlayer.id),
            season_name: seasonName,
            start_cost: Number(history.start_cost || 0),
            end_cost: Number(history.end_cost || 0),
            total_points: Number(history.total_points || 0),
            minutes: Number(history.minutes || 0),
            starts: Number(history.starts || 0),
            goals_scored: Number(history.goals_scored || 0),
            assists: Number(history.assists || 0),
            clean_sheets: Number(history.clean_sheets || 0),
            goals_conceded: Number(history.goals_conceded || 0),
            own_goals: Number(history.own_goals || 0),
            penalties_saved: Number(history.penalties_saved || 0),
            penalties_missed: Number(history.penalties_missed || 0),
            yellow_cards: Number(history.yellow_cards || 0),
            red_cards: Number(history.red_cards || 0),
            saves: Number(history.saves || 0),
            bonus: Number(history.bonus || 0),
            bps: Number(history.bps || 0),
            influence: Number(history.influence || 0),
            creativity: Number(history.creativity || 0),
            threat: Number(history.threat || 0),
            ict_index: Number(history.ict_index || 0),
            clearances_blocks_interceptions: Number(history.clearances_blocks_interceptions || 0),
            recoveries: Number(history.recoveries || 0),
            tackles: Number(history.tackles || 0),
            defensive_contribution: Number(history.defensive_contribution || 0),
            expected_goals: Number(history.expected_goals || 0),
            expected_assists: Number(history.expected_assists || 0),
            expected_goal_involvements: Number(history.expected_goal_involvements || 0),
            expected_goals_conceded: Number(history.expected_goals_conceded || 0),
            source_synced_at: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          status: "failed",
          playerCode,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }));

    const rows = results
      .filter((result: any) => result.status === "ready")
      .map((result: any) => result.row);
    noHistory += results.filter((result: any) => result.status === "no_history").length;

    results.filter((result: any) => result.status === "failed").forEach((result: any) => {
      failed += 1;
      if (failures.length < 20) {
        failures.push({ player_code: result.playerCode, reason: result.reason });
      }
    });

    if (rows.length > 0) {
      const { error } = await supabase
        .from("player_season_stats")
        .upsert(rows, { onConflict: "player_code,season_name" });
      if (error) throw error;
      imported += rows.length;
    }

    if (offset + batchSize < draftPlayers.length) {
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }

  return {
    success: failed === 0,
    mode: "history",
    season: seasonName,
    players_checked: draftPlayers.length,
    records_imported: imported,
    no_history: noHistory,
    failed,
    failures,
  };
};

const syncPlayerAvailability = async (
  supabase: ReturnType<typeof createClient>,
) => {
  const bootstrapData = await fetchJsonWithRetry(
    "https://draft.premierleague.com/api/bootstrap-static",
  );
  const players = Array.isArray(bootstrapData?.elements) ? bootstrapData.elements : [];
  const teams = Array.isArray(bootstrapData?.teams) ? bootstrapData.teams : [];

  if (players.length < 300) {
    throw new Error(
      `Draft bootstrap returned only ${players.length} players; availability sync aborted safely.`,
    );
  }

  const teamById = new Map<number, any>(
    teams.map((team: any) => [Number(team.id), team]),
  );
  const updatedAt = new Date().toISOString();
  const rows = players.map((player: any) => {
    const team = teamById.get(Number(player.team));
    return {
      id: Number(player.id),
      code: Number(player.code),
      first_name: player.first_name || "",
      second_name: player.second_name || "",
      web_name: player.web_name || player.second_name || `Player ${player.id}`,
      photo_code: Number(player.code),
      team_id: Number(player.team),
      team_name: team?.name || "Unknown Club",
      team_short_name: team?.short_name || "UNK",
      element_type: positionByElementType[Number(player.element_type)] || "MID",
      total_points: Number(player.total_points || 0),
      draft_rank: Number(player.draft_rank || 999),
      status: String(player.status || "a").toLowerCase(),
      news: String(player.news || ""),
      chance_of_playing_this_round: player.chance_of_playing_this_round == null
        ? null
        : Number(player.chance_of_playing_this_round),
      chance_of_playing_next_round: player.chance_of_playing_next_round == null
        ? null
        : Number(player.chance_of_playing_next_round),
      news_added: player.news_added || null,
      is_active: true,
      updated_at: updatedAt,
    };
  });

  for (let offset = 0; offset < rows.length; offset += 200) {
    const { error } = await supabase
      .from("players")
      .upsert(rows.slice(offset, offset + 200), { onConflict: "id" });
    if (error) throw error;
  }

  return {
    success: true,
    mode: "players",
    players_updated: rows.length,
    flagged_players: rows.filter((player: any) =>
      player.status !== "a" ||
      (player.chance_of_playing_this_round != null && player.chance_of_playing_this_round < 100)
    ).length,
    updated_at: updatedAt,
  };
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const configuredCronSecret = Deno.env.get("LIVE_STATS_CRON_SECRET");
    const suppliedCronSecret = req.headers.get("x-cron-secret");

    if (!configuredCronSecret || suppliedCronSecret !== configuredCronSecret) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, string>;
    const supabaseSecretKey =
      secretKeys.custom_fpl_app_secretkey2808 || Object.values(secretKeys)[0];

    if (!supabaseSecretKey) {
      throw new Error("SUPABASE_SECRET_KEYS is not configured.");
    }

    const supabase = createClient(supabaseUrl, supabaseSecretKey);

    // History imports use the same secret-protected endpoint as live-stat sync.
    const url = new URL(req.url);
    if (url.searchParams.get("mode") === "history") {
      const result = await syncSeasonHistory(
        supabase,
        url.searchParams.get("season") || previousSeasonLabel(),
      );
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: result.failed === 0 ? 200 : 207,
      });
    }

    if (url.searchParams.get("mode") === "players") {
      const result = await syncPlayerAvailability(supabase);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 1. Parse target gameweek from URL query params or JSON body (default to GW1)
    let gameweek = url.searchParams.get("gameweek");

    if (!gameweek && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      gameweek = body.gameweek;
    }

    const gwNumber = gameweek ? parseInt(gameweek, 10) : 1;

    if (!Number.isInteger(gwNumber) || gwNumber < 1 || gwNumber > 38) {
      throw new Error("Invalid gameweek");
    }

    // 2. The standard FPL event feed updates in play and becomes the
    // authoritative final record once its Gameweek is marked finished. Draft
    // player ids are resolved by the stable player code. Keep the Draft live
    // endpoint only as a continuity fallback if the standard endpoint fails.
    const standardLiveUrl = `https://fantasy.premierleague.com/api/event/${gwNumber}/live/`;
    const draftLiveUrl = `https://draft.premierleague.com/api/event/${gwNumber}/live`;

    const [bootstrapData, standardBootstrapData] = await Promise.all([
      fetchJsonWithRetry("https://draft.premierleague.com/api/bootstrap-static"),
      fetchJsonWithRetry("https://fantasy.premierleague.com/api/bootstrap-static/"),
    ]);

    let liveData: any;
    let liveStatsSource: "standard_fpl" | "draft_fallback" = "standard_fpl";
    try {
      console.log(`Fetching in-play stats from: ${standardLiveUrl}`);
      liveData = await fetchJsonWithRetry(standardLiveUrl);
      if (!Array.isArray(liveData?.elements) || liveData.elements.length < 300) {
        throw new Error("Standard FPL live response was incomplete");
      }
    } catch (standardLiveError) {
      console.warn(
        "Standard FPL live feed unavailable; using Draft fallback:",
        standardLiveError instanceof Error ? standardLiveError.message : String(standardLiveError),
      );
      liveData = await fetchJsonWithRetry(draftLiveUrl);
      liveStatsSource = "draft_fallback";
    }

    const elements = liveData?.elements;

    // The Draft API can add players after the separate player-pool import has
    // run. Reconcile identities first so one new player cannot violate the
    // player_gameweek_stats foreign key and roll back every live score.
    const bootstrapPlayers = Array.isArray(bootstrapData?.elements)
      ? bootstrapData.elements
      : [];
    const bootstrapTeams = Array.isArray(bootstrapData?.teams)
      ? bootstrapData.teams
      : [];

    if (bootstrapPlayers.length < 300) {
      throw new Error(
        `Draft bootstrap returned only ${bootstrapPlayers.length} players; live sync aborted safely.`,
      );
    }

    const teamById = new Map<number, any>(
      bootstrapTeams.map((team: any) => [Number(team.id), team]),
    );
    const playerSyncTimestamp = new Date().toISOString();
    const mappedBootstrapPlayers = bootstrapPlayers.map((player: any) => {
      const team = teamById.get(Number(player.team));
      return {
        id: Number(player.id),
        code: Number(player.code),
        first_name: player.first_name || "",
        second_name: player.second_name || "",
        web_name: player.web_name || player.second_name || `Player ${player.id}`,
        photo_code: Number(player.code),
        team_id: Number(player.team),
        team_name: team?.name || "Unknown Club",
        team_short_name: team?.short_name || "UNK",
        element_type: positionByElementType[Number(player.element_type)] || "MID",
        total_points: Number(player.total_points || 0),
        draft_rank: Number(player.draft_rank || 999),
        status: String(player.status || "a").toLowerCase(),
        news: String(player.news || ""),
        chance_of_playing_this_round: player.chance_of_playing_this_round == null
          ? null
          : Number(player.chance_of_playing_this_round),
        chance_of_playing_next_round: player.chance_of_playing_next_round == null
          ? null
          : Number(player.chance_of_playing_next_round),
        news_added: player.news_added || null,
        is_active: true,
        updated_at: playerSyncTimestamp,
      };
    });

    const playerBatchSize = 200;
    for (let offset = 0; offset < mappedBootstrapPlayers.length; offset += playerBatchSize) {
      const { error: playerSyncError } = await supabase
        .from("players")
        .upsert(
          mappedBootstrapPlayers.slice(offset, offset + playerBatchSize),
          { onConflict: "id" },
        );
      if (playerSyncError) throw playerSyncError;
    }

    const currentDraftPlayerIds = new Set<number>(
      mappedBootstrapPlayers.map((player: any) => Number(player.id)),
    );
    const draftPlayerIdByCode = new Map<number, number>(
      mappedBootstrapPlayers.map((player: any) => [Number(player.code), Number(player.id)]),
    );
    const standardPlayers = Array.isArray(standardBootstrapData?.elements)
      ? standardBootstrapData.elements
      : [];
    const standardPlayerById = new Map<number, any>(
      standardPlayers.map((player: any) => [Number(player.id), player]),
    );

    if (liveStatsSource === "standard_fpl" && standardPlayers.length < 300) {
      throw new Error(
        `Standard FPL bootstrap returned only ${standardPlayers.length} players; live sync aborted safely.`,
      );
    }

    if (!elements || Object.keys(elements).length === 0) {
      console.log(`No live player data is available for GW${gwNumber}; schedule sync will continue.`);
    }

    // 3. Transform API response into database rows
    const rowsToUpsert = [];
    let unmappedLivePlayers = 0;

    const livePlayerEntries: Array<[string, any]> = Array.isArray(elements)
      ? elements
          .map((player: any) => [String(player?.id ?? player?.element ?? ""), player] as [string, any])
          .filter(([playerId]) => /^\d+$/.test(playerId))
      : Object.entries(elements || {});

    for (const [playerIdStr, playerObj] of livePlayerEntries) {
      const sourcePlayerId = parseInt(playerIdStr, 10);
      const playerId = liveStatsSource === "standard_fpl"
        ? draftPlayerIdByCode.get(Number(standardPlayerById.get(sourcePlayerId)?.code))
        : sourcePlayerId;

      if (!playerId) {
        unmappedLivePlayers += 1;
        continue;
      }
      if (!currentDraftPlayerIds.has(playerId)) {
        unmappedLivePlayers += 1;
        continue;
      }

      const livePlayer = playerObj as any;
      const stats = livePlayer.stats || {};
      const explain = Array.isArray(livePlayer.explain) ? livePlayer.explain : [];
      const explanationStats = flattenExplanationStats(explain);

      let clearances = Number(stats.clearances || 0);
      let blocks = Number(stats.blocks || 0);
      let interceptions = Number(stats.interceptions || 0);
      let tackles = Number(stats.tackles || 0);
      let recoveries = Number(stats.recoveries ?? stats.ball_recoveries ?? 0);

      explanationStats.forEach((entry: any) => {
        const identifier = entry?.identifier || entry?.stat;
        const value = Number(entry?.value || 0);
        if (identifier === "clearances") clearances = Math.max(clearances, value);
        if (identifier === "blocks") blocks = Math.max(blocks, value);
        if (identifier === "interceptions") interceptions = Math.max(interceptions, value);
        if (identifier === "tackles") tackles = Math.max(tackles, value);
        if (identifier === "ball_recoveries" || identifier === "recoveries") {
          recoveries = Math.max(recoveries, value);
        }
      });

      const cbi = Number(stats.clearances_blocks_interceptions ?? (clearances + blocks + interceptions));
      const defContribution = stats.defensive_contribution ?? (cbi + recoveries + tackles);
      const officialTotalPoints = Number(stats.total_points || 0);
      const officialDefconPoints = explanationStats
        .filter((entry: any) => (entry?.identifier || entry?.stat) === "defensive_contribution")
        .reduce((total: number, entry: any) => total + Number(entry?.points || 0), 0);

      rowsToUpsert.push({
        player_id: playerId,
        gameweek: gwNumber,
        // Official FPL now includes its own defensive-contribution award in
        // total_points. Custom leagues replace that award with their configured
        // DEFCON tiers, so persist the base score with the official award removed.
        total_points: officialTotalPoints - officialDefconPoints,
        official_total_points: officialTotalPoints,
        official_defcon_points: officialDefconPoints,
        minutes: stats.minutes ?? 0,
        starts: stats.starts ?? 0,
        goals_scored: stats.goals_scored ?? 0,
        assists: stats.assists ?? 0,
        clean_sheets: stats.clean_sheets ?? 0,
        goals_conceded: stats.goals_conceded ?? 0,
        own_goals: stats.own_goals ?? 0,
        penalties_saved: stats.penalties_saved ?? 0,
        penalties_missed: stats.penalties_missed ?? 0,
        yellow_cards: stats.yellow_cards ?? 0,
        red_cards: stats.red_cards ?? 0,
        saves: stats.saves ?? 0,
        bonus: stats.bonus ?? 0,
        bps: stats.bps ?? 0,
        clearances_blocks_interceptions: cbi,
        recoveries: recoveries,
        tackles: tackles,
        defensive_contribution: defContribution,
        influence: parseFloat(stats.influence || "0.0"),
        creativity: parseFloat(stats.creativity || "0.0"),
        threat: parseFloat(stats.threat || "0.0"),
        ict_index: parseFloat(stats.ict_index || "0.0"),
        expected_goals: parseFloat(stats.expected_goals || "0.0"),
        expected_assists: parseFloat(stats.expected_assists || "0.0"),
        expected_goal_involvements: parseFloat(stats.expected_goal_involvements || "0.0"),
        updated_at: new Date().toISOString(),
      });
    }

    // The standard bootstrap is the finalization authority. Its `finished`
    // state is what permits autosubs and immutable fixture settlement below.
    const eventRows = Array.isArray(standardBootstrapData?.events)
      ? standardBootstrapData.events
      : [];
    const hasCurrentEvent = eventRows.some((event: any) => Boolean(event?.is_current));
    const targetEvent = eventRows.find((event: any) => Number(event?.id) === gwNumber);

    const gameweekRows = eventRows
      .filter((event: any) => event?.id && event?.deadline_time)
      .map((event: any) => ({
        gameweek_number: Number(event.id),
        fpl_deadline_time: event.deadline_time,
        is_current: Boolean(event.is_current || (!hasCurrentEvent && event.is_next)),
        is_finished: Boolean(event.finished),
      }));

    if (gameweekRows.length > 0) {
      const { error: scheduleError } = await supabase
        .from("gameweeks")
        .upsert(gameweekRows, { onConflict: "gameweek_number" });

      if (scheduleError) {
        throw scheduleError;
      }

      const { error: leagueScheduleError } = await supabase.rpc(
        "refresh_league_gameweek_schedule",
      );
      if (leagueScheduleError) {
        throw leagueScheduleError;
      }
    }

// 5. Perform bulk UPSERT into player_gameweek_stats
    if (rowsToUpsert.length > 0) {
      const statsBatchSize = 200;
      for (let offset = 0; offset < rowsToUpsert.length; offset += statsBatchSize) {
        const { error } = await supabase
          .from("player_gameweek_stats")
          .upsert(
            rowsToUpsert.slice(offset, offset + statsBatchSize),
            { onConflict: "player_id,gameweek" },
          );

        if (error) {
          console.error("Supabase upsert error:", error);
          throw error;
        }
      }
    }

    // 6. Process only after the master gameweek has finished. The RPC is
    // repeat-safe and never mutates the manager's current roster.
    console.log(`Evaluating deadline snapshots and auto-subs for GW${gwNumber}...`);
    const { data: autoSubData, error: autoSubError } = await supabase.rpc(
      "process_auto_subs",
      { p_gameweek: gwNumber }
    );

    let fixtureFinalizationData = null;
    let cupFinalizationData = null;
    if (autoSubError) {
      console.error("Auto-sub processing error:", autoSubError.message);
    } else {
      console.log(`Auto-subs evaluated. ${autoSubData?.length || 0} recorded swaps.`);

      const { data: finalizationData, error: finalizationError } = await supabase.rpc(
        "finalize_gameweek_fixture_scores",
        { p_gameweek: gwNumber }
      );

      if (finalizationError) {
        console.error("Fixture finalization error:", finalizationError.message);
      } else {
        fixtureFinalizationData = finalizationData;
        if (finalizationData?.success) {
          console.log(`Finalized ${finalizationData.fixtures_finalized || 0} league fixtures.`);

          const { data: finalizedCups, error: cupFinalizationError } = await supabase.rpc(
            "finalize_cup_gameweek",
            { p_gameweek: gwNumber },
          );

          if (cupFinalizationError) {
            console.error("Cup finalization error:", cupFinalizationError.message);
          } else {
            cupFinalizationData = finalizedCups;
            console.log(
              `Finalized ${finalizedCups?.fixtures_finalized || 0} cup fixtures.`,
            );
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        gameweek: gwNumber,
        live_stats_source: liveStatsSource,
        gameweek_finished: Boolean(targetEvent?.finished),
        scoring_state: targetEvent?.finished ? "FINAL" : "PROVISIONAL",
        records_processed: rowsToUpsert.length,
        players_reconciled: mappedBootstrapPlayers.length,
        unmapped_live_players: unmappedLivePlayers,
        schedule_records: gameweekRows.length,
        fixture_finalization: fixtureFinalizationData,
        cup_finalization: cupFinalizationData,
        message: `Successfully synced live stats for GW${gwNumber}`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err: any) {
    console.error("Error in sync-live-stats function:", err.message);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
