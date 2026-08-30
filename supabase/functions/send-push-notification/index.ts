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
}

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

    const [{ data: preferences }, { data: tokens, error: tokenError }] = await Promise.all([
      admin.from('notification_preferences')
        .select('push_enabled, announcements_enabled, trades_enabled, waivers_enabled, match_updates_enabled, own_player_events_enabled, opponent_player_events_enabled, draft_enabled')
        .eq('user_id', notification.user_id).maybeSingle(),
      admin.from('push_device_tokens')
        .select('id, expo_push_token')
        .eq('user_id', notification.user_id).eq('enabled', true),
    ]);
    if (tokenError) throw tokenError;

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

    const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify(pendingTokens.map(token => ({
        to: token.expo_push_token,
        title: notification.title,
        body: notification.body,
        sound: 'default',
        priority: 'high',
        channelId: 'league-events',
        data: {
          url: notification.route || '/notifications',
          notificationId: notification.id,
          category: notification.category,
          leagueId: notification.league_id,
        },
      }))),
    });
    const pushPayload = await pushResponse.json();
    if (!pushResponse.ok) throw new Error(pushPayload?.errors?.[0]?.message || 'Expo push request failed');

    const tickets = Array.isArray(pushPayload?.data) ? pushPayload.data : [pushPayload?.data];
    for (let index = 0; index < pendingTokens.length; index += 1) {
      const token = pendingTokens[index];
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
