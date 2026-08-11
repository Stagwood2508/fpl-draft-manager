import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import LuckIndexView from '@/components/LuckIndexView';
import H2HMatrixView from '@/components/H2HMatrixView';
import TrendsView from '@/components/TrendsView';
import SquadBreakdownView from '@/components/SquadBreakdownView';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import type { AppColors } from '@/constants/theme';

type FilterMode = 'ALL' | 'LAST5' | 'GW';

export default function StatsScreen() {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [activeSegment, setActiveSegment] = useState<'LUCK' | 'H2H' | 'TRENDS' | 'BREAKDOWN'>('LUCK');
  
  // Filter States
  const [filterMode, setFilterMode] = useState<FilterMode>('ALL');
  const [selectedGw, setSelectedGw] = useState<number>(38); // Defaults to current GW

  // Compute start/end GWs for RPC calls
  const startGw = filterMode === 'ALL' ? 1 : filterMode === 'LAST5' ? Math.max(1, selectedGw - 4) : selectedGw;
  const endGw = filterMode === 'ALL' ? 38 : selectedGw;

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>LEAGUE ANALYTICS</Text>
      </View>

      {/* GAMEWEEK FILTER BAR */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          <TouchableOpacity 
            style={[styles.filterPill, filterMode === 'ALL' && styles.filterPillActive]}
            onPress={() => setFilterMode('ALL')}
          >
            <Ionicons name="calendar-outline" size={12} color={filterMode === 'ALL' ? colors.black : colors.textSecondary} />
            <Text style={[styles.filterText, filterMode === 'ALL' && styles.filterTextActive]}>All Season</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.filterPill, filterMode === 'LAST5' && styles.filterPillActive]}
            onPress={() => setFilterMode('LAST5')}
          >
            <Ionicons name="flash-outline" size={12} color={filterMode === 'LAST5' ? colors.black : colors.textSecondary} />
            <Text style={[styles.filterText, filterMode === 'LAST5' && styles.filterTextActive]}>Last 5 GWs</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.filterPill, filterMode === 'GW' && styles.filterPillActive]}
            onPress={() => setFilterMode('GW')}
          >
            <Ionicons name="options-outline" size={12} color={filterMode === 'GW' ? colors.black : colors.textSecondary} />
            <Text style={[styles.filterText, filterMode === 'GW' && styles.filterTextActive]}>
              {filterMode === 'GW' ? `GW ${selectedGw} Only` : 'Single GW'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* MAIN SEGMENT SWITCHER */}
      <View style={styles.segmentedControl}>
        <TouchableOpacity 
          style={[styles.segmentBtn, activeSegment === 'LUCK' && styles.segmentActive]} 
          onPress={() => setActiveSegment('LUCK')}
        >
          <Text style={[styles.segmentText, activeSegment === 'LUCK' && styles.segmentTextActive]}>Luck Index</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.segmentBtn, activeSegment === 'H2H' && styles.segmentActive]} 
          onPress={() => setActiveSegment('H2H')}
        >
          <Text style={[styles.segmentText, activeSegment === 'H2H' && styles.segmentTextActive]}>H2H Matrix</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.segmentBtn, activeSegment === 'TRENDS' && styles.segmentActive]} 
          onPress={() => setActiveSegment('TRENDS')}
        >
          <Text style={[styles.segmentText, activeSegment === 'TRENDS' && styles.segmentTextActive]}>Trends</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.segmentBtn, activeSegment === 'BREAKDOWN' && styles.segmentActive]} 
          onPress={() => setActiveSegment('BREAKDOWN')}
        >
          <Text style={[styles.segmentText, activeSegment === 'BREAKDOWN' && styles.segmentTextActive]}>Breakdown</Text>
        </TouchableOpacity>
      </View>

      {/* SEGMENT CONTENT VIEWS */}
      <View style={styles.contentContainer}>
        {activeSegment === 'LUCK' && <LuckIndexView startGw={startGw} endGw={endGw} />}
        {activeSegment === 'H2H' && <H2HMatrixView startGw={startGw} endGw={endGw} />}
        {activeSegment === 'TRENDS' && <TrendsView startGw={startGw} endGw={endGw} />}
        {activeSegment === 'BREAKDOWN' && <SquadBreakdownView startGw={startGw} endGw={endGw} />}
      </View>
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 8 },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  
  // Filter Styles
  filterContainer: { marginBottom: 10 },
  filterScroll: { paddingHorizontal: 12, gap: 8 },
  filterPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  filterPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  filterTextActive: { color: colors.black },

  // Segment Styles
  segmentedControl: { flexDirection: 'row', backgroundColor: colors.surface, marginHorizontal: 12, borderRadius: 8, padding: 3, borderWidth: 1, borderColor: colors.border },
  segmentBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  segmentTextActive: { color: colors.black },
  contentContainer: { flex: 1, marginTop: 12 },
});
