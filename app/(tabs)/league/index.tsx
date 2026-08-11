import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  FlatList, 
  ActivityIndicator, 
  TouchableOpacity, 
  Animated 
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { AppColors } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

interface StandingRow {
  rank: number;
  user_id: string;
  team_name?: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  total_h2h_score: number;
  total_fpl_points: number;
  total_defcon_points: number;
  last_rank?: number;
}

export default function StandingsScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [currentGW, setCurrentGW] = useState(1);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  
  // Cache League ID to avoid unnecessary re-lookups
  const cachedLeagueId = useRef<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (isLive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(0.3);
    }
  }, [isLive]);

  useFocusEffect(
    useCallback(() => {
      // Re-evaluate context on focus to ensure active league changes apply
      fetchData(isLive);
    }, [isLive])
  );

  async function fetchData(liveMode: boolean) {
    try {
      if (!refreshing && standings.length === 0) setLoading(true);

      // 1. Resolve Active League ID from AsyncStorage
      const storedLeagueId = await AsyncStorage.getItem('active_league_id');
      let targetLeagueId = storedLeagueId;

      if (!targetLeagueId) {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData?.user) return;

        const { data: membership } = await supabase
          .from('league_members')
          .select('league_id')
          .eq('user_id', authData.user.id)
          .maybeSingle();

        if (!membership?.league_id) {
          setStandings([]);
          return;
        }

        const membershipLeagueId = membership.league_id;
        targetLeagueId = membershipLeagueId;
        await AsyncStorage.setItem('active_league_id', membershipLeagueId);
      }

      cachedLeagueId.current = targetLeagueId;

      // 2. Fetch current active Gameweek
      const { data: gwData } = await supabase
        .from('player_gameweek_stats')
        .select('gameweek')
        .order('gameweek', { ascending: false })
        .limit(1)
        .maybeSingle();

      const activeGW = gwData?.gameweek || 1;
      setCurrentGW(activeGW);

      // 3. Fetch Active Standings & Baseline Standings in PARALLEL (Scoped to targetLeagueId)
      const [activeRes, lastGwRes] = await Promise.all([
        supabase.rpc('get_league_standings', {
          p_league_id: targetLeagueId,
          p_gameweek: activeGW,
          p_is_live: liveMode,
        }),
        liveMode
          ? supabase.rpc('get_league_standings', {
              p_league_id: targetLeagueId,
              p_gameweek: activeGW,
              p_is_live: false,
            })
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (activeRes.error) throw activeRes.error;

      const lastRankMap = new Map<string, number>();
      if (lastGwRes.data) {
        lastGwRes.data.forEach((row: StandingRow) => {
          lastRankMap.set(row.user_id, row.rank);
        });
      }

      const processedStandings: StandingRow[] = (activeRes.data || []).map((row: StandingRow) => ({
        ...row,
        last_rank: lastRankMap.get(row.user_id) || row.rank,
      }));

      setStandings(processedStandings);
    } catch (err: any) {
      console.error('Error fetching standings:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData(isLive);
  };

  const renderRankChange = (currentRank: number, lastRank?: number) => {
    if (!lastRank || !isLive) return null;
    const diff = lastRank - currentRank;

    if (diff > 0) return <Text style={styles.rankUp}>▲+{diff}</Text>;
    if (diff < 0) return <Text style={styles.rankDown}>▼{diff}</Text>;
    return <Text style={styles.rankSame}>-</Text>;
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[styles.toggleButton, !isLive && styles.toggleButtonActive]}
            onPress={() => setIsLive(false)}
          >
            <Text style={[styles.toggleText, !isLive && styles.toggleTextActive]}>Official</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toggleButton, isLive && styles.toggleButtonLiveActive]}
            onPress={() => setIsLive(true)}
          >
            <View style={styles.liveButtonContent}>
              <Animated.View
                style={[
                  styles.liveDot,
                  { opacity: isLive ? pulseAnim : 0.3, backgroundColor: isLive ? colors.danger : colors.textMuted },
                ]}
              />
              <Text style={[styles.toggleText, isLive && styles.toggleTextActive]}>LIVE</Text>
            </View>
          </TouchableOpacity>
        </View>

        {isLive && (
          <View style={styles.liveBadgeContainer}>
            <Animated.View style={[styles.pulsingBadge, { opacity: pulseAnim }]} />
            <Text style={styles.liveBadgeText}>IN-PLAY GW{currentGW}</Text>
          </View>
        )}
      </View>

      <View style={styles.tableHeaderRow}>
        <View style={styles.colRank}><Text style={styles.thText}>Rk</Text></View>
        <View style={styles.colTeam}><Text style={styles.thText}>Team</Text></View>
        <View style={styles.colStat}><Text style={styles.thText}>P</Text></View>
        <View style={styles.colStat}><Text style={styles.thText}>W</Text></View>
        <View style={styles.colStat}><Text style={styles.thText}>D</Text></View>
        <View style={styles.colStat}><Text style={styles.thText}>L</Text></View>
        <View style={styles.colPfPts}><Text style={styles.thText}>PF</Text></View>
        <View style={styles.colMainPts}><Text style={[styles.thText, styles.textRight]}>PTS</Text></View>
      </View>

      {loading && !refreshing && standings.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : standings.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No standings data found for this league.</Text>
        </View>
      ) : (
        <FlatList
          data={standings}
          keyExtractor={(item) => item.user_id}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          renderItem={({ item, index }) => {
            const displayRank = item.rank ?? index + 1;
            const isTopSpot = displayRank === 1;

            return (
              <View
                style={[
                  styles.tableBodyRow,
                  index % 2 === 1 && styles.rowAlternate,
                  isTopSpot && styles.rowTopSpot,
                ]}
              >
                <View style={styles.colRank}>
                  <Text style={[styles.tdText, isTopSpot && styles.rankGold]}>{displayRank}</Text>
                  {renderRankChange(displayRank, item.last_rank)}
                </View>

                <View style={styles.colTeam}>
                  <Text style={[styles.tdText, styles.teamHighlight]} numberOfLines={1}>
                    {item.team_name || 'FC Manager'}
                  </Text>
                </View>

                <View style={styles.colStat}><Text style={styles.tdText}>{item.played ?? 0}</Text></View>
                <View style={styles.colStat}><Text style={styles.tdText}>{item.won ?? 0}</Text></View>
                <View style={styles.colStat}><Text style={styles.tdText}>{item.drawn ?? 0}</Text></View>
                <View style={styles.colStat}><Text style={styles.tdText}>{item.lost ?? 0}</Text></View>
                <View style={styles.colPfPts}><Text style={styles.tdText}>{item.total_h2h_score ?? 0}</Text></View>

                <View style={styles.colMainPts}>
                  <Text style={[styles.tdText, styles.pointsHighlight, styles.textRight]}>
                    {item.points ?? 0}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.backgroundDeep,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toggleContainer: { flexDirection: 'row', backgroundColor: colors.surfaceMuted, borderRadius: 8, padding: 2 },
  toggleButton: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6 },
  toggleButtonActive: { backgroundColor: colors.surfacePressed },
  toggleButtonLiveActive: { backgroundColor: colors.dangerSoft },
  liveButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  toggleText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  toggleTextActive: { color: colors.textPrimary },
  liveBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    gap: 6,
  },
  pulsingBadge: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  liveBadgeText: { color: colors.danger, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  tableBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  rowAlternate: { backgroundColor: colors.surfaceMuted },
  rowTopSpot: { backgroundColor: colors.accentSoft, borderLeftWidth: 2, borderLeftColor: colors.accent },
  thText: { color: colors.textMuted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  tdText: { color: colors.textSecondary, fontSize: 11, textAlign: 'center' },
  textRight: { textAlign: 'right' },
  colRank: { width: '10%', alignItems: 'flex-start', justifyContent: 'center' },
  colTeam: { width: '32%', justifyContent: 'center' },
  colStat: { width: '7%', alignItems: 'center', justifyContent: 'center' },
  colPfPts: { width: '16%', alignItems: 'center', justifyContent: 'center' },
  colMainPts: { width: '14%', paddingRight: 4, justifyContent: 'center' },
  rankGold: { color: colors.accent, fontWeight: '900' },
  teamHighlight: { color: colors.textPrimary, fontWeight: '700', textAlign: 'left' },
  pointsHighlight: { color: colors.accent, fontWeight: '900', fontSize: 12 },
  rankUp: { color: colors.accent, fontSize: 8, fontWeight: '900' },
  rankDown: { color: colors.danger, fontSize: 8, fontWeight: '900' },
  rankSame: { color: colors.textMuted, fontSize: 8, fontWeight: '700' },
});
