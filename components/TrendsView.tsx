import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, ScrollView, Alert, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-gifted-charts';
import { supabase } from '@/utils/supabase';

interface TrendRecord {
  gameweek: number;
  points: number;
  cumulative_points: number;
  match_result: 'WIN' | 'LOSS' | 'DRAW' | 'NONE';
}

interface ViewProps {
  startGw?: number;
  endGw?: number;
}

const screenWidth = Dimensions.get('window').width;

export default function TrendsView({ startGw = 1, endGw = 38 }: ViewProps) {
  const [loading, setLoading] = useState(true);
  const [trendData, setTrendData] = useState<TrendRecord[]>([]);

  useEffect(() => {
    fetchTrendData();
  }, [startGw, endGw]);

  const fetchTrendData = async () => {
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

      const { data, error } = await supabase.rpc('get_manager_trends_data', {
        p_league_id: memberData.league_id,
        p_user_id: user.id,
        p_start_gw: startGw,
        p_end_gw: endGw,
      });

      if (error) throw error;
      setTrendData(data || []);
    } catch (err: any) {
      Alert.alert('Trends Error', err.message);
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

  if (trendData.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No gameweek statistics recorded for this range.</Text>
      </View>
    );
  }

  // Format line chart points
  const chartPoints = trendData.map((d) => ({
    value: Number(d.points) || 0,
    label: `GW${d.gameweek}`,
    dataPointColor: d.match_result === 'WIN' ? '#00FF87' : d.match_result === 'LOSS' ? '#FF1751' : '#888',
  }));

  const totalPts = trendData.reduce((acc, curr) => acc + (Number(curr.points) || 0), 0);
  const avgPts = (totalPts / trendData.length).toFixed(1);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      {/* HEADER */}
      <View style={styles.headerBox}>
        <Ionicons name="trending-up" size={18} color="#00FF87" />
        <Text style={styles.headerTitle}>PERFORMANCE TRENDS</Text>
        <Text style={styles.headerSub}>
          Weekly point scores with match outcomes (Green = Win, Red = Loss).
        </Text>
      </View>

      {/* STAT SUMMARY BANNER */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Range Total</Text>
          <Text style={styles.summaryVal}>{totalPts} pts</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Average / GW</Text>
          <Text style={styles.summaryVal}>{avgPts} pts</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Matches</Text>
          <Text style={styles.summaryVal}>{trendData.length} GWs</Text>
        </View>
      </View>

      {/* LINE CHART */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Gameweek Scores</Text>
        <View style={styles.chartWrapper}>
          <LineChart
            data={chartPoints}
            width={screenWidth - 80}
            height={180}
            color="#00FF87"
            thickness={2}
            startOpacity={0.2}
            endOpacity={0.0}
            noOfSections={4}
            yAxisColor="#222"
            xAxisColor="#222"
            yAxisTextStyle={{ color: '#666', fontSize: 10 }}
            xAxisLabelTextStyle={{ color: '#666', fontSize: 9 }}
            hideRules
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { padding: 40, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingBottom: 20 },
  headerBox: { backgroundColor: '#141416', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#222', marginBottom: 12 },
  headerTitle: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5, marginTop: 4 },
  headerSub: { color: '#888', fontSize: 11, lineHeight: 15, marginTop: 2 },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  summaryCard: { flex: 1, backgroundColor: '#161616', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#262626', alignItems: 'center' },
  summaryLabel: { color: '#666', fontSize: 10, fontWeight: '700' },
  summaryVal: { color: '#00FF87', fontSize: 14, fontWeight: '900', marginTop: 2 },
  chartCard: { backgroundColor: '#161616', padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#262626' },
  chartTitle: { color: '#FFF', fontSize: 14, fontWeight: '800', marginBottom: 12 },
  chartWrapper: { alignItems: 'center', marginTop: 8 },
  emptyText: { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 30, fontStyle: 'italic' },
});