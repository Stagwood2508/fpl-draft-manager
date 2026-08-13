import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  FlatList, 
  TouchableOpacity, 
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  RefreshControl,
  Platform,
  useWindowDimensions
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import PlayerCardModal from '@/components/PlayerCardModal';
import TradeDeskModal from '@/features/market/components/TradeDeskModal';
import FreeAgentClaimModal from '@/components/FreeAgentClaimModal';
import { AppColors } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

interface PlayerAsset {
  id: number;
  code?: number;
  web_name: string;
  first_name: string;
  second_name: string;
  team_name: string;
  team_short_name?: string;
  element_type: string;
  total_points: number;
  current_stats: PlayerStatLine;
  last_season_stats: PlayerStatLine | null;
}

interface PlayerStatLine {
  total_points: number;
  minutes: number;
  starts: number;
  appearances: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  saves: number;
  penalties_saved: number;
  bonus: number;
  defensive_contribution: number;
  ict_index: number;
  expected_goals: number;
  expected_assists: number;
  expected_goal_involvements: number;
  recent_form: number;
}

type StatsPeriod = 'CURRENT' | 'LAST_SEASON';
type OwnershipFilter = 'ALL' | 'AVAILABLE' | 'MINE' | 'OTHERS';
type SortKey =
  | 'TOTAL_POINTS' | 'FORM' | 'POINTS_PER_START' | 'MINUTES' | 'STARTS'
  | 'GOALS' | 'ASSISTS' | 'GOAL_INVOLVEMENTS' | 'CLEAN_SHEETS'
  | 'SAVES' | 'PENALTIES_SAVED' | 'BONUS' | 'DEFCON' | 'ICT'
  | 'EXPECTED_GOALS' | 'EXPECTED_ASSISTS' | 'EXPECTED_INVOLVEMENTS';

interface SortOption {
  key: SortKey;
  label: string;
  shortLabel: string;
  positions?: string[];
  currentOnly?: boolean;
  decimals?: number;
}

const SORT_OPTIONS: SortOption[] = [
  { key: 'TOTAL_POINTS', label: 'Total points', shortLabel: 'PTS' },
  { key: 'FORM', label: 'Recent form (last 5)', shortLabel: 'FORM', currentOnly: true, decimals: 1 },
  { key: 'POINTS_PER_START', label: 'Points per start', shortLabel: 'PTS/ST', decimals: 1 },
  { key: 'MINUTES', label: 'Minutes played', shortLabel: 'MINS' },
  { key: 'STARTS', label: 'Starts', shortLabel: 'STARTS' },
  { key: 'GOALS', label: 'Goals', shortLabel: 'GOALS', positions: ['DEF', 'MID', 'FWD'] },
  { key: 'ASSISTS', label: 'Assists', shortLabel: 'AST', positions: ['DEF', 'MID', 'FWD'] },
  { key: 'GOAL_INVOLVEMENTS', label: 'Goal involvements', shortLabel: 'G+A', positions: ['DEF', 'MID', 'FWD'] },
  { key: 'CLEAN_SHEETS', label: 'Clean sheets', shortLabel: 'CS', positions: ['GKP', 'DEF'] },
  { key: 'SAVES', label: 'Saves', shortLabel: 'SAVES', positions: ['GKP'] },
  { key: 'PENALTIES_SAVED', label: 'Penalties saved', shortLabel: 'PENS', positions: ['GKP'] },
  { key: 'BONUS', label: 'Bonus points', shortLabel: 'BONUS' },
  { key: 'DEFCON', label: 'Defensive contributions', shortLabel: 'DEFCON', positions: ['DEF', 'MID', 'FWD'] },
  { key: 'ICT', label: 'ICT Index', shortLabel: 'ICT', decimals: 1 },
  { key: 'EXPECTED_GOALS', label: 'Expected goals', shortLabel: 'xG', decimals: 2 },
  { key: 'EXPECTED_ASSISTS', label: 'Expected assists', shortLabel: 'xA', decimals: 2 },
  { key: 'EXPECTED_INVOLVEMENTS', label: 'Expected goal involvements', shortLabel: 'xGI', decimals: 2 },
];

const EMPTY_STAT_LINE: PlayerStatLine = {
  total_points: 0, minutes: 0, starts: 0, appearances: 0, goals_scored: 0,
  assists: 0, clean_sheets: 0, saves: 0, penalties_saved: 0, bonus: 0,
  defensive_contribution: 0, ict_index: 0, expected_goals: 0,
  expected_assists: 0, expected_goal_involvements: 0, recent_form: 0,
};

const numeric = (value: unknown) => Number(value || 0);

const toStatLine = (row: any, fallbackTotal = 0): PlayerStatLine => ({
  total_points: row ? numeric(row.total_points) : fallbackTotal,
  minutes: numeric(row?.minutes),
  starts: numeric(row?.starts),
  appearances: numeric(row?.appearances ?? row?.starts),
  goals_scored: numeric(row?.goals_scored),
  assists: numeric(row?.assists),
  clean_sheets: numeric(row?.clean_sheets),
  saves: numeric(row?.saves),
  penalties_saved: numeric(row?.penalties_saved),
  bonus: numeric(row?.bonus),
  defensive_contribution: numeric(row?.defensive_contribution),
  ict_index: numeric(row?.ict_index),
  expected_goals: numeric(row?.expected_goals),
  expected_assists: numeric(row?.expected_assists),
  expected_goal_involvements: numeric(row?.expected_goal_involvements),
  recent_form: numeric(row?.recent_form),
});

const getPreviousSeasonLabel = () => {
  const now = new Date();
  const currentSeasonStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const previousStart = currentSeasonStart - 1;
  return `${previousStart}/${String(previousStart + 1).slice(-2)}`;
};

const getManagerInitials = (firstName?: string | null, lastName?: string | null, displayName?: string | null) => {
  const firstInitial = firstName?.trim().charAt(0) || '';
  const lastInitial = lastName?.trim().charAt(0) || '';
  if (firstInitial || lastInitial) return `${firstInitial}${lastInitial}`.toUpperCase();

  const nameParts = (displayName || '').trim().split(/\s+/).filter(Boolean);
  if (nameParts.length >= 2) return `${nameParts[0].charAt(0)}${nameParts[nameParts.length - 1].charAt(0)}`.toUpperCase();
  if (nameParts.length === 1) return nameParts[0].slice(0, 2).toUpperCase();
  return 'M';
};

const getMetricValue = (player: PlayerAsset, period: StatsPeriod, key: SortKey) => {
  const stats = period === 'CURRENT' ? player.current_stats : (player.last_season_stats || EMPTY_STAT_LINE);
  switch (key) {
    case 'FORM': return stats.recent_form;
    case 'POINTS_PER_START': return stats.total_points / Math.max(stats.starts || stats.appearances, 1);
    case 'MINUTES': return stats.minutes;
    case 'STARTS': return stats.starts;
    case 'GOALS': return stats.goals_scored;
    case 'ASSISTS': return stats.assists;
    case 'GOAL_INVOLVEMENTS': return stats.goals_scored + stats.assists;
    case 'CLEAN_SHEETS': return stats.clean_sheets;
    case 'SAVES': return stats.saves;
    case 'PENALTIES_SAVED': return stats.penalties_saved;
    case 'BONUS': return stats.bonus;
    case 'DEFCON': return stats.defensive_contribution;
    case 'ICT': return stats.ict_index;
    case 'EXPECTED_GOALS': return stats.expected_goals;
    case 'EXPECTED_ASSISTS': return stats.expected_assists;
    case 'EXPECTED_INVOLVEMENTS': return stats.expected_goal_involvements;
    default: return stats.total_points;
  }
};

interface OwnershipInfo {
  userId: string;
  display_name: string;
  short_initials?: string;
}

const POSITION_COLORS: Record<string, string> = {
  GKP: '#FFC107',
  DEF: '#00A2FF',
  MID: '#00FF87',
  FWD: '#FF0055',
};

export default function PlayerPoolScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const isMobileLayout = width < 700;
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentGameweek, setCurrentGameweek] = useState<number>(1);
  
  // Market Window State: 'WAIVERS_OPEN' | 'FREE_AGENCY' | 'IN_PLAY'
  const [marketStatus, setMarketStatus] = useState<'WAIVERS_OPEN' | 'FREE_AGENCY' | 'IN_PLAY'>('WAIVERS_OPEN');

  const [allPlayers, setAllPlayers] = useState<PlayerAsset[]>([]);
  const [watchlistIds, setWatchlistIds] = useState<Set<number>>(new Set()); 
  const [ownershipMap, setOwnershipMap] = useState<Record<number, OwnershipInfo>>({});
  const [waiverLockedPlayerIds, setWaiverLockedPlayerIds] = useState<Set<number>>(new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<string>('ALL');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>('CURRENT');
  const [sortKey, setSortKey] = useState<SortKey>('TOTAL_POINTS');
  const [selectedClub, setSelectedClub] = useState('ALL');
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('ALL');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [minimumMinutes, setMinimumMinutes] = useState(0);

  const [selectedModalPlayerId, setSelectedModalPlayerId] = useState<number | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  // Waiver Queue Modal State
  const [isWaiverModalVisible, setIsWaiverModalVisible] = useState(false);
  const [selectedPoolPlayer, setSelectedPoolPlayer] = useState<PlayerAsset | null>(null);
  const [eligibleRosterPlayers, setEligibleRosterPlayers] = useState<any[]>([]);
  const [selectedRosterPlayerId, setSelectedRosterPlayerId] = useState<number | null>(null);
  const [submittingWaiver, setSubmittingWaiver] = useState(false);

  // Free Agent Instant Swap Modal State
  const [isFreeAgentModalVisible, setIsFreeAgentModalVisible] = useState(false);
  const [freeAgentTargetPlayer, setFreeAgentTargetPlayer] = useState<PlayerAsset | null>(null);

  // Trade Desk Modal State
  const [isTradeModalVisible, setIsTradeModalVisible] = useState(false);
  const [tradeTargetPlayer, setTradeTargetPlayer] = useState<PlayerAsset | null>(null);
  const [tradeOwnerInfo, setTradeOwnerInfo] = useState<OwnershipInfo | null>(null);

  const positions = ['ALL', 'GKP', 'DEF', 'MID', 'FWD'];

  useEffect(() => {
    if (isFocused) {
      loadScoutEngineContext();
    }
  }, [isFocused]);

  const availableSortOptions = useMemo(() => SORT_OPTIONS.filter(option => {
    if (statsPeriod === 'LAST_SEASON' && option.currentOnly) return false;
    return selectedPosition === 'ALL' || !option.positions || option.positions.includes(selectedPosition);
  }), [selectedPosition, statsPeriod]);

  useEffect(() => {
    if (!availableSortOptions.some(option => option.key === sortKey)) setSortKey('TOTAL_POINTS');
  }, [availableSortOptions, sortKey]);

  const clubs = useMemo(() => Array.from(new Set(allPlayers.map(player => player.team_name).filter(Boolean))).sort(), [allPlayers]);
  const selectedSort = SORT_OPTIONS.find(option => option.key === sortKey) || SORT_OPTIONS[0];
  const activeFilterCount = (statsPeriod === 'LAST_SEASON' ? 1 : 0) + (selectedClub !== 'ALL' ? 1 : 0) +
    (ownershipFilter !== 'ALL' ? 1 : 0) + (watchlistOnly ? 1 : 0) + (minimumMinutes > 0 ? 1 : 0);

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return allPlayers
      .filter(player => selectedPosition === 'ALL' || player.element_type === selectedPosition)
      .filter(player => selectedClub === 'ALL' || player.team_name === selectedClub)
      .filter(player => !normalizedQuery || `${player.web_name} ${player.first_name} ${player.second_name} ${player.team_name}`.toLowerCase().includes(normalizedQuery))
      .filter(player => !watchlistOnly || watchlistIds.has(player.id))
      .filter(player => {
        const owner = ownershipMap[player.id];
        if (ownershipFilter === 'AVAILABLE') return !owner;
        if (ownershipFilter === 'MINE') return owner?.userId === currentUserId;
        if (ownershipFilter === 'OTHERS') return Boolean(owner && owner.userId !== currentUserId);
        return true;
      })
      .filter(player => {
        const stats = statsPeriod === 'CURRENT' ? player.current_stats : player.last_season_stats;
        return minimumMinutes === 0 || Boolean(stats && stats.minutes >= minimumMinutes);
      })
      .sort((a, b) => getMetricValue(b, statsPeriod, sortKey) - getMetricValue(a, statsPeriod, sortKey) || a.web_name.localeCompare(b.web_name));
  }, [allPlayers, selectedPosition, selectedClub, searchQuery, watchlistOnly, watchlistIds, ownershipMap, ownershipFilter, currentUserId, minimumMinutes, statsPeriod, sortKey]);

  const loadScoutEngineContext = async () => {
    try {
      setLoading(true);
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error('User authentication token invalid.');
      setCurrentUserId(user.id);

      // 1. Read Active League ID from AsyncStorage
      let currentLeagueId = await AsyncStorage.getItem('active_league_id');

      if (!currentLeagueId) {
        const { data: memberData, error: memberErr } = await supabase
          .from('league_members')
          .select('league_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        if (!memberErr && memberData?.league_id) {
          const membershipLeagueId = memberData.league_id;
          currentLeagueId = membershipLeagueId;
          await AsyncStorage.setItem('active_league_id', membershipLeagueId);
        }
      }

      setActiveLeagueId(currentLeagueId);

      // 2. Fetch Market Window Status & Active Gameweek
      let resolvedGameweek = 1;
      if (currentLeagueId) {
        const { data: waiverWindow } = await supabase.rpc('get_my_waiver_status', {
          p_league_id: currentLeagueId,
        });

        if (waiverWindow?.success && waiverWindow.gameweek) {
          resolvedGameweek = waiverWindow.gameweek;
          setCurrentGameweek(waiverWindow.gameweek);
          setMarketStatus(waiverWindow.market_status as any);
        }
      }

      // Query the compact pool, its current aggregates, and durable previous-season figures together.
      const [playersResponse, currentStatsResponse, previousStatsResponse] = await Promise.all([
        supabase
          .from('players')
          .select('id, code, web_name, first_name, second_name, team_name, team_short_name, element_type, total_points')
          .eq('is_active', true)
          .order('total_points', { ascending: false }),
        supabase.rpc('get_player_pool_current_stats', { p_through_gameweek: resolvedGameweek }),
        supabase
          .from('player_season_stats')
          .select('current_player_id, player_code, total_points, minutes, starts, goals_scored, assists, clean_sheets, saves, penalties_saved, bonus, defensive_contribution, ict_index, expected_goals, expected_assists, expected_goal_involvements')
          .eq('season_name', getPreviousSeasonLabel()),
      ]);

      if (playersResponse.error) throw playersResponse.error;
      const playersData = playersResponse.data || [];
      if (currentStatsResponse.error) {
        console.warn('Current player-pool aggregates unavailable; using total-points fallback:', currentStatsResponse.error.message);
      }
      if (previousStatsResponse.error) {
        console.warn('Previous-season player-pool figures unavailable:', previousStatsResponse.error.message);
      }

      const currentStatsById = new Map<number, any>((currentStatsResponse.data || []).map((row: any) => [Number(row.player_id), row]));
      const previousStatsByCode = new Map<number, any>((previousStatsResponse.data || []).map((row: any) => [Number(row.player_code), row]));

      let overridesMap: Record<number, string> = {};
      if (currentLeagueId) {
        const { data: overridesData } = await supabase
          .from('league_player_overrides')
          .select('player_id, custom_position')
          .eq('league_id', currentLeagueId);

        if (overridesData) {
          overridesData.forEach(o => { overridesMap[o.player_id] = o.custom_position; });
        }
      }

      const finalizedPool: PlayerAsset[] = (playersData || []).map(player => ({
        ...player,
        element_type: overridesMap[player.id] || player.element_type,
        // Current-season figures must only come from current Gameweek rows. The
        // Draft bootstrap total can retain the previous season before rollover.
        current_stats: toStatLine(currentStatsById.get(Number(player.id)), 0),
        last_season_stats: previousStatsByCode.has(Number(player.code))
          ? toStatLine(previousStatsByCode.get(Number(player.code)))
          : null,
      }));

      let owners: Record<number, OwnershipInfo> = {};
      if (currentLeagueId) {
        const { data: rosterOwners, error: rosterOwnersErr } = await supabase
          .from('rosters')
          .select('player_id, user_id')
          .eq('league_id', currentLeagueId);

        if (!rosterOwnersErr && rosterOwners) {
          rosterOwners.forEach((r: any) => {
            owners[Number(r.player_id)] = {
              userId: r.user_id,
              display_name: `Manager ${r.user_id.slice(0, 5).toUpperCase()}`,
              short_initials: 'M'
            };
          });

          // Fetch member names from league_members first, then fall back to profiles
          const { data: membersData } = await supabase
            .from('league_members')
            .select('user_id, team_name')
            .eq('league_id', currentLeagueId);

          if (membersData) {
            const memberMap: Record<string, string> = {};
            membersData.forEach((m: any) => {
              if (m.team_name) memberMap[m.user_id] = m.team_name;
            });

            Object.keys(owners).forEach((key: any) => {
              const ownerUserId = owners[key].userId;
              if (memberMap[ownerUserId]) {
                const name = memberMap[ownerUserId];
                owners[key].display_name = name;
              }
            });
          }

          const { data: profilesData } = await supabase.from('profiles').select('id, display_name, first_name, last_name');
          if (profilesData) {
            const profileMap: Record<string, { full: string; short: string }> = {};
            profilesData.forEach((p: any) => {
              profileMap[p.id] = {
                full: p.display_name || `Manager ${p.id.slice(0, 4)}`,
                short: getManagerInitials(p.first_name, p.last_name, p.display_name),
              };
            });

            Object.keys(owners).forEach((key: any) => {
              const ownerUserId = owners[key].userId;
              if (profileMap[ownerUserId]) {
                // Keep the team name as the longer ownership/trade label, but
                // always use the manager's own initials in the compact badge.
                owners[key].short_initials = profileMap[ownerUserId].short;
                if (owners[key].display_name.startsWith('Manager')) {
                  owners[key].display_name = profileMap[ownerUserId].full;
                }
              }
            });
          }
        }
      }
      setOwnershipMap(owners);

      if (currentLeagueId) {
        const { data: watchlistData } = await supabase.from('watchlists').select('player_id').eq('user_id', user.id).eq('league_id', currentLeagueId);
        if (watchlistData) setWatchlistIds(new Set<number>(watchlistData.map(w => w.player_id)));

        const { data: lockedPlayers, error: lockError } = await supabase
          .from('waiver_player_locks')
          .select('player_id, available_gameweek')
          .eq('league_id', currentLeagueId)
          .gt('available_gameweek', resolvedGameweek);
        if (!lockError && lockedPlayers) {
          setWaiverLockedPlayerIds(new Set<number>(lockedPlayers.map(row => Number(row.player_id))));
        } else if (lockError?.code !== 'PGRST205' && lockError?.code !== '42P01') {
          console.warn('Unable to load waiver player locks:', lockError?.message);
        }
      }

      setAllPlayers(finalizedPool);
    } catch (err: any) {
      Alert.alert('Scout Engine Load Failure', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Pull to refresh callback
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadScoutEngineContext();
    setRefreshing(false);
  }, []);

  const handleWatchlistToggle = async (playerId: number) => {
    try {
      if (!activeLeagueId) return Alert.alert('Context Missing', 'Cannot update target watchlist outside league space.');
      const isCurrentlySaved = watchlistIds.has(playerId);
      const nextWatchlistState = new Set(watchlistIds);

      if (isCurrentlySaved) {
        await supabase.from('watchlists').delete().eq('user_id', currentUserId).eq('league_id', activeLeagueId).eq('player_id', playerId);
        nextWatchlistState.delete(playerId);
      } else {
        await supabase.from('watchlists').insert({ user_id: currentUserId, league_id: activeLeagueId, player_id: playerId });
        nextWatchlistState.add(playerId);
      }
      setWatchlistIds(nextWatchlistState); 
    } catch (err: any) {
      Alert.alert('Watchlist Transaction Failed', err.message);
    }
  };

  const handlePlusButtonPress = (poolPlayer: PlayerAsset) => {
    if (marketStatus === 'WAIVERS_OPEN') {
      handleOpenWaiverModal(poolPlayer);
    } else if (marketStatus === 'FREE_AGENCY') {
      if (waiverLockedPlayerIds.has(poolPlayer.id)) {
        Alert.alert(
          'Waiver Protected',
          'This player was released through waivers and cannot be signed as a free agent until the next waiver round.'
        );
        return;
      }
      setFreeAgentTargetPlayer(poolPlayer);
      setIsFreeAgentModalVisible(true);
    } else {
      Alert.alert(
        'Market Locked',
        'Transactions are disabled while gameweek fixtures are currently in play.'
      );
    }
  };

  const handleOpenWaiverModal = async (poolPlayer: PlayerAsset) => {
    try {
      setSelectedPoolPlayer(poolPlayer);
      setSelectedRosterPlayerId(null);
      setLoading(true);
      
      const { data: rosterData } = await supabase
        .from('rosters')
        .select('player_id, players(id, first_name, second_name, web_name, element_type, team_name)')
        .eq('user_id', currentUserId)
        .eq('league_id', activeLeagueId);

      const structured = (rosterData || []).map((r: any) => Array.isArray(r.players) ? r.players[0] : r.players).filter(Boolean);
      setEligibleRosterPlayers(structured.filter((p: any) => p.element_type === poolPlayer.element_type));
      setIsWaiverModalVisible(true);
    } catch (err: any) {
      Alert.alert('Roster Query Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitWaiverClaim = async () => {
    if (!selectedPoolPlayer || !selectedRosterPlayerId || !activeLeagueId) return;
    try {
      setSubmittingWaiver(true);
      const { data, error } = await supabase.rpc('submit_waiver_claim', {
        p_league_id: activeLeagueId,
        p_add_player_id: selectedPoolPlayer.id,
        p_drop_player_id: selectedRosterPlayerId,
        p_gameweek: currentGameweek,
      });
      if (error) throw error;
      if (!data?.success) {
        const messages: Record<string, string> = {
          WAIVER_WINDOW_CLOSED: 'The waiver deadline has passed, so this claim was not submitted.',
          WAIVER_WINDOW_NOT_FOUND: 'There is no open waiver window for this Gameweek.',
          TARGET_PLAYER_TAKEN: 'Another manager already owns this player.',
          DROP_PLAYER_NOT_OWNED: 'The player you selected to drop is no longer in your squad.',
          DUPLICATE_PENDING_CLAIM: 'You already have this exact player swap in your waiver queue.',
          POSITION_MISMATCH: 'That swap does not comply with this league’s roster rules.',
          CLAIM_CONFLICT: 'Your waiver queue changed at the same time. Refresh it and try again.',
        };
        throw new Error(messages[data?.error] || 'The server rejected this waiver claim.');
      }

      Alert.alert("Claim Submitted", `Waiver request successfully filed under Priority #${data.priority_order}.`);
      setIsWaiverModalVisible(false);
    } catch (err: any) {
      Alert.alert("Claim Failed", err.message);
    } finally {
      setSubmittingWaiver(false);
    }
  };

  const handleOpenTradeModal = (targetPlayer: PlayerAsset, owner: OwnershipInfo) => {
    setTradeTargetPlayer(targetPlayer);
    setTradeOwnerInfo(owner);
    setIsTradeModalVisible(true);
  };

  const getShortTeamCode = (player: PlayerAsset) => {
    if (player.team_short_name) return player.team_short_name.toUpperCase();
    if (player.team_name) return player.team_name.slice(0, 3).toUpperCase();
    return 'FA';
  };

  const renderPlayerItem = ({ item }: { item: PlayerAsset }) => {
    const isSaved = watchlistIds.has(item.id);
    const owner = ownershipMap[Number(item.id)];
    const isOwnedByMe = owner?.userId === currentUserId;
    const isWaiverLocked = !owner && marketStatus === 'FREE_AGENCY' && waiverLockedPlayerIds.has(item.id);
    const mappedPositionColor = POSITION_COLORS[item.element_type] || '#222';
    const metricValue = getMetricValue(item, statsPeriod, sortKey);
    const metricDisplay = selectedSort.decimals !== undefined ? metricValue.toFixed(selectedSort.decimals) : Math.round(metricValue).toString();

    return (
      <View style={styles.playerRow}>
        <TouchableOpacity style={styles.playerCardMainTrigger} onPress={() => { setSelectedModalPlayerId(item.id); setDetailsVisible(true); }} activeOpacity={0.7}>
          <View style={styles.playerMeta}>
            <View style={styles.playerRowFlow}>
              <Text style={styles.playerName} numberOfLines={1}>{item.web_name}</Text>
              <Text style={styles.playerClubShort}>{getShortTeamCode(item)}</Text>
              <View style={[styles.positionBadgeChip, { backgroundColor: mappedPositionColor }]}>
                <Text style={styles.positionChipText}>{item.element_type}</Text>
              </View>
            </View>
          </View>
          <View style={styles.pointsColumn}>
            <Text style={styles.pointsValueText}>{metricDisplay}</Text>
            <Text style={styles.pointsLabelText}>{selectedSort.shortLabel}</Text>
          </View>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.watchlistBtn, isSaved && styles.watchlistBtnActive]} onPress={() => handleWatchlistToggle(item.id)}>
          <Ionicons name={isSaved ? "star" : "star-outline"} size={14} color={isSaved ? colors.black : colors.accent} />
        </TouchableOpacity>

        {owner ? (
          <TouchableOpacity style={[styles.ownerBadge, isOwnedByMe && styles.myOwnerBadge]} onPress={() => isOwnedByMe ? Alert.alert("Squad Lock", "Already on your team!") : handleOpenTradeModal(item, owner)}>
            <Text style={[styles.ownerBadgeText, isOwnedByMe && styles.myOwnerBadgeText]} numberOfLines={1}>
              {owner.short_initials || owner.display_name}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.waiverClaimAddBtn, isWaiverLocked && { backgroundColor: colors.surfacePressed }]} onPress={() => handlePlusButtonPress(item)}>
            <Ionicons name={isWaiverLocked ? "lock-closed" : "add"} size={isWaiverLocked ? 13 : 16} color={isWaiverLocked ? colors.textSecondary : colors.black} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeContainer} edges={['bottom', 'left', 'right']}>
      {/* Top Search Input */}
      <View style={styles.searchBoxRow}>
        <Ionicons name="search" size={16} color={colors.textMuted} style={{ marginRight: 8 }} />
        <TextInput style={styles.searchInputField} placeholder="Search player name..." placeholderTextColor={colors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />
        <TouchableOpacity style={[styles.filterButton, activeFilterCount > 0 && styles.filterButtonActive]} onPress={() => setFiltersVisible(true)}>
          <Ionicons name="options-outline" size={15} color={activeFilterCount > 0 ? colors.black : colors.accent} />
          <Text style={[styles.filterButtonText, activeFilterCount > 0 && styles.filterButtonTextActive]}>SORT & FILTER</Text>
          {activeFilterCount > 0 && <View style={styles.filterCount}><Text style={styles.filterCountText}>{activeFilterCount}</Text></View>}
        </TouchableOpacity>
      </View>

      {/* Position Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillsScroll} contentContainerStyle={styles.pillsContainerRow}>
        {positions.map(pos => (
          <TouchableOpacity key={pos} style={[styles.pillBtn, selectedPosition === pos && styles.pillBtnActive]} onPress={() => setSelectedPosition(pos)}>
            <Text style={[styles.pillText, selectedPosition === pos && styles.pillTextActive]}>{pos}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Main List with Pull-To-Refresh */}
      {loading && allPlayers.length === 0 ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList 
          data={filteredPlayers} 
          keyExtractor={(item) => item.id.toString()} 
          renderItem={renderPlayerItem} 
          initialNumToRender={15} 
          maxToRenderPerBatch={20} 
          windowSize={10} 
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 5 }} 
          ListEmptyComponent={<Text style={styles.emptyText}>No matching assets found.</Text>}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        />
      )}

      {/* Compact desktop popover / mobile bottom sheet for scouting controls */}
      <Modal visible={filtersVisible} animationType="slide" transparent presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setFiltersVisible(false)}>
        <View style={[styles.filterOverlay, Platform.OS === 'web' && styles.filterOverlayWeb]}>
          <View style={[styles.filterSheet, isMobileLayout && { paddingBottom: Math.max(safeArea.bottom, 8) }]}>
            <View style={styles.filterHeader}>
              <View>
                <Text style={styles.filterEyebrow}>PLAYER POOL</Text>
                <Text style={styles.filterTitle}>Sort & filter</Text>
              </View>
              <TouchableOpacity style={styles.filterClose} onPress={() => setFiltersVisible(false)}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
              <Text style={styles.filterSectionLabel}>Statistics period</Text>
              <View style={styles.segmentRow}>
                {(['CURRENT', 'LAST_SEASON'] as StatsPeriod[]).map(period => (
                  <TouchableOpacity key={period} style={[styles.segmentButton, statsPeriod === period && styles.segmentButtonActive]} onPress={() => setStatsPeriod(period)}>
                    <Text style={[styles.segmentButtonText, statsPeriod === period && styles.segmentButtonTextActive]}>
                      {period === 'CURRENT' ? 'Current season' : `Last season · ${getPreviousSeasonLabel()}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.filterSectionLabel}>Sort by</Text>
              <View style={styles.optionGrid}>
                {availableSortOptions.map(option => (
                  <TouchableOpacity key={option.key} style={[styles.optionButton, sortKey === option.key && styles.optionButtonActive]} onPress={() => setSortKey(option.key)}>
                    <Text style={[styles.optionButtonText, sortKey === option.key && styles.optionButtonTextActive]}>{option.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.filterSectionLabel}>Availability</Text>
              <View style={styles.optionGrid}>
                {([
                  ['ALL', 'All players'], ['AVAILABLE', 'Available'], ['MINE', 'My squad'], ['OTHERS', 'Other squads'],
                ] as [OwnershipFilter, string][]).map(([value, label]) => (
                  <TouchableOpacity key={value} style={[styles.optionButton, ownershipFilter === value && styles.optionButtonActive]} onPress={() => setOwnershipFilter(value)}>
                    <Text style={[styles.optionButtonText, ownershipFilter === value && styles.optionButtonTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={[styles.optionButton, watchlistOnly && styles.optionButtonActive]} onPress={() => setWatchlistOnly(value => !value)}>
                  <Text style={[styles.optionButtonText, watchlistOnly && styles.optionButtonTextActive]}>Watchlist only</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.filterSectionLabel}>Minimum minutes</Text>
              <View style={styles.optionGrid}>
                {[0, 90, 300, 600].map(value => (
                  <TouchableOpacity key={value} style={[styles.smallOptionButton, minimumMinutes === value && styles.optionButtonActive]} onPress={() => setMinimumMinutes(value)}>
                    <Text style={[styles.optionButtonText, minimumMinutes === value && styles.optionButtonTextActive]}>{value === 0 ? 'Any' : `${value}+`}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.filterSectionLabel}>Club</Text>
              <View style={styles.clubGrid}>
                {['ALL', ...clubs].map(club => (
                  <TouchableOpacity key={club} style={[styles.clubButton, selectedClub === club && styles.optionButtonActive]} onPress={() => setSelectedClub(club)}>
                    <Text style={[styles.clubButtonText, selectedClub === club && styles.optionButtonTextActive]} numberOfLines={1}>{club === 'ALL' ? 'All clubs' : club}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={styles.filterFooter}>
              <TouchableOpacity style={styles.resetButton} onPress={() => {
                setStatsPeriod('CURRENT'); setSortKey('TOTAL_POINTS'); setSelectedClub('ALL');
                setOwnershipFilter('ALL'); setWatchlistOnly(false); setMinimumMinutes(0);
              }}>
                <Text style={styles.resetButtonText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyButton} onPress={() => setFiltersVisible(false)}>
                <Text style={styles.applyButtonText}>Show {filteredPlayers.length} players</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Player Details Card Modal */}
      <PlayerCardModal 
        visible={detailsVisible} 
        playerId={selectedModalPlayerId} 
        leagueId={activeLeagueId}
        currentGameweek={currentGameweek}
        onClose={() => { setDetailsVisible(false); setSelectedModalPlayerId(null); }} 
      />

      {/* POSITION-MATCHED WAIVER QUEUE MODAL (WAIVERS_OPEN) */}
      <Modal visible={isWaiverModalVisible} animationType="slide" transparent={true} presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => !submittingWaiver && setIsWaiverModalVisible(false)}>
        <View style={[styles.modalOverlay, isMobileLayout && styles.modalOverlayMobile]}>
          <View style={[styles.modalContent, isMobileLayout && styles.modalContentMobile, isMobileLayout && { paddingTop: Math.max(safeArea.top, 8), paddingBottom: Math.max(safeArea.bottom, 8) }]}>
            <Text style={styles.modalHeader}>Request Waiver Swap</Text>
            {selectedPoolPlayer && (
              <View style={styles.swapVisualContainer}>
                <View style={styles.swapCard}>
                  <Text style={styles.swapLabel}>ADD</Text>
                  <Text style={styles.swapPlayerName}>{selectedPoolPlayer.web_name}</Text>
                  <Text style={styles.swapPlayerMeta}>{selectedPoolPlayer.team_name} • {selectedPoolPlayer.element_type}</Text>
                </View>
                <Text style={styles.swapArrow}>⇄</Text>
                <View style={[styles.swapCard, !selectedRosterPlayerId && styles.swapCardEmpty]}>
                  <Text style={styles.swapLabel}>DROP</Text>
                  {selectedRosterPlayerId ? (
                    (() => {
                      const p = eligibleRosterPlayers.find(x => x.id === selectedRosterPlayerId);
                      return (
                        <>
                          <Text style={[styles.swapPlayerName, { color: colors.danger }]}>{p?.web_name}</Text>
                          <Text style={styles.swapPlayerMeta}>{p?.team_name}</Text>
                        </>
                      );
                    })()
                  ) : (
                    <Text style={styles.emptySwapText}>Select squad member</Text>
                  )}
                </View>
              </View>
            )}

            <Text style={styles.selectionTitle}>Drop player (Filtered by {selectedPoolPlayer?.element_type}):</Text>
            <View style={{ maxHeight: 200 }}>
              <ScrollView style={styles.rosterSelectorList}>
                {eligibleRosterPlayers.length === 0 ? (
                  <Text style={styles.noPlayersText}>No available position assets on roster.</Text>
                ) : (
                  eligibleRosterPlayers.map((player) => {
                    const isSelected = selectedRosterPlayerId === player.id;
                    return (
                      <TouchableOpacity key={player.id} style={[styles.rosterSelectRow, isSelected && styles.rosterSelectRowActive]} onPress={() => setSelectedRosterPlayerId(player.id)}>
                        <Text style={[styles.rosterSelectName, isSelected && styles.rosterSelectNameActive]}>{player.web_name}</Text>
                        <Text style={styles.rosterSelectTeam}>{player.team_name}</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </View>

            <View style={styles.modalActionRow}>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} disabled={submittingWaiver} onPress={() => setIsWaiverModalVisible(false)}>
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonConfirm, !selectedRosterPlayerId && styles.modalButtonDisabled]} disabled={!selectedRosterPlayerId || submittingWaiver} onPress={handleSubmitWaiverClaim}>
                {submittingWaiver ? <ActivityIndicator size="small" color={colors.black} /> : <Text style={styles.modalButtonConfirmText}>Create Claim</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* INSTANT FREE AGENT SWAP MODAL (FREE_AGENCY) */}
      {activeLeagueId && (
        <FreeAgentClaimModal
          visible={isFreeAgentModalVisible}
          leagueId={activeLeagueId}
          currentGameweek={currentGameweek}
          targetPlayer={freeAgentTargetPlayer}
          onClose={() => {
            setIsFreeAgentModalVisible(false);
            setFreeAgentTargetPlayer(null);
          }}
          onSuccess={loadScoutEngineContext}
        />
      )}

      {/* SHARED TRADE DESK MODAL INSTANCE */}
      <TradeDeskModal
        visible={isTradeModalVisible}
        onClose={() => setIsTradeModalVisible(false)}
        targetPlayer={tradeTargetPlayer}
        tradePartner={tradeOwnerInfo}
        leagueId={activeLeagueId}
        currentUserId={currentUserId}
        onSuccess={loadScoutEngineContext}
      />

    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safeContainer: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  searchBoxRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingLeft: 12, paddingRight: 5, marginHorizontal: 16, marginTop: 12, marginBottom: 8, borderRadius: 6, height: 44 },
  searchInputField: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  filterButton: { height: 32, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderRadius: 4, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
  filterButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterButtonText: { color: colors.accent, fontSize: 8, fontWeight: '900', marginLeft: 4 },
  filterButtonTextActive: { color: colors.black },
  filterCount: { minWidth: 16, height: 16, paddingHorizontal: 3, marginLeft: 4, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.black },
  filterCountText: { color: colors.accent, fontSize: 8, fontWeight: '900' },
  pillsScroll: { flexGrow: 0, flexShrink: 0 },
  pillsContainerRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 8 },
  pillBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, marginRight: 6 },
  pillBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' },
  pillTextActive: { color: colors.black, fontWeight: '900' },
  playerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingRight: 8, borderRadius: 4, marginBottom: 4 },
  playerCardMainTrigger: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8 },
  playerMeta: { flex: 1, marginLeft: 2, paddingRight: 4, justifyContent: 'center' },
  playerRowFlow: { flexDirection: 'row', alignItems: 'center' },
  playerName: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', marginRight: 8 },
  playerClubShort: { color: colors.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginRight: 8 },
  positionBadgeChip: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2, justifyContent: 'center', alignItems: 'center' },
  positionChipText: { color: colors.black, fontSize: 8, fontWeight: '900', letterSpacing: 0.1 },
  pointsColumn: { alignItems: 'center', justifyContent: 'center', marginRight: 8, minWidth: 42 },
  pointsValueText: { color: colors.accent, fontSize: 14, fontWeight: '900' },
  pointsLabelText: { color: colors.textDisabled, fontSize: 7, fontWeight: '900', marginTop: -3 },
  watchlistBtn: { padding: 6, backgroundColor: colors.surfaceMuted, borderRadius: 4, borderWidth: 1, borderColor: colors.border, marginRight: 4 },
  watchlistBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  waiverClaimAddBtn: { width: 36, height: 28, backgroundColor: colors.accent, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  ownerBadge: { width: 36, height: 28, backgroundColor: colors.surfacePressed, borderRadius: 4, borderWidth: 1, borderColor: colors.borderStrong, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2 },
  myOwnerBadge: { backgroundColor: '#0052cc33', borderColor: '#0052cc' },
  ownerBadgeText: { color: colors.textSecondary, fontSize: 9, fontWeight: '800', textAlign: 'center' },
  myOwnerBadgeText: { color: '#0052cc', fontWeight: '900' },
  emptyText: { color: colors.textMuted, textAlign: 'center', marginTop: 40, fontWeight: '700', fontSize: 13 },
  filterOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end', alignItems: 'center' },
  filterOverlayWeb: { justifyContent: 'center', padding: 24 },
  filterSheet: { width: '100%', maxWidth: 640, maxHeight: '90%', backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: colors.borderStrong, overflow: 'hidden' },
  filterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  filterEyebrow: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  filterTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', textTransform: 'uppercase', marginTop: 2 },
  filterClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfacePressed },
  filterScrollContent: { padding: 16, paddingBottom: 20 },
  filterSectionLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 12, marginBottom: 7 },
  segmentRow: { flexDirection: 'row', gap: 6 },
  segmentButton: { flex: 1, minHeight: 36, borderRadius: 5, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, backgroundColor: colors.surfaceRaised },
  segmentButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  segmentButtonText: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  segmentButtonTextActive: { color: colors.black, fontWeight: '900' },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optionButton: { width: '48%', minHeight: 34, borderRadius: 5, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 7 },
  smallOptionButton: { minWidth: 62, minHeight: 34, borderRadius: 5, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  optionButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionButtonText: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  optionButtonTextActive: { color: colors.black, fontWeight: '900' },
  clubGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  clubButton: { width: '31%', minHeight: 32, borderRadius: 5, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, justifyContent: 'center', paddingHorizontal: 8 },
  clubButtonText: { color: colors.textSecondary, fontSize: 9, fontWeight: '800' },
  filterFooter: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.backgroundElevated },
  resetButton: { width: 90, height: 40, borderRadius: 5, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  resetButtonText: { color: colors.textSecondary, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  applyButton: { flex: 1, height: 40, borderRadius: 5, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  applyButtonText: { color: colors.black, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalOverlayMobile: { justifyContent: 'flex-start', alignItems: 'stretch' },
  modalContent: { backgroundColor: colors.surface, width: '90%', maxHeight: '80%', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.borderStrong },
  modalContentMobile: { width: '100%', height: '100%', maxHeight: undefined, borderRadius: 0, borderWidth: 0, paddingHorizontal: 10 },
  modalHeader: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center', marginBottom: 4 },
  swapVisualContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.backgroundElevated, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  swapCard: { flex: 1, alignItems: 'center', padding: 10, backgroundColor: colors.surfaceRaised, borderRadius: 6, borderWidth: 1, borderColor: colors.borderStrong, minHeight: 74, justifyContent: 'center' },
  swapCardEmpty: { backgroundColor: colors.surfaceMuted, borderStyle: 'dashed', borderColor: colors.borderStrong },
  swapLabel: { fontSize: 9, fontWeight: '900', color: colors.textMuted, marginBottom: 6 },
  swapPlayerName: { color: colors.accent, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  swapPlayerMeta: { color: colors.textMuted, fontSize: 10, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  emptySwapText: { color: colors.textDisabled, fontSize: 11, fontWeight: '700', textAlign: 'center', paddingHorizontal: 4 },
  swapArrow: { color: colors.textMuted, fontSize: 20, fontWeight: '700', marginHorizontal: 8 },
  selectionTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 },
  rosterSelectorList: { maxHeight: 200, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface, padding: 8 },
  rosterSelectRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 4, marginBottom: 4 },
  rosterSelectRowActive: { backgroundColor: colors.accentSoft, borderBottomColor: 'transparent' },
  rosterSelectName: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  rosterSelectNameActive: { color: colors.accent },
  rosterSelectTeam: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  noPlayersText: { color: colors.textMuted, textAlign: 'center', padding: 20, fontSize: 12, fontWeight: '700' },
  modalActionRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginHorizontal: 6, justifyContent: 'center' },
  modalButtonCancel: { backgroundColor: colors.surfacePressed },
  modalButtonConfirm: { backgroundColor: colors.accent },
  modalButtonDisabled: { backgroundColor: colors.surfaceMuted },
  modalButtonCancelText: { color: colors.textPrimary, fontWeight: '800', fontSize: 13 },
  modalButtonConfirmText: { color: colors.black, fontWeight: '800', fontSize: 13 },
});
