import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { supabase } from '@/utils/supabase';

export type PushRegistrationResult =
  | { status: 'ENABLED'; token: string }
  | { status: 'DENIED' | 'UNSUPPORTED' | 'ERROR'; message: string };

const projectId = () => Constants.expoConfig?.extra?.eas?.projectId || Constants.projectId;

export const configurePushPresentation = () => {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
};

export async function enablePushNotifications(requestPermission = true): Promise<PushRegistrationResult> {
  if (Platform.OS === 'web') return { status: 'UNSUPPORTED', message: 'Browser push will be introduced separately.' };
  if (!Device.isDevice) return { status: 'UNSUPPORTED', message: 'Push notifications require a physical device.' };

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('league-events', {
        name: 'League events',
        description: 'Trade offers, waiver outcomes, commissioner announcements and draft reminders.',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 180, 250],
        lightColor: '#00F27A',
        sound: 'default',
      });
    }

    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted' && requestPermission) permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return { status: 'DENIED', message: 'Notification permission was not granted.' };

    const resolvedProjectId = projectId();
    if (!resolvedProjectId) return { status: 'ERROR', message: 'The Expo project ID is not configured.' };
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: resolvedProjectId })).data;
    const { error } = await supabase.rpc('register_push_device', {
      p_expo_push_token: token,
      p_platform: Platform.OS.toUpperCase(),
      p_device_name: Device.deviceName || `${Platform.OS} device`,
    });
    if (error) throw error;
    return { status: 'ENABLED', token };
  } catch (error: any) {
    console.error('[PUSH REGISTRATION]', error);
    return { status: 'ERROR', message: error?.message || 'Push registration failed.' };
  }
}

export async function disablePushNotifications() {
  const { error } = await supabase.rpc('disable_my_push_devices');
  if (error) throw error;
}

export async function refreshPushRegistration(currentUserId: string | null) {
  if (!currentUserId || Platform.OS === 'web' || !Device.isDevice) return;
  const { data: preference } = await supabase.from('notification_preferences')
    .select('push_enabled').eq('user_id', currentUserId).maybeSingle();
  if (!preference?.push_enabled) return;
  await enablePushNotifications(false);
}

export const notificationRoute = (notification: Notifications.Notification) => {
  const route = notification.request.content.data?.url;
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || route.length > 300) return null;
  return route;
};

