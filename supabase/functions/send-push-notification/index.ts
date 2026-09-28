import { createClient } from 'npm:@supabase/supabase-js@2';

interface NotificationRecord {
  id: number;
  user_id: string;
  league_id: string | null;
  category: 'ANNOUNCEMENT' | 'TRADE' | 'WAIVER' | 'MATCH' | 'SYSTEM';
  title: string;
  body: string;
  route: string | null;
  dedupe_key: string | null;
}

interface WebhookPayload {
  type: 'INSERT';
  table: 'user_notifications';
  schema: 'public';
  record: NotificationRecord;
  old_record: null;
}

interface PushTokenRow {
  id: string;
  expo_push_token: string;
  fcm_push_token: string | null;
  platform: 'ANDROID' | 'IOS';
}

interface LeagueRow {
  name: string | null;
}

interface TradePlayerRow {
  web_name: string | null;
}

interface TradePackageRow {
  player_out: TradePlayerRow | TradePlayerRow[] | null;
  player_in: TradePlayerRow | TradePlayerRow[] | null;
}

const actionableTradePackageId = (notification: NotificationRecord) => {
  if (notification.category !== 'TRADE') return null;
  const match = notification.dedupe_key?.match(
    /^trade:([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}):PENDING$/i,
  );
  return match?.[1] || null;
};

const relation = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] || null : value || null;

const tradePlayerName = (player: TradePlayerRow | TradePlayerRow[] | null) =>
  relation(player)?.web_name?.trim() || 'Unknown player';

const tradeOfferBody = (rows: TradePackageRow[]) => {
  const offered = rows.map(row => tradePlayerName(row.player_out));
  const requested = rows.map(row => tradePlayerName(row.player_in));
  if (!offered.length || !requested.length) return null;
  // Line breaks make the offer scannable in Android's expanded notification.
  return `Offers: ${offered.join(', ')}\nRequests: ${requested.join(', ')}`;
};

type TradeActionTokens = { accept: string; reject: string };

const urlSafeToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

const base64Url = (value: string) => btoa(value)
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pemToBytes = (pem: string) => Uint8Array.from(
  atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '')),
  character => character.charCodeAt(0),
);

type FirebaseServiceAccount = { client_email: string; private_key: string; project_id: string };
let firebaseAccessToken: { value: string; expiresAt: number } | null = null;

const getFirebaseAccessToken = async (serviceAccount: FirebaseServiceAccount) => {
  if (firebaseAccessToken && firebaseAccessToken.expiresAt > Date.now() + 60_000) return firebaseAccessToken.value;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToBytes(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(String.fromCharCode(...new Uint8Array(signature)))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.access_token !== 'string') throw new Error('Firebase authentication failed');
  firebaseAccessToken = { value: payload.access_token, expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000 };
  return firebaseAccessToken.value;
};

const firebaseServiceAccount = (): FirebaseServiceAccount | null => {
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!raw) return null;
  try {
    const account = JSON.parse(raw);
    return typeof account?.client_email === 'string'
      && typeof account?.private_key === 'string'
      && typeof account?.project_id === 'string'
      ? account as FirebaseServiceAccount
      : null;
  } catch {
    return null;
  }
};

const expoHeaders = () => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const suppliedAuthorization = request.headers.get('authorization');
  const configuredWebhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  const suppliedWebhookSecret = request.headers.get('x-push-webhook-secret');
  const serviceRoleAuthorized = Boolean(serviceRoleKey && suppliedAuthorization === `Bearer ${serviceRoleKey}`);
  const secretAuthorized = Boolean(configuredWebhookSecret && suppliedWebhookSecret === configuredWebhookSecret);
  if (!serviceRoleAuthorized && !secretAuthorized) return new Response('Unauthorized', { status: 401 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl || !serviceRoleKey) return new Response('Server configuration missing', { status: 500 });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  try {
    // Receipt checks are opportunistic and never block a new delivery.
    const receiptCutoff = new Date(Date.now() - 30_000).toISOString();
    const { data: receiptAttempts } = await admin
      .from('push_delivery_attempts')
      .select('id, expo_ticket_id, token_id')
      .eq('status', 'TICKET_ACCEPTED')
      .is('receipt_checked_at', null)
      .lt('created_at', receiptCutoff)
      .limit(300);

    if (receiptAttempts?.length) {
      const receiptIds = receiptAttempts.map(item => item.expo_ticket_id).filter(Boolean);
      const receiptResponse = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
        method: 'POST', headers: expoHeaders(), body: JSON.stringify({ ids: receiptIds }),
      });
      if (receiptResponse.ok) {
        const receiptPayload = await receiptResponse.json();
        for (const attempt of receiptAttempts) {
          const receipt = receiptPayload?.data?.[attempt.expo_ticket_id];
          if (!receipt) continue;
          const delivered = receipt.status === 'ok';
          const errorCode = receipt.details?.error || null;
          await admin.from('push_delivery_attempts').update({
            status: delivered ? 'DELIVERED' : 'FAILED',
            error_code: errorCode,
            error_message: receipt.message || null,
            receipt_checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', attempt.id);
          if (errorCode === 'DeviceNotRegistered') {
            await admin.from('push_device_tokens').update({
              enabled: false, last_error: errorCode, updated_at: new Date().toISOString(),
            }).eq('id', attempt.token_id);
          }
        }
      }
    }

    const payload = await request.json() as WebhookPayload;
    const notification = payload?.record;
    if (payload?.type !== 'INSERT' || payload?.table !== 'user_notifications' || !notification?.id) {
      return Response.json({ success: true, skipped: 'UNSUPPORTED_WEBHOOK_EVENT' });
    }

    // Chronicle remains an in-app-only event for this first push release.
    if (notification.dedupe_key?.startsWith('chronicle:')) {
      return Response.json({ success: true, skipped: 'CHRONICLE_PUSH_DISABLED' });
    }

    const tradePackageId = actionableTradePackageId(notification);
    const [{ data: preferences }, { data: tokens, error: tokenError }, leagueResponse, tradePackageResponse] = await Promise.all([
      admin.from('notification_preferences')
        .select('push_enabled, announcements_enabled, trades_enabled, waivers_enabled, match_updates_enabled, own_player_events_enabled, opponent_player_events_enabled, draft_enabled')
        .eq('user_id', notification.user_id).maybeSingle(),
      admin.from('push_device_tokens')
        .select('id, expo_push_token, fcm_push_token, platform')
        .eq('user_id', notification.user_id).eq('enabled', true),
      notification.league_id
        ? admin.from('leagues').select('name').eq('id', notification.league_id).maybeSingle<LeagueRow>()
        : Promise.resolve({ data: null, error: null }),
      tradePackageId
        ? admin.from('transactions').select(`
            player_out:players!transactions_player_out_id_fkey (web_name),
            player_in:players!transactions_player_in_id_fkey (web_name)
          `).eq('parent_transaction_id', tradePackageId).eq('type', 'TRADE').eq('status', 'PENDING')
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (tokenError) throw tokenError;

    if (leagueResponse.error) throw leagueResponse.error;
    if (tradePackageResponse.error) throw tradePackageResponse.error;
    const leagueName = leagueResponse.data?.name?.trim() || null;
    const tradeBody = tradePackageId
      ? tradeOfferBody((tradePackageResponse.data || []) as TradePackageRow[])
      : null;

    const categoryEnabled = notification.category === 'ANNOUNCEMENT'
      ? preferences?.announcements_enabled !== false
      : notification.category === 'TRADE'
        ? preferences?.trades_enabled !== false
        : notification.category === 'WAIVER'
          ? preferences?.waivers_enabled !== false
          : notification.dedupe_key?.startsWith('draft-')
            ? preferences?.draft_enabled !== false
            : notification.dedupe_key?.startsWith('live-event:')
              ? preferences?.match_updates_enabled !== false
                && (notification.dedupe_key.endsWith(':opponent')
                  ? preferences?.opponent_player_events_enabled !== false
                  : preferences?.own_player_events_enabled !== false)
              : preferences?.match_updates_enabled !== false;

    if (!preferences?.push_enabled || !categoryEnabled) {
      return Response.json({ success: true, skipped: 'USER_PREFERENCE' });
    }

    const activeTokens = (tokens || []) as PushTokenRow[];
    if (!activeTokens.length) return Response.json({ success: true, skipped: 'NO_ACTIVE_DEVICE' });

    const { data: existingAttempts } = await admin.from('push_delivery_attempts')
      .select('token_id, status')
      .eq('notification_id', notification.id);
    const completedTokenIds = new Set((existingAttempts || [])
      .filter(item => ['TICKET_ACCEPTED', 'DELIVERED'].includes(item.status))
      .map(item => item.token_id));
    const pendingTokens = activeTokens.filter(token => !completedTokenIds.has(token.id));
    if (!pendingTokens.length) return Response.json({ success: true, skipped: 'ALREADY_SENT' });
    await admin.from('push_delivery_attempts').upsert(pendingTokens.map(token => ({
      notification_id: notification.id, token_id: token.id, status: 'SENDING', updated_at: new Date().toISOString(),
    })), { onConflict: 'notification_id,token_id' });

    const firebaseAccount = tradePackageId ? firebaseServiceAccount() : null;
    const directActionTokens = firebaseAccount
      ? pendingTokens.filter(token => token.platform === 'ANDROID' && Boolean(token.fcm_push_token))
      : [];
    const expoTokens = pendingTokens.filter(token => !directActionTokens.some(direct => direct.id === token.id));

    if (tradePackageId && directActionTokens.length) {
      const actionTokens: TradeActionTokens = { accept: urlSafeToken(), reject: urlSafeToken() };
      // A trade can remain pending well beyond the original notification.
      // Keep its one-time actions available for a day; the database still
      // rejects them immediately if the offer is withdrawn or resolved.
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { error: actionError } = await admin.from('trade_push_actions').insert([
        { notification_id: notification.id, user_id: notification.user_id, package_id: tradePackageId, action: 'ACCEPT', token_hash: await sha256(actionTokens.accept), expires_at: expiresAt },
        { notification_id: notification.id, user_id: notification.user_id, package_id: tradePackageId, action: 'REJECT', token_hash: await sha256(actionTokens.reject), expires_at: expiresAt },
      ]);
      if (actionError) throw actionError;

      const accessToken = await getFirebaseAccessToken(firebaseAccount!);
      await Promise.all(directActionTokens.map(async token => {
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${firebaseAccount!.project_id}/messages:send`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: {
              token: token.fcm_push_token,
              android: { priority: 'HIGH' },
              data: {
                kind: 'trade-action',
                title: leagueName ? `${leagueName} · ${notification.title}` : notification.title,
                body: tradeBody || notification.body,
                notificationId: String(notification.id),
                acceptToken: actionTokens.accept,
                rejectToken: actionTokens.reject,
                actionEndpoint: `${supabaseUrl}/functions/v1/execute-trade-push-action`,
              },
            } }),
          },
        );
        const responseBody = await response.text();
        await admin.from('push_delivery_attempts').update({
          status: response.ok ? 'DELIVERED' : 'FAILED',
          error_code: response.ok ? null : 'FCM_REJECTED',
          error_message: response.ok ? null : responseBody.slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq('notification_id', notification.id).eq('token_id', token.id);
      }));
    }

    if (!expoTokens.length) return Response.json({ success: true, devices: pendingTokens.length });

    const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify(expoTokens.map(token => ({
        to: token.expo_push_token,
        title: leagueName ? `${leagueName} · ${notification.title}` : notification.title,
        body: tradeBody || notification.body,
        sound: 'default',
        priority: 'high',
        channelId: 'league-events',
        ...(tradePackageId ? { categoryId: 'tradeoffer' } : {}),
        data: {
          url: notification.route || '/notifications',
          notificationId: notification.id,
          category: notification.category,
          leagueId: notification.league_id,
          ...(tradePackageId ? { tradePackageId } : {}),
        },
      }))),
    });
    const pushPayload = await pushResponse.json();
    if (!pushResponse.ok) throw new Error(pushPayload?.errors?.[0]?.message || 'Expo push request failed');

    const tickets = Array.isArray(pushPayload?.data) ? pushPayload.data : [pushPayload?.data];
    for (let index = 0; index < expoTokens.length; index += 1) {
      const token = expoTokens[index];
      const ticket = tickets[index] || {};
      const accepted = ticket.status === 'ok' && ticket.id;
      const errorCode = ticket.details?.error || null;
      await admin.from('push_delivery_attempts').update({
        status: accepted ? 'TICKET_ACCEPTED' : 'FAILED',
        expo_ticket_id: accepted ? ticket.id : null,
        error_code: errorCode,
        error_message: ticket.message || null,
        updated_at: new Date().toISOString(),
      }).eq('notification_id', notification.id).eq('token_id', token.id);
      await admin.from('push_device_tokens').update(accepted ? {
        last_delivery_at: new Date().toISOString(), last_error: null, failure_count: 0, updated_at: new Date().toISOString(),
      } : {
        enabled: errorCode === 'DeviceNotRegistered' ? false : true,
        last_error: errorCode || ticket.message || 'PUSH_REJECTED',
        failure_count: 1,
        updated_at: new Date().toISOString(),
      }).eq('id', token.id);
    }

    return Response.json({ success: true, devices: pendingTokens.length });
  } catch (error) {
    console.error('[PUSH DELIVERY]', error);
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }, { status: 500 });
  }
});
