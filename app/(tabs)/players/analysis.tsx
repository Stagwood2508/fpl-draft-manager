import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  useWindowDimensions
} from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';
import { supabase } from '@/utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import type { AppColors } from '@/constants/theme';

interface PlayerAsset {
  id: number;
  first_name: string;
  second_name: string;
  element_type: number; // 1: GKP, 2: DEF, 3: MID, 4: FWD
  total_points: number;
}

interface PerformanceLog {
  gameweek: number;
  opponent: string;
  minutes_played: number;
  points: number;
  // Deep-dive positional sub-metrics
  key_passes: number;
  clearances: number;
  interceptions: number;
  big_chances_created: number;
}

interface FixtureDifficulty {
  gameweek: string;
  opponent: string;
  is_home: boolean;
  difficulty: number; // 1 (Easy) to 5 (Crucial DEFCON)
}

export default function PlayerAnalysisScreen() {
  const { width } = useWindowDimensions();
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors, width), [colors, width]);
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  const [playerPool, setPlayerPool] = useState<PlayerAsset[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerAsset | null>(null);
  
  // Simulated dynamic metric logs & upcoming fixtures
  const [performanceHistory, setPerformanceHistory] = useState<PerformanceLog[]>([]);
  const [upcomingFixtures, setUpcomingFixtures] = useState<FixtureDifficulty[]>([]);

  useEffect(() => {
    if (isFocused) {
      fetchAnalysisContext();
    }
  }, [isFocused]);

  const fetchAnalysisContext = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('players')
        .select('id, first_name, second_name, element_type, total_points')
        .eq('is_active', true)
        .order('total_points', { ascending: false });

      if (error) throw error;
      
      const pooledAssets = data || [];
      setPlayerPool(pooledAssets);
      
      // Auto-select top performer if context isn't set yet
      if (pooledAssets.length > 0 && !selectedPlayer) {
        handlePlayerSelect(pooledAssets[0]);
      }
    } catch (err: any) {
      Alert.alert('Analysis Engine Offline', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayerSelect = (player: PlayerAsset) => {
    setSelectedPlayer(player);
    
    // Generate match-by-match metrics based on player archetype positions
    setPerformanceHistory([
      { gameweek: 35, opponent: 'ARS', minutes_played: 90, points: 8, key_passes: player.element_type >= 3 ? 4 : 1, clearances: player.element_type <= 2 ? 7 : 0, interceptions: 3, big_chances_created: 1 },
      { gameweek: 36, opponent: 'CHE', minutes_played: 81, points: 2, key_passes: player.element_type >= 3 ? 1 : 0, clearances: player.element_type <= 2 ? 4 : 1, interceptions: 1, big_chances_created: 0 },
      { gameweek: 37, opponent: 'LIV', minutes_played: 90, points: 11, key_passes: player.element_type >= 3 ? 3 : 0, clearances: player.element_type <= 2 ? 11 : 0, interceptions: 5, big_chances_created: 2 },
    ]);

    // Construct the next 5 Premier League matching schedules
    setUpcomingFixtures([
      { gameweek: 'GW38', opponent: 'SOU', is_home: true, difficulty: 1 },
      { gameweek: 'GW39', opponent: 'NEW', is_home: false, difficulty: 3 },
      { gameweek: 'GW40', opponent: 'MCI', is_home: false, difficulty: 5 }, // DEFCON Test
      { gameweek: 'GW41', opponent: 'AVL', is_home: true, difficulty: 3 },
      { gameweek: 'GW42', opponent: 'IPS', is_home: true, difficulty: 2 },
    ]);
  };

  // Maps matrix complexity integer weightings to standard layout designs
  const getDifficultyColor = (rating: number) => {
    switch (rating) {
      case 1: return { bg: '#0b2314', border: '#00ff87' }; // Clear Green
      case 2: return { bg: '#162211', border: '#a2ff00' }; // Soft Olive Green
      case 3: return { bg: '#262211', border: '#ffb700' }; // Amber Warning
      case 4: return { bg: '#2d1414', border: '#ff3b30' }; // Standard Red
      case 5: default: return { bg: '#24070a', border: '#ff002b' }; // Crucial DEFCON Dark Red
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* HORIZONTAL ASSET SELECTOR */}
      <View style={styles.pickerContainer}>
        <Text style={styles.metaLabel}>Select Target Asset for Deep-Dive</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
          {playerPool.slice(0, 15).map(p => (
            <TouchableOpacity
              key={p.id}
              style={[styles.pickerBadge, selectedPlayer?.id === p.id && styles.pickerBadgeActive]}
              onPress={() => handlePlayerSelect(p)}
            >
              <Text style={[styles.pickerText, selectedPlayer?.id === p.id && styles.pickerTextActive]}>
                {p.second_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {selectedPlayer && (
          <>
            {/* INTERACTIVE FIXTURE DIFFICULTY MATRIX */}
            <Text style={styles.sectionTitle}>5-Match Threat Matrix Matrix</Text>
            <View style={styles.matrixContainer}>
              {upcomingFixtures.map((fix, idx) => {
                const theme = getDifficultyColor(fix.difficulty);
                return (
                  <View key={idx} style={[styles.matrixCard, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                    <Text style={styles.matrixGw}>{fix.gameweek}</Text>
                    <Text style={styles.matrixOpp}>{fix.opponent}</Text>
                    <Text style={styles.matrixLoc}>{fix.is_home ? 'HOME' : 'AWAY'}</Text>
                    <View style={[styles.difficultyIndicator, { backgroundColor: theme.border }]} />
                  </View>
                );
              })}
            </View>

            {/* STRATEGIC POSITIONAL HISTORY LOGS */}
            <Text style={styles.sectionTitle}>Match Performance Sub-Metrics</Text>
            {performanceHistory.map((log, index) => (
              <View key={index} style={styles.logCard}>
                <View style={styles.logHeader}>
                  <Text style={styles.logGwText}>Gameweek {log.gameweek}</Text>
                  <Text style={styles.logOppText}>vs {log.opponent}</Text>
                  <Text style={styles.logPointsBadge}>{log.points} PTS</Text>
                </View>

                <View style={styles.metricsGrid}>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>Mins Played</Text>
                    <Text style={styles.metricValue}>{log.minutes_played}</Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>Key Passes</Text>
                    <Text style={styles.metricValue}>{log.key_passes}</Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>Clearances</Text>
                    <Text style={styles.metricValue}>{log.clearances}</Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>Interceptions</Text>
                    <Text style={styles.metricValue}>{log.interceptions}</Text>
                  </View>
                </View>
                
                {selectedPlayer.element_type >= 3 && (
                  <View style={styles.traitRow}>
                    <Text style={styles.traitLabel}>Big Chances Created: </Text>
                    <Text style={styles.traitValue}>{log.big_chances_created}</Text>
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: AppColors, screenWidth: number) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  pickerContainer: { paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  metaLabel: { fontSize: 10, color: colors.textSecondary, textTransform: 'uppercase', fontWeight: '800', marginLeft: 14, marginBottom: 8, letterSpacing: 0.5 },
  pickerScroll: { paddingHorizontal: 10 },
  pickerBadge: { backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, borderRadius: 2 },
  pickerBadgeActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pickerText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  pickerTextActive: { color: colors.accent, fontWeight: '900' },
  content: { padding: 14, paddingBottom: 40 },
  sectionTitle: { fontSize: 12, fontWeight: '900', color: colors.textPrimary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginTop: 14 },
  
  // MATRIX LAYOUT STYLES
  matrixContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  matrixCard: { width: Math.max(54, (screenWidth - 28) / 5.4), borderWidth: 1, paddingVertical: 10, borderRadius: 2, alignItems: 'center', position: 'relative' },
  matrixGw: { color: colors.textSecondary, fontSize: 9, fontWeight: '800' },
  matrixOpp: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 4 },
  matrixLoc: { color: colors.textSecondary, fontSize: 8, fontWeight: '700', marginTop: 2 },
  difficultyIndicator: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3 },

  // LOG PERFORMANCE CARDS
  logCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10, borderRadius: 2 },
  logHeader: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8, marginBottom: 10 },
  logGwText: { color: colors.textPrimary, fontWeight: '800', fontSize: 13, width: '35%' },
  logOppText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12, width: '35%' },
  logPointsBadge: { color: colors.accent, fontWeight: '900', fontSize: 13, width: '30%', textAlign: 'right' },
  metricsGrid: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' },
  metricItem: { width: '23%', alignItems: 'center', backgroundColor: colors.backgroundElevated, paddingVertical: 8, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: 2 },
  metricLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '800', textTransform: 'uppercase' },
  metricValue: { color: colors.textPrimary, fontSize: 13, fontWeight: '800', marginTop: 3 },
  traitRow: { flexDirection: 'row', marginTop: 10, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: 8 },
  traitLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  traitValue: { color: colors.accent, fontSize: 11, fontWeight: '800' }
});
