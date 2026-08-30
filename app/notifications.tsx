import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';
import { disablePushNotifications, enablePushNotifications } from '@/features/notifications/services/pushNotifications';

type NotificationCategory = 'ANNOUNCEMENT' | 'TRADE' | 'WAIVER' | 'MATCH' | 'SYSTEM';
type InboxFilter = 'ALL' | 'UNREAD';

interface NotificationItem {
  id: number;
  league_id: string | null;
  category: NotificationCategory;
  title: string;
  body: string;
  route: string | null;
  read_at: string | null;
  created_at: string;
  leagues: { name?: string | null } | { name?: string | null }[] | null;
}

interface NotificationPreferences {
  push_enabled: boolean;
  announcements_enabled: boolean;
  trades_enabled: boolean;
  waivers_enabled: boolean;
  match_updates_enabled: boolean;
  own_player_events_enabled: boolean;
  opponent_player_events_enabled: boolean;
  draft_enabled: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  push_enabled: false,
  announcements_enabled: true,
  trades_enabled: true,
  waivers_enabled: true,
  match_updates_enabled: true,
  own_player_events_enabled: true,
  opponent_player_events_enabled: true,
  draft_enabled: true,
};

const firstRelation = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? value[0] || null : value || null;

const relativeTime = (timestamp: string) => {
  const elapsed = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export default function NotificationCentreScreen() {
  const safeArea = useSafeAreaInsets();
  const { colors: appColors } = useAppTheme();
  const styles = useMemo(() => createStyles(appColors), [appColors]);
  const categoryMeta = useMemo<Record<NotificationCategory, { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; label: string }>>(() => ({
    ANNOUNCEMENT: { icon: 'megaphone-outline', color: appColors.accent, label: 'ANNOUNCEMENT' },
    TRADE: { icon: 'people-outline', color: appColors.info, label: 'TRADE' },
    WAIVER: { icon: 'swap-vertical-outline', color: '#7967D8', label: 'WAIVER' },
    MATCH: { icon: 'football-outline', color: appColors.warning, label: 'MATCH' },
    SYSTEM: { icon: 'information-circle-outline', color: appColors.textSecondary, label: 'SYSTEM' },
  }), [appColors]);
  const router = useRouter();
  const { settings: settingsParam } = useLocalSearchParams<{ settings?: string | string[] }>();
  const { currentUserId } = useAppSession();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<InboxFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [pushChanging, setPushChanging] = useState(false);
  const [sendingPushTest, setSendingPushTest] = useState(false);

  useEffect(() => {
    const shouldOpenSettings = Array.isArray(settingsParam)
      ? settingsParam.includes('1')
      : settingsParam === '1';
    if (shouldOpenSettings) setPreferencesOpen(true);
  }, [settingsParam]);

  const loadNotifications = useCallback(async (asRefresh = false) => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }
    if (asRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [notificationResponse, preferenceResponse] = await Promise.all([
        supabase
          .from('user_notifications')
          .select('id, league_id, category, title, body, route, read_at, created_at, leagues(name)')
          .eq('user_id', currentUserId)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('notification_preferences')
          .select('push_enabled, announcements_enabled, trades_enabled, waivers_enabled, match_updates_enabled, own_player_events_enabled, opponent_player_events_enabled, draft_enabled')
          .eq('user_id', currentUserId)
          .maybeSingle(),
      ]);
      if (notificationResponse.error) throw notificationResponse.error;
      if (preferenceResponse.error) throw preferenceResponse.error;
      setNotifications((notificationResponse.data || []) as NotificationItem[]);
      setPreferences(preferenceResponse.data || DEFAULT_PREFERENCES);
    } catch (error: any) {
      Alert.alert('Notifications unavailable', error?.message || 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    void loadNotifications();
    if (!currentUserId) return;
    const channel = supabase
      .channel(`notification-centre-${currentUserId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${currentUserId}` }, () => void loadNotifications(true))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [currentUserId, loadNotifications]);

  const unreadCount = notifications.filter(item => !item.read_at).length;
  const visibleNotifications = useMemo(
    () => filter === 'UNREAD' ? notifications.filter(item => !item.read_at) : notifications,
    [filter, notifications]
  );

  const markRead = async (item: NotificationItem) => {
    if (!item.read_at) {
      const readAt = new Date().toISOString();
      setNotifications(current => current.map(notification => notification.id === item.id ? { ...notification, read_at: readAt } : notification));
      await supabase.from('user_notifications').update({ read_at: readAt }).eq('id', item.id).eq('user_id', currentUserId || '');
    }
    if (item.route && item.route !== '/notifications') router.push(item.route as any);
  };

  const markAllRead = async () => {
    if (!currentUserId || unreadCount === 0) return;
    const readAt = new Date().toISOString();
    const { error } = await supabase.from('user_notifications').update({ read_at: readAt }).eq('user_id', currentUserId).is('read_at', null);
    if (error) Alert.alert('Notifications not updated', error.message);
    else setNotifications(current => current.map(item => ({ ...item, read_at: item.read_at || readAt })));
  };

  const clearRead = () => {
    if (!currentUserId || notifications.every(item => !item.read_at)) return;
    Alert.alert('Clear read notifications?', 'Unread notifications will remain.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('user_notifications').delete().eq('user_id', currentUserId).not('read_at', 'is', null);
          if (error) Alert.alert('Notifications not cleared', error.message);
          else setNotifications(current => current.filter(item => !item.read_at));
        },
      },
    ]);
  };

  const savePreferences = async () => {
    if (!currentUserId) return;
    setSavingPreferences(true);
    const { error } = await supabase.from('notification_preferences').upsert({
      user_id: currentUserId,
      ...preferences,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    setSavingPreferences(false);
    if (error) Alert.alert('Preferences not saved', error.message);
    else setPreferencesOpen(false);
  };

  const changePushEnabled = async (enabled: boolean) => {
    if (Platform.OS === 'web') {
      Alert.alert('Installed app required', 'Push notifications are currently available in the installed Android app. Browser notifications will be added separately.');
      return;
    }
    setPushChanging(true);
    try {
      if (enabled) {
        const result = await enablePushNotifications(true);
        if (result.status !== 'ENABLED') {
          Alert.alert(result.status === 'DENIED' ? 'Permission required' : 'Push unavailable', result.message);
          return;
        }
      } else {
        await disablePushNotifications();
      }
      setPreferences(current => ({ ...current, push_enabled: enabled }));
    } catch (error: any) {
      Alert.alert('Push setting not changed', error?.message || 'Please try again.');
    } finally {
      setPushChanging(false);
    }
  };

  const sendPushTest = async () => {
    setSendingPushTest(true);
    try {
      const { error } = await supabase.rpc('create_test_push_notification');
      if (error) throw error;
      Alert.alert('Test queued', 'The notification should arrive shortly. You can leave the app or lock your phone while waiting.');
    } catch (error: any) {
      Alert.alert('Test not queued', error?.message || 'Please try again.');
    } finally {
      setSendingPushTest(false);
    }
  };

  if (loading) return <SafeAreaView style={styles.centered}><ActivityIndicator size="large" color={appColors.accent} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}><Ionicons name="arrow-back" size={20} color={appColors.textPrimary} /></TouchableOpacity>
        <View style={styles.headerCopy}><Text style={styles.headerEyebrow}>YOUR ACCOUNT</Text><Text style={styles.headerTitle}>Notifications</Text><Text style={styles.headerMeta}>{unreadCount} unread</Text></View>
        <TouchableOpacity style={styles.headerButton} onPress={() => setPreferencesOpen(true)}><Ionicons name="options-outline" size={20} color={appColors.accent} /></TouchableOpacity>
      </View>

      <View style={styles.toolbar}>
        <View style={styles.filters}>
          {(['ALL', 'UNREAD'] as InboxFilter[]).map(item => <TouchableOpacity key={item} style={[styles.filterButton, filter === item && styles.filterButtonActive]} onPress={() => setFilter(item)}><Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item}{item === 'UNREAD' && unreadCount ? ` ${unreadCount}` : ''}</Text></TouchableOpacity>)}
        </View>
        <TouchableOpacity disabled={unreadCount === 0} onPress={() => void markAllRead()}><Text style={[styles.toolbarAction, unreadCount === 0 && styles.toolbarActionDisabled]}>MARK ALL READ</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadNotifications(true)} tintColor={appColors.accent} />}>
        {visibleNotifications.length === 0 ? (
          <View style={styles.emptyState}><Ionicons name="notifications-off-outline" size={28} color={appColors.textDisabled} /><Text style={styles.emptyTitle}>{filter === 'UNREAD' ? 'You are all caught up' : 'No notifications yet'}</Text><Text style={styles.emptyBody}>League announcements, trade activity and waiver outcomes will appear here.</Text></View>
        ) : visibleNotifications.map(item => {
          const meta = categoryMeta[item.category] || categoryMeta.SYSTEM;
          const league = firstRelation<{ name?: string | null }>(item.leagues);
          return (
            <TouchableOpacity key={item.id} style={[styles.notificationCard, !item.read_at && styles.notificationCardUnread]} onPress={() => void markRead(item)} activeOpacity={0.78}>
              <View style={[styles.categoryIcon, { backgroundColor: `${meta.color}16`, borderColor: `${meta.color}55` }]}><Ionicons name={meta.icon} size={17} color={meta.color} /></View>
              <View style={styles.notificationCopy}>
                <View style={styles.notificationMetaRow}><Text style={[styles.categoryLabel, { color: meta.color }]}>{meta.label}</Text>{league?.name ? <Text style={styles.leagueName} numberOfLines={1}>{league.name}</Text> : null}</View>
                <Text style={styles.notificationTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.notificationBody} numberOfLines={2}>{item.body}</Text>
                <Text style={styles.notificationTime}>{relativeTime(item.created_at)}</Text>
              </View>
              {!item.read_at ? <View style={styles.unreadDot} /> : null}
              {item.route && item.route !== '/notifications' ? <Ionicons name="chevron-forward" size={14} color={appColors.textDisabled} /> : null}
            </TouchableOpacity>
          );
        })}
        {notifications.some(item => item.read_at) ? <TouchableOpacity style={styles.clearButton} onPress={clearRead}><Text style={styles.clearText}>CLEAR READ NOTIFICATIONS</Text></TouchableOpacity> : null}
      </ScrollView>

      <Modal visible={preferencesOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setPreferencesOpen(false)}>
        <View style={[styles.modalOverlay, { paddingTop: Math.max(safeArea.top, appSpacing.md), paddingBottom: Math.max(safeArea.bottom, appSpacing.md) }]}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>NOTIFICATION SETTINGS</Text>
            <Text style={styles.modalTitle}>Choose what reaches your inbox</Text>
            <View style={styles.pushPreferenceCard}>
              <View style={styles.pushPreferenceIcon}><Ionicons name="notifications-outline" size={20} color={appColors.accent} /></View>
              <View style={styles.preferenceCopy}>
                <Text style={styles.preferenceLabel}>Push notifications</Text>
                <Text style={styles.preferenceDescription}>{Platform.OS === 'web' ? 'Available in the installed Android app' : preferences.push_enabled ? 'Enabled on this device' : 'Off until you choose to enable them'}</Text>
              </View>
              {pushChanging ? <ActivityIndicator size="small" color={appColors.accent} /> : <Switch disabled={Platform.OS === 'web'} value={preferences.push_enabled} onValueChange={value => void changePushEnabled(value)} trackColor={{ false: appColors.surfaceMuted, true: appColors.accentDark }} thumbColor={preferences.push_enabled ? appColors.accent : appColors.textMuted} />}
            </View>
            {Platform.OS !== 'web' && preferences.push_enabled ? <TouchableOpacity style={styles.pushTestButton} disabled={sendingPushTest} onPress={() => void sendPushTest()}>{sendingPushTest ? <ActivityIndicator size="small" color={appColors.accent} /> : <><Ionicons name="paper-plane-outline" size={14} color={appColors.accent} /><Text style={styles.pushTestText}>SEND A TEST NOTIFICATION</Text></>}</TouchableOpacity> : null}
            {([
              ['announcements_enabled', 'League announcements', 'Commissioner updates and urgent notices', 'megaphone-outline'],
              ['trades_enabled', 'Trades', 'New offers and offer outcomes', 'people-outline'],
              ['waivers_enabled', 'Waivers', 'Successful and unsuccessful claims', 'swap-vertical-outline'],
              ['match_updates_enabled', 'Match updates', 'Live and final match alerts when enabled', 'football-outline'],
              ['own_player_events_enabled', 'My squad scoring events', 'Goals, assists, save points and custom DEFCON thresholds', 'shirt-outline'],
              ['opponent_player_events_enabled', 'Opponent scoring events', 'Alerts when your head-to-head opponent scores', 'people-circle-outline'],
              ['draft_enabled', 'Draft reminders', 'Waiting-room and draft-start alerts', 'timer-outline'],
            ] as const).map(([key, label, description, icon]) => (
              <View key={key} style={styles.preferenceRow}>
                <Ionicons name={icon} size={18} color={appColors.accent} />
                <View style={styles.preferenceCopy}><Text style={styles.preferenceLabel}>{label}</Text><Text style={styles.preferenceDescription}>{description}</Text></View>
                <Switch value={preferences[key]} onValueChange={value => setPreferences(current => ({ ...current, [key]: value }))} trackColor={{ false: appColors.surfaceMuted, true: appColors.accentDark }} thumbColor={preferences[key] ? appColors.accent : appColors.textMuted} />
              </View>
            ))}
            <View style={styles.modalActions}><TouchableOpacity style={styles.cancelButton} onPress={() => setPreferencesOpen(false)}><Text style={styles.cancelText}>CANCEL</Text></TouchableOpacity><TouchableOpacity style={styles.saveButton} disabled={savingPreferences} onPress={() => void savePreferences()}>{savingPreferences ? <ActivityIndicator size="small" color={appColors.accentForeground} /> : <Text style={styles.saveText}>SAVE</Text>}</TouchableOpacity></View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (appColors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: appColors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.background },
  header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: appSpacing.sm, paddingHorizontal: appSpacing.md, backgroundColor: appColors.backgroundDeep, borderBottomWidth: 1, borderBottomColor: appColors.border },
  headerButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  headerEyebrow: { ...appTypography.label, color: appColors.accent, fontSize: 8 },
  headerTitle: { ...appTypography.screenTitle, color: appColors.textPrimary, fontSize: 17 },
  headerMeta: { ...appTypography.metadata, color: appColors.textMuted },
  toolbar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: appSpacing.sm, paddingHorizontal: appSpacing.md, backgroundColor: appColors.backgroundElevated, borderBottomWidth: 1, borderBottomColor: appColors.border },
  filters: { flexDirection: 'row', gap: 6 },
  filterButton: { minHeight: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.pill },
  filterButtonActive: { backgroundColor: appColors.accentSoft, borderColor: appColors.accentBorder },
  filterText: { ...appTypography.label, color: appColors.textMuted, fontSize: 8 },
  filterTextActive: { color: appColors.accent },
  toolbarAction: { ...appTypography.label, color: appColors.accent, fontSize: 8 },
  toolbarActionDisabled: { color: appColors.textDisabled },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: appSpacing.sm, padding: appSpacing.md, paddingBottom: 40 },
  emptyState: { alignItems: 'center', gap: appSpacing.sm, padding: 40, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  emptyTitle: { ...appTypography.sectionTitle, color: appColors.textPrimary },
  emptyBody: { ...appTypography.metadata, color: appColors.textMuted, textAlign: 'center' },
  notificationCard: { minHeight: 91, flexDirection: 'row', alignItems: 'center', gap: 10, padding: appSpacing.md, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  notificationCardUnread: { backgroundColor: appColors.surface, borderColor: appColors.accentBorder },
  categoryIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: appRadius.medium },
  notificationCopy: { flex: 1, minWidth: 0 },
  notificationMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  categoryLabel: { ...appTypography.label, fontSize: 8 },
  leagueName: { ...appTypography.metadata, flex: 1, color: appColors.textMuted },
  notificationTitle: { color: appColors.textPrimary, fontSize: 12, fontWeight: '900', marginTop: 2 },
  notificationBody: { ...appTypography.metadata, color: appColors.textSecondary, marginTop: 3 },
  notificationTime: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 4 },
  unreadDot: { width: 8, height: 8, backgroundColor: appColors.accentFill, borderRadius: 4 },
  clearButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: appSpacing.sm },
  clearText: { ...appTypography.label, color: appColors.textMuted, fontSize: 8 },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: appSpacing.lg, backgroundColor: 'rgba(0,0,0,0.82)' },
  modalCard: { width: '100%', maxWidth: 520, padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.borderStrong, borderRadius: appRadius.large },
  modalEyebrow: { ...appTypography.label, color: appColors.accent },
  modalTitle: { ...appTypography.screenTitle, color: appColors.textPrimary, marginTop: 2, marginBottom: appSpacing.md },
  pushPreferenceCard: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: appSpacing.sm, marginBottom: 5, backgroundColor: appColors.accentSoft, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.medium },
  pushPreferenceIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.surface, borderRadius: appRadius.medium },
  pushTestButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 5, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.small },
  pushTestText: { ...appTypography.label, color: appColors.accent, fontSize: 8 },
  preferenceRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: appColors.borderSubtle },
  preferenceCopy: { flex: 1 },
  preferenceLabel: { color: appColors.textPrimary, fontSize: 12, fontWeight: '800' },
  preferenceDescription: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 2 },
  modalActions: { flexDirection: 'row', gap: appSpacing.sm, marginTop: appSpacing.md },
  cancelButton: { minHeight: 40, flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.surfaceMuted, borderRadius: appRadius.small },
  cancelText: { ...appTypography.label, color: appColors.textSecondary },
  saveButton: { minHeight: 40, flex: 1.4, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.accentFill, borderRadius: appRadius.small },
  saveText: { ...appTypography.label, color: appColors.accentForeground },
});
