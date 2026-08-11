import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, FlatList, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import type { AppColors } from '@/constants/theme';

interface LuckRecord {
  user_id: string;
  display_name: string;
  actual_wins: number;
  actual_losses: number;
  actual_draws: number;
  expected_wins: number;
  luck_score: number;
}

interface ViewProps {
  startGw?: number;
  endGw?: number;
}

export default function LuckIndexView({ startGw = 1, endGw = 38 }: ViewProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [luckData, setLuckData] = useState<LuckRecord[]>([]);

  useEffect(() => {
    fetchLuckData();
  }, [startGw, endGw]); // Re-fetch on filter change

  const fetchLuckData = async () => {
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

      const { data, error } = await supabase.rpc('get_league_luck_standings', {
        p_league_id: memberData.league_id,
        p_start_gw: startGw,
        p_end_gw: endGw,
      });

      if (error) throw error;
      setLuckData(data || []);
    } catch (err: any) {
      Alert.alert('Luck Index Error', err.message);
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

  const renderItem = ({ item, index }: { item: LuckRecord; index: number }) => {
    const rawLuckScore = Number(item.luck_score) || 0;
    const isLucky = rawLuckScore > 0;
    const isNeutral = rawLuckScore === 0;

    return (
      <View style={styles.card}>
        <Text style={styles.rankText}>#{index + 1}</Text>

        <View style={styles.managerInfo}>
          <Text style={styles.managerName} numberOfLines={1}>
            {item.display_name}
          </Text>
          <Text style={styles.recordSub}>
            Actual: {item.actual_wins ?? 0}W - {item.actual_losses ?? 0}L | Expected: {item.expected_wins ?? 0}W
          </Text>
        </View>

        <View
          style={[
            styles.badge,
            isLucky ? styles.luckyBadge : isNeutral ? styles.neutralBadge : styles.unluckyBadge,
          ]}
        >
          <Ionicons
            name={isLucky ? 'arrow-up' : isNeutral ? 'remove' : 'arrow-down'}
            size={12}
            color={isLucky ? colors.accent : isNeutral ? colors.textSecondary : colors.danger}
          />
          <Text
            style={[
              styles.badgeText,
              { color: isLucky ? colors.accent : isNeutral ? colors.textSecondary : colors.danger },
            ]}
          >
            {rawLuckScore > 0 ? `+${rawLuckScore}` : rawLuckScore}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <FlatList
      data={luckData}
      keyExtractor={(item) => item.user_id}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        <View style={styles.headerBox}>
          <Ionicons name="sparkles" size={18} color={colors.accent} />
          <Text style={styles.headerTitle}>FIXTURE LUCK RATING</Text>
          <Text style={styles.headerSub}>
            Positive score = Winning matches despite lower gameweek totals.
            Negative score = Losing despite high gameweek outputs.
          </Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>No match statistics recorded yet.</Text>
      }
    />
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  centered: { padding: 40, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingBottom: 20 },
  headerBox: { backgroundColor: colors.surface, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  headerTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '900', letterSpacing: 0.5, marginTop: 4 },
  headerSub: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginBottom: 6 },
  rankText: { color: colors.textMuted, fontSize: 12, fontWeight: '900', width: 28 },
  managerInfo: { flex: 1, paddingRight: 8 },
  managerName: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  recordSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2, fontWeight: '600' },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, gap: 2 },
  luckyBadge: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  neutralBadge: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  unluckyBadge: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder },
  badgeText: { fontSize: 12, fontWeight: '900' },
  emptyText: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 30, fontStyle: 'italic' },
});
