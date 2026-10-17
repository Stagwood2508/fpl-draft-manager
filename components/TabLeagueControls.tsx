import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import NotificationBell from '@/components/NotificationBell';
import SettingsDropdown from '@/components/SettingsDropdown';
import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { useLeagueLoungeUnread } from '@/features/lounge/hooks/useLeagueLoungeUnread';
import { supabase } from '@/utils/supabase';

interface LeagueOption {
  id: string;
  name: string;
}

export default function TabLeagueControls() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { currentUserId, activeLeagueId, selectActiveLeague } = useAppSession();
  const { unreadCount: loungeUnread } = useLeagueLoungeUnread(activeLeagueId, currentUserId);
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const loadLeagues = useCallback(async () => {
    if (!currentUserId) {
      setLeagues([]);
      setLoading(false);
      return;
    }

    setLoading(true);
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

  const chooseLeague = async (leagueId: string) => {
    setPickerOpen(false);
    if (leagueId !== activeLeagueId) await selectActiveLeague(leagueId);
  };

  return (
    <>
      <View style={[styles.bar, { paddingTop: Math.max(insets.top, appSpacing.sm) }]}>
        <TouchableOpacity
          style={styles.selector}
          onPress={() => setPickerOpen(true)}
          activeOpacity={0.75}
          accessibilityLabel="Switch active league"
        >
          <View style={styles.selectorCopy}>
            <Text style={styles.eyebrow}>ACTIVE LEAGUE</Text>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{activeLeague?.name || 'League Hub'}</Text>
              <Ionicons name="chevron-down" size={16} color={colors.accent} />
            </View>
          </View>
          {loading ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        </TouchableOpacity>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.action}
            onPress={() => router.push('/league-lounge')}
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
      </View>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <TouchableOpacity style={styles.modalCard} activeOpacity={1} onPress={() => undefined}>
            <Text style={styles.modalEyebrow}>LEAGUE CONTEXT</Text>
            <Text style={styles.modalTitle}>Switch active league</Text>
            <ScrollView style={styles.options} contentContainerStyle={styles.optionsContent} showsVerticalScrollIndicator={false}>
              {leagues.map(league => (
                <TouchableOpacity
                  key={league.id}
                  style={[styles.option, league.id === activeLeagueId && styles.optionActive]}
                  onPress={() => void chooseLeague(league.id)}
                >
                  <Text style={styles.optionText} numberOfLines={1}>{league.name}</Text>
                  {league.id === activeLeagueId ? <Ionicons name="checkmark-circle" size={19} color={colors.accent} /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.closeButton} onPress={() => setPickerOpen(false)}>
              <Text style={styles.closeText}>CLOSE</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  bar: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: appSpacing.md, paddingBottom: appSpacing.sm, backgroundColor: colors.backgroundDeep, borderBottomWidth: 1, borderBottomColor: colors.border },
  selector: { minWidth: 0, flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6 },
  selectorCopy: { flex: 1, minWidth: 0 },
  eyebrow: { ...appTypography.label, color: colors.accent, fontSize: 7 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { minWidth: 0, flexShrink: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  action: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.medium },
  badge: { position: 'absolute', top: -9, right: -11, minWidth: 17, height: 15, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.pill, backgroundColor: colors.danger },
  badgeText: { color: '#FFFFFF', fontSize: 7, fontWeight: '900' },
  backdrop: { flex: 1, justifyContent: 'center', padding: appSpacing.lg, backgroundColor: 'rgba(0, 0, 0, 0.62)' },
  modalCard: { padding: appSpacing.lg, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: appRadius.large },
  modalEyebrow: { ...appTypography.label, color: colors.accent },
  modalTitle: { ...appTypography.screenTitle, color: colors.textPrimary, marginTop: 2, marginBottom: appSpacing.md },
  options: { maxHeight: 280 },
  optionsContent: { gap: appSpacing.sm },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: appSpacing.sm, paddingHorizontal: appSpacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium },
  optionActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  optionText: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  closeButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: appSpacing.md, backgroundColor: colors.surface, borderRadius: appRadius.medium },
  closeText: { ...appTypography.label, color: colors.textSecondary },
});
