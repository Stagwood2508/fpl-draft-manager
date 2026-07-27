import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, FlatList, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/utils/supabase';

interface H2HRecord {
  manager_a_id: string;
  manager_a_name: string;
  manager_b_id: string;
  manager_b_name: string;
  wins: number;
  losses: number;
  draws: number;
  points_for: number;
  points_against: number;
  diff: number;
}

interface ViewProps {
  startGw?: number;
  endGw?: number;
}

export default function H2HMatrixView({ startGw = 1, endGw = 38 }: ViewProps) {
  const [loading, setLoading] = useState(true);
  const [matrixData, setMatrixData] = useState<H2HRecord[]>([]);

  useEffect(() => {
    fetchH2HData();
  }, [startGw, endGw]);

  const fetchH2HData = async () => {
    try {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated.');

      const { data: memberData } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();

      if (!memberData) throw new Error('League profile missing.');

      const { data, error } = await supabase.rpc('get_manager_h2h_matrix', {
        p_league_id: memberData.league_id,
        p_start_gw: startGw,
        p_end_gw: endGw,
      });

      if (error) throw error;

      // Filter to show matchups relative to the current logged-in manager
      const userMatches = (data || []).filter((r: H2HRecord) => r.manager_a_id === user.id);
      setMatrixData(userMatches);
    } catch (err: any) {
      Alert.alert('H2H Matrix Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color="#00FF87" />
      </View>
    );
  }

  const renderItem = ({ item }: { item: H2HRecord }) => {
    const isDominant = item.wins > item.losses;
    const isTied = item.wins === item.losses;

    return (
      <View style={styles.card}>
        <View style={styles.opponentInfo}>
          <Text style={styles.opponentName} numberOfLines={1}>
            vs {item.manager_b_name}
          </Text>
          <Text style={styles.pointsSub}>
            PF: {item.points_for} | PA: {item.points_against} ({item.diff > 0 ? `+${item.diff}` : item.diff})
          </Text>
        </View>

        <View style={styles.recordBadge}>
          <Text style={styles.recordText}>
            {item.wins}W - {item.draws}D - {item.losses}L
          </Text>
        </View>

        <View
          style={[
            styles.statusPill,
            isDominant ? styles.winPill : isTied ? styles.drawPill : styles.lossPill,
          ]}
        >
          <Ionicons
            name={isDominant ? 'shield-checkmark' : isTied ? 'remove' : 'close-circle'}
            size={12}
            color={isDominant ? '#00FF87' : isTied ? '#888' : '#FF1751'}
          />
        </View>
      </View>
    );
  };

  return (
    <FlatList
      data={matrixData}
      keyExtractor={(item) => item.manager_b_id}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        <View style={styles.headerBox}>
          <Ionicons name="swap-horizontal" size={18} color="#00FF87" />
          <Text style={styles.headerTitle}>HEAD-TO-HEAD MATRIX</Text>
          <Text style={styles.headerSub}>
            Your direct win/loss history and point differential against rival managers.
          </Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>No rival match records available.</Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: { padding: 40, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingBottom: 20 },
  headerBox: { backgroundColor: '#141416', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#222', marginBottom: 12 },
  headerTitle: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5, marginTop: 4 },
  headerSub: { color: '#888', fontSize: 11, lineHeight: 15, marginTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161616', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#262626', marginBottom: 6 },
  opponentInfo: { flex: 1, paddingRight: 8 },
  opponentName: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  pointsSub: { color: '#777', fontSize: 11, marginTop: 2, fontWeight: '600' },
  recordBadge: { backgroundColor: '#111', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#222', marginRight: 8 },
  recordText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  statusPill: { padding: 6, borderRadius: 4, borderWidth: 1 },
  winPill: { backgroundColor: '#00FF8710', borderColor: '#00FF8744' },
  drawPill: { backgroundColor: '#222', borderColor: '#333' },
  lossPill: { backgroundColor: '#FF175110', borderColor: '#FF175144' },
  emptyText: { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 30, fontStyle: 'italic' },
});