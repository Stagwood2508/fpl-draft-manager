import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const requestHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
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

    // 2. Fetch live data from official FPL Draft API
    const draftApiUrl = `https://draft.premierleague.com/api/event/${gwNumber}/live`;
    console.log(`Fetching live stats from: ${draftApiUrl}`);

    const [fplResponse, bootstrapResponse] = await Promise.all([
      fetch(draftApiUrl, { headers: requestHeaders }),
      fetch("https://draft.premierleague.com/api/bootstrap-static", { headers: requestHeaders }),
    ]);

    if (!fplResponse.ok) {
      throw new Error(`Draft API responded with status: ${fplResponse.status}`);
    }

    const liveData = await fplResponse.json();
    const elements = liveData.elements;

    if (!bootstrapResponse.ok) {
      throw new Error(`Bootstrap API responded with status: ${bootstrapResponse.status}`);
    }
    const bootstrapData = await bootstrapResponse.json();

    if (!elements || Object.keys(elements).length === 0) {
      console.log(`No live player data is available for GW${gwNumber}; schedule sync will continue.`);
    }

    // 3. Transform API response into database rows
    const rowsToUpsert = [];

    const livePlayerEntries: Array<[string, any]> = Array.isArray(elements)
      ? elements
          .map((player: any) => [String(player?.id ?? player?.element ?? ""), player] as [string, any])
          .filter(([playerId]) => /^\d+$/.test(playerId))
      : Object.entries(elements || {});

    for (const [playerIdStr, playerObj] of livePlayerEntries) {
      const livePlayer = playerObj as any;
      const stats = livePlayer.stats || {};
      const explain = Array.isArray(livePlayer.explain) ? livePlayer.explain : [];

      let clearances = Number(stats.clearances || 0);
      let blocks = Number(stats.blocks || 0);
      let interceptions = Number(stats.interceptions || 0);
      let tackles = Number(stats.tackles || 0);
      let recoveries = Number(stats.recoveries ?? stats.ball_recoveries ?? 0);

      explain.forEach((match: any) => {
        if (!Array.isArray(match?.stats)) return;
        match.stats.forEach((entry: any) => {
          const value = Number(entry?.value || 0);
          if (entry?.identifier === "clearances") clearances = Math.max(clearances, value);
          if (entry?.identifier === "blocks") blocks = Math.max(blocks, value);
          if (entry?.identifier === "interceptions") interceptions = Math.max(interceptions, value);
          if (entry?.identifier === "tackles") tackles = Math.max(tackles, value);
          if (entry?.identifier === "ball_recoveries" || entry?.identifier === "recoveries") {
            recoveries = Math.max(recoveries, value);
          }
        });
      });

      const cbi = Number(stats.clearances_blocks_interceptions ?? (clearances + blocks + interceptions));
      const defContribution = stats.defensive_contribution ?? (cbi + recoveries + tackles);

      rowsToUpsert.push({
        player_id: parseInt(playerIdStr, 10),
        gameweek: gwNumber,
        total_points: stats.total_points ?? 0,
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

    const eventEnvelope = bootstrapData.events || {};
    const eventRows = Array.isArray(eventEnvelope)
      ? eventEnvelope
      : Array.isArray(eventEnvelope.data)
        ? eventEnvelope.data
        : [];
    const currentEventId = Number(eventEnvelope.current || 0);
    const nextEventId = Number(eventEnvelope.next || 0);

    const gameweekRows = eventRows
      .filter((event: any) => event?.id && event?.deadline_time)
      .map((event: any) => ({
        gameweek_number: Number(event.id),
        fpl_deadline_time: event.deadline_time,
        is_current: Number(event.id) === (currentEventId || nextEventId),
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
      const { error } = await supabase
        .from("player_gameweek_stats")
        .upsert(rowsToUpsert, { onConflict: "player_id,gameweek" });

      if (error) {
        console.error("Supabase upsert error:", error);
        throw error;
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
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        gameweek: gwNumber,
        records_processed: rowsToUpsert.length,
        schedule_records: gameweekRows.length,
        fixture_finalization: fixtureFinalizationData,
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
