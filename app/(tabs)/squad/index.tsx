import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import PlayerHeadshot from '@/components/PlayerHeadshot';
import PlayerCardModal from '@/components/PlayerCardModal';
import {
  AppColors,
  appRadius,
  appSpacing,
  appTypography,
} from '@/constants/theme';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import { supabase } from '@/utils/supabase';

type SquadPosition = 'GKP' | 'DEF' | 'MID' | 'FWD';

interface PlayerData {
  id: number;
  first_name?: string;
  second_name?: string;
  web_name: string;
  element_type: SquadPosition | string;
  team_id?: number;
  team_name: string;
  team_short_name?: string;
  photo_code?: number;
  code?: number;
  total_points?: number;
  event_points?: number;
  form?: string | number;
  status?: string;
  news?: string;
  chance_of_playing_next_round?: number | null;
  next_fixture?: string | null;
}

interface RosterItem {
  id: string;
  player_id: number;
  is_starting: boolean;
  is_gk: boolean;
  bench_order: number | null;
  is_transfer_listed: boolean;
  trade_note: string | null;
  players: PlayerData;
}

interface AutoSubAuditItem {
  id: number;
  action_type: 'SWAP' | 'SKIPPED' | 'CORRECTION';
  subbed_out_player_id: number | null;
  subbed_in_player_id: number | null;
  bench_priority: number | null;
  explanation: string;
  created_at: string;
}

interface SquadCounts {
  GKP: number;
  DEF: number;
  MID: number;
  FWD: number;
}

const POSITION_COLORS: Record<SquadPosition, string> = {
  GKP: '#FFC107',
  DEF: '#00A2FF',
  MID: '#00F27A',
  FWD: '#FF4D78',
};

const STARTER_MINIMUMS: SquadCounts = { GKP: 1, DEF: 3, MID: 2, FWD: 1 };
const STARTER_MAXIMUMS: SquadCounts = { GKP: 1, DEF: 5, MID: 5, FWD: 3 };
const STRICT_ROSTER_LIMITS: SquadCounts = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };

const isSquadPosition = (position?: string): position is SquadPosition =>
  position === 'GKP' || position === 'DEF' || position === 'MID' || position === 'FWD';

const cloneRoster = (roster: RosterItem[]) => roster.map(item => ({ ...item, players: { ...item.players } }));

const getCounts = (items: RosterItem[], startersOnly = false): SquadCounts => {
  const counts: SquadCounts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  items.forEach(item => {
    if (startersOnly && !item.is_starting) return;
    const position = item.players?.element_type;
    if (isSquadPosition(position)) counts[position] += 1;
  });
  return counts;
};

const getFormationErrors = (items: RosterItem[]) => {
  const starters = items.filter(item => item.is_starting);
  const counts = getCounts(items, true);
  const errors: string[] = [];

  if (starters.length !== 11) errors.push(`Starting XI requires 11 players (${starters.length}/11).`);
  (Object.keys(STARTER_MINIMUMS) as SquadPosition[]).forEach(position => {
    if (counts[position] < STARTER_MINIMUMS[position] || counts[position] > STARTER_MAXIMUMS[position]) {
      errors.push(
        `${position} must be between ${STARTER_MINIMUMS[position]} and ${STARTER_MAXIMUMS[position]} starters (currently ${counts[position]}).`
      );
    }
  });
  return errors;
};

const normalizeBenchPriority = (items: RosterItem[]) => {
  const benchGoalkeepers = items.filter(item => !item.is_starting && item.players?.element_type === 'GKP');
  const benchOutfield = items
    .filter(item => !item.is_starting && item.players?.element_type !== 'GKP')
    .sort((a, b) => (a.bench_order ?? 99) - (b.bench_order ?? 99));
  const priority = new Map<string, number>();
  benchGoalkeepers.forEach(item => priority.set(item.id, 0));
  benchOutfield.forEach((item, index) => priority.set(item.id, index + 1));

  return items.map(item => ({
    ...item,
    bench_order: item.is_starting ? null : priority.get(item.id) ?? item.bench_order,
  }));
};

const getAvailability = (player: PlayerData, appColors: AppColors) => {
  const status = (player.status || 'a').toLowerCase();
  if (status === 'a') return { label: 'Available', color: appColors.accent };
  if (status === 'd') return { label: 'Doubtful', color: appColors.warning };
  if (status === 'i') return { label: 'Injured', color: appColors.danger };
  if (status === 's') return { label: 'Suspended', color: appColors.danger };
  if (status === 'u') return { label: 'Unavailable', color: appColors.danger };
  return { label: 'Not available', color: appColors.textMuted };
};

export default function SquadScreen() {
  const { colors: appColors } = useAppTheme();
  const styles = useMemo(() => createStyles(appColors), [appColors]);
  const isFocused = useIsFocused();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isCompact = width < 640;
  const isDesktop = width >= 900;
  const { currentUserId, activeLeagueId } = useAppSession();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listingSaving, setListingSaving] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [savedRoster, setSavedRoster] = useState<RosterItem[]>([]);
  const [rosterType, setRosterType] = useState<'STRICT' | 'FLEXIBLE'>('STRICT');
  const [teamName, setTeamName] = useState('My Team');
  const [leagueName, setLeagueName] = useState('Active League');
  const [currentGameweek, setCurrentGameweek] = useState(0);
  const [gameweekDeadline, setGameweekDeadline] = useState<string | null>(null);
  const [gameweekFinished, setGameweekFinished] = useState(false);
  const [gameweekStatus, setGameweekStatus] = useState<string | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);
  const [autosubAudit, setAutosubAudit] = useState<AutoSubAuditItem[]>([]);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [watchlistIds, setWatchlistIds] = useState<Set<number>>(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null);
  const [inspectingPlayerId, setInspectingPlayerId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSquad = useCallback(async (asRefresh = false) => {
    if (!currentUserId || !activeLeagueId) {
      setLoading(false);
      return;
    }

    if (asRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [rosterResponse, memberResponse, leagueResponse, gameweekResponse, watchlistResponse, auditResponse, fixturesResponse] = await Promise.all([
        supabase
          .from('rosters')
          .select('id, player_id, is_starting, is_gk, bench_order, is_transfer_listed, trade_note, players(*)')
          .eq('league_id', activeLeagueId)
          .eq('user_id', currentUserId),
        supabase
          .from('league_members')
          .select('team_name')
          .eq('league_id', activeLeagueId)
          .eq('user_id', currentUserId)
          .maybeSingle(),
        supabase
          .from('leagues')
          .select('name, roster_type')
          .eq('id', activeLeagueId)
          .maybeSingle(),
        supabase
          .from('league_gameweeks')
          .select('gameweek, gw_deadline, is_finished, status')
          .eq('league_id', activeLeagueId)
          .eq('is_current', true)
          .order('gameweek', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('watchlists')
          .select('player_id')
          .eq('league_id', activeLeagueId)
          .eq('user_id', currentUserId),
        supabase
          .from('lineup_change_audit')
          .select('created_at')
          .eq('league_id', activeLeagueId)
          .eq('user_id', currentUserId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('fixtures')
          .select('gameweek, home_team_id, away_team_id, home_team_short, away_team_short, kickoff_time, is_finished')
          .eq('is_finished', false)
          .not('kickoff_time', 'is', null)
          .order('gameweek', { ascending: true })
          .order('kickoff_time', { ascending: true }),
      ]);

      const requestError = rosterResponse.error || memberResponse.error || leagueResponse.error;
      if (requestError) throw requestError;

      const nextFixtureByTeam = new Map<number, string>();
      (fixturesResponse.data || []).forEach((fixture: any) => {
        const homeTeamId = Number(fixture.home_team_id);
        const awayTeamId = Number(fixture.away_team_id);
        if (!nextFixtureByTeam.has(homeTeamId)) {
          nextFixtureByTeam.set(homeTeamId, `${fixture.away_team_short || 'OPP'} H`);
        }
        if (!nextFixtureByTeam.has(awayTeamId)) {
          nextFixtureByTeam.set(awayTeamId, `${fixture.home_team_short || 'OPP'} A`);
        }
      });

      const structured = (rosterResponse.data || [])
        .map((item: any) => ({
          id: String(item.id),
          player_id: Number(item.player_id),
          is_starting: Boolean(item.is_starting),
          is_gk: Boolean(item.is_gk),
          bench_order: item.bench_order === null ? null : Number(item.bench_order),
          is_transfer_listed: Boolean(item.is_transfer_listed),
          trade_note: item.trade_note || null,
          players: (() => {
            const player = Array.isArray(item.players) ? item.players[0] : item.players;
            return player
              ? { ...player, next_fixture: nextFixtureByTeam.get(Number(player.team_id)) || null }
              : player;
          })(),
        }))
        .filter((item: RosterItem) => Boolean(item.players)) as RosterItem[];

      const normalized = normalizeBenchPriority(structured);
      const resolvedGameweek = Number(gameweekResponse.data?.gameweek || 0);

      let resolvedSnapshotStatus: string | null = null;
      let resolvedAutosubAudit: AutoSubAuditItem[] = [];
      if (resolvedGameweek > 0) {
        const [snapshotResponse, autosubResponse] = await Promise.all([
          supabase
            .from('gameweek_lineup_snapshots')
            .select('status')
            .eq('league_id', activeLeagueId)
            .eq('user_id', currentUserId)
            .eq('gameweek', resolvedGameweek)
            .maybeSingle(),
          supabase
            .from('gameweek_autosub_audit')
            .select('id, action_type, subbed_out_player_id, subbed_in_player_id, bench_priority, explanation, created_at')
            .eq('league_id', activeLeagueId)
            .eq('user_id', currentUserId)
            .eq('gameweek', resolvedGameweek)
            .order('created_at', { ascending: true }),
        ]);
        resolvedSnapshotStatus = snapshotResponse.data?.status || null;
        resolvedAutosubAudit = (autosubResponse.data || []) as AutoSubAuditItem[];
      }

      setRoster(normalized);
      setSavedRoster(cloneRoster(normalized));
      setTeamName(memberResponse.data?.team_name || 'My Team');
      setLeagueName(leagueResponse.data?.name || 'Active League');
      setRosterType((leagueResponse.data?.roster_type as 'STRICT' | 'FLEXIBLE') || 'STRICT');
      setCurrentGameweek(resolvedGameweek);
      setGameweekDeadline(gameweekResponse.data?.gw_deadline || null);
      setGameweekFinished(Boolean(gameweekResponse.data?.is_finished));
      setGameweekStatus(gameweekResponse.data?.status || null);
      setSnapshotStatus(resolvedSnapshotStatus);
      setAutosubAudit(resolvedAutosubAudit);
      setWatchlistIds(new Set((watchlistResponse.data || []).map(row => Number(row.player_id))));
      setLastSavedAt(auditResponse.data?.created_at || null);
    } catch (error: any) {
      Alert.alert('Squad unavailable', error?.message || 'Your squad could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeLeagueId, currentUserId]);

  useEffect(() => {
    if (isFocused) void loadSquad();
  }, [isFocused, loadSquad]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const formationErrors = useMemo(() => getFormationErrors(roster), [roster]);
  const rosterCounts = useMemo(() => getCounts(roster), [roster]);
  const starters = useMemo(() => roster.filter(item => item.is_starting), [roster]);
  const benchGoalkeeper = useMemo(
    () => roster.find(item => !item.is_starting && item.players?.element_type === 'GKP') || null,
    [roster]
  );
  const benchOutfield = useMemo(
    () => roster
      .filter(item => !item.is_starting && item.players?.element_type !== 'GKP')
      .sort((a, b) => (a.bench_order ?? 99) - (b.bench_order ?? 99)),
    [roster]
  );
  const starterCounts = useMemo(() => getCounts(roster, true), [roster]);
  const formation = `${starterCounts.DEF}-${starterCounts.MID}-${starterCounts.FWD}`;
  const unavailableCount = roster.filter(item => getAvailability(item.players, appColors).label !== 'Available').length;
  const listedCount = roster.filter(item => item.is_transfer_listed).length;
  const lineupLocked = Boolean(
    gameweekDeadline
      && new Date(gameweekDeadline).getTime() <= clockNow
      && !gameweekFinished
  );
  const inspectingRosterItem = useMemo(
    () => roster.find(item => item.player_id === inspectingPlayerId) || null,
    [inspectingPlayerId, roster]
  );

  const enterEditMode = () => {
    if (lineupLocked) {
      Alert.alert(
        'Lineup locked',
        `Gameweek ${currentGameweek} is in progress. Your deadline lineup is preserved until the gameweek is finished.`
      );
      return;
    }
    setSavedRoster(cloneRoster(roster));
    setSelectedRosterId(null);
    setIsEditing(true);
    setNotice('Edit mode active · choose one starter and one substitute');
  };

  const cancelEditMode = () => {
    setRoster(cloneRoster(savedRoster));
    setSelectedRosterId(null);
    setIsEditing(false);
    setNotice('Lineup changes discarded');
  };

  const handlePlayerPress = (item: RosterItem) => {
    if (!isEditing) {
      setInspectingPlayerId(item.player_id);
      return;
    }

    if (!selectedRosterId) {
      setSelectedRosterId(item.id);
      return;
    }
    if (selectedRosterId === item.id) {
      setSelectedRosterId(null);
      return;
    }

    const selected = roster.find(player => player.id === selectedRosterId);
    if (!selected) {
      setSelectedRosterId(item.id);
      return;
    }

    if (selected.is_starting === item.is_starting) {
      setSelectedRosterId(item.id);
      setNotice(item.is_starting ? 'Choose a substitute to complete the change' : 'Use the arrows to change substitute priority');
      return;
    }

    const starter = selected.is_starting ? selected : item;
    const substitute = selected.is_starting ? item : selected;
    const nextRoster = normalizeBenchPriority(roster.map(player => {
      if (player.id === starter.id) {
        return { ...player, is_starting: false, bench_order: substitute.bench_order };
      }
      if (player.id === substitute.id) {
        return { ...player, is_starting: true, bench_order: null };
      }
      return player;
    }));
    const nextErrors = getFormationErrors(nextRoster);

    if (nextErrors.length > 0) {
      Alert.alert('Formation blocked', nextErrors[0]);
      setSelectedRosterId(null);
      return;
    }

    setRoster(nextRoster);
    setSelectedRosterId(null);
    setNotice(`${substitute.players.web_name} moved into the XI · save to confirm`);
  };

  const moveBenchPlayer = (item: RosterItem, direction: -1 | 1) => {
    const index = benchOutfield.findIndex(player => player.id === item.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= benchOutfield.length) return;

    const reordered = [...benchOutfield];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    const priority = new Map(reordered.map((player, priorityIndex) => [player.id, priorityIndex + 1]));
    setRoster(current => current.map(player => priority.has(player.id)
      ? { ...player, bench_order: priority.get(player.id) || player.bench_order }
      : player
    ));
    setNotice(`${item.players.web_name} moved to substitute priority ${nextIndex + 1}`);
  };

  const saveLineup = async () => {
    if (!activeLeagueId || saving) return;
    if (formationErrors.length > 0) {
      Alert.alert('Lineup cannot be saved', formationErrors[0]);
      return;
    }
    if (!benchGoalkeeper || benchOutfield.length !== 3) {
      Alert.alert('Bench incomplete', 'Your bench must contain one goalkeeper and three ordered outfield substitutes.');
      return;
    }

    setSaving(true);
    try {
      const startingIds = starters.map(item => item.player_id);
      const benchIds = [benchGoalkeeper.player_id, ...benchOutfield.map(item => item.player_id)];
      const { data, error } = await supabase.rpc('save_manager_lineup', {
        p_league_id: activeLeagueId,
        p_starting_player_ids: startingIds,
        p_bench_player_ids: benchIds,
      });
      if (error) throw error;
      if (!data?.success) {
        const messages: Record<string, string> = {
          INVALID_FORMATION: 'The resulting formation is not valid.',
          ROSTER_MISMATCH: 'Your squad changed while editing. Refresh and try again.',
          STARTING_XI_REQUIRES_11: 'Your starting XI must contain exactly 11 players.',
          BENCH_REQUIRES_4: 'Your substitutes bench must contain exactly four players.',
          BENCH_REQUIRES_ONE_GKP: 'Exactly one substitute goalkeeper is required.',
          LINEUP_LOCKED: `Gameweek ${data?.gameweek || currentGameweek} is already in progress. Your deadline lineup cannot be changed.`,
        };
        throw new Error(messages[data?.error] || data?.error || 'The lineup was rejected.');
      }

      setSavedRoster(cloneRoster(roster));
      setLastSavedAt(new Date().toISOString());
      setIsEditing(false);
      setSelectedRosterId(null);
      setNotice(`Lineup saved · ${formation} · substitute priority confirmed`);
      await loadSquad();
    } catch (error: any) {
      Alert.alert('Lineup save failed', error?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const updateTransferListing = async (isListed: boolean, note: string | null) => {
    if (!activeLeagueId || !currentUserId || !inspectingRosterItem || listingSaving) return;

    setListingSaving(true);
    try {
      const normalizedNote = isListed ? note?.trim() || null : null;
      const { data, error } = await supabase.rpc('set_transfer_listing', {
        p_league_id: activeLeagueId,
        p_roster_id: inspectingRosterItem.id,
        p_is_listed: isListed,
        p_trade_note: normalizedNote,
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'The player listing could not be updated. Refresh and try again.');
      }

      const applyListing = (item: RosterItem) => item.id === inspectingRosterItem.id
        ? { ...item, is_transfer_listed: isListed, trade_note: normalizedNote }
        : item;
      setRoster(current => current.map(applyListing));
      setSavedRoster(current => current.map(applyListing));
      setNotice(isListed
        ? `${inspectingRosterItem.players.web_name} is now on the transfer list`
        : `${inspectingRosterItem.players.web_name} removed from the transfer list`
      );
    } catch (error: any) {
      Alert.alert('Transfer listing failed', error?.message || 'Please try again.');
    } finally {
      setListingSaving(false);
    }
  };

  const renderPlayer = (item: RosterItem, benchPriority?: number) => {
    const selected = selectedRosterId === item.id;
    const availability = getAvailability(item.players, appColors);
    const isBenchOutfield = !item.is_starting && item.players.element_type !== 'GKP';
    const fixtureLabel = item.players.next_fixture || 'NO FIXTURE';

    return (
      <View key={item.id} style={[styles.playerSlot, isCompact && styles.playerSlotCompact]}>
        <Pressable
          style={({ pressed }) => [
            styles.playerCard,
            isCompact && styles.playerCardCompact,
            selected && styles.playerCardSelected,
            pressed && styles.playerCardPressed,
          ]}
          onPress={() => handlePlayerPress(item)}
          accessibilityRole="button"
          accessibilityLabel={`${item.players.web_name}${isEditing ? ', select for lineup change' : ', view player details'}`}
        >
          <View style={styles.playerStatusRow}>
            <View style={[styles.availabilityDot, { backgroundColor: availability.color }]} />
            <View style={styles.playerFlags}>
              {watchlistIds.has(item.player_id) && <Ionicons name="star" size={10} color={appColors.warning} />}
              {item.is_transfer_listed && <Ionicons name="swap-horizontal" size={11} color={appColors.info} />}
            </View>
          </View>

          <View style={[styles.avatar, isCompact && styles.avatarCompact]}>
            <PlayerHeadshot
              code={item.players.code}
              photoCode={item.players.photo_code}
              teamId={item.players.team_id}
              style={[styles.headshot, isCompact && styles.headshotCompact]}
              fallbackSize={isCompact ? 28 : 34}
            />
          </View>

          <Text style={[styles.playerName, isCompact && styles.playerNameCompact]} numberOfLines={1}>
            {item.players.web_name}
          </Text>
          <Text numberOfLines={1} style={[styles.playerMeta, { color: POSITION_COLORS[item.players.element_type as SquadPosition] || appColors.textMuted }]}>
            {fixtureLabel}
          </Text>
        </Pressable>

        {isEditing && isBenchOutfield && (
          <View style={styles.priorityControls}>
            <TouchableOpacity
              style={styles.priorityButton}
              onPress={() => moveBenchPlayer(item, -1)}
              disabled={benchPriority === 1}
              accessibilityLabel={`Move ${item.players.web_name} earlier in substitute priority`}
            >
              <Ionicons name="chevron-back" size={14} color={benchPriority === 1 ? appColors.textDisabled : appColors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.priorityNumber}>{benchPriority}</Text>
            <TouchableOpacity
              style={styles.priorityButton}
              onPress={() => moveBenchPlayer(item, 1)}
              disabled={benchPriority === 3}
              accessibilityLabel={`Move ${item.players.web_name} later in substitute priority`}
            >
              <Ionicons name="chevron-forward" size={14} color={benchPriority === 3 ? appColors.textDisabled : appColors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderHero = (sidebar = false) => (
    <View style={[styles.hero, sidebar && styles.heroSidebar, isCompact && styles.heroCompact]}>
      <View style={styles.heroCopy}>
        <Text style={styles.eyebrow}>{leagueName.toUpperCase()}{currentGameweek ? ` · GAMEWEEK ${currentGameweek}` : ''}</Text>
        <Text style={styles.title}>{teamName}</Text>
        {!isCompact && (
          <Text style={styles.subtitle}>
            {isEditing ? 'Select a starter and substitute, then confirm the bench order.' : 'Review your squad, player status and upcoming fixtures.'}
          </Text>
        )}
      </View>
      {!isEditing ? (
        <TouchableOpacity
          style={[styles.editButton, sidebar && styles.sidebarAction, lineupLocked && styles.editButtonDisabled]}
          onPress={enterEditMode}
          disabled={lineupLocked}
        >
          <Ionicons name={lineupLocked ? 'lock-closed' : 'create-outline'} size={16} color={appColors.accentForeground} />
          <Text style={styles.editButtonText}>{lineupLocked ? 'LINEUP LOCKED' : 'EDIT LINEUP'}</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.editActions, sidebar && styles.sidebarAction]}>
          <TouchableOpacity style={[styles.cancelButton, sidebar && styles.sidebarActionButton]} onPress={cancelEditMode} disabled={saving}>
            <Text style={styles.cancelButtonText}>CANCEL</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.saveButton, sidebar && styles.sidebarActionButton]} onPress={() => void saveLineup()} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={appColors.accentForeground} /> : <Ionicons name="checkmark" size={16} color={appColors.accentForeground} />}
            <Text style={styles.saveButtonText}>SAVE</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderSummary = (sidebar = false) => (
    <>
      <View style={[styles.summaryGrid, sidebar && styles.summaryGridSidebar]}>
        {[
          { label: 'FORMATION', value: formation, meta: `${rosterType} roster` },
          { label: 'SQUAD', value: `${roster.length}/15`, meta: '11 starters · 4 subs' },
          { label: 'AVAILABILITY', value: String(unavailableCount), meta: unavailableCount === 1 ? 'flagged player' : 'flagged players', warning: unavailableCount > 0 },
          { label: 'TRANSFER LIST', value: String(listedCount), meta: listedCount === 1 ? 'player listed' : 'players listed' },
        ].map(item => (
          <View key={item.label} style={[styles.summaryCard, sidebar && styles.summaryCardSidebar]}>
            <Text style={styles.summaryLabel}>{item.label}</Text>
            <Text style={[styles.summaryValue, item.warning && styles.summaryWarning]}>{item.value}</Text>
            <Text style={styles.summaryMeta}>{item.meta}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.positionLimitRow, sidebar && styles.positionLimitSidebar]}>
        {(Object.keys(rosterCounts) as SquadPosition[]).map(position => {
          const limit = STRICT_ROSTER_LIMITS[position];
          const full = rosterCounts[position] >= limit;
          return (
            <View key={position} style={styles.positionLimitChip}>
              <View style={[styles.positionBar, { backgroundColor: POSITION_COLORS[position] }]} />
              <Text style={styles.positionLimitCode}>{position}</Text>
              <Text style={[styles.positionLimitCount, full && styles.positionLimitCountFull]}>{rosterCounts[position]}/{limit}</Text>
            </View>
          );
        })}
        <Text style={[styles.lastSavedText, sidebar && styles.lastSavedSidebar]}>
          {lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleString()}` : 'No lineup changes saved yet'}
        </Text>
      </View>

      {currentGameweek > 0 && (
        <View style={[styles.lifecycleCard, lineupLocked && styles.lifecycleCardLocked]}>
          <View style={styles.lifecycleIcon}>
            <Ionicons
              name={lineupLocked ? 'lock-closed' : snapshotStatus ? 'shield-checkmark' : 'time-outline'}
              size={16}
              color={lineupLocked ? appColors.warning : appColors.accent}
            />
          </View>
          <View style={styles.lifecycleCopy}>
            <Text style={[styles.lifecycleTitle, lineupLocked && styles.lifecycleTitleLocked]}>
              GW{currentGameweek} · {lineupLocked ? 'LINEUP LOCKED' : gameweekStatus || 'UPCOMING'}
            </Text>
            <Text style={styles.lifecycleMeta}>
              {snapshotStatus
                ? `Deadline lineup ${snapshotStatus.toLowerCase()}`
                : gameweekDeadline
                  ? `Deadline ${new Date(gameweekDeadline).toLocaleString()}`
                  : 'Waiting for the official deadline schedule'}
            </Text>
          </View>
        </View>
      )}
    </>
  );

  const renderStatus = () => (
    <View style={styles.statusSection}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionEyebrow}>SQUAD STATUS</Text>
          <Text style={styles.sectionTitle}>Availability & actions</Text>
        </View>
        <Text style={styles.sectionHint}>Tap for details</Text>
      </View>
      <View style={styles.statusList}>
        {snapshotStatus && (
          <View style={styles.autosubSummary}>
            <View style={styles.autosubSummaryHeader}>
              <Ionicons name="git-compare-outline" size={16} color={appColors.accent} />
              <Text style={styles.autosubSummaryTitle}>GW{currentGameweek} AUTOSUBS · {snapshotStatus}</Text>
            </View>
            {autosubAudit.length === 0 ? (
              <Text style={styles.autosubSummaryText}>
                {snapshotStatus === 'LOCKED'
                  ? 'Your deadline lineup is safely stored. Autosubs will be evaluated after the gameweek finishes.'
                  : 'No automatic substitutions were required.'}
              </Text>
            ) : autosubAudit.map(event => {
              const outName = roster.find(item => item.player_id === event.subbed_out_player_id)?.players.web_name || 'Starting player';
              const inName = roster.find(item => item.player_id === event.subbed_in_player_id)?.players.web_name || 'Substitute';
              return (
                <View key={event.id} style={styles.autosubEvent}>
                  <Ionicons
                    name={event.action_type === 'SWAP' ? 'swap-horizontal' : event.action_type === 'CORRECTION' ? 'construct-outline' : 'alert-circle-outline'}
                    size={14}
                    color={event.action_type === 'SWAP' ? appColors.accent : event.action_type === 'CORRECTION' ? appColors.info : appColors.warning}
                  />
                  <View style={styles.autosubEventCopy}>
                    <Text style={styles.autosubEventTitle}>
                      {event.action_type === 'SWAP' ? `${inName} replaced ${outName}` : event.action_type === 'CORRECTION' ? 'Commissioner correction' : `${outName} was not replaced`}
                    </Text>
                    <Text style={styles.autosubEventText}>{event.explanation}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {roster
          .filter(item => getAvailability(item.players, appColors).label !== 'Available' || item.is_transfer_listed)
          .map(item => {
            const availability = getAvailability(item.players, appColors);
            return (
              <TouchableOpacity key={`status-${item.id}`} style={styles.statusRow} onPress={() => setInspectingPlayerId(item.player_id)}>
                <View style={[styles.statusIcon, { borderColor: `${availability.color}66` }]}>
                  <View style={[styles.statusDot, { backgroundColor: availability.color }]} />
                </View>
                <View style={styles.statusRowCopy}>
                  <Text style={styles.statusPlayerName}>{item.players.web_name}</Text>
                  <Text style={styles.statusPlayerMeta} numberOfLines={2}>
                    {item.players.news || availability.label}{item.is_transfer_listed ? ' · Transfer listed' : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={appColors.textMuted} />
              </TouchableOpacity>
            );
          })}
        {roster.every(item => getAvailability(item.players, appColors).label === 'Available' && !item.is_transfer_listed) && (
          <View style={styles.allClearRow}>
            <Ionicons name="shield-checkmark" size={18} color={appColors.accent} />
            <Text style={styles.allClearText}>All players are currently available and no squad members are transfer listed.</Text>
          </View>
        )}
      </View>
    </View>
  );

  const renderTransactionShortcut = (sidebar = false) => (
    <TouchableOpacity
      style={[styles.transactionShortcut, sidebar && styles.transactionShortcutSidebar]}
      onPress={() => router.push('/(tabs)/market/waiver-history')}
    >
      <View style={styles.transactionShortcutIcon}>
        <Ionicons name="receipt-outline" size={16} color={appColors.accent} />
      </View>
      <View style={styles.transactionShortcutCopy}>
        <Text style={styles.transactionShortcutTitle}>TRANSACTION HISTORY</Text>
        <Text style={styles.transactionShortcutMeta} numberOfLines={1}>Waivers, free agents and trades</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={appColors.textMuted} />
    </TouchableOpacity>
  );

  const renderMobileCommandBar = () => (
    <View style={styles.mobileCommandBar}>
      <View style={styles.mobileCommandIdentity}>
        <Text style={styles.mobileCommandEyebrow} numberOfLines={1}>{leagueName.toUpperCase()}{currentGameweek ? ` · GW${currentGameweek}` : ''}</Text>
        <Text style={styles.mobileCommandTitle} numberOfLines={1}>{teamName}</Text>
      </View>

      <View style={styles.mobileCommandActions}>
        <TouchableOpacity style={styles.mobileIconButton} onPress={() => setDetailsExpanded(true)} accessibilityLabel="Open squad details">
          <Ionicons name="information-circle-outline" size={19} color={appColors.accent} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.mobileIconButton} onPress={() => router.push('/(tabs)/market/waiver-history')} accessibilityLabel="Open transaction history">
          <Ionicons name="receipt-outline" size={18} color={appColors.accent} />
        </TouchableOpacity>
        {!isEditing ? (
          <TouchableOpacity
            style={[styles.mobileEditButton, lineupLocked && styles.editButtonDisabled]}
            onPress={enterEditMode}
            disabled={lineupLocked}
            accessibilityLabel={lineupLocked ? 'Lineup locked' : 'Edit lineup'}
          >
            <Ionicons name={lineupLocked ? 'lock-closed' : 'create-outline'} size={17} color={appColors.accentForeground} />
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={styles.mobileIconButton} onPress={cancelEditMode} disabled={saving} accessibilityLabel="Cancel lineup changes">
              <Ionicons name="close" size={19} color={appColors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.mobileEditButton} onPress={() => void saveLineup()} disabled={saving} accessibilityLabel="Save lineup">
              {saving ? <ActivityIndicator size="small" color={appColors.accentForeground} /> : <Ionicons name="checkmark" size={19} color={appColors.accentForeground} />}
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={appColors.accent} />
        <Text style={styles.loadingText}>LOADING SQUAD</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.page, !isCompact && styles.pageWide]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadSquad(true)} tintColor={appColors.accent} />}
      >
        <View style={[styles.workspace, isDesktop && styles.workspaceDesktop]}>
          <View style={[styles.infoRail, isDesktop && styles.infoRailDesktop]}>
            {isDesktop ? renderHero(true) : renderMobileCommandBar()}
            {isDesktop && renderSummary(true)}
            {isDesktop && renderTransactionShortcut(true)}
            {isDesktop && renderStatus()}

        {notice && (
          <View style={styles.noticeBanner}>
            <Ionicons name="checkmark-circle" size={15} color={appColors.accent} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

        {formationErrors.length > 0 && (
          <View style={styles.warningBanner}>
            <Ionicons name="warning" size={17} color={appColors.warning} />
            <View style={styles.warningCopy}>
              <Text style={styles.warningTitle}>LINEUP NEEDS ATTENTION</Text>
              <Text style={styles.warningText}>{formationErrors[0]}</Text>
            </View>
          </View>
        )}

          </View>

          <View style={styles.lineupColumn}>

        <View style={[styles.sectionHeader, isCompact && styles.sectionHeaderCompact]}>
          <View>
            <Text style={styles.sectionEyebrow}>STARTING XI</Text>
            <Text style={styles.sectionTitle}>Formation view</Text>
          </View>
          <View style={[styles.modeBadge, isEditing && styles.modeBadgeEditing]}>
            <Ionicons name={isEditing ? 'swap-vertical' : 'eye-outline'} size={13} color={isEditing ? appColors.warning : appColors.accent} />
            <Text style={[styles.modeBadgeText, isEditing && styles.modeBadgeTextEditing]}>{isEditing ? 'EDITING' : 'VIEW'}</Text>
          </View>
        </View>

        <View style={[styles.pitch, isCompact && styles.pitchCompact, isCompact && { height: Math.max(330, Math.min(430, height - 330)) }]}>
          <View style={styles.pitchLines}>
            <View style={styles.penaltyArea} />
            <View style={styles.centerLine} />
            <View style={styles.centerCircle} />
          </View>
          {(['FWD', 'MID', 'DEF', 'GKP'] as SquadPosition[]).map(position => (
            <View key={position} style={[styles.pitchRow, isCompact && styles.pitchRowCompact]}>
              {starters.filter(item => item.players.element_type === position).map(item => renderPlayer(item))}
            </View>
          ))}
        </View>

        <View style={styles.benchSection}>
          <View style={[styles.sectionHeader, isCompact && styles.sectionHeaderCompact]}>
            <View>
              <Text style={styles.sectionEyebrow}>SUBSTITUTES</Text>
              <Text style={styles.sectionTitle}>Automatic substitution priority</Text>
            </View>
            <Text style={styles.sectionHint}>GK fixed · outfield 1 → 3</Text>
          </View>
          {!isCompact && (
            <Text style={styles.benchExplanation}>
              If a starter does not play, eligible outfield substitutes are considered from left to right while preserving a legal formation.
            </Text>
          )}
          <View style={[styles.benchTray, isCompact && styles.benchTrayCompact]}>
            <View style={styles.benchGk}>{benchGoalkeeper && renderPlayer(benchGoalkeeper)}</View>
            <View style={styles.benchDivider} />
            <View style={styles.benchOutfield}>
              {benchOutfield.map((item, index) => renderPlayer(item, index + 1))}
            </View>
          </View>
        </View>

          </View>
        </View>

      </ScrollView>

      <Modal visible={!isDesktop && detailsExpanded} transparent animationType="slide" onRequestClose={() => setDetailsExpanded(false)} statusBarTranslucent>
        <View style={styles.mobileDetailsOverlay}>
          <TouchableOpacity style={styles.mobileDetailsDismissArea} activeOpacity={1} onPress={() => setDetailsExpanded(false)} />
          <View style={styles.mobileDetailsSheet}>
            <View style={styles.mobileDetailsHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>MY SQUAD</Text>
                <Text style={styles.mobileDetailsTitle}>Squad details</Text>
              </View>
              <TouchableOpacity style={styles.mobileDetailsClose} onPress={() => setDetailsExpanded(false)} accessibilityLabel="Close squad details">
                <Ionicons name="close" size={20} color={appColors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.mobileDetailsContent} showsVerticalScrollIndicator={false}>
              {renderSummary(false)}
              {renderStatus()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <PlayerCardModal
        visible={inspectingPlayerId !== null}
        playerId={inspectingPlayerId}
        leagueId={activeLeagueId}
        currentGameweek={currentGameweek}
        statsMode="CURRENT"
        transferListing={inspectingRosterItem ? {
          isListed: inspectingRosterItem.is_transfer_listed,
          note: inspectingRosterItem.trade_note,
          saving: listingSaving,
          onSave: note => updateTransferListing(true, note),
          onRemove: () => updateTransferListing(false, null),
        } : undefined}
        onClose={() => setInspectingPlayerId(null)}
      />
    </View>
  );
}

const createStyles = (appColors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.background },
  scroll: { flex: 1 },
  page: { padding: appSpacing.sm, paddingBottom: 32 },
  pageWide: { width: '100%', maxWidth: 1240, alignSelf: 'center', paddingHorizontal: appSpacing.xl },
  workspace: { width: '100%' },
  workspaceDesktop: { flexDirection: 'row', alignItems: 'flex-start', gap: appSpacing.lg },
  infoRail: { width: '100%' },
  infoRailDesktop: { width: 292, flexShrink: 0 },
  lineupColumn: { flex: 1, minWidth: 0 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.background },
  loadingText: { ...appTypography.label, color: appColors.textMuted, marginTop: appSpacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: appSpacing.md, padding: appSpacing.lg, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  heroSidebar: { flexDirection: 'column', alignItems: 'stretch' },
  heroCompact: { padding: appSpacing.md },
  mobileCommandBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: appColors.backgroundElevated, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  mobileCommandIdentity: { flex: 1, minWidth: 0 },
  mobileCommandEyebrow: { ...appTypography.label, color: appColors.accent, fontSize: 7 },
  mobileCommandTitle: { color: appColors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 2 },
  mobileCommandActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mobileIconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: 10 },
  mobileEditButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.accentFill, borderRadius: 10 },
  heroCopy: { flex: 1, minWidth: 0 },
  eyebrow: { ...appTypography.label, color: appColors.accent, fontSize: 8 },
  title: { ...appTypography.screenTitle, color: appColors.textPrimary, marginTop: 3 },
  subtitle: { ...appTypography.metadata, color: appColors.textSecondary, marginTop: 5, lineHeight: 15 },
  editButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 13, backgroundColor: appColors.accentFill, borderRadius: appRadius.medium },
  editButtonDisabled: { backgroundColor: appColors.warning, opacity: 0.86 },
  editButtonText: { ...appTypography.label, color: appColors.accentForeground },
  editActions: { flexDirection: 'row', gap: 7 },
  sidebarAction: { width: '100%' },
  sidebarActionButton: { flex: 1 },
  cancelButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11, backgroundColor: appColors.surfaceMuted, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  cancelButtonText: { ...appTypography.label, color: appColors.textSecondary },
  saveButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 12, backgroundColor: appColors.accentFill, borderRadius: appRadius.medium },
  saveButtonText: { ...appTypography.label, color: appColors.accentForeground },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: appSpacing.sm },
  summaryGridSidebar: { alignItems: 'stretch' },
  summaryCard: { flexGrow: 1, flexBasis: 140, minHeight: 78, justifyContent: 'center', padding: appSpacing.md, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  summaryCardSidebar: { flexBasis: 120, minHeight: 70, padding: 10 },
  summaryLabel: { ...appTypography.label, color: appColors.textMuted, fontSize: 8 },
  summaryValue: { color: appColors.textPrimary, fontSize: 22, fontWeight: '900', marginTop: 4 },
  summaryMax: { color: appColors.textMuted, fontSize: 11, fontWeight: '800' },
  summaryMeta: { ...appTypography.metadata, color: appColors.textSecondary, marginTop: 2 },
  summaryWarning: { color: appColors.warning },
  noticeBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: appSpacing.sm, paddingVertical: 9, paddingHorizontal: 11, backgroundColor: appColors.accentSoft, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.medium },
  noticeText: { flex: 1, ...appTypography.metadata, color: '#8DE8B9' },
  warningBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: appSpacing.sm, padding: appSpacing.md, backgroundColor: appColors.warningSoft, borderWidth: 1, borderColor: '#69501F', borderRadius: appRadius.medium },
  warningCopy: { flex: 1 },
  warningTitle: { ...appTypography.label, color: appColors.warning },
  warningText: { ...appTypography.metadata, color: '#D8C49A', marginTop: 3 },
  positionLimitRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: appSpacing.sm, padding: 8, backgroundColor: appColors.backgroundDeep, borderWidth: 1, borderColor: appColors.borderSubtle, borderRadius: appRadius.medium },
  positionLimitSidebar: { alignItems: 'flex-start' },
  positionLimitChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 7, backgroundColor: appColors.surfaceMuted, borderRadius: appRadius.small },
  positionBar: { width: 3, height: 15, borderRadius: 2 },
  positionLimitCode: { color: appColors.textSecondary, fontSize: 8, fontWeight: '900' },
  positionLimitCount: { color: appColors.textPrimary, fontSize: 9, fontWeight: '900' },
  positionLimitCountFull: { color: appColors.accent },
  lastSavedText: { flex: 1, minWidth: 180, color: appColors.textMuted, fontSize: 8, fontWeight: '700', textAlign: 'right' },
  lastSavedSidebar: { flexBasis: '100%', minWidth: 0, textAlign: 'left', marginTop: 2 },
  detailsToggle: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7, paddingHorizontal: 11, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  detailsToggleCopy: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  detailsToggleText: { ...appTypography.label, color: appColors.textSecondary, fontSize: 8 },
  lifecycleCard: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: appSpacing.sm, padding: 10, backgroundColor: appColors.accentSoft, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.medium },
  lifecycleCardLocked: { backgroundColor: appColors.warningSoft, borderColor: '#69501F' },
  lifecycleIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.backgroundDeep, borderRadius: 15 },
  lifecycleCopy: { flex: 1, minWidth: 0 },
  lifecycleTitle: { color: appColors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  lifecycleTitleLocked: { color: appColors.warning },
  lifecycleMeta: { color: appColors.textSecondary, fontSize: 8, fontWeight: '700', lineHeight: 12, marginTop: 3 },
  transactionShortcut: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: appSpacing.sm, paddingHorizontal: 11, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium },
  transactionShortcutSidebar: { minHeight: 54 },
  transactionShortcutIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.accentSoft, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: 9 },
  transactionShortcutCopy: { flex: 1, minWidth: 0 },
  transactionShortcutTitle: { ...appTypography.label, color: appColors.textPrimary, fontSize: 8 },
  transactionShortcutMeta: { ...appTypography.metadata, color: appColors.textMuted, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: appSpacing.sm, marginTop: appSpacing.lg, marginBottom: 8 },
  sectionHeaderCompact: { marginTop: 7, marginBottom: 5 },
  sectionEyebrow: { ...appTypography.label, color: appColors.accent, fontSize: 8 },
  sectionTitle: { ...appTypography.sectionTitle, color: appColors.textPrimary, marginTop: 2 },
  sectionHint: { ...appTypography.metadata, color: appColors.textMuted, textAlign: 'right' },
  modeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: appColors.accentSoft, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.pill },
  modeBadgeEditing: { backgroundColor: appColors.warningSoft, borderColor: '#69501F' },
  modeBadgeText: { color: appColors.accent, fontSize: 7, fontWeight: '900' },
  modeBadgeTextEditing: { color: appColors.warning },
  pitch: { position: 'relative', height: 500, justifyContent: 'space-around', paddingVertical: 13, backgroundColor: appColors.pitch, borderWidth: 1, borderColor: appColors.pitchBorder, borderRadius: appRadius.large, overflow: 'hidden' },
  pitchCompact: { height: 480, paddingVertical: 9 },
  pitchLines: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', opacity: 0.2 },
  penaltyArea: { position: 'absolute', top: -1, width: 180, height: 75, borderWidth: 1.5, borderColor: appColors.pitchLine },
  centerLine: { position: 'absolute', width: '100%', height: 1.5, backgroundColor: appColors.pitchLine },
  centerCircle: { width: 105, height: 105, borderRadius: 53, borderWidth: 1.5, borderColor: appColors.pitchLine },
  pitchRow: { minHeight: 98, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 5, zIndex: 2 },
  pitchRowCompact: { minHeight: 76, paddingHorizontal: 2 },
  playerSlot: { flex: 1, maxWidth: 155, minWidth: 0, alignItems: 'center', marginHorizontal: 3 },
  playerSlotCompact: { marginHorizontal: 1 },
  playerCard: { width: '100%', minHeight: 76, alignItems: 'center', paddingVertical: 5, paddingHorizontal: 3, backgroundColor: appColors.pitchPlayerSurface, borderWidth: 1, borderColor: 'transparent', borderRadius: appRadius.small },
  playerCardCompact: { minHeight: 70, paddingHorizontal: 1 },
  playerCardSelected: { backgroundColor: 'rgba(0,242,122,0.16)', borderColor: appColors.accent },
  playerCardPressed: { opacity: 0.78 },
  playerStatusRow: { width: '100%', minHeight: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3 },
  availabilityDot: { width: 6, height: 6, borderRadius: 3 },
  playerFlags: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  avatar: { width: 38, height: 36, alignItems: 'center', justifyContent: 'center' },
  avatarCompact: { width: 31, height: 30 },
  headshot: { width: 38, height: 38 },
  headshotCompact: { width: 31, height: 31 },
  playerName: { width: '100%', color: appColors.pitchPlayerNameText, fontSize: 9, fontWeight: '900', textAlign: 'center', backgroundColor: appColors.pitchPlayerNameSurface, paddingVertical: 2, paddingHorizontal: 3, borderRadius: 3 },
  playerNameCompact: { fontSize: 7.5 },
  playerMeta: { fontSize: 7, fontWeight: '900', marginTop: 2 },
  priorityControls: { flexDirection: 'row', alignItems: 'center', marginTop: 3, backgroundColor: appColors.backgroundDeep, borderRadius: appRadius.small },
  priorityButton: { width: 26, height: 24, alignItems: 'center', justifyContent: 'center' },
  priorityNumber: { minWidth: 15, color: appColors.accent, fontSize: 8, fontWeight: '900', textAlign: 'center' },
  benchSection: { paddingBottom: 4 },
  benchExplanation: { ...appTypography.metadata, color: appColors.textMuted, marginBottom: 7, lineHeight: 15 },
  benchTray: { minHeight: 106, flexDirection: 'row', alignItems: 'center', padding: 7, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  benchTrayCompact: { minHeight: 88, paddingVertical: 4, paddingHorizontal: 5 },
  benchGk: { flex: 0.34, minWidth: 0, alignItems: 'center' },
  benchDivider: { width: 1, height: 60, marginHorizontal: 5, backgroundColor: appColors.accentBorder },
  benchOutfield: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-evenly' },
  statusSection: { marginTop: 3, padding: appSpacing.md, backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.large },
  statusList: { gap: 6 },
  autosubSummary: { padding: 10, backgroundColor: appColors.backgroundDeep, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.medium },
  autosubSummaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 },
  autosubSummaryTitle: { flex: 1, color: appColors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  autosubSummaryText: { color: appColors.textSecondary, fontSize: 8, fontWeight: '700', lineHeight: 13 },
  autosubEvent: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingVertical: 7, borderTopWidth: 1, borderTopColor: appColors.borderSubtle },
  autosubEventCopy: { flex: 1, minWidth: 0 },
  autosubEventTitle: { color: appColors.textPrimary, fontSize: 8, fontWeight: '900' },
  autosubEventText: { color: appColors.textMuted, fontSize: 7.5, fontWeight: '700', lineHeight: 12, marginTop: 2 },
  statusRow: { minHeight: 53, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, backgroundColor: appColors.surfaceMuted, borderWidth: 1, borderColor: appColors.borderSubtle, borderRadius: appRadius.medium },
  statusIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 15 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusRowCopy: { flex: 1, minWidth: 0, marginHorizontal: 9 },
  statusPlayerName: { color: appColors.textPrimary, fontSize: 10, fontWeight: '900' },
  statusPlayerMeta: { color: appColors.textMuted, fontSize: 8, fontWeight: '700', marginTop: 2 },
  allClearRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, backgroundColor: appColors.accentSoft, borderRadius: appRadius.medium },
  allClearText: { flex: 1, color: '#8DE8B9', fontSize: 9, fontWeight: '700', lineHeight: 14 },
  mobileDetailsOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  mobileDetailsDismissArea: { flex: 1 },
  mobileDetailsSheet: { maxHeight: '82%', paddingTop: 12, paddingHorizontal: appSpacing.md, paddingBottom: 24, backgroundColor: appColors.backgroundElevated, borderTopWidth: 1, borderColor: appColors.accentBorder, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  mobileDetailsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingBottom: 8 },
  mobileDetailsTitle: { ...appTypography.sectionTitle, color: appColors.textPrimary, marginTop: 2 },
  mobileDetailsClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: 18 },
  mobileDetailsContent: { paddingBottom: 28 },
});
