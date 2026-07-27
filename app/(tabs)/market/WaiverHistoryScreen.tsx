import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import { supabase } from '../../../utils/supabase';

interface WaiverTransaction {
  id: string;
  gameweek: number;
  status: 'successful' | 'failed' | 'pending';
  failure_reason?: string | null;
  processed_at: string;
  priority_order: number;
  team_name: string;
  added_player_name: string;
  added_player_pos: string;
  dropped_player_name?: string | null;
}

export default function WaiverHistoryScreen() {
  const [selectedGameweek, setSelectedGameweek] = useState<number>(1);
  const [totalGameweeks] = useState<number[]>(Array.from({ length: 38 }, (_, i) => i + 1));
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [transactions, setTransactions] = useState<WaiverTransaction[]>([]);

  const fetchWaiverHistory = useCallback(async (gw: number) => {
    try {
      setLoading(true);

      // 1. Get logged-in user
      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user) return;

      const { data: membership } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', authData.user.id)
        .limit(1)
        .maybeSingle();

      if (!membership?.league_id) return;

      // 2. Query waiver_claims
      const { data, error } = await supabase
        .from('waiver_claims')
        .select(`
          id,
          gameweek,
          status,
          failure_reason,
          processed_at,
          priority_order,
          user_id,
          player_to_add:players!waiver_claims_player_to_add_fkey (web_name, element_type),
          player_to_drop:players!waiver_claims_player_to_drop_fkey (web_name)
        `)
        .eq('league_id', membership.league_id)
        .eq('gameweek', gw)
        .neq('status', 'pending')
        .order('processed_at', { ascending: false })
        .order('priority_order', { ascending: true });

      if (error) throw error;

      // 3. Resolve team names
      const { data: members } = await supabase
        .from('league_members')
        .select('user_id, team_name')
        .eq('league_id', membership.league_id);

      const teamMap = new Map(members?.map((m) => [m.user_id, m.team_name || 'FC Manager']));

      // 4. Map into UI items
      const formatted: WaiverTransaction[] = (data || []).map((row: any) => ({
        id: row.id,
        gameweek: row.gameweek,
        status: row.status,
        failure_reason: row.failure_reason,
        processed_at: row.processed_at,
        priority_order: row.priority_order,
        team_name: teamMap.get(row.user_id) || 'FC Manager',
        added_player_name: row.player_to_add?.web_name || 'Unknown Player',
        added_player_pos: row.player_to_add?.element_type || 'OUT',
        dropped_player_name: row.player_to_drop?.web_name || null,
      }));

      setTransactions(formatted);
    } catch (err: any) {
      console.error('Error loading waiver activity history:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchWaiverHistory(selectedGameweek);
  }, [selectedGameweek, fetchWaiverHistory]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchWaiverHistory(selectedGameweek);
  };

  const renderTransactionCard = ({ item }: { item: WaiverTransaction }) => {
    const isSuccess = item.status === 'successful';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.teamName}>{item.team_name}</Text>
          <View style={[styles.badge, isSuccess ? styles.badgeSuccess : styles.badgeFailed]}>
            <Text style={[styles.badgeText, isSuccess ? styles.textSuccess : styles.textFailed]}>
              {isSuccess ? 'SUCCESS' : 'FAILED'}
            </Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          {/* Player In */}
          <View style={styles.playerRow}>
            <Text style={styles.actionTagIn}>IN</Text>
            <Text style={styles.playerName}>{item.added_player_name}</Text>
            <Text style={styles.posBadge}>{item.added_player_pos}</Text>
          </View>

          {/* Player Out */}
          {item.dropped_player_name ? (
            <View style={styles.playerRow}>
              <Text style={styles.actionTagOut}>OUT</Text>
              <Text style={styles.playerOutName}>{item.dropped_player_name}</Text>
            </View>
          ) : (
            <Text style={styles.freeAgentSubtext}>Free Addition (No Drop)</Text>
          )}
        </View>

        {/* Failure Reason */}
        {!isSuccess && (
          <View style={styles.failureContainer}>
            <Text style={styles.failureText}>
              ⚠️ Reason: {item.failure_reason || 'Claim unsuccessful (Player unavailable or roster limit reached)'}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Waiver Activity Log</Text>
      </View>

      {/* Gameweek Selector */}
      <View style={styles.selectorContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={totalGameweeks}
          keyExtractor={(item) => item.toString()}
          contentContainerStyle={styles.selectorPadding}
          renderItem={({ item }) => {
            const isSelected = item === selectedGameweek;
            return (
              <TouchableOpacity
                style={[styles.gwPill, isSelected && styles.gwPillActive]}
                onPress={() => setSelectedGameweek(item)}
              >
                <Text style={[styles.gwText, isSelected && styles.gwTextActive]}>GW{item}</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Main List */}
      {loading && !refreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="small" color="#00ff87" />
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          renderItem={renderTransactionCard}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00ff87" />
          }
          ListEmptyComponent={
            <View style={styles.centerContainer}>
              <Text style={styles.emptyText}>No waiver activity recorded for Gameweek {selectedGameweek}.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },

  selectorContainer: { height: 44, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  selectorPadding: { paddingHorizontal: 12, alignItems: 'center' },
  gwPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#141414',
    marginRight: 8,
  },
  gwPillActive: { backgroundColor: '#00ff87' },
  gwText: { color: '#777', fontSize: 12, fontWeight: '700' },
  gwTextActive: { color: '#000', fontWeight: '900' },

  listContent: { padding: 16 },
  card: {
    backgroundColor: '#121212',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#222',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  teamName: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeSuccess: { backgroundColor: 'rgba(0, 255, 135, 0.15)', borderWidth: 1, borderColor: 'rgba(0, 255, 135, 0.4)' },
  badgeFailed: { backgroundColor: 'rgba(255, 68, 68, 0.15)', borderWidth: 1, borderColor: 'rgba(255, 68, 68, 0.4)' },
  badgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  textSuccess: { color: '#00ff87' },
  textFailed: { color: '#FF4444' },

  cardBody: { gap: 6 },
  playerRow: { flexDirection: 'row', alignItems: 'center' },
  actionTagIn: { color: '#00ff87', fontWeight: '900', fontSize: 11, width: 32 },
  actionTagOut: { color: '#FF4444', fontWeight: '900', fontSize: 11, width: 32 },
  playerName: { color: '#FFF', fontSize: 13, fontWeight: '600', flex: 1 },
  playerOutName: { color: '#888', fontSize: 13, textDecorationLine: 'line-through', flex: 1 },
  posBadge: { color: '#555', fontSize: 10, fontWeight: '800' },
  freeAgentSubtext: { color: '#555', fontSize: 11, fontStyle: 'italic', marginLeft: 32 },

  failureContainer: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderColor: '#1A1A1A' },
  failureText: { color: '#FF6B6B', fontSize: 11, fontWeight: '500' },

  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText: { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 18 },
});