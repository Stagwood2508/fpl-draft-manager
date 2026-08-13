import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
  useWindowDimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { AppColors } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';

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
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width, height } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const isMobileLayout = width < 700;
  const isShortMobile = isMobileLayout && height < 720;
  const [modalLoading, setModalLoading] = useState(false);
  const [rosterType, setRosterType] = useState<'STRICT' | 'FLEXIBLE'>('STRICT');
  
  const [myTradeRoster, setMyTradeRoster] = useState<PlayerAsset[]>([]);
  const [rivalTradeRoster, setRivalTradeRoster] = useState<PlayerAsset[]>([]);
  const [mySelectedTradeIds, setMySelectedTradeIds] = useState<number[]>([]);
  const [rivalSelectedTradeIds, setRivalSelectedTradeIds] = useState<number[]>([]);

  const notifyUser = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

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
      console.log('🔄 [TRADE MODAL] Loading context for target player:', targetPlayer.web_name, 'partner:', tradePartner.display_name);
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
const { data: leagueSettings, error: settingsError } = await supabase
  .from('league_settings')
  .select('roster_type')
  .eq('league_id', resolvedLeagueId)
  .maybeSingle();

if (settingsError) {
  throw settingsError;
}

if (leagueSettings?.roster_type) {
  setRosterType(
    leagueSettings.roster_type as 'STRICT' | 'FLEXIBLE'
  );
}


      // 4. Fetch Both Roster Packages strictly for the resolved active league
      const [myDataRes, rivalDataRes] = await Promise.all([
        supabase.from('rosters').select('players(*)').eq('league_id', resolvedLeagueId).eq('user_id', resolvedUserId),
        supabase.from('rosters').select('players(*)').eq('league_id', resolvedLeagueId).eq('user_id', tradePartner.userId)
      ]);

      if (myDataRes.error) {
  throw myDataRes.error;
}

if (rivalDataRes.error) {
  throw rivalDataRes.error;
}

      const parsedMy = (myDataRes.data?.map(r => Array.isArray(r.players) ? r.players[0] : r.players).filter(Boolean) || []) as PlayerAsset[];
      const parsedRival = (rivalDataRes.data?.map(r => Array.isArray(r.players) ? r.players[0] : r.players).filter(Boolean) || []) as PlayerAsset[];

      console.log(`[TRADE MODAL] Roster loaded. My count: ${parsedMy.length}, Rival count: ${parsedRival.length}`);

      setMyTradeRoster(sortRosterByPosition(parsedMy));
      setRivalTradeRoster(sortRosterByPosition(parsedRival));
    } catch (err: any) {
      console.error('❌ [TRADE MODAL LOAD ERROR]:', err);
      notifyUser('Trade Load Error', err.message);
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
          notifyUser('Position Lock (Strict Mode)', `You must request another ${pos} from your trading partner before offering an additional ${pos}.`);
          return prev;
        }
      } else {
        // FLEXIBLE MODE LOGIC
        if (pos === 'GKP') {
          const demandedGKP = demandedPlayers.filter(p => p.element_type === 'GKP').length;
          const selectedGKP = myTradeRoster.filter(p => prev.includes(p.id) && p.element_type === 'GKP').length;
          if (selectedGKP >= demandedGKP) {
            notifyUser('Goalkeeper Lock', 'Goalkeepers must be traded 1-to-1 for Goalkeepers.');
            return prev;
          }
        } else {
          const demandedOutfield = demandedPlayers.filter(p => p.element_type !== 'GKP').length;
          const selectedOutfield = myTradeRoster.filter(p => prev.includes(p.id) && p.element_type !== 'GKP').length;
          if (selectedOutfield >= demandedOutfield) {
            notifyUser('Outfield Trade Cap', `You have requested ${demandedOutfield} outfield player(s). Request another player before adding more to your offer.`);
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
    console.log('🚀 [TRADE] Submit Offer clicked. My Selected IDs:', mySelectedTradeIds, 'Rival Selected IDs:', rivalSelectedTradeIds);

    const myTradePlayers = sortRosterByPosition(myTradeRoster.filter(p => mySelectedTradeIds.includes(p.id)));
    const rivalTradePlayers = sortRosterByPosition(rivalTradeRoster.filter(p => rivalSelectedTradeIds.includes(p.id)));

    if (myTradePlayers.length === 0 || rivalTradePlayers.length === 0) {
      notifyUser('Trade Setup Error', 'Select at least one player to give and receive.');
      return;
    }

    if (myTradePlayers.length !== rivalTradePlayers.length) {
      notifyUser('Asymmetric Trade', 'Trades must be equal-size player swaps (e.g. 1-for-1, 2-for-2).');
      return;
    }

    const executeDispatch = async () => {
      try {
        setModalLoading(true);
        console.log('📦 [TRADE] Packaging trade proposal payload...');

        let resolvedLeagueId = leagueId || (await AsyncStorage.getItem('active_league_id'));
        let resolvedUserId = currentUserId;
        if (!resolvedUserId) {
          const { data: { user } } = await supabase.auth.getUser();
          resolvedUserId = user?.id || null;
        }

        if (!resolvedLeagueId || !resolvedUserId || !tradePartner?.userId) {
          throw new Error('Missing required authentication or league parameters.');
        }

        const tradePayload = {
          p_league_id: resolvedLeagueId,
          p_receiver_id: tradePartner.userId,
          p_player_out_ids: myTradePlayers.map(player => player.id),
          p_player_in_ids: rivalTradePlayers.map(player => player.id),
        };

        console.log('⚡ [TRADE] Inserting transaction rows into Supabase:', tradePayload);

        const { data, error } = await supabase.rpc('create_trade_package', tradePayload);
        if (error) throw error;
        if (data && data.success === false) {
          throw new Error(data.error || 'The trade package was rejected by the server.');
        }
        
        console.log('✅ [TRADE] Trade dispatched successfully!');
        notifyUser('Success', 'Trade proposal successfully dispatched!');
        if (onSuccess) onSuccess();
        onClose();
      } catch (err: any) {
        console.error('❌ [TRADE DISPATCH ERROR]:', err);
        notifyUser('Error Dispatching Offer', err.message || 'Failed to send trade proposal.');
      } finally {
        setModalLoading(false);
      }
    };

    // Platform-Aware Execution Handler to bypass Web Alert.alert Suppression
    if (Platform.OS === 'web') {
      if (window.confirm(`Dispatch trade offer to ${tradePartner?.display_name || 'Manager'}?`)) {
        await executeDispatch();
      }
    } else {
      Alert.alert(
        'Initialize Trade Proposal',
        `Dispatch trade offer to ${tradePartner?.display_name}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Send Offer', onPress: executeDispatch }
        ]
      );
    }
  };

  const getShortTeamCode = (name: string) => (name ? name.slice(0, 3).toUpperCase() : 'FA');

  return (
    <Modal visible={visible} animationType="slide" transparent={true} presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.modalOverlay, isMobileLayout && styles.modalOverlayMobile]}>
        <View style={[
          styles.tradeModalContent,
          isMobileLayout && styles.tradeModalContentMobile,
          isMobileLayout && { paddingTop: Math.max(safeArea.top, 8), paddingBottom: Math.max(safeArea.bottom, 8) },
        ]}>
          <Text style={[styles.modalHeader, isMobileLayout && styles.modalHeaderMobile]}>Construct Trade Proposal</Text>
          <Text style={tradePartner?.display_name ? [styles.tradeSubHeader, isMobileLayout && styles.tradeSubHeaderMobile] : { display: 'none' }}>
            Partner: {tradePartner?.display_name} • Mode: {rosterType}
          </Text>

          {modalLoading && myTradeRoster.length === 0 ? (
            <View style={styles.loaderBox}><ActivityIndicator size="large" color="#00F27A" /></View>
          ) : (
            <View style={[styles.tradeLayoutGrid, isMobileLayout && styles.tradeLayoutGridMobile]}>
              {/* Left Column */}
              <View style={[styles.tradeCol, isMobileLayout && styles.tradeColMobile]}>
                <Text style={[styles.colTitle, isMobileLayout && styles.colTitleMobile]}>{isMobileLayout ? 'Send mine' : 'Send My Asset(s)'}</Text>
                <ScrollView style={styles.tradeScrollView} contentContainerStyle={isMobileLayout && styles.tradeScrollContentMobile} showsVerticalScrollIndicator={false} nestedScrollEnabled>
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
                        style={[styles.tradeSelectorCardCompact, isMobileLayout && styles.tradeSelectorCardMobile, isMobileLayout && styles.tradeSelectorCardFillMobile, isShortMobile && styles.tradeSelectorCardShortMobile, isSelected && styles.tradeSelectorCardSelected, isSelectionDisabled && styles.tradeSelectorCardDisabled]}
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

              {/* Right Column */}
              <View style={[styles.tradeCol, isMobileLayout && styles.tradeColMobile]}>
                <Text style={[styles.colTitle, isMobileLayout && styles.colTitleMobile]}>{isMobileLayout ? 'Receive theirs' : 'Demand Asset(s)'}</Text>
                <ScrollView style={styles.tradeScrollView} contentContainerStyle={isMobileLayout && styles.tradeScrollContentMobile} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                  {rivalTradeRoster.map(p => {
                    const isSelected = rivalSelectedTradeIds.includes(p.id);
                    return (
                      <TouchableOpacity 
                        key={p.id} 
                        style={[styles.tradeSelectorCardCompact, isMobileLayout && styles.tradeSelectorCardMobile, isMobileLayout && styles.tradeSelectorCardFillMobile, isShortMobile && styles.tradeSelectorCardShortMobile, isSelected && styles.tradeSelectorCardSelected]}
                        onPress={() => toggleSelectRivalTradePlayer(p.id)}
                      >
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
          )}

          <Text style={[styles.tradeLockNotice, isMobileLayout && styles.tradeLockNoticeMobile]} numberOfLines={isMobileLayout ? 2 : undefined}>
            {rosterType === 'STRICT'
              ? '⚠️ Strict Mode: Swaps must be equal size and matching positions (e.g. MID for MID).'
              : '⚡ Flexible Mode: Equal-sized swaps. Cross-position outfield trading is permitted.'}
          </Text>

          <View style={[styles.modalActionRow, isMobileLayout && styles.modalActionRowMobile]}>
            <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} onPress={onClose} disabled={modalLoading}>
              <Text style={styles.modalButtonCancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.modalButton, styles.modalButtonConfirm, modalLoading && { opacity: 0.6 }]} onPress={handleProposeBilateralTrade} disabled={modalLoading}>
              {modalLoading ? (
                <ActivityIndicator size="small" color="#030A11" />
              ) : (
                <Text style={styles.modalButtonConfirmText}>Submit Offer</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(1, 7, 12, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalOverlayMobile: {
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    padding: 0,
  },

  tradeModalContent: {
    backgroundColor: colors.surfaceRaised,
    width: '92%',
    maxWidth: 920,
    height: '82%',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
    overflow: 'hidden',
  },
  tradeModalContentMobile: {
    width: '100%',
    maxWidth: undefined,
    height: '100%',
    borderRadius: 0,
    paddingHorizontal: 6,
    borderWidth: 0,
  },

  loaderBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalHeader: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 4,
  },
  modalHeaderMobile: {
    fontSize: 14,
    marginBottom: 1,
  },

  tradeSubHeader: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 14,
  },
  tradeSubHeaderMobile: {
    fontSize: 9,
    marginBottom: 2,
  },

  tradeLayoutGrid: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 8,
    marginBottom: 10,
    gap: 12,
  },
  tradeLayoutGridMobile: {
    marginTop: 3,
    marginBottom: 3,
    gap: 4,
  },

  tradeCol: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.backgroundElevated,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tradeColMobile: {
    padding: 3,
    borderRadius: 5,
  },

  tradeScrollView: {
    flex: 1,
  },
  tradeScrollContentMobile: {
    flexGrow: 1,
  },

  colTitle: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: 0.6,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
  },
  colTitleMobile: {
    fontSize: 8,
    marginBottom: 2,
    paddingBottom: 2,
    letterSpacing: 0.2,
  },

  tradeSelectorCardCompact: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginBottom: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tradeSelectorCardMobile: {
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 3,
    backgroundColor: colors.surfaceRaised,
  },
  tradeSelectorCardShortMobile: {
    paddingVertical: 2,
    marginBottom: 1,
  },
  tradeSelectorCardFillMobile: {
    flexGrow: 1,
    flexBasis: 0,
    justifyContent: 'center',
  },

  tradeSelectorCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },

  tradeSelectorCardDisabled: {
    opacity: 0.42,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },

  tradeCardRowFlow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },

  tradeCardTextCompact: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    flex: 1,
    minWidth: 0,
    marginRight: 8,
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
  tradeCardTextMobile: {
    fontSize: 9,
    lineHeight: 10,
    marginRight: 0,
  },

  tradeCardMetaMobile: {
    color: colors.textMuted,
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
    color: colors.black,
    fontSize: 6,
    lineHeight: 7,
    fontWeight: '900',
  },

  tradeCardTextSelected: {
    color: colors.accent,
  },

  tradeCardTextDisabled: {
    color: colors.textMuted,
  },

  tradeCardMetaTextCompact: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    marginRight: 8,
    flexShrink: 0,
  },

  miniPosBadgeCompact: {
    minWidth: 32,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },

  miniPosTextCompact: {
    color: colors.black,
    fontSize: 8,
    fontWeight: '900',
  },

  tradeLockNotice: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    marginVertical: 10,
    paddingHorizontal: 16,
    lineHeight: 15,
    flexShrink: 0,
  },
  tradeLockNoticeMobile: {
    fontSize: 8,
    lineHeight: 10,
    marginVertical: 2,
    paddingHorizontal: 4,
  },

  modalActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
    flexShrink: 0,
  },
  modalActionRowMobile: {
    marginTop: 2,
    gap: 6,
  },

  modalButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
  },

  modalButtonCancel: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.borderStrong,
  },

  modalButtonConfirm: {
    backgroundColor: colors.accent,
    borderColor: colors.accentDark,
  },

  modalButtonCancelText: {
    color: colors.textPrimary,
    fontWeight: '900',
    fontSize: 13,
  },

  modalButtonConfirmText: {
    color: colors.black,
    fontWeight: '900',
    fontSize: 13,
  },
});
