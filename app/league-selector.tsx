import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

interface LeagueOption { id: string; name: string; }

export default function LeagueSelectorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { currentUserId, activeLeagueId, selectActiveLeague } = useAppSession();
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLeagues = useCallback(async () => {
    if (!currentUserId) { setLeagues([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('league_members')
      .select('league_id, leagues(id, name)')
      .eq('user_id', currentUserId);
    if (!error) {
      setLeagues((data || []).flatMap((row: any) => {
        const league = Array.isArray(row.leagues) ? row.leagues[0] : row.leagues;
        return league ? [{ id: String(league.id), name: String(league.name || 'League') }] : [];
      }));
    }
    setLoading(false);
  }, [currentUserId]);

  useEffect(() => { void loadLeagues(); }, [loadLeagues]);

  const chooseLeague = async (leagueId: string) => {
    if (leagueId !== activeLeagueId) await selectActiveLeague(leagueId);
    router.back();
  };

  return (
    <Pressable style={styles.backdrop} onPress={() => router.back()}>
      <Pressable style={[styles.card, { marginTop: Math.max(insets.top, appSpacing.lg) }]} onPress={() => undefined}>
        <View style={styles.heading}>
          <View><Text style={styles.eyebrow}>LEAGUE CONTEXT</Text><Text style={styles.title}>Switch active league</Text></View>
          <TouchableOpacity style={styles.close} onPress={() => router.back()} accessibilityLabel="Close league selector"><Ionicons name="close" size={20} color={colors.textPrimary} /></TouchableOpacity>
        </View>
        {loading ? <ActivityIndicator size="large" color={colors.accent} style={styles.loading} /> : (
          <ScrollView style={styles.options} contentContainerStyle={styles.optionsContent} showsVerticalScrollIndicator={false}>
            {leagues.map(league => <TouchableOpacity key={league.id} style={[styles.option, league.id === activeLeagueId && styles.optionActive]} onPress={() => void chooseLeague(league.id)}><Text style={styles.optionText} numberOfLines={1}>{league.name}</Text>{league.id === activeLeagueId ? <Ionicons name="checkmark-circle" size={20} color={colors.accent} /> : null}</TouchableOpacity>)}
          </ScrollView>
        )}
      </Pressable>
    </Pressable>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-start', padding: appSpacing.md, backgroundColor: 'rgba(0, 0, 0, 0.62)' },
  card: { maxWidth: 560, width: '100%', alignSelf: 'center', padding: appSpacing.lg, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: appRadius.large },
  heading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: appSpacing.md, marginBottom: appSpacing.md },
  eyebrow: { ...appTypography.label, color: colors.accent },
  title: { ...appTypography.screenTitle, color: colors.textPrimary, marginTop: 2 },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.medium, backgroundColor: colors.surface },
  loading: { marginVertical: appSpacing.xl },
  options: { maxHeight: 420 },
  optionsContent: { gap: appSpacing.sm },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: appSpacing.sm, paddingHorizontal: appSpacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium },
  optionActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  optionText: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
});
