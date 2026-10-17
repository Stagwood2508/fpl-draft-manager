import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

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
  commissionerId: string | null;
}

export default function LeagueContextHeader() {
  const router = useRouter();
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
      .select('league_id, leagues(id, name, commissioner_id)')
      .eq('user_id', currentUserId);

    if (!error) {
      setLeagues((data || []).flatMap((row: any) => {
        const league = Array.isArray(row.leagues) ? row.leagues[0] : row.leagues;
        return league ? [{
          id: String(league.id),
          name: String(league.name || 'League'),
          commissionerId: league.commissioner_id ? String(league.commissioner_id) : null,
        }] : [];
      }));
    }
    setLoading(false);
  }, [currentUserId]);

  useEffect(() => {
    void loadLeagues();
  }, [loadLeagues]);

  const activeLeague = leagues.find(league => league.id === activeLeagueId) || null;
  const isCommissioner = activeLeague?.commissionerId === currentUserId;

  const chooseLeague = async (leagueId: string) => {
    setPickerOpen(false);
    if (leagueId !== activeLeagueId) await selectActiveLeague(leagueId);
  };

  return (
    <>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.selector}
          onPress={() => setPickerOpen(true)}
          activeOpacity={0.75}
          accessibilityLabel="Switch active league"
        >
          <View style={styles.selectorCopy}>
            <Text style={styles.selectorLabel}>ACTIVE LEAGUE</Text>
            <View style={styles.selectorNameRow}>
              <Text style={styles.selectorName} numberOfLines={1}>{activeLeague?.name || 'League Hub'}</Text>
              <Ionicons name="chevron-down" size={16} color={colors.accent} />
            </View>
          </View>
          {loading ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        </TouchableOpacity>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => router.push('/league-lounge')}
            accessibilityLabel={loungeUnread > 0 ? `League Lounge, ${loungeUnread} unread messages` : 'League Lounge'}
          >
            <View>
              <Ionicons name="chatbubbles-outline" size={19} color={colors.accent} />
              {loungeUnread > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{loungeUnread > 99 ? '99+' : loungeUnread}</Text></View> : null}
            </View>
          </TouchableOpacity>
          {isCommissioner ? (
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => router.push({ pathname: '/(admin)/league-announcements', params: { leagueId: activeLeagueId || '' } } as any)}
              accessibilityLabel="League announcements"
            >
              <Ionicons name="megaphone-outline" size={19} color={colors.accent} />
            </TouchableOpacity>
          ) : null}
          <NotificationBell />
          <SettingsDropdown />
        </View>
      </View>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <TouchableOpacity style={styles.modalCard} activeOpacity={1} onPress={() => undefined}>
            <Text style={styles.modalEyebrow}>LEAGUE CONTEXT</Text>
            <Text style={styles.modalTitle}>Switch active league</Text>
            {leagues.map(league => (
              <TouchableOpacity
                key={league.id}
                style={[styles.leagueOption, league.id === activeLeagueId && styles.leagueOptionActive]}
                onPress={() => void chooseLeague(league.id)}
              >
                <Text style={styles.leagueOptionText} numberOfLines={1}>{league.name}</Text>
                {league.id === activeLeagueId ? <Ionicons name="checkmark-circle" size={19} color={colors.accent} /> : null}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.closeButton} onPress={() => setPickerOpen(false)}>
              <Text style={styles.closeButtonText}>CLOSE</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: appSpacing.md, paddingVertical: appSpacing.sm, backgroundColor: colors.backgroundDeep, borderBottomWidth: 1, borderBottomColor: colors.border },
  selector: { minWidth: 0, flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6 },
  selectorCopy: { flex: 1, minWidth: 0 },
  selectorLabel: { ...appTypography.label, color: colors.accent, fontSize: 7 },
  selectorNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  selectorName: { minWidth: 0, flexShrink: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  iconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.medium },
  badge: { position: 'absolute', top: -9, right: -11, minWidth: 17, height: 15, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.pill, backgroundColor: colors.danger },
  badgeText: { color: '#FFFFFF', fontSize: 7, fontWeight: '900' },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: appSpacing.lg, backgroundColor: 'rgba(0, 0, 0, 0.62)' },
  modalCard: { gap: appSpacing.sm, padding: appSpacing.lg, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: appRadius.large },
  modalEyebrow: { ...appTypography.label, color: colors.accent },
  modalTitle: { ...appTypography.screenTitle, color: colors.textPrimary, marginBottom: appSpacing.sm },
  leagueOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: appSpacing.sm, paddingHorizontal: appSpacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium },
  leagueOptionActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  leagueOptionText: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  closeButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: appSpacing.sm, backgroundColor: colors.surface, borderRadius: appRadius.medium },
  closeButtonText: { ...appTypography.label, color: colors.textSecondary },
});
