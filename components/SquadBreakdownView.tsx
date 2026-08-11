import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import type { AppColors } from '@/constants/theme';

interface PlayerBreakdown {
  player_id: string;
  web_name: string;
  position: 'GKP' | 'DEF' | 'MID' | 'FWD' | string;
  team_short: string;
  total_points: number;
  starts_count: number;
  avg_points: number;
  is_starting: boolean;
}

interface ViewProps {
  startGw?: number;
  endGw?: number;
}

export default function SquadBreakdownView({ startGw = 1, endGw = 38 }: ViewProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<PlayerBreakdown[]>([]);

  useEffect(() => {
    fetchBreakdownData();
  }, [startGw, endGw]); // Re-fetch on filter change

  const fetchBreakdownData = async () => {
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

      const { data, error } = await supabase.rpc('get_manager_squad_breakdown', {
        p_league_id: memberData.league_id,
        p_user_id: user.id,
        p_start_gw: startGw,
        p_end_gw: endGw,
      });

      if (error) throw error;
      setPlayers(data || []);
    } catch (err: any) {
      Alert.alert('Breakdown Error', err.message);
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

  if (players.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No roster data available for breakdown.</Text>
      </View>
    );
  }

  // Calculate Positional Totals
  const posTotals = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  let grandTotal = 0;

  players.forEach((p) => {
    const pos = p.position.toUpperCase() as keyof typeof posTotals;
    if (posTotals[pos] !== undefined) {
      posTotals[pos] += p.total_points;
    } else {
      posTotals.MID += p.total_points;
    }
    grandTotal += p.total_points;
  });

  const getPosPercent = (pts: number) => {
    if (grandTotal === 0) return 0;
    return Math.round((pts / grandTotal) * 100);
  };

  const posConfigs = [
    { pos: 'GKP', label: 'Goalkeepers', pts: posTotals.GKP, color: '#FFD700' },
    { pos: 'DEF', label: 'Defenders', pts: posTotals.DEF, color: '#00D2FF' },
    { pos: 'MID', label: 'Midfielders', pts: posTotals.MID, color: '#00FF87' },
    { pos: 'FWD', label: 'Forwards', pts: posTotals.FWD, color: '#FF1751' },
  ];

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      {/* HEADER */}
      <View style={styles.headerBox}>
        <Ionicons name="pie-chart" size={18} color="#00FF87" />
        <Text style={styles.headerTitle}>POSITIONAL SCORING SHARE</Text>
        <Text style={styles.headerSub}>Distribution of points earned across all squad positions.</Text>
      </View>

      {/* POSITIONAL PROGRESS BARS */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Points by Position</Text>
        <View style={styles.posList}>
          {posConfigs.map((cfg) => {
            const pct = getPosPercent(cfg.pts);
            return (
              <View key={cfg.pos} style={styles.posRow}>
                <View style={styles.posLabelBox}>
                  <Text style={[styles.posBadge, { color: cfg.color }]}>{cfg.pos}</Text>
                  <Text style={styles.posTitle}>{cfg.label}</Text>
                </View>

                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: cfg.color }]} />
                </View>

                <Text style={styles.posPtsText}>{cfg.pts} pts ({pct}%)</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* PLAYER CONTRIBUTION RANKINGS */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top Squad Contributors</Text>
        <View style={styles.playerList}>
          {players.map((item, idx) => {
            const playerPct = grandTotal > 0 ? Math.round((item.total_points / grandTotal) * 100) : 0;

            return (
              <View key={item.player_id} style={styles.playerCard}>
                <Text style={styles.rankText}>#{idx + 1}</Text>

                <View style={styles.playerMeta}>
                  <View style={styles.playerNameRow}>
                    <Text style={styles.playerName} numberOfLines={1}>{item.web_name}</Text>
                    <Text style={styles.teamTag}>{item.team_short}</Text>
                  </View>
                  <Text style={styles.playerSub}>
                    {item.position} • Avg {item.avg_points} pts/GW • {item.starts_count} starts
                  </Text>
                </View>

                <View style={styles.statBox}>
                  <Text style={styles.statPts}>{item.total_points} pts</Text>
                  <Text style={styles.statPct}>{playerPct}% share</Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  centered: { padding: 40, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingBottom: 20 },
  headerBox: { backgroundColor: colors.surface, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  headerTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '900', letterSpacing: 0.5, marginTop: 4 },
  headerSub: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 2 },
  card: { backgroundColor: colors.surface, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', marginBottom: 12 },
  posList: { gap: 12 },
  posRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  posLabelBox: { width: 110, flexDirection: 'row', alignItems: 'center', gap: 6 },
  posBadge: { fontSize: 11, fontWeight: '900', width: 30 },
  posTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  barTrack: { flex: 1, height: 10, backgroundColor: colors.surfaceMuted, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5 },
  posPtsText: { color: colors.textPrimary, fontSize: 11, fontWeight: '800', width: 85, textAlign: 'right' },
  playerList: { gap: 8 },
  playerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.backgroundElevated, padding: 10, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  rankText: { color: colors.textMuted, fontSize: 11, fontWeight: '900', width: 26 },
  playerMeta: { flex: 1, paddingRight: 8 },
  playerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerName: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  teamTag: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', backgroundColor: colors.surfaceMuted, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  playerSub: { color: colors.textSecondary, fontSize: 10, marginTop: 2 },
  statBox: { alignItems: 'flex-end' },
  statPts: { color: colors.accent, fontSize: 13, fontWeight: '900' },
  statPct: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', marginTop: 1 },
  emptyText: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
});
