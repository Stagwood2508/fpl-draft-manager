import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // 1. Parse target gameweek from URL query params or JSON body (default to GW1)
    const url = new URL(req.url);
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

    const requestHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    };
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

    for (const [playerIdStr, playerObj] of Object.entries(elements || {})) {
      const stats = (playerObj as any).stats || {};

      const cbi = stats.clearances_blocks_interceptions ?? 0;
      const recoveries = stats.recoveries ?? 0;
      const tackles = stats.tackles ?? 0;
      const defContribution = stats.defensive_contribution ?? (cbi + recoveries + tackles);

      rowsToUpsert.push({
        player_id: parseInt(playerIdStr, 10),
        gameweek: gwNumber,
        total_points: stats.total_points ?? 0,
        minutes: stats.minutes ?? 0,
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
        updated_at: new Date().toISOString(),
      });
    }

    // 4. Initialize Supabase Admin Client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, string>;
    const supabaseSecretKey =
      secretKeys.custom_fpl_app_secretkey2808 || Object.values(secretKeys)[0];

    if (!supabaseSecretKey) {
      throw new Error("SUPABASE_SECRET_KEYS is not configured.");
    }

    const supabase = createClient(supabaseUrl, supabaseSecretKey);

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

    if (autoSubError) {
      console.error("Auto-sub processing error:", autoSubError.message);
    } else {
      console.log(`Auto-subs evaluated. ${autoSubData?.length || 0} recorded swaps.`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        gameweek: gwNumber,
        records_processed: rowsToUpsert.length,
        schedule_records: gameweekRows.length,
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
