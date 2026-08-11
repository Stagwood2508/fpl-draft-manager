import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

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
  announcements_enabled: boolean;
  trades_enabled: boolean;
  waivers_enabled: boolean;
  match_updates_enabled: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  announcements_enabled: true,
  trades_enabled: true,
  waivers_enabled: true,
  match_updates_enabled: true,
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
  const { currentUserId } = useAppSession();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<InboxFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [savingPreferences, setSavingPreferences] = useState(false);

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
          .select('announcements_enabled, trades_enabled, waivers_enabled, match_updates_enabled')
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

      <Modal visible={preferencesOpen} transparent animationType="fade" onRequestClose={() => setPreferencesOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>NOTIFICATION SETTINGS</Text>
            <Text style={styles.modalTitle}>Choose what reaches your inbox</Text>
            {([
              ['announcements_enabled', 'League announcements', 'Commissioner updates and urgent notices', 'megaphone-outline'],
              ['trades_enabled', 'Trades', 'New offers and offer outcomes', 'people-outline'],
              ['waivers_enabled', 'Waivers', 'Successful and unsuccessful claims', 'swap-vertical-outline'],
              ['match_updates_enabled', 'Match updates', 'Live and final match alerts when enabled', 'football-outline'],
            ] as const).map(([key, label, description, icon]) => (
              <View key={key} style={styles.preferenceRow}>
                <Ionicons name={icon} size={18} color={appColors.accent} />
                <View style={styles.preferenceCopy}><Text style={styles.preferenceLabel}>{label}</Text><Text style={styles.preferenceDescription}>{description}</Text></View>
                <Switch value={preferences[key]} onValueChange={value => setPreferences(current => ({ ...current, [key]: value }))} trackColor={{ false: appColors.surfaceMuted, true: appColors.accentDark }} thumbColor={preferences[key] ? appColors.accent : appColors.textMuted} />
              </View>
            ))}
            <View style={styles.modalActions}><TouchableOpacity style={styles.cancelButton} onPress={() => setPreferencesOpen(false)}><Text style={styles.cancelText}>CANCEL</Text></TouchableOpacity><TouchableOpacity style={styles.saveButton} disabled={savingPreferences} onPress={() => void savePreferences()}>{savingPreferences ? <ActivityIndicator size="small" color={appColors.backgroundDeep} /> : <Text style={styles.saveText}>SAVE</Text>}</TouchableOpacity></View>
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
  unreadDot: { width: 8, height: 8, backgroundColor: appColors.accent, borderRadius: 4 },
  clearButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: appSpacing.sm },
  clearText: { ...appTypography.label, color: appColors.textMuted, fontSize: 8 },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: appSpacing.lg, backgroundColor: 'rgba(0,0,0,0.82)' },
  modalCard: { width: '100%', maxWidth: 520, padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.borderStrong, borderRadius: appRadius.large },
  modalEyebrow: { ...appTypography.label, color: appColors.accent },
  modalTitle: { ...appTypography.screenTitle, color: appColors.textPrimary, marginTop: 2, marginBottom: appSpacing.md },
  preferenceRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: appColors.borderSubtle },
  preferenceCopy: { flex: 1 },
  preferenceLabel: { color: appColors.textPrimary, fontSize: 12, fontWeight: '800' },
  preferenceDescription: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 2 },
  modalActions: { flexDirection: 'row', gap: appSpacing.sm, marginTop: appSpacing.md },
  cancelButton: { minHeight: 40, flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.surfaceMuted, borderRadius: appRadius.small },
  cancelText: { ...appTypography.label, color: appColors.textSecondary },
  saveButton: { minHeight: 40, flex: 1.4, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.accent, borderRadius: appRadius.small },
  saveText: { ...appTypography.label, color: appColors.backgroundDeep },
});
