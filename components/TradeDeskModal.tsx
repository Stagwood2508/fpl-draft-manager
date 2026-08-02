import React, { useState, useEffect } from 'react';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';

interface PlayerAsset {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  element_type: string;
  team_name: string;
}

interface OwnershipInfo {
  userId: string;
  display_name: string;
}

interface TradeDeskModalProps {
  visible: boolean;
  onClose: () => void;
  targetPlayer: PlayerAsset | null;
  tradePartner: OwnershipInfo | null;
  leagueId: string | null;
  currentUserId: string | null;
  onSuccess?: () => void;
}

const POSITION_COLORS: Record<string, string> = {
  GKP: '#FFC107',
  DEF: '#00A2FF',
  MID: '#00FF87',
  FWD: '#FF0055',
};

const POSITION_ORDER = ['GKP', 'DEF', 'MID', 'FWD'];

export default function TradeDeskModal({
  visible,
  onClose,
  targetPlayer,
  tradePartner,
  leagueId,
  currentUserId,
  onSuccess
}: TradeDeskModalProps) {
  const [modalLoading, setModalLoading] = useState(false);
  const [rosterType, setRosterType] = useState<'STRICT' | 'FLEXIBLE'>('STRICT');
  
  const [myTradeRoster, setMyTradeRoster] = useState<PlayerAsset[]>([]);
  const [rivalTradeRoster, setRivalTradeRoster] = useState<PlayerAsset[]>([]);
  const [mySelectedTradeIds, setMySelectedTradeIds] = useState<number[]>([]);
  const [rivalSelectedTradeIds, setRivalSelectedTradeIds] = useState<number[]>([]);

  const sortRosterByPosition = (roster: PlayerAsset[]) => {
    return [...roster].sort((a, b) => POSITION_ORDER.indexOf(a.element_type) - POSITION_ORDER.indexOf(b.element_type));
  };

  useEffect(() => {
    if (visible && targetPlayer && tradePartner) {
      loadTradeModalContext();
    }
  }, [visible, targetPlayer, tradePartner, leagueId]);

  const loadTradeModalContext = async () => {
    if (!targetPlayer || !tradePartner) return;
    try {
      setModalLoading(true);
      setRivalSelectedTradeIds([targetPlayer.id]);
      setMySelectedTradeIds([]);

      // 1. Resolve Active League ID (Prop > AsyncStorage fallback)
      let resolvedLeagueId = leagueId;
      if (!resolvedLeagueId) {
        resolvedLeagueId = await AsyncStorage.getItem('active_league_id');
      }

      if (!resolvedLeagueId) throw new Error('No active league context found.');

      // 2. Resolve Active User ID if missing
      let resolvedUserId = currentUserId;
      if (!resolvedUserId) {
        const { data: { user } } = await supabase.auth.getUser();
        resolvedUserId = user?.id || null;
      }

      if (!resolvedUserId) throw new Error('Authentication frame unverified.');

      // 3. Fetch League Configuration (roster_type)
      const { data: leagueData } = await supabase
        .from('leagues')
        .select('roster_type')
        .eq('id', resolvedLeagueId)
        .maybeSingle();

      if (leagueData?.roster_type) {
        setRosterType(leagueData.roster_type as 'STRICT' | 'FLEXIBLE');
      }

      // 4. Fetch Both Roster Packages strictly for the resolved active league
      const [myDataRes, rivalDataRes] = await Promise.all([
        supabase.from('rosters').select('players(*)').eq('league_id', resolvedLeagueId).eq('user_id', resolvedUserId),
        supabase.from('rosters').select('players(*)').eq('league_id', resolvedLeagueId).eq('user_id', tradePartner.userId)
      ]);

      const parsedMy = (myDataRes.data?.map(r => Array.isArray(r.players) ? r.players[0] : r.players).filter(Boolean) || []) as PlayerAsset[];
      const parsedRival = (rivalDataRes.data?.map(r => Array.isArray(r.players) ? r.players[0] : r.players).filter(Boolean) || []) as PlayerAsset[];

      setMyTradeRoster(sortRosterByPosition(parsedMy));
      setRivalTradeRoster(sortRosterByPosition(parsedRival));
    } catch (err: any) {
      Alert.alert('Trade Load Error', err.message);
    } finally {
      setModalLoading(false);
    }
  };

  const toggleSelectMyTradePlayer = (id: number) => {
    const player = myTradeRoster.find(p => p.id === id);
    if (!player) return;
    const pos = player.element_type;

    const demandedPlayers = rivalTradeRoster.filter(p => rivalSelectedTradeIds.includes(p.id));

    setMySelectedTradeIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);

      if (rosterType === 'STRICT') {
        const totalDemandedOfThisPos = demandedPlayers.filter(p => p.element_type === pos).length;
        const selectedOfThisPos = myTradeRoster.filter(p => prev.includes(p.id) && p.element_type === pos).length;

        if (selectedOfThisPos >= totalDemandedOfThisPos) {
          Alert.alert('Position Lock (Strict Mode)', `You must request another ${pos} from your trading partner before offering an additional ${pos}.`);
          return prev;
        }
      } else {
        // FLEXIBLE MODE LOGIC
        if (pos === 'GKP') {
          const demandedGKP = demandedPlayers.filter(p => p.element_type === 'GKP').length;
          const selectedGKP = myTradeRoster.filter(p => prev.includes(p.id) && p.element_type === 'GKP').length;
          if (selectedGKP >= demandedGKP) {
            Alert.alert('Goalkeeper Lock', 'Goalkeepers must be traded 1-to-1 for Goalkeepers.');
            return prev;
          }
        } else {
          const demandedOutfield = demandedPlayers.filter(p => p.element_type !== 'GKP').length;
          const selectedOutfield = myTradeRoster.filter(p => prev.includes(p.id) && p.element_type !== 'GKP').length;
          if (selectedOutfield >= demandedOutfield) {
            Alert.alert('Outfield Trade Cap', `You have requested ${demandedOutfield} outfield player(s). Request another player before adding more to your offer.`);
            return prev;
          }
        }
      }

      return [...prev, id];
    });
  };

  const toggleSelectRivalTradePlayer = (id: number) => {
    setRivalSelectedTradeIds(prev => {
      const nextSelection = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      
      // Auto-prune offered players if requested count decreases
      setMySelectedTradeIds(currentMySelections => {
        const demanded = rivalTradeRoster.filter(p => nextSelection.includes(p.id));

        if (rosterType === 'STRICT') {
          const demandCounts: Record<string, number> = {};
          demanded.forEach(p => { demandCounts[p.element_type] = (demandCounts[p.element_type] || 0) + 1; });

          const pruned: number[] = [];
          const allocated: Record<string, number> = {};

          currentMySelections.forEach(myId => {
            const p = myTradeRoster.find(x => x.id === myId);
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
        } else {
          // FLEXIBLE MODE PRUNING
          const demandedGKP = demanded.filter(p => p.element_type === 'GKP').length;
          const demandedOutfield = demanded.filter(p => p.element_type !== 'GKP').length;

          let currentGKP = 0;
          let currentOutfield = 0;
          const pruned: number[] = [];

          currentMySelections.forEach(myId => {
            const p = myTradeRoster.find(x => x.id === myId);
            if (p) {
              if (p.element_type === 'GKP') {
                if (currentGKP < demandedGKP) {
                  pruned.push(myId);
                  currentGKP++;
                }
              } else {
                if (currentOutfield < demandedOutfield) {
                  pruned.push(myId);
                  currentOutfield++;
                }
              }
            }
          });
          return pruned;
        }
      });
      return nextSelection;
    });
  };

  const handleProposeBilateralTrade = async () => {
    const myTradePlayers = sortRosterByPosition(myTradeRoster.filter(p => mySelectedTradeIds.includes(p.id)));
    const rivalTradePlayers = sortRosterByPosition(rivalTradeRoster.filter(p => rivalSelectedTradeIds.includes(p.id)));

    if (myTradePlayers.length === 0 || rivalTradePlayers.length === 0) {
      Alert.alert('Trade Setup Error', 'Select at least one player to give and receive.');
      return;
    }

    if (myTradePlayers.length !== rivalTradePlayers.length) {
      Alert.alert('Asymmetric Trade', 'Trades must be equal-size player swaps (e.g. 1-for-1, 2-for-2).');
      return;
    }

    let resolvedLeagueId = leagueId || (await AsyncStorage.getItem('active_league_id'));
    let resolvedUserId = currentUserId;
    if (!resolvedUserId) {
      const { data: { user } } = await supabase.auth.getUser();
      resolvedUserId = user?.id || null;
    }

    Alert.alert(
      'Initialize Trade Proposal',
      `Dispatch trade offer to ${tradePartner?.display_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Send Offer', 
          onPress: async () => {
            try {
              setModalLoading(true);
              const batchId = uuidv4();
              const tradePayload: any[] = [];

              for (let i = 0; i < myTradePlayers.length; i++) {
                tradePayload.push({
                  league_id: resolvedLeagueId,
                  sender_id: resolvedUserId,
                  receiver_id: tradePartner?.userId,
                  type: 'TRADE',
                  status: 'PENDING',
                  player_out_id: myTradePlayers[i].id,
                  player_in_id: rivalTradePlayers[i].id,
                  parent_transaction_id: batchId
                });
              }

              const { error } = await supabase.from('transactions').insert(tradePayload);
              if (error) throw error;
              
              Alert.alert('Success', 'Trade proposal successfully dispatched!');
              if (onSuccess) onSuccess();
              onClose();
            } catch (err: any) {
              Alert.alert('Error Dispatching Offer', err.message);
            } finally {
              setModalLoading(false);
            }
          } 
        }
      ]
    );
  };

  const getShortTeamCode = (name: string) => (name ? name.slice(0, 3).toUpperCase() : 'FA');

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.tradeModalContent}>
          <Text style={styles.modalHeader}>Construct Trade Proposal</Text>
          <Text style={tradePartner?.display_name ? styles.tradeSubHeader : { display: 'none' }}>
            Partner: {tradePartner?.display_name} • Mode: {rosterType}
          </Text>

          {modalLoading && myTradeRoster.length === 0 ? (
            <View style={styles.loaderBox}><ActivityIndicator size="large" color="#00ff87" /></View>
          ) : (
            <View style={styles.tradeLayoutGrid}>
              {/* Left Column */}
              <View style={styles.tradeCol}>
                <Text style={styles.colTitle}>Send My Asset(s)</Text>
                <ScrollView style={styles.tradeScrollView}>
                  {myTradeRoster.map(p => {
                    const isSelected = mySelectedTradeIds.includes(p.id);
                    const pos = p.element_type;

                    const demanded = rivalTradeRoster.filter(r => rivalSelectedTradeIds.includes(r.id));
                    let isSelectionDisabled = false;

                    if (rosterType === 'STRICT') {
                      const totalDemanded = demanded.filter(r => r.element_type === pos).length;
                      const currentSelected = myTradeRoster.filter(r => mySelectedTradeIds.includes(r.id) && r.element_type === pos).length;
                      isSelectionDisabled = !isSelected && currentSelected >= totalDemanded;
                    } else {
                      if (pos === 'GKP') {
                        const totalDemandedGkp = demanded.filter(r => r.element_type === 'GKP').length;
                        const currentSelectedGkp = myTradeRoster.filter(r => mySelectedTradeIds.includes(r.id) && r.element_type === 'GKP').length;
                        isSelectionDisabled = !isSelected && currentSelectedGkp >= totalDemandedGkp;
                      } else {
                        const totalDemandedOutfield = demanded.filter(r => r.element_type !== 'GKP').length;
                        const currentSelectedOutfield = myTradeRoster.filter(r => mySelectedTradeIds.includes(r.id) && r.element_type !== 'GKP').length;
                        isSelectionDisabled = !isSelected && currentSelectedOutfield >= totalDemandedOutfield;
                      }
                    }

                    return (
                      <TouchableOpacity 
                        key={p.id} 
                        style={[styles.tradeSelectorCardCompact, isSelected && styles.tradeSelectorCardSelected, isSelectionDisabled && styles.tradeSelectorCardDisabled]}
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

              {/* Right Column */}
              <View style={styles.tradeCol}>
                <Text style={styles.colTitle}>Demand Asset(s)</Text>
                <ScrollView style={styles.tradeScrollView}>
                  {rivalTradeRoster.map(p => {
                    const isSelected = rivalSelectedTradeIds.includes(p.id);
                    return (
                      <TouchableOpacity 
                        key={p.id} 
                        style={[styles.tradeSelectorCardCompact, isSelected && styles.tradeSelectorCardSelected]}
                        onPress={() => toggleSelectRivalTradePlayer(p.id)}
                      >
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
          )}

          <Text style={styles.tradeLockNotice}>
            {rosterType === 'STRICT'
              ? '⚠️ Strict Mode: Swaps must be equal size and matching positions (e.g. MID for MID).'
              : '⚡ Flexible Mode: Equal-sized swaps. Cross-position outfield trading is permitted.'}
          </Text>

          <View style={styles.modalActionRow}>
            <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} onPress={onClose}>
              <Text style={styles.modalButtonCancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.modalButton, styles.modalButtonConfirm]} onPress={handleProposeBilateralTrade}>
              <Text style={styles.modalButtonConfirmText}>Submit Offer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  tradeModalContent: { backgroundColor: '#161616', width: '95%', maxHeight: '85%', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#333' },
  modalHeader: { color: '#FFF', fontSize: 16, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center', marginBottom: 4 },
  tradeSubHeader: { color: '#666', fontSize: 12, fontWeight: '800', textAlign: 'center', marginBottom: 12, textTransform: 'uppercase' },
  tradeLayoutGrid: { flexDirection: 'row', justifyContent: 'space-between', height: 320, marginBottom: 10 },
  tradeCol: { flex: 1, backgroundColor: '#0E0E10', marginHorizontal: 4, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#222' },
  colTitle: { color: '#888', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center', marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#222', paddingBottom: 6 },
  tradeScrollView: { flex: 1 },
  loaderBox: { height: 320, justifyContent: 'center', alignItems: 'center' },
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
  modalActionRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginHorizontal: 6, justifyContent: 'center' },
  modalButtonCancel: { backgroundColor: '#333' },
  modalButtonConfirm: { backgroundColor: '#00ff87' },
  modalButtonCancelText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  modalButtonConfirmText: { color: '#000', fontWeight: '800', fontSize: 13 },
});