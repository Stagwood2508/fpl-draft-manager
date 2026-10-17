import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import NotificationBell from '@/components/NotificationBell';
import SettingsDropdown from '@/components/SettingsDropdown';
import { AppColors, appRadius, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { useLeagueLoungeUnread } from '@/features/lounge/hooks/useLeagueLoungeUnread';
import { supabase } from '@/utils/supabase';

interface LeagueOption {
  id: string;
  name: string;
}

export function LeagueHeaderSelector() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { currentUserId, activeLeagueId } = useAppSession();
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLeagues = useCallback(async () => {
    if (!currentUserId) {
      setLeagues([]);
      setLoading(false);
      return;
    }

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

  const activeLeague = leagues.find(league => league.id === activeLeagueId) || null;
  return (
    <TouchableOpacity
      style={styles.selector}
      activeOpacity={0.75}
      onPress={() => router.push('/league-selector')}
      accessibilityRole="button"
      accessibilityLabel="Switch active league"
    >
      <View style={styles.selectorCopy}>
        <Text style={styles.selectorLabel}>ACTIVE LEAGUE</Text>
        <Text style={styles.selectorName} numberOfLines={1}>{activeLeague?.name || 'League Hub'}</Text>
      </View>
      {loading ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="chevron-down" size={16} color={colors.accent} />}
    </TouchableOpacity>
  );
}

export function LeagueHeaderActions() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { currentUserId, activeLeagueId } = useAppSession();
  const { unreadCount: loungeUnread } = useLeagueLoungeUnread(activeLeagueId, currentUserId);

  return (
    <View style={styles.actions}>
      <TouchableOpacity
        style={styles.action}
        onPress={() => router.push('/league-lounge')}
        accessibilityRole="button"
        accessibilityLabel={loungeUnread > 0 ? `League Lounge, ${loungeUnread} unread messages` : 'League Lounge'}
      >
        <View>
          <Ionicons name="chatbubbles-outline" size={19} color={colors.accent} />
          {loungeUnread > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{loungeUnread > 99 ? '99+' : loungeUnread}</Text></View> : null}
        </View>
      </TouchableOpacity>
      <NotificationBell />
      <SettingsDropdown />
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  selector: { width: 174, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 5 },
  selectorCopy: { flex: 1, minWidth: 0 },
  selectorLabel: { ...appTypography.label, color: colors.accent, fontSize: 7 },
  selectorName: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  action: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.medium },
  badge: { position: 'absolute', top: -9, right: -11, minWidth: 17, height: 15, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.pill, backgroundColor: colors.danger },
  badgeText: { color: '#FFFFFF', fontSize: 7, fontWeight: '900' },
});
