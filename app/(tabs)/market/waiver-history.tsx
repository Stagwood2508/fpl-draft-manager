import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';

import {
  AppColors,
  appRadius,
  appSpacing,
  appTypography,
} from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import {
  getLeagueActivity,
  isCompletedActivityStatus,
  LeagueActivityCategory,
  LeagueActivityItem,
  LeagueActivityPlayer,
} from '@/features/market/services/leagueActivity';

type ActivityFilter = 'ALL' | LeagueActivityCategory;
type ActivityScope = 'MINE' | 'LEAGUE';

const CATEGORY_FILTERS: { key: ActivityFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'ALL', label: 'All', icon: 'list' },
  { key: 'WAIVER', label: 'Waivers', icon: 'swap-vertical' },
  { key: 'FREE_AGENT', label: 'Free agents', icon: 'flash' },
  { key: 'TRADE', label: 'Trades', icon: 'people' },
];

const isCompletedStatus = isCompletedActivityStatus;

const formatActivityDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return parsed.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const playerLabel = (player: LeagueActivityPlayer) => player.web_name || 'Unknown player';

export default function TransactionHistoryScreen() {
  const { colors: appColors } = useAppTheme();
  const styles = useMemo(() => createStyles(appColors), [appColors]);
  const categoryMeta = useMemo<Record<LeagueActivityCategory, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }>>(() => ({
    WAIVER: { label: 'WAIVER', color: '#7967D8', icon: 'swap-vertical' },
    FREE_AGENT: { label: 'FREE AGENT', color: appColors.info, icon: 'flash' },
    TRADE: { label: 'TRADE', color: appColors.accent, icon: 'people' },
  }), [appColors]);
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 900;
  const { currentUserId, activeLeagueId } = useAppSession();

  const [scope, setScope] = useState<ActivityScope>('MINE');
  const [category, setCategory] = useState<ActivityFilter>('ALL');
  const [activities, setActivities] = useState<LeagueActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchTransactionHistory = useCallback(async (asRefresh = false) => {
    if (!currentUserId || !activeLeagueId) {
      setActivities([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (asRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMessage(null);

    try {
      setActivities(await getLeagueActivity(activeLeagueId));
    } catch (error: any) {
      setActivities([]);
      setErrorMessage(error?.message || 'Transaction history could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeLeagueId, currentUserId]);

  useEffect(() => {
    if (isFocused) void fetchTransactionHistory();
  }, [fetchTransactionHistory, isFocused]);

  const filteredActivities = useMemo(() => activities.filter(activity => {
    if (scope === 'MINE' && !activity.managerIds.includes(currentUserId || '')) return false;
    if (category !== 'ALL' && activity.category !== category) return false;
    return true;
  }), [activities, category, currentUserId, scope]);

  const renderPlayerMovement = (label: 'IN' | 'OUT', players: LeagueActivityPlayer[]) => {
    if (players.length === 0) return null;
    return (
      <View style={styles.movementRow}>
        <View style={[styles.movementBadge, label === 'IN' ? styles.movementBadgeIn : styles.movementBadgeOut]}>
          <Text style={[styles.movementBadgeText, label === 'IN' ? styles.movementTextIn : styles.movementTextOut]}>{label}</Text>
        </View>
        <View style={styles.playerList}>
          {players.map((player, index) => (
            <View key={`${label}-${player.id || index}-${index}`} style={styles.playerLine}>
              <Text style={styles.playerName} numberOfLines={1}>{playerLabel(player)}</Text>
              <Text style={styles.playerMeta} numberOfLines={1}>
                {[player.element_type, player.team_short_name || player.team_name].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderActivity = ({ item }: { item: LeagueActivityItem }) => {
    const meta = categoryMeta[item.category];
    const success = isCompletedStatus(item.status);
    const pending = item.status === 'PENDING';

    return (
      <View style={[styles.card, isDesktop && styles.cardDesktop]}>
        <View style={styles.cardHeader}>
          <View style={[styles.categoryIcon, { borderColor: `${meta.color}55`, backgroundColor: `${meta.color}16` }]}>
            <Ionicons name={meta.icon} size={15} color={meta.color} />
          </View>
          <View style={styles.cardHeading}>
            <View style={styles.titleRow}>
              <Text style={[styles.categoryLabel, { color: meta.color }]}>{meta.label}</Text>
              {item.gameweek ? <Text style={styles.gameweekLabel}>GW{item.gameweek}</Text> : null}
            </View>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.cardSubtitle}>{item.subtitle} · {formatActivityDate(item.timestamp)}</Text>
          </View>
          <View style={[
            styles.statusBadge,
            success ? styles.statusSuccess : pending ? styles.statusPending : styles.statusFailed,
          ]}>
            <Text style={[
              styles.statusText,
              success ? styles.statusTextSuccess : pending ? styles.statusTextPending : styles.statusTextFailed,
            ]}>{item.status}</Text>
          </View>
        </View>

        {(item.playersIn.length > 0 || item.playersOut.length > 0) && (
          <View style={[styles.movements, isDesktop && styles.movementsDesktop]}>
            {renderPlayerMovement('IN', item.playersIn)}
            {renderPlayerMovement('OUT', item.playersOut)}
          </View>
        )}

        {item.failureReason ? (
          <View style={styles.failurePanel}>
            <Ionicons name="alert-circle" size={14} color={appColors.danger} />
            <Text style={styles.failureText}>{item.failureReason}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  const listHeader = (
    <View style={[styles.headerContent, isDesktop && styles.headerContentDesktop]}>
      <View style={styles.headingBlock}>
        <Text style={styles.eyebrow}>MARKET ACTIVITY</Text>
        <Text style={styles.title}>Transaction History</Text>
        <Text style={styles.subtitle}>Waivers, free-agent signings and trades in one chronological record.</Text>
      </View>

      <View style={[styles.filterPanel, isDesktop && styles.filterPanelDesktop]}>
        <View style={styles.filterGroup}>
          <Text style={styles.filterLabel}>SHOW</Text>
          <View style={styles.scopeRow}>
            {([
              { key: 'MINE' as const, label: 'My activity', icon: 'person' as const },
              { key: 'LEAGUE' as const, label: 'Whole league', icon: 'trophy' as const },
            ]).map(option => (
              <TouchableOpacity
                key={option.key}
                style={[styles.scopeButton, scope === option.key && styles.filterButtonActive]}
                onPress={() => setScope(option.key)}
              >
                <Ionicons name={option.icon} size={14} color={scope === option.key ? appColors.backgroundDeep : appColors.textMuted} />
                <Text style={[styles.filterButtonText, scope === option.key && styles.filterButtonTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.filterGroup}>
          <Text style={styles.filterLabel}>TYPE</Text>
          <View style={styles.categoryRow}>
            {CATEGORY_FILTERS.map(option => (
              <TouchableOpacity
                key={option.key}
                style={[styles.categoryButton, category === option.key && styles.filterButtonActive]}
                onPress={() => setCategory(option.key)}
              >
                <Ionicons name={option.icon} size={13} color={category === option.key ? appColors.backgroundDeep : appColors.textMuted} />
                <Text style={[styles.categoryButtonText, category === option.key && styles.filterButtonTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.resultSummary}>
        <Text style={styles.resultCount}>{filteredActivities.length} {filteredActivities.length === 1 ? 'record' : 'records'}</Text>
        <Text style={styles.resultHint}>Pull down to refresh</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingState}>
          <ActivityIndicator size="small" color={appColors.accent} />
          <Text style={styles.loadingText}>Loading transaction history…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={filteredActivities}
        keyExtractor={item => item.id}
        renderItem={renderActivity}
        ListHeaderComponent={listHeader}
        contentContainerStyle={[styles.listContent, isDesktop && styles.listContentDesktop]}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void fetchTransactionHistory(true)}
            tintColor={appColors.accent}
            colors={[appColors.accent]}
          />
        )}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name={errorMessage ? 'cloud-offline' : 'receipt-outline'} size={24} color={errorMessage ? appColors.danger : appColors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>{errorMessage ? 'History unavailable' : 'No matching transactions'}</Text>
            <Text style={styles.emptyText}>
              {errorMessage || 'Completed activity will appear here. Try another scope or transaction type.'}
            </Text>
            {errorMessage ? (
              <TouchableOpacity style={styles.retryButton} onPress={() => void fetchTransactionHistory()}>
                <Text style={styles.retryButtonText}>TRY AGAIN</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const createStyles = (appColors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: appColors.background },
  listContent: { paddingHorizontal: appSpacing.md, paddingBottom: 110, gap: appSpacing.sm },
  listContentDesktop: { width: '100%', maxWidth: 1120, alignSelf: 'center', paddingHorizontal: appSpacing.xl },
  headerContent: { marginHorizontal: -appSpacing.md, marginBottom: appSpacing.sm },
  headerContentDesktop: { marginHorizontal: -appSpacing.xl },
  headingBlock: {
    paddingHorizontal: appSpacing.lg,
    paddingTop: appSpacing.xl,
    paddingBottom: appSpacing.lg,
    backgroundColor: appColors.backgroundDeep,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  eyebrow: { ...appTypography.label, color: appColors.accent, marginBottom: 5 },
  title: { ...appTypography.screenTitle, color: appColors.textPrimary, fontSize: 25 },
  subtitle: { ...appTypography.body, color: appColors.textMuted, marginTop: 6, maxWidth: 650 },
  filterPanel: { padding: appSpacing.md, gap: appSpacing.md },
  filterPanelDesktop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: appSpacing.lg },
  filterGroup: { gap: 7 },
  filterLabel: { ...appTypography.label, color: appColors.textMuted },
  scopeRow: { flexDirection: 'row', gap: 7 },
  scopeButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: appRadius.small,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  categoryButton: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: appRadius.small,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  filterButtonActive: { backgroundColor: appColors.accent, borderColor: appColors.accent },
  filterButtonText: { ...appTypography.label, color: appColors.textMuted },
  categoryButtonText: { ...appTypography.label, color: appColors.textMuted, fontSize: 9 },
  filterButtonTextActive: { color: appColors.backgroundDeep },
  resultSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: appSpacing.md,
    paddingBottom: 4,
  },
  resultCount: { ...appTypography.label, color: appColors.textSecondary },
  resultHint: { ...appTypography.metadata, color: appColors.textMuted },
  card: {
    backgroundColor: appColors.surface,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: appRadius.medium,
    padding: appSpacing.md,
    gap: appSpacing.sm,
  },
  cardDesktop: { paddingHorizontal: appSpacing.lg },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  categoryIcon: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cardHeading: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3 },
  categoryLabel: { ...appTypography.label, fontSize: 9 },
  gameweekLabel: { ...appTypography.metadata, color: appColors.textMuted, fontSize: 9 },
  cardTitle: { ...appTypography.sectionTitle, color: appColors.textPrimary, fontSize: 14 },
  cardSubtitle: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 3 },
  statusBadge: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 6, borderWidth: 1 },
  statusSuccess: { backgroundColor: 'rgba(0,242,122,0.09)', borderColor: 'rgba(0,242,122,0.28)' },
  statusPending: { backgroundColor: 'rgba(255,179,64,0.09)', borderColor: 'rgba(255,179,64,0.28)' },
  statusFailed: { backgroundColor: 'rgba(255,77,120,0.09)', borderColor: 'rgba(255,77,120,0.28)' },
  statusText: { ...appTypography.label, fontSize: 8 },
  statusTextSuccess: { color: appColors.accent },
  statusTextPending: { color: appColors.warning },
  statusTextFailed: { color: appColors.danger },
  movements: { gap: 8, paddingTop: 4 },
  movementsDesktop: { flexDirection: 'row' },
  movementRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 9,
    borderRadius: appRadius.small,
    backgroundColor: appColors.backgroundDeep,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  movementBadge: { width: 30, paddingVertical: 4, borderRadius: 5, alignItems: 'center' },
  movementBadgeIn: { backgroundColor: 'rgba(0,242,122,0.12)' },
  movementBadgeOut: { backgroundColor: 'rgba(255,77,120,0.12)' },
  movementBadgeText: { ...appTypography.label, fontSize: 8 },
  movementTextIn: { color: appColors.accent },
  movementTextOut: { color: appColors.danger },
  playerList: { flex: 1, gap: 6 },
  playerLine: { minWidth: 0 },
  playerName: { ...appTypography.sectionTitle, color: appColors.textPrimary, fontSize: 12 },
  playerMeta: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 1 },
  failurePanel: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 9, borderRadius: appRadius.small, backgroundColor: 'rgba(255,77,120,0.07)' },
  failureText: { ...appTypography.metadata, color: appColors.danger, flex: 1 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { ...appTypography.body, color: appColors.textMuted },
  emptyState: { alignItems: 'center', paddingHorizontal: appSpacing.xl, paddingVertical: 54 },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { ...appTypography.sectionTitle, color: appColors.textPrimary, fontSize: 15 },
  emptyText: { ...appTypography.body, color: appColors.textMuted, textAlign: 'center', marginTop: 5, maxWidth: 420 },
  retryButton: { marginTop: 14, paddingHorizontal: 16, paddingVertical: 9, borderRadius: appRadius.small, backgroundColor: appColors.accent },
  retryButtonText: { ...appTypography.label, color: appColors.backgroundDeep },
});
