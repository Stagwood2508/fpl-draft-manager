import React, { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Shirt, TrendingUp, Users, Trophy, BarChart3 } from 'lucide-react-native';
import { supabase } from '@/utils/supabase';
import SettingsDropdown from '@/components/SettingsDropdown'; 

export default function RootTabsLayout() {
  const insets = useSafeAreaInsets(); 
  const [hasPendingTrade, setHasPendingTrade] = useState(false);

  useEffect(() => {
    let tradeChannel: any = null;

    const setupTradeListener = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

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

            const isRelevantUser = 
              newRow?.receiver_id === user.id || 
              newRow?.sender_id === user.id ||
              oldRow?.receiver_id === user.id ||
              oldRow?.sender_id === user.id;

            if (isRelevantUser) {
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
        tabBarInactiveTintColor: '#888888',
        tabBarStyle: {
          backgroundColor: '#0F0F0F',
          borderTopWidth: 1,
          borderTopColor: '#1A1A1A',
          height: Platform.OS === 'web' ? 60 : 50 + insets.bottom, 
          paddingBottom: Platform.OS === 'web' ? 8 : (insets.bottom > 0 ? insets.bottom : 6), 
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
          tabBarIcon: ({ color, size }) => (
            <Home size={size - 2} color={color} />
          ),
        }} 
      />
      <Tabs.Screen 
        name="squad" 
        options={{ 
          title: "MY TEAM", 
          tabBarLabel: "Squad",
          tabBarIcon: ({ color, size }) => (
            <Shirt size={size - 2} color={color} />
          ),
        }} 
      />
      <Tabs.Screen 
        name="market" 
        options={{ 
          title: "PLAYER MARKET", 
          tabBarLabel: "Market",
          tabBarIcon: ({ color, size }) => (
            <View style={styles.iconContainer}>
              <TrendingUp size={size - 2} color={color} />
              {hasPendingTrade && <View style={styles.notificationBadgeCircle} />}
            </View>
          ),
        }} 
      />
      <Tabs.Screen 
        name="players" 
        options={{ 
          title: "PLAYER POOL", 
          tabBarLabel: "Player Pool",
          tabBarIcon: ({ color, size }) => (
            <Users size={size - 2} color={color} />
          ),
        }} 
      />
      <Tabs.Screen 
        name="league" 
        options={{ 
          title: "LEAGUE CENTRE", 
          tabBarLabel: "League",
          tabBarIcon: ({ color, size }) => (
            <Trophy size={size - 2} color={color} />
          ),
        }} 
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarIcon: ({ color, size }) => (
            <BarChart3 size={size - 2} color={color} />
          ),
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