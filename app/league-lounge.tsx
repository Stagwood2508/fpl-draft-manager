import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppColors, appRadius, appSpacing } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { LOUNGE_POLICY_VERSION } from '@/features/lounge/constants';
import { supabase } from '@/utils/supabase';

type LoungeMessage = {
  id: string;
  league_id: string;
  author_id: string;
  body: string;
  is_pinned: boolean;
  pinned_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

type LoungeReaction = {
  message_id: string;
  user_id: string;
  emoji: '👍' | '😂' | '⚽';
};

type ManagerIdentity = { managerName: string; teamName: string; initials: string };
const REACTIONS: LoungeReaction['emoji'][] = ['👍', '😂', '⚽'];
const URL_PATTERN = /https?:\/\/[^\s]+/i;

const initialsFor = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part[0]?.toUpperCase())
  .join('') || 'M';

const messageTime = (value: string) => new Date(value).toLocaleTimeString([], {
  hour: '2-digit', minute: '2-digit',
});

const messageDay = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'TODAY';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' }).toUpperCase();
};

export default function LeagueLoungeScreen() {
  const router = useRouter();
  const safeArea = useSafeAreaInsets();
  const listRef = useRef<FlatList<LoungeMessage>>(null);
  const inputRef = useRef<TextInput>(null);
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { currentUserId, activeLeagueId } = useAppSession();
  const [messages, setMessages] = useState<LoungeMessage[]>([]);
  const [reactions, setReactions] = useState<LoungeReaction[]>([]);
  const [identities, setIdentities] = useState<Record<string, ManagerIdentity>>({});
  const [leagueName, setLeagueName] = useState('League Lounge');
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [unreadSince, setUnreadSince] = useState<string | null>(null);
  const [composer, setComposer] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [acceptingPolicy, setAcceptingPolicy] = useState(false);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [reportedMessageIds, setReportedMessageIds] = useState<string[]>([]);

  const markRead = useCallback(async () => {
    if (!activeLeagueId || !currentUserId) return;
    await supabase.from('league_lounge_reads').upsert({
      league_id: activeLeagueId,
      user_id: currentUserId,
      last_read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'league_id,user_id' });
  }, [activeLeagueId, currentUserId]);

  const loadReactions = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) {
      setReactions([]);
      return;
    }
    const { data } = await supabase
      .from('league_lounge_reactions')
      .select('message_id, user_id, emoji')
      .in('message_id', messageIds);
    setReactions((data || []) as LoungeReaction[]);
  }, []);

  const loadLounge = useCallback(async (showLoader = false) => {
    if (!activeLeagueId || !currentUserId) {
      setLoading(false);
      return;
    }
    if (showLoader) setLoading(true);
    setErrorMessage(null);
    try {
      const [messageResult, memberResult, leagueResult, readResult, policyResult, blockResult, reportResult] = await Promise.all([
        supabase.from('league_lounge_messages')
          .select('id, league_id, author_id, body, is_pinned, pinned_at, deleted_at, created_at')
          .eq('league_id', activeLeagueId)
          .order('created_at', { ascending: true })
          .limit(150),
        supabase.from('league_members').select('user_id, team_name').eq('league_id', activeLeagueId),
        supabase.from('leagues').select('name, commissioner_id').eq('id', activeLeagueId).single(),
        supabase.from('league_lounge_reads').select('last_read_at')
          .eq('league_id', activeLeagueId).eq('user_id', currentUserId).maybeSingle(),
        supabase.from('league_lounge_policy_acceptances').select('policy_version')
          .eq('user_id', currentUserId).maybeSingle(),
        supabase.from('league_lounge_blocks').select('blocked_user_id').eq('blocker_id', currentUserId),
        supabase.from('league_lounge_reports').select('message_id').eq('league_id', activeLeagueId).eq('status', 'OPEN'),
      ]);
      if (messageResult.error) throw messageResult.error;
      if (memberResult.error) throw memberResult.error;
      if (leagueResult.error) throw leagueResult.error;

      const nextMessages = (messageResult.data || []) as LoungeMessage[];
      const members = memberResult.data || [];
      const userIds = members.map(member => member.user_id).filter(Boolean);
      const profileResult = userIds.length
        ? await supabase.from('profiles').select('id, display_name, first_name, last_name').in('id', userIds)
        : { data: [], error: null };
      const profiles = profileResult.data || [];
      const nextIdentities: Record<string, ManagerIdentity> = {};
      members.forEach(member => {
        const profile = profiles.find(item => item.id === member.user_id);
        const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
        const managerName = profile?.display_name?.trim() || fullName || member.team_name || 'Manager';
        nextIdentities[member.user_id] = {
          managerName,
          teamName: member.team_name || 'League manager',
          initials: initialsFor(managerName),
        };
      });

      setMessages(nextMessages);
      setIdentities(nextIdentities);
      setLeagueName(leagueResult.data?.name || 'League Lounge');
      setIsCommissioner(leagueResult.data?.commissioner_id === currentUserId);
      setPolicyAccepted(policyResult.data?.policy_version === LOUNGE_POLICY_VERSION);
      setBlockedUserIds((blockResult.data || []).map(item => item.blocked_user_id));
      setReportedMessageIds((reportResult.data || []).map(item => item.message_id));
      if (showLoader) setUnreadSince(readResult.data?.last_read_at || null);
      await Promise.all([loadReactions(nextMessages.map(message => message.id)), markRead()]);
    } catch (error: any) {
      console.error('[LEAGUE LOUNGE] Load failed:', error);
      setErrorMessage(error?.message || 'The Lounge could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [activeLeagueId, currentUserId, loadReactions, markRead]);

  useEffect(() => { void loadLounge(true); }, [loadLounge]);

  useEffect(() => {
    if (!activeLeagueId) return;
    const channel = supabase.channel(`league-lounge-${activeLeagueId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'league_lounge_messages', filter: `league_id=eq.${activeLeagueId}`,
      }, () => void loadLounge())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'league_lounge_reactions',
      }, () => void loadLounge())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [activeLeagueId, loadLounge]);

  const pinnedMessage = [...messages]
    .filter(message => message.is_pinned && !message.deleted_at)
    .sort((a, b) => String(b.pinned_at).localeCompare(String(a.pinned_at)))[0] || null;

  const sendMessage = async () => {
    const body = composer.trim();
    if (!body || !activeLeagueId || !currentUserId || sending || !policyAccepted) return;
    if (body.length > 1000) {
      Alert.alert('Message too long', 'Lounge messages can contain up to 1,000 characters.');
      return;
    }
    setSending(true);
    const { error } = await supabase.from('league_lounge_messages').insert({
      league_id: activeLeagueId, author_id: currentUserId, body,
    });
    setSending(false);
    if (error) {
      Alert.alert('Message not sent', error.message);
      return;
    }
    setComposer('');
    await loadLounge();
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const acceptPolicy = async () => {
    if (!currentUserId || acceptingPolicy) return;
    setAcceptingPolicy(true);
    const { error } = await supabase.from('league_lounge_policy_acceptances').upsert({
      user_id: currentUserId,
      policy_version: LOUNGE_POLICY_VERSION,
      accepted_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    setAcceptingPolicy(false);
    if (error) Alert.alert('Guidelines not accepted', error.message);
    else setPolicyAccepted(true);
  };

  const toggleReaction = async (messageId: string, emoji: LoungeReaction['emoji']) => {
    if (!currentUserId) return;
    const existing = reactions.some(item => item.message_id === messageId && item.user_id === currentUserId && item.emoji === emoji);
    const result = existing
      ? await supabase.from('league_lounge_reactions').delete().eq('message_id', messageId).eq('user_id', currentUserId).eq('emoji', emoji)
      : await supabase.from('league_lounge_reactions').insert({ message_id: messageId, user_id: currentUserId, emoji });
    if (result.error) Alert.alert('Reaction not saved', result.error.message);
    else await loadReactions(messages.map(message => message.id));
  };

  const removeMessage = async (messageId: string) => {
    const { data, error } = await supabase.rpc('remove_lounge_message', { p_message_id: messageId });
    if (error || !data?.success) Alert.alert('Message not removed', error?.message || data?.error || 'Please try again.');
  };

  const togglePinned = async (message: LoungeMessage) => {
    const { data, error } = await supabase.rpc('set_lounge_message_pinned', {
      p_message_id: message.id, p_pinned: !message.is_pinned,
    });
    if (error || !data?.success) Alert.alert('Pinned message not changed', error?.message || data?.error || 'Please try again.');
  };

  const reportMessage = async (message: LoungeMessage, reason: string) => {
    if (!activeLeagueId || !currentUserId) return;
    const { error } = await supabase.from('league_lounge_reports').insert({
      message_id: message.id, league_id: activeLeagueId, reporter_id: currentUserId, reason,
    });
    if (error?.code === '23505') Alert.alert('Already reported', 'You have already reported this message.');
    else Alert.alert(error ? 'Report not sent' : 'Message reported', error?.message || 'The league commissioner has been notified.');
  };

  const blockManager = (message: LoungeMessage) => {
    if (!currentUserId) return;
    const identity = identities[message.author_id];
    Alert.alert(`Block ${identity?.managerName || 'this manager'}?`, 'Their Lounge messages will be hidden for you.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('league_lounge_blocks').insert({
          blocker_id: currentUserId, blocked_user_id: message.author_id,
        });
        if (error) Alert.alert('Manager not blocked', error.message);
        else await loadLounge();
      } },
    ]);
  };

  const unblockManager = async (userId: string) => {
    if (!currentUserId) return;
    const { error } = await supabase.from('league_lounge_blocks').delete()
      .eq('blocker_id', currentUserId).eq('blocked_user_id', userId);
    if (error) Alert.alert('Manager not unblocked', error.message);
    else await loadLounge();
  };

  const openBlockedManagers = () => {
    if (blockedUserIds.length === 0) {
      Alert.alert('Blocked managers', 'You have not blocked anyone in this Lounge.');
      return;
    }
    Alert.alert('Blocked managers', 'Choose a manager to show their messages again.', blockedUserIds.map(userId => ({
      text: identities[userId]?.managerName || 'League manager',
      onPress: () => void unblockManager(userId),
    })).concat([{ text: 'Cancel', style: 'cancel' }] as any));
  };

  const openLoungeInformation = () => Alert.alert(
    'League Lounge',
    'Chat is visible only to current members of this league. Use message options to report, block, pin or remove content.',
    [
      { text: 'Community guidelines', onPress: () => router.push('/community-guidelines') },
      { text: blockedUserIds.length ? `Blocked managers (${blockedUserIds.length})` : 'Blocked managers', onPress: openBlockedManagers },
      { text: 'Close', style: 'cancel' },
    ],
  );

  const dismissReports = async (messageId: string) => {
    const { data, error } = await supabase.rpc('resolve_lounge_message_reports', {
      p_message_id: messageId, p_status: 'DISMISSED',
    });
    if (error || !data?.success) Alert.alert('Report not resolved', error?.message || data?.error || 'Please try again.');
    else await loadLounge();
  };

  const openMessageActions = (message: LoungeMessage) => {
    if (message.deleted_at) return;
    const mine = message.author_id === currentUserId;
    const buttons: any[] = [];
    if (isCommissioner) buttons.push({ text: message.is_pinned ? 'Unpin message' : 'Pin message', onPress: () => void togglePinned(message) });
    if (isCommissioner && reportedMessageIds.includes(message.id)) buttons.push({ text: 'Dismiss report', onPress: () => void dismissReports(message.id) });
    if (mine || isCommissioner) buttons.push({
      text: 'Remove message', style: 'destructive', onPress: () => Alert.alert('Remove this message?', 'It will remain marked as removed in the conversation.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void removeMessage(message.id) },
      ]),
    });
    if (!mine) {
      buttons.push({ text: 'Report message', onPress: () => Alert.alert('Why are you reporting this?', '', [
        { text: 'Abusive', onPress: () => void reportMessage(message, 'Abusive or harassing content') },
        { text: 'Spam', onPress: () => void reportMessage(message, 'Spam or unwanted content') },
        { text: 'Cancel', style: 'cancel' },
      ]) });
      buttons.push({ text: 'Report manager', onPress: () => void reportMessage(message, 'Manager conduct report') });
      buttons.push({ text: 'Block manager', style: 'destructive', onPress: () => blockManager(message) });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Message options', '', buttons);
  };

  const renderLinkPreview = (body: string) => {
    const url = body.match(URL_PATTERN)?.[0];
    if (!url) return null;
    let host = 'Shared link';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    const podcast = /spotify|podbean|buzzsprout|apple|soundcloud|youtube|podcast/i.test(url);
    return (
      <TouchableOpacity style={styles.linkPreview} onPress={() => void Linking.openURL(url)}>
        <View style={styles.linkPreviewIcon}><Ionicons name={podcast ? 'mic' : 'link'} size={17} color={colors.accent} /></View>
        <View style={styles.linkPreviewCopy}>
          <Text style={styles.linkPreviewTitle}>{podcast ? 'League podcast' : 'Open shared link'}</Text>
          <Text style={styles.linkPreviewHost} numberOfLines={1}>{host}</Text>
        </View>
        <Ionicons name={podcast ? 'play-circle-outline' : 'open-outline'} size={19} color={colors.textSecondary} />
      </TouchableOpacity>
    );
  };

  const renderMessage = ({ item, index }: { item: LoungeMessage; index: number }) => {
    const identity = identities[item.author_id] || { managerName: 'Manager', teamName: 'League manager', initials: 'M' };
    const previous = messages[index - 1];
    const showDay = !previous || messageDay(previous.created_at) !== messageDay(item.created_at);
    const showUnread = Boolean(unreadSince && item.created_at > unreadSince && (!previous || previous.created_at <= unreadSince));
    const grouped = REACTIONS.map(emoji => ({
      emoji,
      rows: reactions.filter(reaction => reaction.message_id === item.id && reaction.emoji === emoji),
    })).filter(group => group.rows.length > 0);
    return (
      <View>
        {showDay ? <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>{messageDay(item.created_at)}</Text><View style={styles.dividerLine} /></View> : null}
        {showUnread ? <View style={styles.unreadDivider}><View style={styles.unreadLine} /><Text style={styles.unreadText}>NEW MESSAGES</Text><View style={styles.unreadLine} /></View> : null}
        <View style={styles.messageRow}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{identity.initials}</Text></View>
          <View style={styles.messageContent}>
            <View style={styles.messageHeading}>
              <Text style={styles.managerName} numberOfLines={1}>{identity.managerName}</Text>
              <Text style={styles.teamName} numberOfLines={1}>{identity.teamName}</Text>
              <Text style={styles.messageTime}>{messageTime(item.created_at)}</Text>
              {isCommissioner && reportedMessageIds.includes(item.id) ? <Ionicons name="warning" size={14} color={colors.warning} /> : null}
              {!item.deleted_at ? <TouchableOpacity onPress={() => openMessageActions(item)} hitSlop={8}><Ionicons name="ellipsis-horizontal" size={16} color={colors.textMuted} /></TouchableOpacity> : null}
            </View>
            <View style={[styles.messageBubble, item.deleted_at && styles.removedBubble]}>
              <Text style={[styles.messageBody, item.deleted_at && styles.removedText]}>{item.deleted_at ? 'Message removed' : item.body}</Text>
              {!item.deleted_at ? renderLinkPreview(item.body) : null}
            </View>
            {!item.deleted_at ? (
              <View style={styles.reactionRow}>
                {grouped.map(group => (
                  <TouchableOpacity key={group.emoji} style={[styles.reactionChip, group.rows.some(row => row.user_id === currentUserId) && styles.reactionChipMine]} onPress={() => void toggleReaction(item.id, group.emoji)}>
                    <Text style={styles.reactionText}>{group.emoji} {group.rows.length}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.addReaction} onPress={() => Alert.alert('React to message', '', REACTIONS.map(emoji => ({ text: emoji, onPress: () => void toggleReaction(item.id, emoji) })).concat([{ text: 'Cancel', style: 'cancel' }] as any))}>
                  <Ionicons name="happy-outline" size={14} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  if (!activeLeagueId) return <View style={styles.centered}><Text style={styles.emptyTitle}>Select a league to open its Lounge.</Text></View>;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: Math.max(safeArea.top, appSpacing.md) }]}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color={colors.textPrimary} /></TouchableOpacity>
        <View style={styles.headerCopy}><Text style={styles.headerTitle}>LEAGUE LOUNGE</Text><Text style={styles.headerSubtitle} numberOfLines={1}>{leagueName}</Text></View>
        <TouchableOpacity style={styles.headerButton} onPress={openLoungeInformation}><Ionicons name="information-circle-outline" size={22} color={colors.textSecondary} /></TouchableOpacity>
      </View>

      <View style={styles.content}>
        {pinnedMessage ? (
          <TouchableOpacity style={styles.pinnedCard} onPress={() => openMessageActions(pinnedMessage)}>
            <View style={styles.pinnedIcon}><Ionicons name="pin" size={16} color={colors.accent} /></View>
            <View style={styles.pinnedCopy}><Text style={styles.pinnedEyebrow}>PINNED BY COMMISSIONER</Text><Text style={styles.pinnedText} numberOfLines={2}>{pinnedMessage.body}</Text></View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}

        {errorMessage ? <TouchableOpacity style={styles.errorBanner} onPress={() => void loadLounge(true)}><Ionicons name="cloud-offline-outline" size={17} color={colors.danger} /><Text style={styles.errorText}>{errorMessage} Tap to retry.</Text></TouchableOpacity> : null}

        {loading ? <View style={styles.centered}><ActivityIndicator color={colors.accent} /><Text style={styles.loadingText}>Opening the Lounge…</Text></View> : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderMessage}
            contentContainerStyle={[styles.messageList, messages.length === 0 && styles.emptyList]}
            ListEmptyComponent={<View style={styles.emptyState}><Ionicons name="chatbubbles-outline" size={30} color={colors.textDisabled} /><Text style={styles.emptyTitle}>Start the conversation</Text><Text style={styles.emptyBody}>Share league chat, predictions and podcast links here.</Text></View>}
            onContentSizeChange={() => { if (messages.length > 0) listRef.current?.scrollToEnd({ animated: false }); }}
          />
        )}
      </View>

      <View style={[styles.composerBar, { paddingBottom: Math.max(safeArea.bottom, appSpacing.md) }]}>
        <TouchableOpacity style={styles.linkButton} disabled={!policyAccepted} onPress={() => { setComposer(value => value || 'https://'); inputRef.current?.focus(); }}><Ionicons name="link-outline" size={19} color={policyAccepted ? colors.accent : colors.textDisabled} /></TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={styles.composerInput}
          value={composer}
          onChangeText={setComposer}
          placeholder={policyAccepted ? 'Message your league…' : 'Accept the community guidelines to post'}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={1000}
          editable={policyAccepted}
        />
        <TouchableOpacity style={[styles.sendButton, (!composer.trim() || sending || !policyAccepted) && styles.sendButtonDisabled]} disabled={!composer.trim() || sending || !policyAccepted} onPress={() => void sendMessage()}>
          {sending ? <ActivityIndicator size="small" color={colors.accentForeground} /> : <Ionicons name="send" size={17} color={colors.accentForeground} />}
        </TouchableOpacity>
      </View>

      <Modal visible={!loading && !policyAccepted} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => router.back()}>
        <View style={styles.policyOverlay}>
          <View style={styles.policyCard}>
            <View style={styles.policyIcon}><Ionicons name="people-circle-outline" size={27} color={colors.accent} /></View>
            <Text style={styles.policyEyebrow}>BEFORE YOU POST</Text>
            <Text style={styles.policyTitle}>League Lounge guidelines</Text>
            <ScrollView style={styles.policyScroll} contentContainerStyle={styles.policyRules}>
              <Text style={styles.policyBody}>Keep league chat competitive but respectful. The following are not allowed:</Text>
              <Text style={styles.policyRule}>• Harassment, threats, hate speech or targeted abuse</Text>
              <Text style={styles.policyRule}>• Sexual, violent, illegal or exploitative content</Text>
              <Text style={styles.policyRule}>• Private information, impersonation, spam or malicious links</Text>
              <Text style={styles.policyBody}>Messages and linked content can be reported, blocked or removed. Repeated misuse may result in Lounge or account access being restricted.</Text>
            </ScrollView>
            <TouchableOpacity style={styles.policyAcceptButton} disabled={acceptingPolicy} onPress={() => void acceptPolicy()}>
              {acceptingPolicy ? <ActivityIndicator color={colors.accentForeground} /> : <Text style={styles.policyAcceptText}>I AGREE — ENTER THE LOUNGE</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.policyLeaveButton} onPress={() => router.back()}><Text style={styles.policyLeaveText}>NOT NOW</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 76, paddingHorizontal: appSpacing.md, paddingBottom: appSpacing.md, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, backgroundColor: colors.backgroundDeep },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.medium },
  headerCopy: { flex: 1, minWidth: 0, alignItems: 'center' },
  headerTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  headerSubtitle: { color: colors.textMuted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  content: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: appSpacing.md },
  pinnedCard: { marginTop: appSpacing.md, padding: appSpacing.md, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: appRadius.large, borderWidth: 1, borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
  pinnedIcon: { width: 34, height: 34, borderRadius: appRadius.medium, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  pinnedCopy: { flex: 1, minWidth: 0 },
  pinnedEyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  pinnedText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800', marginTop: 2 },
  messageList: { paddingVertical: appSpacing.md },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.borderSubtle },
  dividerText: { color: colors.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  unreadDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 12 },
  unreadLine: { flex: 1, height: 1, backgroundColor: colors.accent },
  unreadText: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 12 },
  avatar: { width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder },
  avatarText: { color: colors.accent, fontSize: 10, fontWeight: '900' },
  messageContent: { flex: 1, minWidth: 0 },
  messageHeading: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  managerName: { color: colors.textPrimary, fontSize: 12, fontWeight: '900', maxWidth: '40%' },
  teamName: { color: colors.textMuted, fontSize: 9, fontWeight: '700', flex: 1 },
  messageTime: { color: colors.textMuted, fontSize: 9, fontWeight: '700' },
  messageBubble: { alignSelf: 'flex-start', maxWidth: '96%', padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.large, borderTopLeftRadius: 4, backgroundColor: colors.surface },
  removedBubble: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderSubtle },
  messageBody: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  removedText: { color: colors.textMuted, fontStyle: 'italic' },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 5, marginLeft: 5 },
  reactionChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: appRadius.pill, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.borderSubtle },
  reactionChipMine: { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft },
  reactionText: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  addReaction: { width: 27, height: 25, alignItems: 'center', justifyContent: 'center' },
  linkPreview: { minWidth: 220, marginTop: 8, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: appRadius.medium, backgroundColor: colors.surfaceMuted },
  linkPreviewIcon: { width: 34, height: 34, borderRadius: appRadius.medium, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  linkPreviewCopy: { flex: 1, minWidth: 0 },
  linkPreviewTitle: { color: colors.textPrimary, fontSize: 11, fontWeight: '900' },
  linkPreviewHost: { color: colors.textMuted, fontSize: 9, fontWeight: '700', marginTop: 2 },
  errorBanner: { marginTop: appSpacing.md, padding: appSpacing.md, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: appRadius.medium, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerBorder },
  errorText: { flex: 1, color: colors.danger, fontSize: 11, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: appSpacing.xl },
  loadingText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  emptyState: { alignItems: 'center', justifyContent: 'center', gap: 7, padding: appSpacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '900' },
  emptyBody: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  composerBar: { width: '100%', maxWidth: 784, alignSelf: 'center', paddingTop: 10, paddingHorizontal: appSpacing.md, flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderTopWidth: 1, borderTopColor: colors.borderSubtle, backgroundColor: colors.backgroundDeep },
  linkButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.medium, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentBorder },
  composerInput: { flex: 1, minHeight: 40, maxHeight: 92, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 8, color: colors.textPrimary, fontSize: 13, fontWeight: '600', borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium, backgroundColor: colors.surface },
  sendButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.medium, backgroundColor: colors.accentFill },
  sendButtonDisabled: { opacity: 0.4 },
  policyOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: appSpacing.lg, backgroundColor: 'rgba(0,0,0,0.78)' },
  policyCard: { width: '100%', maxWidth: 480, maxHeight: '86%', padding: appSpacing.lg, borderRadius: appRadius.large, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.backgroundElevated },
  policyIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', borderRadius: 24, backgroundColor: colors.accentSoft },
  policyEyebrow: { marginTop: 12, color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.8, textAlign: 'center' },
  policyTitle: { marginTop: 4, color: colors.textPrimary, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  policyScroll: { flexGrow: 0, marginTop: appSpacing.md },
  policyRules: { gap: 9 },
  policyBody: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  policyRule: { color: colors.textPrimary, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  policyAcceptButton: { minHeight: 44, marginTop: 14, alignItems: 'center', justifyContent: 'center', borderRadius: appRadius.medium, backgroundColor: colors.accentFill },
  policyAcceptText: { color: colors.accentForeground, fontSize: 11, fontWeight: '900' },
  policyLeaveButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  policyLeaveText: { color: colors.textMuted, fontSize: 10, fontWeight: '900' },
});
