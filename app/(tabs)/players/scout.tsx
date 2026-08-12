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
  RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  web_name: string;
  first_name: string;
  second_name: string;
  team_name: string;
  team_short_name?: string;
  element_type: string;
  total_points: number;
}

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
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentGameweek, setCurrentGameweek] = useState<number>(1);
  
  // Market Window State: 'WAIVERS_OPEN' | 'FREE_AGENCY' | 'IN_PLAY'
  const [marketStatus, setMarketStatus] = useState<'WAIVERS_OPEN' | 'FREE_AGENCY' | 'IN_PLAY'>('WAIVERS_OPEN');

  const [allPlayers, setAllPlayers] = useState<PlayerAsset[]>([]);
  const [filteredPlayers, setFilteredPlayers] = useState<PlayerAsset[]>([]);
  const [watchlistIds, setWatchlistIds] = useState<Set<number>>(new Set()); 
  const [ownershipMap, setOwnershipMap] = useState<Record<number, OwnershipInfo>>({});
  const [waiverLockedPlayerIds, setWaiverLockedPlayerIds] = useState<Set<number>>(new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<string>('ALL');

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

  useEffect(() => {
    let output = allPlayers;
    if (selectedPosition !== 'ALL') output = output.filter(p => p.element_type === selectedPosition);
    if (searchQuery.trim()) output = output.filter(p => p.web_name.toLowerCase().includes(searchQuery.toLowerCase()));
    setFilteredPlayers(output);
  }, [searchQuery, selectedPosition, allPlayers]);

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
        const { data: leagueGwData } = await supabase
          .from('league_gameweeks')
          .select('gameweek, status')
          .eq('league_id', currentLeagueId)
          .in('status', ['WAIVERS_OPEN', 'FREE_AGENCY', 'IN_PLAY'])
          .order('gameweek', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (leagueGwData) {
          resolvedGameweek = leagueGwData.gameweek;
          setCurrentGameweek(leagueGwData.gameweek);
          setMarketStatus(leagueGwData.status as any);
        }
      }

      // Query player database directly for verified team names and short codes
      const { data: playersData, error: playersErr } = await supabase
        .from('players')
        .select('id, web_name, first_name, second_name, team_name, team_short_name, element_type, total_points')
        .eq('is_active', true)
        .order('total_points', { ascending: false });

      if (playersErr) throw playersErr;

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
        element_type: overridesMap[player.id] || player.element_type
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
                owners[key].short_initials = name.slice(0, 2).toUpperCase();
              }
            });
          }

          const { data: profilesData } = await supabase.from('profiles').select('id, display_name, first_name, last_name');
          if (profilesData) {
            const profileMap: Record<string, { full: string; short: string }> = {};
            profilesData.forEach((p: any) => {
              let shortTag = p.first_name && p.last_name ? `${p.first_name.charAt(0)}${p.last_name.charAt(0)}` : p.display_name?.slice(0, 2) || 'M';
              profileMap[p.id] = { full: p.display_name || `Manager ${p.id.slice(0, 4)}`, short: shortTag.toUpperCase() };
            });

            Object.keys(owners).forEach((key: any) => {
              const ownerUserId = owners[key].userId;
              if (owners[key].display_name.startsWith('Manager') && profileMap[ownerUserId]) {
                owners[key].display_name = profileMap[ownerUserId].full;
                owners[key].short_initials = profileMap[ownerUserId].short;
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
      setFilteredPlayers(finalizedPool);
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
            <Text style={styles.pointsValueText}>{item.total_points}</Text>
            <Text style={styles.pointsLabelText}>PTS</Text>
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
      </View>

      {/* Position Filters */}
      <View style={styles.pillsContainerRow}>
        {positions.map(pos => (
          <TouchableOpacity key={pos} style={[styles.pillBtn, selectedPosition === pos && styles.pillBtnActive]} onPress={() => setSelectedPosition(pos)}>
            <Text style={[styles.pillText, selectedPosition === pos && styles.pillTextActive]}>{pos}</Text>
          </TouchableOpacity>
        ))}
      </View>

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

      {/* Player Details Card Modal */}
      <PlayerCardModal 
        visible={detailsVisible} 
        playerId={selectedModalPlayerId} 
        leagueId={activeLeagueId}
        currentGameweek={currentGameweek}
        onClose={() => { setDetailsVisible(false); setSelectedModalPlayerId(null); }} 
      />

      {/* POSITION-MATCHED WAIVER QUEUE MODAL (WAIVERS_OPEN) */}
      <Modal visible={isWaiverModalVisible} animationType="slide" transparent={true} onRequestClose={() => !submittingWaiver && setIsWaiverModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
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
  searchBoxRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 12, margin: 16, borderRadius: 6, height: 44 },
  searchInputField: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  pillsContainerRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 16 },
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
  pointsColumn: { alignItems: 'center', justifyContent: 'center', marginRight: 8, minWidth: 28 },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: colors.surface, width: '90%', maxHeight: '80%', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.borderStrong },
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
