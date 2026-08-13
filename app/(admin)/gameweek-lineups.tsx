import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { appColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { supabase } from '@/utils/supabase';

interface SnapshotRow {
  id: string;
  user_id: string;
  gameweek: number;
  deadline_at: string;
  starting_player_ids: number[];
  bench_player_ids: number[];
  effective_starting_player_ids: number[];
  status: 'LOCKED' | 'PROCESSED' | 'CORRECTED';
  processed_at: string | null;
  correction_reason: string | null;
}

interface PlayerRow {
  id: number;
  web_name: string;
  element_type: string;
  team_short_name: string | null;
}

interface AuditRow {
  id: number;
  user_id: string;
  action_type: 'SWAP' | 'SKIPPED' | 'CORRECTION';
  subbed_out_player_id: number | null;
  subbed_in_player_id: number | null;
  explanation: string;
}

const POSITION_ORDER: Record<string, number> = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };
const POSITION_COLORS: Record<string, string> = {
  GKP: '#FFC857',
  DEF: '#45A3FF',
  MID: '#00F27A',
  FWD: '#FF5B87',
};

export default function GameweekLineupsScreen() {
  const safeArea = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ leagueId?: string }>();
  const { currentUserId, activeLeagueId } = useAppSession();
  const leagueId = params.leagueId || activeLeagueId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [leagueName, setLeagueName] = useState('League');
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [players, setPlayers] = useState<Map<number, PlayerRow>>(new Map());
  const [teamNames, setTeamNames] = useState<Map<string, string>>(new Map());
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [editing, setEditing] = useState<SnapshotRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState('');

  const loadLineups = useCallback(async () => {
    if (!leagueId || !currentUserId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('name, commissioner_id')
        .eq('id', leagueId)
        .maybeSingle();
      if (leagueError) throw leagueError;
      if (!league || league.commissioner_id !== currentUserId) {
        throw new Error('Only the league commissioner can review and correct deadline lineups.');
      }
      setLeagueName(league.name || 'League');

      const { data: latest } = await supabase
        .from('gameweek_lineup_snapshots')
        .select('gameweek')
        .eq('league_id', leagueId)
        .order('gameweek', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latest?.gameweek) {
        setSnapshots([]);
        setAudit([]);
        return;
      }

      const [snapshotResponse, memberResponse, auditResponse] = await Promise.all([
        supabase
          .from('gameweek_lineup_snapshots')
          .select('id, user_id, gameweek, deadline_at, starting_player_ids, bench_player_ids, effective_starting_player_ids, status, processed_at, correction_reason')
          .eq('league_id', leagueId)
          .eq('gameweek', latest.gameweek)
          .order('captured_at', { ascending: true }),
        supabase.from('league_members').select('user_id, team_name').eq('league_id', leagueId),
        supabase
          .from('gameweek_autosub_audit')
          .select('id, user_id, action_type, subbed_out_player_id, subbed_in_player_id, explanation')
          .eq('league_id', leagueId)
          .eq('gameweek', latest.gameweek)
          .order('created_at', { ascending: true }),
      ]);
      if (snapshotResponse.error) throw snapshotResponse.error;

      const nextSnapshots = (snapshotResponse.data || []) as SnapshotRow[];
      const playerIds = Array.from(new Set(nextSnapshots.flatMap(row => [
        ...row.starting_player_ids,
        ...row.bench_player_ids,
      ])));
      const { data: playerRows } = playerIds.length
        ? await supabase.from('players').select('id, web_name, element_type, team_short_name').in('id', playerIds)
        : { data: [] as PlayerRow[] };

      setSnapshots(nextSnapshots);
      setPlayers(new Map((playerRows || []).map(player => [Number(player.id), player as PlayerRow])));
      setTeamNames(new Map((memberResponse.data || []).map(member => [member.user_id, member.team_name])));
      setAudit((auditResponse.data || []) as AuditRow[]);
    } catch (error: any) {
      Alert.alert('Lineup review unavailable', error?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [currentUserId, leagueId]);

  useEffect(() => {
    void loadLineups();
  }, [loadLineups]);

  const editingSquad = useMemo(() => {
    if (!editing) return [];
    return [...editing.starting_player_ids, ...editing.bench_player_ids]
      .map(id => players.get(id))
      .filter(Boolean)
      .sort((a, b) => (POSITION_ORDER[a!.element_type] || 99) - (POSITION_ORDER[b!.element_type] || 99)) as PlayerRow[];
  }, [editing, players]);

  const selectedCounts = useMemo(() => {
    const counts: Record<string, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    selectedIds.forEach(id => {
      const position = players.get(id)?.element_type;
      if (position && counts[position] !== undefined) counts[position] += 1;
    });
    return counts;
  }, [players, selectedIds]);

  const openCorrection = (snapshot: SnapshotRow) => {
    setEditing(snapshot);
    setSelectedIds(new Set(snapshot.effective_starting_player_ids));
    setReason('');
  };

  const togglePlayer = (playerId: number) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(playerId)) next.delete(playerId);
      else if (next.size < 11) next.add(playerId);
      return next;
    });
  };

  const saveCorrection = async () => {
    if (!editing || !leagueId || saving) return;
    if (selectedIds.size !== 11) {
      Alert.alert('Select 11 players', 'A corrected gameweek lineup must contain exactly 11 players.');
      return;
    }
    if (!reason.trim()) {
      Alert.alert('Reason required', 'Record why this commissioner correction is necessary.');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('commissioner_correct_gameweek_lineup', {
        p_league_id: leagueId,
        p_user_id: editing.user_id,
        p_gameweek: editing.gameweek,
        p_effective_starting_player_ids: Array.from(selectedIds),
        p_reason: reason.trim(),
      });
      if (error) throw error;
      if (!data?.success) {
        const message = data?.error === 'INVALID_CORRECTED_LINEUP'
          ? 'The selected XI does not meet the formation rules.'
          : data?.error || 'The correction was rejected.';
        throw new Error(message);
      }
      setEditing(null);
      await loadLineups();
      Alert.alert('Correction recorded', 'The effective gameweek lineup and audit trail have been updated.');
    } catch (error: any) {
      Alert.alert('Correction failed', error?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={appColors.accent} /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={20} color={appColors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>COMMISSIONER · {leagueName.toUpperCase()}</Text>
            <Text style={styles.title}>Gameweek lineups</Text>
            <Text style={styles.subtitle}>Review deadline snapshots, autosubs and recorded corrections.</Text>
          </View>
        </View>

        {snapshots.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="time-outline" size={24} color={appColors.textMuted} />
            <Text style={styles.emptyTitle}>NO DEADLINE SNAPSHOTS YET</Text>
            <Text style={styles.emptyText}>Lineups will appear here automatically when the first gameweek deadline passes.</Text>
          </View>
        ) : snapshots.map(snapshot => {
          const events = audit.filter(item => item.user_id === snapshot.user_id);
          return (
            <View key={snapshot.id} style={styles.managerCard}>
              <View style={styles.managerHeader}>
                <View>
                  <Text style={styles.managerName}>{teamNames.get(snapshot.user_id) || 'Manager'}</Text>
                  <Text style={styles.managerMeta}>GW{snapshot.gameweek} · {snapshot.status} · {events.length} audit {events.length === 1 ? 'entry' : 'entries'}</Text>
                </View>
                <TouchableOpacity style={styles.correctButton} onPress={() => openCorrection(snapshot)}>
                  <Ionicons name="construct-outline" size={14} color={appColors.backgroundDeep} />
                  <Text style={styles.correctButtonText}>CORRECT</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.playerChips}>
                {snapshot.effective_starting_player_ids.map(id => {
                  const player = players.get(id);
                  if (!player) return null;
                  return (
                    <View key={id} style={styles.playerChip}>
                      <View style={[styles.positionDot, { backgroundColor: POSITION_COLORS[player.element_type] || appColors.textMuted }]} />
                      <Text style={styles.playerChipText}>{player.web_name}</Text>
                    </View>
                  );
                })}
              </View>

              {events.map(event => (
                <View key={event.id} style={styles.auditRow}>
                  <Ionicons
                    name={event.action_type === 'SWAP' ? 'swap-horizontal' : event.action_type === 'CORRECTION' ? 'construct-outline' : 'alert-circle-outline'}
                    size={14}
                    color={event.action_type === 'SWAP' ? appColors.accent : event.action_type === 'CORRECTION' ? appColors.info : appColors.warning}
                  />
                  <Text style={styles.auditText}>{event.explanation}</Text>
                </View>
              ))}
              {snapshot.correction_reason && <Text style={styles.correctionReason}>Latest correction: {snapshot.correction_reason}</Text>}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={Boolean(editing)} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setEditing(null)}>
        <View style={[styles.modalOverlay, { paddingTop: Math.max(safeArea.top, 12), paddingBottom: Math.max(safeArea.bottom, 12) }]}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>CONTROLLED CORRECTION</Text>
            <Text style={styles.modalTitle}>{editing ? teamNames.get(editing.user_id) || 'Manager' : ''} · GW{editing?.gameweek}</Text>
            <Text style={styles.modalHint}>Choose the 11 players whose points should count. Formation rules are enforced by the server.</Text>

            <View style={styles.countRow}>
              {Object.entries(selectedCounts).map(([position, count]) => (
                <Text key={position} style={[styles.countText, { color: POSITION_COLORS[position] }]}>{position} {count}</Text>
              ))}
              <Text style={styles.totalCount}>{selectedIds.size}/11</Text>
            </View>

            <ScrollView style={styles.playerSelector} contentContainerStyle={styles.playerSelectorContent}>
              {editingSquad.map(player => {
                const selected = selectedIds.has(player.id);
                return (
                  <TouchableOpacity
                    key={player.id}
                    style={[styles.selectorRow, selected && styles.selectorRowSelected]}
                    onPress={() => togglePlayer(player.id)}
                  >
                    <View style={[styles.positionDot, { backgroundColor: POSITION_COLORS[player.element_type] || appColors.textMuted }]} />
                    <Text style={styles.selectorName}>{player.web_name}</Text>
                    <Text style={styles.selectorMeta}>{player.team_short_name || ''} · {player.element_type}</Text>
                    <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={selected ? appColors.accent : appColors.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TextInput
              style={styles.reasonInput}
              value={reason}
              onChangeText={setReason}
              placeholder="Required correction reason"
              placeholderTextColor={appColors.textMuted}
              maxLength={240}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setEditing(null)} disabled={saving}>
                <Text style={styles.cancelButtonText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={() => void saveCorrection()} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color={appColors.backgroundDeep} /> : <Ionicons name="checkmark" size={16} color={appColors.backgroundDeep} />}
                <Text style={styles.saveButtonText}>SAVE CORRECTION</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: appColors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.background },
  page: { width: '100%', maxWidth: 980, alignSelf: 'center', padding: appSpacing.md, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  backButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.surface, borderRadius: 17 },
  headerCopy: { flex: 1 },
  eyebrow: { ...appTypography.label, color: appColors.accent, fontSize: 8 },
  title: { ...appTypography.screenTitle, color: appColors.textPrimary, marginTop: 3 },
  subtitle: { ...appTypography.metadata, color: appColors.textSecondary, marginTop: 4 },
  emptyCard: { alignItems: 'center', marginTop: appSpacing.md, padding: 30, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  emptyTitle: { ...appTypography.label, color: appColors.textPrimary, marginTop: 10 },
  emptyText: { ...appTypography.metadata, color: appColors.textMuted, textAlign: 'center', marginTop: 5 },
  managerCard: { marginTop: appSpacing.md, padding: appSpacing.md, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  managerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  managerName: { color: appColors.textPrimary, fontSize: 13, fontWeight: '900' },
  managerMeta: { color: appColors.textMuted, fontSize: 8, fontWeight: '700', marginTop: 3 },
  correctButton: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, backgroundColor: appColors.accent, borderRadius: appRadius.medium },
  correctButtonText: { color: appColors.backgroundDeep, fontSize: 8, fontWeight: '900' },
  playerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 10 },
  playerChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 7, backgroundColor: appColors.surfaceMuted, borderRadius: appRadius.pill },
  positionDot: { width: 6, height: 6, borderRadius: 3 },
  playerChipText: { color: appColors.textSecondary, fontSize: 8, fontWeight: '800' },
  auditRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: appColors.borderSubtle },
  auditText: { flex: 1, color: appColors.textSecondary, fontSize: 8, fontWeight: '700', lineHeight: 13 },
  correctionReason: { color: appColors.info, fontSize: 8, fontWeight: '800', marginTop: 8 },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12, backgroundColor: 'rgba(0,0,0,0.84)' },
  modalCard: { width: '100%', maxWidth: 620, maxHeight: '92%', padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  modalEyebrow: { ...appTypography.label, color: appColors.warning, fontSize: 8 },
  modalTitle: { color: appColors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 4 },
  modalHint: { color: appColors.textSecondary, fontSize: 9, fontWeight: '700', lineHeight: 14, marginTop: 5 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 10, padding: 8, backgroundColor: appColors.backgroundDeep, borderRadius: appRadius.medium },
  countText: { fontSize: 8, fontWeight: '900' },
  totalCount: { marginLeft: 'auto', color: appColors.textPrimary, fontSize: 9, fontWeight: '900' },
  playerSelector: { maxHeight: 330, marginTop: 8 },
  playerSelectorContent: { gap: 5 },
  selectorRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  selectorRowSelected: { backgroundColor: appColors.accentSoft, borderColor: appColors.accentBorder },
  selectorName: { flex: 1, color: appColors.textPrimary, fontSize: 9, fontWeight: '900' },
  selectorMeta: { color: appColors.textMuted, fontSize: 8, fontWeight: '700' },
  reasonInput: { minHeight: 58, maxHeight: 80, marginTop: 9, padding: 10, color: appColors.textPrimary, fontSize: 10, textAlignVertical: 'top', backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 7, marginTop: 9 },
  cancelButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  cancelButtonText: { color: appColors.textSecondary, fontSize: 8, fontWeight: '900' },
  saveButton: { flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 13, backgroundColor: appColors.accent, borderRadius: appRadius.medium },
  saveButtonText: { color: appColors.backgroundDeep, fontSize: 8, fontWeight: '900' },
});
