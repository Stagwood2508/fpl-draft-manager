import { existsSync, readFileSync } from 'node:fs';

const mustContain = (file, fragment) => {
  if (!existsSync(file)) throw new Error(`Required security file is missing: ${file}`);
  const contents = readFileSync(file, 'utf8');
  if (!contents.includes(fragment)) {
    throw new Error(`${file} is missing the required safeguard: ${fragment}`);
  }
};

mustContain('supabase/functions/fpl-proxy/index.ts', 'getAuthenticatedUserId');
mustContain('supabase/functions/fpl-proxy/index.ts', 'isSupportedEndpoint');
mustContain('supabase/functions/sync-live-stats/index.ts', 'LIVE_STATS_CRON_SECRET');
mustContain('supabase/functions/sync-fpl-player-pool/index.ts', 'APP_OWNER_USER_ID');
mustContain('supabase/functions/send-push-notification/index.ts', 'PUSH_WEBHOOK_SECRET');
mustContain('supabase/migrations/20260927150000_harden_network_surface.sql', 'revoke all on all functions in schema net');
mustContain('supabase/tests/network_surface_security_test.sql', 'Browser roles must not execute a public pg_net wrapper');

console.log('Security surface checks passed.');
