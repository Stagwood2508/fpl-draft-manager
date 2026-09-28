import { createClient } from 'npm:@supabase/supabase-js@2';

const jsonHeaders = { 'Content-Type': 'application/json' };

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { token } = await request.json();
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return Response.json({ success: false, error: 'INVALID_ACTION' }, { status: 400, headers: jsonHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Server configuration missing');
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc('execute_trade_push_action', { p_token_hash: await sha256(token) });
    if (error) throw error;

    const actionError = typeof data?.error === 'string' ? data.error : 'ACTION_UNAVAILABLE';
    if (data?.success !== true) {
      // The token holder learns only the outcome code for its own one-time
      // action. This is enough for Android to give a truthful response while
      // exposing no roster, manager or trade details.
      console.warn('[TRADE PUSH ACTION REJECTED]', actionError);
    }
    return Response.json(
      { success: data?.success === true, error: data?.success === true ? undefined : actionError },
      { status: data?.success === true ? 200 : 409, headers: jsonHeaders },
    );
  } catch (error) {
    console.error('[TRADE PUSH ACTION]', error);
    return Response.json({ success: false, error: 'ACTION_UNAVAILABLE' }, { status: 400, headers: jsonHeaders });
  }
});
