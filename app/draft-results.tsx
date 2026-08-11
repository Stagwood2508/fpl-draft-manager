import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../utils/supabase';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import type { AppColors } from '@/constants/theme';

type HistoryView = 'BOARD' | 'LIST' | 'AUDIT';
type PositionFilter = 'ALL' | 'GKP' | 'DEF' | 'MID' | 'FWD';

interface DraftManager {
  user_id: string;
  team_name: string;
  draft_order: number | null;
}

interface DraftPickRow {
  id: number;
  user_id: string;
  player_id: number;
  round_number: number;
  overall_pick_number: number;
  picked_at: string | null;
  pick_source: string | null;
  pick_reason: string | null;
}

interface PlayerRow {
  id: number;
  web_name: string;
  team_name: string;
  element_type: string | number;
}

interface EnrichedDraftPick extends DraftPickRow {
  playerName: string;
  club: string;
  position: Exclude<PositionFilter, 'ALL'>;
  managerName: string;
  draftOrder: number | null;
}

interface DraftAuditRow {
  id: number;
  event_type: string;
  user_id: string | null;
  player_id: number | null;
  round_number: number | null;
  overall_pick_number: number | null;
  pick_source: string;
  pick_reason: string | null;
  actor_user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  managerName: string;
  playerName: string;
  actorName: string;
}

const positionColors: Record<Exclude<PositionFilter, 'ALL'>, { bg: string; text: string }> = {
  GKP: { bg: '#243D78', text: '#C9D7FF' },
  DEF: { bg: '#123D2A', text: '#63F2A7' },
  MID: { bg: '#513D10', text: '#FFD76B' },
  FWD: { bg: '#4A2020', text: '#FF9D95' },
};

const normalizePosition = (rawPosition: string | number): Exclude<PositionFilter, 'ALL'> => {
  const value = String(rawPosition || '').trim().toUpperCase();
  if (value === '1' || value.includes('GKP') || value.includes('GOAL')) return 'GKP';
  if (value === '2' || value.includes('DEF') || value.includes('BACK')) return 'DEF';
  if (value === '4' || value.includes('FWD') || value.includes('FORW') || value.includes('STRIK')) return 'FWD';
  return 'MID';
};

const getPickSourceLabel = (source: string | null) => {
  if (source === 'AUTO_WATCHLIST') return 'AUTO · WATCHLIST';
  if (source === 'AUTO_PLAYER_POOL') return 'AUTO · BEST AVAILABLE';
  if (source === 'COMMISSIONER') return 'COMMISSIONER';
  return 'MANUAL';
};

const getPickReasonLabel = (reason: string | null) => {
  if (reason === 'MANAGER_AWAY') return 'Away mode';
  if (reason === 'TIMER_EXPIRED') return 'Timer expired';
  if (reason === 'COMMISSIONER_FORCED') return 'Commissioner action';
  if (reason === 'COMMISSIONER_ASSIGNED') return 'Assigned by commissioner';
  if (reason === 'COMMISSIONER_CORRECTION') return 'Corrected by commissioner';
  return null;
};

const getAuditLabel = (eventType: string) => ({
  PICK_CREATED: 'Pick recorded',
  PICK_UNDONE: 'Pick undone',
  PICK_CORRECTED: 'Pick corrected',
  DRAFT_PAUSED: 'Draft paused',
  DRAFT_RESUMED: 'Draft resumed',
  TURN_EXTENDED: 'Timer extended',
  DRAFT_ORDER_UPDATED: 'Draft order changed',
  DRAFT_RESTARTED: 'Draft restarted',
}[eventType] || eventType.replaceAll('_', ' '));

const PositionBadge = ({ position }: { position: Exclude<PositionFilter, 'ALL'> }) => {
  const { colors: themeColors } = useAppTheme();
  const badgeStyles = useMemo(() => createStyles(themeColors), [themeColors]);
  const colors = positionColors[position];
  return (
    <View style={[badgeStyles.positionBadge, { backgroundColor: colors.bg }]}>
      <Text style={[badgeStyles.positionBadgeText, { color: colors.text }]}>{position}</Text>
    </View>
  );
};

export default function DraftResultsScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 900;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState('NOT_STARTED');
  const [currentRound, setCurrentRound] = useState(1);
  const [managers, setManagers] = useState<DraftManager[]>([]);
  const [picks, setPicks] = useState<EnrichedDraftPick[]>([]);
  const [auditRows, setAuditRows] = useState<DraftAuditRow[]>([]);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [activeView, setActiveView] = useState<HistoryView>('BOARD');
  const [managerFilter, setManagerFilter] = useState('ALL');
  const [roundFilter, setRoundFilter] = useState<number | 'ALL'>('ALL');
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
  const [clubFilter, setClubFilter] = useState('ALL');
  const [clubPickerVisible, setClubPickerVisible] = useState(false);

  const loadDraftResults = useCallback(async (isRefresh = false, silent = false) => {
    if (isRefresh) setRefreshing(true);
    else if (!silent) setLoading(true);

    try {
      setErrorMessage(null);
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      if (!userId) throw new Error('You need to sign in to view draft results.');

      let activeLeagueId = await AsyncStorage.getItem('active_league_id');
      if (!activeLeagueId) {
        const { data: membership, error: membershipError } = await supabase
          .from('league_members')
          .select('league_id')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();

        if (membershipError) throw membershipError;
        if (!membership?.league_id) throw new Error('No active league was found.');
        activeLeagueId = String(membership.league_id);
        await AsyncStorage.setItem('active_league_id', activeLeagueId);
      }

      setActiveLeagueId(activeLeagueId);

      const [managerResponse, pickResponse, playerResponse, sessionResponse, leagueResponse, auditResponse] = await Promise.all([
        supabase
          .from('league_members')
          .select('user_id, team_name, draft_order')
          .eq('league_id', activeLeagueId)
          .order('draft_order', { ascending: true }),
        supabase
          .from('draft_picks')
          .select('id, user_id, player_id, round_number, overall_pick_number, picked_at, pick_source, pick_reason')
          .eq('league_id', activeLeagueId)
          .order('overall_pick_number', { ascending: true }),
        supabase
          .from('players')
          .select('id, web_name, team_name, element_type'),
        supabase
          .from('draft_sessions')
          .select('draft_status, current_round')
          .eq('league_id', activeLeagueId)
          .maybeSingle(),
        supabase
          .from('leagues')
          .select('commissioner_id')
          .eq('id', activeLeagueId)
          .maybeSingle(),
        supabase
          .from('draft_pick_audit')
          .select('id, event_type, user_id, player_id, round_number, overall_pick_number, pick_source, pick_reason, actor_user_id, metadata, created_at')
          .eq('league_id', activeLeagueId)
          .order('created_at', { ascending: false })
          .limit(250),
      ]);

      const requestError =
        managerResponse.error ||
        pickResponse.error ||
        playerResponse.error ||
        sessionResponse.error ||
        leagueResponse.error ||
        auditResponse.error;
      if (requestError) throw requestError;

      const managerRows = (managerResponse.data || []) as DraftManager[];
      const pickRows = (pickResponse.data || []) as DraftPickRow[];
      const playerRows = (playerResponse.data || []) as PlayerRow[];
      const managerMap = new Map(managerRows.map(manager => [manager.user_id, manager]));
      const playerMap = new Map(playerRows.map(player => [player.id, player]));

      const enriched = pickRows.map(pick => {
        const player = playerMap.get(pick.player_id);
        const manager = managerMap.get(pick.user_id);
        return {
          ...pick,
          playerName: player?.web_name || 'Unknown player',
          club: player?.team_name || 'Unknown club',
          position: normalizePosition(player?.element_type || 'MID'),
          managerName: manager?.team_name || 'Unknown manager',
          draftOrder: manager?.draft_order ?? null,
        };
      });

      setManagers(managerRows);
      setPicks(enriched);
      setIsCommissioner(leagueResponse.data?.commissioner_id === userId);
      setAuditRows(((auditResponse.data || []) as Omit<DraftAuditRow, 'managerName' | 'playerName' | 'actorName'>[]).map(row => ({
        ...row,
        managerName: row.user_id ? managerMap.get(row.user_id)?.team_name || 'Unknown manager' : 'System',
        playerName: row.player_id ? playerMap.get(row.player_id)?.web_name || `Player #${row.player_id}` : '—',
        actorName: row.actor_user_id ? managerMap.get(row.actor_user_id)?.team_name || 'Commissioner' : 'Server',
      })));
      setDraftStatus(sessionResponse.data?.draft_status || 'NOT_STARTED');
      setCurrentRound(sessionResponse.data?.current_round || 1);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Draft results could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDraftResults();
  }, [loadDraftResults]);

  useEffect(() => {
    if (!activeLeagueId) return;

    const historyChannel = supabase
      .channel(`draft-results-${activeLeagueId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'draft_picks',
          filter: `league_id=eq.${activeLeagueId}`,
        },
        () => {
          void loadDraftResults(false, true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'draft_pick_audit',
          filter: `league_id=eq.${activeLeagueId}`,
        },
        () => {
          void loadDraftResults(false, true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'draft_sessions',
          filter: `league_id=eq.${activeLeagueId}`,
        },
        () => {
          void loadDraftResults(false, true);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(historyChannel);
    };
  }, [activeLeagueId, loadDraftResults]);

  const clubs = useMemo(
    () => Array.from(new Set(picks.map(pick => pick.club))).sort((a, b) => a.localeCompare(b)),
    [picks]
  );

  const roundOptions = useMemo(() => {
    const highestPickedRound = picks.reduce((maximum, pick) => Math.max(maximum, pick.round_number || 1), 1);
    const roundCount = Math.max(highestPickedRound, currentRound, draftStatus === 'COMPLETED' ? 15 : 1);
    return Array.from({ length: Math.min(15, roundCount) }, (_, index) => index + 1);
  }, [currentRound, draftStatus, picks]);

  const filteredPicks = useMemo(
    () => picks.filter(pick =>
      (managerFilter === 'ALL' || pick.user_id === managerFilter) &&
      (roundFilter === 'ALL' || pick.round_number === roundFilter) &&
      (positionFilter === 'ALL' || pick.position === positionFilter) &&
      (clubFilter === 'ALL' || pick.club === clubFilter)
    ),
    [clubFilter, managerFilter, picks, positionFilter, roundFilter]
  );

  const selectedManager = managers.find(manager => manager.user_id === managerFilter);
  const recentPicks = picks.slice(-5).reverse();
  const maximumPicks = managers.length * 15;
  const isComplete = draftStatus === 'COMPLETED';
  const managerSquads = useMemo(() => managers.map(manager => {
    const managerPicks = picks.filter(pick => pick.user_id === manager.user_id);
    const counts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    managerPicks.forEach(pick => { counts[pick.position] += 1; });
    return { ...manager, total: managerPicks.length, counts };
  }), [managers, picks]);

  const clearFilters = () => {
    setManagerFilter('ALL');
    setRoundFilter('ALL');
    setPositionFilter('ALL');
    setClubFilter('ALL');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#00F27A" />
          <Text style={styles.loadingText}>BUILDING DRAFT BOARD</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={19} color="#E7EDF2" />
        </TouchableOpacity>
        <View style={styles.topBarTitleBlock}>
          <Text style={styles.topBarEyebrow}>LEAGUE DRAFT</Text>
          <Text style={styles.topBarTitle}>DRAFT BOARD & HISTORY</Text>
        </View>
        <View style={[styles.statusBadge, isComplete && styles.statusBadgeComplete]}>
          <View style={[styles.statusDot, isComplete && styles.statusDotComplete]} />
          <Text style={[styles.statusBadgeText, isComplete && styles.statusBadgeTextComplete]}>
            {isComplete ? 'COMPLETE' : 'LIVE'}
          </Text>
        </View>
      </View>

      {errorMessage ? (
        <View style={styles.errorState}>
          <Ionicons name="cloud-offline-outline" size={30} color="#FF6B61" />
          <Text style={styles.errorTitle}>DRAFT HISTORY UNAVAILABLE</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadDraftResults()}>
            <Text style={styles.retryButtonText}>TRY AGAIN</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.pageScroll}
          contentContainerStyle={[styles.pageContent, isDesktop && styles.pageContentDesktop]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadDraftResults(true)} tintColor="#00F27A" />
          }
        >
          <View style={[styles.summaryGrid, isDesktop && styles.summaryGridDesktop]}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>PICKS MADE</Text>
              <Text style={styles.summaryValue}>{picks.length}<Text style={styles.summaryMaximum}>/{maximumPicks || 0}</Text></Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>MANAGERS</Text>
              <Text style={styles.summaryValue}>{managers.length}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>CURRENT ROUND</Text>
              <Text style={styles.summaryValue}>{isComplete ? 15 : currentRound}</Text>
            </View>
          </View>

          {recentPicks.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionEyebrow}>LATEST ACTIVITY</Text>
                <Text style={styles.sectionMeta}>Last {recentPicks.length} picks</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentPickList}>
                {recentPicks.map(pick => (
                  <View key={`recent-${pick.id}`} style={styles.recentPickCard}>
                    <View style={styles.recentPickTopRow}>
                      <Text style={styles.recentPickNumber}>#{pick.overall_pick_number}</Text>
                      <PositionBadge position={pick.position} />
                    </View>
                    <Text style={styles.recentPickPlayer} numberOfLines={1}>{pick.playerName}</Text>
                    <Text style={styles.recentPickManager} numberOfLines={1}>{pick.managerName}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {managerSquads.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionEyebrow}>MANAGER SQUADS</Text>
                  <Text style={styles.sectionTitle}>{isComplete ? 'Completed roster summaries' : 'Roster progress'}</Text>
                </View>
                <Text style={styles.sectionMeta}>2 · 5 · 5 · 3</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.squadSummaryList}>
                {managerSquads.map(manager => (
                  <View key={`squad-${manager.user_id}`} style={styles.squadSummaryCard}>
                    <View style={styles.squadSummaryHeader}>
                      <Text style={styles.squadSummaryName} numberOfLines={1}>{manager.team_name}</Text>
                      <Text style={[styles.squadSummaryTotal, manager.total === 15 && styles.squadSummaryTotalComplete]}>
                        {manager.total}/15
                      </Text>
                    </View>
                    <View style={styles.squadPositionRow}>
                      {(['GKP', 'DEF', 'MID', 'FWD'] as const).map(position => (
                        <View key={`${manager.user_id}-${position}`} style={styles.squadPositionChip}>
                          <Text style={styles.squadPositionLabel}>{position}</Text>
                          <Text style={styles.squadPositionCount}>{manager.counts[position]}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={styles.viewSwitch}>
            {(['BOARD', 'LIST', ...(isCommissioner ? ['AUDIT'] : [])] as HistoryView[]).map(view => (
              <TouchableOpacity
                key={view}
                style={[styles.viewSwitchButton, activeView === view && styles.viewSwitchButtonActive]}
                onPress={() => setActiveView(view)}
              >
                <Ionicons
                  name={view === 'BOARD' ? 'grid-outline' : view === 'AUDIT' ? 'shield-checkmark-outline' : 'list-outline'}
                  size={15}
                  color={activeView === view ? '#00150B' : '#81909C'}
                />
                <Text style={[styles.viewSwitchText, activeView === view && styles.viewSwitchTextActive]}>
                  {view === 'BOARD' ? 'DRAFT BOARD' : view === 'AUDIT' ? 'AUDIT' : 'PICK HISTORY'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {activeView === 'BOARD' ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionEyebrow}>MANAGER BY ROUND</Text>
                  <Text style={styles.sectionTitle}>Full Draft Board</Text>
                </View>
                <Text style={styles.sectionMeta}>Swipe horizontally</Text>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.boardScrollContent}>
                <View style={styles.boardTable}>
                  <View style={styles.boardRow}>
                    <View style={[styles.boardRoundCell, styles.boardHeaderCell]}>
                      <Text style={styles.boardHeaderText}>ROUND</Text>
                    </View>
                    {managers.map(manager => (
                      <View key={`header-${manager.user_id}`} style={[styles.boardPickCell, styles.boardHeaderCell]}>
                        <Text style={styles.boardManagerOrder}>#{manager.draft_order ?? '–'}</Text>
                        <Text style={styles.boardManagerName} numberOfLines={2}>{manager.team_name}</Text>
                      </View>
                    ))}
                  </View>

                  {roundOptions.map(round => (
                    <View key={`round-${round}`} style={styles.boardRow}>
                      <View style={styles.boardRoundCell}>
                        <Text style={styles.boardRoundLabel}>R{round}</Text>
                      </View>
                      {managers.map(manager => {
                        const pick = picks.find(item => item.round_number === round && item.user_id === manager.user_id);
                        return (
                          <View key={`${round}-${manager.user_id}`} style={[styles.boardPickCell, pick && styles.boardPickCellFilled]}>
                            {pick ? (
                              <>
                                <View style={styles.boardPickMeta}>
                                  <Text style={styles.boardOverallPick}>#{pick.overall_pick_number}</Text>
                                  <PositionBadge position={pick.position} />
                                </View>
                                <Text style={styles.boardPlayerName} numberOfLines={1}>{pick.playerName}</Text>
                                <Text style={styles.boardClubName} numberOfLines={1}>{pick.club}</Text>
                                {pick.pick_source !== 'MANUAL' && <Text style={styles.boardAutoLabel}>AUTO</Text>}
                              </>
                            ) : (
                              <Text style={styles.boardEmptyText}>—</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : activeView === 'LIST' ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionEyebrow}>CHRONOLOGICAL PICKS</Text>
                  <Text style={styles.sectionTitle}>
                    {selectedManager ? `${selectedManager.team_name} History` : 'Complete Pick History'}
                  </Text>
                </View>
                <TouchableOpacity style={styles.clearFilterButton} onPress={clearFilters}>
                  <Ionicons name="refresh" size={13} color="#81909C" />
                  <Text style={styles.clearFilterText}>RESET</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.filterLabel}>MANAGER</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                <TouchableOpacity
                  style={[styles.filterChip, managerFilter === 'ALL' && styles.filterChipActive]}
                  onPress={() => setManagerFilter('ALL')}
                >
                  <Text style={[styles.filterChipText, managerFilter === 'ALL' && styles.filterChipTextActive]}>ALL</Text>
                </TouchableOpacity>
                {managers.map(manager => (
                  <TouchableOpacity
                    key={`manager-filter-${manager.user_id}`}
                    style={[styles.filterChip, managerFilter === manager.user_id && styles.filterChipActive]}
                    onPress={() => setManagerFilter(manager.user_id)}
                  >
                    <Text style={[styles.filterChipText, managerFilter === manager.user_id && styles.filterChipTextActive]} numberOfLines={1}>
                      {manager.team_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.compactFilterBlock}>
                <View style={styles.compactFilterColumn}>
                  <Text style={styles.filterLabel}>ROUND</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                    <TouchableOpacity
                      style={[styles.filterChip, roundFilter === 'ALL' && styles.filterChipActive]}
                      onPress={() => setRoundFilter('ALL')}
                    >
                      <Text style={[styles.filterChipText, roundFilter === 'ALL' && styles.filterChipTextActive]}>ALL</Text>
                    </TouchableOpacity>
                    {roundOptions.map(round => (
                      <TouchableOpacity
                        key={`round-filter-${round}`}
                        style={[styles.filterChip, roundFilter === round && styles.filterChipActive]}
                        onPress={() => setRoundFilter(round)}
                      >
                        <Text style={[styles.filterChipText, roundFilter === round && styles.filterChipTextActive]}>{round}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <View style={styles.compactFilterColumn}>
                  <Text style={styles.filterLabel}>POSITION</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                    {(['ALL', 'GKP', 'DEF', 'MID', 'FWD'] as PositionFilter[]).map(position => (
                      <TouchableOpacity
                        key={`position-filter-${position}`}
                        style={[styles.filterChip, positionFilter === position && styles.filterChipActive]}
                        onPress={() => setPositionFilter(position)}
                      >
                        <Text style={[styles.filterChipText, positionFilter === position && styles.filterChipTextActive]}>{position}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>

              <TouchableOpacity style={styles.clubFilterButton} onPress={() => setClubPickerVisible(true)}>
                <View>
                  <Text style={styles.filterLabel}>CLUB</Text>
                  <Text style={styles.clubFilterValue}>{clubFilter === 'ALL' ? 'All clubs' : clubFilter}</Text>
                </View>
                <Ionicons name="chevron-down" size={16} color="#81909C" />
              </TouchableOpacity>

              <View style={styles.resultCountRow}>
                <Text style={styles.resultCountText}>{filteredPicks.length} PICKS</Text>
                {selectedManager && (
                  <Text style={styles.resultCountMeta}>
                    {filteredPicks.filter(pick => pick.pick_source !== 'MANUAL').length} automatic
                  </Text>
                )}
              </View>

              <View style={styles.historyList}>
                {filteredPicks.length > 0 ? filteredPicks.map(pick => {
                  const reasonLabel = getPickReasonLabel(pick.pick_reason);
                  return (
                    <View key={`history-${pick.id}`} style={[styles.historyRow, isDesktop && styles.historyRowDesktop]}>
                      <View style={styles.historyPickNumberBlock}>
                        <Text style={styles.historyPickNumber}>#{pick.overall_pick_number}</Text>
                        <Text style={styles.historyRound}>R{pick.round_number}</Text>
                      </View>
                      <View style={styles.historyPlayerBlock}>
                        <Text style={styles.historyPlayerName} numberOfLines={1}>{pick.playerName}</Text>
                        <Text style={styles.historyClub} numberOfLines={1}>{pick.club}</Text>
                      </View>
                      <PositionBadge position={pick.position} />
                      <View style={styles.historyManagerBlock}>
                        <Text style={styles.historyManagerName} numberOfLines={1}>{pick.managerName}</Text>
                        <Text style={[styles.historySource, pick.pick_source !== 'MANUAL' && styles.historySourceAuto]} numberOfLines={1}>
                          {getPickSourceLabel(pick.pick_source)}{reasonLabel ? ` · ${reasonLabel}` : ''}
                        </Text>
                      </View>
                    </View>
                  );
                }) : (
                  <View style={styles.emptyState}>
                    <Ionicons name="filter-outline" size={25} color="#536473" />
                    <Text style={styles.emptyStateTitle}>NO MATCHING PICKS</Text>
                    <Text style={styles.emptyStateText}>Change or reset the filters to see more of the draft.</Text>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionEyebrow}>COMMISSIONER AUDIT</Text>
                  <Text style={styles.sectionTitle}>Draft actions & corrections</Text>
                </View>
                <Text style={styles.sectionMeta}>{auditRows.length} events</Text>
              </View>
              <View style={styles.auditList}>
                {auditRows.map(row => (
                  <View key={`audit-${row.id}`} style={styles.auditRow}>
                    <View style={styles.auditIcon}>
                      <Ionicons
                        name={row.event_type === 'PICK_CREATED' ? 'checkmark' : row.event_type.includes('UNDO') || row.event_type.includes('RESTART') ? 'arrow-undo' : 'shield-checkmark'}
                        size={14}
                        color={row.event_type === 'PICK_CREATED' ? '#00F27A' : '#FFB340'}
                      />
                    </View>
                    <View style={styles.auditCopy}>
                      <Text style={styles.auditTitle}>{getAuditLabel(row.event_type)}</Text>
                      <Text style={styles.auditDetail} numberOfLines={2}>
                        {row.overall_pick_number ? `Pick #${row.overall_pick_number} · ` : ''}{row.managerName}{row.player_id ? ` · ${row.playerName}` : ''}
                      </Text>
                      <Text style={styles.auditActor}>By {row.actorName} · {new Date(row.created_at).toLocaleString()}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}

      <Modal visible={clubPickerVisible} transparent animationType="fade" onRequestClose={() => setClubPickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.clubPickerCard}>
            <View style={styles.clubPickerHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>FILTER PICKS</Text>
                <Text style={styles.clubPickerTitle}>Choose a club</Text>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setClubPickerVisible(false)}>
                <Ionicons name="close" size={18} color="#A5B1BA" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.clubPickerList}>
              {['ALL', ...clubs].map(club => (
                <TouchableOpacity
                  key={`club-${club}`}
                  style={[styles.clubPickerOption, clubFilter === club && styles.clubPickerOptionActive]}
                  onPress={() => {
                    setClubFilter(club);
                    setClubPickerVisible(false);
                  }}
                >
                  <Text style={[styles.clubPickerOptionText, clubFilter === club && styles.clubPickerOptionTextActive]}>
                    {club === 'ALL' ? 'All clubs' : club}
                  </Text>
                  {clubFilter === club && <Ionicons name="checkmark" size={17} color="#00F27A" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const remapDraftResultTheme = (value: unknown, colors: AppColors): any => {
  const colorMap: Record<string, string> = {
    '#050A0F': colors.background,
    '#081018': colors.backgroundDeep,
    '#08111A': colors.backgroundElevated,
    '#09131B': colors.backgroundElevated,
    '#0A131B': colors.surface,
    '#0B151E': colors.surface,
    '#0C171F': colors.surfaceRaised,
    '#0E1A23': colors.surfaceRaised,
    '#0F1A23': colors.surfaceMuted,
    '#101B24': colors.surfaceMuted,
    '#101D27': colors.surfaceMuted,
    '#182733': colors.borderSubtle,
    '#1B2A36': colors.border,
    '#1C2B36': colors.border,
    '#20313D': colors.border,
    '#243542': colors.borderStrong,
    '#F5F8FA': colors.textPrimary,
    '#F2F6F8': colors.textPrimary,
    '#F1F5F7': colors.textPrimary,
    '#F0F4F6': colors.textPrimary,
    '#EEF3F6': colors.textPrimary,
    '#EDF2F5': colors.textPrimary,
    '#DDE5EA': colors.textPrimary,
    '#C7D1DA': colors.textSecondary,
    '#81909C': colors.textSecondary,
    '#71818E': colors.textSecondary,
    '#697B88': colors.textSecondary,
    '#687A88': colors.textSecondary,
    '#657786': colors.textSecondary,
    '#647684': colors.textSecondary,
    '#607180': colors.textMuted,
    '#526474': colors.textMuted,
    '#354754': colors.textDisabled,
    '#00F27A': colors.accent,
    '#00150B': colors.black,
  };

  if (typeof value === 'string') return colorMap[value.toUpperCase()] ?? value;
  if (Array.isArray(value)) return value.map(item => remapDraftResultTheme(item, colors));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remapDraftResultTheme(item, colors)])
    );
  }
  return value;
};

const createStyles = (colors: AppColors) => StyleSheet.create(remapDraftResultTheme({
  screen: { flex: 1, backgroundColor: '#050A0F' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#71818E', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginTop: 12 },
  topBar: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#081018',
    borderBottomWidth: 1,
    borderBottomColor: '#182733',
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101B24',
    borderWidth: 1,
    borderColor: '#243542',
    borderRadius: 10,
  },
  topBarTitleBlock: { flex: 1, minWidth: 0, marginHorizontal: 11 },
  topBarEyebrow: { color: '#00F27A', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  topBarTitle: { color: '#F2F6F8', fontSize: 14, fontWeight: '900', letterSpacing: 0.3, marginTop: 2 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#251B0D',
    borderWidth: 1,
    borderColor: '#624719',
    borderRadius: 999,
  },
  statusBadgeComplete: { backgroundColor: '#0D2218', borderColor: '#266344' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFB340', marginRight: 5 },
  statusDotComplete: { backgroundColor: '#00F27A' },
  statusBadgeText: { color: '#FFB340', fontSize: 7, fontWeight: '900', letterSpacing: 0.45 },
  statusBadgeTextComplete: { color: '#73E8AC' },
  pageScroll: { flex: 1 },
  pageContent: { padding: 12, paddingBottom: 30 },
  pageContentDesktop: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 20 },
  summaryGrid: { flexDirection: 'row', gap: 7 },
  summaryGridDesktop: { gap: 10 },
  summaryCard: {
    flex: 1,
    minHeight: 70,
    justifyContent: 'center',
    paddingHorizontal: 11,
    backgroundColor: '#0B151E',
    borderWidth: 1,
    borderColor: '#1B2A36',
    borderRadius: 11,
  },
  summaryLabel: { color: '#657786', fontSize: 7, fontWeight: '900', letterSpacing: 0.55 },
  summaryValue: { color: '#F5F8FA', fontSize: 23, fontWeight: '900', marginTop: 4 },
  summaryMaximum: { color: '#607180', fontSize: 11, fontWeight: '800' },
  section: {
    marginTop: 11,
    padding: 11,
    backgroundColor: '#0A131B',
    borderWidth: 1,
    borderColor: '#182733',
    borderRadius: 12,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  sectionEyebrow: { color: '#00F27A', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  sectionTitle: { color: '#EDF2F5', fontSize: 14, fontWeight: '900', marginTop: 2 },
  sectionMeta: { color: '#647684', fontSize: 8, fontWeight: '800' },
  recentPickList: { gap: 7, paddingRight: 4 },
  recentPickCard: {
    width: 145,
    minHeight: 76,
    padding: 9,
    backgroundColor: '#0E1A23',
    borderWidth: 1,
    borderColor: '#20313D',
    borderRadius: 9,
  },
  recentPickTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recentPickNumber: { color: '#00F27A', fontSize: 10, fontWeight: '900' },
  recentPickPlayer: { color: '#F1F5F7', fontSize: 11, fontWeight: '900', marginTop: 8 },
  recentPickManager: { color: '#687A88', fontSize: 9, fontWeight: '700', marginTop: 2 },
  squadSummaryList: { gap: 7, paddingRight: 4 },
  squadSummaryCard: { width: 210, padding: 10, backgroundColor: '#0E1A23', borderWidth: 1, borderColor: '#20313D', borderRadius: 9 },
  squadSummaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  squadSummaryName: { flex: 1, color: '#EEF3F6', fontSize: 10, fontWeight: '900' },
  squadSummaryTotal: { color: '#FFB340', fontSize: 9, fontWeight: '900' },
  squadSummaryTotalComplete: { color: '#00F27A' },
  squadPositionRow: { flexDirection: 'row', gap: 5, marginTop: 9 },
  squadPositionChip: { flex: 1, alignItems: 'center', paddingVertical: 5, backgroundColor: '#09131B', borderRadius: 6 },
  squadPositionLabel: { color: '#607180', fontSize: 6, fontWeight: '900' },
  squadPositionCount: { color: '#DDE5EA', fontSize: 10, fontWeight: '900', marginTop: 2 },
  viewSwitch: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 11,
    padding: 4,
    backgroundColor: '#08111A',
    borderWidth: 1,
    borderColor: '#1B2A36',
    borderRadius: 11,
  },
  viewSwitchButton: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
  },
  viewSwitchButtonActive: { backgroundColor: '#00F27A' },
  viewSwitchText: { color: '#81909C', fontSize: 9, fontWeight: '900', letterSpacing: 0.35 },
  viewSwitchTextActive: { color: '#00150B' },
  boardScrollContent: { paddingBottom: 5 },
  boardTable: { borderWidth: 1, borderColor: '#1C2B36', borderRadius: 9, overflow: 'hidden' },
  boardRow: { flexDirection: 'row' },
  boardHeaderCell: { backgroundColor: '#101D27' },
  boardRoundCell: {
    width: 58,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#081018',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1C2B36',
  },
  boardHeaderText: { color: '#687987', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
  boardRoundLabel: { color: '#00F27A', fontSize: 12, fontWeight: '900' },
  boardPickCell: {
    width: 142,
    minHeight: 76,
    justifyContent: 'center',
    padding: 8,
    backgroundColor: '#0A131B',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1C2B36',
  },
  boardPickCellFilled: { backgroundColor: '#0C171F' },
  boardManagerOrder: { color: '#00F27A', fontSize: 8, fontWeight: '900' },
  boardManagerName: { color: '#DDE5EA', fontSize: 9, fontWeight: '900', marginTop: 3 },
  boardPickMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  boardOverallPick: { color: '#00F27A', fontSize: 8, fontWeight: '900' },
  boardPlayerName: { color: '#F0F4F6', fontSize: 10, fontWeight: '900', marginTop: 6 },
  boardClubName: { color: '#697B88', fontSize: 8, fontWeight: '700', marginTop: 2 },
  boardAutoLabel: { color: '#FFB340', fontSize: 7, fontWeight: '900', marginTop: 3 },
  boardEmptyText: { color: '#354754', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  positionBadge: {
    minWidth: 34,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderRadius: 5,
  },
  positionBadgeText: { fontSize: 7, fontWeight: '900', letterSpacing: 0.25 },
  clearFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#0F1A23',
    borderWidth: 1,
    borderColor: '#243542',
    borderRadius: 7,
  },
  clearFilterText: { color: '#81909C', fontSize: 7, fontWeight: '900' },
  filterLabel: { color: '#607180', fontSize: 7, fontWeight: '900', letterSpacing: 0.55, marginBottom: 5 },
  filterRow: { gap: 5, paddingRight: 5 },
  filterChip: {
    minHeight: 29,
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: '#0E1922',
    borderWidth: 1,
    borderColor: '#22333F',
    borderRadius: 999,
  },
  filterChipActive: { backgroundColor: '#0C2A1C', borderColor: '#00F27A' },
  filterChipText: { maxWidth: 130, color: '#788895', fontSize: 8, fontWeight: '900' },
  filterChipTextActive: { color: '#00F27A' },
  compactFilterBlock: { marginTop: 10, gap: 10 },
  compactFilterColumn: { minWidth: 0 },
  clubFilterButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: 11,
    backgroundColor: '#0E1922',
    borderWidth: 1,
    borderColor: '#22333F',
    borderRadius: 8,
  },
  clubFilterValue: { color: '#E0E7EB', fontSize: 10, fontWeight: '800' },
  resultCountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 6 },
  resultCountText: { color: '#00F27A', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  resultCountMeta: { color: '#71818E', fontSize: 8, fontWeight: '800' },
  historyList: { gap: 5 },
  historyRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 8,
    backgroundColor: '#0C171F',
    borderWidth: 1,
    borderColor: '#1C2B36',
    borderRadius: 8,
  },
  historyRowDesktop: { minHeight: 54 },
  historyPickNumberBlock: { width: 38, alignItems: 'center' },
  historyPickNumber: { color: '#00F27A', fontSize: 10, fontWeight: '900' },
  historyRound: { color: '#586B79', fontSize: 7, fontWeight: '900', marginTop: 2 },
  historyPlayerBlock: { flex: 1, minWidth: 0, marginHorizontal: 7 },
  historyPlayerName: { color: '#F0F4F6', fontSize: 11, fontWeight: '900' },
  historyClub: { color: '#657684', fontSize: 8, fontWeight: '700', marginTop: 2 },
  historyManagerBlock: { flex: 1, minWidth: 0, alignItems: 'flex-end', marginLeft: 7 },
  historyManagerName: { color: '#C9D2D8', fontSize: 9, fontWeight: '800' },
  historySource: { color: '#657684', fontSize: 7, fontWeight: '900', marginTop: 3 },
  historySourceAuto: { color: '#FFB340' },
  auditList: { gap: 6 },
  auditRow: { flexDirection: 'row', alignItems: 'center', padding: 9, backgroundColor: '#0C171F', borderWidth: 1, borderColor: '#1C2B36', borderRadius: 8 },
  auditIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111F29', borderRadius: 8 },
  auditCopy: { flex: 1, minWidth: 0, marginLeft: 9 },
  auditTitle: { color: '#E9EFF3', fontSize: 10, fontWeight: '900' },
  auditDetail: { color: '#8B9AA6', fontSize: 8, fontWeight: '800', marginTop: 2 },
  auditActor: { color: '#556976', fontSize: 7, fontWeight: '700', marginTop: 3 },
  emptyState: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 20 },
  emptyStateTitle: { color: '#B5C0C7', fontSize: 10, fontWeight: '900', marginTop: 9 },
  emptyStateText: { color: '#607180', fontSize: 9, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  errorTitle: { color: '#F0F4F6', fontSize: 13, fontWeight: '900', marginTop: 12 },
  errorText: { color: '#788895', fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  retryButton: { marginTop: 15, paddingVertical: 10, paddingHorizontal: 18, backgroundColor: '#00F27A', borderRadius: 8 },
  retryButtonText: { color: '#00150B', fontSize: 9, fontWeight: '900' },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.72)' },
  clubPickerCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '76%',
    padding: 13,
    backgroundColor: '#0B151E',
    borderWidth: 1,
    borderColor: '#263A48',
    borderRadius: 13,
  },
  clubPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  clubPickerTitle: { color: '#F0F4F6', fontSize: 14, fontWeight: '900', marginTop: 2 },
  modalCloseButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111E28', borderRadius: 8 },
  clubPickerList: { flexGrow: 0 },
  clubPickerOption: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#182733',
  },
  clubPickerOptionActive: { backgroundColor: '#0D251A' },
  clubPickerOptionText: { color: '#A8B4BC', fontSize: 10, fontWeight: '800' },
  clubPickerOptionTextActive: { color: '#00F27A' },
}, colors));
