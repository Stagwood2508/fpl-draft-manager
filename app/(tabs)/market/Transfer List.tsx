import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '@/utils/supabase';
import TradeDeskModal from '@/components/TradeDeskModal';

interface PlayerAsset {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  element_type: string; 
  team_name: string;
  total_points: number;
}

interface RosterItem {
  id: string;
  user_id: string;
  is_transfer_listed: boolean;
  trade_note: string | null;
  players: PlayerAsset;
}

interface OwnershipInfo {
  userId: string;
  display_name: string;
}

const POSITION_COLORS: Record<string, string> = {
  GKP: '#FFC107',
  DEF: '#00A2FF',
  MID: '#00FF87',
  FWD: '#FF0055',
};

// ⚽ POSITION SORTING WEIGHTS (GKP -> DEF -> MID -> FWD)
const POSITION_ORDER: Record<string, number> = {
  GKP: 1,
  DEF: 2,
  MID: 3,
  FWD: 4,
};

export default function TransferMarketScreen() {
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  // Identity & Context State
  const [userId, setUserId] = useState<string | null>(null);
  const [leagueId, setLeagueId] = useState<string | null>(null);

  // Toggle View State
  const [showManagementPanel, setShowManagementPanel] = useState(false);

  // Listing Pop-up Modal States (For my players)
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedRosterItem, setSelectedRosterItem] = useState<RosterItem | null>(null);
  const [tradeNoteText, setTradeNoteText] = useState('');

  // Detail Modal State (For viewing listed player demands)
  const [isDetailModalVisible, setIsDetailModalVisible] = useState(false);
  const [viewingMarketItem, setViewingMarketItem] = useState<RosterItem | null>(null);

  // Data Arrays
  const [publicMarketFeed, setPublicMarketFeed] = useState<RosterItem[]>([]);
  const [myPersonalRoster, setMyPersonalRoster] = useState<RosterItem[]>([]);

  const [isTradeModalVisible, setIsTradeModalVisible] = useState(false);
  const [tradeTargetPlayer, setTradeTargetPlayer] = useState<PlayerAsset | null>(null);
  const [tradeOwnerInfo, setTradeOwnerInfo] = useState<OwnershipInfo | null>(null);

  useEffect(() => {
    if (isFocused) {
      syncMarketDataEngine();
    }
  }, [isFocused]);

  const syncMarketDataEngine = async () => {
    try {
      setLoading(true);
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error('User authentication lost.');
      setUserId(user.id);

      const { data: memberData, error: memberErr } = await supabase
        .from('league_members')
        .select('league_id')
        .limit(1)
        .single();

      if (memberErr || !memberData) throw new Error('Active league scope undetermined.');
      const currentLeagueId = memberData.league_id;
      setLeagueId(currentLeagueId);

      const { data: rosterData, error: rosterErr } = await supabase
        .from('rosters')
        .select(`
          id,
          user_id,
          is_transfer_listed,
          trade_note,
          players (id, first_name, second_name, web_name, element_type, team_name, total_points)
        `)
        .eq('league_id', currentLeagueId);

      if (rosterErr) throw rosterErr;

      const structuredRoster = (rosterData || []).map((item: any) => ({
        id: item.id,
        user_id: item.user_id,
        is_transfer_listed: item.is_transfer_listed,
        trade_note: item.trade_note,
        players: Array.isArray(item.players) ? item.players[0] : item.players,
      })).filter(r => r.players !== null) as unknown as RosterItem[];

      const sortedPublicFeed = structuredRoster
        .filter(r => r.is_transfer_listed && r.user_id !== user.id)
        .sort((a, b) => (b.players?.total_points || 0) - (a.players?.total_points || 0));

      // 🌟 SORT PERSONAL ROSTER BY POSITION (GKP -> DEF -> MID -> FWD) THEN BY POINTS
      const sortedPersonalRoster = structuredRoster
        .filter(r => r.user_id === user.id)
        .sort((a, b) => {
          const posA = POSITION_ORDER[a.players?.element_type] || 99;
          const posB = POSITION_ORDER[b.players?.element_type] || 99;
          if (posA !== posB) return posA - posB;
          return (b.players?.total_points || 0) - (a.players?.total_points || 0);
        });

      setPublicMarketFeed(sortedPublicFeed);
      setMyPersonalRoster(sortedPersonalRoster);
    } catch (err: any) {
      Alert.alert('Market Synchronization Offline', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSwitch = (item: RosterItem) => {
    if (item.is_transfer_listed) {
      updateTransferBlockDatabase(item.id, false, null);
    } else {
      setSelectedRosterItem(item);
      setTradeNoteText('');
      setIsModalVisible(true);
    }
  };

  const updateTransferBlockDatabase = async (rosterId: string, nextStatus: boolean, note: string | null) => {
    try {
      setMutatingId(rosterId);
      const { error } = await supabase
        .from('rosters')
        .update({ is_transfer_listed: nextStatus, trade_note: nextStatus ? note : null })
        .eq('id', rosterId);

      if (error) throw error;

      setMyPersonalRoster(prev =>
        prev.map(item => (item.id === rosterId ? { ...item, is_transfer_listed: nextStatus, trade_note: note } : item))
      );
      setIsModalVisible(false);
    } catch (err: any) {
      Alert.alert('Database Mutation Rejected', err.message);
    } finally {
      setMutatingId(null);
    }
  };

  const handleSaveListing = () => {
    if (!selectedRosterItem) return;
    updateTransferBlockDatabase(selectedRosterItem.id, true, tradeNoteText.trim() || null);
  };

  const handleProposeTrade = async (targetPlayer: PlayerAsset, rivalId: string) => {
    setIsDetailModalVisible(false);
    setLoading(true);
    try {
      const { data: pData } = await supabase.from('profiles').select('display_name').eq('id', rivalId).single();
      setTradeOwnerInfo({
        userId: rivalId,
        display_name: pData?.display_name || `Manager ${rivalId.slice(0, 4).toUpperCase()}`
      });
      setTradeTargetPlayer(targetPlayer);
      setIsTradeModalVisible(true);
    } catch (err: any) {
      Alert.alert('Trade Engine Pipeline Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDetailModal = (item: RosterItem) => {
    setViewingMarketItem(item);
    setIsDetailModalVisible(true);
  };

  const getShortTeamCode = (name: string) => (name ? name.slice(0, 3).toUpperCase() : 'FA');

  if (loading && publicMarketFeed.length === 0 && myPersonalRoster.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#00ff87" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* MANAGEMENT ACCORDION INTERFACE TRIGGER */}
      <TouchableOpacity
        style={[styles.managementTrigger, showManagementPanel && styles.managementTriggerActive]}
        onPress={() => setShowManagementPanel(!showManagementPanel)}
      >
        <Text style={[styles.triggerText, showManagementPanel && styles.triggerTextActive]}>
          {showManagementPanel ? '✕ CLOSE MY SHOP WINDOW' : '⚙️ MANAGE MY TRANSFER BLOCK'}
        </Text>
      </TouchableOpacity>

      {/* RENDER MODE A: PERSONAL SHOP WINDOW */}
      {showManagementPanel ? (
        <ScrollView style={styles.shelfContainer} contentContainerStyle={styles.shelfContent}>
          <Text style={styles.shelfTitle}>My Roster Availability Logs</Text>
          <Text style={styles.shelfSubtitle}>Toggle items to advertise them onto the global league market wire.</Text>

          {myPersonalRoster.map(item => {
            const player = item.players;
            if (!player) return null;
            const mappedPositionColor = POSITION_COLORS[player.element_type] || '#222';

            return (
              <View key={item.id} style={[styles.shelfRow, item.is_transfer_listed && styles.shelfRowAdvertising]}>
                <View style={styles.shelfIdentityRow}>
                  <Text style={styles.shelfPlayerName} numberOfLines={1}>{player.web_name}</Text>
                  
                  <View style={[styles.miniPosBadgeCompact, { backgroundColor: mappedPositionColor }]}>
                    <Text style={styles.miniPosTextCompact}>{player.element_type}</Text>
                  </View>

                  <Text style={styles.shelfPlayerMeta}>{getShortTeamCode(player.team_name)}</Text>
                  <Text style={styles.shelfPlayerPts}>{player.total_points}PTS</Text>

                  {item.is_transfer_listed && item.trade_note && (
                    <Text style={styles.shelfNotePreview} numberOfLines={1}>
                      "{item.trade_note}"
                    </Text>
                  )}
                </View>

                <Switch
                  value={item.is_transfer_listed}
                  onValueChange={() => handleToggleSwitch(item)}
                  disabled={mutatingId === item.id}
                  trackColor={{ false: '#1A1A1A', true: '#00ff87' }}
                  thumbColor="#FFF"
                  style={{ transform: [{ scaleX: 0.65 }, { scaleY: 0.65 }], marginVertical: -4 }}
                />
              </View>
            );
          })}
        </ScrollView>
      ) : (
        /* RENDER MODE B: LIVE LEAGUE BROADCAST FEED */
        <ScrollView contentContainerStyle={styles.feedContent}>
          <Text style={styles.sectionHeader}>Public League Trading Board</Text>
          
          {publicMarketFeed.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>The transfer block feed is currently empty.</Text>
              <Text style={styles.emptySub}>No rival managers have listed any assets for trade negotiations yet.</Text>
            </View>
          ) : (
            publicMarketFeed.map(item => {
              const player = item.players;
              if (!player) return null;
              const mappedPositionColor = POSITION_COLORS[player.element_type] || '#222';

              return (
                <TouchableOpacity key={item.id} style={styles.cleanRowSlim} activeOpacity={0.7} onPress={() => handleOpenDetailModal(item)}>
                  <View style={styles.cleanInfoColSlim}>
                    <Text style={styles.cleanPlayerNameSlim} numberOfLines={1}>{player.web_name}</Text>
                    <Text style={styles.cleanMetaTextSlim}>{getShortTeamCode(player.team_name)}</Text>
                    <View style={[styles.miniPosBadgeCompact, { backgroundColor: mappedPositionColor }]}>
                      <Text style={styles.miniPosTextCompact}>{player.element_type}</Text>
                    </View>
                  </View>
                  <View style={styles.cleanPointsColSlim}>
                    <Text style={styles.cleanPointsValueSlim}>{player.total_points}</Text>
                    <Text style={styles.cleanPointsLabelSlim}>PTS</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {/* POP-UP MODAL A: SET TRADE NOTE (FOR LISTING) */}
      <Modal visible={isModalVisible} animationType="slide" transparent={true} onRequestClose={() => setIsModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>List Player for Transfer</Text>
            {selectedRosterItem && <Text style={styles.modalPlayerName}>{selectedRosterItem.players.web_name}</Text>}

            <Text style={styles.inputLabel}>Trade Demands / Preferences (Optional):</Text>
            <TextInput style={styles.textInput} placeholder="e.g., Looking for a starting MID..." placeholderTextColor="#666" multiline={true} numberOfLines={4} value={tradeNoteText} onChangeText={setTradeNoteText} maxLength={150} />

            <View style={styles.modalActionRow}>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} onPress={() => setIsModalVisible(false)}>
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonConfirm]} onPress={handleSaveListing}>
                <Text style={styles.modalButtonConfirmText}>List Player</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* POP-UP MODAL B: DETAIL CARD DISPLAY */}
      <Modal visible={isDetailModalVisible} animationType="fade" transparent={true} onRequestClose={() => setIsDetailModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.cardDetailModal}>
            {viewingMarketItem && (
              <View>
                <Text style={styles.cardDetailTitle}>Player Details</Text>
                <Text style={styles.cardDetailPlayerName}>{viewingMarketItem.players.web_name}</Text>

                <View style={styles.cardDetailGrid}>
                  <View style={styles.cardDetailGridItem}>
                    <Text style={styles.gridLabel}>Position</Text>
                    <Text style={styles.gridValue}>{viewingMarketItem.players.element_type}</Text>
                  </View>
                  <View style={styles.cardDetailGridItem}>
                    <Text style={styles.gridLabel}>Club</Text>
                    <Text style={styles.gridValue}>{viewingMarketItem.players.team_name}</Text>
                  </View>
                  <View style={styles.cardDetailGridItem}>
                    <Text style={styles.gridLabel}>Total Points</Text>
                    <Text style={[styles.gridValue, { color: '#00ff87' }]}>{viewingMarketItem.players.total_points} PTS</Text>
                  </View>
                </View>

                <View style={styles.cardDetailNoteContainer}>
                  <Text style={styles.detailNoteLabel}>📋 Manager's Trade Demands:</Text>
                  <Text style={styles.detailNoteText}>
                    {viewingMarketItem.trade_note ? `"${viewingMarketItem.trade_note}"` : "Owner did not specify trade requirements. Send an open offer!"}
                  </Text>
                </View>

                <Text style={styles.ownerText}>Owned by Manager ID: {viewingMarketItem.user_id.slice(0, 12)}...</Text>

                <View style={styles.modalActionRow}>
                  <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} onPress={() => setIsDetailModalVisible(false)}>
                    <Text style={styles.modalButtonCancelText}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalButton, styles.modalButtonConfirm]} onPress={() => handleProposeTrade(viewingMarketItem.players, viewingMarketItem.user_id)}>
                    <Text style={styles.modalButtonConfirmText}>Propose Trade</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <TradeDeskModal
        visible={isTradeModalVisible}
        onClose={() => setIsTradeModalVisible(false)}
        targetPlayer={tradeTargetPlayer}
        tradePartner={tradeOwnerInfo}
        leagueId={leagueId}
        currentUserId={userId}
        onSuccess={syncMarketDataEngine}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
  managementTrigger: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', padding: 8, marginHorizontal: 8, marginTop: 8, marginBottom: 4, borderRadius: 2, alignItems: 'center' },
  managementTriggerActive: { borderColor: '#00ff87', backgroundColor: '#14251c' },
  triggerText: { color: '#666', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  triggerTextActive: { color: '#00ff87' },
  feedContent: { padding: 12, paddingBottom: 40 },
  sectionHeader: { fontSize: 12, fontWeight: '900', color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14, marginLeft: 4 },
  emptyContainer: { padding: 40, alignItems: 'center', marginTop: 40 },
  emptyText: { color: '#444', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  emptySub: { color: '#222', fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 6, paddingHorizontal: 20 },
  cleanRowSlim: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#111', borderWidth: 1, borderColor: '#191919', borderRadius: 4, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 4 },
  cleanInfoColSlim: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  cleanPlayerNameSlim: { color: '#FFF', fontSize: 14, fontWeight: '800', marginRight: 10 },
  cleanMetaTextSlim: { color: '#666', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginRight: 10 },
  cleanPointsColSlim: { alignItems: 'center', justifyContent: 'center', minWidth: 28 },
  cleanPointsValueSlim: { color: '#00ff87', fontSize: 14, fontWeight: '900' },
  cleanPointsLabelSlim: { color: '#444', fontSize: 7, fontWeight: '900', marginTop: -3 },

  shelfContainer: { flex: 1, backgroundColor: '#070709', paddingHorizontal: 6 },
  shelfContent: { paddingBottom: 10 },
  shelfTitle: { fontSize: 10, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', marginTop: 2 },
  shelfSubtitle: { fontSize: 8, color: '#555', fontWeight: '600', marginTop: 1, marginBottom: 4 },
  shelfRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0F0F11', borderWidth: 1, borderColor: '#1C1C1E', paddingVertical: 1, paddingHorizontal: 6, marginBottom: 1, borderRadius: 2, minHeight: 28 },
  shelfRowAdvertising: { borderColor: '#00ff8744', backgroundColor: '#0D1711' },
  shelfIdentityRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, overflow: 'hidden' },
  shelfPlayerName: { color: '#FFF', fontWeight: '800', fontSize: 11, maxWidth: '32%' },
  shelfPlayerMeta: { color: '#555', fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  shelfPlayerPts: { color: '#00ff87', fontSize: 9, fontWeight: '800' },
  shelfNotePreview: { color: '#777', fontSize: 8, fontStyle: 'italic', flex: 1 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#161616', width: '85%', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#333' },
  modalTitle: { color: '#FFF', fontSize: 16, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' },
  modalPlayerName: { color: '#00ff87', fontSize: 15, fontWeight: '800', textAlign: 'center', marginTop: 6, marginBottom: 16 },
  inputLabel: { color: '#888', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  textInput: { backgroundColor: '#222', color: '#FFF', borderRadius: 8, padding: 12, fontSize: 13, height: 100, textAlignVertical: 'top', borderWidth: 1, borderColor: '#333' },
  modalActionRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginHorizontal: 6, justifyContent: 'center' },
  modalButtonCancel: { backgroundColor: '#333' },
  modalButtonConfirm: { backgroundColor: '#00ff87' },
  modalButtonCancelText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  modalButtonConfirmText: { color: '#000', fontWeight: '800', fontSize: 13 },
  cardDetailModal: { backgroundColor: '#161616', width: '85%', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#333' },
  cardDetailTitle: { color: '#555', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center', letterSpacing: 1 },
  cardDetailPlayerName: { color: '#FFF', fontSize: 20, fontWeight: '900', textAlign: 'center', marginTop: 4, marginBottom: 16 },
  cardDetailGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, backgroundColor: '#1E1E1E', padding: 10, borderRadius: 8 },
  cardDetailGridItem: { flex: 1, alignItems: 'center' },
  gridLabel: { color: '#666', fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  gridValue: { color: '#E0E0E0', fontSize: 12, fontWeight: '700', marginTop: 2 },
  cardDetailNoteContainer: { backgroundColor: '#0C0C0C', borderRadius: 8, padding: 14, borderLeftWidth: 3, borderLeftColor: '#00ff87', marginBottom: 12 },
  detailNoteLabel: { color: '#888', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  detailNoteText: { color: '#E0E0E0', fontSize: 13, fontStyle: 'italic', lineHeight: 18 },
  ownerText: { color: '#444', fontSize: 10, textAlign: 'center', marginVertical: 4, fontWeight: '600' },
  miniPosBadgeCompact: { paddingHorizontal: 3, paddingVertical: 0.5, borderRadius: 2, justifyContent: 'center', alignItems: 'center' },
  miniPosTextCompact: { color: '#000', fontSize: 6.5, fontWeight: '900' }
});