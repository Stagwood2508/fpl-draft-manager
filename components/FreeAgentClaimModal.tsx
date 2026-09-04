import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { AppColors } from '@/constants/theme';
import { useAppTheme } from '@/features/appearance/hooks/useAppTheme';
import PlayerCardModal from '@/components/PlayerCardModal';

interface PlayerAsset {
  id: number;
  web_name: string;
  element_type: string; // 'GKP' | 'DEF' | 'MID' | 'FWD'
  team_short_name?: string;
  team_name?: string;
}

interface FreeAgentClaimModalProps {
  visible: boolean;
  leagueId: string | null;
  currentGameweek: number;
  targetPlayer: PlayerAsset | null; // The Free Agent player to ADD
  onClose: () => void;
  onSuccess: () => void;
}

const POSITION_COLORS: Record<string, string> = {
  GKP: '#FFC107',
  DEF: '#00A2FF',
  MID: '#00FF87',
  FWD: '#FF0055',
};

export default function FreeAgentClaimModal({
  visible,
  leagueId,
  currentGameweek,
  targetPlayer,
  onClose,
  onSuccess,
}: FreeAgentClaimModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width, height } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const isMobileLayout = width < 700;
  const isShortMobile = isMobileLayout && height < 720;
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resolvedLid, setResolvedLid] = useState<string | null>(null);
  const [rosterType, setRosterType] = useState<'STRICT' | 'FLEXIBLE'>('STRICT');
  const [myRoster, setMyRoster] = useState<PlayerAsset[]>([]);
  const [selectedDropPlayerId, setSelectedDropPlayerId] = useState<number | null>(null);
  const [inspectingPlayerId, setInspectingPlayerId] = useState<number | null>(null);

  useEffect(() => {
    if (visible) {
      fetchUserRoster();
    } else {
      setSelectedDropPlayerId(null);
      setInspectingPlayerId(null);
    }
  }, [visible, leagueId]);

  // 1. Fetch Current Manager's Roster & League Roster Rule Type
  async function fetchUserRoster() {
    try {
      setLoadingRoster(true);

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) throw new Error('User authentication error.');

      // Resolve Active League ID from Prop > AsyncStorage
      let activeLid = leagueId;
      if (!activeLid) {
        activeLid = await AsyncStorage.getItem('active_league_id');
      }

      if (!activeLid) throw new Error('No active league context identified.');
      setResolvedLid(activeLid);

      // Fetch League Configuration (roster_type)
      const { data: leagueData } = await supabase
        .from('leagues')
        .select('roster_type')
        .eq('id', activeLid)
        .maybeSingle();

      const activeRosterType = leagueData?.roster_type || 'STRICT';
      setRosterType(activeRosterType as 'STRICT' | 'FLEXIBLE');

      // Fetch User Roster strictly for active league
      const { data: rosterData, error: rosterErr } = await supabase
        .from('rosters')
        .select(`
          player_id,
          players (
            id,
            web_name,
            element_type,
            team_name
          )
        `)
        .eq('league_id', activeLid)
        .eq('user_id', authData.user.id);

      if (rosterErr) throw rosterErr;

      const formattedRoster = (rosterData || [])
        .reduce<PlayerAsset[]>((players, r: any) => {
          const p = Array.isArray(r.players) ? r.players[0] : r.players;
          if (!p) return players;
          players.push({
            id: p.id,
            web_name: p.web_name,
            element_type: p.element_type || 'FWD',
            team_short_name: p.team_name ? p.team_name.slice(0, 3).toUpperCase() : 'PL',
          });
          return players;
        }, []);

      const positionOrder: Record<string, number> = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };
      const positionCounts = formattedRoster.reduce<Record<string, number>>((counts, player) => {
        counts[player.element_type] = (counts[player.element_type] || 0) + 1;
        return counts;
      }, {});
      const eligibleRoster = targetPlayer
        ? formattedRoster.filter((dropPlayer) => {
            if (activeRosterType === 'STRICT') {
              return dropPlayer.element_type === targetPlayer.element_type;
            }
            if ((dropPlayer.element_type === 'GKP') !== (targetPlayer.element_type === 'GKP')) {
              return false;
            }

            const projected = { ...positionCounts };
            projected[dropPlayer.element_type] = (projected[dropPlayer.element_type] || 0) - 1;
            projected[targetPlayer.element_type] = (projected[targetPlayer.element_type] || 0) + 1;
            return projected.GKP === 2
              && (projected.DEF || 0) >= 4 && (projected.DEF || 0) <= 6
              && (projected.MID || 0) >= 4 && (projected.MID || 0) <= 6
              && (projected.FWD || 0) >= 2 && (projected.FWD || 0) <= 4;
          })
        : [];

      eligibleRoster.sort((a, b) => {
        const positionDifference = (positionOrder[a.element_type] ?? 99) - (positionOrder[b.element_type] ?? 99);
        if (positionDifference !== 0) return positionDifference;
        return a.web_name.localeCompare(b.web_name);
      });

      setMyRoster(eligibleRoster);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoadingRoster(false);
    }
  }

  // 2. Helper to determine if a player can be selected for drop
  const isDropAllowed = (playerPos: string) => {
    if (!targetPlayer) return false;
    if (rosterType === 'STRICT') {
      return playerPos === targetPlayer.element_type;
    }
    // FLEXIBLE MODE
    if (targetPlayer.element_type === 'GKP') {
      return playerPos === 'GKP';
    }
    return playerPos !== 'GKP'; // Outfield players can swap across DEF/MID/FWD
  };

  // 3. Action Handler: Execute Instant Free Agent Claim
  const handleExecuteClaim = async () => {
    if (!targetPlayer) return;

    if (!selectedDropPlayerId) {
      Alert.alert('Select Player to Drop', 'You must select a player from your squad to drop.');
      return;
    }

    const targetLeagueId = resolvedLid || leagueId || (await AsyncStorage.getItem('active_league_id'));
    if (!targetLeagueId) {
      Alert.alert('Context Missing', 'Could not verify active league ID.');
      return;
    }

    const dropPlayer = myRoster.find((p) => p.id === selectedDropPlayerId);

    // Validate using dynamic roster rules
    if (dropPlayer && !isDropAllowed(dropPlayer.element_type)) {
      Alert.alert(
        'Invalid Swap',
        rosterType === 'STRICT'
          ? `Strict mode requires dropping a ${targetPlayer.element_type} to add ${targetPlayer.web_name}.`
          : 'Goalkeepers can only be swapped for Goalkeepers.'
      );
      return;
    }

    try {
      setSubmitting(true);

      // Call Atomic Postgres RPC Function (validates final squad counts)
      const { data, error } = await supabase.rpc('claim_free_agent_with_history', {
        p_league_id: targetLeagueId,
        p_add_player_id: targetPlayer.id,
        p_drop_player_id: selectedDropPlayerId,
        p_gameweek: currentGameweek,
      });

      if (error) throw error;

      if (data && !data.success) {
        if (data.error === 'PLAYER_WAIVER_LOCKED') {
          throw new Error(
            `This player is protected until the Gameweek ${data.available_gameweek || 'next'} waiver window.`
          );
        }
        throw new Error(data.error || 'Failed to complete Free Agent claim.');
      }

      Alert.alert(
        'Free Agent Signed!',
        `Successfully added ${targetPlayer.web_name} and dropped ${dropPlayer?.web_name}.`
      );

      onSuccess();
      onClose();
    } catch (err: any) {
      Alert.alert('Signing Failed', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!targetPlayer) return null;

  return (
    <>
    <Modal visible={visible && inspectingPlayerId === null} animationType="slide" transparent={true} presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.overlay, isMobileLayout && styles.overlayMobile]}>
        <View style={[styles.modalCard, isMobileLayout && styles.modalCardMobile, isMobileLayout && { paddingTop: Math.max(safeArea.top, 8), paddingBottom: Math.max(safeArea.bottom, 8) }]}>
          {/* Header */}
          <Text style={styles.modalBadge}>FREE AGENT PICKUP ({rosterType})</Text>
          <Text style={styles.modalTitle}>Confirm Player Swap</Text>

          {/* Target Add Player Box */}
          <View style={styles.addPlayerContainer}>
            <Text style={styles.boxLabel}>ADD PLAYER (FREE AGENT)</Text>
            <View style={styles.playerCardAdd}>
              <TouchableOpacity
                style={styles.playerInfoButton}
                onPress={() => setInspectingPlayerId(targetPlayer.id)}
                accessibilityRole="button"
                accessibilityLabel={`View ${targetPlayer.web_name} stats`}
              >
                <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
              </TouchableOpacity>
              <View style={styles.playerInfoLeft}>
                <Text style={styles.addPlayerName}>{targetPlayer.web_name}</Text>
                <Text style={styles.addPlayerMeta}>
                  {targetPlayer.team_short_name || targetPlayer.team_name || 'PL'}
                </Text>
              </View>
              <View
                style={[
                  styles.posBadge,
                  { backgroundColor: POSITION_COLORS[targetPlayer.element_type] || '#222' },
                ]}
              >
                <Text style={styles.posBadgeText}>{targetPlayer.element_type}</Text>
              </View>
            </View>
          </View>

          <View style={styles.dividerArrowContainer}>
            <Text style={styles.swapArrowText}>⇅ SELECT SQUAD PLAYER TO DROP</Text>
          </View>

          {/* Drop Selection Roster Scroll */}
          {loadingRoster ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color="#00ff87" />
            </View>
          ) : (
            <ScrollView style={[styles.rosterScroll, isMobileLayout && styles.rosterScrollMobile]} showsVerticalScrollIndicator={false} nestedScrollEnabled>
              {myRoster.length === 0 ? (
                <Text style={styles.emptyRosterText}>No squad player can be dropped while keeping a valid roster.</Text>
              ) : myRoster.map((player) => {
                const isSelected = selectedDropPlayerId === player.id;

                return (
                  <View
                    key={player.id}
                    style={[
                      styles.dropPlayerCard,
                      isMobileLayout && styles.dropPlayerCardMobile,
                      isShortMobile && styles.dropPlayerCardShortMobile,
                      isSelected && styles.dropPlayerCardSelected,
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.playerInfoButton}
                      onPress={() => setInspectingPlayerId(player.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${player.web_name} stats`}
                    >
                      <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.dropPlayerSelect} onPress={() => setSelectedDropPlayerId(player.id)}>
                      <Text
                        style={[
                          styles.dropPlayerName,
                          isSelected && styles.dropPlayerNameSelected,
                        ]}
                      >
                        {player.web_name}
                      </Text>
                      <Text style={styles.dropPlayerMeta}>{player.team_short_name}</Text>
                    </TouchableOpacity>

                    <View
                      style={[
                        styles.miniPosBadge,
                        { backgroundColor: POSITION_COLORS[player.element_type] || '#222' },
                      ]}
                    >
                      <Text style={styles.posBadgeText}>{player.element_type}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <Text style={styles.noticeText}>
            ⚡ Free agent claims take effect instantly. Your squad roster will be updated immediately.
          </Text>

          {/* Action Buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.btnCancel} onPress={onClose} disabled={submitting}>
              <Text style={styles.btnCancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.btnConfirm,
                (!selectedDropPlayerId || submitting) && styles.btnDisabled,
              ]}
              onPress={handleExecuteClaim}
              disabled={!selectedDropPlayerId || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={styles.btnConfirmText}>Sign Free Agent</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    <PlayerCardModal
      visible={visible && inspectingPlayerId !== null}
      playerId={inspectingPlayerId}
      leagueId={resolvedLid || leagueId}
      currentGameweek={currentGameweek}
      onClose={() => setInspectingPlayerId(null)}
    />
    </>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  overlayMobile: { justifyContent: 'flex-start', alignItems: 'stretch', padding: 0 },
  modalCard: {
    backgroundColor: colors.surface,
    width: '100%',
    maxHeight: '85%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: 16,
  },
  modalCardMobile: { width: '100%', height: '100%', maxHeight: undefined, borderRadius: 0, borderWidth: 0, paddingHorizontal: 8 },
  modalBadge: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 4,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 16,
    textTransform: 'uppercase',
  },

  addPlayerContainer: {
    backgroundColor: colors.backgroundDeep,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: 8,
    padding: 10,
  },
  boxLabel: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  playerCardAdd: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  playerInfoLeft: {
    flex: 1,
  },
  playerInfoButton: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: 3 },
  dropPlayerSelect: { flex: 1, minWidth: 0, justifyContent: 'center' },
  addPlayerName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  addPlayerMeta: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },

  dividerArrowContainer: {
    marginVertical: 12,
    alignItems: 'center',
  },
  swapArrowText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },

  loadingBox: {
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rosterScroll: {
    maxHeight: 220,
    marginBottom: 12,
  },
  rosterScrollMobile: { flex: 1, maxHeight: undefined, marginBottom: 4 },
  dropPlayerCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
  },
  dropPlayerCardMobile: { paddingVertical: 6, paddingHorizontal: 8, marginBottom: 3 },
  dropPlayerCardShortMobile: { paddingVertical: 4, marginBottom: 2 },
  dropPlayerCardSelected: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  dropPlayerCardDisabled: {
    opacity: 0.3,
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.borderSubtle,
  },
  dropPlayerName: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  dropPlayerNameSelected: {
    color: colors.danger,
    fontWeight: '900',
  },
  disabledText: {
    color: colors.textDisabled,
  },
  dropPlayerMeta: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  emptyRosterText: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, textAlign: 'center', padding: 20 },

  posBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  miniPosBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  posBadgeText: {
    color: colors.black,
    fontSize: 9,
    fontWeight: '900',
  },

  noticeText: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 14,
    fontStyle: 'italic',
  },

  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  btnCancel: {
    flex: 1,
    backgroundColor: colors.surfacePressed,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnCancelText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  btnConfirm: {
    flex: 1,
    backgroundColor: colors.accentFill,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  btnConfirmText: {
    color: colors.accentForeground,
    fontSize: 12,
    fontWeight: '900',
  },
});
