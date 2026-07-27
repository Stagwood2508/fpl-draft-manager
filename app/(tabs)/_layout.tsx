import React, { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../utils/supabase';
import SettingsDropdown from '../../components/SettingsDropdown'; 

export default function RootTabsLayout() {
  const insets = useSafeAreaInsets(); 
  const [hasPendingTrade, setHasPendingTrade] = useState(false);

  useEffect(() => {
    let tradeChannel: any = null;

    const setupTradeListener = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Query 'transactions' for incoming 'PENDING' trades
      const checkPendingTrades = async () => {
        try {
          const { count, error } = await supabase
            .from('transactions')
            .select('*', { count: 'exact', head: true })
            .eq('receiver_id', user.id)
            .eq('status', 'PENDING');

          if (!error && count !== null) {
            setHasPendingTrade(count > 0);
          } else {
            setHasPendingTrade(false);
          }
        } catch (err) {
          console.error('Error checking pending transactions:', err);
        }
      };

      await checkPendingTrades();

      // 2. Real-time channel: Listen to ALL transaction changes
      tradeChannel = supabase
        .channel(`root-tabs-transactions-badge-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*', 
            schema: 'public',
            table: 'transactions',
          },
          (payload) => {
            const newRow = payload.new as any;
            const oldRow = payload.old as any;

            // Check if this transaction involved the current user (as receiver or sender)
            const isRelevantUser = 
              newRow?.receiver_id === user.id || 
              newRow?.sender_id === user.id ||
              oldRow?.receiver_id === user.id ||
              oldRow?.sender_id === user.id;

            if (isRelevantUser) {
              // 150ms buffer ensures PostgreSQL transaction completes before re-counting
              setTimeout(() => {
                checkPendingTrades();
              }, 150);
            }
          }
        )
        .subscribe();
    };

    setupTradeListener();

    return () => {
      if (tradeChannel) {
        supabase.removeChannel(tradeChannel);
      }
    };
  }, []);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#00ff87',
        tabBarInactiveTintColor: '#888',
        tabBarStyle: {
          backgroundColor: '#0F0F0F',
          borderTopWidth: 1,
          borderTopColor: '#1A1A1A',
          height: 50 + insets.bottom, 
          paddingBottom: insets.bottom > 0 ? insets.bottom : 6, 
          paddingTop: 6,
        },
        headerStyle: {
          backgroundColor: '#0A0A0A',
          borderBottomWidth: 1,
          borderBottomColor: '#161616',
        },
        headerTintColor: '#FFF',
        headerTitleStyle: { fontWeight: '900', fontSize: 16 },
        headerRight: () => <SettingsDropdown />,
      }}
    >
      <Tabs.Screen 
        name="dashboard" 
        options={{ 
          title: "HOME HUB", 
          tabBarLabel: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home-sharp" size={size - 2} color={color} />
        }} 
      />
      <Tabs.Screen 
        name="squad" 
        options={{ 
          title: "MY TEAM", 
          tabBarLabel: "Squad",
          tabBarIcon: ({ color, size }) => <Ionicons name="shirt-sharp" size={size - 2} color={color} />
        }} 
      />
      <Tabs.Screen 
        name="market" 
        options={{ 
          title: "PLAYER MARKET", 
          tabBarLabel: "Market",
          tabBarIcon: ({ color, size }) => (
            <View style={styles.iconContainer}>
              <Ionicons name="trending-up-sharp" size={size - 2} color={color} />
              {hasPendingTrade && <View style={styles.notificationBadgeCircle} />}
            </View>
          )
        }} 
      />
      <Tabs.Screen 
        name="players" 
        options={{ 
          title: "PLAYER POOL", 
          tabBarLabel: "Player Pool",
          tabBarIcon: ({ color, size }) => <Ionicons name="people-sharp" size={size - 2} color={color} />
        }} 
      />
      <Tabs.Screen 
        name="league" 
        options={{ 
          title: "LEAGUE CENTRE", 
          tabBarLabel: "League",
          tabBarIcon: ({ color, size }) => <Ionicons name="trophy-sharp" size={size - 2} color={color} />
        }} 
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadgeCircle: {
    position: 'absolute',
    top: -2,
    right: -6,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#FF3B30',
    borderWidth: 1.5,
    borderColor: '#0F0F0F',
  },
});