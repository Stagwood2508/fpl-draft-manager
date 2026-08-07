import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, string>;
  const secretKey =
    secretKeys.custom_fpl_app_secretkey2808 || Object.values(secretKeys)[0];

  if (!supabaseUrl || !secretKey) {
    return new Response(
      JSON.stringify({ success: false, error: 'SERVER_CONFIGURATION_MISSING' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc(
    'process_expired_draft_sessions'
  );

  if (error) {
    console.error('Draft ticker fallback failed:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
