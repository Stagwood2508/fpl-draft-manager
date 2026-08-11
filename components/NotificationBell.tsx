import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { AppColors, appRadius } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { useNotificationSummary } from '@/features/notifications/hooks/useNotificationSummary';

export default function NotificationBell() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { currentUserId } = useAppSession();
  const { unreadCount } = useNotificationSummary(currentUserId);

  return (
    <TouchableOpacity style={styles.button} onPress={() => router.push('/notifications')} accessibilityRole="button" accessibilityLabel={`${unreadCount} unread notifications`}>
      <Ionicons name={unreadCount > 0 ? 'notifications' : 'notifications-outline'} size={20} color={unreadCount > 0 ? colors.accent : colors.textSecondary} />
      {unreadCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  button: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.medium },
  badge: { position: 'absolute', top: 1, right: 0, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.backgroundDeep, borderRadius: appRadius.pill },
  badgeText: { color: colors.white, fontSize: 7, fontWeight: '900' },
});
