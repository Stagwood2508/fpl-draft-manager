import React, { useEffect, useMemo, useState } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { supabase } from '@/utils/supabase';
import { AppColors } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SettingsDropdown from '@/components/SettingsDropdown';
import NotificationBell from '@/components/NotificationBell';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { currentUserId, activeLeagueId } = useAppSession();

const [hasPendingTradeOffer, setHasPendingTradeOffer] = useState(false);

useEffect(() => {
  if (!currentUserId || !activeLeagueId) {
    setHasPendingTradeOffer(false);
    return;
  }

  let isActive = true;

  const checkPendingTradeOffers = async () => {
    const { count, error } = await supabase
      .from('transactions')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('league_id', activeLeagueId)
      .eq('receiver_id', currentUserId)
      .eq('type', 'TRADE')
      .eq('status', 'PENDING');

    if (error) {
      console.error(
        'Unable to check pending trade offers:',
        error.message
      );
      return;
    }

    if (isActive) {
      setHasPendingTradeOffer((count ?? 0) > 0);
    }
  };

  void checkPendingTradeOffers();

  // Realtime reuses an existing channel when the topic matches. Give each
  // layout mount a unique topic so a fast route remount cannot receive a
  // channel that is still subscribed while its async cleanup is finishing.
  const channelInstanceId = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  const channel = supabase
    .channel(
      `market-tab-offers-${activeLeagueId}-${currentUserId}-${channelInstanceId}`
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `league_id=eq.${activeLeagueId}`,
      },
      () => {
        void checkPendingTradeOffers();
      }
    )
    .subscribe();

  return () => {
    isActive = false;
    void supabase.removeChannel(channel);
  };
}, [currentUserId, activeLeagueId]);

  return (
    <Tabs
      initialRouteName="dashboard"
      screenOptions={{
        headerShown: true,

       headerStyle: {
  backgroundColor: colors.backgroundDeep,
},

headerTintColor: colors.textPrimary,
headerShadowVisible: false,

headerTitleStyle: {
  fontSize: 13,
  fontWeight: '900',
  color: colors.textPrimary,
},

headerTitleContainerStyle: {
  paddingVertical: 0,
},

headerRightContainerStyle: {
  paddingRight: 6,
},

        headerRight: () => (
          <View style={styles.headerActions}>
            <NotificationBell />
            <SettingsDropdown />
          </View>
        ),

       tabBarStyle: {
  backgroundColor: colors.backgroundDeep,
  borderTopColor: colors.border,
  borderTopWidth: 1,
  height: 58 + Math.max(insets.bottom, 8),
  paddingTop: 7,
  paddingBottom: Math.max(insets.bottom, 8),
},

tabBarActiveTintColor: colors.accent,
tabBarInactiveTintColor: colors.textMuted,

tabBarLabelStyle: {
  fontSize: 9,
  fontWeight: '800',
  letterSpacing: 0.4,
},

        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'HOME',
          headerTitle: 'DASHBOARD',

          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'home' : 'home-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="squad"
        options={{
          title: 'SQUAD',
          headerTitle: 'MY SQUAD',

          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'shirt' : 'shirt-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="players"
        options={{
          title: 'PLAYERS',
          headerTitle: 'PLAYER SCOUT',

          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'search' : 'search-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="market"
        options={{
          title: 'MARKET',
          headerTitle: 'TRANSFER MARKET',

          tabBarIcon: ({ color, size, focused }) => (
  <View style={styles.marketIconContainer}>
    <Ionicons
      name={
        focused
          ? 'swap-horizontal'
          : 'swap-horizontal-outline'
      }
      color={color}
      size={size}
    />

    {hasPendingTradeOffer && (
      <View style={styles.notificationDot} />
    )}
  </View>
),
        }}
      />

      <Tabs.Screen
        name="league"
        options={{
          title: 'LEAGUE',
          headerTitle: 'LEAGUE HUB',

          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'trophy' : 'trophy-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />

      {/* Existing route, available programmatically but not as a main tab */}
      <Tabs.Screen
        name="stats"
        options={{
          href: null,
          title: 'STATS',
        }}
      />
    </Tabs>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  marketIconContainer: {
    position: 'relative',
  },

  notificationDot: {
    position: 'absolute',
    top: -3,
    right: -5,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
    borderWidth: 2,
    borderColor: colors.backgroundDeep,
  },
});
