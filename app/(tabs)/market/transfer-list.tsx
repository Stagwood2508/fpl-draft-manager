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
import TradeDeskModal from '@/features/market/components/TradeDeskModal';
import { useAppSession } from '@/features/account/hooks/useAppSession';
import {
  appColors,
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

  const {
    currentUserId,
    activeLeagueId,
  } = useAppSession();
  const userId = currentUserId;
const leagueId = activeLeagueId;
  const [loading, setLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

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
  if (isFocused && userId && leagueId) {
    void syncMarketDataEngine();
  }
}, [isFocused, userId, leagueId]);

const syncMarketDataEngine = async () => {
  try {
    setLoading(true);

    if (!userId) {
      throw new Error('User authentication lost.');
    }

    if (!leagueId) {
      throw new Error('Active league scope undetermined.');
    }

    const currentLeagueId = leagueId;

    const { data: rosterData, error: rosterErr } = await supabase
      .from('rosters')
      .select(`
        id,
        user_id,
        is_transfer_listed,
        trade_note,
        players (
          id,
          first_name,
          second_name,
          web_name,
          element_type,
          team_name,
          total_points
        )
      `)
      .eq('league_id', currentLeagueId);

    if (rosterErr) {
      throw rosterErr;
    }

    const structuredRoster = (rosterData || [])
      .map((item: any) => ({
        id: item.id,
        user_id: item.user_id,
        is_transfer_listed: item.is_transfer_listed,
        trade_note: item.trade_note,
        players: Array.isArray(item.players)
          ? item.players[0]
          : item.players,
      }))
      .filter((rosterItem) => rosterItem.players !== null) as RosterItem[];

    const sortedPublicFeed = structuredRoster
      .filter(
        (rosterItem) =>
          rosterItem.is_transfer_listed &&
          rosterItem.user_id !== userId
      )
      .sort(
        (a, b) =>
          (b.players?.total_points || 0) -
          (a.players?.total_points || 0)
      );

    const sortedPersonalRoster = structuredRoster
      .filter((rosterItem) => rosterItem.user_id === userId)
      .sort((a, b) => {
        const posA =
          POSITION_ORDER[a.players?.element_type] || 99;
        const posB =
          POSITION_ORDER[b.players?.element_type] || 99;

        if (posA !== posB) {
          return posA - posB;
        }

        return (
          (b.players?.total_points || 0) -
          (a.players?.total_points || 0)
        );
      });

    setPublicMarketFeed(sortedPublicFeed);
    setMyPersonalRoster(sortedPersonalRoster);
  } catch (err: any) {
    Alert.alert(
      'Market Synchronization Offline',
      err?.message || 'Unable to load the transfer market.'
    );
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
if (!userId || !leagueId) {
  throw new Error('Your user or league session is unavailable.');
}

const { error } = await supabase
  .from('rosters')
  .update({
    is_transfer_listed: nextStatus,
    trade_note: nextStatus ? note : null,
  })
  .eq('id', rosterId)
  .eq('user_id', userId)
  .eq('league_id', leagueId);

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
        <ActivityIndicator size="large" color={appColors.accent} />
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

  managementTrigger: {
    backgroundColor: appColors.surface,
    borderWidth: 1,
    borderColor: appColors.border,
    paddingVertical: 10,
    paddingHorizontal: appSpacing.md,
    marginHorizontal: appSpacing.lg,
    marginTop: appSpacing.md,
    marginBottom: appSpacing.sm,
    borderRadius: appRadius.medium,
    alignItems: 'center',
  },

  managementTriggerActive: {
    borderColor: appColors.accent,
    backgroundColor: appColors.accentSoft,
  },

  triggerText: {
    color: appColors.textSecondary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },

  triggerTextActive: {
    color: appColors.accent,
  },

  feedContent: {
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
    paddingHorizontal: appSpacing.lg,
    paddingTop: appSpacing.md,
    paddingBottom: 40,
  },

  sectionHeader: {
    ...appTypography.sectionTitle,
    color: appColors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: appSpacing.md,
  },

  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    marginTop: 32,
    backgroundColor: appColors.surface,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: appRadius.medium,
  },

  emptyText: {
    color: appColors.textSecondary,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },

  emptySub: {
    color: appColors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: appSpacing.sm,
    paddingHorizontal: appSpacing.xl,
    lineHeight: 16,
  },

  cleanRowSlim: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: appRadius.medium,
    paddingVertical: 11,
    paddingHorizontal: appSpacing.md,
    marginBottom: appSpacing.sm,
  },

  cleanInfoColSlim: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },

  cleanPlayerNameSlim: {
    color: appColors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    marginRight: appSpacing.sm,
  },

  cleanMetaTextSlim: {
    color: appColors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginRight: appSpacing.sm,
  },

  cleanPointsColSlim: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 42,
    marginLeft: appSpacing.sm,
  },

  cleanPointsValueSlim: {
    color: appColors.accent,
    fontSize: 15,
    fontWeight: '900',
  },

  cleanPointsLabelSlim: {
    color: appColors.textMuted,
    fontSize: 7,
    fontWeight: '900',
    marginTop: -2,
    letterSpacing: 0.5,
  },

  shelfContainer: {
    flex: 1,
    backgroundColor: appColors.background,
  },

  shelfContent: {
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
    paddingHorizontal: appSpacing.lg,
    paddingTop: appSpacing.md,
    paddingBottom: 40,
  },

  shelfTitle: {
    ...appTypography.sectionTitle,
    color: appColors.textPrimary,
    textTransform: 'uppercase',
  },

  shelfSubtitle: {
    color: appColors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: appSpacing.md,
  },

  shelfRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderWidth: 1,
    borderColor: appColors.border,
    paddingVertical: 9,
    paddingHorizontal: appSpacing.md,
    marginBottom: appSpacing.sm,
    borderRadius: appRadius.medium,
    minHeight: 44,
  },

  shelfRowAdvertising: {
    borderColor: appColors.accentBorder,
    backgroundColor: appColors.accentSoft,
  },

  shelfIdentityRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    overflow: 'hidden',
  },

  shelfPlayerName: {
    color: appColors.textPrimary,
    fontWeight: '800',
    fontSize: 12,
    maxWidth: '30%',
  },

  shelfPlayerMeta: {
    color: appColors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
  },

  shelfPlayerPts: {
    color: appColors.accent,
    fontSize: 10,
    fontWeight: '900',
  },

  shelfNotePreview: {
    color: appColors.textSecondary,
    fontSize: 9,
    fontStyle: 'italic',
    flex: 1,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(1, 7, 12, 0.86)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: appSpacing.lg,
  },

  modalContent: {
    backgroundColor: appColors.surfaceRaised,
    width: '100%',
    maxWidth: 520,
    borderRadius: appRadius.large,
    padding: appSpacing.xl,
    borderWidth: 1,
    borderColor: appColors.borderStrong,
  },

  modalTitle: {
    color: appColors.textPrimary,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },

  modalPlayerName: {
    color: appColors.accent,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: appSpacing.lg,
  },

  inputLabel: {
    color: appColors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: appSpacing.sm,
  },

  textInput: {
    backgroundColor: appColors.backgroundElevated,
    color: appColors.textPrimary,
    borderRadius: appRadius.medium,
    padding: appSpacing.md,
    fontSize: 13,
    height: 110,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: appColors.border,
  },

  modalActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: appSpacing.xl,
  },

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
    backgroundColor: appColors.accent,
    borderColor: appColors.accentDark,
  },

  modalButtonCancelText: {
    color: appColors.textPrimary,
    fontWeight: '800',
    fontSize: 13,
  },

  modalButtonConfirmText: {
    color: appColors.backgroundDeep,
    fontWeight: '900',
    fontSize: 13,
  },

  cardDetailModal: {
    backgroundColor: appColors.surfaceRaised,
    width: '100%',
    maxWidth: 560,
    borderRadius: appRadius.large,
    padding: appSpacing.xl,
    borderWidth: 1,
    borderColor: appColors.borderStrong,
  },

  cardDetailTitle: {
    color: appColors.accent,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: 1.2,
  },

  cardDetailPlayerName: {
    color: appColors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 5,
    marginBottom: appSpacing.lg,
  },

  cardDetailGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: appSpacing.lg,
    backgroundColor: appColors.backgroundElevated,
    padding: appSpacing.md,
    borderRadius: appRadius.medium,
    borderWidth: 1,
    borderColor: appColors.border,
  },

  cardDetailGridItem: {
    flex: 1,
    alignItems: 'center',
  },

  gridLabel: {
    color: appColors.textMuted,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  gridValue: {
    color: appColors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4,
  },

  cardDetailNoteContainer: {
    backgroundColor: appColors.backgroundElevated,
    borderRadius: appRadius.medium,
    padding: appSpacing.md,
    borderLeftWidth: 3,
    borderLeftColor: appColors.accent,
    marginBottom: appSpacing.md,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: appColors.border,
    borderRightColor: appColors.border,
    borderBottomColor: appColors.border,
  },

  detailNoteLabel: {
    color: appColors.textMuted,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 5,
  },

  detailNoteText: {
    color: appColors.textPrimary,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
  },

  ownerText: {
    color: appColors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    marginVertical: 5,
    fontWeight: '600',
  },

  miniPosBadgeCompact: {
    minWidth: 30,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: appRadius.small,
    justifyContent: 'center',
    alignItems: 'center',
  },

  miniPosTextCompact: {
    color: appColors.backgroundDeep,
    fontSize: 7,
    fontWeight: '900',
  },
});