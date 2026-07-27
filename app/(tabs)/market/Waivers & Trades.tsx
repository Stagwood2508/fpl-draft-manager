import React, { useEffect, useState } from 'react';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  Dimensions
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../../../utils/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COUNTERED' | 'CANCELLED';
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
}

interface GroupedTradePackage {
  batchKey: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COUNTERED' | 'CANCELLED';
  created_at: string;
  sender_id: string;
  receiver_id: string;
  sender_display_name: string;
  receiver_display_name: string;
  playersIn: PlayerAsset[];   // Stacked array of all players YOU receive (Requested)
  playersOut: PlayerAsset[];  // Stacked array of all players YOU give away (Offered)
  originalRowIds: string[];   // Underlying database entry record keys
  rawTransactionObject: TransactionRecord; // Context mirror reference
}

interface WaiverClaim {
  id: string;
  priority_order: number;
  add_player: PlayerAsset;
  drop_player: PlayerAsset;
}

const POSITION_COLORS: Record<string, string> = {
  GKP: '#FFC107',
  DEF: '#00A2FF',
  MID: '#00FF87',
  FWD: '#FF0055',
};

export default function TransactionsScreen() {
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const [activeTab, setActiveTab] = useState<'WAIVERS' | 'OFFERS' | 'HISTORY'>('WAIVERS');
  const [userId, setUserId] = useState<string | null>(null);
  const [leagueId, setLeagueId] = useState<string | null>(null);

  const [myRoster, setMyRoster] = useState<PlayerAsset[]>([]);
  const [pendingRequests, setPendingRequests] = useState<TransactionRecord[]>([]);

  const [pendingWaiverClaims, setPendingWaiverClaims] = useState<WaiverClaim[]>([]);
  const [selectedWaiverClaimId, setSelectedWaiverClaimId] = useState<string | null>(null);

  // INLINE COUNTER MODAL STATE ENGINE
  const [isCounterModalVisible, setIsCounterModalVisible] = useState(false);
  const [activeCounterTrade, setActiveCounterTrade] = useState<TransactionRecord | null>(null);
  const [myCounterRoster, setMyCounterRoster] = useState<PlayerAsset[]>([]);
  const [rivalCounterRoster, setRivalCounterRoster] = useState<PlayerAsset[]>([]);
  const [mySelectedTradeIds, setMySelectedTradeIds] = useState<number[]>([]);
  const [rivalSelectedTradeIds, setRivalSelectedTradeIds] = useState<number[]>([]);

  const POSITION_ORDER = ['GKP', 'DEF', 'MID', 'FWD'];
  const sortRosterByPosition = (roster: PlayerAsset[]) => {
    return [...roster].sort((a, b) => POSITION_ORDER.indexOf(a.element_type) - POSITION_ORDER.indexOf(b.element_type));
  };

  useEffect(() => {
    if (isFocused) {
      fetchTransactionContext();
    }
  }, [isFocused, activeTab]);

  const fetchTransactionContext = async () => {
    try {
      setLoading(true);
      
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error('Authentication failure.');
      setUserId(user.id);

      const { data: memberData, error: memberErr } = await supabase
        .from('league_members')
        .select('league_id')
        .limit(1)
        .single();

      if (memberErr || !memberData) throw new Error('Active league context lost.');
      const currentLeagueId = memberData.league_id;
      setLeagueId(currentLeagueId);

      const { data: myRosterData } = await supabase
        .from('rosters')
        .select('players(*)')
        .eq('league_id', currentLeagueId)
        .eq('user_id', user.id);
      setMyRoster((myRosterData?.map(r => Array.isArray(r.players) ? r.players[0] : r.players).filter(Boolean) || []) as unknown as PlayerAsset[]);

      const { data: txnData } = await supabase
        .from('transactions')
        .select(`
          id, type, status, created_at, sender_id, receiver_id, player_in_id, player_out_id,
          parent_transaction_id,
          player_in:players!transactions_player_in_id_fkey(*),
          player_out:players!transactions_player_out_id_fkey(*),
          sender_profile:profiles!transactions_sender_id_fkey(display_name),
          receiver_profile:profiles!transactions_receiver_id_fkey(display_name)
        `)
        .eq('league_id', currentLeagueId)
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false });
      setPendingRequests((txnData || []) as unknown as TransactionRecord[]);

      if (activeTab === 'WAIVERS') {
        const { data: claimsData, error: claimsErr } = await supabase
          .from('waiver_claims')
          .select(`
            id, priority_order,
            add_player:player_to_add (id, first_name, second_name, web_name, team_name, element_type),
            drop_player:player_to_drop (id, first_name, second_name, web_name, team_name, element_type)
          `)
          .eq('user_id', user.id)
          .eq('league_id', currentLeagueId)
          .eq('status', 'pending')
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
          rawTransactionObject: item
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

  const handleBatchAcceptTrade = async (packageData: GroupedTradePackage) => {
    Alert.alert(
      'Accept Trade Proposal', 
      `Finalize this package swap with ${packageData.sender_display_name}?`, 
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept Package',
          onPress: async () => {
            try {
              setProcessing(true);
              
              const targetTxnId = packageData.batchKey || packageData.originalRowIds[0];
              const { data, error } = await supabase.rpc('accept_trade_transaction', {
                p_transaction_id: targetTxnId
              });

              if (error) throw error;
              if (data && !data.success) throw new Error(data.error);

              const involvedPlayerIds = [
                ...packageData.playersIn.map(p => p.id),
                ...packageData.playersOut.map(p => p.id)
              ];

              if (involvedPlayerIds.length > 0) {
                await supabase
                  .from('waiver_claims')
                  .delete()
                  .eq('league_id', leagueId)
                  .eq('status', 'pending')
                  .or(`player_to_drop.in.(${involvedPlayerIds.join(',')}),player_to_add.in.(${involvedPlayerIds.join(',')})`);
              }

              Alert.alert('Success', 'Trade executed! All players have been swapped successfully.');
              fetchTransactionContext();
            } catch (err: any) {
              Alert.alert('Transaction Failed', err.message);
            } finally {
              setProcessing(false);
            }
          }
        }
      ]
    );
  };

  const handleBatchRejectTrade = async (packageData: GroupedTradePackage) => {
    Alert.alert('Decline Trade Offer', 'Permanently decline this package deal?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          try {
            setProcessing(true);
            const { error } = await supabase
              .from('transactions')
              .update({ status: 'REJECTED' })
              .or(`id.in.(${packageData.originalRowIds.join(',')}),parent_transaction_id.eq.${packageData.batchKey}`);

            if (error) throw error;
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

  const handleBatchCancelTrade = async (packageData: GroupedTradePackage) => {
    Alert.alert('Withdraw Proposal', 'Pull your pending trade assets out of this offer queue?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            setProcessing(true);
            const { error } = await supabase
              .from('transactions')
              .update({ status: 'CANCELLED' })
              .or(`id.in.(${packageData.originalRowIds.join(',')}),parent_transaction_id.eq.${packageData.batchKey}`);

            if (error) throw error;
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

  const handleCounterTradeOffer = async (trade: TransactionRecord) => {
    setProcessing(true);
    try {
      setActiveCounterTrade(trade);
      const { data: rivalData } = await supabase.from('rosters').select('players(*)').eq('league_id', leagueId).eq('user_id', trade.sender_id);
      const parsedRivalRoster = (rivalData?.map(r => Array.isArray(r.players) ? r.players[0] : r.players).filter(Boolean) || []) as PlayerAsset[];

      setMyCounterRoster(sortRosterByPosition(myRoster));
      setRivalCounterRoster(sortRosterByPosition(parsedRivalRoster));

      setRivalSelectedTradeIds([trade.player_out_id]);
      setMySelectedTradeIds([trade.player_in_id]);

      setIsCounterModalVisible(true);
    } catch (err: any) {
      Alert.alert('Counter Configuration Failed', err.message);
    } finally {
      setProcessing(false);
    }
  };

  const toggleSelectMyTradePlayer = (id: number) => {
    const player = myCounterRoster.find(p => p.id === id);
    if (!player) return;
    const pos = player.element_type;
    const totalDemandedOfThisPos = rivalCounterRoster.filter(p => rivalSelectedTradeIds.includes(p.id) && p.element_type === pos).length;

    setMySelectedTradeIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      const currentSelectedOfThisPos = myCounterRoster.filter(p => prev.includes(p.id) && p.element_type === pos).length;
      if (currentSelectedOfThisPos >= totalDemandedOfThisPos) {
        Alert.alert('Position Lock', `Select a ${pos} from their squad before offering an additional ${pos}.`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const toggleSelectRivalTradePlayer = (id: number) => {
    setRivalSelectedTradeIds(prev => {
      const nextSelection = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      setMySelectedTradeIds(currentMySelections => {
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
    if (mySelectedTradeIds.length === 0 || rivalSelectedTradeIds.length === 0 || !activeCounterTrade) return;
    try {
      setProcessing(true);

      const originalBatchKey = activeCounterTrade.parent_transaction_id || activeCounterTrade.id;
      const { error: updateErr } = await supabase
        .from('transactions')
        .update({ status: 'COUNTERED' })
        .or(`id.eq.${activeCounterTrade.id},parent_transaction_id.eq.${originalBatchKey}`);

      if (updateErr) throw updateErr;

      const myTradePlayers = sortRosterByPosition(myCounterRoster.filter(p => mySelectedTradeIds.includes(p.id)));
      const rivalTradePlayers = sortRosterByPosition(rivalCounterRoster.filter(p => rivalSelectedTradeIds.includes(p.id)));

      const counterBatchId = uuidv4();
      const counterPayload: any[] = [];

      for (let i = 0; i < myTradePlayers.length; i++) {
        counterPayload.push({
          league_id: leagueId,
          sender_id: userId,
          receiver_id: activeCounterTrade.sender_id,
          type: 'TRADE',
          status: 'PENDING',
          player_out_id: myTradePlayers[i].id,
          player_in_id: rivalTradePlayers[i] ? rivalTradePlayers[i].id : null,
          parent_transaction_id: counterBatchId
        });
      }

      const { error: insertErr } = await supabase.from('transactions').insert(counterPayload);
      if (insertErr) throw insertErr;

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
      const [res1, res2] = await Promise.all([
        supabase.from('waiver_claims').update({ priority_order: claimB.priority_order }).eq('id', selectedWaiverClaimId),
        supabase.from('waiver_claims').update({ priority_order: claimA.priority_order }).eq('id', targetId)
      ]);
      if (res1.error) throw res1.error;
      if (res2.error) throw res2.error;
      setSelectedWaiverClaimId(null);
      await fetchTransactionContext();
    } catch (err: any) {
      Alert.alert("Priority Swap Failed", err.message);
      setSelectedWaiverClaimId(null);
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelWaiverClaim = async (claimId: string) => {
    Alert.alert("Cancel Claim", "Remove this waiver request from your active queue?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, Remove",
        onPress: async () => {
          try {
            setProcessing(true);
            const { error } = await supabase.from('waiver_claims').delete().eq('id', claimId);
            if (error) throw error;
            await fetchTransactionContext();
          } catch (err: any) {
            Alert.alert("Cancellation Failed", err.message);
          } finally {
            setProcessing(false);
          }
        }
      }
    ]);
  };

  const getShortTeamCode = (name: string) => {
    if (!name) return 'FA';
    return name.slice(0, 3).toUpperCase();
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

                    <TouchableOpacity style={styles.cancelButton} onPress={() => handleCancelWaiverClaim(item.id)}>
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
                      <Text style={styles.ledgerTimeTextSlim}>{new Date(pkg.created_at).toLocaleDateString()}</Text>
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
                        <TouchableOpacity style={[styles.inlineActionBtnSlim, styles.bgBtnCounter]} onPress={() => handleCounterTradeOffer(pkg.rawTransactionObject)} disabled={processing}>
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
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* INLINE COUNTER NEGOTIATION DESK CARD MODAL */}
      <Modal visible={isCounterModalVisible} animationType="slide" transparent={true} onRequestClose={() => setIsCounterModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.tradeModalContent}>
            <Text style={styles.modalTitle}>Construct Counter Offer</Text>
            <Text style={styles.tradeSubHeader}>Target Partner: {activeCounterTrade?.sender_profile?.display_name}</Text>

            <View style={styles.tradeLayoutGrid}>
              <View style={styles.tradeCol}>
                <Text style={styles.colTitle}>Send My Asset(s)</Text>
                <ScrollView style={styles.tradeScrollView}>
                  {myCounterRoster.map(p => {
                    const isSelected = mySelectedTradeIds.includes(p.id);
                    const pos = p.element_type;
                    const demandedPlayers = rivalCounterRoster.filter(r => rivalSelectedTradeIds.includes(r.id));
                    const totalDemandedOfThisPos = demandedPlayers.filter(r => r.element_type === pos).length;
                    const currentlySelectedOfThisPos = myCounterRoster.filter(r => mySelectedTradeIds.includes(r.id) && r.element_type === pos).length;
                    const isSelectionDisabled = !isSelected && currentlySelectedOfThisPos >= totalDemandedOfThisPos;

                    return (
                      <TouchableOpacity 
                        key={p.id} 
                        style={[
                          styles.tradeSelectorCardCompact, 
                          isSelected && styles.tradeSelectorCardSelected,
                          isSelectionDisabled && styles.tradeSelectorCardDisabled
                        ]}
                        onPress={() => toggleSelectMyTradePlayer(p.id)}
                        disabled={isSelectionDisabled}
                      >
                        <View style={styles.tradeCardRowFlow}>
                          <Text style={[styles.tradeCardTextCompact, isSelected && styles.tradeCardTextSelected, isSelectionDisabled && styles.tradeCardTextDisabled]} numberOfLines={1}>
                            {p.web_name}
                          </Text>
                          <Text style={styles.tradeCardMetaTextCompact}>{getShortTeamCode(p.team_name)}</Text>
                          <View style={[styles.miniPosBadgeCompact, { backgroundColor: POSITION_COLORS[p.element_type] || '#222' }]}>
                            <Text style={styles.miniPosTextCompact}>{p.element_type}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.tradeCol}>
                <Text style={styles.colTitle}>Demand Asset(s)</Text>
                <ScrollView style={styles.tradeScrollView}>
                  {rivalCounterRoster.map(p => {
                    const isSelected = rivalSelectedTradeIds.includes(p.id);
                    return (
                      <TouchableOpacity key={p.id} style={[styles.tradeSelectorCardCompact, isSelected && styles.tradeSelectorCardSelected]} onPress={() => toggleSelectRivalTradePlayer(p.id)}>
                        <View style={styles.tradeCardRowFlow}>
                          <Text style={[styles.tradeCardTextCompact, isSelected && styles.tradeCardTextSelected]} numberOfLines={1}>
                            {p.web_name}
                          </Text>
                          <Text style={styles.tradeCardMetaTextCompact}>{getShortTeamCode(p.team_name)}</Text>
                          <View style={[styles.miniPosBadgeCompact, { backgroundColor: POSITION_COLORS[p.element_type] || '#222' }]}>
                            <Text style={styles.miniPosTextCompact}>{p.element_type}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>

            <Text style={styles.tradeLockNotice}>
              ⚠️ Multi-player swap constraint active: Swaps must be equal size and matching positions (e.g. swap MID for MID, DEF for DEF).
            </Text>

            <View style={styles.modalActionRow}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
  tabContainer: { flexDirection: 'row', backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#222' },
  tabBtn: { flex: 1, paddingVertical: 16, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: '#00ff87', backgroundColor: '#14251c' },
  tabText: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  tabTextActive: { color: '#00ff87', fontWeight: '900' },
  scrollContent: { padding: 14, paddingBottom: 40 },
  card: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 14, borderRadius: 4, marginBottom: 20 },
  sectionHeader: { fontSize: 12, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  sectionSub: { fontSize: 11, color: '#666', fontWeight: '600', marginBottom: 16, lineHeight: 15 },
  emptyClaimsBox: { padding: 24, alignItems: 'center', backgroundColor: '#0A0A0A', borderRadius: 6, borderWidth: 1, borderColor: '#1F1F1F', marginVertical: 8 },
  emptyClaimsText: { color: '#888', fontSize: 13, fontWeight: '700' },
  emptyClaimsSub: { color: '#444', fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 6, paddingHorizontal: 12, lineHeight: 16 },
  cleanWaiverRow: { flexDirection: 'row', backgroundColor: '#161618', borderWidth: 1, borderColor: '#222', borderRadius: 6, paddingVertical: 5, paddingHorizontal: 6, marginBottom: 6, alignItems: 'center' },
  rowSelected: { borderColor: '#00ff87', backgroundColor: '#14251c' },
  priorityBadge: { backgroundColor: '#000', width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#333' },
  priorityText: { color: '#00ff87', fontWeight: '900', fontSize: 11 },
  waiverSwapFlexContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  playerUnitLeft: { flex: 1, alignItems: 'flex-end', paddingRight: 8 },
  playerUnitRight: { flex: 1, alignItems: 'flex-start', paddingLeft: 8 },
  playerNameCompact: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  teamCodeText: { color: '#666', fontSize: 10, fontWeight: '800', marginTop: 1 },
  arrowStackColumn: { alignItems: 'center', justifyContent: 'center', width: 20 },
  greenArrow: { color: '#00ff87', fontSize: 10, fontWeight: '900', lineHeight: 11 },
  redArrow: { color: '#FF3B30', fontSize: 10, fontWeight: '900', lineHeight: 11, marginTop: -2 },
  cancelButton: { padding: 6, marginLeft: 4 },
  cancelButtonText: { color: '#fa0d0d', fontWeight: '800', fontSize: 13 },
  ledgerHeaderTitle: { fontSize: 12, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginLeft: 2 },
  emptyLedgerText: { color: '#333', fontSize: 11, fontWeight: '600', marginLeft: 2, marginTop: 4 },
  ledgerCardSlim: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 12, marginBottom: 10, borderRadius: 6 },
  ledgerRowMetaSlim: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  ledgerTypeTextSlim: { color: '#FFF', fontSize: 10, fontWeight: '900', flex: 1, marginRight: 6 },
  ledgerTimeTextSlim: { color: '#555', fontSize: 9, fontWeight: '700', marginRight: 8 },
  statusBadgeSlim: { paddingVertical: 3, paddingHorizontal: 6, borderRadius: 2 },
  badgePending: { backgroundColor: '#262211' },
  badgeSuccess: { backgroundColor: '#14251c' },
  badgeDanger: { backgroundColor: '#2C0D0E' },
  badgeCountered: { backgroundColor: '#1D2433' },
  badgeCancelled: { backgroundColor: '#3A3A3C' },
  statusTextSlim: { fontSize: 8, fontWeight: '900', color: '#FFF' },
  
  /* 2-Column Side-by-Side Asset Layout Container */
  stackedBlockContainer: { backgroundColor: '#0A0A0A', borderRadius: 4, padding: 8, borderWidth: 1, borderColor: '#191919' },
  assetHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, borderBottomWidth: 1, borderBottomColor: '#1A1A1A', paddingBottom: 4 },
  assetHeaderLabel: { fontSize: 9, fontWeight: '900', color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 },
  arrowSpacer: { width: 24 },
  assetGrid: { gap: 4 },
  assetRow: { flexDirection: 'row', alignItems: 'center' },
  colLeft: { flex: 1, paddingRight: 4 },
  colRight: { flex: 1, paddingLeft: 4 },
  textRight: { textAlign: 'right' },

  /* Center Vertical Arrow Stack */
  arrowStackContainer: { width: 24, alignItems: 'center', justifyContent: 'center' },
  arrowIn: { color: '#00ff87', fontSize: 10, fontWeight: '900', lineHeight: 11 },
  arrowOut: { color: '#FF3B30', fontSize: 10, fontWeight: '900', lineHeight: 11 },

  /* Text Colors */
  playerTextRequested: { color: '#00ff87', fontSize: 11, fontWeight: '800' },
  playerTextOffered: { color: '#FF3B30', fontSize: 11, fontWeight: '800' },
  metaText: { color: '#555', fontSize: 10, fontWeight: '700' },
  emptyAssetText: { color: '#333', fontSize: 11 },

  interactiveRowBarSlim: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1c1c1c' },
  inlineActionBtnSlim: { flex: 1, height: 26, borderRadius: 3, justifyContent: 'center', alignItems: 'center', marginHorizontal: 3 },
  bgBtnReject: { backgroundColor: '#FF3B3018', borderWidth: 1, borderColor: '#FF3B30' },
  bgBtnCounter: { backgroundColor: '#1F1F24', borderWidth: 1, borderColor: '#444' },
  bgBtnAccept: { backgroundColor: '#00ff87' },
  bgBtnCancel: { backgroundColor: '#FF3B3012', borderWidth: 1, borderColor: '#FF3B30A0' },
  lblTextReject: { color: '#FF3B30', fontSize: 10, fontWeight: '900' },
  lblTextCounter: { color: '#AAA', fontSize: 10, fontWeight: '900' },
  lblTextAccept: { color: '#000', fontSize: 10, fontWeight: '900' },
  lblTextCancel: { color: '#FF3B30', fontSize: 10, fontWeight: '900', letterSpacing: 0.2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  tradeModalContent: { backgroundColor: '#161616', width: '95%', maxHeight: '85%', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#333' },
  tradeSubHeader: { color: '#666', fontSize: 12, fontWeight: '800', textAlign: 'center', marginBottom: 12, textTransform: 'uppercase' },
  tradeLayoutGrid: { flexDirection: 'row', justifyContent: 'space-between', height: 320, marginBottom: 10 },
  tradeCol: { flex: 1, backgroundColor: '#0E0E10', marginHorizontal: 4, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#222' },
  colTitle: { color: '#888', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center', marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#222', paddingBottom: 6 },
  tradeScrollView: { flex: 1 },
  tradeSelectorCardCompact: { backgroundColor: '#18181B', borderRadius: 4, paddingVertical: 6, paddingHorizontal: 8, marginBottom: 4, borderWidth: 1, borderColor: '#2E2E33' },
  tradeSelectorCardSelected: { borderColor: '#00ff87', backgroundColor: '#00ff8710' },
  tradeCardRowFlow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tradeCardTextCompact: { color: '#CCC', fontSize: 11, fontWeight: '700', flex: 1, marginRight: 6 },
  tradeCardTextSelected: { color: '#00ff87' },
  tradeCardMetaTextCompact: { color: '#555', fontSize: 9, fontWeight: '800', marginRight: 6 },
  miniPosBadgeCompact: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2, justifyContent: 'center', alignItems: 'center' },
  miniPosTextCompact: { color: '#000', fontSize: 7, fontWeight: '900' },
  tradeLockNotice: { color: '#888', fontSize: 10, textAlign: 'center', marginVertical: 6, paddingHorizontal: 12, lineHeight: 14, fontStyle: 'italic' },
  tradeSelectorCardDisabled: { opacity: 0.25, borderColor: '#111', backgroundColor: '#09090B' },
  tradeCardTextDisabled: { color: '#444' },
  modalActionRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginHorizontal: 6, justifyContent: 'center' },
  modalButtonCancel: { backgroundColor: '#333' },
  modalButtonConfirm: { backgroundColor: '#00ff87' },
  modalButtonCancelText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  modalButtonConfirmText: { color: '#000', fontWeight: '800', fontSize: 13 },
  modalTitle: { color: '#FFF', fontSize: 16, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' }
});