// fantasy-draft-worker/supabase/functions/draft-ticker-daemon/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log("⏱️ Draft Ticker Daemon started processing loop...");

  // Run a controlled 50-second loop without overlapping calls
  const endTime = Date.now() + 50000;

  while (Date.now() < endTime) {
    try {
      const { data: expiredSessions, error: fetchError } = await supabase
        .from('draft_sessions')
        .select('league_id, current_picker_id, current_pick_index')
        .eq('draft_status', 'LIVE')
        .lte('pick_deadline', new Date().toISOString());

      if (fetchError) {
        console.error("Error fetching expired draft sessions:", fetchError.message);
      } else if (expiredSessions && expiredSessions.length > 0) {
        for (const session of expiredSessions) {
          console.log(`🤖 Forcing auto-pick: League ${session.league_id}, Pick ${session.current_pick_index}`);
          
          const { data: rpcResponse, error: rpcError } = await supabase.rpc('execute_draft_autopick', {
            p_league_id: session.league_id,
            p_user_id: session.current_picker_id,
            p_current_pick_index: session.current_pick_index
          });

          if (rpcError) {
            console.error(`❌ RPC Error: ${rpcError.message}`);
          } else {
            console.log(`✅ Pick ${session.current_pick_index} processed. Result:`, rpcResponse);
          }
        }
      }
    } catch (err) {
      console.error("Unexpected error in ticker loop:", err);
    }

    // Wait 2 seconds before next tick
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return new Response(JSON.stringify({ status: "Daemon loop complete" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});