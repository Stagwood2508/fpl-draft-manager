import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let endpoint = url.searchParams.get('endpoint');
    if (!endpoint && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null;
    }
    endpoint = endpoint || 'bootstrap-static';

    let targetUrl = `https://draft.premierleague.com/api/${endpoint}`;
    if (endpoint === 'fixtures') {
      targetUrl = `https://fantasy.premierleague.com/api/fixtures/`;
    }

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
