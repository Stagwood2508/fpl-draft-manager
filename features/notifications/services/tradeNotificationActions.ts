import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { supabase } from '@/utils/supabase';

export const TRADE_NOTIFICATION_CATEGORY = 'tradeoffer';
export const TRADE_ACCEPT_ACTION = 'tradeaccept';
export const TRADE_REJECT_ACTION = 'tradereject';
const TRADE_NOTIFICATION_ACTION_TASK = 'trade-notification-action';

type TradeNotificationActionResult =
  | { status: 'SUCCESS' | 'ALREADY_HANDLED' | 'IGNORED' }
  | { status: 'FAILED'; error: string };

const tradePackageIdFromResponse = (response: Notifications.NotificationResponse) => {
  const value = response.notification.request.content.data?.tradePackageId;
  return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
};

export const isTradeNotificationAction = (response: Notifications.NotificationResponse) =>
  response.actionIdentifier === TRADE_ACCEPT_ACTION || response.actionIdentifier === TRADE_REJECT_ACTION;

export async function handleTradeNotificationAction(
  response: Notifications.NotificationResponse,
): Promise<TradeNotificationActionResult> {
  if (!isTradeNotificationAction(response)) return { status: 'IGNORED' };

  const packageId = tradePackageIdFromResponse(response);
  if (!packageId) return { status: 'FAILED', error: 'The trade offer could not be identified.' };

  const actionKey = `handled-trade-notification:${response.notification.request.identifier}:${response.actionIdentifier}`;
  if (await AsyncStorage.getItem(actionKey)) return { status: 'ALREADY_HANDLED' };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: 'FAILED', error: 'Please sign in before responding to a trade offer.' };

  try {
    const result = response.actionIdentifier === TRADE_ACCEPT_ACTION
      ? await supabase.rpc('accept_trade_transaction', { p_transaction_id: packageId })
      : await supabase.rpc('update_trade_package_status', {
          p_transaction_id: packageId,
          p_action: 'REJECT',
        });

    if (result.error) throw result.error;
    if (result.data?.success === false) {
      throw new Error(result.data.error || 'The trade offer is no longer available.');
    }

    await AsyncStorage.setItem(actionKey, new Date().toISOString());
    await Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => undefined);
    return { status: 'SUCCESS' };
  } catch (error: any) {
    console.warn('[TRADE NOTIFICATION ACTION]', error);
    return { status: 'FAILED', error: error?.message || 'The trade response could not be completed.' };
  }
}

if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(TRADE_NOTIFICATION_ACTION_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    TRADE_NOTIFICATION_ACTION_TASK,
    async ({ data, error }) => {
      if (error || !data || !('actionIdentifier' in data)) {
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }

      const result = await handleTradeNotificationAction(data);
      return result.status === 'SUCCESS' || result.status === 'ALREADY_HANDLED'
        ? Notifications.BackgroundNotificationTaskResult.NewData
        : Notifications.BackgroundNotificationTaskResult.Failed;
    },
  );
}

export async function configureTradeNotificationActions() {
  if (Platform.OS === 'web') return;

  await Notifications.setNotificationCategoryAsync(
    TRADE_NOTIFICATION_CATEGORY,
    [
      {
        identifier: TRADE_ACCEPT_ACTION,
        buttonTitle: 'Accept',
        options: { isAuthenticationRequired: true, opensAppToForeground: false },
      },
      {
        identifier: TRADE_REJECT_ACTION,
        buttonTitle: 'Reject',
        options: { isAuthenticationRequired: true, isDestructive: true, opensAppToForeground: false },
      },
    ],
  );

  if (!await TaskManager.isTaskRegisteredAsync(TRADE_NOTIFICATION_ACTION_TASK)) {
    await Notifications.registerTaskAsync(TRADE_NOTIFICATION_ACTION_TASK);
  }
}
