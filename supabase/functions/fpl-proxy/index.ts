import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const isSupportedEndpoint = (endpoint: string) =>
  endpoint === 'bootstrap-static' ||
  endpoint === 'fixtures' ||
  /^event\/(?:[1-9]|[1-2][0-9]|3[0-8])\/live$/.test(endpoint);

const getAuthenticatedUserId = async (request: Request) => {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return null;

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error } = await authClient.auth.getUser();
  return error || !user ? null : user.id;
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 405,
    });
  }

  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const url = new URL(req.url);
    let endpoint = url.searchParams.get('endpoint');
    if (!endpoint && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null;
    }
    endpoint = endpoint || 'bootstrap-static';

    if (!isSupportedEndpoint(endpoint)) {
      return new Response(JSON.stringify({ error: 'Unsupported FPL endpoint' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    let targetUrl = `https://draft.premierleague.com/api/${endpoint}`;
    if (endpoint === 'fixtures') {
      targetUrl = `https://fantasy.premierleague.com/api/fixtures/`;
    }

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'The FPL service is temporarily unavailable' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 502,
      });
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: unknown) {
    console.error('FPL proxy request failed', err);
    return new Response(JSON.stringify({ error: 'Unable to load FPL data' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
