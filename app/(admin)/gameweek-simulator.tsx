import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors, appRadius, appSpacing, appTypography } from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

type RunPhase = 'PRE_DEADLINE' | 'WAIVERS_PROCESSED' | 'LOCKED' | 'LIVE' | 'FINISHED' | 'AUTOSUBS' | 'WAIVERS_OPEN';

interface SimulationRun {
  id: string;
  league_id: string;
  gameweek: number;
  phase: RunPhase;
  started_at: string;
  expires_at: string;
}

interface StatusPayload {
  enabled: boolean;
  is_commissioner: boolean;
  active_run: SimulationRun | null;
  live_sync_paused: boolean;
  available_gameweeks: Array<{
    gameweek: number;
    deadline: string;
    is_current: boolean;
    is_finished: boolean;
  }>;
  error?: string;
}

interface SimulationPlayer {
  player_id: number;
  player_name: string;
  club_name: string;
  position: string;
  manager_id: string;
  manager_name: string;
  is_starting: boolean;
  minutes: number;
  total_points: number;
  defensive_contribution: number;
}

interface IntegrityCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

interface WaiverResult {
  claim_id: string;
  manager_id: string;
  manager_name: string;
  priority_order: number;
  status: string;
  failure_reason: string | null;
  player_in_id: number;
  player_in_name: string;
  player_out_id: number;
  player_out_name: string;
  processed_at: string | null;
}

const PHASE_ACTIONS: Partial<Record<RunPhase, { action: string; label: string; icon: keyof typeof Ionicons.glyphMap }>> = {
  PRE_DEADLINE: { action: 'PROCESS_WAIVERS', label: 'Process waivers', icon: 'swap-vertical' },
  WAIVERS_PROCESSED: { action: 'LOCK_LINEUPS', label: 'Lock lineups', icon: 'lock-closed' },
  LOCKED: { action: 'START_LIVE', label: 'Start live scoring', icon: 'play' },
  LIVE: { action: 'FINISH_GAMEWEEK', label: 'Finish Gameweek', icon: 'flag' },
  FINISHED: { action: 'PROCESS_AUTOSUBS', label: 'Process autosubs', icon: 'swap-horizontal' },
  AUTOSUBS: { action: 'OPEN_NEXT_WAIVER', label: 'Open next waiver window', icon: 'timer' },
};

const PRESETS = [
  ['DID_NOT_PLAY', 'DNP'],
  ['APPEARANCE', '90 mins'],
  ['GOAL', 'Goal'],
  ['ASSIST', 'Assist'],
  ['CLEAN_SHEET', 'Clean sheet'],
  ['YELLOW_CARD', 'Yellow'],
  ['RED_CARD', 'Red'],
  ['THREE_SAVES', '3 saves'],
] as const;

const CUSTOM_FIELDS = [
  ['minutes', 'Minutes'], ['total_points', 'FPL points'], ['goals_scored', 'Goals'],
  ['assists', 'Assists'], ['clean_sheets', 'Clean sheets'], ['goals_conceded', 'Conceded'],
  ['saves', 'Saves'], ['penalties_saved', 'Pens saved'], ['penalties_missed', 'Pens missed'],
  ['yellow_cards', 'Yellow'], ['red_cards', 'Red'], ['own_goals', 'Own goals'],
  ['bonus', 'Bonus'], ['bps', 'BPS'], ['clearances_blocks_interceptions', 'CBI'],
  ['recoveries', 'Recoveries'], ['tackles', 'Tackles'], ['defensive_contribution', 'DEFCON'],
] as const;

function resultError(data: any, fallback: string) {
  return data?.error ? String(data.error).replaceAll('_', ' ') : fallback;
}

function showMessage(title: string, message: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function confirmAction(
  title: string,
  message: string,
  confirmText: string,
  action: () => void,
  destructive = false,
) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (window.confirm(`${title}\n\n${message}`)) action();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: action },
  ]);
}

export default function GameweekSimulatorScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { activeLeagueId } = useAppSession();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [selectedGameweek, setSelectedGameweek] = useState<number | null>(null);
  const [players, setPlayers] = useState<SimulationPlayer[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<SimulationPlayer | null>(null);
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<IntegrityCheck[]>([]);
  const [waiverResults, setWaiverResults] = useState<WaiverResult[]>([]);

  const run = status?.active_run ?? null;

  const loadPlayers = useCallback(async (runId: string) => {
    const { data, error } = await supabase.rpc('get_gameweek_simulation_players', { p_run_id: runId });
    if (error) throw error;
    const rows = (data ?? []) as SimulationPlayer[];
    setPlayers(rows);
    setSelectedPlayer((current) => current ? rows.find((row) => row.player_id === current.player_id) ?? null : null);
  }, []);

  const loadChecks = useCallback(async (runId: string) => {
    const { data, error } = await supabase.rpc('get_gameweek_simulation_integrity', { p_run_id: runId });
    if (error) throw error;
    if (!(data as any)?.success) throw new Error(resultError(data, 'Unable to run checks'));
    setChecks(((data as any)?.checks ?? []) as IntegrityCheck[]);
  }, []);

  const loadWaiverResults = useCallback(async (runId: string) => {
    const { data, error } = await supabase.rpc('get_gameweek_simulation_waiver_results', { p_run_id: runId });
    if (error) throw error;
    setWaiverResults((data ?? []) as WaiverResult[]);
  }, []);

  const refresh = useCallback(async () => {
    if (!activeLeagueId) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase.rpc('get_gameweek_simulation_status', { p_league_id: activeLeagueId });
      if (error) throw error;
      const next = data as unknown as StatusPayload;
      setStatus(next);
      const preferred = next.available_gameweeks?.find((gw) => gw.is_current && !gw.is_finished)
        ?? next.available_gameweeks?.find((gw) => !gw.is_finished)
        ?? next.available_gameweeks?.[0];
      setSelectedGameweek((current) => current ?? preferred?.gameweek ?? null);
      if (next.active_run) {
        await Promise.all([
          loadPlayers(next.active_run.id),
          loadChecks(next.active_run.id),
          loadWaiverResults(next.active_run.id),
        ]);
      } else {
        setPlayers([]);
        setChecks([]);
        setWaiverResults([]);
        setSelectedPlayer(null);
      }
    } catch (error: any) {
      showMessage('Simulator unavailable', error?.message ?? 'The simulator could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [activeLeagueId, loadChecks, loadPlayers, loadWaiverResults]);

  useEffect(() => { void refresh(); }, [refresh]);

  const perform = async (task: () => Promise<void>) => {
    if (working) return;
    try {
      setWorking(true);
      await task();
      await refresh();
    } catch (error: any) {
      showMessage('Simulation action failed', error?.message ?? 'Please try again safely.');
    } finally {
      setWorking(false);
    }
  };

  const start = () => {
    if (!activeLeagueId || !selectedGameweek) return;
    confirmAction(
      `Rehearse Gameweek ${selectedGameweek}?`,
      'The current league and Gameweek state will be snapshotted. Official live syncing pauses until you reset or the four-hour safety expiry is reached.',
      'Start rehearsal',
      () => void perform(async () => {
          const { data, error } = await supabase.rpc('start_gameweek_simulation', {
            p_league_id: activeLeagueId,
            p_gameweek: selectedGameweek,
            p_duration_minutes: 240,
          });
          if (error) throw error;
          if (!(data as any)?.success) throw new Error(resultError(data, 'The rehearsal could not start.'));
      }),
    );
  };

  const advance = () => {
    if (!run) return;
    const next = PHASE_ACTIONS[run.phase];
    if (!next) return;
    confirmAction(next.label, 'Continue to the next controlled phase?', 'Continue', () => void perform(async () => {
        const { data, error } = await supabase.rpc('advance_gameweek_simulation', {
          p_run_id: run.id,
          p_action: next.action,
        });
        if (error) throw error;
        if (!(data as any)?.success) throw new Error(resultError(data, 'The phase could not be advanced.'));
    }));
  };

  const applyStats = (preset: string, stats: Record<string, number> = {}) => {
    if (!run || !selectedPlayer) return;
    void perform(async () => {
      const { data, error } = await supabase.rpc('set_gameweek_simulation_player_stats', {
        p_run_id: run.id,
        p_player_id: selectedPlayer.player_id,
        p_preset: preset,
        p_stats: stats,
      });
      if (error) throw error;
      if (!(data as any)?.success) throw new Error(resultError(data, 'The player event could not be applied.'));
    });
  };

  const reset = () => {
    if (!run) return;
    confirmAction(
      'Reset rehearsal?',
      'This restores the pre-rehearsal Gameweek, player scores, fixtures, rosters, waivers and transactions. This cannot be undone.',
      'Restore snapshot',
      () => void perform(async () => {
          const { data, error } = await supabase.rpc('reset_gameweek_simulation', {
            p_run_id: run.id,
            p_reason: 'COMMISSIONER_RESET',
          });
          if (error) throw error;
          if (!(data as any)?.success) throw new Error(resultError(data, 'The snapshot could not be restored.'));
      }),
      true,
    );
  };

  const filteredPlayers = players.filter((player) => {
    const needle = search.trim().toLowerCase();
    return !needle || `${player.player_name} ${player.club_name} ${player.manager_name}`.toLowerCase().includes(needle);
  });

  if (loading) {
    return <SafeAreaView style={styles.screen}><ActivityIndicator color={colors.accent} style={styles.loader} /></SafeAreaView>;
  }

  if (!status?.enabled || !status.is_commissioner) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.emptyCard}>
          <Ionicons name="shield-checkmark" size={30} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Simulator unavailable</Text>
          <Text style={styles.body}>This guarded tool must be enabled for the project and opened by the active league commissioner.</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => router.back()}><Text style={styles.secondaryButtonText}>Go back</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroTitleRow}>
            <Ionicons name="flask" size={22} color={colors.warning} />
            <View style={styles.flex}>
              <Text style={styles.title}>Gameweek rehearsal</Text>
              <Text style={styles.body}>Controlled scoring, deadlines, autosubs and waiver rollover with one-tap restoration.</Text>
            </View>
          </View>
          {run && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>SIMULATION MODE · Official live sync paused · expires {new Date(run.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          )}
        </View>

        {!run ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Choose a test Gameweek</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {status.available_gameweeks.map((gw) => (
                <TouchableOpacity key={gw.gameweek} style={[styles.chip, selectedGameweek === gw.gameweek && styles.chipSelected]} onPress={() => setSelectedGameweek(gw.gameweek)}>
                  <Text style={[styles.chipText, selectedGameweek === gw.gameweek && styles.chipTextSelected]}>GW {gw.gameweek}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.hint}>Starting requires all managers to have a valid 15-player roster and an existing fixture for the selected Gameweek.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={start} disabled={working || !selectedGameweek}>
              {working ? <ActivityIndicator color={colors.black} /> : <><Ionicons name="play" size={16} color={colors.black} /><Text style={styles.primaryButtonText}>Start controlled rehearsal</Text></>}
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.phaseHeader}>
                <View><Text style={styles.eyebrow}>GAMEWEEK {run.gameweek}</Text><Text style={styles.phaseTitle}>{run.phase.replaceAll('_', ' ')}</Text></View>
                <TouchableOpacity style={styles.refreshButton} onPress={() => void refresh()} disabled={working}><Ionicons name="refresh" size={17} color={colors.textPrimary} /></TouchableOpacity>
              </View>
              <View style={styles.phaseTrack}>
                {(['PRE_DEADLINE','WAIVERS_PROCESSED','LOCKED','LIVE','FINISHED','AUTOSUBS','WAIVERS_OPEN'] as RunPhase[]).map((phase) => (
                  <View key={phase} style={[styles.phaseDot, phase === run.phase && styles.phaseDotActive]} />
                ))}
              </View>
              {PHASE_ACTIONS[run.phase] ? (
                <TouchableOpacity style={styles.primaryButton} onPress={advance} disabled={working}>
                  {working ? <ActivityIndicator color={colors.black} /> : <><Ionicons name={PHASE_ACTIONS[run.phase]!.icon} size={16} color={colors.black} /><Text style={styles.primaryButtonText}>{PHASE_ACTIONS[run.phase]!.label}</Text></>}
                </TouchableOpacity>
              ) : <Text style={styles.successText}>The lifecycle rehearsal is complete. Review the checks, then restore the snapshot.</Text>}
            </View>

            {run.phase === 'LIVE' && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Live event editor</Text>
                <TextInput value={search} onChangeText={setSearch} placeholder="Search player, club or manager" placeholderTextColor={colors.textMuted} style={styles.searchInput} />
                <ScrollView style={styles.playerList} nestedScrollEnabled>
                  {filteredPlayers.map((player) => (
                    <TouchableOpacity key={`${player.manager_id}-${player.player_id}`} style={[styles.playerRow, selectedPlayer?.player_id === player.player_id && styles.playerRowSelected]} onPress={() => { setSelectedPlayer(player); setCustom({ minutes: String(player.minutes), total_points: String(player.total_points), defensive_contribution: String(player.defensive_contribution) }); }}>
                      <View style={styles.flex}><Text style={styles.playerName}>{player.player_name}</Text><Text style={styles.playerMeta}>{player.position} · {player.club_name} · {player.manager_name}{player.is_starting ? ' · XI' : ' · BENCH'}</Text></View>
                      <Text style={styles.points}>{player.total_points} pts</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {selectedPlayer && (
                  <View style={styles.editorPanel}>
                    <Text style={styles.editorTitle}>{selectedPlayer.player_name}</Text>
                    <View style={styles.presetGrid}>{PRESETS.map(([value,label]) => <TouchableOpacity key={value} style={styles.presetButton} onPress={() => applyStats(value)} disabled={working}><Text style={styles.presetText}>{label}</Text></TouchableOpacity>)}</View>
                    <Text style={styles.subheading}>Custom event totals</Text>
                    <View style={styles.fieldGrid}>
                      {CUSTOM_FIELDS.map(([key,label]) => (
                        <View key={key} style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={custom[key] ?? ''} onChangeText={(value) => setCustom((current) => ({ ...current, [key]: value }))} keyboardType="number-pad" style={styles.numberInput} placeholder="0" placeholderTextColor={colors.textMuted} /></View>
                      ))}
                    </View>
                    <TouchableOpacity style={styles.secondaryButton} onPress={() => applyStats('CUSTOM', Object.fromEntries(Object.entries(custom).map(([key,value]) => [key, Number(value || 0)])))} disabled={working}><Text style={styles.secondaryButtonText}>Apply custom score</Text></TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            <View style={styles.card}>
              <View style={styles.phaseHeader}><Text style={styles.sectionTitle}>Integrity report</Text><TouchableOpacity onPress={() => void perform(async () => loadChecks(run.id))}><Text style={styles.linkText}>Run checks</Text></TouchableOpacity></View>
              {checks.map((check) => (
                <View key={check.key} style={styles.checkRow}>
                  <Ionicons name={check.passed ? 'checkmark-circle' : 'close-circle'} size={19} color={check.passed ? colors.accent : colors.danger} />
                  <View style={styles.flex}><Text style={styles.checkLabel}>{check.label}</Text><Text style={styles.checkDetail}>{check.detail}</Text></View>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <View style={styles.phaseHeader}>
                <View>
                  <Text style={styles.sectionTitle}>Waiver outcomes</Text>
                  <Text style={styles.hint}>{waiverResults.length} claims recorded for GW {run.gameweek}</Text>
                </View>
                <TouchableOpacity onPress={() => router.push('/(tabs)/market/waiver-history')}>
                  <Text style={styles.linkText}>Full history</Text>
                </TouchableOpacity>
              </View>
              {waiverResults.length === 0 ? (
                <Text style={styles.body}>No waiver claims were recorded for this rehearsal Gameweek.</Text>
              ) : waiverResults.map((result) => {
                const successful = result.status === 'SUCCESSFUL';
                return (
                  <View key={result.claim_id} style={styles.waiverResultRow}>
                    <Ionicons
                      name={successful ? 'checkmark-circle' : 'close-circle'}
                      size={19}
                      color={successful ? colors.accent : colors.danger}
                    />
                    <View style={styles.flex}>
                      <View style={styles.waiverResultHeader}>
                        <Text style={styles.checkLabel}>{result.manager_name} · Priority #{result.priority_order}</Text>
                        <Text style={[styles.waiverStatus, { color: successful ? colors.accent : colors.danger }]}>{result.status}</Text>
                      </View>
                      <Text style={styles.checkDetail}>{result.player_in_name} in · {result.player_out_name} out</Text>
                      {result.failure_reason ? <Text style={styles.failureReason}>{result.failure_reason.replaceAll('_', ' ')}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>

            <TouchableOpacity style={styles.dangerButton} onPress={reset} disabled={working}>
              <Ionicons name="return-down-back" size={17} color={colors.danger} /><Text style={styles.dangerButtonText}>Restore pre-rehearsal snapshot</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 920, alignSelf: 'center', padding: appSpacing.lg, paddingBottom: 40, gap: appSpacing.md },
  loader: { marginTop: 60 }, flex: { flex: 1 },
  hero: { gap: appSpacing.md }, heroTitleRow: { flexDirection: 'row', gap: appSpacing.md, alignItems: 'flex-start' },
  title: { ...appTypography.screenTitle, color: colors.textPrimary }, body: { ...appTypography.body, color: colors.textSecondary, lineHeight: 19 },
  warningBanner: { padding: 10, borderRadius: appRadius.medium, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.warning },
  warningText: { ...appTypography.label, color: colors.warning, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.large, padding: appSpacing.lg, gap: appSpacing.md },
  sectionTitle: { ...appTypography.sectionTitle, color: colors.textPrimary, textTransform: 'uppercase' },
  chips: { gap: 8 }, chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: appRadius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, chipText: { ...appTypography.body, color: colors.textSecondary }, chipTextSelected: { color: colors.accent },
  hint: { ...appTypography.metadata, color: colors.textMuted, lineHeight: 15 },
  primaryButton: { minHeight: 44, borderRadius: appRadius.medium, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  primaryButtonText: { ...appTypography.label, color: colors.black, fontSize: 11 },
  secondaryButton: { minHeight: 40, borderRadius: appRadius.medium, borderWidth: 1, borderColor: colors.accentBorder, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryButtonText: { ...appTypography.body, color: colors.accent },
  phaseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  eyebrow: { ...appTypography.label, color: colors.accent }, phaseTitle: { fontSize: 22, fontWeight: '900', color: colors.textPrimary },
  refreshButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  phaseTrack: { flexDirection: 'row', gap: 6 }, phaseDot: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.surfacePressed }, phaseDotActive: { backgroundColor: colors.accent },
  successText: { ...appTypography.body, color: colors.accent },
  searchInput: { minHeight: 42, borderRadius: appRadius.medium, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.backgroundElevated, paddingHorizontal: 12, color: colors.textPrimary },
  playerList: { maxHeight: 260, borderWidth: 1, borderColor: colors.border, borderRadius: appRadius.medium },
  playerRow: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }, playerRowSelected: { backgroundColor: colors.accentSoft },
  playerName: { ...appTypography.body, color: colors.textPrimary }, playerMeta: { ...appTypography.metadata, color: colors.textMuted, marginTop: 2 }, points: { ...appTypography.body, color: colors.accent },
  editorPanel: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, gap: 12 }, editorTitle: { fontSize: 17, fontWeight: '900', color: colors.textPrimary },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, presetButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: appRadius.pill, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong }, presetText: { ...appTypography.metadata, color: colors.textPrimary },
  subheading: { ...appTypography.label, color: colors.textSecondary, marginTop: 4 }, fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, field: { width: '31%', minWidth: 92, flexGrow: 1 }, fieldLabel: { ...appTypography.metadata, color: colors.textMuted, marginBottom: 4 },
  numberInput: { minHeight: 38, borderRadius: appRadius.small, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundElevated, color: colors.textPrimary, paddingHorizontal: 9 },
  linkText: { ...appTypography.body, color: colors.accent }, checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 }, checkLabel: { ...appTypography.body, color: colors.textPrimary }, checkDetail: { ...appTypography.metadata, color: colors.textMuted, marginTop: 2 },
  waiverResultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  waiverResultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  waiverStatus: { ...appTypography.label, fontSize: 8 },
  failureReason: { ...appTypography.metadata, color: colors.danger, marginTop: 3, textTransform: 'capitalize' },
  dangerButton: { minHeight: 44, borderRadius: appRadius.medium, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerBorder, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, dangerButtonText: { ...appTypography.body, color: colors.danger },
  emptyCard: { margin: 20, padding: 24, borderRadius: appRadius.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 12 }, emptyTitle: { fontSize: 18, fontWeight: '900', color: colors.textPrimary },
});
