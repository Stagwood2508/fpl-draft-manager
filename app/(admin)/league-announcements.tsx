import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

type AnnouncementPriority = 'NORMAL' | 'URGENT';
type ExpiryChoice = 'NONE' | '24H' | '3D' | '7D';

interface LeagueAnnouncementRow {
  id: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  is_pinned: boolean;
  published_at: string;
  expires_at: string | null;
  created_at: string;
}

const EXPIRY_OPTIONS: { id: ExpiryChoice; label: string; hours: number | null }[] = [
  { id: 'NONE', label: 'No expiry', hours: null },
  { id: '24H', label: '24 hours', hours: 24 },
  { id: '3D', label: '3 days', hours: 72 },
  { id: '7D', label: '7 days', hours: 168 },
];

const formatDate = (value: string | null) => {
  if (!value) return 'No expiry';
  return new Date(value).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function LeagueAnnouncementsScreen() {
  const { colors: appColors } = useAppTheme();
  const styles = useMemo(() => createStyles(appColors), [appColors]);
  const safeArea = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ leagueId?: string | string[] }>();
  const { currentUserId, activeLeagueId } = useAppSession();
  const requestedLeagueId = Array.isArray(params.leagueId) ? params.leagueId[0] : params.leagueId;
  const leagueId = requestedLeagueId || activeLeagueId;

  const [announcements, setAnnouncements] = useState<LeagueAnnouncementRow[]>([]);
  const [leagueName, setLeagueName] = useState('League');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<AnnouncementPriority>('NORMAL');
  const [isPinned, setIsPinned] = useState(false);
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>('7D');
  const [saving, setSaving] = useState(false);

  const loadAnnouncements = useCallback(async (asRefresh = false) => {
    if (!leagueId || !currentUserId) {
      setLoading(false);
      return;
    }
    if (asRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [leagueResponse, announcementResponse] = await Promise.all([
        supabase.from('leagues').select('name, commissioner_id').eq('id', leagueId).maybeSingle(),
        supabase
          .from('league_announcements')
          .select('id, title, body, priority, is_pinned, published_at, expires_at, created_at')
          .eq('league_id', leagueId)
          .order('is_pinned', { ascending: false })
          .order('published_at', { ascending: false }),
      ]);
      if (leagueResponse.error) throw leagueResponse.error;
      if (announcementResponse.error) throw announcementResponse.error;
      setLeagueName(leagueResponse.data?.name || 'League');
      setIsCommissioner(leagueResponse.data?.commissioner_id === currentUserId);
      setAnnouncements((announcementResponse.data || []) as LeagueAnnouncementRow[]);
    } catch (error: any) {
      Alert.alert('Announcements unavailable', error?.message || 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUserId, leagueId]);

  useEffect(() => { void loadAnnouncements(); }, [loadAnnouncements]);

  const openCreate = () => {
    setEditingId(null);
    setTitle('');
    setBody('');
    setPriority('NORMAL');
    setIsPinned(false);
    setExpiryChoice('7D');
    setEditorOpen(true);
  };

  const openEdit = (announcement: LeagueAnnouncementRow) => {
    setEditingId(announcement.id);
    setTitle(announcement.title);
    setBody(announcement.body);
    setPriority(announcement.priority);
    setIsPinned(announcement.is_pinned);
    setExpiryChoice(announcement.expires_at ? '7D' : 'NONE');
    setEditorOpen(true);
  };

  const saveAnnouncement = async () => {
    if (!leagueId || !currentUserId || !title.trim() || !body.trim()) {
      Alert.alert('Message incomplete', 'Add both a title and message.');
      return;
    }
    const expiryOption = EXPIRY_OPTIONS.find(option => option.id === expiryChoice);
    const publishedAt = new Date();
    const expiresAt = expiryOption?.hours
      ? new Date(publishedAt.getTime() + expiryOption.hours * 3_600_000).toISOString()
      : null;
    const payload = {
      league_id: leagueId,
      author_id: currentUserId,
      title: title.trim(),
      body: body.trim(),
      priority,
      is_pinned: isPinned,
      published_at: publishedAt.toISOString(),
      expires_at: expiresAt,
      updated_at: publishedAt.toISOString(),
    };

    setSaving(true);
    try {
      const response = editingId
        ? await supabase.from('league_announcements').update(payload).eq('id', editingId).eq('league_id', leagueId)
        : await supabase.from('league_announcements').insert(payload);
      if (response.error) throw response.error;
      setEditorOpen(false);
      await loadAnnouncements(true);
    } catch (error: any) {
      Alert.alert('Announcement not saved', error?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const deleteAnnouncement = (announcement: LeagueAnnouncementRow) => {
    Alert.alert('Remove announcement?', announcement.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('league_announcements').delete().eq('id', announcement.id).eq('league_id', leagueId || '');
          if (error) Alert.alert('Announcement not removed', error.message);
          else await loadAnnouncements(true);
        },
      },
    ]);
  };

  const isActive = (announcement: LeagueAnnouncementRow) =>
    new Date(announcement.published_at).getTime() <= Date.now()
    && (!announcement.expires_at || new Date(announcement.expires_at).getTime() > Date.now());

  if (loading) {
    return <SafeAreaView style={styles.centered}><ActivityIndicator size="large" color={appColors.accent} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}><Ionicons name="arrow-back" size={20} color={appColors.textPrimary} /></TouchableOpacity>
        <View style={styles.headerCopy}><Text style={styles.headerEyebrow}>COMMISSIONER TOOLS</Text><Text style={styles.headerTitle}>Announcements</Text><Text style={styles.headerMeta}>{leagueName}</Text></View>
        {isCommissioner ? <TouchableOpacity style={styles.createButton} onPress={openCreate}><Ionicons name="add" size={18} color={appColors.accentForeground} /><Text style={styles.createButtonText}>NEW</Text></TouchableOpacity> : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadAnnouncements(true)} tintColor={appColors.accent} />}
      >
        {announcements.length === 0 ? (
          <View style={styles.emptyState}><Ionicons name="megaphone-outline" size={27} color={appColors.textDisabled} /><Text style={styles.emptyTitle}>No announcements yet</Text><Text style={styles.emptyMeta}>Publish a short message for every manager in this league.</Text></View>
        ) : announcements.map(announcement => (
          <View key={announcement.id} style={[styles.card, announcement.priority === 'URGENT' && styles.cardUrgent]}>
            <View style={styles.cardHeader}>
              <View style={styles.badges}>
                <View style={[styles.badge, isActive(announcement) ? styles.badgeActive : styles.badgeExpired]}><Text style={[styles.badgeText, isActive(announcement) ? styles.badgeTextActive : styles.badgeTextExpired]}>{isActive(announcement) ? 'ACTIVE' : 'EXPIRED'}</Text></View>
                {announcement.priority === 'URGENT' ? <View style={[styles.badge, styles.badgeUrgent]}><Text style={[styles.badgeText, styles.badgeTextUrgent]}>URGENT</Text></View> : null}
                {announcement.is_pinned ? <Ionicons name="pin" size={14} color={appColors.accent} /> : null}
              </View>
              {isCommissioner ? <View style={styles.cardActions}><TouchableOpacity onPress={() => openEdit(announcement)}><Ionicons name="create-outline" size={18} color={appColors.info} /></TouchableOpacity><TouchableOpacity onPress={() => deleteAnnouncement(announcement)}><Ionicons name="trash-outline" size={18} color={appColors.danger} /></TouchableOpacity></View> : null}
            </View>
            <Text style={styles.cardTitle}>{announcement.title}</Text>
            <Text style={styles.cardBody}>{announcement.body}</Text>
            <Text style={styles.cardMeta}>Published {formatDate(announcement.published_at)} · Expires {formatDate(announcement.expires_at)}</Text>
          </View>
        ))}
      </ScrollView>

      <Modal visible={editorOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setEditorOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modalOverlay, { paddingTop: Math.max(safeArea.top, appSpacing.md), paddingBottom: Math.max(safeArea.bottom, appSpacing.md) }]}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>{editingId ? 'EDIT MESSAGE' : 'NEW MESSAGE'}</Text>
            <Text style={styles.modalTitle}>{editingId ? 'Update announcement' : 'Notify the league'}</Text>
            <TextInput value={title} onChangeText={setTitle} maxLength={80} placeholder="Short title" placeholderTextColor={appColors.textDisabled} style={styles.titleInput} />
            <TextInput value={body} onChangeText={setBody} maxLength={1000} multiline placeholder="Message for league managers" placeholderTextColor={appColors.textDisabled} style={styles.bodyInput} />
            <View style={styles.toggleRow}>
              <TouchableOpacity style={[styles.toggle, priority === 'URGENT' && styles.toggleUrgent]} onPress={() => setPriority(current => current === 'URGENT' ? 'NORMAL' : 'URGENT')}><Ionicons name="warning-outline" size={16} color={priority === 'URGENT' ? appColors.danger : appColors.textMuted} /><Text style={[styles.toggleText, priority === 'URGENT' && styles.toggleTextUrgent]}>Urgent</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.toggle, isPinned && styles.toggleSelected]} onPress={() => setIsPinned(current => !current)}><Ionicons name="pin-outline" size={16} color={isPinned ? appColors.accent : appColors.textMuted} /><Text style={[styles.toggleText, isPinned && styles.toggleTextSelected]}>Pin to Home</Text></TouchableOpacity>
            </View>
            <Text style={styles.expiryLabel}>EXPIRY</Text>
            <View style={styles.expiryOptions}>{EXPIRY_OPTIONS.map(option => <TouchableOpacity key={option.id} style={[styles.expiryOption, expiryChoice === option.id && styles.expiryOptionSelected]} onPress={() => setExpiryChoice(option.id)}><Text style={[styles.expiryOptionText, expiryChoice === option.id && styles.expiryOptionTextSelected]}>{option.label}</Text></TouchableOpacity>)}</View>
            <View style={styles.modalActions}><TouchableOpacity style={styles.cancelButton} onPress={() => setEditorOpen(false)}><Text style={styles.cancelText}>CANCEL</Text></TouchableOpacity><TouchableOpacity style={styles.saveButton} disabled={saving} onPress={() => void saveAnnouncement()}>{saving ? <ActivityIndicator size="small" color={appColors.accentForeground} /> : <Text style={styles.saveText}>{editingId ? 'UPDATE' : 'PUBLISH'}</Text>}</TouchableOpacity></View>
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (appColors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: appColors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.background },
  header: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: appSpacing.sm, paddingHorizontal: appSpacing.md, backgroundColor: appColors.backgroundDeep, borderBottomWidth: 1, borderBottomColor: appColors.border },
  headerButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  headerEyebrow: { ...appTypography.label, color: appColors.accent, fontSize: 8 },
  headerTitle: { ...appTypography.screenTitle, color: appColors.textPrimary, fontSize: 17 },
  headerMeta: { ...appTypography.metadata, color: appColors.textMuted },
  createButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, backgroundColor: appColors.accentFill, borderRadius: appRadius.small },
  createButtonText: { ...appTypography.label, color: appColors.accentForeground },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: appSpacing.sm, padding: appSpacing.md, paddingBottom: 40 },
  emptyState: { alignItems: 'center', gap: appSpacing.sm, padding: 40, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  emptyTitle: { ...appTypography.sectionTitle, color: appColors.textPrimary },
  emptyMeta: { ...appTypography.metadata, color: appColors.textMuted, textAlign: 'center' },
  card: { padding: appSpacing.md, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  cardUrgent: { backgroundColor: appColors.dangerSoft, borderColor: appColors.dangerBorder },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: appRadius.pill },
  badgeActive: { backgroundColor: appColors.accentSoft },
  badgeExpired: { backgroundColor: appColors.surfaceMuted },
  badgeUrgent: { backgroundColor: appColors.dangerSoft },
  badgeText: { ...appTypography.label, fontSize: 7 },
  badgeTextActive: { color: appColors.accent },
  badgeTextExpired: { color: appColors.textMuted },
  badgeTextUrgent: { color: appColors.danger },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: appSpacing.md },
  cardTitle: { color: appColors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 9 },
  cardBody: { ...appTypography.body, color: appColors.textSecondary, marginTop: 5 },
  cardMeta: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 10 },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: appSpacing.lg, backgroundColor: 'rgba(0,0,0,0.82)' },
  modalScroll: { width: '100%' },
  modalScrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '100%', maxWidth: 540, padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.borderStrong, borderRadius: appRadius.large },
  modalEyebrow: { ...appTypography.label, color: appColors.accent },
  modalTitle: { ...appTypography.screenTitle, color: appColors.textPrimary, marginTop: 2, marginBottom: appSpacing.md },
  titleInput: { minHeight: 42, paddingHorizontal: appSpacing.md, color: appColors.textPrimary, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.small },
  bodyInput: { minHeight: 105, marginTop: appSpacing.sm, padding: appSpacing.md, color: appColors.textPrimary, textAlignVertical: 'top', backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.small },
  toggleRow: { flexDirection: 'row', gap: appSpacing.sm, marginTop: appSpacing.sm },
  toggle: { minHeight: 38, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.small },
  toggleSelected: { backgroundColor: appColors.accentSoft, borderColor: appColors.accentBorder },
  toggleUrgent: { backgroundColor: appColors.dangerSoft, borderColor: appColors.dangerBorder },
  toggleText: { ...appTypography.label, color: appColors.textMuted },
  toggleTextSelected: { color: appColors.accent },
  toggleTextUrgent: { color: appColors.danger },
  expiryLabel: { ...appTypography.label, color: appColors.textMuted, fontSize: 8, marginTop: appSpacing.md, marginBottom: 6 },
  expiryOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  expiryOption: { minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.small },
  expiryOptionSelected: { backgroundColor: appColors.accentSoft, borderColor: appColors.accentBorder },
  expiryOptionText: { ...appTypography.metadata, color: appColors.textMuted },
  expiryOptionTextSelected: { color: appColors.accent },
  modalActions: { flexDirection: 'row', gap: appSpacing.sm, marginTop: appSpacing.lg },
  cancelButton: { minHeight: 40, flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.surfaceMuted, borderRadius: appRadius.small },
  cancelText: { ...appTypography.label, color: appColors.textSecondary },
  saveButton: { minHeight: 40, flex: 1.4, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.accentFill, borderRadius: appRadius.small },
  saveText: { ...appTypography.label, color: appColors.accentForeground },
});
