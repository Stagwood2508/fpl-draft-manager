import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from 'expo-router/react-navigation';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '@/utils/supabase';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import {
  AppColors,
  appRadius,
  appSpacing,
  appTypography,
} from '@/constants/theme';

interface PlayerAsset {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  element_type: string;
  team_name: string;
}

interface TransactionRecord {
  id: string;
  type: 'WAIVER' | 'TRADE';
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COUNTERED' | 'CANCELLED' | 'VOIDED';
  created_at: string;
  sender_id: string;
  receiver_id: string | null;
  player_in_id: number;
  player_out_id: number;
  player_in: PlayerAsset;
  player_out: PlayerAsset | null;
  sender_profile?: { display_name: string };
  receiver_profile?: { display_name: string };
  parent_transaction_id: string | null;
  valid_gameweek: number | null;
  expires_at: string | null;
  void_reason: string | null;
}

interface GroupedTradePackage {
  batchKey: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COUNTERED' | 'CANCELLED' | 'VOIDED';
  created_at: string;
  sender_id: string;
  receiver_id: string;
  sender_display_name: string;
  receiver_display_name: string;
  playersIn: PlayerAsset[];   // Stacked array of all players YOU receive (Requested)
  playersOut: PlayerAsset[];  // Stacked array of all players YOU give away (Offered)
  originalRowIds: string[];   // Underlying database entry record keys
  rawTransactionObject: TransactionRecord; // Context mirror reference
  valid_gameweek: number | null;
  expires_at: string | null;
  void_reason: string | null;
}

interface WaiverClaim {
  id: string;
  priority_order: number;
  add_player: PlayerAsset;
  drop_player: PlayerAsset;
}

interface WaiverStatusSummary {
  priority: number | null;
  manager_count: number;
  gameweek: number | null;
  waiver_deadline: string | null;
  gameweek_deadline: string | null;
  market_status: string | null;
  trade_cutoff_rule: 'WAIVER_DEADLINE' | 'GAMEWEEK_DEADLINE';
  dropped_player_rule: 'NEXT_WAIVER' | 'IMMEDIATE_FREE_AGENT';
  priority_source?: 'REVERSE_DRAFT' | 'DRAFT_ORDER' | 'LEAGUE_POSITION';
}

interface TradeImpactPlayer {
  side: 'SENDER_GIVES' | 'RECEIVER_GIVES';
  player_id: number;
  player_name: string;
  club: string;
  position: string;
  before_points: number;
  since_points: number;
  since_minutes: number;
  since_goals: number;
  since_assists: number;
  since_appearances: number;
}

interface TradeImpactData {
  success: boolean;
  trade_gameweek: number;
  players: TradeImpactPlayer[];
}

const POSITION_COLORS: Record<string, string> = {
  GKP: '#FFC107',
  DEF: '#00A2FF',
  MID: '#00FF87',
  FWD: '#FF0055',
};

export default function TransactionsScreen() {
  const isFocused = useIsFocused();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width, height } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const isMobileLayout = width < 700;
  const isShortMobile = isMobileLayout && height < 720;
  const { tab } = useLocalSearchParams<{ tab?: string | string[] }>();

  const {
    currentUserId,
    activeLeagueId,
  } = useAppSession();

  const userId = currentUserId;
  const leagueId = activeLeagueId;
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [rosterType, setRosterType] = useState<'STRICT' | 'FLEXIBLE'>('STRICT');

  const [activeTab, setActiveTab] = useState<'WAIVERS' | 'OFFERS' | 'HISTORY'>('WAIVERS');

  useEffect(() => {
    const requestedTab = Array.isArray(tab) ? tab[0] : tab;
    const normalizedTab = String(requestedTab || '').toUpperCase();
    if (normalizedTab === 'WAIVERS' || normalizedTab === 'OFFERS' || normalizedTab === 'HISTORY') {
      setActiveTab(normalizedTab);
    }
  }, [tab]);

  const [myRoster, setMyRoster] = useState<PlayerAsset[]>([]);
  const [pendingRequests, setPendingRequests] = useState<TransactionRecord[]>([]);

  const [pendingWaiverClaims, setPendingWaiverClaims] = useState<WaiverClaim[]>([]);
  const [selectedWaiverClaimId, setSelectedWaiverClaimId] = useState<string | null>(null);
  const [waiverStatus, setWaiverStatus] = useState<WaiverStatusSummary | null>(null);

  // INLINE COUNTER MODAL STATE ENGINE
  const [isCounterModalVisible, setIsCounterModalVisible] = useState(false);
 const [activeCounterTrade, setActiveCounterTrade] =
  useState<GroupedTradePackage | null>(null);
  const [myCounterRoster, setMyCounterRoster] = useState<PlayerAsset[]>([]);
  const [rivalCounterRoster, setRivalCounterRoster] = useState<PlayerAsset[]>([]);
  const [mySelectedTradeIds, setMySelectedTradeIds] = useState<number[]>([]);
  const [rivalSelectedTradeIds, setRivalSelectedTradeIds] = useState<number[]>([]);
  const [tradeImpactPackage, setTradeImpactPackage] = useState<GroupedTradePackage | null>(null);
  const [tradeImpact, setTradeImpact] = useState<TradeImpactData | null>(null);
  const [tradeImpactLoading, setTradeImpactLoading] = useState(false);
  const [tradeImpactPeriod, setTradeImpactPeriod] = useState<'BEFORE' | 'SINCE'>('SINCE');

  const confirmAction = (
  title: string,
  message: string,
  confirmText: string,
  onConfirm: () => void | Promise<void>,
  destructive = false
) => {
  if (Platform.OS === 'web') {
    const confirmed = window.confirm(`${title}\n\n${message}`);

    if (confirmed) {
      void onConfirm();
    }

    return;
  }

  Alert.alert(title, message, [
    {
      text: 'Cancel',
      style: 'cancel',
    },
    {
      text: confirmText,
      style: destructive ? 'destructive' : 'default',
      onPress: () => {
        void onConfirm();
      },
    },
  ]);
};

  const POSITION_ORDER = ['GKP', 'DEF', 'MID', 'FWD'];
  const sortRosterByPosition = (roster: PlayerAsset[]) => {
    return [...roster].sort((a, b) => POSITION_ORDER.indexOf(a.element_type) - POSITION_ORDER.indexOf(b.element_type));
  };

useEffect(() => {
  if (isFocused && userId && leagueId) {
    void fetchTransactionContext();
  }
}, [isFocused, activeTab, userId, leagueId]);

useEffect(() => {
  if (!leagueId || !userId) return;

  const channel = supabase
    .channel(`transactions-${leagueId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `league_id=eq.${leagueId}`,
      },
      (payload) => {
        const row = (payload.new || payload.old) as any;
        if (row?.sender_id === userId || row?.receiver_id === userId) {
          void fetchTransactionContext();
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [leagueId, userId]);

  const fetchTransactionContext = async () => {
    try {
      setLoading(true);
      let activeWaiverGameweek: number | null = null;
      
if (!userId) {
  throw new Error('Authentication failure.');
}

if (!leagueId) {
  throw new Error('Active league context lost.');
}

const currentLeagueId = leagueId;

      const { data: rosterSettingsData } = await supabase
        .from('league_settings')
        .select('roster_type')
        .eq('league_id', currentLeagueId)
        .maybeSingle();
      setRosterType((rosterSettingsData?.roster_type as 'STRICT' | 'FLEXIBLE') || 'STRICT');

      const { data: waiverStatusData, error: waiverStatusError } = await supabase.rpc(
        'get_my_waiver_status',
        { p_league_id: currentLeagueId }
      );

      if (!waiverStatusError && waiverStatusData?.success) {
        setWaiverStatus(waiverStatusData as WaiverStatusSummary);
        activeWaiverGameweek = waiverStatusData.gameweek ?? null;
      } else if (waiverStatusError?.code === 'PGRST202') {
        const [memberResponse, memberCountResponse, gameweekResponse, settingsResponse] = await Promise.all([
          supabase.from('league_members').select('draft_order').eq('league_id', currentLeagueId).eq('user_id', userId).maybeSingle(),
          supabase.from('league_members').select('*', { count: 'exact', head: true }).eq('league_id', currentLeagueId),
          supabase.from('league_gameweeks').select('gameweek, waiver_deadline, gw_deadline, status').eq('league_id', currentLeagueId).gt('gw_deadline', new Date().toISOString()).order('gw_deadline').limit(1).maybeSingle(),
          supabase.from('league_settings').select('trade_cutoff_rule, dropped_player_rule').eq('league_id', currentLeagueId).maybeSingle(),
        ]);
        const managerCount = memberCountResponse.count || 0;
        const draftOrder = memberResponse.data?.draft_order || null;
        setWaiverStatus({
          priority: draftOrder ? managerCount - draftOrder + 1 : null,
          manager_count: managerCount,
          gameweek: gameweekResponse.data?.gameweek || null,
          waiver_deadline: gameweekResponse.data?.waiver_deadline || null,
          gameweek_deadline: gameweekResponse.data?.gw_deadline || null,
          market_status: gameweekResponse.data?.status || null,
          trade_cutoff_rule: settingsResponse.data?.trade_cutoff_rule || 'WAIVER_DEADLINE',
          dropped_player_rule: settingsResponse.data?.dropped_player_rule || 'NEXT_WAIVER',
        });
        activeWaiverGameweek = gameweekResponse.data?.gameweek ?? null;
      }

      const { data: myRosterData } = await supabase
        .from('rosters')
        .select('players(*)')
        .eq('league_id', currentLeagueId)
        .eq('user_id', userId);
      setMyRoster((myRosterData?.map(r => Array.isArray(r.players) ? r.players[0] : r.players).filter(Boolean) || []) as unknown as PlayerAsset[]);

      const { data: txnData } = await supabase
        .from('transactions')
        .select(`
          id, type, status, created_at, sender_id, receiver_id, player_in_id, player_out_id,
          valid_gameweek, expires_at, void_reason,
          parent_transaction_id,
          player_in:players!transactions_player_in_id_fkey(*),
          player_out:players!transactions_player_out_id_fkey(*),
          sender_profile:profiles!transactions_sender_id_fkey(display_name),
          receiver_profile:profiles!transactions_receiver_id_fkey(display_name)
        `)
        .eq('league_id', currentLeagueId)
        .order('created_at', { ascending: false });
      const visibleTransactions = ((txnData || []) as unknown as TransactionRecord[]).filter(transaction =>
        String(transaction.status).toUpperCase() !== 'PENDING' ||
        transaction.sender_id === userId ||
        transaction.receiver_id === userId
      );
      setPendingRequests(visibleTransactions);

      if (activeTab === 'WAIVERS') {
        let claimsQuery = supabase
          .from('waiver_claims')
          .select(`
            id, priority_order,
            add_player:player_to_add (id, first_name, second_name, web_name, team_name, element_type),
            drop_player:player_to_drop (id, first_name, second_name, web_name, team_name, element_type)
          `)
          .eq('user_id', userId)
          .eq('league_id', currentLeagueId)
          .eq('status', 'pending');

        if (activeWaiverGameweek) {
          claimsQuery = claimsQuery.eq('gameweek', activeWaiverGameweek);
        }

        const { data: claimsData, error: claimsErr } = await claimsQuery
          .order('priority_order', { ascending: true });

        if (claimsErr) throw claimsErr;

        const formatted = (claimsData || []).map((item: any) => ({
          id: item.id,
          priority_order: item.priority_order,
          add_player: Array.isArray(item.add_player) ? item.add_player[0] : item.add_player,
          drop_player: Array.isArray(item.drop_player) ? item.drop_player[0] : item.drop_player,
        })) as WaiverClaim[];

        setPendingWaiverClaims(formatted);
      }
    } catch (err: any) {
      Alert.alert('Context Pipeline Interrupted', err.message);
    } finally {
      setLoading(false);
    }
  };

  const getGroupedTrades = (tradesList: TransactionRecord[]): GroupedTradePackage[] => {
    const map: Record<string, GroupedTradePackage> = {};

    tradesList.forEach(item => {
      if (item.type !== 'TRADE') return;
      
      const batchKey = item.parent_transaction_id || item.id; 

      if (!map[batchKey]) {
        map[batchKey] = {
          batchKey: batchKey,
          status: item.status,
          created_at: item.created_at,
          sender_id: item.sender_id,
          receiver_id: item.receiver_id || '',
          sender_display_name: item.sender_profile?.display_name || 'Manager',
          receiver_display_name: item.receiver_profile?.display_name || 'Manager',
          playersIn: [],
          playersOut: [],
          originalRowIds: [],
          rawTransactionObject: item,
          valid_gameweek: item.valid_gameweek,
          expires_at: item.expires_at,
          void_reason: item.void_reason,
        };
      }

      map[batchKey].originalRowIds.push(item.id);
      
      const isViewingAsSender = item.sender_id === userId;
      const targetIncomingPlayer = isViewingAsSender ? item.player_in : item.player_out;
      const targetOutgoingPlayer = isViewingAsSender ? item.player_out : item.player_in;

      if (targetIncomingPlayer && !map[batchKey].playersIn.some(p => p.id === targetIncomingPlayer.id)) {
        map[batchKey].playersIn.push(targetIncomingPlayer);
      }
      if (targetOutgoingPlayer && !map[batchKey].playersOut.some(p => p.id === targetOutgoingPlayer.id)) {
        map[batchKey].playersOut.push(targetOutgoingPlayer);
      }
    });

    return Object.values(map);
  };

const handleBatchAcceptTrade = async (
  packageData: GroupedTradePackage
) => {
  confirmAction(
    'Accept Trade Proposal',
    `Finalize this package swap with ${packageData.sender_display_name}?`,
    'Accept Package',
    async () => {
      try {
        setProcessing(true);

        const targetTxnId =
          packageData.batchKey ||
          packageData.originalRowIds[0];

        const { data, error } = await supabase.rpc(
          'accept_trade_transaction',
          {
            p_transaction_id: targetTxnId,
          }
        );

        if (error) {
          throw error;
        }

        if (data && data.success === false) {
          throw new Error(
            data.error || 'The trade could not be accepted.'
          );
        }

        if (Platform.OS === 'web') {
          window.alert(
            'Trade executed. All players have been swapped successfully.'
          );
        } else {
          Alert.alert(
            'Success',
            'Trade executed. All players have been swapped successfully.'
          );
        }

        await fetchTransactionContext();
      } catch (err: any) {
        const message =
          err?.message || 'The trade could not be accepted.';

        if (Platform.OS === 'web') {
          window.alert(`Transaction Failed\n\n${message}`);
        } else {
          Alert.alert('Transaction Failed', message);
        }
      } finally {
        setProcessing(false);
      }
    }
  );
};

const handleBatchRejectTrade = async (
  packageData: GroupedTradePackage
) => {
  confirmAction(
    'Decline Trade Offer',
    'Permanently decline this package deal?',
    'Reject',
    async () => {
      try {
        setProcessing(true);

        const { data, error } = await supabase.rpc('update_trade_package_status', {
          p_transaction_id: packageData.batchKey || packageData.originalRowIds[0],
          p_action: 'REJECT',
        });

        if (error) {
          throw error;
        }
        if (data && data.success === false) {
          throw new Error(data.error || 'The offer could not be rejected.');
        }

        await fetchTransactionContext();
      } catch (err: any) {
        const message =
          err?.message || 'The offer could not be rejected.';

        if (Platform.OS === 'web') {
          window.alert(`Operation Failed\n\n${message}`);
        } else {
          Alert.alert('Operation Failed', message);
        }
      } finally {
        setProcessing(false);
      }
    },
    true
  );
};

  const handleBatchCancelTrade = async (packageData: GroupedTradePackage) => {
    Alert.alert('Withdraw Proposal', 'Pull your pending trade assets out of this offer queue?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            setProcessing(true);
            const { data, error } = await supabase.rpc('update_trade_package_status', {
              p_transaction_id: packageData.batchKey || packageData.originalRowIds[0],
              p_action: 'WITHDRAW',
            });

            if (error) throw error;
            if (data && data.success === false) {
              throw new Error(data.error || 'The offer could not be withdrawn.');
            }
            Alert.alert('Offer Withdrawn', 'Your proposal has been successfully removed.');
            fetchTransactionContext();
          } catch (err: any) {
            Alert.alert('Operation Failed', err.message);
          } finally {
            setProcessing(false);
          }
        }
      }
    ]);
  };

const handleCounterTradeOffer = async (
  tradePackage: GroupedTradePackage
) => {
  if (!leagueId || !userId) {
    return;
  }

  setProcessing(true);

  try {
    setActiveCounterTrade(tradePackage);

    const rivalUserId =
      tradePackage.sender_id === userId
        ? tradePackage.receiver_id
        : tradePackage.sender_id;

    const { data: rivalData, error: rivalError } =
      await supabase
        .from('rosters')
        .select('players(*)')
        .eq('league_id', leagueId)
        .eq('user_id', rivalUserId);

    if (rivalError) {
      throw rivalError;
    }

    const parsedRivalRoster = (
      rivalData
        ?.map((row) =>
          Array.isArray(row.players)
            ? row.players[0]
            : row.players
        )
        .filter(Boolean) || []
    ) as PlayerAsset[];

    setMyCounterRoster(sortRosterByPosition(myRoster));
    setRivalCounterRoster(
      sortRosterByPosition(parsedRivalRoster)
    );

    // You are offering these players.
    setMySelectedTradeIds(
      tradePackage.playersOut.map((player) => player.id)
    );

    // You are requesting these players.
    setRivalSelectedTradeIds(
      tradePackage.playersIn.map((player) => player.id)
    );

    setIsCounterModalVisible(true);
  } catch (err: any) {
    const message =
      err?.message || 'The counter offer could not be prepared.';

    if (Platform.OS === 'web') {
      window.alert(`Counter Configuration Failed\n\n${message}`);
    } else {
      Alert.alert('Counter Configuration Failed', message);
    }
  } finally {
    setProcessing(false);
  }
};

const toggleSelectMyTradePlayer = (id: number) => {
  const player = myCounterRoster.find(
    rosterPlayer => rosterPlayer.id === id
  );

  if (!player) {
    return;
  }

  const position = player.element_type;

  setMySelectedTradeIds(previousSelection => {
    // Clicking a selected player removes it.
    if (previousSelection.includes(id)) {
      return previousSelection.filter(
        selectedId => selectedId !== id
      );
    }

    const demandedPlayers = rivalCounterRoster.filter(
      rivalPlayer =>
        rivalSelectedTradeIds.includes(rivalPlayer.id)
    );

    if (rosterType === 'FLEXIBLE') {
      const requestedClass = position === 'GKP' ? 'GKP' : 'OUTFIELD';
      const demandedForClass = demandedPlayers.filter(candidate =>
        requestedClass === 'GKP'
          ? candidate.element_type === 'GKP'
          : candidate.element_type !== 'GKP'
      ).length;
      const selectedForClass = previousSelection.filter(selectedId => {
        const selected = myCounterRoster.find(candidate => candidate.id === selectedId);
        return requestedClass === 'GKP'
          ? selected?.element_type === 'GKP'
          : selected?.element_type !== 'GKP';
      });

      if (demandedForClass === 0) {
        const message = requestedClass === 'GKP'
          ? 'Select a goalkeeper from the other squad before offering one.'
          : 'Select an outfield player from the other squad before offering one.';
        if (Platform.OS === 'web') window.alert(message);
        else Alert.alert('Roster Balance', message);
        return previousSelection;
      }

      if (selectedForClass.length >= demandedForClass) {
        return [
          ...previousSelection.filter(selectedId => selectedId !== selectedForClass[0]),
          id,
        ];
      }

      return [...previousSelection, id];
    }

    const demandedPositionCount = demandedPlayers.filter(
      rivalPlayer =>
        rivalPlayer.element_type === position
    ).length;

    if (demandedPositionCount === 0) {
      const message =
        `Request a ${position} from the other squad before offering one.`;

      if (Platform.OS === 'web') {
        window.alert(message);
      } else {
        Alert.alert('Position Lock', message);
      }

      return previousSelection;
    }

    const selectedIdsForPosition =
      previousSelection.filter(selectedId => {
        const selectedPlayer = myCounterRoster.find(
          rosterPlayer => rosterPlayer.id === selectedId
        );

        return selectedPlayer?.element_type === position;
      });

    // Replace an existing selection when the position quota is full.
    if (
      selectedIdsForPosition.length >=
      demandedPositionCount
    ) {
      const idToReplace = selectedIdsForPosition[0];

      return [
        ...previousSelection.filter(
          selectedId => selectedId !== idToReplace
        ),
        id,
      ];
    }

    return [...previousSelection, id];
  });
};

  const toggleSelectRivalTradePlayer = (id: number) => {
    setRivalSelectedTradeIds(prev => {
      const nextSelection = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      setMySelectedTradeIds(currentMySelections => {
        if (rosterType === 'FLEXIBLE') {
          const demanded = rivalCounterRoster.filter(player => nextSelection.includes(player.id));
          const goalkeeperSlots = demanded.filter(player => player.element_type === 'GKP').length;
          const outfieldSlots = demanded.length - goalkeeperSlots;
          let usedGoalkeepers = 0;
          let usedOutfielders = 0;

          return currentMySelections.filter(myId => {
            const selected = myCounterRoster.find(candidate => candidate.id === myId);
            if (!selected) return false;
            if (selected.element_type === 'GKP') {
              if (usedGoalkeepers >= goalkeeperSlots) return false;
              usedGoalkeepers += 1;
              return true;
            }
            if (usedOutfielders >= outfieldSlots) return false;
            usedOutfielders += 1;
            return true;
          });
        }

        const demandedPositions = rivalCounterRoster.filter(p => nextSelection.includes(p.id)).map(p => p.element_type);
        const demandCounts: Record<string, number> = {};
        demandedPositions.forEach(pos => { demandCounts[pos] = (demandCounts[pos] || 0) + 1; });

        const pruned: number[] = [];
        const allocated: Record<string, number> = {};
        currentMySelections.forEach(myId => {
          const p = myCounterRoster.find(x => x.id === myId);
          if (p) {
            const pos = p.element_type;
            const curAlloc = allocated[pos] || 0;
            const maxAllow = demandCounts[pos] || 0;
            if (curAlloc < maxAllow) {
              pruned.push(myId);
              allocated[pos] = curAlloc + 1;
            }
          }
        });
        return pruned;
      });
      return nextSelection;
    });
  };

  const executeCounterProposalSubmit = async () => {
    if (!activeCounterTrade || !userId || !leagueId) {
  return;
}

if (
  mySelectedTradeIds.length === 0 ||
  rivalSelectedTradeIds.length === 0
) {
  if (Platform.OS === 'web') {
    window.alert(
      'Select at least one player from each squad.'
    );
  } else {
    Alert.alert(
      'Incomplete Counter Offer',
      'Select at least one player from each squad.'
    );
  }

  return;
}

if (
  mySelectedTradeIds.length !== rivalSelectedTradeIds.length
) {
  if (Platform.OS === 'web') {
    window.alert(
      'Counter offers must contain the same number of players on both sides.'
    );
  } else {
    Alert.alert(
      'Unequal Trade',
      'Counter offers must contain the same number of players on both sides.'
    );
  }

  return;
}
    try {
      setProcessing(true);

      const myTradePlayers = sortRosterByPosition(myCounterRoster.filter(p => mySelectedTradeIds.includes(p.id)));
      const rivalTradePlayers = sortRosterByPosition(rivalCounterRoster.filter(p => rivalSelectedTradeIds.includes(p.id)));
      const { data, error } = await supabase.rpc('counter_trade_package', {
        p_transaction_id: activeCounterTrade.batchKey || activeCounterTrade.originalRowIds[0],
        p_player_out_ids: myTradePlayers.map(player => player.id),
        p_player_in_ids: rivalTradePlayers.map(player => player.id),
      });
      if (error) throw error;
      if (data && data.success === false) {
        throw new Error(data.error || 'The counter offer was rejected by the server.');
      }

      Alert.alert('Counter Offer Dispatched', 'Your counter-proposal has been successfully broadcasted.');
      setIsCounterModalVisible(false);
      setActiveCounterTrade(null);
      fetchTransactionContext();
    } catch (err: any) {
      Alert.alert('Submission Aborted', err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleSwapWaiverPriority = async (targetId: string) => {
    if (!selectedWaiverClaimId) {
      setSelectedWaiverClaimId(targetId);
      return;
    }
    if (selectedWaiverClaimId === targetId) {
      setSelectedWaiverClaimId(null);
      return;
    }
    const claimA = pendingWaiverClaims.find(c => c.id === selectedWaiverClaimId);
    const claimB = pendingWaiverClaims.find(c => c.id === targetId);
    if (!claimA || !claimB) {
      setSelectedWaiverClaimId(null);
      return;
    }
    try {
      setProcessing(true);
if (!userId || !leagueId) {
  throw new Error('Your user or league session is unavailable.');
}

      const nextOrder = [...pendingWaiverClaims]
        .sort((left, right) => left.priority_order - right.priority_order)
        .map(claim => claim.id);
      const firstIndex = nextOrder.indexOf(selectedWaiverClaimId);
      const secondIndex = nextOrder.indexOf(targetId);
      [nextOrder[firstIndex], nextOrder[secondIndex]] = [nextOrder[secondIndex], nextOrder[firstIndex]];

      const { data, error } = await supabase.rpc('reorder_waiver_claims', {
        p_league_id: leagueId,
        p_claim_ids: nextOrder,
      });
      if (error) throw error;
      if (!data?.success) {
        const messages: Record<string, string> = {
          WAIVER_WINDOW_CLOSED: 'The waiver deadline has passed, so priorities can no longer be changed.',
          CLAIM_ORDER_MISMATCH: 'Your waiver queue changed elsewhere. It has been refreshed.',
        };
        throw new Error(messages[data?.error] || 'The server rejected the new waiver order.');
      }
      setSelectedWaiverClaimId(null);
      await fetchTransactionContext();
    } catch (err: any) {
      Alert.alert("Priority Swap Failed", err.message);
      setSelectedWaiverClaimId(null);
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelWaiverClaim = (claimId: string) => {
    confirmAction(
      'Cancel Claim',
      'Remove this waiver request from your active queue?',
      'Yes, Remove',
      async () => {
        try {
          setProcessing(true);
          if (!userId || !leagueId) {
            throw new Error('Your user or league session is unavailable.');
          }

          const { data, error } = await supabase.rpc('cancel_waiver_claim', {
            p_claim_id: claimId,
          });
          if (error) throw error;
          if (!data?.success) {
            const messages: Record<string, string> = {
              CLAIM_NOT_FOUND: 'This claim no longer exists. The waiver list will now refresh.',
              CLAIM_OWNER_REQUIRED: 'Only the manager who submitted this claim can cancel it.',
              CLAIM_ALREADY_PROCESSED: 'This claim has already been processed and cannot be cancelled.',
              WAIVER_WINDOW_CLOSED: 'The waiver deadline has passed, so this claim can no longer be cancelled.',
            };
            throw new Error(messages[data?.error] || 'The claim could not be cancelled. Please try again.');
          }

          setPendingWaiverClaims(current =>
            current
              .filter(claim => claim.id !== claimId)
              .map((claim, index) => ({ ...claim, priority_order: index + 1 }))
          );
          await fetchTransactionContext();
        } catch (err: any) {
          const message = err?.message || 'The claim could not be cancelled.';
          if (Platform.OS === 'web') window.alert(`Cancellation Failed\n\n${message}`);
          else Alert.alert('Cancellation Failed', message);
        } finally {
          setProcessing(false);
        }
      },
      true
    );
  };

  const getShortTeamCode = (name: string) => {
    if (!name) return 'FA';
    return name.slice(0, 3).toUpperCase();
  };

  const openTradeImpact = async (pkg: GroupedTradePackage) => {
    if (!leagueId) return;
    setTradeImpactPackage(pkg);
    setTradeImpact(null);
    setTradeImpactPeriod('SINCE');
    setTradeImpactLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_trade_impact', {
        p_league_id: leagueId,
        p_transaction_id: pkg.originalRowIds[0],
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || 'Trade analysis is unavailable.');
      setTradeImpact(data as TradeImpactData);
    } catch (error: any) {
      if (Platform.OS === 'web') window.alert(`Trade Analysis\n\n${error?.message || 'Unable to calculate this trade.'}`);
      else Alert.alert('Trade Analysis', error?.message || 'Unable to calculate this trade.');
      setTradeImpactPackage(null);
    } finally {
      setTradeImpactLoading(false);
    }
  };

  const renderSideBySideTradePackage = (pkg: GroupedTradePackage) => {
    const maxRows = Math.max(pkg.playersIn.length, pkg.playersOut.length);

    return (
      <View style={styles.stackedBlockContainer}>
        {/* 2-Column Asset Header Labels */}
        <View style={styles.assetHeaderRow}>
          <Text style={[styles.assetHeaderLabel, styles.colLeft]}>Requested Asset(s)</Text>
          <View style={styles.arrowSpacer} />
          <Text style={[styles.assetHeaderLabel, styles.colRight, styles.textRight]}>Offered Asset(s)</Text>
        </View>

        {/* Dual-Column Grid Rows */}
        <View style={styles.assetGrid}>
          {Array.from({ length: maxRows }).map((_, idx) => {
            const req = pkg.playersIn[idx];
            const off = pkg.playersOut[idx];

            return (
              <View key={idx} style={styles.assetRow}>
                {/* Left Column: Requested Asset (In) */}
                <View style={styles.colLeft}>
                  {req ? (
                    <Text style={styles.playerTextRequested} numberOfLines={1}>
                      {req.web_name}{' '}
                      <Text style={styles.metaText}>
                        ({getShortTeamCode(req.team_name)} · {req.element_type})
                      </Text>
                    </Text>
                  ) : (
                    <Text style={styles.emptyAssetText}>—</Text>
                  )}
                </View>

                {/* Center Divider: Vertical Arrow Stack */}
                <View style={styles.arrowStackContainer}>
                  <Text style={styles.arrowIn}>➔</Text>
                  <Text style={styles.arrowOut}>⬅</Text>
                </View>

                {/* Right Column: Offered Asset (Out - Right Aligned) */}
                <View style={styles.colRight}>
                  {off ? (
                    <Text style={[styles.playerTextOffered, styles.textRight]} numberOfLines={1}>
                      {off.web_name}{' '}
                      <Text style={styles.metaText}>
                        ({getShortTeamCode(off.team_name)} · {off.element_type})
                      </Text>
                    </Text>
                  ) : (
                    <Text style={[styles.emptyAssetText, styles.textRight]}>—</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const groupedTradePackages = getGroupedTrades(pendingRequests);
  const activeOffersList = groupedTradePackages.filter(p => p.status === 'PENDING');
  const historicalLogsList = groupedTradePackages.filter(p => p.status !== 'PENDING');

  return (
    <View style={styles.container}>
      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'WAIVERS' && styles.tabBtnActive]} onPress={() => setActiveTab('WAIVERS')}>
          <Text style={[styles.tabText, activeTab === 'WAIVERS' && styles.tabTextActive]}>WAIVERS</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'OFFERS' && styles.tabBtnActive]} onPress={() => setActiveTab('OFFERS')}>
          <Text style={[styles.tabText, activeTab === 'OFFERS' && styles.tabTextActive]}>TRADE OFFERS</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'HISTORY' && styles.tabBtnActive]} onPress={() => setActiveTab('HISTORY')}>
          <Text style={[styles.tabText, activeTab === 'HISTORY' && styles.tabTextActive]}>TRADE LOGS</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {activeTab === 'WAIVERS' && (
          <View style={styles.waiverStatusCard}>
            <View style={styles.waiverStatusMainRow}>
              <View style={styles.waiverWindowIdentity}>
                <Text style={styles.waiverStatusEyebrow}>WAIVER WINDOW</Text>
                <Text style={styles.waiverStatusTitle}>
                  {waiverStatus?.gameweek ? `GW ${waiverStatus.gameweek}` : 'NEXT'}
                </Text>
              </View>

              <View style={styles.waiverStatusDivider} />

              <View style={styles.waiverCompactMetric}>
                <Text style={styles.waiverStatusMetricLabel}>PRIORITY</Text>
                <Text style={styles.waiverStatusMetricValue}>
                  {waiverStatus?.priority ? `#${waiverStatus.priority}` : '—'}
                  {waiverStatus?.manager_count ? <Text style={styles.waiverStatusMetricMax}>/{waiverStatus.manager_count}</Text> : null}
                </Text>
              </View>

              <View style={styles.waiverStatusDivider} />

              <View style={styles.waiverDeadlineMetric}>
                <View style={styles.waiverDeadlineHeadingRow}>
                  <Text style={styles.waiverStatusMetricLabel}>DEADLINE</Text>
                  <View style={styles.marketStatusBadge}>
                    <Text style={styles.marketStatusText}>{(waiverStatus?.market_status || 'SCHEDULED').replaceAll('_', ' ')}</Text>
                  </View>
                </View>
                <Text style={styles.waiverDeadlineValue} numberOfLines={1}>
                  {waiverStatus?.waiver_deadline
                    ? new Date(waiverStatus.waiver_deadline).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : 'Awaiting schedule'}
                </Text>
              </View>
            </View>

            <Text style={styles.marketRuleText} numberOfLines={2}>
              Trades: {waiverStatus?.trade_cutoff_rule === 'GAMEWEEK_DEADLINE' ? 'Gameweek deadline' : 'waiver deadline'}{'  •  '}
              Drops: {waiverStatus?.dropped_player_rule === 'IMMEDIATE_FREE_AGENT' ? 'immediate free agents' : 'protected until next waivers'}
            </Text>
          </View>
        )}

        {activeTab === 'WAIVERS' && (
          <View style={styles.card}>
            <Text style={styles.sectionHeader}>Your Pending Weekly Claims</Text>
            <Text style={styles.sectionSub}>Tap two claims in sequence to swap their processing priority order.</Text>

            {pendingWaiverClaims.length === 0 ? (
              <View style={styles.emptyClaimsBox}>
                <Text style={styles.emptyClaimsText}>No active pending waiver claims.</Text>
                <Text style={styles.emptyClaimsSub}>Add waivers directly by clicking the "+" button next to players in the Player Pool tab.</Text>
              </View>
            ) : (
              pendingWaiverClaims.map((item) => {
                const isSelected = selectedWaiverClaimId === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.cleanWaiverRow, isSelected && styles.rowSelected]}
                    onPress={() => handleSwapWaiverPriority(item.id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.priorityBadge}>
                      <Text style={styles.priorityText}>#{item.priority_order}</Text>
                    </View>

                    <View style={styles.waiverSwapFlexContainer}>
                      <View style={styles.playerUnitLeft}>
                        <Text style={styles.playerNameCompact} numberOfLines={1}>{item.add_player?.web_name}</Text>
                        <Text style={styles.teamCodeText}>{getShortTeamCode(item.add_player?.team_name)}</Text>
                      </View>
                      <View style={styles.arrowStackColumn}>
                        <Text style={styles.greenArrow}>▲</Text>
                        <Text style={styles.redArrow}>▼</Text>
                      </View>
                      <View style={styles.playerUnitRight}>
                        <Text style={styles.playerNameCompact} numberOfLines={1}>{item.drop_player?.web_name}</Text>
                        <Text style={styles.teamCodeText}>{getShortTeamCode(item.drop_player?.team_name)}</Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={styles.cancelButton}
                      disabled={processing}
                      onPress={(event) => {
                        event.stopPropagation();
                        handleCancelWaiverClaim(item.id);
                      }}
                    >
                      <Text style={styles.cancelButtonText}>✕</Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        {activeTab === 'OFFERS' && (
          <>
            <Text style={styles.ledgerHeaderTitle}>Active Negotiations & Offers</Text>
            {activeOffersList.length === 0 ? (
              <Text style={styles.emptyLedgerText}>No active pending trade proposals found.</Text>
            ) : (
              activeOffersList.map(pkg => {
                const isOutgoingPending = pkg.sender_id === userId;
                const displayTitle = isOutgoingPending ? `TO: ${pkg.receiver_display_name}` : `FROM: ${pkg.sender_display_name}`;

                return (
                  <View key={pkg.batchKey} style={styles.ledgerCardSlim}>
                    <View style={styles.ledgerRowMetaSlim}>
                      <Text style={styles.ledgerTypeTextSlim} numberOfLines={1}>{displayTitle}</Text>
                      <Text style={styles.ledgerTimeTextSlim}>
                        {pkg.valid_gameweek ? `GW${pkg.valid_gameweek} · ` : ''}{new Date(pkg.created_at).toLocaleDateString()}
                      </Text>
                      <View style={[styles.statusBadgeSlim, styles.badgePending]}>
                        <Text style={styles.statusTextSlim}>{pkg.status}</Text>
                      </View>
                    </View>
                    
                    {/* Render Side-by-Side 2-Column Asset Grid */}
                    {renderSideBySideTradePackage(pkg)}
                    
                    {pkg.receiver_id === userId && (
                      <View style={styles.interactiveRowBarSlim}>
                        <TouchableOpacity style={[styles.inlineActionBtnSlim, styles.bgBtnReject]} onPress={() => handleBatchRejectTrade(pkg)} disabled={processing}>
                          <Text style={styles.lblTextReject}>REJECT</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.inlineActionBtnSlim, styles.bgBtnCounter]} onPress={() => handleCounterTradeOffer(pkg)} disabled={processing}>
                          <Text style={styles.lblTextCounter}>COUNTER</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.inlineActionBtnSlim, styles.bgBtnAccept]} onPress={() => handleBatchAcceptTrade(pkg)} disabled={processing}>
                          <Text style={styles.lblTextAccept}>ACCEPT</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {isOutgoingPending && (
                      <View style={styles.interactiveRowBarSlim}>
                        <TouchableOpacity style={[styles.inlineActionBtnSlim, styles.bgBtnCancel]} onPress={() => handleBatchCancelTrade(pkg)} disabled={processing}>
                          <Text style={styles.lblTextCancel}>WITHDRAW PROPOSAL</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </>
        )}

        {activeTab === 'HISTORY' && (
          <>
            <Text style={styles.ledgerHeaderTitle}>Archived Transaction Ledger</Text>
            {historicalLogsList.length === 0 ? (
              <Text style={styles.emptyLedgerText}>No historical trade records logged in this segment.</Text>
            ) : (
              historicalLogsList.map(pkg => {
                const displayTitle = pkg.sender_id === userId ? `TO: ${pkg.receiver_display_name}` : `FROM: ${pkg.sender_display_name}`;

                return (
                  <View key={pkg.batchKey} style={styles.ledgerCardSlim}>
                    <View style={styles.ledgerRowMetaSlim}>
                      <Text style={styles.ledgerTypeTextSlim} numberOfLines={1}>{displayTitle}</Text>
                      <Text style={styles.ledgerTimeTextSlim}>{new Date(pkg.created_at).toLocaleDateString()}</Text>
                      <View style={[
                        styles.statusBadgeSlim, 
                        pkg.status === 'ACCEPTED' ? styles.badgeSuccess : 
                        pkg.status === 'COUNTERED' ? styles.badgeCountered : 
                        pkg.status === 'CANCELLED' ? styles.badgeCancelled : styles.badgeDanger
                      ]}>
                        <Text style={styles.statusTextSlim}>{pkg.status}</Text>
                      </View>
                    </View>
                    
                    {/* Render Side-by-Side 2-Column Asset Grid */}
                    {renderSideBySideTradePackage(pkg)}
                    {pkg.status === 'VOIDED' && (
                      <Text style={styles.emptyLedgerText}>
                        {pkg.void_reason === 'PLAYER_OWNERSHIP_CHANGED'
                          ? 'Voided because an included player changed club through waivers, a free-agent move or another trade.'
                          : 'Voided when this Gameweek’s trade deadline passed.'}
                      </Text>
                    )}
                    {pkg.status === 'ACCEPTED' && (
                      <TouchableOpacity style={styles.tradeAnalysisButton} onPress={() => void openTradeImpact(pkg)}>
                        <Text style={styles.tradeAnalysisButtonText}>VIEW TRADE IMPACT</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={Boolean(tradeImpactPackage)} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setTradeImpactPackage(null)}>
        <View style={styles.tradeImpactOverlay}>
          <View style={[styles.tradeImpactSheet, isMobileLayout && styles.tradeImpactSheetMobile, isMobileLayout && { paddingBottom: Math.max(safeArea.bottom, 12) }]}>
            <View style={styles.tradeImpactHandle} />
            <View style={styles.tradeImpactHeader}>
              <View>
                <Text style={styles.tradeImpactTitle}>Trade Impact</Text>
                <Text style={styles.tradeImpactSubtitle}>{tradeImpactPackage?.sender_display_name} ↔ {tradeImpactPackage?.receiver_display_name}</Text>
              </View>
              <TouchableOpacity style={styles.tradeImpactClose} onPress={() => setTradeImpactPackage(null)}><Text style={styles.tradeImpactCloseText}>×</Text></TouchableOpacity>
            </View>

            <View style={styles.tradeImpactToggle}>
              {(['BEFORE', 'SINCE'] as const).map(period => (
                <TouchableOpacity key={period} style={[styles.tradeImpactToggleButton, tradeImpactPeriod === period && styles.tradeImpactToggleButtonActive]} onPress={() => setTradeImpactPeriod(period)}>
                  <Text style={[styles.tradeImpactToggleText, tradeImpactPeriod === period && styles.tradeImpactToggleTextActive]}>{period === 'BEFORE' ? 'Before trade' : `Since GW${tradeImpact?.trade_gameweek || '—'}`}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {tradeImpactLoading ? <View style={styles.tradeImpactLoading}><ActivityIndicator color={colors.accent} /></View> : tradeImpact && (
              <ScrollView contentContainerStyle={styles.tradeImpactContent}>
                <View style={styles.tradeImpactColumns}>
                  {([
                    { side: 'SENDER_GIVES' as const, label: `${tradeImpactPackage?.sender_display_name} gave` },
                    { side: 'RECEIVER_GIVES' as const, label: `${tradeImpactPackage?.receiver_display_name} gave` },
                  ]).map(column => {
                    const players = tradeImpact.players.filter(player => player.side === column.side);
                    const total = players.reduce((sum, player) => sum + Number(tradeImpactPeriod === 'BEFORE' ? player.before_points : player.since_points), 0);
                    return <View key={column.side} style={styles.tradeImpactColumn}>
                      <Text style={styles.tradeImpactColumnTitle} numberOfLines={1}>{column.label}</Text>
                      {players.map(player => {
                        const points = Number(tradeImpactPeriod === 'BEFORE' ? player.before_points : player.since_points) || 0;
                        const per90 = tradeImpactPeriod === 'SINCE' && player.since_minutes ? (player.since_points * 90 / player.since_minutes).toFixed(1) : '—';
                        return <View key={player.player_id} style={styles.tradeImpactPlayer}>
                          <View style={styles.tradeImpactPlayerTop}><Text style={styles.tradeImpactPlayerName} numberOfLines={1}>{player.player_name}</Text><Text style={styles.tradeImpactPlayerPoints}>{points}</Text></View>
                          <Text style={styles.tradeImpactPlayerMeta}>{player.club} · {player.position}</Text>
                          {tradeImpactPeriod === 'SINCE' && <Text style={styles.tradeImpactPlayerDetail}>{player.since_appearances} apps · {player.since_goals}G {player.since_assists}A · {per90}/90</Text>}
                        </View>;
                      })}
                      <View style={styles.tradeImpactTotal}><Text style={styles.tradeImpactTotalLabel}>TOTAL</Text><Text style={styles.tradeImpactTotalValue}>{total}</Text></View>
                    </View>;
                  })}
                </View>
                {tradeImpactPeriod === 'SINCE' && tradeImpact.players.every(player => player.since_appearances === 0) && <Text style={styles.tradeImpactTooEarly}>Too early to assess — no post-trade appearances have been recorded.</Text>}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* INLINE COUNTER NEGOTIATION DESK CARD MODAL */}
      <Modal visible={isCounterModalVisible} animationType="slide" transparent={true} presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setIsCounterModalVisible(false)}>
        <View style={[styles.modalOverlay, isMobileLayout && styles.modalOverlayMobile]}>
          <View style={[styles.tradeModalContent, isMobileLayout && styles.tradeModalContentMobile, isMobileLayout && { paddingTop: Math.max(safeArea.top, 8), paddingBottom: Math.max(safeArea.bottom, 8) }]}>
            <Text style={[styles.modalTitle, isMobileLayout && styles.modalTitleMobile]}>Construct Counter Offer</Text>
            <Text style={[styles.tradeSubHeader, isMobileLayout && styles.tradeSubHeaderMobile]}>
  Target Partner:{' '}
  {activeCounterTrade?.sender_id === userId
    ? activeCounterTrade?.receiver_display_name
    : activeCounterTrade?.sender_display_name}
</Text>

            <View style={[styles.tradeLayoutGrid, isMobileLayout && styles.tradeLayoutGridMobile]}>
              <View style={[styles.tradeCol, isMobileLayout && styles.tradeColMobile]}>
                <Text style={[styles.colTitle, isMobileLayout && styles.colTitleMobile]}>{isMobileLayout ? 'Send mine' : 'Send My Asset(s)'}</Text>
                <ScrollView style={styles.tradeScrollView} contentContainerStyle={isMobileLayout && styles.tradeScrollContentMobile} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                  {myCounterRoster.map(p => {
                    const isSelected = mySelectedTradeIds.includes(p.id);
                    const pos = p.element_type;
                    const demandedPlayers = rivalCounterRoster.filter(r => rivalSelectedTradeIds.includes(r.id));
                    const totalDemandedOfThisPos = demandedPlayers.filter(r => r.element_type === pos).length;
                    const isSelectionDisabled =
  !isSelected && totalDemandedOfThisPos === 0;

                    return (
                      <TouchableOpacity 
                        key={p.id} 
                        style={[
                          styles.tradeSelectorCardCompact, 
                          isMobileLayout && styles.tradeSelectorCardMobile,
                          isMobileLayout && styles.tradeSelectorCardFillMobile,
                          isShortMobile && styles.tradeSelectorCardShortMobile,
                          isSelected && styles.tradeSelectorCardSelected,
                          isSelectionDisabled && styles.tradeSelectorCardDisabled
                        ]}
                        onPress={() => toggleSelectMyTradePlayer(p.id)}
                        disabled={isSelectionDisabled}
                      >
                        <View style={styles.tradeCardRowFlow}>
                          <View style={[styles.tradePlayerIdentity, isMobileLayout && styles.tradePlayerIdentityMobile]}>
                            <Text style={[styles.tradeCardTextCompact, isMobileLayout && styles.tradeCardTextMobile, isSelected && styles.tradeCardTextSelected, isSelectionDisabled && styles.tradeCardTextDisabled]} numberOfLines={1}>
                              {p.web_name}
                            </Text>
                            {isMobileLayout && (
                              <View style={styles.tradeCardMetaRowMobile}>
                                <Text style={styles.tradeCardMetaMobile}>{getShortTeamCode(p.team_name)}</Text>
                                <View style={[styles.miniPosBadgeMobile, { backgroundColor: POSITION_COLORS[p.element_type] || '#222' }]}>
                                  <Text style={styles.miniPosTextMobile}>{p.element_type}</Text>
                                </View>
                              </View>
                            )}
                          </View>
                          {!isMobileLayout && <Text style={styles.tradeCardMetaTextCompact}>{getShortTeamCode(p.team_name)}</Text>}
                          {!isMobileLayout && (
                            <View style={[styles.miniPosBadgeCompact, { backgroundColor: POSITION_COLORS[p.element_type] || '#222' }]}>
                              <Text style={styles.miniPosTextCompact}>{p.element_type}</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={[styles.tradeCol, isMobileLayout && styles.tradeColMobile]}>
                <Text style={[styles.colTitle, isMobileLayout && styles.colTitleMobile]}>{isMobileLayout ? 'Receive theirs' : 'Demand Asset(s)'}</Text>
                <ScrollView style={styles.tradeScrollView} contentContainerStyle={isMobileLayout && styles.tradeScrollContentMobile} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                  {rivalCounterRoster.map(p => {
                    const isSelected = rivalSelectedTradeIds.includes(p.id);
                    return (
                      <TouchableOpacity key={p.id} style={[styles.tradeSelectorCardCompact, isMobileLayout && styles.tradeSelectorCardMobile, isMobileLayout && styles.tradeSelectorCardFillMobile, isShortMobile && styles.tradeSelectorCardShortMobile, isSelected && styles.tradeSelectorCardSelected]} onPress={() => toggleSelectRivalTradePlayer(p.id)}>
                        <View style={styles.tradeCardRowFlow}>
                          <View style={[styles.tradePlayerIdentity, isMobileLayout && styles.tradePlayerIdentityMobile]}>
                            <Text style={[styles.tradeCardTextCompact, isMobileLayout && styles.tradeCardTextMobile, isSelected && styles.tradeCardTextSelected]} numberOfLines={1}>
                              {p.web_name}
                            </Text>
                            {isMobileLayout && (
                              <View style={styles.tradeCardMetaRowMobile}>
                                <Text style={styles.tradeCardMetaMobile}>{getShortTeamCode(p.team_name)}</Text>
                                <View style={[styles.miniPosBadgeMobile, { backgroundColor: POSITION_COLORS[p.element_type] || '#222' }]}>
                                  <Text style={styles.miniPosTextMobile}>{p.element_type}</Text>
                                </View>
                              </View>
                            )}
                          </View>
                          {!isMobileLayout && <Text style={styles.tradeCardMetaTextCompact}>{getShortTeamCode(p.team_name)}</Text>}
                          {!isMobileLayout && (
                            <View style={[styles.miniPosBadgeCompact, { backgroundColor: POSITION_COLORS[p.element_type] || '#222' }]}>
                              <Text style={styles.miniPosTextCompact}>{p.element_type}</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>

            <Text style={[styles.tradeLockNotice, isMobileLayout && styles.tradeLockNoticeMobile]} numberOfLines={isMobileLayout ? 2 : undefined}>
              ⚠️ Multi-player swap constraint active: Swaps must be equal size and matching positions (e.g. swap MID for MID, DEF for DEF).
            </Text>

            <View style={[styles.modalActionRow, isMobileLayout && styles.modalActionRowMobile]}>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} onPress={() => { setIsCounterModalVisible(false); setActiveCounterTrade(null); }}>
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonConfirm]} onPress={executeCounterProposalSubmit} disabled={processing}>
                <Text style={styles.modalButtonConfirmText}>Submit Counter</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (appColors: AppColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appColors.background,
  },

  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: appColors.background,
  },

  tabContainer: {
    flexDirection: 'row',
    backgroundColor: appColors.backgroundElevated,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },

  tabBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },

  tabBtnActive: {
    borderBottomColor: appColors.accent,
    backgroundColor: appColors.accentSoft,
  },

  tabText: {
    color: appColors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  tabTextActive: {
    color: appColors.accent,
    fontWeight: '900',
  },

  scrollContent: {
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
    paddingHorizontal: appSpacing.lg,
    paddingTop: appSpacing.lg,
    paddingBottom: 50,
  },

  waiverStatusCard: {
    paddingHorizontal: appSpacing.md,
    paddingVertical: 10,
    marginBottom: appSpacing.md,
    backgroundColor: appColors.backgroundElevated,
    borderWidth: 1,
    borderColor: appColors.accentBorder,
    borderRadius: appRadius.medium,
  },
  tradeAnalysisButton: { marginTop: 10, borderTopWidth: 1, borderTopColor: appColors.border, paddingTop: 10, alignItems: 'center' },
  tradeAnalysisButtonText: { color: appColors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  tradeImpactOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'flex-end' },
  tradeImpactSheet: { width: 760, maxWidth: '94%', maxHeight: '88%', backgroundColor: appColors.backgroundElevated, borderRadius: 22, borderWidth: 1, borderColor: appColors.border, marginBottom: 22, overflow: 'hidden' },
  tradeImpactSheetMobile: { width: '100%', maxWidth: '100%', marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  tradeImpactHandle: { width: 52, height: 5, borderRadius: 3, backgroundColor: appColors.textMuted, alignSelf: 'center', marginTop: 10 },
  tradeImpactHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: appColors.border },
  tradeImpactTitle: { color: appColors.textPrimary, fontSize: 20, fontWeight: '900' }, tradeImpactSubtitle: { color: appColors.textSecondary, fontSize: 12, marginTop: 3 },
  tradeImpactClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: appColors.surface, alignItems: 'center', justifyContent: 'center' }, tradeImpactCloseText: { color: appColors.textPrimary, fontSize: 24, lineHeight: 26 },
  tradeImpactToggle: { flexDirection: 'row', alignSelf: 'center', backgroundColor: appColors.surface, borderRadius: appRadius.pill, padding: 3, marginVertical: 12, borderWidth: 1, borderColor: appColors.border },
  tradeImpactToggleButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: appRadius.pill }, tradeImpactToggleButtonActive: { backgroundColor: appColors.accentFill }, tradeImpactToggleText: { color: appColors.textMuted, fontSize: 11, fontWeight: '800' }, tradeImpactToggleTextActive: { color: appColors.accentForeground },
  tradeImpactLoading: { minHeight: 300, justifyContent: 'center' }, tradeImpactContent: { padding: 14, paddingBottom: 24 }, tradeImpactColumns: { flexDirection: 'row', gap: 10 },
  tradeImpactColumn: { flex: 1, minWidth: 0 }, tradeImpactColumnTitle: { color: appColors.accent, fontSize: 11, fontWeight: '900', borderBottomWidth: 1, borderBottomColor: appColors.accentBorder, paddingBottom: 7, marginBottom: 6 },
  tradeImpactPlayer: { backgroundColor: appColors.surface, borderWidth: 1, borderColor: appColors.border, borderRadius: appRadius.medium, padding: 9, marginBottom: 6 }, tradeImpactPlayerTop: { flexDirection: 'row', gap: 5, alignItems: 'center' }, tradeImpactPlayerName: { flex: 1, color: appColors.textPrimary, fontSize: 12, fontWeight: '900' }, tradeImpactPlayerPoints: { color: appColors.textPrimary, fontSize: 16, fontWeight: '900' }, tradeImpactPlayerMeta: { color: appColors.textMuted, fontSize: 9, marginTop: 2 }, tradeImpactPlayerDetail: { color: appColors.textSecondary, fontSize: 9, marginTop: 5 },
  tradeImpactTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 9, borderTopWidth: 1, borderTopColor: appColors.border }, tradeImpactTotalLabel: { color: appColors.textMuted, fontSize: 10, fontWeight: '800' }, tradeImpactTotalValue: { color: appColors.textPrimary, fontSize: 16, fontWeight: '900' }, tradeImpactTooEarly: { color: appColors.textMuted, textAlign: 'center', fontSize: 11, marginTop: 18, lineHeight: 16 },
  waiverStatusMainRow: { flexDirection: 'row', alignItems: 'center', minHeight: 42 },
  waiverWindowIdentity: { width: 66 },
  waiverStatusEyebrow: { ...appTypography.label, color: appColors.accent, fontSize: 8 },
  waiverStatusTitle: { ...appTypography.sectionTitle, color: appColors.textPrimary, marginTop: 1, fontSize: 15 },
  waiverStatusDivider: { width: 1, height: 32, backgroundColor: appColors.border, marginHorizontal: 10 },
  waiverCompactMetric: { width: 48, alignItems: 'flex-start' },
  waiverDeadlineMetric: { flex: 1, minWidth: 0 },
  waiverDeadlineHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  marketStatusBadge: { paddingHorizontal: 6, paddingVertical: 3, backgroundColor: appColors.accentSoft, borderWidth: 1, borderColor: appColors.accentBorder, borderRadius: appRadius.pill },
  marketStatusText: { ...appTypography.label, color: appColors.accent, fontSize: 6 },
  waiverStatusMetricLabel: { ...appTypography.label, color: appColors.textMuted, fontSize: 8 },
  waiverStatusMetricValue: { color: appColors.accent, fontSize: 18, fontWeight: '900', marginTop: 1 },
  waiverStatusMetricMax: { color: appColors.textMuted, fontSize: 9, fontWeight: '800' },
  waiverDeadlineValue: { color: appColors.textPrimary, fontSize: 11, fontWeight: '900', marginTop: 3 },
  marketRuleText: { ...appTypography.metadata, color: appColors.textMuted, fontSize: 9, marginTop: 7 },

  card: {
    backgroundColor: appColors.surface,
    borderWidth: 1,
    borderColor: appColors.borderStrong,
    padding: appSpacing.lg,
    borderRadius: appRadius.medium,
    marginBottom: appSpacing.xl,
  },

  sectionHeader: {
    ...appTypography.sectionTitle,
    color: appColors.textPrimary,
    textTransform: 'uppercase',
    marginBottom: 5,
  },

  sectionSub: {
    color: appColors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: appSpacing.lg,
    lineHeight: 16,
  },

  emptyClaimsBox: {
    padding: appSpacing.xl,
    alignItems: 'center',
    backgroundColor: appColors.backgroundElevated,
    borderRadius: appRadius.medium,
    borderWidth: 1,
    borderColor: appColors.border,
    marginVertical: appSpacing.sm,
  },

  emptyClaimsText: {
    color: appColors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },

  emptyClaimsSub: {
    color: appColors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: appSpacing.sm,
    paddingHorizontal: appSpacing.md,
    lineHeight: 16,
  },

  cleanWaiverRow: {
    flexDirection: 'row',
    backgroundColor: appColors.surfaceRaised,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: appRadius.medium,
    paddingVertical: 9,
    paddingHorizontal: 9,
    marginBottom: appSpacing.sm,
    alignItems: 'center',
  },

  rowSelected: {
    borderColor: appColors.accent,
    backgroundColor: appColors.accentSoft,
  },

  priorityBadge: {
    backgroundColor: appColors.backgroundDeep,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: appColors.borderStrong,
  },

  priorityText: {
    color: appColors.accent,
    fontWeight: '900',
    fontSize: 11,
  },

  waiverSwapFlexContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: appSpacing.sm,
  },

  playerUnitLeft: {
    flex: 1,
    alignItems: 'flex-end',
    paddingRight: appSpacing.sm,
  },

  playerUnitRight: {
    flex: 1,
    alignItems: 'flex-start',
    paddingLeft: appSpacing.sm,
  },

  playerNameCompact: {
    color: appColors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },

  teamCodeText: {
    color: appColors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
  },

  arrowStackColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
  },

  greenArrow: {
    color: appColors.accent,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 12,
  },

  redArrow: {
    color: appColors.danger,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 12,
    marginTop: -2,
  },

  cancelButton: {
    padding: 7,
    marginLeft: 4,
  },

  cancelButtonText: {
    color: appColors.danger,
    fontWeight: '900',
    fontSize: 14,
  },

  ledgerHeaderTitle: {
    ...appTypography.sectionTitle,
    color: appColors.textPrimary,
    textTransform: 'uppercase',
    marginBottom: appSpacing.md,
  },

  emptyLedgerText: {
    color: appColors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },

  ledgerCardSlim: {
    backgroundColor: appColors.surface,
    borderWidth: 1,
    borderColor: appColors.borderStrong,
    padding: appSpacing.md,
    marginBottom: appSpacing.md,
    borderRadius: appRadius.medium,
  },

  ledgerRowMetaSlim: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: appSpacing.sm,
    paddingBottom: appSpacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: appColors.borderSubtle,
  },

  ledgerTypeTextSlim: {
    color: appColors.textPrimary,
    fontSize: 11,
    fontWeight: '900',
    flex: 1,
    marginRight: appSpacing.sm,
  },

  ledgerTimeTextSlim: {
    color: appColors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    marginRight: appSpacing.sm,
  },

  statusBadgeSlim: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: appRadius.small,
    borderWidth: 1,
  },

  badgePending: {
    backgroundColor: appColors.warningSoft,
    borderColor: 'rgba(245, 185, 66, 0.35)',
  },

  badgeSuccess: {
    backgroundColor: appColors.accentSoft,
    borderColor: appColors.accentBorder,
  },

  badgeDanger: {
    backgroundColor: appColors.dangerSoft,
    borderColor: appColors.dangerBorder,
  },

  badgeCountered: {
    backgroundColor: appColors.infoSoft,
    borderColor: 'rgba(56, 167, 255, 0.35)',
  },

  badgeCancelled: {
    backgroundColor: appColors.surfaceMuted,
    borderColor: appColors.borderStrong,
  },

  statusTextSlim: {
    fontSize: 8,
    fontWeight: '900',
    color: appColors.textPrimary,
    letterSpacing: 0.4,
  },

  stackedBlockContainer: {
    backgroundColor: appColors.backgroundElevated,
    borderRadius: appRadius.medium,
    padding: appSpacing.md,
    borderWidth: 1,
    borderColor: appColors.border,
  },

  assetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: appSpacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: appColors.borderSubtle,
    paddingBottom: appSpacing.sm,
  },

  assetHeaderLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: appColors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  arrowSpacer: {
    width: 30,
  },

  assetGrid: {
    gap: 7,
  },

  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
  },

  colLeft: {
    flex: 1,
    minWidth: 0,
    paddingRight: appSpacing.sm,
  },

  colRight: {
    flex: 1,
    minWidth: 0,
    paddingLeft: appSpacing.sm,
  },

  textRight: {
    textAlign: 'right',
  },

  arrowStackContainer: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },

  arrowIn: {
    color: appColors.accent,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 12,
  },

  arrowOut: {
    color: appColors.danger,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 12,
  },

  playerTextRequested: {
    color: appColors.accent,
    fontSize: 12,
    fontWeight: '800',
  },

  playerTextOffered: {
    color: appColors.danger,
    fontSize: 12,
    fontWeight: '800',
  },

  metaText: {
    color: appColors.textMuted,
    fontSize: 9,
    fontWeight: '700',
  },

  emptyAssetText: {
    color: appColors.textDisabled,
    fontSize: 11,
  },

  interactiveRowBarSlim: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: appSpacing.md,
    paddingTop: appSpacing.md,
    borderTopWidth: 1,
    borderTopColor: appColors.borderSubtle,
  },

  inlineActionBtnSlim: {
    flex: 1,
    minHeight: 34,
    borderRadius: appRadius.small,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
  },

  bgBtnReject: {
    backgroundColor: appColors.dangerSoft,
    borderColor: appColors.danger,
  },

  bgBtnCounter: {
    backgroundColor: appColors.surfaceRaised,
    borderColor: appColors.borderStrong,
  },

  bgBtnAccept: {
    backgroundColor: appColors.accentFill,
    borderColor: appColors.accentDark,
  },

  bgBtnCancel: {
    backgroundColor: appColors.dangerSoft,
    borderColor: appColors.dangerBorder,
  },

  lblTextReject: {
    color: appColors.danger,
    fontSize: 10,
    fontWeight: '900',
  },

  lblTextCounter: {
    color: appColors.textSecondary,
    fontSize: 10,
    fontWeight: '900',
  },

  lblTextAccept: {
    color: appColors.accentForeground,
    fontSize: 10,
    fontWeight: '900',
  },

  lblTextCancel: {
    color: appColors.danger,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.2,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(1, 7, 12, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: appSpacing.lg,
  },
  modalOverlayMobile: { justifyContent: 'flex-start', alignItems: 'stretch', padding: 0 },

  tradeModalContent: {
    backgroundColor: appColors.surfaceRaised,
    width: '95%',
    maxWidth: 900,
    height: '82%',
    borderRadius: appRadius.large,
    padding: appSpacing.lg,
    borderWidth: 1,
    borderColor: appColors.borderStrong,
  },
  tradeModalContentMobile: { width: '100%', maxWidth: undefined, height: '100%', borderRadius: 0, paddingHorizontal: 6, borderWidth: 0 },

  modalTitle: {
    color: appColors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 4,
  },
  modalTitleMobile: { fontSize: 14, marginBottom: 1 },

  tradeSubHeader: {
    color: appColors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: appSpacing.md,
    textTransform: 'uppercase',
  },
  tradeSubHeaderMobile: { fontSize: 9, marginBottom: 2 },

  tradeLayoutGrid: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: appSpacing.sm,
    gap: appSpacing.md,
  },
  tradeLayoutGridMobile: { marginBottom: 3, gap: 4 },

  tradeCol: {
    flex: 1,
    minWidth: 0,
    backgroundColor: appColors.backgroundElevated,
    borderRadius: appRadius.medium,
    padding: appSpacing.sm,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  tradeColMobile: { padding: 3, borderRadius: 5 },

  colTitle: {
    color: appColors.textSecondary,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: appSpacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
    paddingBottom: appSpacing.sm,
  },
  colTitleMobile: { fontSize: 8, marginBottom: 2, paddingBottom: 2, letterSpacing: 0.2 },

  tradeScrollView: {
    flex: 1,
  },
  tradeScrollContentMobile: {
    flexGrow: 1,
  },

  tradeSelectorCardCompact: {
    backgroundColor: appColors.surface,
    borderRadius: appRadius.small,
    paddingVertical: 8,
    paddingHorizontal: 9,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  tradeSelectorCardMobile: {
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 3,
    backgroundColor: appColors.surfaceRaised,
  },
  tradeSelectorCardShortMobile: { paddingVertical: 2, marginBottom: 1 },
  tradeSelectorCardFillMobile: {
    flexGrow: 1,
    flexBasis: 0,
    justifyContent: 'center',
  },

  tradeSelectorCardSelected: {
    borderColor: appColors.accent,
    backgroundColor: appColors.accentSoft,
  },

  tradeCardRowFlow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },

  tradeCardTextCompact: {
    color: appColors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
    marginRight: 7,
  },

  tradePlayerIdentity: {
    flex: 1,
    minWidth: 0,
  },
  tradePlayerIdentityMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  tradeCardTextMobile: { fontSize: 9, lineHeight: 10, marginRight: 0 },

  tradeCardMetaMobile: {
    color: appColors.textMuted,
    fontSize: 7,
    lineHeight: 8,
    fontWeight: '800',
  },

  tradeCardMetaRowMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },

  miniPosBadgeMobile: {
    minWidth: 24,
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
    alignItems: 'center',
  },

  miniPosTextMobile: {
    color: appColors.accentForeground,
    fontSize: 6,
    lineHeight: 7,
    fontWeight: '900',
  },

  tradeCardTextSelected: {
    color: appColors.accent,
  },

  tradeCardMetaTextCompact: {
    color: appColors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    marginRight: 7,
    flexShrink: 0,
  },

  miniPosBadgeCompact: {
    minWidth: 31,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: appRadius.small,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },

  miniPosTextCompact: {
    color: appColors.backgroundDeep,
    fontSize: 7,
    fontWeight: '900',
  },

  tradeLockNotice: {
    color: appColors.textSecondary,
    fontSize: 10,
    textAlign: 'center',
    marginVertical: appSpacing.sm,
    paddingHorizontal: appSpacing.md,
    lineHeight: 15,
    flexShrink: 0,
  },
  tradeLockNoticeMobile: { fontSize: 8, lineHeight: 10, marginVertical: 2, paddingHorizontal: 4 },

  tradeSelectorCardDisabled: {
    opacity: 0.5,
    borderColor: appColors.borderSubtle,
    backgroundColor: appColors.backgroundDeep,
  },

  tradeCardTextDisabled: {
    color: appColors.textDisabled,
  },

  modalActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: appSpacing.sm,
    flexShrink: 0,
  },
  modalActionRowMobile: { marginTop: 2 },

  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: appRadius.medium,
    alignItems: 'center',
    marginHorizontal: 5,
    justifyContent: 'center',
    borderWidth: 1,
  },

  modalButtonCancel: {
    backgroundColor: appColors.surfaceMuted,
    borderColor: appColors.borderStrong,
  },

  modalButtonConfirm: {
    backgroundColor: appColors.accentFill,
    borderColor: appColors.accentDark,
  },

  modalButtonCancelText: {
    color: appColors.textPrimary,
    fontWeight: '800',
    fontSize: 13,
  },

  modalButtonConfirmText: {
    color: appColors.accentForeground,
    fontWeight: '900',
    fontSize: 13,
  },
});
